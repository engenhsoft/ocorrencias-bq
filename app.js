import {
  APP_VERSION, TEAM_GOAL, RECORD_STATUS, countConfirmedPhotos, countReadyPhotoStates,
  dailyGoalProjection, driveFileId, escapeHtml, formatCurrency, formatDateTime, formatNumber,
  generateUuid, goalProgress, mergeRecordCollections, normalizePhotoUrl, normalizeTeamKey,
  occurrenceTotal, operationalDate, reconcilePhotoStates, serviceTotal,
  statusLabel, statusTone, tokenExpiry, validateOccurrence
} from './core.js';
import {
  cacheCatalogResults, deletePhoto, deleteRecord, getAllRecords, getMeta, getPhoto,
  getPhotosForRecord, getQueueSummary, getRecord, openDatabase, putPhoto, putRecord,
  searchCachedCatalog, setMeta
} from './db.js';
import { ApiError, api, blobToDataUrl, endpointConfigured, healthCheck } from './api.js';

const SESSION_KEY = 'ocorrencias-bq-session-v1';
const LAST_USER_KEY = 'ocorrencias-bq-last-user-v1';
const LAST_TEAM_KEY = 'ocorrencias-bq-last-team-v1';
const ACTIVE_DRAFT_META = 'activeDraftId';
const LAST_SYNC_META = 'lastSyncAt';
const TYPE_TRAFO = 'SUBSTITUIÇÃO DE TRAFO';
const SYNCABLE_STATUSES = new Set([
  RECORD_STATUS.PENDING, RECORD_STATUS.SYNCING_DATA, RECORD_STATUS.SYNCING_PHOTOS, RECORD_STATUS.ERROR
]);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  loginView: $('#loginView'), loginForm: $('#loginForm'), loginUser: $('#loginUser'),
  loginPassword: $('#loginPassword'), loginButton: $('#loginButton'), loginMessage: $('#loginMessage'),
  loginNetworkDot: $('#loginNetworkDot'), loginNetworkText: $('#loginNetworkText'), appShell: $('#appShell'),
  sessionRoleLabel: $('#sessionRoleLabel'), networkBadge: $('#networkBadge'), installButton: $('#installButton'),
  logoutButton: $('#logoutButton'), mainNav: $('#mainNav'), supervisorNav: $('#supervisorNav'),
  supervisorNavCount: $('#supervisorNavCount'), syncNavCount: $('#syncNavCount'), resumeBanner: $('#resumeBanner'),
  resumeBannerText: $('#resumeBannerText'), resumeDraftButton: $('#resumeDraftButton'),
  discardDraftButton: $('#discardDraftButton'), draftIdBadge: $('#draftIdBadge'), team: $('#team'),
  occurrenceNumber: $('#occurrenceNumber'), occurrenceTypes: $('#occurrenceTypes'), pgSection: $('#pgSection'),
  pg1: $('#pg1'), pg2: $('#pg2'), pg3: $('#pg3'), transformerSection: $('#transformerSection'),
  removedTransformerCode: $('#removedTransformerCode'), removedTransformerCia: $('#removedTransformerCia'),
  newTransformerCode: $('#newTransformerCode'), newTransformerCia: $('#newTransformerCia'),
  serviceSearch: $('#serviceSearch'), serviceResults: $('#serviceResults'), serviceSearchHint: $('#serviceSearchHint'),
  searchSpinner: $('#searchSpinner'), servicesList: $('#servicesList'), goalValue: $('#goalValue'),
  goalCard: $('#goalCard'), dailyTeamLabel: $('#dailyTeamLabel'), dailySentValue: $('#dailySentValue'),
  currentValue: $('#currentValue'), projectedValue: $('#projectedValue'), goalPercentage: $('#goalPercentage'), goalBar: $('#goalBar'),
  refreshDailyGoalButton: $('#refreshDailyGoalButton'),
  goalStatus: $('#goalStatus'), addMaterialButton: $('#addMaterialButton'), materialsList: $('#materialsList'),
  observation: $('#observation'), observationCount: $('#observationCount'), stepOneErrors: $('#stepOneErrors'),
  continueToPhotosButton: $('#continueToPhotosButton'), continueToReviewButton: $('#continueToReviewButton'),
  submitOccurrenceButton: $('#submitOccurrenceButton'), photoGrid: $('#photoGrid'), photoProgressChip: $('#photoProgressChip'),
  reviewSummary: $('#reviewSummary'), mineFilters: $('#mineFilters'), mineList: $('#mineList'), mineTeamSelect: $('#mineTeamSelect'),
  mineGoalCard: $('#mineGoalCard'), mineGoalValue: $('#mineGoalValue'), mineDailyValue: $('#mineDailyValue'),
  mineGoalPercentage: $('#mineGoalPercentage'), mineGoalBar: $('#mineGoalBar'), mineGoalStatus: $('#mineGoalStatus'),
  refreshMineButton: $('#refreshMineButton'), syncConnection: $('#syncConnection'), syncLastTest: $('#syncLastTest'),
  syncPendingRecords: $('#syncPendingRecords'), syncPendingPhotos: $('#syncPendingPhotos'),
  syncPhotosSyncing: $('#syncPhotosSyncing'), syncErrors: $('#syncErrors'), lastSyncAt: $('#lastSyncAt'),
  testConnectionButton: $('#testConnectionButton'), syncNowButton: $('#syncNowButton'),
  syncQueueList: $('#syncQueueList'), refreshSupervisorButton: $('#refreshSupervisorButton'),
  supervisorList: $('#supervisorList'), selectAllVisible: $('#selectAllVisible'),
  selectedCountLabel: $('#selectedCountLabel'), approveSelectedButton: $('#approveSelectedButton'),
  approveAllButton: $('#approveAllButton'), approveAllFooter: $('#approveAllFooter'),
  reviewDialog: $('#reviewDialog'), reviewDialogTitle: $('#reviewDialogTitle'),
  reviewDialogContent: $('#reviewDialogContent'), requestCorrectionButton: $('#requestCorrectionButton'),
  rejectButton: $('#rejectButton'), approveButton: $('#approveButton'), decisionDialog: $('#decisionDialog'),
  decisionDialogTitle: $('#decisionDialogTitle'), decisionReason: $('#decisionReason'), decisionNote: $('#decisionNote'),
  confirmDialog: $('#confirmDialog'), confirmTitle: $('#confirmTitle'), confirmMessage: $('#confirmMessage'),
  confirmActionButton: $('#confirmActionButton'), confirmIcon: $('#confirmIcon'), photoDialog: $('#photoDialog'),
  photoDialogImage: $('#photoDialogImage'), photoDialogLabel: $('#photoDialogLabel'), photoPreviousButton: $('#photoPreviousButton'),
  photoNextButton: $('#photoNextButton'), mineDetailDialog: $('#mineDetailDialog'), mineDetailTitle: $('#mineDetailTitle'),
  mineDetailContent: $('#mineDetailContent'), modeSupervisorButton: $('#modeSupervisorButton'),
  registerOccurrenceButton: $('#registerOccurrenceButton'), profileSwitchDialog: $('#profileSwitchDialog'),
  profileSwitchForm: $('#profileSwitchForm'), profileSwitchTitle: $('#profileSwitchTitle'), profileTargetLabel: $('#profileTargetLabel'),
  profileSwitchUser: $('#profileSwitchUser'), profileSwitchPassword: $('#profileSwitchPassword'),
  profileSwitchMessage: $('#profileSwitchMessage'), profileSwitchSubmit: $('#profileSwitchSubmit'), toastRegion: $('#toastRegion')
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
let mineFilter = 'today';
let mineTeam = '';
let supervisorRecords = [];
let selectedSupervisorIds = new Set();
let activeSupervisorRecord = null;
let syncRunning = false;
let deferredInstallPrompt = null;
let supervisorRefreshTimer = 0;
let dailyProduction = { team: '', date: operationalDate(), goal: TEAM_GOAL, totalSent: 0, totalExcludingRecord: 0, recordContribution: 0 };
let dailyRequestId = 0;
let dailyLoadTimer = 0;
let profileSwitchTarget = '';
let photoGallery = [];
let photoGalleryIndex = 0;

function readSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY));
    return value?.token && tokenExpiry(value.token) > Date.now() ? value : null;
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
  renderMaterials();
  renderServices();
  updateNetworkUi();
  elements.loginUser.value = localStorage.getItem(LAST_USER_KEY) || '';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
  if (session) await enterApplication(); else showLogin();
  await updateQueueUi();
}

function bindEvents() {
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutButton.addEventListener('click', logout);
  elements.mainNav.addEventListener('click', (event) => {
    const target = event.target.closest('[data-nav]');
    if (target) navigate(target.dataset.nav);
  });
  $$('[data-nav].brand-lockup').forEach((button) => button.addEventListener('click', () => navigate(session?.role === 'supervisor' ? 'supervisor' : button.dataset.nav)));
  [elements.team, elements.occurrenceNumber, elements.pg1, elements.pg2, elements.pg3,
    elements.removedTransformerCode, elements.removedTransformerCia, elements.newTransformerCode,
    elements.newTransformerCia, elements.observation].forEach((input) => input.addEventListener('input', handleFormInput));
  elements.occurrenceTypes.addEventListener('change', handleFormInput);
  elements.serviceSearch.addEventListener('input', handleCatalogInput);
  elements.serviceSearch.addEventListener('keydown', (event) => { if (event.key === 'Escape') elements.serviceResults.hidden = true; });
  elements.serviceResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-catalog-index]');
    if (button) selectCatalogItem(catalogResults[Number(button.dataset.catalogIndex)]);
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.catalog-search')) elements.serviceResults.hidden = true; });
  elements.servicesList.addEventListener('input', handleServiceChange);
  elements.servicesList.addEventListener('click', handleServiceChange);
  elements.addMaterialButton.addEventListener('click', addMaterial);
  elements.materialsList.addEventListener('input', handleMaterialChange);
  elements.materialsList.addEventListener('click', handleMaterialChange);
  elements.continueToPhotosButton.addEventListener('click', () => {
    if (validateStepOne(true)) goToStep(2);
  });
  elements.continueToReviewButton.addEventListener('click', () => { renderReview(); goToStep(3); });
  $$('[data-back-step]').forEach((button) => button.addEventListener('click', () => goToStep(Number(button.dataset.backStep))));
  elements.submitOccurrenceButton.addEventListener('click', submitOccurrence);
  elements.refreshDailyGoalButton.addEventListener('click', () => loadDailyProduction(elements.team.value, true));
  elements.photoGrid.addEventListener('click', handlePhotoGridClick);
  elements.resumeDraftButton.addEventListener('click', resumeDraft);
  elements.discardDraftButton.addEventListener('click', discardDraft);
  elements.refreshMineButton.addEventListener('click', () => refreshMine(true));
  elements.mineFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    mineFilter = button.dataset.filter;
    renderMineFilters(); renderMineList();
  });
  elements.mineList.addEventListener('click', handleMineAction);
  elements.mineTeamSelect.addEventListener('change', () => { mineTeam = elements.mineTeamSelect.value; localStorage.setItem(LAST_TEAM_KEY, mineTeam); refreshMineGoal(false); });
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
  elements.mineDetailContent.addEventListener('click', handleZoomClick);
  elements.modeSupervisorButton.addEventListener('click', () => openProfileSwitch('supervisor'));
  elements.registerOccurrenceButton.addEventListener('click', () => openProfileSwitch('field'));
  elements.profileSwitchForm.addEventListener('submit', handleProfileSwitch);
  $$('[data-close-profile-switch]').forEach((button) => button.addEventListener('click', () => elements.profileSwitchDialog.close()));
  elements.photoDialog.addEventListener('click', (event) => { if (event.target === elements.photoDialog) elements.photoDialog.close(); });
  elements.photoPreviousButton.addEventListener('click', () => movePhotoGallery(-1));
  elements.photoNextButton.addEventListener('click', () => movePhotoGallery(1));
  document.addEventListener('error', handlePhotoLoadError, true);
  window.addEventListener('online', async () => { updateNetworkUi(); await testConnection(false); if (session?.role === 'field') syncAll(false); });
  window.addEventListener('offline', updateNetworkUi);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && session?.role === 'field') { syncAll(false); loadDailyProduction(elements.team.value, false); }
    if (document.visibilityState === 'visible' && navigator.onLine && session?.role === 'supervisor') refreshSupervisor(false);
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); deferredInstallPrompt = event; elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null; elements.installButton.hidden = true;
  });
}

function showLogin() {
  elements.loginView.hidden = false; elements.appShell.hidden = true; clearInterval(supervisorRefreshTimer);
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(elements.loginForm);
  const user = String(form.get('user') || '').trim();
  const password = String(form.get('password') || '');
  const role = String(form.get('role') || 'field');
  elements.loginMessage.textContent = '';
  if (!navigator.onLine) { elements.loginMessage.textContent = 'Faça o primeiro acesso online. Depois, a fila continuará funcionando sem internet.'; return; }
  setBusy(elements.loginButton, true, 'Entrando…');
  try {
    const result = await api.login(user, password, role);
    persistSession({ token: result.token, user: result.user, role: result.role, expiresAt: tokenExpiry(result.token) });
    localStorage.setItem(LAST_USER_KEY, result.user);
    elements.loginPassword.value = '';
    await enterApplication();
  } catch (error) { elements.loginMessage.textContent = friendlyError(error); }
  finally { setBusy(elements.loginButton, false); }
}

async function enterApplication() {
  elements.loginView.hidden = true; elements.appShell.hidden = false;
  elements.sessionRoleLabel.textContent = session.role === 'supervisor' ? `Supervisor · ${session.user}` : `Campo · ${session.user}`;
  $$('[data-nav="new"], [data-nav="mine"]', elements.mainNav).forEach((item) => { item.hidden = session.role === 'supervisor'; });
  elements.supervisorNav.hidden = session.role !== 'supervisor';
  if (session.role === 'supervisor') {
    elements.resumeBanner.hidden = true;
    navigate('supervisor'); await refreshSupervisor(false);
    clearInterval(supervisorRefreshTimer);
    supervisorRefreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) refreshSupervisor(false);
    }, 30000);
  } else {
    navigate('new'); await detectDraft();
    if (!elements.team.value) elements.team.value = localStorage.getItem(LAST_TEAM_KEY) || '';
    updateGoal(); refreshMine(false); if (navigator.onLine) { syncAll(false); loadDailyProduction(elements.team.value, false); }
  }
  await updateQueueUi();
}

function openProfileSwitch(targetRole) {
  profileSwitchTarget = targetRole === 'supervisor' ? 'supervisor' : 'field';
  const supervisor = profileSwitchTarget === 'supervisor';
  elements.profileSwitchTitle.textContent = supervisor ? 'Entrar no modo Supervisor' : 'Registrar ocorrência';
  elements.profileTargetLabel.textContent = supervisor ? 'SUPERVISOR' : 'CAMPO / OPERACIONAL';
  elements.profileSwitchUser.value = session?.user || localStorage.getItem(LAST_USER_KEY) || '';
  elements.profileSwitchPassword.value = ''; elements.profileSwitchMessage.textContent = '';
  elements.profileSwitchDialog.showModal();
  setTimeout(() => (elements.profileSwitchUser.value ? elements.profileSwitchPassword : elements.profileSwitchUser).focus(), 50);
}

async function handleProfileSwitch(event) {
  event.preventDefault();
  const user = elements.profileSwitchUser.value.trim(); const password = elements.profileSwitchPassword.value;
  elements.profileSwitchMessage.textContent = '';
  if (!navigator.onLine) { elements.profileSwitchMessage.textContent = 'A troca de perfil precisa de conexão para validar a senha.'; return; }
  setBusy(elements.profileSwitchSubmit, true, 'Autenticando…');
  try {
    const result = await api.login(user, password, profileSwitchTarget);
    persistSession({ token: result.token, user: result.user, role: result.role, expiresAt: tokenExpiry(result.token) });
    localStorage.setItem(LAST_USER_KEY, result.user); elements.profileSwitchPassword.value = '';
    elements.profileSwitchDialog.close(); clearInterval(supervisorRefreshTimer); await enterApplication();
    toast(result.role === 'supervisor' ? 'Modo Supervisor autenticado.' : 'Modo operacional autenticado.', 'success');
  } catch (error) { elements.profileSwitchMessage.textContent = friendlyError(error); }
  finally { setBusy(elements.profileSwitchSubmit, false); }
}

function logout() { persistSession(null); activeRecord = null; clearPreviewUrls(); showLogin(); }

function navigate(view) {
  currentView = view;
  $$('.view').forEach((section) => { const active = section.id === `view-${view}`; section.hidden = !active; section.classList.toggle('is-active', active); });
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.nav === view));
  if (view === 'new' && session?.role === 'field') loadDailyProduction(elements.team.value, false);
  if (view === 'mine') refreshMine(false);
  if (view === 'sync') updateQueueUi();
  if (view === 'supervisor') refreshSupervisor(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function blankRecord() {
  const now = new Date().toISOString();
  return {
    recordId: generateUuid(), status: RECORD_STATUS.DRAFT, serverStatus: '', serverConfirmed: false, step: 1,
    operationalDate: operationalDate(),
    team: '', occurrenceNumber: '', occurrenceTypes: [], pg1: '', pg2: '', pg3: '',
    transformer: { removedCode: '', removedCia: '', newCode: '', newCia: '' },
    services: [], materials: [{ lineId: generateUuid(), description: '', quantity: '' }], observation: '',
    photoStates: Array.from({ length: 5 }, (_, index) => ({ photoIndex: index + 1, confirmed: false, localReady: false, serverUrl: '', uploadKey: '', replacePending: false })),
    correctionMode: false, attempts: 0, lastError: '', createdAt: now, updatedAt: now, user: session?.user || ''
  };
}

async function ensureActiveRecord() {
  if (activeRecord) return activeRecord;
  activeRecord = blankRecord(); await putRecord(activeRecord); await setMeta(ACTIVE_DRAFT_META, activeRecord.recordId); showDraftId();
  return activeRecord;
}

function selectedTypes() { return $$('input[type="checkbox"]:checked', elements.occurrenceTypes).map((input) => input.value); }

function syncFormToRecord() {
  if (!activeRecord) return;
  activeRecord.team = elements.team.value.trim();
  activeRecord.occurrenceNumber = elements.occurrenceNumber.value.trim();
  activeRecord.occurrenceTypes = selectedTypes();
  activeRecord.pg1 = elements.pg1.value.trim(); activeRecord.pg2 = elements.pg2.value.trim(); activeRecord.pg3 = elements.pg3.value.trim();
  activeRecord.transformer = {
    removedCode: elements.removedTransformerCode.value.trim(), removedCia: elements.removedTransformerCia.value.trim(),
    newCode: elements.newTransformerCode.value.trim(), newCia: elements.newTransformerCia.value.trim()
  };
  activeRecord.observation = elements.observation.value.trim();
  activeRecord.totalServices = occurrenceTotal(activeRecord.services);
  activeRecord.goalPercentage = dailyGoalProjection(dailyProduction.totalExcludingRecord, activeRecord.totalServices).percentage;
}

async function handleFormInput(event) {
  await ensureActiveRecord(); syncFormToRecord();
  elements.transformerSection.hidden = !activeRecord.occurrenceTypes.includes(TYPE_TRAFO);
  elements.observationCount.textContent = elements.observation.value.length;
  if (event?.target === elements.team) {
    localStorage.setItem(LAST_TEAM_KEY, elements.team.value.trim());
    clearTimeout(dailyLoadTimer); dailyLoadTimer = setTimeout(() => loadDailyProduction(elements.team.value, false), 520);
  }
  updateGoal();
  validateStepOne(false); await saveActiveDraft();
}

function emptyDailyProduction(team = '') {
  return { team: String(team || '').trim(), date: operationalDate(), goal: TEAM_GOAL, totalSent: 0, totalExcludingRecord: 0, recordContribution: 0, percentage: 0, status: 'ABAIXO_DA_META' };
}

function dailyCacheKey(team, date = operationalDate()) { return `dailyProduction:${date}|${normalizeTeamKey(team)}`; }

async function loadDailyProduction(teamValue, notify = false) {
  const team = String(teamValue || '').trim(); const date = operationalDate(); const requestId = ++dailyRequestId;
  if (!team) { dailyProduction = emptyDailyProduction(); updateGoal(); return dailyProduction; }
  let cached = await getMeta(dailyCacheKey(team, date));
  if (requestId !== dailyRequestId) return dailyProduction;
  if (cached) { dailyProduction = { ...emptyDailyProduction(team), ...cached, team, date, totalExcludingRecord: Number(cached.totalSent) || 0 }; updateGoal(); }
  if (!navigator.onLine || !endpointConfigured() || session?.role !== 'field') return dailyProduction;
  try {
    const result = await api.getDailyTeamProduction(session.token, team, date, activeRecord?.recordId || '');
    if (requestId !== dailyRequestId || normalizeTeamKey(elements.team.value) !== normalizeTeamKey(team)) return dailyProduction;
    dailyProduction = { ...emptyDailyProduction(team), ...result };
    await setMeta(dailyCacheKey(team, date), { team, date, goal: result.goal, totalSent: result.totalSent, percentage: result.percentage, status: result.status });
    updateGoal(); if (notify) toast('Produção diária atualizada.', 'success'); return dailyProduction;
  } catch (error) { if (notify) toast(friendlyError(error), 'error'); return dailyProduction; }
}

async function saveActiveDraft() {
  if (!activeRecord) return;
  activeRecord.step = currentStep; activeRecord.updatedAt = new Date().toISOString(); activeRecord.user = session?.user || activeRecord.user;
  await putRecord(activeRecord); await setMeta(ACTIVE_DRAFT_META, activeRecord.recordId); showDraftId();
}

function showDraftId() {
  elements.draftIdBadge.hidden = !activeRecord?.recordId;
  if (activeRecord?.recordId) elements.draftIdBadge.textContent = `ID ${activeRecord.recordId}`;
}

async function detectDraft() {
  const recordId = await getMeta(ACTIVE_DRAFT_META);
  if (!recordId) { elements.resumeBanner.hidden = true; return; }
  const record = await getRecord(recordId);
  if (!record || record.status !== RECORD_STATUS.DRAFT) { await setMeta(ACTIVE_DRAFT_META, null); elements.resumeBanner.hidden = true; return; }
  if (record.user && record.user !== session?.user) { elements.resumeBanner.hidden = true; return; }
  elements.resumeBanner.hidden = false;
  elements.resumeBannerText.textContent = record.occurrenceNumber ? `Nº ${record.occurrenceNumber} · atualizado em ${formatDateTime(record.updatedAt)}` : `Atualizado em ${formatDateTime(record.updatedAt)}`;
}

async function resumeDraft() {
  const recordId = await getMeta(ACTIVE_DRAFT_META); const record = recordId ? await getRecord(recordId) : null;
  if (!record) return; await loadRecordIntoForm(record); elements.resumeBanner.hidden = true; navigate('new');
}

async function discardDraft() {
  const recordId = await getMeta(ACTIVE_DRAFT_META); if (!recordId) return;
  if (!await confirmAction('Descartar rascunho?', 'O rascunho e as fotos guardadas somente neste aparelho serão removidos.', 'Descartar', 'danger')) return;
  await deleteRecord(recordId); await setMeta(ACTIVE_DRAFT_META, null); elements.resumeBanner.hidden = true;
  if (activeRecord?.recordId === recordId) resetForm(); toast('Rascunho descartado.');
}

function goToStep(step) {
  currentStep = step;
  $$('[data-step-panel]').forEach((panel) => { panel.hidden = Number(panel.dataset.stepPanel) !== step; });
  $$('[data-step-indicator]').forEach((indicator) => {
    const number = Number(indicator.dataset.stepIndicator);
    indicator.classList.toggle('is-active', number === step); indicator.classList.toggle('is-complete', number < step);
  });
  if (activeRecord) saveActiveDraft(); window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleCatalogInput() {
  const query = elements.serviceSearch.value.trim();
  if (query) await ensureActiveRecord();
  clearTimeout(catalogSearchTimer); const requestId = ++catalogSearchRequestId;
  if (query.length < 2) {
    elements.searchSpinner.hidden = true; elements.serviceResults.hidden = true;
    elements.serviceSearchHint.textContent = 'Digite pelo menos 2 caracteres.'; return;
  }
  catalogSearchTimer = setTimeout(() => searchCatalog(query, requestId), 260);
}

async function searchCatalog(query, requestId) {
  elements.searchSpinner.hidden = false;
  elements.serviceSearchHint.textContent = navigator.onLine ? 'Pesquisando na aba Emergência…' : 'Sem internet: pesquisando itens salvos neste aparelho.';
  try {
    const results = navigator.onLine ? (await api.searchCatalog(session.token, query, 40)).results : await searchCachedCatalog(query, 40);
    if (requestId !== catalogSearchRequestId || elements.serviceSearch.value.trim() !== query) return;
    catalogResults = results || []; if (navigator.onLine) await cacheCatalogResults(catalogResults); renderCatalogResults();
  } catch (error) {
    catalogResults = await searchCachedCatalog(query, 40);
    if (requestId === catalogSearchRequestId) renderCatalogResults(error);
  } finally { if (requestId === catalogSearchRequestId) elements.searchSpinner.hidden = true; }
}

function renderCatalogResults(error = null) {
  elements.serviceResults.hidden = false;
  if (!catalogResults.length) {
    elements.serviceResults.innerHTML = `<div class="search-empty">${escapeHtml(error ? 'Servidor indisponível e nenhum resultado salvo.' : 'Nenhum serviço encontrado na aba Emergência.')}</div>`;
    elements.serviceSearchHint.textContent = error ? friendlyError(error) : 'Tente outro código ou palavra.'; return;
  }
  elements.serviceResults.innerHTML = catalogResults.map((item, index) => `<button class="search-result" type="button" role="option" data-catalog-index="${index}">
    <span class="search-result__top"><strong>${escapeHtml(item.code)}</strong><small>Emergência</small></span>
    <span>${escapeHtml(item.catalogText || 'Sem descrição')}</span>
    <span class="search-result__meta"><b>${escapeHtml(item.unit || '—')}</b><span>${escapeHtml(item.group || '')}</span><span>${escapeHtml(formatCurrency(item.referenceValue))}</span></span>
  </button>`).join('');
  elements.serviceSearchHint.textContent = `${catalogResults.length} resultado(s). Toque para adicionar.`;
}

async function selectCatalogItem(item) {
  if (!item) return; await ensureActiveRecord();
  const catalogKey = item.catalogKey || item.catalogKeys?.[0] || '';
  if (activeRecord.services.some((service) => service.catalogKey === catalogKey)) { toast('Este serviço já foi adicionado.', 'error'); return; }
  activeRecord.services.push({ lineId: generateUuid(), catalogKey, code: item.code, catalogText: item.catalogText || '', unit: item.unit || '', group: item.group || '', referenceValue: Number(item.referenceValue) || 0, quantity: 1, origin: 'Emergência' });
  elements.serviceSearch.value = ''; elements.serviceResults.hidden = true; catalogResults = [];
  renderServices(); validateStepOne(false); await saveActiveDraft();
}

function renderServices() {
  const services = activeRecord?.services || [];
  if (!services.length) {
    elements.servicesList.innerHTML = '<div class="line-items__empty">Nenhum serviço selecionado.</div>'; updateGoal(); return;
  }
  elements.servicesList.innerHTML = services.map((service, index) => `<article class="line-item" data-service-line="${escapeHtml(service.lineId)}">
    <div class="line-item__main"><div><span class="line-item__index">${index + 1}</span><strong>${escapeHtml(service.code)}</strong><p>${escapeHtml(service.catalogText)}</p><small>${escapeHtml(service.unit || '—')} ${service.group ? `· ${escapeHtml(service.group)}` : ''}</small></div><button class="icon-button delete-photo" type="button" data-remove-service="${escapeHtml(service.lineId)}" aria-label="Remover serviço">×</button></div>
    <div class="line-item__values"><label class="field"><span>QTD *</span><input type="number" min="1" step="1" inputmode="numeric" data-service-quantity="${escapeHtml(service.lineId)}" value="${escapeHtml(service.quantity)}" /></label><div><span>Valor unitário</span><strong>${escapeHtml(formatCurrency(service.referenceValue))}</strong></div><div><span>Valor total</span><strong data-service-total="${escapeHtml(service.lineId)}">${escapeHtml(formatCurrency(serviceTotal(service)))}</strong></div></div>
  </article>`).join(''); updateGoal();
}

async function handleServiceChange(event) {
  const remove = event.target.closest('[data-remove-service]');
  const quantity = event.target.closest('[data-service-quantity]');
  if (!activeRecord || (!remove && !quantity)) return;
  if (remove) {
    activeRecord.services = activeRecord.services.filter((service) => service.lineId !== remove.dataset.removeService);
    renderServices(); validateStepOne(false); await saveActiveDraft(); return;
  }
  if (quantity) {
    const service = activeRecord.services.find((item) => item.lineId === quantity.dataset.serviceQuantity);
    if (service) {
      service.quantity = quantity.value;
      const total = $(`[data-service-total="${CSS.escape(service.lineId)}"]`, elements.servicesList);
      if (total) total.textContent = formatCurrency(serviceTotal(service));
    }
  }
  updateGoal(); validateStepOne(false); await saveActiveDraft();
}

function updateGoal() {
  const current = occurrenceTotal(activeRecord?.services || []);
  const base = normalizeTeamKey(dailyProduction.team) === normalizeTeamKey(elements.team.value) && dailyProduction.date === operationalDate() ? Number(dailyProduction.totalExcludingRecord) || 0 : 0;
  const progress = dailyGoalProjection(base, current, TEAM_GOAL);
  elements.goalValue.textContent = formatCurrency(TEAM_GOAL); elements.dailySentValue.textContent = formatCurrency(base); elements.currentValue.textContent = formatCurrency(current); elements.projectedValue.textContent = formatCurrency(progress.projectedTotal);
  elements.dailyTeamLabel.textContent = elements.team.value.trim() ? `Meta diária · ${elements.team.value.trim()}` : 'Meta diária da equipe';
  elements.goalPercentage.textContent = `${formatNumber(progress.percentage)}%`; elements.goalBar.style.width = `${progress.visualPercentage}%`;
  elements.goalStatus.textContent = progress.label; elements.goalStatus.className = `goal-status goal-status--${progress.state}`;
  elements.goalCard.classList.toggle('is-achieved', progress.state === 'atingida'); elements.goalCard.classList.toggle('is-exceeded', progress.state === 'superada');
}

async function addMaterial() {
  await ensureActiveRecord(); activeRecord.materials.push({ lineId: generateUuid(), description: '', quantity: '' });
  renderMaterials(); await saveActiveDraft();
}

function renderMaterials() {
  const materials = activeRecord?.materials || [{ lineId: 'blank', description: '', quantity: '' }];
  elements.materialsList.innerHTML = materials.map((material, index) => `<article class="line-item material-line" data-material-line="${escapeHtml(material.lineId)}">
    <span class="line-item__index">${index + 1}</span><label class="field"><span>Material *</span><input type="text" maxlength="180" data-material-description="${escapeHtml(material.lineId)}" value="${escapeHtml(material.description)}" placeholder="Ex.: Cabo 35mm" /></label><label class="field"><span>Quantidade *</span><input type="number" min="0.001" step="any" inputmode="decimal" data-material-quantity="${escapeHtml(material.lineId)}" value="${escapeHtml(material.quantity)}" /></label>${materials.length > 1 ? `<button class="icon-button delete-photo" type="button" data-remove-material="${escapeHtml(material.lineId)}" aria-label="Remover material">×</button>` : ''}
  </article>`).join('');
}

async function handleMaterialChange(event) {
  if (!activeRecord) { await ensureActiveRecord(); renderMaterials(); }
  const remove = event.target.closest('[data-remove-material]');
  const description = event.target.closest('[data-material-description]');
  const quantity = event.target.closest('[data-material-quantity]');
  if (remove) activeRecord.materials = activeRecord.materials.filter((item) => item.lineId !== remove.dataset.removeMaterial);
  if (description) { const item = activeRecord.materials.find((row) => row.lineId === description.dataset.materialDescription) || activeRecord.materials[0]; if (item) item.description = description.value; }
  if (quantity) { const item = activeRecord.materials.find((row) => row.lineId === quantity.dataset.materialQuantity) || activeRecord.materials[0]; if (item) item.quantity = quantity.value; }
  if (remove) renderMaterials(); validateStepOne(false); await saveActiveDraft();
}

function validateStepOne(showErrors = false) {
  if (activeRecord) syncFormToRecord();
  const errors = activeRecord ? validateOccurrence(activeRecord) : ['Preencha os dados da ocorrência.'];
  elements.continueToPhotosButton.disabled = errors.length > 0;
  if (showErrors && errors.length) {
    elements.stepOneErrors.hidden = false;
    elements.stepOneErrors.innerHTML = `<strong>Revise os campos:</strong><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`;
    elements.stepOneErrors.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (!errors.length || !showErrors) { elements.stepOneErrors.hidden = true; }
  return errors.length === 0;
}

function renderPhotoGrid() {
  elements.photoGrid.innerHTML = Array.from({ length: 5 }, (_, offset) => {
    const index = offset + 1;
    return `<article class="photo-card" data-photo-card="${index}"><div class="photo-card__header"><strong>Foto ${index}</strong><span class="status-chip status-chip--neutral" data-photo-status="${index}">Pendente</span></div><div class="photo-card__preview" data-photo-preview="${index}"><div class="photo-card__placeholder"><span aria-hidden="true">▧</span><span>Nenhuma evidência</span></div></div><div class="photo-card__actions"><button class="button button--primary" type="button" data-photo-take="${index}">Tirar foto</button><button class="button button--ghost" type="button" data-photo-attach="${index}">Anexar foto</button></div><div class="photo-card__secondary" data-photo-secondary="${index}" hidden><button type="button" data-photo-replace="${index}">Substituir</button><button class="delete-photo" type="button" data-photo-delete="${index}">Excluir</button></div></article>`;
  }).join(''); updatePhotoGrid();
}

async function handlePhotoGridClick(event) {
  const take = event.target.closest('[data-photo-take]'); const attach = event.target.closest('[data-photo-attach]');
  const replace = event.target.closest('[data-photo-replace]'); const remove = event.target.closest('[data-photo-delete]');
  const preview = event.target.closest('[data-photo-preview] img');
  if (take) return choosePhoto(Number(take.dataset.photoTake), true);
  if (attach) return choosePhoto(Number(attach.dataset.photoAttach), false);
  if (replace) return choosePhoto(Number(replace.dataset.photoReplace), false, true);
  if (remove) return removePhoto(Number(remove.dataset.photoDelete));
  if (preview) openPhoto(preview.src, preview.alt);
}

function choosePhoto(photoIndex, capture, replace = false) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
  if (capture) input.setAttribute('capture', 'environment'); input.hidden = true;
  input.addEventListener('change', async () => { const file = input.files?.[0]; input.remove(); if (file) await storeSelectedPhoto(photoIndex, file, replace); }, { once: true });
  document.body.append(input); input.click();
}

async function storeSelectedPhoto(photoIndex, file, replace) {
  try {
    await ensureActiveRecord(); const blob = await optimizePhoto(file);
    if (blob.size > 9 * 1024 * 1024) throw new Error('A foto ficou acima de 9 MB mesmo após a otimização.');
    const uploadKey = generateUuid(); const state = activeRecord.photoStates[photoIndex - 1] || { photoIndex };
    activeRecord.photoStates[photoIndex - 1] = { ...state, photoIndex, confirmed: false, localReady: true, uploadKey, replacePending: replace || Boolean(state.confirmed || state.serverUrl), error: '' };
    await putPhoto(activeRecord.recordId, photoIndex, blob, uploadKey, { fileName: file.name, mimeType: blob.type });
    activePhotos.set(photoIndex, { blob, uploadKey }); setPreviewUrl(photoIndex, URL.createObjectURL(blob));
    await saveActiveDraft(); updatePhotoGrid();
  } catch (error) { toast(error.message || 'Não foi possível preparar a foto.', 'error'); }
}

async function optimizePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image(); image.decoding = 'async'; image.src = sourceUrl; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false }); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84)) || file;
  } catch { if (file.size <= 9 * 1024 * 1024) return file; throw new Error('Este formato não pôde ser otimizado neste aparelho. Use JPG ou PNG.'); }
  finally { URL.revokeObjectURL(sourceUrl); }
}

async function removePhoto(photoIndex) {
  const state = activeRecord?.photoStates?.[photoIndex - 1]; if (!state) return;
  if (state.confirmed && !state.replacePending) { toast('Uma foto confirmada pode ser substituída, mas não removida isoladamente.', 'error'); return; }
  await deletePhoto(activeRecord.recordId, photoIndex); activePhotos.delete(photoIndex); revokePreviewUrl(photoIndex);
  activeRecord.photoStates[photoIndex - 1] = { photoIndex, confirmed: Boolean(state.serverUrl), localReady: false, serverUrl: state.serverUrl || '', uploadKey: '', replacePending: false };
  await saveActiveDraft(); updatePhotoGrid();
}

function setPreviewUrl(index, url) { revokePreviewUrl(index); previewUrls.set(index, url); }
function revokePreviewUrl(index) { const current = previewUrls.get(index); if (current?.startsWith('blob:')) URL.revokeObjectURL(current); previewUrls.delete(index); }
function clearPreviewUrls() { for (const index of [...previewUrls.keys()]) revokePreviewUrl(index); activePhotos.clear(); }

function updatePhotoGrid() {
  let ready = 0;
  for (let index = 1; index <= 5; index += 1) {
    const state = activeRecord?.photoStates?.[index - 1] || {}; const local = Boolean(state.localReady) || activePhotos.has(index);
    const url = normalizePhotoUrl(previewUrls.get(index) || state.serverUrl || ''); const present = local || Boolean(url) || state.confirmed; if (present) ready += 1;
    const card = $(`[data-photo-card="${index}"]`); const preview = $(`[data-photo-preview="${index}"]`); const status = $(`[data-photo-status="${index}"]`); const secondary = $(`[data-photo-secondary="${index}"]`);
    card?.classList.toggle('has-photo', present);
    if (preview) preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="Foto ${index}" data-fallback-src="${escapeHtml(photoFallbackUrl(url))}" />` : '<div class="photo-card__placeholder"><span aria-hidden="true">▧</span><span>Nenhuma evidência</span></div>';
    if (status) { status.textContent = state.confirmed && !state.replacePending ? 'Confirmada' : present ? 'Pronta' : 'Pendente'; status.className = `status-chip ${state.confirmed && !state.replacePending ? 'status-chip--success' : present ? 'status-chip--info' : 'status-chip--neutral'}`; }
    if (secondary) { secondary.hidden = !present; const button = $('[data-photo-delete]', secondary); if (button) button.hidden = Boolean(state.confirmed && !state.replacePending && !local); }
  }
  elements.photoProgressChip.textContent = `${ready}/5 fotos`; elements.photoProgressChip.className = `status-chip ${ready === 5 ? 'status-chip--success' : 'status-chip--warning'}`;
  elements.continueToReviewButton.disabled = ready !== 5;
}

function serviceTable(services = []) {
  return `<div class="detail-section"><h4>Serviços</h4><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th>QTD</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${services.map((service) => `<tr><td>${escapeHtml(service.code)}</td><td>${escapeHtml(service.catalogText)}</td><td>${escapeHtml(service.unit)}</td><td>${escapeHtml(formatNumber(service.quantity))}</td><td>${escapeHtml(formatCurrency(service.referenceValue))}</td><td>${escapeHtml(formatCurrency(serviceTotal(service)))}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function materialTable(materials = []) {
  return `<div class="detail-section"><h4>Materiais aplicados</h4><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Material</th><th>Quantidade</th></tr></thead><tbody>${materials.map((material) => `<tr><td>${escapeHtml(material.description)}</td><td>${escapeHtml(formatNumber(material.quantity))}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function photoUrlsForRecord(record = {}) {
  return Array.from({ length: 5 }, (_, index) => normalizePhotoUrl(
    record.photos?.[index] || record.photoStates?.[index]?.serverUrl || record.photoStates?.[index]?.url || previewUrls.get(index + 1) || ''
  ));
}

function photoMarkup(record) {
  return `<div class="review-photos">${photoUrlsForRecord(record).map((url, index) => url
    ? `<figure class="review-photo"><img src="${escapeHtml(url)}" alt="Foto ${index + 1}" data-zoom-src="${escapeHtml(url)}" data-zoom-label="Foto ${index + 1}" data-fallback-src="${escapeHtml(photoFallbackUrl(url))}" /><span>Foto ${index + 1}</span></figure>`
    : `<figure class="review-photo review-photo--empty"><div class="photo-card__placeholder"><span aria-hidden="true">▧</span><span>Foto ${index + 1} indisponível</span></div><span>Foto ${index + 1}</span></figure>`).join('')}</div>`;
}

function dailyDetailMarkup(record) {
  const total = occurrenceTotal(record.services || []); const daily = record.dailyProduction;
  const totalSent = Number(daily?.totalSent) || (record.serverConfirmed ? total : 0); const progress = goalProgress(totalSent, Number(daily?.goal) || TEAM_GOAL);
  return `<section class="daily-detail"><span class="live-indicator"><i></i> Ao vivo</span><div class="daily-detail__values"><div><span>Valor desta ocorrência</span><strong>${escapeHtml(formatCurrency(total))}</strong></div><div><span>Produção da equipe no dia</span><strong>${escapeHtml(formatCurrency(totalSent))} / ${escapeHtml(formatCurrency(Number(daily?.goal) || TEAM_GOAL))}</strong></div><div><span>Percentual diário</span><strong>${escapeHtml(formatNumber(progress.percentage))}%</strong></div></div></section>`;
}

function occurrenceDetails(record, includePhotos = true) {
  const total = occurrenceTotal(record.services || []);
  const transformer = record.occurrenceTypes?.includes(TYPE_TRAFO) ? `<div class="detail-section"><h4>Transformadores</h4><div class="review-data__grid"><div><dt>Retirado</dt><dd>${escapeHtml(record.transformer?.removedCode)} · CIA ${escapeHtml(record.transformer?.removedCia)}</dd></div><div><dt>Novo</dt><dd>${escapeHtml(record.transformer?.newCode)} · CIA ${escapeHtml(record.transformer?.newCia)}</dd></div></div></div>` : '';
  const photos = includePhotos ? photoMarkup(record) : '';
  const status = record.status || record.serverStatus || RECORD_STATUS.DRAFT;
  return `${dailyDetailMarkup(record)}<dl class="review-data"><div class="review-data__grid"><div><dt>Equipe</dt><dd>${escapeHtml(record.team)}</dd></div><div><dt>Nº ocorrência</dt><dd>${escapeHtml(record.occurrenceNumber)}</dd></div><div><dt>Tipo(s)</dt><dd>${escapeHtml((record.occurrenceTypes || []).join(' · '))}</dd></div><div><dt>PG</dt><dd>${escapeHtml([record.pg1, record.pg2, record.pg3].filter(Boolean).join(' · ') || '—')}</dd></div><div><dt>Total dos serviços</dt><dd>${escapeHtml(formatCurrency(total))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(statusLabel(status, countConfirmedPhotos(record)))}</dd></div><div><dt>Registrado em</dt><dd>${escapeHtml(formatDateTime(record.registeredAt || record.createdAt))}</dd></div><div><dt>Atualizado em</dt><dd>${escapeHtml(formatDateTime(record.updatedAt))}</dd></div></div>${transformer}<div><dt>Observação</dt><dd>${escapeHtml(record.observation || '—')}</dd></div></dl>${serviceTable(record.services)}${materialTable(record.materials)}${photos}`;
}

function renderReview() { if (activeRecord) { syncFormToRecord(); activeRecord.dailyProduction = { ...dailyProduction, totalSent: Number(dailyProduction.totalExcludingRecord) || 0 }; elements.reviewSummary.innerHTML = occurrenceDetails(activeRecord); } }

async function submitOccurrence() {
  if (!activeRecord || !validateStepOne(true) || countReadyPhotoStates(activeRecord) !== 5) { toast('Complete os dados e as cinco fotos antes de enviar.', 'error'); return; }
  if (!await confirmAction('Enviar para conferência?', 'Deseja enviar esta ocorrência para conferência do supervisor?', 'Enviar', 'success')) return;
  syncFormToRecord(); activeRecord.status = RECORD_STATUS.PENDING; activeRecord.lastError = '';
  await putRecord(activeRecord); await setMeta(ACTIVE_DRAFT_META, null); const submittedId = activeRecord.recordId;
  setBusy(elements.submitOccurrenceButton, true, 'Enviando…');
  try {
    const result = await syncSingleRecord(submittedId, false);
    toast(result?.status === RECORD_STATUS.WAITING_SUPERVISOR ? 'Ocorrência enviada para conferência.' : 'Ocorrência guardada na fila. A sincronização continuará automaticamente.', result?.status === RECORD_STATUS.WAITING_SUPERVISOR ? 'success' : 'default');
  } finally { setBusy(elements.submitOccurrenceButton, false); resetForm({ preserveTeam: true }); navigate('mine'); }
}

async function cacheDailySummary(summary) {
  if (!summary?.team || !summary?.date) return;
  await setMeta(dailyCacheKey(summary.team, summary.date), { team: summary.team, date: summary.date, goal: summary.goal, totalSent: summary.totalSent, percentage: summary.percentage, status: summary.status });
  if (normalizeTeamKey(elements.team.value) === normalizeTeamKey(summary.team)) { dailyProduction = { ...emptyDailyProduction(summary.team), ...summary }; updateGoal(); }
}

async function syncSingleRecord(recordId, notify = true) {
  const record = await getRecord(recordId); if (!record || !session || session.role !== 'field') return null;
  if (!navigator.onLine) { record.status = RECORD_STATUS.PENDING; record.lastError = 'Sem internet'; await putRecord(record); await updateQueueUi(); if (notify) toast('Sem internet. O registro continua guardado neste aparelho.'); return record; }
  let next = { ...record, attempts: (record.attempts || 0) + 1, lastAttemptAt: new Date().toISOString(), lastError: '' };
  try {
    if (next.serverConfirmed || next.attempts > 1) {
      try { next = reconcilePhotoStates(next, await api.getRecordState(session.token, next.recordId)); await putRecord(next); }
      catch (error) { if (!(error instanceof ApiError) || error.code !== 'RECORD_NOT_FOUND') throw error; }
    }
    next.status = RECORD_STATUS.SYNCING_DATA; await putRecord(next);
    const submitResult = await api.submitRecord(session.token, {
      recordId: next.recordId, team: next.team, occurrenceNumber: next.occurrenceNumber,
      occurrenceTypes: next.occurrenceTypes, pg1: next.pg1, pg2: next.pg2, pg3: next.pg3,
      transformer: next.transformer, services: next.services, materials: next.materials,
      totalServices: occurrenceTotal(next.services), goalPercentage: dailyGoalProjection(dailyProduction.totalExcludingRecord, occurrenceTotal(next.services)).percentage,
      observation: next.observation
    }, APP_VERSION);
    next = reconcilePhotoStates(next, submitResult); await cacheDailySummary(submitResult.dailyProduction || next.dailyProduction);
    next.status = RECORD_STATUS.SYNCING_PHOTOS; await putRecord(next);
    next = reconcilePhotoStates(next, await api.getRecordState(session.token, next.recordId)); await putRecord(next);
    for (let index = 1; index <= 5; index += 1) {
      const state = next.photoStates[index - 1] || {};
      if (state.confirmed && !state.replacePending) { await deletePhoto(next.recordId, index).catch(() => {}); continue; }
      const localPhoto = await getPhoto(next.recordId, index);
      if (!localPhoto?.blob) throw new ApiError(`A Foto ${index} não está disponível neste aparelho.`, 'LOCAL_PHOTO_MISSING');
      const photoResult = await api.uploadPhoto(session.token, { ...localPhoto, dataUrl: await blobToDataUrl(localPhoto.blob) }, { replace: Boolean(state.replacePending) });
      next = reconcilePhotoStates(next, photoResult); next.photoStates[index - 1].replacePending = false; next.status = photoResult.status || RECORD_STATUS.SYNCING_PHOTOS; next.lastError = '';
      await putRecord(next); if (photoResult.photoStates?.find((item) => item.photoIndex === index)?.confirmed) await deletePhoto(next.recordId, index); await updateQueueUi();
    }
    const finalState = await api.getRecordState(session.token, next.recordId); next = reconcilePhotoStates(next, finalState);
    next.status = finalState.status || RECORD_STATUS.WAITING_SUPERVISOR; next.lastError = ''; next.syncedAt = new Date().toISOString();
    await putRecord(next); await setMeta(LAST_SYNC_META, next.syncedAt); await cacheDailySummary(finalState.dailyProduction || next.dailyProduction); if (notify) toast(statusLabel(next.status, next.photoCount), 'success'); return next;
  } catch (error) {
    next.status = RECORD_STATUS.ERROR; next.lastError = friendlyError(error); await putRecord(next);
    if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') logout(); if (notify) toast(next.lastError, 'error', 5200); return next;
  } finally { await updateQueueUi(); if (currentView === 'mine') refreshMine(false); }
}

async function syncAll(notify = false) {
  if (syncRunning || !session || session.role !== 'field') return; syncRunning = true; setBusy(elements.syncNowButton, true, 'Sincronizando…');
  try { const queue = (await getAllRecords()).filter((record) => SYNCABLE_STATUSES.has(record.status)); for (const record of queue) await syncSingleRecord(record.recordId, false); if (notify) toast(queue.length ? 'Fila verificada e atualizada.' : 'Nenhum registro pendente.', 'success'); }
  finally { syncRunning = false; setBusy(elements.syncNowButton, false); await updateQueueUi(); }
}

async function updateQueueUi() {
  const summary = await getQueueSummary(); elements.syncPendingRecords.textContent = summary.pendingRecords.length; elements.syncPendingPhotos.textContent = summary.pendingPhotos;
  elements.syncPhotosSyncing.textContent = summary.syncingPhotos; elements.syncErrors.textContent = summary.errors; elements.syncNavCount.hidden = !summary.pendingRecords.length; elements.syncNavCount.textContent = summary.pendingRecords.length;
  const lastSync = await getMeta(LAST_SYNC_META); elements.lastSyncAt.textContent = lastSync ? formatDateTime(lastSync) : 'Nenhuma sincronização concluída.'; renderSyncQueue(summary.pendingRecords);
}

function renderSyncQueue(records) {
  elements.syncQueueList.innerHTML = records.length ? records.map((record) => recordCard(record, `<button class="button button--ghost button--small" type="button" data-sync-record="${escapeHtml(record.recordId)}">Tentar novamente</button>`)).join('') : emptyState('Fila em dia', 'Não há registros ou fotos aguardando envio.');
}

async function testConnection(notify = true) {
  elements.syncLastTest.textContent = 'Testando…'; setBusy(elements.testConnectionButton, true, 'Testando…');
  try { const result = await healthCheck(); elements.syncLastTest.textContent = `Servidor ${result.version} · ${formatDateTime(result.timestamp)}`; if (notify) toast('Conexão com o servidor confirmada.', 'success'); return true; }
  catch (error) { elements.syncLastTest.textContent = friendlyError(error); if (notify) toast(friendlyError(error), 'error'); return false; }
  finally { setBusy(elements.testConnectionButton, false); }
}

async function refreshMine(notify = false) {
  if (!session || session.role !== 'field') return; setBusy(elements.refreshMineButton, true, 'Atualizando…');
  try {
    const localRecords = await getAllRecords(); let serverRecords = [];
    if (navigator.onLine && endpointConfigured()) { try { serverRecords = (await api.listMine(session.token)).records || []; } catch (error) { if (notify) toast(friendlyError(error), 'error'); } }
    mineRecords = mergeRecordCollections(localRecords, serverRecords); setupMineTeams(); renderMineFilters(); renderMineList(); await refreshMineGoal(false);
  } finally { setBusy(elements.refreshMineButton, false); }
}

function setupMineTeams() {
  const teams = [...new Set(mineRecords.map((record) => String(record.team || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const preferred = mineTeam || localStorage.getItem(LAST_TEAM_KEY) || activeRecord?.team || teams[0] || '';
  mineTeam = teams.find((team) => normalizeTeamKey(team) === normalizeTeamKey(preferred)) || preferred;
  if (mineTeam && !teams.some((team) => normalizeTeamKey(team) === normalizeTeamKey(mineTeam))) teams.unshift(mineTeam);
  elements.mineTeamSelect.innerHTML = teams.length ? teams.map((team) => `<option value="${escapeHtml(team)}"${normalizeTeamKey(team) === normalizeTeamKey(mineTeam) ? ' selected' : ''}>${escapeHtml(team)}</option>`).join('') : '<option value="">Nenhuma equipe</option>';
  elements.mineGoalCard.hidden = !mineTeam;
}

async function refreshMineGoal(notify = false) {
  if (!mineTeam) { elements.mineGoalCard.hidden = true; return; }
  elements.mineGoalCard.hidden = false; const date = operationalDate();
  const fromRecord = mineRecords.find((record) => normalizeTeamKey(record.team) === normalizeTeamKey(mineTeam) && record.dailyProduction?.date === date)?.dailyProduction;
  let summary = fromRecord || await getMeta(dailyCacheKey(mineTeam, date)) || emptyDailyProduction(mineTeam);
  if (navigator.onLine && endpointConfigured() && session?.role === 'field') {
    try { summary = await api.getDailyTeamProduction(session.token, mineTeam, date); await cacheDailySummary(summary); }
    catch (error) { if (notify) toast(friendlyError(error), 'error'); }
  }
  renderMineGoal(summary);
}

function renderMineGoal(summary = emptyDailyProduction(mineTeam)) {
  const progress = goalProgress(Number(summary.totalSent) || 0, Number(summary.goal) || TEAM_GOAL);
  elements.mineGoalValue.textContent = formatCurrency(progress.goal); elements.mineDailyValue.textContent = formatCurrency(progress.total);
  elements.mineGoalPercentage.textContent = `${formatNumber(progress.percentage)}%`; elements.mineGoalBar.style.width = `${progress.visualPercentage}%`;
  elements.mineGoalStatus.textContent = progress.label; elements.mineGoalStatus.className = `goal-status goal-status--${progress.state}`;
  elements.mineGoalCard.classList.toggle('is-achieved', progress.state === 'atingida'); elements.mineGoalCard.classList.toggle('is-exceeded', progress.state === 'superada');
}

function renderMineFilters() {
  const filters = [['today', 'Hoje'], ['history', 'Outros dias'], ['all', 'Todas'], ['draft', 'Rascunhos'], ['pending', 'Pendentes'], ['waiting', 'Aguardando'], ['correction', 'Correção'], ['approved', 'Aprovadas'], ['rejected', 'Reprovadas']];
  elements.mineFilters.innerHTML = filters.map(([value, label]) => `<button class="filter-chip${mineFilter === value ? ' is-active' : ''}" type="button" data-filter="${value}">${label}</button>`).join('');
}

function renderMineList() {
  const today = operationalDate();
  const filtered = mineRecords.filter((record) => (mineFilter === 'today' && operationalDate(record.registeredAt || record.createdAt) === today) || (mineFilter === 'history' && operationalDate(record.registeredAt || record.createdAt) !== today) || mineFilter === 'all' || (mineFilter === 'draft' && record.status === RECORD_STATUS.DRAFT) || (mineFilter === 'pending' && SYNCABLE_STATUSES.has(record.status)) || (mineFilter === 'waiting' && record.status === RECORD_STATUS.WAITING_SUPERVISOR) || (mineFilter === 'correction' && record.status === RECORD_STATUS.CORRECTION_REQUESTED) || (mineFilter === 'approved' && [RECORD_STATUS.APPROVED, RECORD_STATUS.PUBLISHED].includes(record.status)) || (mineFilter === 'rejected' && record.status === RECORD_STATUS.REJECTED));
  if (!filtered.length) { elements.mineList.innerHTML = emptyState('Nenhuma ocorrência nesta visão', 'Quando houver registros com este status, eles aparecerão aqui.'); return; }
  elements.mineList.innerHTML = filtered.map((record) => {
    const actions = [`<button class="button button--ghost button--small" type="button" data-mine-action="view" data-record-id="${escapeHtml(record.recordId)}">Ver ocorrência</button>`];
    if (record.status === RECORD_STATUS.DRAFT) actions.push(`<button class="button button--primary button--small" type="button" data-mine-action="continue" data-record-id="${escapeHtml(record.recordId)}">Continuar</button>`);
    else if (record.status === RECORD_STATUS.CORRECTION_REQUESTED) actions.push(`<button class="button button--warning button--small" type="button" data-mine-action="correct" data-record-id="${escapeHtml(record.recordId)}">Corrigir</button>`);
    else if (SYNCABLE_STATUSES.has(record.status)) actions.push(`<button class="button button--ghost button--small" type="button" data-mine-action="sync" data-record-id="${escapeHtml(record.recordId)}">Sincronizar agora</button>`);
    const action = `<div class="button-row">${actions.join('')}</div>`;
    return recordCard(record, action);
  }).join('');
}

function recordCard(record, actionHtml = '') {
  const photoCount = Math.max(countConfirmedPhotos(record), countReadyPhotoStates(record)); const status = record.status || record.serverStatus; const total = occurrenceTotal(record.services || []); const serviceQuantity = (record.services || []).reduce((sum, service) => sum + (Number(service.quantity) || 0), 0);
  return `<article class="record-card"><header class="record-card__header"><div><h3>${escapeHtml(record.occurrenceNumber ? `Ocorrência ${record.occurrenceNumber}` : 'Nova ocorrência')}</h3><small>${escapeHtml(record.recordId || '')}</small></div><span class="status-chip status-chip--${statusTone(status)}">${escapeHtml(statusLabel(status, photoCount))}</span></header><p>${escapeHtml((record.occurrenceTypes || []).join(' · ') || 'Tipo não informado')}</p><div class="record-card__body"><div class="record-meta"><span>Equipe</span><strong>${escapeHtml(record.team || '—')}</strong></div><div class="record-meta"><span>Qtd. serviços</span><strong>${escapeHtml(formatNumber(serviceQuantity))}</strong></div><div class="record-meta"><span>Total</span><strong>${escapeHtml(formatCurrency(total))}</strong></div><div class="record-meta"><span>Registrado em</span><strong>${escapeHtml(formatDateTime(record.registeredAt || record.createdAt))}</strong></div></div>${record.reason ? `<div class="status-chip status-chip--warning">Motivo: ${escapeHtml(record.reason)}</div>` : ''}${record.lastError ? `<div class="status-chip status-chip--danger">${escapeHtml(record.lastError)}</div>` : ''}<div class="record-progress"><span style="width:${Math.min(100, photoCount * 20)}%"></span></div><footer class="record-card__footer"><span class="photo-count">▧ ${photoCount}/5 fotos</span>${actionHtml}</footer></article>`;
}

async function handleMineAction(event) {
  const button = event.target.closest('[data-mine-action]'); if (!button) return; const recordId = button.dataset.recordId;
  if (button.dataset.mineAction === 'sync') return syncSingleRecord(recordId, true);
  const local = await getRecord(recordId); const server = mineRecords.find((item) => item.recordId === recordId); const record = local || server; if (!record) return;
  if (button.dataset.mineAction === 'view') {
    const detailRecord = { ...record, ...(server || {}), photos: server?.photos || record.photos, dailyProduction: server?.dailyProduction || record.dailyProduction };
    elements.mineDetailTitle.textContent = `Ocorrência ${detailRecord.occurrenceNumber || 'sem número'}`;
    elements.mineDetailContent.innerHTML = occurrenceDetails(detailRecord); elements.mineDetailDialog.showModal(); return;
  }
  if (button.dataset.mineAction === 'correct') {
    const correction = { ...record, status: RECORD_STATUS.DRAFT, serverStatus: RECORD_STATUS.CORRECTION_REQUESTED, correctionMode: true, photoStates: Array.from({ length: 5 }, (_, index) => ({ photoIndex: index + 1, confirmed: Boolean(record.photos?.[index]), localReady: false, serverUrl: record.photos?.[index] || '', uploadKey: '', replacePending: false })) };
    await putRecord(correction); await setMeta(ACTIVE_DRAFT_META, correction.recordId); return loadRecordIntoForm(correction);
  }
  await setMeta(ACTIVE_DRAFT_META, record.recordId); await loadRecordIntoForm(record);
}

async function loadRecordIntoForm(record) {
  clearPreviewUrls(); activeRecord = { ...blankRecord(), ...record, status: RECORD_STATUS.DRAFT, transformer: { ...blankRecord().transformer, ...(record.transformer || {}) }, services: record.services || [], materials: record.materials?.length ? record.materials : [{ lineId: generateUuid(), description: '', quantity: '' }], photoStates: Array.from({ length: 5 }, (_, index) => record.photoStates?.[index] || { photoIndex: index + 1, confirmed: Boolean(record.photos?.[index]), localReady: false, serverUrl: record.photos?.[index] || '', uploadKey: '', replacePending: false }) };
  const photos = await getPhotosForRecord(record.recordId);
  for (const photo of photos) { const state = activeRecord.photoStates[photo.photoIndex - 1] || { photoIndex: photo.photoIndex }; activeRecord.photoStates[photo.photoIndex - 1] = { ...state, localReady: true, uploadKey: state.uploadKey || photo.uploadKey || '' }; activePhotos.set(photo.photoIndex, photo); setPreviewUrl(photo.photoIndex, URL.createObjectURL(photo.blob)); }
  if (photos.length) await putRecord(activeRecord);
  elements.team.value = activeRecord.team || ''; elements.occurrenceNumber.value = activeRecord.occurrenceNumber || '';
  if (activeRecord.team) { localStorage.setItem(LAST_TEAM_KEY, activeRecord.team); await loadDailyProduction(activeRecord.team, false); }
  $$('input[type="checkbox"]', elements.occurrenceTypes).forEach((input) => { input.checked = activeRecord.occurrenceTypes.includes(input.value); });
  elements.pg1.value = activeRecord.pg1 || ''; elements.pg2.value = activeRecord.pg2 || ''; elements.pg3.value = activeRecord.pg3 || '';
  elements.removedTransformerCode.value = activeRecord.transformer.removedCode || ''; elements.removedTransformerCia.value = activeRecord.transformer.removedCia || '';
  elements.newTransformerCode.value = activeRecord.transformer.newCode || ''; elements.newTransformerCia.value = activeRecord.transformer.newCia || '';
  elements.transformerSection.hidden = !activeRecord.occurrenceTypes.includes(TYPE_TRAFO); elements.observation.value = activeRecord.observation || ''; elements.observationCount.textContent = elements.observation.value.length;
  renderServices(); renderMaterials(); showDraftId(); validateStepOne(false); updatePhotoGrid(); goToStep(Math.min(3, Math.max(1, Number(activeRecord.step) || 1))); elements.resumeBanner.hidden = true; navigate('new');
}

function resetForm({ preserveTeam = false } = {}) {
  const team = preserveTeam ? (activeRecord?.team || localStorage.getItem(LAST_TEAM_KEY) || '') : '';
  catalogSearchRequestId += 1; clearTimeout(catalogSearchTimer); clearPreviewUrls(); activeRecord = null; currentStep = 1;
  [elements.team, elements.occurrenceNumber, elements.pg1, elements.pg2, elements.pg3, elements.removedTransformerCode, elements.removedTransformerCia, elements.newTransformerCode, elements.newTransformerCia, elements.serviceSearch, elements.observation].forEach((input) => { input.value = ''; });
  elements.team.value = team;
  $$('input[type="checkbox"]', elements.occurrenceTypes).forEach((input) => { input.checked = false; });
  elements.transformerSection.hidden = true; elements.serviceResults.hidden = true; elements.observationCount.textContent = '0'; elements.draftIdBadge.hidden = true; elements.stepOneErrors.hidden = true;
  renderServices(); renderMaterials(); renderPhotoGrid(); validateStepOne(false); goToStep(1); if (team) loadDailyProduction(team, false);
}

async function refreshSupervisor(notify = false) {
  if (!session || session.role !== 'supervisor') return;
  if (!navigator.onLine) { if (notify) toast('O painel do supervisor precisa de conexão.', 'error'); return; }
  setBusy(elements.refreshSupervisorButton, true, 'Atualizando…');
  try { supervisorRecords = (await api.listPending(session.token)).records || []; selectedSupervisorIds = new Set([...selectedSupervisorIds].filter((id) => supervisorRecords.some((record) => record.recordId === id))); renderSupervisorList(); if (notify) toast('Painel atualizado.', 'success'); }
  catch (error) { if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') logout(); else if (notify) toast(friendlyError(error), 'error'); renderSupervisorList(error); }
  finally { setBusy(elements.refreshSupervisorButton, false); }
}

function renderSupervisorList(error = null) {
  elements.supervisorNavCount.hidden = !supervisorRecords.length; elements.supervisorNavCount.textContent = supervisorRecords.length; elements.approveAllFooter.hidden = !supervisorRecords.length;
  if (!supervisorRecords.length) { elements.supervisorList.innerHTML = emptyState(error ? 'Não foi possível carregar' : 'Nenhuma ocorrência aguardando', error ? friendlyError(error) : 'As ocorrências completas aparecerão aqui para conferência.'); updateSupervisorSelectionUi(); return; }
  elements.supervisorList.innerHTML = supervisorRecords.map((record) => {
    const checked = selectedSupervisorIds.has(record.recordId); const urls = photoUrlsForRecord(record);
    const thumbs = urls.map((url, index) => url ? `<button type="button" data-zoom-src="${escapeHtml(url)}" data-zoom-label="Foto ${index + 1}"><img src="${escapeHtml(url)}" alt="Foto ${index + 1}" data-fallback-src="${escapeHtml(photoFallbackUrl(url))}" /></button>` : `<button type="button" disabled aria-label="Foto ${index + 1} indisponível"><span>${index + 1}</span></button>`).join('');
    const total = occurrenceTotal(record.services || []); const daily = record.dailyProduction || {}; const dailyProgress = goalProgress(Number(daily.totalSent) || 0, Number(daily.goal) || TEAM_GOAL);
    return `<article class="record-card supervisor-card"><input type="checkbox" aria-label="Selecionar ocorrência ${escapeHtml(record.occurrenceNumber)}" data-supervisor-select="${escapeHtml(record.recordId)}" ${checked ? 'checked' : ''} /><div class="supervisor-card__content"><header class="record-card__header"><div><h3>Ocorrência ${escapeHtml(record.occurrenceNumber)}</h3><small>${escapeHtml(record.recordId)}</small></div><span class="status-chip status-chip--warning">${record.photoCount}/5 fotos</span></header><p>${escapeHtml((record.occurrenceTypes || []).join(' · '))}</p><div class="record-card__body"><div class="record-meta"><span>Equipe</span><strong>${escapeHtml(record.team)}</strong></div><div class="record-meta"><span>Valor desta ocorrência</span><strong>${escapeHtml(formatCurrency(total))}</strong></div><div class="record-meta"><span>Produção da equipe hoje</span><strong>${escapeHtml(formatCurrency(dailyProgress.total))}</strong></div><div class="record-meta"><span>Meta diária · Ao vivo</span><strong>${escapeHtml(formatNumber(dailyProgress.percentage))}%</strong></div></div><div class="supervisor-thumbs">${thumbs}</div><footer class="record-card__footer"><span class="live-indicator"><i></i> Ao vivo</span><button class="button button--primary button--small" type="button" data-review-record="${escapeHtml(record.recordId)}">Conferir ocorrência</button></footer></div></article>`;
  }).join(''); updateSupervisorSelectionUi();
}

function handleSupervisorListClick(event) {
  const review = event.target.closest('[data-review-record]'); const zoom = event.target.closest('[data-zoom-src]');
  if (zoom) return openPhotoFromElement(zoom); if (review) openSupervisorReview(review.dataset.reviewRecord);
}

function handleSupervisorSelection(event) { const checkbox = event.target.closest('[data-supervisor-select]'); if (!checkbox) return; if (checkbox.checked) selectedSupervisorIds.add(checkbox.dataset.supervisorSelect); else selectedSupervisorIds.delete(checkbox.dataset.supervisorSelect); updateSupervisorSelectionUi(); }
function selectAllSupervisorVisible() { if (elements.selectAllVisible.checked) supervisorRecords.forEach((record) => selectedSupervisorIds.add(record.recordId)); else selectedSupervisorIds.clear(); $$('[data-supervisor-select]').forEach((checkbox) => { checkbox.checked = selectedSupervisorIds.has(checkbox.dataset.supervisorSelect); }); updateSupervisorSelectionUi(); }
function updateSupervisorSelectionUi() { const count = selectedSupervisorIds.size; elements.selectedCountLabel.textContent = `${count} ${count === 1 ? 'ocorrência selecionada' : 'ocorrências selecionadas'}`; elements.approveSelectedButton.disabled = !count; elements.selectAllVisible.checked = Boolean(supervisorRecords.length && count === supervisorRecords.length); elements.selectAllVisible.indeterminate = count > 0 && count < supervisorRecords.length; }

function openSupervisorReview(recordId) { activeSupervisorRecord = supervisorRecords.find((record) => record.recordId === recordId); if (!activeSupervisorRecord) return; elements.reviewDialogTitle.textContent = `Ocorrência ${activeSupervisorRecord.occurrenceNumber} · ${activeSupervisorRecord.photoCount}/5 fotos`; elements.reviewDialogContent.innerHTML = occurrenceDetails(activeSupervisorRecord); elements.reviewDialog.showModal(); }

async function decideSupervisor(decision) {
  if (!activeSupervisorRecord) return; let reason = ''; let note = '';
  if (decision === 'approve') { if (!await confirmAction('Aprovar e publicar?', `A ocorrência ${activeSupervisorRecord.occurrenceNumber} será publicada na aba oficial.`, 'Aprovar e publicar', 'success')) return; }
  else { const values = await collectDecision(decision); if (!values) return; ({ reason, note } = values); const label = decision === 'reject' ? 'reprovar' : 'solicitar correção para'; if (!await confirmAction('Confirmar decisão?', `Deseja ${label} a ocorrência ${activeSupervisorRecord.occurrenceNumber}?`, 'Confirmar', decision === 'reject' ? 'danger' : 'warning')) return; }
  const button = decision === 'approve' ? elements.approveButton : decision === 'reject' ? elements.rejectButton : elements.requestCorrectionButton; setBusy(button, true, 'Salvando…');
  try { await api.supervisorAction(session.token, decision, activeSupervisorRecord.recordId, reason, note); elements.reviewDialog.close(); toast(decision === 'approve' ? 'Ocorrência aprovada e publicada.' : decision === 'reject' ? 'Ocorrência reprovada.' : 'Correção solicitada.', 'success'); await refreshSupervisor(false); }
  catch (error) { toast(friendlyError(error), 'error'); }
  finally { setBusy(elements.approveButton, false); setBusy(elements.rejectButton, false); setBusy(elements.requestCorrectionButton, false); }
}

function collectDecision(decision) {
  elements.decisionDialogTitle.textContent = decision === 'reject' ? 'Reprovar ocorrência' : 'Solicitar correção'; elements.decisionReason.value = ''; elements.decisionNote.value = ''; elements.decisionDialog.showModal();
  return new Promise((resolve) => { const handler = () => { elements.decisionDialog.removeEventListener('close', handler); if (elements.decisionDialog.returnValue === 'cancel' || !elements.decisionReason.value.trim()) resolve(null); else resolve({ reason: elements.decisionReason.value.trim(), note: elements.decisionNote.value.trim() }); }; elements.decisionDialog.addEventListener('close', handler); });
}

async function approveSelected() {
  const ids = [...selectedSupervisorIds]; if (!ids.length) return;
  if (!await confirmAction('Aprovar selecionadas?', `${ids.length} ocorrência(s) apta(s) serão publicadas.`, 'Aprovar selecionadas', 'success')) return;
  setBusy(elements.approveSelectedButton, true, 'Aprovando…');
  try { const result = await api.approveBatch(session.token, ids, false); toast(`${result.approvedCount} aprovada(s); ${result.skippedCount} ignorada(s).`, result.approvedCount ? 'success' : 'default'); selectedSupervisorIds.clear(); await refreshSupervisor(false); }
  catch (error) { toast(friendlyError(error), 'error'); } finally { setBusy(elements.approveSelectedButton, false); }
}

async function approveAll() {
  if (!await confirmAction('Aprovar todas?', 'Você tem certeza que deseja aprovar todas as ocorrências aptas?', 'Sim, aprovar todas', 'success')) return;
  setBusy(elements.approveAllButton, true, 'Aprovando…');
  try { const result = await api.approveBatch(session.token, [], true); toast(`${result.approvedCount} ocorrência(s) aprovada(s).`, 'success'); selectedSupervisorIds.clear(); await refreshSupervisor(false); }
  catch (error) { toast(friendlyError(error), 'error'); } finally { setBusy(elements.approveAllButton, false); }
}

function confirmAction(title, message, actionLabel = 'Confirmar', tone = 'default') {
  elements.confirmTitle.textContent = title; elements.confirmMessage.textContent = message; elements.confirmActionButton.textContent = actionLabel;
  elements.confirmActionButton.className = `button ${tone === 'danger' ? 'button--danger' : tone === 'success' ? 'button--success' : tone === 'warning' ? 'button--warning' : 'button--primary'}`;
  elements.confirmIcon.textContent = tone === 'danger' ? '!' : tone === 'success' ? '✓' : '?'; elements.confirmDialog.showModal();
  return new Promise((resolve) => { const handler = () => { elements.confirmDialog.removeEventListener('close', handler); resolve(elements.confirmDialog.returnValue === 'confirm'); }; elements.confirmDialog.addEventListener('close', handler); });
}

function photoFallbackUrl(value) { const id = driveFileId(value); return id ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}` : ''; }
function handlePhotoLoadError(event) {
  const image = event.target.closest?.('img[data-fallback-src]'); if (!image) return;
  const fallback = image.dataset.fallbackSrc;
  if (!image.dataset.fallbackAttempted && fallback && image.src !== fallback) { image.dataset.fallbackAttempted = '1'; image.src = fallback; return; }
  image.removeAttribute('src'); image.alt = `${image.alt || 'Foto'} indisponível`; image.classList.add('is-photo-unavailable');
}
function galleryFromElement(target) {
  const container = target.closest('.review-photos, .supervisor-thumbs');
  return container ? $$('[data-zoom-src]', container).map((item) => ({ src: item.dataset.zoomSrc, label: item.dataset.zoomLabel || 'Evidência' })).filter((item) => item.src) : [];
}
function openPhotoFromElement(target) { openPhoto(target.dataset.zoomSrc, target.dataset.zoomLabel, galleryFromElement(target)); }
function handleZoomClick(event) { const target = event.target.closest('[data-zoom-src]'); if (target) openPhotoFromElement(target); }
function openPhoto(src, label = 'Evidência', gallery = []) {
  if (!src) return; photoGallery = gallery.length ? gallery : [{ src, label }]; photoGalleryIndex = Math.max(0, photoGallery.findIndex((item) => item.src === src));
  renderPhotoDialog(); elements.photoDialog.showModal();
}
function renderPhotoDialog() {
  const item = photoGallery[photoGalleryIndex] || {}; elements.photoDialogImage.src = item.src || ''; elements.photoDialogImage.dataset.fallbackSrc = photoFallbackUrl(item.src); delete elements.photoDialogImage.dataset.fallbackAttempted;
  elements.photoDialogLabel.textContent = item.label || `Foto ${photoGalleryIndex + 1}`; elements.photoPreviousButton.disabled = photoGallery.length < 2; elements.photoNextButton.disabled = photoGallery.length < 2;
}
function movePhotoGallery(direction) { if (photoGallery.length < 2) return; photoGalleryIndex = (photoGalleryIndex + direction + photoGallery.length) % photoGallery.length; renderPhotoDialog(); }
function emptyState(title, message) { return `<div class="empty-state card"><span aria-hidden="true">◇</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`; }

function friendlyError(error) {
  if (error?.code === 'INVALID_CREDENTIALS') return 'Nome, perfil ou senha inválidos.';
  if (error?.code === 'AUTH_REQUIRED') return 'Sua sessão expirou. Entre novamente.';
  if (error?.code === 'NETWORK_ERROR') return navigator.onLine ? 'Não foi possível falar com o servidor.' : 'Sem internet. Os dados continuam guardados neste aparelho.';
  if (error?.code === 'TIMEOUT') return 'A conexão demorou demais. A fila foi preservada para nova tentativa.';
  if (error?.code === 'ENDPOINT_NOT_CONFIGURED') return 'A publicação do backend ainda está sendo concluída.';
  return error?.message || 'Ocorreu um erro inesperado.';
}

initialize().catch((error) => { elements.loginMessage.textContent = friendlyError(error); toast(friendlyError(error), 'error'); });
