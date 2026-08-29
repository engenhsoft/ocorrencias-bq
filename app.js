import {
  APP_VERSION,
  RECORD_STATUS,
  countConfirmedPhotos,
  countReadyPhotoStates,
  escapeHtml,
  formatCurrency,
  formatDateTime,
  generateUuid,
  mergeRecordCollections,
  normalizeText,
  reconcilePhotoStates,
  statusLabel,
  statusTone,
  tokenExpiry
} from './core.js';
import {
  cacheCatalogResults,
  deletePhoto,
  deleteRecord,
  getAllRecords,
  getMeta,
  getPhoto,
  getPhotosForRecord,
  getQueueSummary,
  getRecord,
  openDatabase,
  putPhoto,
  putRecord,
  searchCachedCatalog,
  setMeta
} from './db.js';
import { ApiError, api, blobToDataUrl, endpointConfigured, healthCheck } from './api.js';

const SESSION_KEY = 'ocorrencias-bq-session-v1';
const LAST_USER_KEY = 'ocorrencias-bq-last-user-v1';
const ACTIVE_DRAFT_META = 'activeDraftId';
const LAST_SYNC_META = 'lastSyncAt';
const SYNCABLE_STATUSES = new Set([
  RECORD_STATUS.PENDING,
  RECORD_STATUS.SYNCING_DATA,
  RECORD_STATUS.SYNCING_PHOTOS,
  RECORD_STATUS.ERROR
]);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  loginView: $('#loginView'),
  loginForm: $('#loginForm'),
  loginUser: $('#loginUser'),
  loginPassword: $('#loginPassword'),
  loginButton: $('#loginButton'),
  loginMessage: $('#loginMessage'),
  loginNetworkDot: $('#loginNetworkDot'),
  loginNetworkText: $('#loginNetworkText'),
  appShell: $('#appShell'),
  sessionRoleLabel: $('#sessionRoleLabel'),
  networkBadge: $('#networkBadge'),
  installButton: $('#installButton'),
  logoutButton: $('#logoutButton'),
  mainNav: $('#mainNav'),
  supervisorNav: $('#supervisorNav'),
  supervisorNavCount: $('#supervisorNavCount'),
  syncNavCount: $('#syncNavCount'),
  resumeBanner: $('#resumeBanner'),
  resumeBannerText: $('#resumeBannerText'),
  resumeDraftButton: $('#resumeDraftButton'),
  discardDraftButton: $('#discardDraftButton'),
  draftIdBadge: $('#draftIdBadge'),
  serviceSearch: $('#serviceSearch'),
  serviceResults: $('#serviceResults'),
  serviceSearchHint: $('#serviceSearchHint'),
  searchSpinner: $('#searchSpinner'),
  selectedServiceCard: $('#selectedServiceCard'),
  selectedServiceCode: $('#selectedServiceCode'),
  selectedServiceText: $('#selectedServiceText'),
  selectedServiceOrigin: $('#selectedServiceOrigin'),
  changeServiceButton: $('#changeServiceButton'),
  observation: $('#observation'),
  observationCount: $('#observationCount'),
  unit: $('#unit'),
  group: $('#group'),
  referenceValue: $('#referenceValue'),
  continueToPhotosButton: $('#continueToPhotosButton'),
  continueToReviewButton: $('#continueToReviewButton'),
  submitOccurrenceButton: $('#submitOccurrenceButton'),
  photoGrid: $('#photoGrid'),
  photoProgressChip: $('#photoProgressChip'),
  reviewSummary: $('#reviewSummary'),
  mineFilters: $('#mineFilters'),
  mineList: $('#mineList'),
  refreshMineButton: $('#refreshMineButton'),
  syncConnection: $('#syncConnection'),
  syncLastTest: $('#syncLastTest'),
  syncPendingRecords: $('#syncPendingRecords'),
  syncPendingPhotos: $('#syncPendingPhotos'),
  syncPhotosSyncing: $('#syncPhotosSyncing'),
  syncErrors: $('#syncErrors'),
  lastSyncAt: $('#lastSyncAt'),
  testConnectionButton: $('#testConnectionButton'),
  syncNowButton: $('#syncNowButton'),
  syncQueueList: $('#syncQueueList'),
  refreshSupervisorButton: $('#refreshSupervisorButton'),
  supervisorList: $('#supervisorList'),
  selectAllVisible: $('#selectAllVisible'),
  selectedCountLabel: $('#selectedCountLabel'),
  approveSelectedButton: $('#approveSelectedButton'),
  approveAllButton: $('#approveAllButton'),
  approveAllFooter: $('#approveAllFooter'),
  reviewDialog: $('#reviewDialog'),
  reviewDialogTitle: $('#reviewDialogTitle'),
  reviewDialogContent: $('#reviewDialogContent'),
  requestCorrectionButton: $('#requestCorrectionButton'),
  rejectButton: $('#rejectButton'),
  approveButton: $('#approveButton'),
  decisionDialog: $('#decisionDialog'),
  decisionDialogTitle: $('#decisionDialogTitle'),
  decisionReason: $('#decisionReason'),
  decisionNote: $('#decisionNote'),
  confirmDialog: $('#confirmDialog'),
  confirmTitle: $('#confirmTitle'),
  confirmMessage: $('#confirmMessage'),
  confirmActionButton: $('#confirmActionButton'),
  confirmIcon: $('#confirmIcon'),
  photoDialog: $('#photoDialog'),
  photoDialogImage: $('#photoDialogImage'),
  photoDialogLabel: $('#photoDialogLabel'),
  toastRegion: $('#toastRegion')
};

let session = readSession();
let activeRecord = null;
let activePhotos = new Map();
let previewUrls = new Map();
let currentStep = 1;
let currentView = 'new';
let catalogResults = [];
let catalogSearchTimer = 0;
let catalogSearchRequestId = 0;
let mineRecords = [];
let mineFilter = 'all';
let supervisorRecords = [];
let selectedSupervisorIds = new Set();
let activeSupervisorRecord = null;
let syncRunning = false;
let deferredInstallPrompt = null;
let supervisorRefreshTimer = 0;

function readSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!value?.token || tokenExpiry(value.token) <= Date.now()) return null;
    return value;
  } catch { return null; }
}

function persistSession(value) {
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function toast(message, tone = 'default', duration = 3600) {
  const item = document.createElement('div');
  item.className = `toast${tone === 'error' ? ' toast--error' : tone === 'success' ? ' toast--success' : ''}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  setTimeout(() => item.remove(), duration);
}

function setBusy(button, busy, label = 'Aguarde…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
  }
}

function updateNetworkUi() {
  const online = navigator.onLine;
  elements.loginNetworkDot.classList.toggle('is-online', online);
  elements.loginNetworkDot.classList.toggle('is-offline', !online);
  elements.loginNetworkText.textContent = online ? 'Online' : 'Offline';
  elements.networkBadge.classList.toggle('is-online', online);
  elements.networkBadge.classList.toggle('is-offline', !online);
  $('.network-dot', elements.networkBadge)?.classList.toggle('is-online', online);
  $('.network-dot', elements.networkBadge)?.classList.toggle('is-offline', !online);
  $('span:last-child', elements.networkBadge).textContent = online ? 'Online' : 'Offline';
  elements.syncConnection.textContent = online ? 'Online' : 'Offline';
}

async function initialize() {
  await openDatabase();
  bindEvents();
  renderPhotoGrid();
  updateNetworkUi();
  elements.loginUser.value = localStorage.getItem(LAST_USER_KEY) || '';
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
  }
  if (session) await enterApplication();
  else showLogin();
  await updateQueueUi();
}

function bindEvents() {
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutButton.addEventListener('click', logout);
  elements.mainNav.addEventListener('click', (event) => {
    const target = event.target.closest('[data-nav]');
    if (target) navigate(target.dataset.nav);
  });
  $$('[data-nav].brand-lockup').forEach((button) => button.addEventListener('click', () => {
    navigate(session?.role === 'supervisor' ? 'supervisor' : button.dataset.nav);
  }));
  elements.serviceSearch.addEventListener('input', handleCatalogInput);
  elements.serviceSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') elements.serviceResults.hidden = true;
  });
  elements.serviceResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-catalog-index]');
    if (button) selectCatalogItem(catalogResults[Number(button.dataset.catalogIndex)]);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.catalog-search')) elements.serviceResults.hidden = true;
  });
  elements.changeServiceButton.addEventListener('click', clearSelectedService);
  elements.observation.addEventListener('input', async () => {
    elements.observationCount.textContent = elements.observation.value.length;
    if (activeRecord) {
      activeRecord.observation = elements.observation.value;
      await saveActiveDraft();
    }
    validateStepOne();
  });
  elements.continueToPhotosButton.addEventListener('click', () => goToStep(2));
  elements.continueToReviewButton.addEventListener('click', () => { renderReview(); goToStep(3); });
  $$('[data-back-step]').forEach((button) => button.addEventListener('click', () => goToStep(Number(button.dataset.backStep))));
  elements.submitOccurrenceButton.addEventListener('click', submitOccurrence);
  elements.photoGrid.addEventListener('click', handlePhotoGridClick);
  elements.resumeDraftButton.addEventListener('click', resumeDraft);
  elements.discardDraftButton.addEventListener('click', discardDraft);
  elements.refreshMineButton.addEventListener('click', () => refreshMine(true));
  elements.mineFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    mineFilter = button.dataset.filter;
    renderMineFilters();
    renderMineList();
  });
  elements.mineList.addEventListener('click', handleMineAction);
  elements.testConnectionButton.addEventListener('click', testConnection);
  elements.syncNowButton.addEventListener('click', () => syncAll(true));
  elements.syncQueueList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sync-record]');
    if (button) syncSingleRecord(button.dataset.syncRecord, true);
  });
  elements.refreshSupervisorButton.addEventListener('click', () => refreshSupervisor(true));
  elements.supervisorList.addEventListener('click', handleSupervisorListClick);
  elements.supervisorList.addEventListener('change', handleSupervisorSelection);
  elements.selectAllVisible.addEventListener('change', selectAllSupervisorVisible);
  elements.approveSelectedButton.addEventListener('click', approveSelected);
  elements.approveAllButton.addEventListener('click', approveAll);
  elements.approveButton.addEventListener('click', () => decideSupervisor('approve'));
  elements.rejectButton.addEventListener('click', () => decideSupervisor('reject'));
  elements.requestCorrectionButton.addEventListener('click', () => decideSupervisor('request_correction'));
  elements.reviewDialogContent.addEventListener('click', handleZoomClick);
  elements.reviewSummary.addEventListener('click', handleZoomClick);
  elements.photoDialog.addEventListener('click', (event) => { if (event.target === elements.photoDialog) elements.photoDialog.close(); });
  window.addEventListener('online', async () => { updateNetworkUi(); await testConnection(false); if (session?.role === 'field') syncAll(false); });
  window.addEventListener('offline', updateNetworkUi);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && session?.role === 'field') syncAll(false);
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });
}

function showLogin() {
  elements.loginView.hidden = false;
  elements.appShell.hidden = true;
  clearInterval(supervisorRefreshTimer);
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(elements.loginForm);
  const user = String(formData.get('user') || '').trim();
  const password = String(formData.get('password') || '');
  const role = String(formData.get('role') || 'field');
  elements.loginMessage.textContent = '';
  if (!navigator.onLine) {
    elements.loginMessage.textContent = 'Faça o primeiro acesso online. Depois, a fila continuará funcionando sem internet.';
    return;
  }
  setBusy(elements.loginButton, true, 'Entrando…');
  try {
    const result = await api.login(user, password, role);
    const nextSession = {
      token: result.token,
      user: result.user,
      role: result.role,
      expiresAt: tokenExpiry(result.token)
    };
    persistSession(nextSession);
    localStorage.setItem(LAST_USER_KEY, result.user);
    elements.loginPassword.value = '';
    await enterApplication();
  } catch (error) {
    elements.loginMessage.textContent = friendlyError(error);
  } finally {
    setBusy(elements.loginButton, false);
  }
}

async function enterApplication() {
  elements.loginView.hidden = true;
  elements.appShell.hidden = false;
  elements.sessionRoleLabel.textContent = session.role === 'supervisor' ? `Supervisor · ${session.user}` : `Campo · ${session.user}`;
  const fieldOnly = $$('[data-nav="new"], [data-nav="mine"]', elements.mainNav);
  fieldOnly.forEach((item) => { item.hidden = session.role === 'supervisor'; });
  elements.supervisorNav.hidden = session.role !== 'supervisor';
  if (session.role === 'supervisor') {
    navigate('supervisor');
    await refreshSupervisor(false);
    clearInterval(supervisorRefreshTimer);
    supervisorRefreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) refreshSupervisor(false);
    }, 30000);
  } else {
    navigate('new');
    await detectDraft();
    refreshMine(false);
    if (navigator.onLine) syncAll(false);
  }
  await updateQueueUi();
}

function logout() {
  persistSession(null);
  activeRecord = null;
  clearPreviewUrls();
  showLogin();
}

function navigate(view) {
  currentView = view;
  $$('.view').forEach((section) => {
    const active = section.id === `view-${view}`;
    section.hidden = !active;
    section.classList.toggle('is-active', active);
  });
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.nav === view));
  if (view === 'mine') refreshMine(false);
  if (view === 'sync') updateQueueUi();
  if (view === 'supervisor') refreshSupervisor(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function blankRecord() {
  const now = new Date().toISOString();
  return {
    recordId: generateUuid(),
    status: RECORD_STATUS.DRAFT,
    serverStatus: '',
    serverConfirmed: false,
    step: 1,
    code: '',
    catalogText: '',
    catalogKey: '',
    origin: '',
    observation: '',
    unit: '',
    group: '',
    referenceValue: 0,
    photoStates: Array.from({ length: 5 }, (_, index) => ({
      photoIndex: index + 1,
      confirmed: false,
      localReady: false,
      serverUrl: '',
      uploadKey: '',
      replacePending: false
    })),
    correctionMode: false,
    attempts: 0,
    lastError: '',
    createdAt: now,
    updatedAt: now,
    user: session?.user || ''
  };
}

async function ensureActiveRecord() {
  if (activeRecord) return activeRecord;
  activeRecord = blankRecord();
  await putRecord(activeRecord);
  await setMeta(ACTIVE_DRAFT_META, activeRecord.recordId);
  showDraftId();
  return activeRecord;
}

async function saveActiveDraft() {
  if (!activeRecord) return;
  activeRecord.step = currentStep;
  activeRecord.updatedAt = new Date().toISOString();
  activeRecord.user = session?.user || activeRecord.user;
  await putRecord(activeRecord);
  await setMeta(ACTIVE_DRAFT_META, activeRecord.recordId);
  showDraftId();
}

function showDraftId() {
  elements.draftIdBadge.hidden = !activeRecord?.recordId;
  if (activeRecord?.recordId) elements.draftIdBadge.textContent = `ID ${activeRecord.recordId}`;
}

async function detectDraft() {
  const recordId = await getMeta(ACTIVE_DRAFT_META);
  if (!recordId) { elements.resumeBanner.hidden = true; return; }
  const record = await getRecord(recordId);
  if (!record || record.status !== RECORD_STATUS.DRAFT) {
    await setMeta(ACTIVE_DRAFT_META, null);
    elements.resumeBanner.hidden = true;
    return;
  }
  elements.resumeBanner.hidden = false;
  elements.resumeBannerText.textContent = record.code ? `${record.code} · atualizado em ${formatDateTime(record.updatedAt)}` : `Atualizado em ${formatDateTime(record.updatedAt)}`;
}

async function resumeDraft() {
  const recordId = await getMeta(ACTIVE_DRAFT_META);
  const record = recordId ? await getRecord(recordId) : null;
  if (!record) return;
  await loadRecordIntoForm(record);
  elements.resumeBanner.hidden = true;
  navigate('new');
}

async function discardDraft() {
  const recordId = await getMeta(ACTIVE_DRAFT_META);
  if (!recordId) return;
  if (!await confirmAction('Descartar rascunho?', 'O rascunho e as fotos guardadas somente neste aparelho serão removidos.', 'Descartar', 'danger')) return;
  await deleteRecord(recordId);
  await setMeta(ACTIVE_DRAFT_META, null);
  elements.resumeBanner.hidden = true;
  if (activeRecord?.recordId === recordId) resetForm();
  toast('Rascunho descartado.');
}

function goToStep(step) {
  currentStep = step;
  $$('[data-step-panel]').forEach((panel) => { panel.hidden = Number(panel.dataset.stepPanel) !== step; });
  $$('[data-step-indicator]').forEach((indicator) => {
    const number = Number(indicator.dataset.stepIndicator);
    indicator.classList.toggle('is-active', number === step);
    indicator.classList.toggle('is-complete', number < step);
  });
  if (activeRecord) saveActiveDraft();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleCatalogInput() {
  const query = elements.serviceSearch.value.toUpperCase().replace(/\s+/g, '');
  elements.serviceSearch.value = query;
  if (query) await ensureActiveRecord();
  clearTimeout(catalogSearchTimer);
  const requestId = ++catalogSearchRequestId;
  if (query.length < 2) {
    elements.searchSpinner.hidden = true;
    elements.serviceResults.hidden = true;
    elements.serviceSearchHint.textContent = 'Digite pelo menos 2 caracteres. Resultados idênticos entre bases serão agrupados.';
    return;
  }
  catalogSearchTimer = setTimeout(() => searchCatalog(query, requestId), 320);
}

async function searchCatalog(query, requestId) {
  elements.searchSpinner.hidden = false;
  elements.serviceSearchHint.textContent = navigator.onLine ? 'Pesquisando no Caderno de Serviços…' : 'Sem internet: pesquisando itens já consultados neste aparelho.';
  try {
    const results = navigator.onLine
      ? (await api.searchCatalog(session.token, query, 30)).results
      : await searchCachedCatalog(query, 30);
    if (requestId !== catalogSearchRequestId || elements.serviceSearch.value !== query) return;
    catalogResults = results || [];
    if (navigator.onLine) await cacheCatalogResults(catalogResults);
    if (requestId !== catalogSearchRequestId || elements.serviceSearch.value !== query) return;
    renderCatalogResults();
  } catch (error) {
    const cached = await searchCachedCatalog(query, 30);
    if (requestId !== catalogSearchRequestId || elements.serviceSearch.value !== query) return;
    catalogResults = cached;
    renderCatalogResults(error);
  } finally {
    if (requestId === catalogSearchRequestId) elements.searchSpinner.hidden = true;
  }
}

function renderCatalogResults(error = null) {
  elements.serviceResults.hidden = false;
  if (!catalogResults.length) {
    elements.serviceResults.innerHTML = `<div class="search-empty">${escapeHtml(error ? 'Não foi possível consultar o servidor e não há resultado salvo neste aparelho.' : 'Nenhum Código de Serviço encontrado.')}</div>`;
    elements.serviceSearchHint.textContent = error ? friendlyError(error) : 'Revise o código pesquisado.';
    return;
  }
  elements.serviceResults.innerHTML = catalogResults.map((item, index) => `
    <button class="search-result" type="button" role="option" data-catalog-index="${index}">
      <span class="search-result__top"><strong>${escapeHtml(item.code)}</strong><small>${escapeHtml(item.origin)}</small></span>
      <span>${escapeHtml(item.catalogText || 'Sem texto breve')}</span>
      <span class="search-result__meta">
        <b>${escapeHtml(item.unit || '—')}</b><span>${escapeHtml(item.group || '—')}</span><span>${escapeHtml(formatCurrency(item.referenceValue))}</span>
      </span>
    </button>`).join('');
  elements.serviceSearchHint.textContent = `${catalogResults.length} resultado(s). Toque no registro correto.`;
}

async function selectCatalogItem(item) {
  if (!item) return;
  await ensureActiveRecord();
  activeRecord.code = item.code;
  activeRecord.catalogText = item.catalogText || '';
  activeRecord.catalogKey = item.catalogKey || item.catalogKeys?.[0] || '';
  activeRecord.origin = item.origin || item.origins?.join(' | ') || '';
  activeRecord.observation = item.catalogText || '';
  activeRecord.unit = item.unit || '';
  activeRecord.group = item.group || '';
  activeRecord.referenceValue = Number(item.referenceValue) || 0;
  elements.serviceResults.hidden = true;
  applySelectedService();
  await saveActiveDraft();
  validateStepOne();
}

function applySelectedService() {
  const selected = Boolean(activeRecord?.code && activeRecord?.catalogKey);
  elements.selectedServiceCard.hidden = !selected;
  elements.serviceSearch.hidden = selected;
  if (!selected) return;
  elements.selectedServiceCode.textContent = activeRecord.code;
  elements.selectedServiceText.textContent = activeRecord.catalogText || activeRecord.observation;
  elements.selectedServiceOrigin.textContent = `Origem: ${activeRecord.origin}`;
  elements.observation.disabled = false;
  elements.observation.value = activeRecord.observation || '';
  elements.observationCount.textContent = elements.observation.value.length;
  elements.unit.value = activeRecord.unit || '';
  elements.group.value = activeRecord.group || '';
  elements.referenceValue.value = formatCurrency(activeRecord.referenceValue);
}

async function clearSelectedService() {
  if (!activeRecord) return;
  catalogSearchRequestId += 1;
  clearTimeout(catalogSearchTimer);
  Object.assign(activeRecord, { code: '', catalogText: '', catalogKey: '', origin: '', observation: '', unit: '', group: '', referenceValue: 0 });
  elements.serviceSearch.hidden = false;
  elements.serviceSearch.value = '';
  elements.selectedServiceCard.hidden = true;
  elements.observation.value = '';
  elements.observation.disabled = true;
  elements.observationCount.textContent = '0';
  elements.unit.value = '';
  elements.group.value = '';
  elements.referenceValue.value = '';
  validateStepOne();
  await saveActiveDraft();
  elements.serviceSearch.focus();
}

function validateStepOne() {
  const valid = Boolean(activeRecord?.code && activeRecord?.catalogKey && elements.observation.value.trim() && activeRecord.unit && activeRecord.group);
  elements.continueToPhotosButton.disabled = !valid;
  return valid;
}

function renderPhotoGrid() {
  elements.photoGrid.innerHTML = Array.from({ length: 5 }, (_, offset) => {
    const index = offset + 1;
    return `<article class="photo-card" data-photo-card="${index}">
      <div class="photo-card__header"><strong>Foto ${index}</strong><span class="status-chip status-chip--neutral" data-photo-status="${index}">Pendente</span></div>
      <div class="photo-card__preview" data-photo-preview="${index}">
        <div class="photo-card__placeholder"><span aria-hidden="true">▧</span><span>Nenhuma evidência</span></div>
      </div>
      <div class="photo-card__actions">
        <button class="button button--primary" type="button" data-photo-take="${index}">Tirar foto</button>
        <button class="button button--ghost" type="button" data-photo-attach="${index}">Anexar foto</button>
      </div>
      <div class="photo-card__secondary" data-photo-secondary="${index}" hidden>
        <button type="button" data-photo-replace="${index}">Substituir</button>
        <button class="delete-photo" type="button" data-photo-delete="${index}">Excluir</button>
      </div>
    </article>`;
  }).join('');
  updatePhotoGrid();
}

async function handlePhotoGridClick(event) {
  const take = event.target.closest('[data-photo-take]');
  const attach = event.target.closest('[data-photo-attach]');
  const replace = event.target.closest('[data-photo-replace]');
  const remove = event.target.closest('[data-photo-delete]');
  const preview = event.target.closest('[data-photo-preview] img');
  if (take) return choosePhoto(Number(take.dataset.photoTake), true);
  if (attach) return choosePhoto(Number(attach.dataset.photoAttach), false);
  if (replace) return choosePhoto(Number(replace.dataset.photoReplace), false, true);
  if (remove) return removePhoto(Number(remove.dataset.photoDelete));
  if (preview) openPhoto(preview.src, preview.alt);
}

function choosePhoto(photoIndex, capture, replace = false) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
  if (capture) input.setAttribute('capture', 'environment');
  input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (file) await storeSelectedPhoto(photoIndex, file, replace);
  }, { once: true });
  document.body.append(input);
  input.click();
}

async function storeSelectedPhoto(photoIndex, file, replace) {
  try {
    await ensureActiveRecord();
    const blob = await optimizePhoto(file);
    if (blob.size > 9 * 1024 * 1024) throw new Error('A foto ficou acima de 9 MB mesmo após a otimização.');
    const uploadKey = generateUuid();
    const state = activeRecord.photoStates[photoIndex - 1] || { photoIndex };
    const replacePending = replace || Boolean(state.confirmed || state.serverUrl);
    activeRecord.photoStates[photoIndex - 1] = {
      ...state,
      photoIndex,
      confirmed: false,
      localReady: true,
      uploadKey,
      replacePending,
      error: ''
    };
    await putPhoto(activeRecord.recordId, photoIndex, blob, uploadKey, { fileName: file.name, mimeType: blob.type });
    activePhotos.set(photoIndex, { blob, uploadKey });
    setPreviewUrl(photoIndex, URL.createObjectURL(blob));
    await saveActiveDraft();
    updatePhotoGrid();
  } catch (error) {
    toast(error.message || 'Não foi possível preparar a foto.', 'error');
  }
}

async function optimizePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = sourceUrl;
    await image.decode();
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    return blob || file;
  } catch {
    if (file.size <= 9 * 1024 * 1024) return file;
    throw new Error('Este formato não pôde ser otimizado neste aparelho. Use JPG ou PNG.');
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function removePhoto(photoIndex) {
  const state = activeRecord?.photoStates?.[photoIndex - 1];
  if (!state) return;
  if (state.confirmed && !state.replacePending) {
    toast('Uma foto já confirmada no servidor pode ser substituída, mas não removida isoladamente.', 'error');
    return;
  }
  await deletePhoto(activeRecord.recordId, photoIndex);
  activePhotos.delete(photoIndex);
  revokePreviewUrl(photoIndex);
  activeRecord.photoStates[photoIndex - 1] = {
    photoIndex,
    confirmed: Boolean(state.serverUrl),
    localReady: false,
    serverUrl: state.serverUrl || '',
    uploadKey: '',
    replacePending: false
  };
  await saveActiveDraft();
  updatePhotoGrid();
}

function setPreviewUrl(index, url) {
  revokePreviewUrl(index);
  previewUrls.set(index, url);
}

function revokePreviewUrl(index) {
  const current = previewUrls.get(index);
  if (current?.startsWith('blob:')) URL.revokeObjectURL(current);
  previewUrls.delete(index);
}

function clearPreviewUrls() {
  for (const index of previewUrls.keys()) revokePreviewUrl(index);
  activePhotos.clear();
}

function updatePhotoGrid() {
  let ready = 0;
  for (let index = 1; index <= 5; index += 1) {
    const state = activeRecord?.photoStates?.[index - 1] || {};
    const local = Boolean(state.localReady) || activePhotos.has(index) || previewUrls.has(index) && previewUrls.get(index).startsWith('blob:');
    const url = previewUrls.get(index) || state.serverUrl || '';
    const present = local || Boolean(url) || state.confirmed;
    if (present) ready += 1;
    const card = $(`[data-photo-card="${index}"]`);
    const preview = $(`[data-photo-preview="${index}"]`);
    const status = $(`[data-photo-status="${index}"]`);
    const secondary = $(`[data-photo-secondary="${index}"]`);
    card?.classList.toggle('has-photo', present);
    if (preview) preview.innerHTML = url
      ? `<img src="${escapeHtml(url)}" alt="Foto ${index}" />`
      : `<div class="photo-card__placeholder"><span aria-hidden="true">▧</span><span>Nenhuma evidência</span></div>`;
    if (status) {
      status.textContent = state.confirmed && !state.replacePending ? 'Confirmada' : present ? 'Pronta' : 'Pendente';
      status.className = `status-chip ${state.confirmed && !state.replacePending ? 'status-chip--success' : present ? 'status-chip--info' : 'status-chip--neutral'}`;
    }
    if (secondary) {
      secondary.hidden = !present;
      const deleteButton = $('[data-photo-delete]', secondary);
      if (deleteButton) deleteButton.hidden = Boolean(state.confirmed && !state.replacePending && !local);
    }
  }
  elements.photoProgressChip.textContent = `${ready}/5 fotos`;
  elements.photoProgressChip.className = `status-chip ${ready === 5 ? 'status-chip--success' : 'status-chip--warning'}`;
  elements.continueToReviewButton.disabled = ready !== 5;
}

function renderReview() {
  if (!activeRecord) return;
  const photos = Array.from({ length: 5 }, (_, offset) => {
    const index = offset + 1;
    const url = previewUrls.get(index) || activeRecord.photoStates[index - 1]?.serverUrl || '';
    return `<figure class="review-photo"><img src="${escapeHtml(url)}" alt="Foto ${index}" data-zoom-src="${escapeHtml(url)}" data-zoom-label="Foto ${index}" /><span>Foto ${index}</span></figure>`;
  }).join('');
  elements.reviewSummary.innerHTML = `
    <dl class="review-data">
      <div class="review-data__grid">
        <div><dt>Código de Serviço</dt><dd>${escapeHtml(activeRecord.code)}</dd></div>
        <div><dt>Unidade</dt><dd>${escapeHtml(activeRecord.unit)}</dd></div>
        <div><dt>Grupo</dt><dd>${escapeHtml(activeRecord.group)}</dd></div>
        <div><dt>Valor Referência Único</dt><dd>${escapeHtml(formatCurrency(activeRecord.referenceValue))}</dd></div>
      </div>
      <div><dt>Observação</dt><dd>${escapeHtml(activeRecord.observation)}</dd></div>
      <div><dt>Origem do serviço</dt><dd>${escapeHtml(activeRecord.origin)}</dd></div>
    </dl>
    <div class="review-photos">${photos}</div>`;
}

async function submitOccurrence() {
  if (!activeRecord || !validateStepOne() || countReadyPhotos() !== 5) {
    toast('Complete os dados e as cinco fotos antes de enviar.', 'error');
    return;
  }
  if (!await confirmAction('Enviar para conferência?', 'Deseja enviar esta ocorrência para conferência do supervisor?', 'Enviar', 'success')) return;
  activeRecord.observation = elements.observation.value.trim();
  activeRecord.status = RECORD_STATUS.PENDING;
  activeRecord.lastError = '';
  await putRecord(activeRecord);
  await setMeta(ACTIVE_DRAFT_META, null);
  const submittedId = activeRecord.recordId;
  setBusy(elements.submitOccurrenceButton, true, 'Enviando…');
  try {
    const result = await syncSingleRecord(submittedId, false);
    if (result?.status === RECORD_STATUS.WAITING_SUPERVISOR || result?.status === RECORD_STATUS.PUBLISHED) {
      toast('Ocorrência enviada para conferência.', 'success');
    } else {
      toast('Ocorrência guardada na fila. A sincronização continuará automaticamente.');
    }
  } finally {
    setBusy(elements.submitOccurrenceButton, false);
    resetForm();
    navigate('mine');
  }
}

function countReadyPhotos() {
  return countReadyPhotoStates(activeRecord);
}

async function syncSingleRecord(recordId, notify = true) {
  const record = await getRecord(recordId);
  if (!record || !session || session.role !== 'field') return null;
  if (!navigator.onLine) {
    record.status = RECORD_STATUS.PENDING;
    record.lastError = 'Sem internet';
    await putRecord(record);
    await updateQueueUi();
    if (notify) toast('Sem internet. O registro continua guardado neste aparelho.');
    return record;
  }
  let next = { ...record, attempts: (record.attempts || 0) + 1, lastAttemptAt: new Date().toISOString(), lastError: '' };
  try {
    if (next.serverConfirmed || next.attempts > 1) {
      try {
        const serverState = await api.getRecordState(session.token, next.recordId);
        next = reconcilePhotoStates(next, serverState);
        await putRecord(next);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'RECORD_NOT_FOUND') throw error;
      }
    }

    next.status = RECORD_STATUS.SYNCING_DATA;
    await putRecord(next);
    const dataResult = await api.submitRecord(session.token, {
      recordId: next.recordId,
      code: next.code,
      observation: next.observation,
      unit: next.unit,
      group: next.group,
      referenceValue: next.referenceValue,
      origin: next.origin,
      catalogKey: next.catalogKey
    }, APP_VERSION);
    next = reconcilePhotoStates(next, dataResult);
    next.status = RECORD_STATUS.SYNCING_PHOTOS;
    await putRecord(next);

    const reconciled = await api.getRecordState(session.token, next.recordId);
    next = reconcilePhotoStates(next, reconciled);
    await putRecord(next);

    for (let index = 1; index <= 5; index += 1) {
      const state = next.photoStates[index - 1] || {};
      if (state.confirmed && !state.replacePending) {
        await deletePhoto(next.recordId, index).catch(() => {});
        continue;
      }
      const localPhoto = await getPhoto(next.recordId, index);
      if (!localPhoto?.blob) throw new ApiError(`A Foto ${index} não está disponível neste aparelho.`, 'LOCAL_PHOTO_MISSING');
      const dataUrl = await blobToDataUrl(localPhoto.blob);
      const photoResult = await api.uploadPhoto(session.token, { ...localPhoto, dataUrl }, { replace: Boolean(state.replacePending) });
      next = reconcilePhotoStates(next, photoResult);
      next.photoStates[index - 1].replacePending = false;
      next.status = photoResult.status || RECORD_STATUS.SYNCING_PHOTOS;
      next.lastError = '';
      await putRecord(next);
      if (photoResult.photoStates?.find((item) => item.photoIndex === index)?.confirmed) {
        await deletePhoto(next.recordId, index);
      }
      await updateQueueUi();
    }

    const finalState = await api.getRecordState(session.token, next.recordId);
    next = reconcilePhotoStates(next, finalState);
    next.status = finalState.status || RECORD_STATUS.WAITING_SUPERVISOR;
    next.lastError = '';
    next.syncedAt = new Date().toISOString();
    await putRecord(next);
    await setMeta(LAST_SYNC_META, next.syncedAt);
    if (notify) toast(statusLabel(next.status, next.photoCount), 'success');
    return next;
  } catch (error) {
    next.status = RECORD_STATUS.ERROR;
    next.lastError = friendlyError(error);
    await putRecord(next);
    if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') logout();
    if (notify) toast(next.lastError, 'error', 5200);
    return next;
  } finally {
    await updateQueueUi();
    if (currentView === 'mine') refreshMine(false);
  }
}

async function syncAll(notify = false) {
  if (syncRunning || !session || session.role !== 'field') return;
  syncRunning = true;
  setBusy(elements.syncNowButton, true, 'Sincronizando…');
  try {
    const records = await getAllRecords();
    const queue = records.filter((record) => SYNCABLE_STATUSES.has(record.status));
    for (const record of queue) await syncSingleRecord(record.recordId, false);
    if (notify) toast(queue.length ? 'Fila verificada e atualizada.' : 'Nenhum registro pendente.', 'success');
  } finally {
    syncRunning = false;
    setBusy(elements.syncNowButton, false);
    await updateQueueUi();
  }
}

async function updateQueueUi() {
  const summary = await getQueueSummary();
  elements.syncPendingRecords.textContent = summary.pendingRecords.length;
  elements.syncPendingPhotos.textContent = summary.pendingPhotos;
  elements.syncPhotosSyncing.textContent = summary.syncingPhotos;
  elements.syncErrors.textContent = summary.errors;
  elements.syncNavCount.hidden = !summary.pendingRecords.length;
  elements.syncNavCount.textContent = summary.pendingRecords.length;
  const lastSync = await getMeta(LAST_SYNC_META);
  elements.lastSyncAt.textContent = lastSync ? formatDateTime(lastSync) : 'Nenhuma sincronização concluída.';
  renderSyncQueue(summary.pendingRecords);
}

function renderSyncQueue(records) {
  if (!records.length) {
    elements.syncQueueList.innerHTML = emptyState('Fila em dia', 'Não há registros ou fotos aguardando envio.');
    return;
  }
  elements.syncQueueList.innerHTML = records.map((record) => recordCard(record, `
    <button class="button button--ghost button--small" type="button" data-sync-record="${escapeHtml(record.recordId)}">Tentar novamente</button>`)).join('');
}

async function testConnection(notify = true) {
  elements.syncLastTest.textContent = 'Testando…';
  setBusy(elements.testConnectionButton, true, 'Testando…');
  try {
    const result = await healthCheck();
    elements.syncLastTest.textContent = `Servidor ${result.version} · ${formatDateTime(result.timestamp)}`;
    if (notify) toast('Conexão com o servidor confirmada.', 'success');
    return true;
  } catch (error) {
    elements.syncLastTest.textContent = friendlyError(error);
    if (notify) toast(friendlyError(error), 'error');
    return false;
  } finally {
    setBusy(elements.testConnectionButton, false);
  }
}

async function refreshMine(notify = false) {
  if (!session || session.role !== 'field') return;
  setBusy(elements.refreshMineButton, true, 'Atualizando…');
  try {
    const localRecords = await getAllRecords();
    let serverRecords = [];
    if (navigator.onLine && endpointConfigured()) {
      try { serverRecords = (await api.listMine(session.token)).records || []; }
      catch (error) { if (notify) toast(friendlyError(error), 'error'); }
    }
    mineRecords = mergeRecordCollections(localRecords, serverRecords);
    renderMineFilters();
    renderMineList();
  } finally {
    setBusy(elements.refreshMineButton, false);
  }
}

function renderMineFilters() {
  const filters = [
    ['all', 'Todas'], ['draft', 'Rascunhos'], ['pending', 'Pendentes'], ['waiting', 'Aguardando'],
    ['correction', 'Correção'], ['approved', 'Aprovadas'], ['rejected', 'Reprovadas']
  ];
  elements.mineFilters.innerHTML = filters.map(([value, label]) => `<button class="filter-chip${mineFilter === value ? ' is-active' : ''}" type="button" data-filter="${value}">${label}</button>`).join('');
}

function renderMineList() {
  const filtered = mineRecords.filter((record) => {
    if (mineFilter === 'all') return true;
    if (mineFilter === 'draft') return record.status === RECORD_STATUS.DRAFT;
    if (mineFilter === 'pending') return SYNCABLE_STATUSES.has(record.status);
    if (mineFilter === 'waiting') return record.status === RECORD_STATUS.WAITING_SUPERVISOR;
    if (mineFilter === 'correction') return record.status === RECORD_STATUS.CORRECTION_REQUESTED;
    if (mineFilter === 'approved') return [RECORD_STATUS.APPROVED, RECORD_STATUS.PUBLISHED].includes(record.status);
    if (mineFilter === 'rejected') return record.status === RECORD_STATUS.REJECTED;
    return true;
  });
  if (!filtered.length) {
    elements.mineList.innerHTML = emptyState('Nenhuma ocorrência nesta visão', 'Quando houver registros com este status, eles aparecerão aqui.');
    return;
  }
  elements.mineList.innerHTML = filtered.map((record) => {
    let action = '';
    if (record.status === RECORD_STATUS.DRAFT) action = `<button class="button button--primary button--small" type="button" data-mine-action="continue" data-record-id="${escapeHtml(record.recordId)}">Continuar</button>`;
    else if (record.status === RECORD_STATUS.CORRECTION_REQUESTED) action = `<button class="button button--warning button--small" type="button" data-mine-action="correct" data-record-id="${escapeHtml(record.recordId)}">Corrigir</button>`;
    else if (SYNCABLE_STATUSES.has(record.status)) action = `<button class="button button--ghost button--small" type="button" data-mine-action="sync" data-record-id="${escapeHtml(record.recordId)}">Sincronizar agora</button>`;
    return recordCard(record, action);
  }).join('');
}

function recordCard(record, actionHtml = '') {
  const photoCount = Math.max(countConfirmedPhotos(record), countReadyPhotoStates(record));
  const status = record.status || record.serverStatus;
  return `<article class="record-card">
    <header class="record-card__header">
      <div><h3>${escapeHtml(record.code || 'Ocorrência sem código')}</h3><small>${escapeHtml(record.recordId || '')}</small></div>
      <span class="status-chip status-chip--${statusTone(status)}">${escapeHtml(statusLabel(status, photoCount))}</span>
    </header>
    <p>${escapeHtml(record.observation || 'Sem observação')}</p>
    <div class="record-card__body">
      <div class="record-meta"><span>Unidade</span><strong>${escapeHtml(record.unit || '—')}</strong></div>
      <div class="record-meta"><span>Grupo</span><strong>${escapeHtml(record.group || '—')}</strong></div>
      <div class="record-meta"><span>Valor</span><strong>${escapeHtml(formatCurrency(record.referenceValue))}</strong></div>
      <div class="record-meta"><span>Registrado em</span><strong>${escapeHtml(formatDateTime(record.registeredAt || record.createdAt))}</strong></div>
    </div>
    ${record.reason ? `<div class="status-chip status-chip--warning">Motivo: ${escapeHtml(record.reason)}</div>` : ''}
    ${record.lastError ? `<div class="status-chip status-chip--danger">${escapeHtml(record.lastError)}</div>` : ''}
    <div class="record-progress"><span style="width:${Math.min(100, photoCount * 20)}%"></span></div>
    <footer class="record-card__footer"><span class="photo-count">▧ ${photoCount}/5 fotos</span>${actionHtml}</footer>
  </article>`;
}

async function handleMineAction(event) {
  const button = event.target.closest('[data-mine-action]');
  if (!button) return;
  const recordId = button.dataset.recordId;
  if (button.dataset.mineAction === 'sync') return syncSingleRecord(recordId, true);
  const local = await getRecord(recordId);
  const server = mineRecords.find((item) => item.recordId === recordId);
  const record = local || server;
  if (!record) return;
  if (button.dataset.mineAction === 'correct') {
    const correction = {
      ...record,
      status: RECORD_STATUS.DRAFT,
      serverStatus: RECORD_STATUS.CORRECTION_REQUESTED,
      correctionMode: true,
      catalogKey: record.catalogKey || record.audit?.catalogKey || '',
      catalogText: record.catalogText || record.observation,
      photoStates: Array.from({ length: 5 }, (_, index) => ({
        photoIndex: index + 1,
        confirmed: Boolean(record.photos?.[index]),
        localReady: false,
        serverUrl: record.photos?.[index] || '',
        uploadKey: '',
        replacePending: false
      }))
    };
    await putRecord(correction);
    await setMeta(ACTIVE_DRAFT_META, correction.recordId);
    return loadRecordIntoForm(correction);
  }
  await setMeta(ACTIVE_DRAFT_META, record.recordId);
  await loadRecordIntoForm(record);
}

async function loadRecordIntoForm(record) {
  clearPreviewUrls();
  activeRecord = {
    ...blankRecord(),
    ...record,
    status: RECORD_STATUS.DRAFT,
    photoStates: Array.from({ length: 5 }, (_, index) => record.photoStates?.[index] || {
      photoIndex: index + 1,
      confirmed: Boolean(record.photos?.[index]),
      localReady: false,
      serverUrl: record.photos?.[index] || '',
      uploadKey: '',
      replacePending: false
    })
  };
  const photos = await getPhotosForRecord(record.recordId);
  for (const photo of photos) {
    const state = activeRecord.photoStates[photo.photoIndex - 1] || { photoIndex: photo.photoIndex };
    activeRecord.photoStates[photo.photoIndex - 1] = {
      ...state,
      localReady: true,
      uploadKey: state.uploadKey || photo.uploadKey || ''
    };
    activePhotos.set(photo.photoIndex, photo);
    setPreviewUrl(photo.photoIndex, URL.createObjectURL(photo.blob));
  }
  if (photos.length) await putRecord(activeRecord);
  elements.serviceSearch.value = activeRecord.code || '';
  applySelectedService();
  showDraftId();
  validateStepOne();
  updatePhotoGrid();
  goToStep(Math.min(3, Math.max(1, Number(activeRecord.step) || 1)));
  elements.resumeBanner.hidden = true;
  navigate('new');
}

function resetForm() {
  catalogSearchRequestId += 1;
  clearTimeout(catalogSearchTimer);
  clearPreviewUrls();
  activeRecord = null;
  currentStep = 1;
  elements.serviceSearch.hidden = false;
  elements.serviceSearch.value = '';
  elements.serviceResults.hidden = true;
  elements.selectedServiceCard.hidden = true;
  elements.observation.value = '';
  elements.observation.disabled = true;
  elements.observationCount.textContent = '0';
  elements.unit.value = '';
  elements.group.value = '';
  elements.referenceValue.value = '';
  elements.draftIdBadge.hidden = true;
  renderPhotoGrid();
  validateStepOne();
  goToStep(1);
}

async function refreshSupervisor(notify = false) {
  if (!session || session.role !== 'supervisor') return;
  if (!navigator.onLine) {
    if (notify) toast('O painel do supervisor precisa de conexão.', 'error');
    return;
  }
  setBusy(elements.refreshSupervisorButton, true, 'Atualizando…');
  try {
    supervisorRecords = (await api.listPending(session.token)).records || [];
    selectedSupervisorIds = new Set([...selectedSupervisorIds].filter((id) => supervisorRecords.some((record) => record.recordId === id)));
    renderSupervisorList();
    if (notify) toast('Painel atualizado.', 'success');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') logout();
    else if (notify) toast(friendlyError(error), 'error');
    renderSupervisorList(error);
  } finally {
    setBusy(elements.refreshSupervisorButton, false);
  }
}

function renderSupervisorList(error = null) {
  elements.supervisorNavCount.hidden = !supervisorRecords.length;
  elements.supervisorNavCount.textContent = supervisorRecords.length;
  elements.approveAllFooter.hidden = !supervisorRecords.length;
  if (!supervisorRecords.length) {
    elements.supervisorList.innerHTML = emptyState(error ? 'Não foi possível carregar' : 'Nenhuma ocorrência aguardando', error ? friendlyError(error) : 'As ocorrências completas aparecerão aqui para conferência.');
    updateSupervisorSelectionUi();
    return;
  }
  elements.supervisorList.innerHTML = supervisorRecords.map((record) => {
    const checked = selectedSupervisorIds.has(record.recordId);
    const thumbs = (record.photos || []).map((url, index) => `<button type="button" data-zoom-src="${escapeHtml(url)}" data-zoom-label="Foto ${index + 1}"><img src="${escapeHtml(url)}" alt="Foto ${index + 1}" /></button>`).join('');
    return `<article class="record-card supervisor-card">
      <input type="checkbox" aria-label="Selecionar ${escapeHtml(record.code)}" data-supervisor-select="${escapeHtml(record.recordId)}" ${checked ? 'checked' : ''} />
      <div class="supervisor-card__content">
        <header class="record-card__header"><div><h3>${escapeHtml(record.code)}</h3><small>${escapeHtml(record.recordId)}</small></div><span class="status-chip status-chip--warning">${record.photoCount}/5 fotos</span></header>
        <p>${escapeHtml(record.observation)}</p>
        <div class="record-card__body">
          <div class="record-meta"><span>Grupo</span><strong>${escapeHtml(record.group)}</strong></div>
          <div class="record-meta"><span>Unidade</span><strong>${escapeHtml(record.unit)}</strong></div>
          <div class="record-meta"><span>Valor</span><strong>${escapeHtml(formatCurrency(record.referenceValue))}</strong></div>
          <div class="record-meta"><span>Registrado em</span><strong>${escapeHtml(formatDateTime(record.registeredAt))}</strong></div>
        </div>
        <div class="supervisor-thumbs">${thumbs}</div>
        <footer class="record-card__footer"><span class="photo-count">Origem: ${escapeHtml(record.origin)}</span><button class="button button--primary button--small" type="button" data-review-record="${escapeHtml(record.recordId)}">Conferir ocorrência</button></footer>
      </div>
    </article>`;
  }).join('');
  updateSupervisorSelectionUi();
}

function handleSupervisorListClick(event) {
  const review = event.target.closest('[data-review-record]');
  const zoom = event.target.closest('[data-zoom-src]');
  if (zoom) return openPhoto(zoom.dataset.zoomSrc, zoom.dataset.zoomLabel);
  if (review) openSupervisorReview(review.dataset.reviewRecord);
}

function handleSupervisorSelection(event) {
  const checkbox = event.target.closest('[data-supervisor-select]');
  if (!checkbox) return;
  if (checkbox.checked) selectedSupervisorIds.add(checkbox.dataset.supervisorSelect);
  else selectedSupervisorIds.delete(checkbox.dataset.supervisorSelect);
  updateSupervisorSelectionUi();
}

function selectAllSupervisorVisible() {
  if (elements.selectAllVisible.checked) supervisorRecords.forEach((record) => selectedSupervisorIds.add(record.recordId));
  else selectedSupervisorIds.clear();
  $$('[data-supervisor-select]').forEach((checkbox) => { checkbox.checked = selectedSupervisorIds.has(checkbox.dataset.supervisorSelect); });
  updateSupervisorSelectionUi();
}

function updateSupervisorSelectionUi() {
  const count = selectedSupervisorIds.size;
  elements.selectedCountLabel.textContent = `${count} ${count === 1 ? 'ocorrência selecionada' : 'ocorrências selecionadas'}`;
  elements.approveSelectedButton.disabled = !count;
  elements.selectAllVisible.checked = Boolean(supervisorRecords.length && count === supervisorRecords.length);
  elements.selectAllVisible.indeterminate = count > 0 && count < supervisorRecords.length;
}

function openSupervisorReview(recordId) {
  activeSupervisorRecord = supervisorRecords.find((record) => record.recordId === recordId);
  if (!activeSupervisorRecord) return;
  elements.reviewDialogTitle.textContent = `${activeSupervisorRecord.code} · ${activeSupervisorRecord.photoCount}/5 fotos`;
  elements.reviewDialogContent.innerHTML = detailedRecord(activeSupervisorRecord);
  elements.reviewDialog.showModal();
}

function detailedRecord(record) {
  const photos = (record.photos || []).map((url, index) => `<figure class="review-photo"><img src="${escapeHtml(url)}" alt="Foto ${index + 1}" data-zoom-src="${escapeHtml(url)}" data-zoom-label="Foto ${index + 1}" /><span>Foto ${index + 1}</span></figure>`).join('');
  return `<dl class="review-data">
    <div class="review-data__grid">
      <div><dt>Código</dt><dd>${escapeHtml(record.code)}</dd></div><div><dt>Unidade</dt><dd>${escapeHtml(record.unit)}</dd></div>
      <div><dt>Grupo</dt><dd>${escapeHtml(record.group)}</dd></div><div><dt>Valor</dt><dd>${escapeHtml(formatCurrency(record.referenceValue))}</dd></div>
      <div><dt>Registrado em</dt><dd>${escapeHtml(formatDateTime(record.registeredAt))}</dd></div><div><dt>Origem</dt><dd>${escapeHtml(record.origin)}</dd></div>
    </div><div><dt>Observação</dt><dd>${escapeHtml(record.observation)}</dd></div>
  </dl><div class="review-photos">${photos}</div>`;
}

async function decideSupervisor(decision) {
  if (!activeSupervisorRecord) return;
  let reason = '';
  let note = '';
  if (decision === 'approve') {
    if (!await confirmAction('Aprovar e publicar?', `A ocorrência ${activeSupervisorRecord.code} será publicada na aba oficial.`, 'Aprovar e publicar', 'success')) return;
  } else {
    const values = await collectDecision(decision);
    if (!values) return;
    ({ reason, note } = values);
    const label = decision === 'reject' ? 'reprovar' : 'solicitar correção para';
    if (!await confirmAction('Confirmar decisão?', `Deseja ${label} a ocorrência ${activeSupervisorRecord.code}?`, 'Confirmar', decision === 'reject' ? 'danger' : 'warning')) return;
  }
  setBusy(decision === 'approve' ? elements.approveButton : decision === 'reject' ? elements.rejectButton : elements.requestCorrectionButton, true, 'Salvando…');
  try {
    await api.supervisorAction(session.token, decision, activeSupervisorRecord.recordId, reason, note);
    elements.reviewDialog.close();
    toast(decision === 'approve' ? 'Ocorrência aprovada e publicada.' : decision === 'reject' ? 'Ocorrência reprovada.' : 'Correção solicitada.', 'success');
    await refreshSupervisor(false);
  } catch (error) {
    toast(friendlyError(error), 'error');
  } finally {
    setBusy(elements.approveButton, false);
    setBusy(elements.rejectButton, false);
    setBusy(elements.requestCorrectionButton, false);
  }
}

function collectDecision(decision) {
  elements.decisionDialogTitle.textContent = decision === 'reject' ? 'Reprovar ocorrência' : 'Solicitar correção';
  elements.decisionReason.value = '';
  elements.decisionNote.value = '';
  elements.decisionDialog.showModal();
  return new Promise((resolve) => {
    const handler = () => {
      elements.decisionDialog.removeEventListener('close', handler);
      if (elements.decisionDialog.returnValue === 'cancel') resolve(null);
      else resolve({ reason: elements.decisionReason.value.trim(), note: elements.decisionNote.value.trim() });
    };
    elements.decisionDialog.addEventListener('close', handler);
  });
}

async function approveSelected() {
  const ids = [...selectedSupervisorIds];
  if (!ids.length) return;
  if (!await confirmAction('Aprovar selecionadas?', `${ids.length} ocorrência(s) apta(s) serão publicadas. Itens inválidos serão ignorados.`, 'Aprovar selecionadas', 'success')) return;
  setBusy(elements.approveSelectedButton, true, 'Aprovando…');
  try {
    const result = await api.approveBatch(session.token, ids, false);
    toast(`${result.approvedCount} aprovada(s); ${result.skippedCount} ignorada(s).`, result.approvedCount ? 'success' : 'default');
    selectedSupervisorIds.clear();
    await refreshSupervisor(false);
  } catch (error) { toast(friendlyError(error), 'error'); }
  finally { setBusy(elements.approveSelectedButton, false); }
}

async function approveAll() {
  if (!await confirmAction('Aprovar todas?', 'Você tem certeza que deseja aprovar todas as ocorrências aptas?', 'Sim, aprovar todas', 'success')) return;
  setBusy(elements.approveAllButton, true, 'Aprovando…');
  try {
    const result = await api.approveBatch(session.token, [], true);
    toast(`${result.approvedCount} ocorrência(s) aprovada(s).`, 'success');
    selectedSupervisorIds.clear();
    await refreshSupervisor(false);
  } catch (error) { toast(friendlyError(error), 'error'); }
  finally { setBusy(elements.approveAllButton, false); }
}

function confirmAction(title, message, actionLabel = 'Confirmar', tone = 'default') {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmActionButton.textContent = actionLabel;
  elements.confirmActionButton.className = `button ${tone === 'danger' ? 'button--danger' : tone === 'success' ? 'button--success' : tone === 'warning' ? 'button--warning' : 'button--primary'}`;
  elements.confirmIcon.textContent = tone === 'danger' ? '!' : tone === 'success' ? '✓' : '?';
  elements.confirmDialog.showModal();
  return new Promise((resolve) => {
    const handler = () => {
      elements.confirmDialog.removeEventListener('close', handler);
      resolve(elements.confirmDialog.returnValue === 'confirm');
    };
    elements.confirmDialog.addEventListener('close', handler);
  });
}

function handleZoomClick(event) {
  const target = event.target.closest('[data-zoom-src]');
  if (target) openPhoto(target.dataset.zoomSrc, target.dataset.zoomLabel);
}

function openPhoto(src, label = 'Evidência') {
  if (!src) return;
  elements.photoDialogImage.src = src;
  elements.photoDialogLabel.textContent = label;
  elements.photoDialog.showModal();
}

function emptyState(title, message) {
  return `<div class="empty-state card"><span aria-hidden="true">◇</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
}

function friendlyError(error) {
  const code = error?.code;
  if (code === 'INVALID_CREDENTIALS') return 'Nome, função ou senha inválidos.';
  if (code === 'AUTH_REQUIRED') return 'Sua sessão expirou. Entre novamente.';
  if (code === 'NETWORK_ERROR') return navigator.onLine ? 'Não foi possível falar com o servidor.' : 'Sem internet. Os dados continuam guardados neste aparelho.';
  if (code === 'TIMEOUT') return 'A conexão demorou demais. A fila foi preservada para nova tentativa.';
  if (code === 'ENDPOINT_NOT_CONFIGURED') return 'A publicação do backend ainda está sendo concluída.';
  return error?.message || 'Ocorreu um erro inesperado.';
}

initialize().catch((error) => {
  elements.loginMessage.textContent = friendlyError(error);
  toast(friendlyError(error), 'error');
});
