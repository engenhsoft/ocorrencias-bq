import {
  APP_BUILD, APP_VERSION, OCCURRENCE_TYPES, TEAM_GOAL, RECORD_STATUS, countConfirmedPhotos, countReadyPhotoStates, serviceSnapshotErrors, historicalServiceIndex, occurrenceSnapshotTotal,
  contractForBase, dailyGoalProjection, dedupeMaterialCatalog, driveFileId, escapeHtml, formatCurrency, formatDateTime, formatNumber,
  correctedAfterResend, correctionFields, correctionDataSnapshot, correctionOriginalSnapshot, correctionDelta, correctionConfirmationMatches, generateUuid, goalProgress, mergeRecordCollections, normalizePhotoUrl, normalizeTeamKey, openPhotoSyncRequest,
  materialKey, normalizeArray, normalizeMaterials, normalizeOccurrenceRecord, normalizeOccurrenceRecords, normalizeOccurrenceTypes, normalizePhotoStates, normalizeServices, normalizeText, occurrenceTotal, operationalDate, parseMaterialQuantity, parseServiceQuantity, photoIssueIndexes, reconcilePhotoStates, requiredPhotoDeficit, searchMaterialCatalog, serializeMaterialsForBackend, serializeServicesForBackend, serviceTotal,
  priceServiceForContract, repriceServicesForBase, supervisorCorrectionChanges, supervisorKpis, uniqueRecordsById,
  mineNeedsAttention, nextVisibleRecordId, supervisorDateWindow, validDateRange, occurrenceDate, dateInRange,
  sameUser, normalizeTeamDirectory, teamsForBase, teamDirectoryEntry,
  statusLabel, statusTone, tokenExpiry, validateOccurrence
} from './core.js?v=2026.10.07.2';
import {
  cacheCatalogResults, cacheMaterialCatalog, clearMetaIfValue, deletePhoto, deleteRecord, getAllRecords, getCachedMaterialCatalog, getMeta, getPhoto,
  getPhotosForRecord, getQueueSummary, getRecord, openDatabase, putPhotoAndRecord, putRecord,
  searchCachedCatalog, setMeta
} from './db.js?v=2026.10.07.2';
import { ApiError, api, blobToDataUrl, endpointConfigured, healthCheck, loadMaterialCatalog, loadOccurrenceDataset } from './api.js?v=2026.10.07.2';

const SESSION_KEY = 'ocorrencias-bq-session-v1';
const LAST_USER_KEY = 'ocorrencias-bq-last-user-v1';
const LAST_TEAM_KEY = 'ocorrencias-bq-last-team-v1';
const ACTIVE_DRAFT_META = 'activeDraftId';
const LAST_SYNC_META = 'lastSyncAt';
const TEAM_DIRECTORY_META = 'teamDirectory';
const RELEASE_NOTICE_KEY = `ocorrencias-bq-update-notice-seen-${APP_VERSION}`;
const TYPE_TRAFO = 'SUBSTITUIÇÃO DE TRAFO';
const TYPE_POST = 'SUBSTITUIÇÃO DE POSTE';
const TYPE_CONDUCTOR = 'SUBSTITUIÇÃO DE CONDUTOR';
const TYPE_OTHER = 'OUTRO';
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
  discardDraftButton: $('#discardDraftButton'), draftIdBadge: $('#draftIdBadge'), operationBase: $('#operationBase'), operationContract: $('#operationContract'), team: $('#team'),
  newTitle: $('#newTitle'), fieldCorrectionBanner: $('#fieldCorrectionBanner'), fieldCorrectionObservation: $('#fieldCorrectionObservation'), fieldCorrectionMeta: $('#fieldCorrectionMeta'),
  crewLeader: $('#crewLeader'), teamDirectoryHint: $('#teamDirectoryHint'), retryTeamDirectory: $('#retryTeamDirectory'),
  occurrenceNumber: $('#occurrenceNumber'), occurrenceTypes: $('#occurrenceTypes'),
  otherTypeSection: $('#otherTypeSection'), otherOccurrenceType: $('#otherOccurrenceType'),
  pgPostSection: $('#pgPostSection'), pgConductorSection: $('#pgConductorSection'),
  pgPostRemoved: $('#pgPostRemoved'), pgPostInstalled: $('#pgPostInstalled'),
  pgConductorStart: $('#pgConductorStart'), pgConductorEnd: $('#pgConductorEnd'), transformerSection: $('#transformerSection'),
  removedTransformerCode: $('#removedTransformerCode'), removedTransformerCia: $('#removedTransformerCia'),
  removedTransformerBto: $('#removedTransformerBto'), newTransformerCode: $('#newTransformerCode'),
  newTransformerCia: $('#newTransformerCia'), newTransformerBto: $('#newTransformerBto'),
  serviceSearch: $('#serviceSearch'), serviceResults: $('#serviceResults'), serviceSearchHint: $('#serviceSearchHint'),
  searchSpinner: $('#searchSpinner'), servicesList: $('#servicesList'), goalValue: $('#goalValue'),
  goalCard: $('#goalCard'), dailyTeamLabel: $('#dailyTeamLabel'), dailySentValue: $('#dailySentValue'),
  currentValue: $('#currentValue'), projectedValue: $('#projectedValue'), goalPercentage: $('#goalPercentage'), goalBar: $('#goalBar'),
  refreshDailyGoalButton: $('#refreshDailyGoalButton'),
  goalStatus: $('#goalStatus'), materialSearch: $('#materialSearch'), materialResults: $('#materialResults'),
  materialSearchHint: $('#materialSearchHint'), materialSearchSpinner: $('#materialSearchSpinner'), materialsList: $('#materialsList'),
  observation: $('#observation'), observationCount: $('#observationCount'), stepOneErrors: $('#stepOneErrors'),
  continueToPhotosButton: $('#continueToPhotosButton'), continueToReviewButton: $('#continueToReviewButton'),
  submitOccurrenceButton: $('#submitOccurrenceButton'), photoGrid: $('#photoGrid'), photoProgressChip: $('#photoProgressChip'),
  reviewSummary: $('#reviewSummary'), mineFilters: $('#mineFilters'), mineList: $('#mineList'), mineTeamSelect: $('#mineTeamSelect'),
  mineGoalCard: $('#mineGoalCard'), mineGoalValue: $('#mineGoalValue'), mineDailyValue: $('#mineDailyValue'),
  mineGoalPercentage: $('#mineGoalPercentage'), mineGoalBar: $('#mineGoalBar'), mineGoalStatus: $('#mineGoalStatus'),
  refreshMineButton: $('#refreshMineButton'), syncConnection: $('#syncConnection'), syncLastTest: $('#syncLastTest'),
  syncPendingRecords: $('#syncPendingRecords'), syncPendingPhotos: $('#syncPendingPhotos'),
  syncPhotosSyncing: $('#syncPhotosSyncing'), syncErrors: $('#syncErrors'), lastSyncAt: $('#lastSyncAt'),
  appVersion: $('#appVersion'), appBuild: $('#appBuild'), loginAppVersion: $('#loginAppVersion'),
  testConnectionButton: $('#testConnectionButton'), syncNowButton: $('#syncNowButton'),
  syncQueueList: $('#syncQueueList'), refreshSupervisorButton: $('#refreshSupervisorButton'), supervisorTitle: $('#supervisorTitle'),
  supervisorList: $('#supervisorList'), selectAllVisible: $('#selectAllVisible'), supervisorToolbar: $('#supervisorToolbar'),
  supervisorSearch: $('#supervisorSearch'), supervisorBaseFilter: $('#supervisorBaseFilter'), supervisorTeamFilter: $('#supervisorTeamFilter'), supervisorTypeFilter: $('#supervisorTypeFilter'), supervisorDateFrom: $('#supervisorDateFrom'), supervisorDateTo: $('#supervisorDateTo'), supervisorDatePresets: $('#supervisorDatePresets'), supervisorClearFilters: $('#supervisorClearFilters'), supervisorFilterSummary: $('#supervisorFilterSummary'),
  supervisorKpis: $('#supervisorKpis'), supervisorKpiTotal: $('#supervisorKpiTotal'), supervisorKpiWaiting: $('#supervisorKpiWaiting'), supervisorKpiCorrection: $('#supervisorKpiCorrection'), supervisorKpiRejected: $('#supervisorKpiRejected'), supervisorKpiSync: $('#supervisorKpiSync'),
  supervisorOccurrencesBadge: $('#supervisorOccurrencesBadge'), supervisorPendingBadge: $('#supervisorPendingBadge'), supervisorPublishedBadge: $('#supervisorPublishedBadge'), supervisorPhotosBadge: $('#supervisorPhotosBadge'), supervisorCorrectionBadge: $('#supervisorCorrectionBadge'), supervisorPendingFilters: $('#supervisorPendingFilters'),
  selectedCountLabel: $('#selectedCountLabel'), approveSelectedButton: $('#approveSelectedButton'),
  approveAllButton: $('#approveAllButton'), approveAllFooter: $('#approveAllFooter'),
  supervisorBatchResult: $('#supervisorBatchResult'), requestAllPhotoSyncButton: $('#requestAllPhotoSyncButton'), photoSyncBatchToolbar: $('#photoSyncBatchToolbar'),
  reviewDialog: $('#reviewDialog'), reviewDialogTitle: $('#reviewDialogTitle'), reviewDialogMode: $('#reviewDialogMode'),
  previousReviewButton: $('#previousReviewButton'), nextReviewButton: $('#nextReviewButton'), reviewPosition: $('#reviewPosition'),
  reviewDialogContent: $('#reviewDialogContent'), requestCorrectionButton: $('#requestCorrectionButton'),
  requestPhotoSyncButton: $('#requestPhotoSyncButton'), photoSyncRequests: $('#photoSyncRequests'),
  editOccurrenceButton: $('#editOccurrenceButton'), rejectButton: $('#rejectButton'), approveButton: $('#approveButton'), decisionDialog: $('#decisionDialog'), decisionForm: $('#decisionForm'),
  decisionDialogTitle: $('#decisionDialogTitle'), decisionOccurrenceContext: $('#decisionOccurrenceContext'), decisionOccurrenceSummary: $('#decisionOccurrenceSummary'), decisionReason: $('#decisionReason'), decisionReasonLabel: $('#decisionReasonLabel'), decisionNote: $('#decisionNote'), decisionNoteField: $('#decisionNoteField'), decisionPhotoSelector: $('#decisionPhotoSelector'), decisionPhotoChoices: $('#decisionPhotoChoices'), decisionError: $('#decisionError'),
  updateDialog: $('#updateDialog'), updateNowButton: $('#updateNowButton'), updateLaterButton: $('#updateLaterButton'),
  releaseNoticeDialog: $('#releaseNoticeDialog'), releaseNoticeAcknowledge: $('#releaseNoticeAcknowledge'),
  confirmDialog: $('#confirmDialog'), confirmTitle: $('#confirmTitle'), confirmMessage: $('#confirmMessage'),
  confirmActionButton: $('#confirmActionButton'), confirmIcon: $('#confirmIcon'), photoDialog: $('#photoDialog'),
  photoDialogImage: $('#photoDialogImage'), photoDialogLabel: $('#photoDialogLabel'), photoPreviousButton: $('#photoPreviousButton'),
  photoNextButton: $('#photoNextButton'), mineDetailDialog: $('#mineDetailDialog'), mineDetailTitle: $('#mineDetailTitle'),
  mineDetailContent: $('#mineDetailContent'), modeSupervisorButton: $('#modeSupervisorButton'),
  registerOccurrenceButton: $('#registerOccurrenceButton'), profileSwitchDialog: $('#profileSwitchDialog'),
  profileSwitchForm: $('#profileSwitchForm'), profileSwitchTitle: $('#profileSwitchTitle'), profileTargetLabel: $('#profileTargetLabel'),
  profileSwitchUser: $('#profileSwitchUser'), profileSwitchPassword: $('#profileSwitchPassword'),
  profileSwitchMessage: $('#profileSwitchMessage'), profileSwitchSubmit: $('#profileSwitchSubmit'),
  supervisorEditDialog: $('#supervisorEditDialog'), supervisorEditForm: $('#supervisorEditForm'), supervisorEditTitle: $('#supervisorEditTitle'),
  editOperationBase: $('#editOperationBase'), editOperationContract: $('#editOperationContract'), editTeam: $('#editTeam'), editCrewLeader: $('#editCrewLeader'), editTeamDirectoryHint: $('#editTeamDirectoryHint'), editRetryTeamDirectory: $('#editRetryTeamDirectory'), editOccurrenceNumber: $('#editOccurrenceNumber'), editOccurrenceTypes: $('#editOccurrenceTypes'),
  editOtherTypeSection: $('#editOtherTypeSection'), editOtherOccurrenceType: $('#editOtherOccurrenceType'),
  editPgPostSection: $('#editPgPostSection'), editPgConductorSection: $('#editPgConductorSection'),
  editPgPostRemoved: $('#editPgPostRemoved'), editPgPostInstalled: $('#editPgPostInstalled'),
  editPgConductorStart: $('#editPgConductorStart'), editPgConductorEnd: $('#editPgConductorEnd'), editTransformerSection: $('#editTransformerSection'),
  editRemovedTransformerCode: $('#editRemovedTransformerCode'), editRemovedTransformerCia: $('#editRemovedTransformerCia'),
  editRemovedTransformerBto: $('#editRemovedTransformerBto'), editNewTransformerCode: $('#editNewTransformerCode'),
  editNewTransformerCia: $('#editNewTransformerCia'), editNewTransformerBto: $('#editNewTransformerBto'),
  editServiceSearch: $('#editServiceSearch'), editServiceResults: $('#editServiceResults'), editServicesList: $('#editServicesList'),
  editMaterialSearch: $('#editMaterialSearch'), editMaterialResults: $('#editMaterialResults'), editMaterialsList: $('#editMaterialsList'), editObservation: $('#editObservation'),
  supervisorEditErrors: $('#supervisorEditErrors'), saveSupervisorEditButton: $('#saveSupervisorEditButton'), toastRegion: $('#toastRegion')
};

let session = readSession();
let sessionRevision = 0;
let loginRunning = false;
let profileSwitchRunning = false;
let activeRecord = null;
let activePhotos = new Map();
let previewUrls = new Map();
let currentStep = 1;
let currentView = 'new';
let catalogResults = [];
let catalogSearchTimer = 0;
let catalogSearchRequestId = 0;
let materialCatalog = [];
let materialCatalogPromise = null;
let materialCatalogOnlineLoaded = false;
let materialResults = [];
let materialSearchTimer = 0;
let materialSearchRequestId = 0;
let mineRecords = [];
let mineFilter = 'today';
let mineAutoFilterPending = false;
let mineTeam = '';
let supervisorRecords = [];
let supervisorPendingRecords = [];
let supervisorMetricRecords = [];
const publishedDetailCache = new Map();
const publishedDetailRequests = new Map();
let publishedVisibleLimit = 60;
let supervisorDataLoaded = false;
let supervisorTab = 'occurrences';
const emptySupervisorFilters = () => ({ search: '', base: '', team: '', type: '', from: '', to: '', mode: 'period' });
let supervisorFiltersByTab = { occurrences: emptySupervisorFilters(), pending: emptySupervisorFilters(), published: emptySupervisorFilters() };
let supervisorPendingFilter = 'photos';
let selectedSupervisorIds = new Set();
let supervisorLoadError = null;
let supervisorLoading = false;
let supervisorLoadState = 'idle';
let supervisorLastLoadedAt = '';
let activeSupervisorRecord = null;
let reviewOrder = [];
let reviewTab = 'occurrences';
let syncRunning = false;
let occurrenceSubmissionRunning = false;
let activeDraftSavePromise = null;
let supervisorRefreshPromise = null;
let supervisorRefreshRevision = -1;
let mineRefreshPromise = null;
let mineRefreshRevision = -1;
let mineServerDataLoaded = false;
let mineLoading = false;
let mineLoadError = null;
const recordSyncPromises = new Map();
const photoSelectionRequests = new Map();
let deferredInstallPrompt = null;
let supervisorRefreshTimer = 0;
let dailyProduction = { team: '', date: operationalDate(), goal: TEAM_GOAL, totalSent: 0, totalExcludingRecord: 0, recordContribution: 0 };
let dailyRequestId = 0;
let mineGoalRequestId = 0;
let dailyLoadTimer = 0;
let profileSwitchTarget = '';
let photoGallery = [];
let photoGalleryIndex = 0;
let supervisorEditRecord = null;
let supervisorEditCatalogResults = [];
let supervisorEditSearchTimer = 0;
let supervisorEditCatalogRequestId = 0;
let supervisorEditMaterialResults = [];
let supervisorEditMaterialSearchTimer = 0;
let supervisorEditMaterialRequestId = 0;
const supervisorPhotoFailures = new Map();
let confirmDialogPromise = null;
let supervisorMutationRunning = false;
let waitingServiceWorker = null;
let updateReloadRequested = false;
const photoSyncAttempts = new Set();
const photoSyncFeedback = new Map();
let photoSyncAllRunning = false;
let teamDirectory = [];
let teamDirectoryPromise = null;
let teamDirectoryLoading = false;
let teamDirectoryMessage = '';
let fieldAssignmentSnapshot = null;
let fieldServiceSnapshot = [];
let supervisorAssignmentSnapshot = null;

function readSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY));
    return value?.token && tokenExpiry(value.token) > Date.now() ? value : null;
  } catch { return null; }
}

function persistSession(value) {
  sessionRevision += 1;
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function clearSessionUiState() {
  clearInterval(supervisorRefreshTimer);
  clearTimeout(catalogSearchTimer);
  clearTimeout(materialSearchTimer);
  clearTimeout(dailyLoadTimer);
  clearTimeout(supervisorEditSearchTimer);
  clearTimeout(supervisorEditMaterialSearchTimer);
  catalogSearchRequestId += 1;
  materialSearchRequestId += 1;
  supervisorEditCatalogRequestId += 1;
  supervisorEditMaterialRequestId += 1;
  dailyRequestId += 1;
  mineGoalRequestId += 1;
  activeRecord = null;
  fieldServiceSnapshot = [];
  clearPreviewUrls();
  mineRecords = [];
  mineServerDataLoaded = false;
  mineLoading = false;
  mineLoadError = null;
  elements.photoSyncRequests.hidden = true;
  elements.photoSyncRequests.innerHTML = '';
  photoSyncAttempts.clear();
  photoSyncFeedback.clear();
  photoSyncAllRunning = false;
  mineFilter = 'today';
  mineAutoFilterPending = false;
  mineTeam = '';
  supervisorRecords = [];
  supervisorPendingRecords = [];
  supervisorMetricRecords = [];
  publishedDetailCache.clear(); publishedDetailRequests.clear();
  publishedVisibleLimit = 60;
  supervisorDataLoaded = false;
  supervisorTab = 'occurrences';
  supervisorFiltersByTab = { occurrences: emptySupervisorFilters(), pending: emptySupervisorFilters(), published: emptySupervisorFilters() };
  restoreSupervisorFilters();
  supervisorPendingFilter = 'photos';
  supervisorLoading = false;
  supervisorLoadState = 'idle';
  supervisorLastLoadedAt = '';
  supervisorLoadError = null;
  selectedSupervisorIds.clear();
  activeSupervisorRecord = null;
  reviewOrder = [];
  reviewTab = 'occurrences';
  supervisorEditRecord = null;
  supervisorEditCatalogResults = [];
  supervisorEditMaterialResults = [];
  supervisorPhotoFailures.clear();
  occurrenceSubmissionRunning = false;
  supervisorMutationRunning = false;
  photoGallery = [];
  photoGalleryIndex = 0;
  dailyProduction = emptyDailyProduction();
  for (const dialog of [elements.reviewDialog, elements.mineDetailDialog, elements.supervisorEditDialog, elements.profileSwitchDialog, elements.decisionDialog, elements.confirmDialog, elements.photoDialog]) {
    if (dialog?.open) dialog.close();
  }
  resetForm();
  elements.resumeBanner.hidden = true;
  elements.mineList.innerHTML = '';
  elements.mineTeamSelect.innerHTML = '<option value="">Nenhuma equipe</option>';
  elements.supervisorList.innerHTML = '';
  elements.supervisorKpis.setAttribute('aria-busy', 'true');
  [elements.supervisorKpiTotal, elements.supervisorKpiWaiting, elements.supervisorKpiCorrection, elements.supervisorKpiRejected, elements.supervisorKpiSync].forEach((item) => { item.textContent = '—'; });
  elements.supervisorOccurrencesBadge.textContent = '—'; elements.supervisorPendingBadge.textContent = '—'; elements.supervisorPublishedBadge.textContent = '—'; elements.supervisorPhotosBadge.textContent = '—'; elements.supervisorCorrectionBadge.textContent = '—';
  elements.supervisorNavCount.hidden = true;
  elements.selectAllVisible.checked = false;
  elements.selectAllVisible.indeterminate = false;
  elements.syncPendingRecords.textContent = '0';
  elements.syncPendingPhotos.textContent = '0';
  elements.syncPhotosSyncing.textContent = '0';
  elements.syncErrors.textContent = '0';
  elements.syncNavCount.hidden = true;
  elements.syncQueueList.innerHTML = '';
  setBusy(elements.refreshMineButton, false);
  setBusy(elements.refreshSupervisorButton, false);
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
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) { button.innerHTML = button.dataset.originalLabel; delete button.dataset.originalLabel; }
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
  elements.appVersion.textContent = APP_VERSION;
  elements.appBuild.textContent = `Build ${APP_BUILD}`;
  elements.loginAppVersion.textContent = `v${APP_VERSION}`;
  bindEvents();
  renderPhotoGrid();
  renderMaterials();
  renderServices();
  updateNetworkUi();
  elements.loginUser.value = localStorage.getItem(LAST_USER_KEY) || '';
  setupServiceWorker();
  // O armazenamento continua protegido por timeout, mas não faz parte da autenticação.
  void ensureLocalStorage().catch((error) => toast(friendlyError(error), 'error', 6000));
  if (session) await enterApplication();
  else { showLogin(); void updateQueueUi().catch((error) => console.error('[Fila] Falha ao atualizar o resumo local.', error)); }
}

async function ensureLocalStorage() {
  try { await openDatabase(); }
  catch (error) {
    console.error('[Armazenamento] Falha ao iniciar.', error);
    throw new ApiError('Armazenamento local indisponível. Feche outras abas do aplicativo e tente novamente.', 'LOCAL_STORAGE_UNAVAILABLE');
  }
}

async function loadTeamDirectory() {
  if (!session) return;
  const revision = sessionRevision; const requestSession = session;
  if (teamDirectoryPromise?.revision === revision) return teamDirectoryPromise.promise;
  teamDirectoryLoading = true; renderAssignmentControls(); renderAssignmentControls(true);
  const request = { revision, promise: null };
  teamDirectoryPromise = request;
  request.promise = (async () => {
    try {
      if (!teamDirectory.length) {
        const cached = await getMeta(TEAM_DIRECTORY_META);
        if (revision !== sessionRevision) return;
        if (cached?.entries) {
          try { teamDirectory = normalizeTeamDirectory(cached.entries); }
          catch (error) { console.warn('[Equipes] Cache inválido; aguardando relação oficial.', error); }
        }
        renderAssignmentControls(); renderAssignmentControls(true);
      }
      if (!navigator.onLine) {
        teamDirectoryMessage = teamDirectory.length ? 'Offline · usando a última relação válida.' : 'Não foi possível carregar a relação de equipes e chefes de turma. Conecte-se e tente novamente.';
        return;
      }
      const result = await api.getTeamDirectory(requestSession.token);
      const entries = normalizeTeamDirectory(result.entries);
      if (revision !== sessionRevision) return;
      teamDirectory = entries;
      teamDirectoryMessage = '';
      await setMeta(TEAM_DIRECTORY_META, { entries, revision: result.revision, fetchedAt: result.fetchedAt });
    } catch (error) {
      if (revision !== sessionRevision) return;
      console.warn('[Equipes] Falha ao atualizar relação.', error);
      teamDirectoryMessage = teamDirectory.length ? 'Não foi possível atualizar a relação. Usando a última relação válida; tente novamente.' : 'Não foi possível carregar a relação de equipes e chefes de turma. Tente novamente.';
    } finally {
      if (teamDirectoryPromise === request) { teamDirectoryPromise = null; teamDirectoryLoading = false; }
      if (revision === sessionRevision) {
        renderAssignmentControls(); renderAssignmentControls(true); validateStepOne(false);
      }
    }
  })();
  return request.promise;
}

function renderAssignmentControls(edit = false, selection = null) {
  const baseInput = edit ? elements.editOperationBase : elements.operationBase;
  const teamInput = edit ? elements.editTeam : elements.team;
  const chiefInput = edit ? elements.editCrewLeader : elements.crewLeader;
  const hint = edit ? elements.editTeamDirectoryHint : elements.teamDirectoryHint;
  const retry = edit ? elements.editRetryTeamDirectory : elements.retryTeamDirectory;
  const snapshot = edit ? supervisorAssignmentSnapshot : fieldAssignmentSnapshot;
  const base = baseInput.value;
  const chosen = selection?.team ?? teamInput.value;
  const preserved = snapshot && snapshot.base === base && snapshot.team === chosen;
  const options = teamsForBase(teamDirectory, base);
  const entry = teamDirectoryEntry(teamDirectory, base, chosen);
  teamInput.innerHTML = '<option value="">Selecione a equipe</option>' + options
    .filter((item) => !preserved || normalizeText(item.team) !== normalizeText(chosen))
    .map((item) => `<option value="${escapeHtml(item.team)}">${escapeHtml(item.team)}</option>`).join('');
  if (chosen && (preserved || !entry)) teamInput.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(chosen)}">${escapeHtml(chosen)} · ${preserved ? 'registrada' : 'rever cadastro'}</option>`);
  teamInput.value = preserved || !entry ? chosen : entry.team;
  chiefInput.value = preserved ? snapshot.crewLeader : entry?.crewLeader || selection?.crewLeader || (chosen ? chiefInput.value : '');
  teamInput.disabled = !base || !options.length;
  hint.textContent = teamDirectoryMessage || (teamDirectoryLoading && !teamDirectory.length ? 'Carregando relação de equipes…' : !teamDirectory.length ? 'Não foi possível carregar a relação de equipes e chefes de turma.' : base && !options.length ? `Não há equipes cadastradas para ${base} na relação oficial.` : preserved ? 'Dados registrados preservados. Ao trocar Base ou Equipe, será usada a relação atual.' : 'Escolha a equipe da Base; o chefe de turma será preenchido automaticamente.');
  retry.hidden = !teamDirectoryMessage && Boolean(teamDirectory.length) && !(base && !options.length);
  retry.disabled = teamDirectoryLoading;
  retry.textContent = teamDirectoryLoading ? 'Carregando…' : 'Tentar novamente';
}

function assignmentError(record, snapshot) {
  const unchanged = snapshot && ['base', 'team', 'crewLeader'].every((field) => record[field] === snapshot[field]);
  if (unchanged && (record.registeredAt || record.serverConfirmed || record.correctionMode)) return '';
  if (!teamDirectory.length) return 'Não foi possível carregar a relação de equipes e chefes de turma. Tente novamente.';
  if (!record.base) return '';
  const entry = teamDirectoryEntry(teamDirectory, record.base, record.team);
  if (!entry || normalizeText(entry.crewLeader) !== normalizeText(record.crewLeader)) return 'Selecione uma equipe e seu chefe de turma na relação da Base informada.';
  return '';
}

async function runLocalAction(action, ...args) {
  try { return await action(...args); }
  catch (error) {
    console.error('[Armazenamento] A ação local não foi confirmada.', { code: error?.code || error?.name });
    toast(friendlyError(error), 'error');
    return null;
  }
}

function bindEvents() {
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutButton.addEventListener('click', logout);
  elements.mainNav.addEventListener('click', (event) => {
    const target = event.target.closest('[data-nav]');
    if (target) navigate(target.dataset.nav);
  });
  $$('[data-nav].brand-lockup').forEach((button) => button.addEventListener('click', () => navigate(session?.role === 'supervisor' ? 'supervisor' : button.dataset.nav)));
  [elements.occurrenceNumber, elements.otherOccurrenceType,
    elements.pgPostRemoved, elements.pgPostInstalled, elements.pgConductorStart, elements.pgConductorEnd,
    elements.removedTransformerCode, elements.removedTransformerCia, elements.newTransformerCode,
    elements.removedTransformerBto, elements.newTransformerCia, elements.newTransformerBto,
    elements.observation].forEach((input) => input.addEventListener('input', (event) => void runLocalAction(handleFormInput, event)));
  elements.operationBase.addEventListener('change', (event) => {
    fieldAssignmentSnapshot = null; elements.team.value = ''; elements.crewLeader.value = '';
    renderAssignmentControls(); void runLocalAction(handleFormInput, event);
  });
  elements.team.addEventListener('change', (event) => {
    fieldAssignmentSnapshot = null;
    elements.crewLeader.value = teamDirectoryEntry(teamDirectory, elements.operationBase.value, elements.team.value)?.crewLeader || '';
    void runLocalAction(handleFormInput, event);
  });
  [elements.retryTeamDirectory, elements.editRetryTeamDirectory].forEach((button) => button.addEventListener('click', () => void loadTeamDirectory()));
  elements.occurrenceTypes.addEventListener('change', (event) => void runLocalAction(handleFormInput, event));
  elements.serviceSearch.addEventListener('input', (event) => void runLocalAction(handleCatalogInput, event));
  elements.serviceSearch.addEventListener('keydown', (event) => { if (event.key === 'Escape') elements.serviceResults.hidden = true; });
  elements.serviceResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-catalog-index]');
    if (button) void runLocalAction(selectCatalogItem, catalogResults[Number(button.dataset.catalogIndex)]);
  });
  elements.materialSearch.addEventListener('input', (event) => void runLocalAction(handleMaterialCatalogInput, event));
  elements.materialSearch.addEventListener('keydown', (event) => { if (event.key === 'Escape') elements.materialResults.hidden = true; });
  elements.materialResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-material-index]');
    if (button) void runLocalAction(selectMaterialCatalogItem, materialResults[Number(button.dataset.materialIndex)]);
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.catalog-search')) return;
    elements.serviceResults.hidden = true; elements.materialResults.hidden = true;
    elements.editServiceResults.hidden = true; elements.editMaterialResults.hidden = true;
  });
  elements.servicesList.addEventListener('input', (event) => void runLocalAction(handleServiceChange, event));
  elements.servicesList.addEventListener('click', (event) => void runLocalAction(handleServiceChange, event));
  elements.materialsList.addEventListener('input', (event) => void runLocalAction(handleMaterialChange, event));
  elements.materialsList.addEventListener('click', (event) => void runLocalAction(handleMaterialChange, event));
  elements.continueToPhotosButton.addEventListener('click', () => {
    if (validateStepOne(true)) goToStep(2);
  });
  elements.continueToReviewButton.addEventListener('click', () => { renderReview(); goToStep(3); });
  $$('[data-back-step]').forEach((button) => button.addEventListener('click', () => goToStep(Number(button.dataset.backStep))));
  elements.submitOccurrenceButton.addEventListener('click', submitOccurrence);
  elements.refreshDailyGoalButton.addEventListener('click', () => loadDailyProduction(elements.team.value, true));
  elements.photoGrid.addEventListener('click', (event) => void runLocalAction(handlePhotoGridClick, event));
  elements.transformerSection.addEventListener('click', (event) => void runLocalAction(handlePhotoGridClick, event));
  elements.resumeDraftButton.addEventListener('click', () => void runLocalAction(resumeDraft));
  elements.discardDraftButton.addEventListener('click', () => void runLocalAction(discardDraft));
  elements.refreshMineButton.addEventListener('click', () => refreshMine(true));
  elements.mineFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    mineFilter = button.dataset.filter;
    mineAutoFilterPending = false;
    renderMineFilters(); renderMineList();
  });
  elements.mineList.addEventListener('click', handleMineAction);
  elements.photoSyncRequests.addEventListener('click', (event) => {
    if (event.target.closest('[data-photo-sync-all]')) return void syncAllRequestedPhotos();
    const button = event.target.closest('[data-photo-sync-record]');
    if (button) void syncRequestedPhotos(button.dataset.photoSyncRecord);
  });
  elements.mineTeamSelect.addEventListener('change', () => { mineTeam = elements.mineTeamSelect.value; localStorage.setItem(LAST_TEAM_KEY, mineTeam); refreshMineGoal(false); });
  elements.testConnectionButton.addEventListener('click', testConnection);
  elements.syncNowButton.addEventListener('click', () => syncAll(true));
  elements.syncQueueList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sync-record]');
    if (button) syncSingleRecord(button.dataset.syncRecord, true);
  });
  elements.refreshSupervisorButton.addEventListener('click', () => refreshSupervisor(true));
  $$('.supervisor-tab').forEach((button) => button.addEventListener('click', () => {
    saveSupervisorFilters();
    supervisorTab = ['occurrences', 'pending', 'published'].includes(button.dataset.supervisorTab) ? button.dataset.supervisorTab : 'occurrences';
    restoreSupervisorFilters();
    selectedSupervisorIds.clear(); renderSupervisorNavigation(); renderSupervisorList();
  }));
  $$('.pending-filter').forEach((button) => button.addEventListener('click', () => {
    supervisorPendingFilter = button.dataset.supervisorPending === 'correction' ? 'correction' : 'photos';
    renderSupervisorNavigation(); renderSupervisorList();
  }));
  [elements.supervisorSearch, elements.supervisorBaseFilter, elements.supervisorTeamFilter, elements.supervisorTypeFilter, elements.supervisorDateFrom, elements.supervisorDateTo].forEach((input) => input.addEventListener('input', () => { saveSupervisorFilters(); publishedVisibleLimit = 60; renderSupervisorList(); }));
  [elements.supervisorDateFrom, elements.supervisorDateTo].forEach((input) => input.addEventListener('change', () => { saveSupervisorFilters(); publishedVisibleLimit = 60; renderSupervisorList(); }));
  elements.supervisorDatePresets.addEventListener('click', (event) => {
    const button = event.target.closest('[data-supervisor-date]'); if (!button) return;
    supervisorFiltersByTab[supervisorTab].mode = button.dataset.supervisorDate;
    publishedVisibleLimit = 60;
    updateSupervisorDateControls(); renderSupervisorList();
  });
  elements.supervisorClearFilters.addEventListener('click', () => {
    supervisorFiltersByTab[supervisorTab] = emptySupervisorFilters();
    if (supervisorTab === 'pending') supervisorPendingFilter = 'photos';
    publishedVisibleLimit = 60; restoreSupervisorFilters(); renderSupervisorList();
  });
  elements.supervisorList.addEventListener('click', handleSupervisorListClick);
  elements.supervisorList.addEventListener('change', handleSupervisorSelection);
  elements.selectAllVisible.addEventListener('change', selectAllSupervisorVisible);
  elements.approveSelectedButton.addEventListener('click', approveSelected);
  elements.approveAllButton.addEventListener('click', approveAll);
  elements.approveButton.addEventListener('click', () => decideSupervisor('approve'));
  elements.rejectButton.addEventListener('click', () => decideSupervisor('reject'));
  elements.requestCorrectionButton.addEventListener('click', () => decideSupervisor('request_correction'));
  elements.requestPhotoSyncButton.addEventListener('click', () => requestPhotoSync(activeSupervisorRecord?.recordId));
  elements.decisionForm.addEventListener('submit', validateDecisionSubmission);
  elements.editOccurrenceButton.addEventListener('click', openSupervisorEditor);
  elements.previousReviewButton.addEventListener('click', () => moveSupervisorReview(-1));
  elements.nextReviewButton.addEventListener('click', () => moveSupervisorReview(1));
  elements.supervisorEditForm.addEventListener('submit', saveSupervisorCorrection);
  $$('[data-close-supervisor-edit]').forEach((button) => button.addEventListener('click', () => elements.supervisorEditDialog.close()));
  elements.editOccurrenceTypes.addEventListener('change', syncSupervisorEditorFromForm);
  elements.editOperationBase.addEventListener('change', handleSupervisorBaseChange);
  elements.editTeam.addEventListener('change', () => {
    supervisorAssignmentSnapshot = null;
    elements.editCrewLeader.value = teamDirectoryEntry(teamDirectory, elements.editOperationBase.value, elements.editTeam.value)?.crewLeader || '';
    syncSupervisorEditorFromForm();
  });
  elements.requestAllPhotoSyncButton.addEventListener('click', requestAllPhotoSync);
  elements.editServiceSearch.addEventListener('input', searchSupervisorCatalog);
  elements.editServiceResults.addEventListener('click', selectSupervisorCatalogItem);
  elements.editServicesList.addEventListener('input', handleSupervisorServiceEdit);
  elements.editServicesList.addEventListener('click', handleSupervisorServiceEdit);
  elements.editMaterialSearch.addEventListener('input', searchSupervisorMaterials);
  elements.editMaterialResults.addEventListener('click', selectSupervisorMaterial);
  elements.editMaterialsList.addEventListener('input', handleSupervisorMaterialEdit);
  elements.editMaterialsList.addEventListener('click', handleSupervisorMaterialEdit);
  elements.reviewDialogContent.addEventListener('click', (event) => {
    if (event.target.closest('[data-published-retry]')) openSupervisorReview(activeSupervisorRecord?.recordId, true);
    else handleZoomClick(event);
  });
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
  window.addEventListener('online', () => {
    updateNetworkUi();
    if (session) void loadTeamDirectory();
    if (session?.role === 'field') void syncAll(false);
    void testConnection(false);
  });
  window.addEventListener('offline', updateNetworkUi);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && session?.role === 'field') { syncAll(false); loadDailyProduction(elements.team.value, false); }
    if (document.visibilityState === 'visible' && navigator.onLine && session?.role === 'supervisor' && supervisorDataLoaded && !supervisorMutationRunning) refreshSupervisor(false);
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); deferredInstallPrompt = event; elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null; elements.installButton.hidden = true;
  });
  elements.updateNowButton.addEventListener('click', () => {
    if (!waitingServiceWorker) return;
    updateReloadRequested = true;
    setBusy(elements.updateNowButton, true, 'Atualizando…');
    waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
  });
  elements.releaseNoticeDialog.addEventListener('close', () => {
    try { localStorage.setItem(RELEASE_NOTICE_KEY, '1'); }
    catch (error) { console.warn('[Atualização] Não foi possível registrar o aviso.', error); }
  });
  elements.updateDialog.addEventListener('close', showReleaseNoticeOnce);
}

function showReleaseNoticeOnce() {
  if (!session || elements.updateDialog.open || elements.releaseNoticeDialog.open) return;
  try {
    const controller = navigator.serviceWorker?.controller;
    if (controller && new URL(controller.scriptURL).searchParams.get('v') !== APP_VERSION) return;
    if (!localStorage.getItem(RELEASE_NOTICE_KEY)) elements.releaseNoticeDialog.showModal();
  } catch (error) { console.warn('[Atualização] Não foi possível mostrar o aviso.', error); }
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const requestedUrl = new URL(`./service-worker.js?v=${encodeURIComponent(APP_VERSION)}`, location.href);
    const controllerUrl = navigator.serviceWorker.controller?.scriptURL ? new URL(navigator.serviceWorker.controller.scriptURL) : null;
    const workerUrl = controllerUrl?.origin === requestedUrl.origin && controllerUrl.pathname === requestedUrl.pathname ? controllerUrl.href : requestedUrl.href;
    const registration = await navigator.serviceWorker.register(workerUrl, { scope: './' });
    const offerUpdate = (worker) => {
      if (!worker || !navigator.serviceWorker.controller) return;
      waitingServiceWorker = worker;
      if (!elements.updateDialog.open) elements.updateDialog.showModal();
    };
    if (registration.waiting) offerUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offerUpdate(worker);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateReloadRequested) { showReleaseNoticeOnce(); return; }
      const key = `ocorrencias-bq-reloaded-${APP_VERSION}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      location.reload();
    });
    registration.update().catch(() => {});
  } catch (error) {
    console.warn('[PWA] Não foi possível verificar atualização.', error);
  }
}

function showLogin() {
  elements.loginView.hidden = false; elements.appShell.hidden = true; clearInterval(supervisorRefreshTimer);
}

async function handleLogin(event) {
  event.preventDefault();
  if (loginRunning) return;
  const form = new FormData(elements.loginForm);
  const user = String(form.get('user') || '').trim();
  const password = String(form.get('password') || '');
  const role = String(form.get('role') || 'field');
  elements.loginMessage.textContent = '';
  if (!navigator.onLine) { elements.loginMessage.textContent = 'Faça o primeiro acesso online. Depois, a fila continuará funcionando sem internet.'; return; }
  loginRunning = true;
  setBusy(elements.loginButton, true, 'Entrando…');
  try {
    const result = await api.login(user, password, role);
    clearSessionUiState();
    persistSession({ token: result.token, user: result.user, role: result.role, expiresAt: tokenExpiry(result.token) });
    localStorage.setItem(LAST_USER_KEY, result.user);
    elements.loginPassword.value = '';
    await enterApplication();
  } catch (error) { elements.loginMessage.textContent = friendlyError(error); }
  finally { loginRunning = false; setBusy(elements.loginButton, false); }
}

async function enterApplication() {
  elements.loginView.hidden = true; elements.appShell.hidden = false;
  elements.sessionRoleLabel.textContent = session.role === 'supervisor' ? `Supervisor · ${session.user}` : `Campo · ${session.user}`;
  $$('[data-nav="new"], [data-nav="mine"]', elements.mainNav).forEach((item) => { item.hidden = session.role === 'supervisor'; });
  elements.supervisorNav.hidden = session.role !== 'supervisor';
  // Referência secundária: não bloqueia autenticação nem o painel.
  void loadTeamDirectory();
  if (session.role === 'supervisor') {
    elements.resumeBanner.hidden = true;
    navigate('supervisor');
    clearInterval(supervisorRefreshTimer);
    supervisorRefreshTimer = setInterval(() => {
      if (supervisorDataLoaded && document.visibilityState === 'visible' && navigator.onLine && !supervisorMutationRunning) refreshSupervisor(false);
    }, 90000);
  } else {
    navigate('new'); detectDraft().catch((error) => console.error('[Rascunho] Falha ao recuperar dados locais.', error));
    updateGoal(); refreshMine(false); if (navigator.onLine) { syncAll(false); loadDailyProduction(elements.team.value, false); }
  }
  updateQueueUi().catch((error) => console.error('[Fila] Falha ao atualizar o resumo local.', error));
  setTimeout(showReleaseNoticeOnce, 0);
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
  if (profileSwitchRunning) return;
  const user = elements.profileSwitchUser.value.trim(); const password = elements.profileSwitchPassword.value;
  elements.profileSwitchMessage.textContent = '';
  if (!navigator.onLine) { elements.profileSwitchMessage.textContent = 'A troca de perfil precisa de conexão para validar a senha.'; return; }
  profileSwitchRunning = true;
  setBusy(elements.profileSwitchSubmit, true, 'Autenticando…');
  try {
    const result = await api.login(user, password, profileSwitchTarget);
    clearSessionUiState();
    persistSession({ token: result.token, user: result.user, role: result.role, expiresAt: tokenExpiry(result.token) });
    localStorage.setItem(LAST_USER_KEY, result.user); elements.profileSwitchPassword.value = '';
    clearInterval(supervisorRefreshTimer); await enterApplication();
    toast(result.role === 'supervisor' ? 'Modo Supervisor autenticado.' : 'Modo operacional autenticado.', 'success');
  } catch (error) { elements.profileSwitchMessage.textContent = friendlyError(error); }
  finally { profileSwitchRunning = false; setBusy(elements.profileSwitchSubmit, false); }
}

function logout() { persistSession(null); clearSessionUiState(); showLogin(); }

function navigate(view) {
  if (view === 'supervisor' && currentView !== 'supervisor') {
    saveSupervisorFilters(); supervisorTab = 'occurrences'; restoreSupervisorFilters();
  }
  if (view === 'mine' && currentView !== 'mine') {
    mineAutoFilterPending = true;
    mineFilter = mineRecords.some(mineNeedsAttention) ? 'attention' : 'today';
    renderMineFilters(); renderMineList();
  }
  currentView = view;
  $$('.view').forEach((section) => { const active = section.id === `view-${view}`; section.hidden = !active; section.classList.toggle('is-active', active); });
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.nav === view));
  if (view === 'new' && session?.role === 'field') loadDailyProduction(elements.team.value, false);
  if (view === 'mine') refreshMine(false);
  if (view === 'sync') updateQueueUi();
  const pendingNavigation = view === 'supervisor' ? refreshSupervisor(false) : null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return pendingNavigation;
}

function blankRecord() {
  const now = new Date().toISOString();
  return {
    recordId: generateUuid(), status: RECORD_STATUS.DRAFT, serverStatus: '', serverConfirmed: false, step: 1,
    operationalDate: operationalDate(),
    base: '', contract: '', team: '', crewLeader: '', occurrenceNumber: '', occurrenceTypes: [], otherOccurrenceType: '',
    pgPostRemoved: '', pgPostInstalled: '', pgConductorStart: '', pgConductorEnd: '',
    transformer: { removedCode: '', removedCia: '', removedBto: '', newCode: '', newCia: '', newBto: '' },
    services: [], materials: [], observation: '',
    photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: false, localReady: false, serverUrl: '', uploadKey: '', replacePending: false })),
    transformerPhotos: { removed: '', installed: '' },
    correctionMode: false, attempts: 0, lastError: '', createdAt: now, updatedAt: now, user: session?.user || ''
  };
}

async function ensureActiveRecord() {
  if (activeRecord) return activeRecord;
  const record = blankRecord(); const revision = sessionRevision; activeRecord = record;
  await putRecord(record);
  if (revision !== sessionRevision || activeRecord?.recordId !== record.recordId) return record;
  await setMeta(ACTIVE_DRAFT_META, record.recordId);
  if (revision === sessionRevision && activeRecord?.recordId === record.recordId) showDraftId();
  return record;
}

function selectedTypes() { return $$('input[type="checkbox"]:checked', elements.occurrenceTypes).map((input) => input.value); }

function syncFormToRecord() {
  if (!activeRecord) return;
  activeRecord.base = elements.operationBase.value;
  activeRecord.contract = contractForBase(activeRecord.base);
  activeRecord.team = elements.team.value.trim();
  activeRecord.crewLeader = elements.crewLeader.value.trim();
  activeRecord.occurrenceNumber = elements.occurrenceNumber.value.trim();
  activeRecord.occurrenceTypes = selectedTypes();
  activeRecord.otherOccurrenceType = activeRecord.occurrenceTypes.includes(TYPE_OTHER) ? elements.otherOccurrenceType.value.trim() : '';
  activeRecord.pgPostRemoved = (activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_POST)) ? elements.pgPostRemoved.value.trim() : '';
  activeRecord.pgPostInstalled = (activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_POST)) ? elements.pgPostInstalled.value.trim() : '';
  activeRecord.pgConductorStart = (activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_CONDUCTOR)) ? elements.pgConductorStart.value.trim() : '';
  activeRecord.pgConductorEnd = (activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_CONDUCTOR)) ? elements.pgConductorEnd.value.trim() : '';
  activeRecord.transformer = (activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_TRAFO)) ? {
    removedCode: elements.removedTransformerCode.value.trim(), removedCia: elements.removedTransformerCia.value.trim(),
    removedBto: elements.removedTransformerBto.value.trim(), newCode: elements.newTransformerCode.value.trim(),
    newCia: elements.newTransformerCia.value.trim(), newBto: elements.newTransformerBto.value.trim()
  } : { removedCode: '', removedCia: '', removedBto: '', newCode: '', newCia: '', newBto: '' };
  activeRecord.observation = elements.observation.value.trim();
  activeRecord.transformerPhotos = {
    removed: activeRecord.photoStates?.[5]?.serverUrl || activeRecord.transformerPhotos?.removed || '',
    installed: activeRecord.photoStates?.[6]?.serverUrl || activeRecord.transformerPhotos?.installed || ''
  };
  activeRecord.totalServices = occurrenceSnapshotTotal(activeRecord.services, fieldServiceSnapshot, activeRecord.recordId);
  activeRecord.goalPercentage = dailyGoalProjection(dailyProduction.totalExcludingRecord, activeRecord.totalServices).percentage;
}

function updateContractOutput(output, base) {
  if (output) output.textContent = contractForBase(base) || 'Selecione a Sub-base';
}

function applyContractToRecord(record) {
  const result = repriceServicesForBase(record?.services, record?.base);
  record.contract = result.contract;
  record.services = result.services.map((service, index) => historicalServiceIndex(record.services[index], fieldServiceSnapshot, record.recordId) >= 0 ? record.services[index] : service);
  result.services = record.services;
  result.missingCodes = record.services.filter((service) => service.referenceValue == null).map((service) => service.code || service.catalogKey || 'sem código');
  record.totalServices = occurrenceSnapshotTotal(record.services, fieldServiceSnapshot, record.recordId);
  return result;
}

function servicePriceText(service) {
  return service?.referenceValue == null || !Number.isFinite(Number(service.referenceValue))
    ? 'Sem valor para o contrato'
    : formatCurrency(service.referenceValue);
}

async function handleFormInput(event) {
  if (occurrenceSubmissionRunning) return;
  const revision = sessionRevision; const record = await ensureActiveRecord();
  if (occurrenceSubmissionRunning || revision !== sessionRevision || !activeRecord || (record && activeRecord.recordId !== record.recordId)) return;
  const previousBase = activeRecord.base;
  syncFormToRecord();
  if (event?.target === elements.operationBase && activeRecord.base !== previousBase) {
    clearTimeout(catalogSearchTimer);
    catalogSearchRequestId += 1;
    catalogResults = [];
    elements.searchSpinner.hidden = true;
    elements.serviceResults.hidden = true;
    const result = applyContractToRecord(activeRecord);
    renderServices();
    if (result.missingCodes.length && activeRecord.services.length && result.contract) toast(`Serviço sem valor cadastrado para o contrato ${result.contract}.`, 'error');
    if (elements.serviceSearch.value.trim().length >= 2) void runLocalAction(handleCatalogInput);
  }
  updateContractOutput(elements.operationContract, activeRecord.base);
  elements.transformerSection.hidden = !(activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_TRAFO));
  elements.pgPostSection.hidden = !(activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_POST));
  elements.pgConductorSection.hidden = !(activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_CONDUCTOR));
  elements.otherTypeSection.hidden = !activeRecord.occurrenceTypes.includes(TYPE_OTHER);
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
  const requestSession = session; const revision = sessionRevision;
  if (!team) { dailyProduction = emptyDailyProduction(); updateGoal(); return dailyProduction; }
  let cached = await getMeta(dailyCacheKey(team, date));
  if (requestId !== dailyRequestId) return dailyProduction;
  if (cached) { dailyProduction = { ...emptyDailyProduction(team), ...cached, team, date, totalExcludingRecord: Number(cached.totalSent) || 0 }; updateGoal(); }
  if (!navigator.onLine || !endpointConfigured() || requestSession?.role !== 'field') return dailyProduction;
  try {
    const result = await api.getDailyTeamProduction(requestSession.token, team, date, activeRecord?.recordId || '');
    if (requestId !== dailyRequestId || revision !== sessionRevision || normalizeTeamKey(elements.team.value) !== normalizeTeamKey(team)) return dailyProduction;
    dailyProduction = { ...emptyDailyProduction(team), ...result };
    await setMeta(dailyCacheKey(team, date), { team, date, goal: result.goal, totalSent: result.totalSent, percentage: result.percentage, status: result.status });
    updateGoal(); if (notify) toast('Produção diária atualizada.', 'success'); return dailyProduction;
  } catch (error) { if (notify) toast(friendlyError(error), 'error'); return dailyProduction; }
}

async function saveActiveDraft() {
  if (!activeRecord || occurrenceSubmissionRunning) return;
  activeRecord.step = currentStep; activeRecord.updatedAt = new Date().toISOString(); activeRecord.user = session?.user || activeRecord.user;
  const record = JSON.parse(JSON.stringify(activeRecord)); const revision = sessionRevision;
  const previous = activeDraftSavePromise;
  const task = (async () => {
    if (previous) await previous.catch(() => {});
    await putRecord(record);
    if (revision !== sessionRevision || activeRecord?.recordId !== record.recordId) return;
    await setMeta(ACTIVE_DRAFT_META, record.recordId);
    if (revision === sessionRevision && activeRecord?.recordId === record.recordId) showDraftId();
  })();
  activeDraftSavePromise = task;
  try { await task; }
  finally { if (activeDraftSavePromise === task) activeDraftSavePromise = null; }
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
  if (!record || (record.user && record.user !== session?.user)) return; await loadRecordIntoForm(record); elements.resumeBanner.hidden = true; navigate('new');
}

async function discardDraft() {
  const recordId = await getMeta(ACTIVE_DRAFT_META); if (!recordId) return;
  const record = await getRecord(recordId); if (!record || (record.user && record.user !== session?.user)) return;
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
  if (activeRecord) void saveActiveDraft().catch((error) => { console.error('[Rascunho] Falha ao salvar etapa.', error); toast('Não foi possível salvar o rascunho neste aparelho.', 'error'); }); window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleCatalogInput() {
  const query = elements.serviceSearch.value.trim(); const revision = sessionRevision;
  clearTimeout(catalogSearchTimer); const requestId = ++catalogSearchRequestId;
  if (query) await ensureActiveRecord();
  if (revision !== sessionRevision || requestId !== catalogSearchRequestId || elements.serviceSearch.value.trim() !== query) return;
  if (query.length < 2) {
    elements.searchSpinner.hidden = true; elements.serviceResults.hidden = true;
    elements.serviceSearchHint.textContent = 'Digite pelo menos 2 caracteres.'; return;
  }
  if (!contractForBase(elements.operationBase.value)) {
    elements.searchSpinner.hidden = true; elements.serviceResults.hidden = true;
    elements.serviceSearchHint.textContent = 'Selecione a Sub-base para definir o contrato e os valores dos serviços.'; return;
  }
  catalogSearchTimer = setTimeout(() => searchCatalog(query, requestId), 260);
}

async function searchCatalog(query, requestId) {
  const requestSession = session; const revision = sessionRevision;
  const isCurrent = () => requestId === catalogSearchRequestId && revision === sessionRevision && elements.serviceSearch.value.trim() === query;
  elements.searchSpinner.hidden = false;
  elements.serviceSearchHint.textContent = navigator.onLine ? 'Pesquisando na aba Emergência…' : 'Sem internet: pesquisando itens salvos neste aparelho.';
  try {
    const results = navigator.onLine ? (await api.searchCatalog(requestSession.token, query, 40, contractForBase(elements.operationBase.value))).results : await searchCachedCatalog(query, 40);
    if (!isCurrent()) return;
    const currentResults = normalizeArray(results, 'searchCatalog.results').filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (navigator.onLine) await cacheCatalogResults(currentResults).catch(error => console.warn('[Serviços] Resultado disponível; cache local indisponível.', { code: error?.code || error?.name }));
    if (!isCurrent()) return;
    catalogResults = currentResults; renderCatalogResults();
  } catch (error) {
    if (!isCurrent()) return;
    let cached = [];
    try { cached = await searchCachedCatalog(query, 40); }
    catch (cacheError) { console.error('[Serviços] Não foi possível ler o cache local.', { code: cacheError?.code || cacheError?.name }); }
    if (!isCurrent()) return;
    catalogResults = normalizeArray(cached, 'cachedCatalog.results').filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    renderCatalogResults(error);
  } finally { if (isCurrent()) elements.searchSpinner.hidden = true; }
}

function renderCatalogResults(error = null) {
  const contract = contractForBase(elements.operationBase.value);
  if (!contract) {
    elements.serviceResults.hidden = true;
    elements.serviceSearchHint.textContent = 'Selecione a Sub-base para definir o contrato e os valores dos serviços.';
    return;
  }
  elements.serviceResults.hidden = false;
  if (!catalogResults.length) {
    elements.serviceResults.innerHTML = `<div class="search-empty">${escapeHtml(error ? 'Servidor indisponível e nenhum resultado salvo.' : 'Nenhum serviço encontrado na aba Emergência.')}</div>`;
    elements.serviceSearchHint.textContent = error ? friendlyError(error) : 'Tente outro código ou palavra.'; return;
  }
  elements.serviceResults.innerHTML = catalogResults.map((item, index) => {
    const priced = priceServiceForContract(item, contract);
    return `<button class="search-result" type="button" role="option" data-catalog-index="${index}">
    <span class="search-result__top"><strong>${escapeHtml(item.code)}</strong><small>Emergência</small></span>
    <span>${escapeHtml(item.catalogText || 'Sem descrição')}</span>
    <span class="search-result__meta"><b>${escapeHtml(item.unit || '—')}</b><span>${escapeHtml(item.group || '')}</span><span>Contrato ${escapeHtml(contract)}</span><span>${escapeHtml(servicePriceText(priced))}</span></span>
  </button>`;
  }).join('');
  elements.serviceSearchHint.textContent = `${catalogResults.length} resultado(s). Toque para adicionar.`;
}

async function selectCatalogItem(item) {
  if (!item) return; const revision = sessionRevision; const record = await ensureActiveRecord();
  if (revision !== sessionRevision || !activeRecord || (record && activeRecord.recordId !== record.recordId)) return;
  const contract = contractForBase(elements.operationBase.value);
  if (!contract) { toast('Selecione a Sub-base para definir o contrato e os valores dos serviços.', 'error'); return; }
  const priced = priceServiceForContract(item, contract);
  if (priced.referenceValue == null) { toast(`Serviço sem valor cadastrado para o contrato ${contract}.`, 'error'); return; }
  const catalogKey = item.catalogKey || item.catalogKeys?.[0] || '';
  if (activeRecord.services.some((service) => service.catalogKey === catalogKey)) { toast('Este serviço já foi adicionado.', 'error'); return; }
  activeRecord.contract = contract;
  activeRecord.services.push({ ...priced, lineId: generateUuid(), catalogKey, code: item.code, catalogText: item.catalogText || '', unit: item.unit || '', group: item.group || '', quantity: 1, totalValue: priced.referenceValue, origin: 'Emergência' });
  elements.serviceSearch.value = ''; elements.serviceResults.hidden = true; catalogResults = [];
  renderServices(); validateStepOne(false); await saveActiveDraft();
}

function renderServices() {
  const services = normalizeServices(activeRecord?.services);
  if (!services.length) {
    elements.servicesList.innerHTML = '<div class="line-items__empty">Nenhum serviço selecionado.</div>'; updateGoal(); return;
  }
  elements.servicesList.innerHTML = services.map((service, index) => `<article class="line-item" data-service-line="${escapeHtml(service.lineId)}">
    <div class="line-item__main"><div><span class="line-item__index">${index + 1}</span><strong>${escapeHtml(service.code)}</strong><p>${escapeHtml(service.catalogText)}</p><small>${escapeHtml(service.unit || '—')} ${service.group ? `· ${escapeHtml(service.group)}` : ''} · Contrato ${escapeHtml(service.contract || activeRecord.contract || '—')}</small></div><button class="icon-button delete-photo" type="button" data-remove-service="${escapeHtml(service.lineId)}" aria-label="Remover serviço">×</button></div>
    <div class="line-item__values"><label class="field"><span>QTD *</span><input type="text" inputmode="decimal" data-service-quantity="${escapeHtml(service.lineId)}" value="${escapeHtml(service.quantity)}" /></label><div><span>Valor unitário</span><strong>${escapeHtml(servicePriceText(service))}</strong></div><div><span>Valor total</span><strong data-service-total="${escapeHtml(service.lineId)}">${escapeHtml(service.referenceValue == null ? 'Indisponível' : formatCurrency(serviceTotal(service)))}</strong></div></div>
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
      if (parseServiceQuantity(service.quantity) !== parseServiceQuantity(quantity.value)) service.totalValue = occurrenceSnapshotTotal([{ ...service, quantity: quantity.value }], fieldServiceSnapshot, activeRecord.recordId);
      service.quantity = quantity.value;
      const total = $(`[data-service-total="${CSS.escape(service.lineId)}"]`, elements.servicesList);
      if (total) total.textContent = formatCurrency(serviceTotal(service));
    }
  }
  updateGoal(); validateStepOne(false); await saveActiveDraft();
}

function updateGoal() {
  const current = occurrenceSnapshotTotal(activeRecord?.services || [], fieldServiceSnapshot, activeRecord?.recordId);
  const base = normalizeTeamKey(dailyProduction.team) === normalizeTeamKey(elements.team.value) && dailyProduction.date === operationalDate() ? Number(dailyProduction.totalExcludingRecord) || 0 : 0;
  const progress = dailyGoalProjection(base, current, TEAM_GOAL);
  elements.goalValue.textContent = formatCurrency(TEAM_GOAL); elements.dailySentValue.textContent = formatCurrency(base); elements.currentValue.textContent = formatCurrency(current); elements.projectedValue.textContent = formatCurrency(progress.projectedTotal);
  elements.dailyTeamLabel.textContent = elements.team.value.trim() ? `Meta diária · ${elements.team.value.trim()}` : 'Meta diária da equipe';
  elements.goalPercentage.textContent = `${formatNumber(progress.percentage)}%`; elements.goalBar.style.width = `${progress.visualPercentage}%`;
  elements.goalStatus.textContent = progress.label; elements.goalStatus.className = `goal-status goal-status--${progress.state}`;
  elements.goalCard.classList.toggle('is-achieved', progress.state === 'atingida'); elements.goalCard.classList.toggle('is-exceeded', progress.state === 'superada');
}

async function ensureMaterialCatalog(refreshOnline = false) {
  if (!materialCatalog.length) materialCatalog = dedupeMaterialCatalog(await getCachedMaterialCatalog());
  if (!navigator.onLine || (materialCatalogOnlineLoaded && !refreshOnline)) return materialCatalog;
  if (!materialCatalogPromise) {
    materialCatalogPromise = (async () => {
      try {
        const loaded = dedupeMaterialCatalog(await loadMaterialCatalog());
        if (loaded.length) {
          materialCatalog = loaded;
          materialCatalogOnlineLoaded = true;
          await cacheMaterialCatalog(loaded);
        }
      } catch (error) {
        if (!materialCatalog.length) throw error;
        console.warn('[Materiais] Caderno de Obras indisponível; usando catálogo local.', error);
      }
      return materialCatalog;
    })().finally(() => { materialCatalogPromise = null; });
  }
  return materialCatalogPromise;
}

async function handleMaterialCatalogInput() {
  const query = elements.materialSearch.value.trim(); const revision = sessionRevision;
  clearTimeout(materialSearchTimer); const requestId = ++materialSearchRequestId;
  if (query) await ensureActiveRecord();
  if (revision !== sessionRevision || requestId !== materialSearchRequestId || elements.materialSearch.value.trim() !== query) return;
  if (query.length < 2) {
    elements.materialSearchSpinner.hidden = true; elements.materialResults.hidden = true;
    elements.materialSearchHint.textContent = 'Digite pelo menos 2 caracteres.'; return;
  }
  materialSearchTimer = setTimeout(() => searchMaterials(query, requestId), 220);
}

async function searchMaterials(query, requestId) {
  const revision = sessionRevision;
  elements.materialSearchSpinner.hidden = false;
  elements.materialSearchHint.textContent = navigator.onLine ? 'Carregando o Caderno de Materiais…' : 'Sem internet: pesquisando materiais salvos neste aparelho.';
  let error = null;
  try { await ensureMaterialCatalog(); }
  catch (caught) {
    error = caught;
    try { materialCatalog = dedupeMaterialCatalog(await getCachedMaterialCatalog()); }
    catch (cacheError) { console.error('[Materiais] Falha ao ler o catálogo local.', cacheError); materialCatalog = []; }
  }
  if (requestId !== materialSearchRequestId || revision !== sessionRevision || elements.materialSearch.value.trim() !== query) return;
  materialResults = searchMaterialCatalog(materialCatalog, query, 40); renderMaterialResults(error);
  elements.materialSearchSpinner.hidden = true;
}

function renderMaterialResults(error = null) {
  elements.materialResults.hidden = false;
  if (!materialResults.length) {
    elements.materialResults.innerHTML = `<div class="search-empty">${escapeHtml(error ? 'Catálogo indisponível e nenhum resultado salvo.' : 'Nenhum material encontrado no Caderno de Materiais.')}</div>`;
    elements.materialSearchHint.textContent = error ? friendlyError(error) : 'Tente outro código ou palavra.'; return;
  }
  elements.materialResults.innerHTML = materialResults.map((item, index) => `<button class="search-result" type="button" role="option" data-material-index="${index}">
    <span class="search-result__top"><strong>${escapeHtml(item.code)}</strong></span>
    <span>${escapeHtml(item.description)}</span>
    <span class="search-result__meta"><b>${escapeHtml(item.unit)}</b></span>
  </button>`).join('');
  elements.materialSearchHint.textContent = `${materialResults.length} resultado(s). Toque para adicionar.`;
}

async function selectMaterialCatalogItem(item) {
  if (!item) return; const revision = sessionRevision; const record = await ensureActiveRecord();
  if (revision !== sessionRevision || !activeRecord || (record && activeRecord.recordId !== record.recordId)) return;
  const key = materialKey(item);
  if (normalizeMaterials(activeRecord.materials).some((material) => materialKey(material) === key)) {
    toast('Este material já foi adicionado.', 'error'); return;
  }
  activeRecord.materials.push({ ...item, lineId: generateUuid(), materialKey: key, quantity: 1, origin: 'Caderno de Obras' });
  elements.materialSearch.value = ''; elements.materialResults.hidden = true; materialResults = [];
  renderMaterials(); validateStepOne(false); await saveActiveDraft();
}

function materialQuantityMarkup(material) {
  const integer = String(material.unit || '').trim().toUpperCase() === 'UN';
  return `<label class="field material-quantity"><span>QTD *</span><div class="quantity-with-unit"><input type="text" inputmode="${integer ? 'numeric' : 'decimal'}" data-material-quantity="${escapeHtml(material.lineId)}" value="${escapeHtml(material.quantity)}" aria-label="Quantidade de ${escapeHtml(material.description)}" /><strong>${escapeHtml(material.unit || '')}</strong></div></label>`;
}

function renderMaterials() {
  const materials = normalizeMaterials(activeRecord?.materials);
  if (!materials.length) { elements.materialsList.innerHTML = '<div class="line-items__empty">Nenhum material selecionado.</div>'; return; }
  elements.materialsList.innerHTML = materials.map((material, index) => `<article class="line-item material-row" data-material-line="${escapeHtml(material.lineId)}">
    <div class="line-item__main"><div><span class="line-item__index">${index + 1}</span>${material.code ? `<strong>${escapeHtml(material.code)}</strong>` : ''}<p>${escapeHtml(material.description)}</p>${material.unit ? `<small>Unidade: ${escapeHtml(material.unit)}</small>` : '<small>Registro histórico sem código/unidade</small>'}</div><button class="icon-button delete-photo" type="button" data-remove-material="${escapeHtml(material.lineId)}" aria-label="Remover material">×</button></div>
    <div class="line-item__fields">${materialQuantityMarkup(material)}</div>
  </article>`).join('');
}

async function handleMaterialChange(event) {
  if (!activeRecord) return;
  const remove = event.target.closest('[data-remove-material]');
  const quantity = event.target.closest('[data-material-quantity]');
  if (remove) {
    activeRecord.materials = normalizeMaterials(activeRecord.materials).filter((item) => item.lineId !== remove.dataset.removeMaterial);
    renderMaterials();
  }
  if (quantity) {
    const item = activeRecord.materials.find((row) => row.lineId === quantity.dataset.materialQuantity);
    if (item) item.quantity = quantity.value;
  }
  validateStepOne(false); await saveActiveDraft();
}

function validateStepOne(showErrors = false) {
  if (activeRecord) syncFormToRecord();
  const errors = activeRecord ? validateOccurrence(activeRecord, { originalServices: fieldServiceSnapshot }) : ['Preencha os dados da ocorrência.'];
  const relationError = activeRecord && assignmentError(activeRecord, fieldAssignmentSnapshot);
  if (relationError) errors.push(relationError);
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
  const revision = sessionRevision; const recordId = activeRecord?.recordId || '';
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
  if (capture) input.setAttribute('capture', 'environment'); input.hidden = true;
  input.addEventListener('change', async () => { const file = input.files?.[0]; input.remove(); if (file && revision === sessionRevision && (activeRecord?.recordId || '') === recordId) await storeSelectedPhoto(photoIndex, file, replace); }, { once: true });
  document.body.append(input); input.click();
}

async function storeSelectedPhoto(photoIndex, file, replace) {
  const revision = sessionRevision; const initialRecordId = activeRecord?.recordId || ''; let request = null;
  const isCurrent = () => revision === sessionRevision && (!initialRecordId || activeRecord?.recordId === initialRecordId) && (!request || (activeRecord?.recordId === request.recordId && photoSelectionRequests.get(photoIndex) === request));
  try {
    await ensureActiveRecord();
    if (!isCurrent() || !activeRecord) return;
    request = { recordId: activeRecord.recordId }; photoSelectionRequests.set(photoIndex, request);
    const blob = await optimizePhoto(file);
    if (!isCurrent()) return;
    if (blob.size > 9 * 1024 * 1024) throw new ApiError('A foto ficou acima de 9 MB mesmo após a otimização.', 'PHOTO_TOO_LARGE');
    const uploadKey = generateUuid(); const state = activeRecord.photoStates[photoIndex - 1] || { photoIndex };
    const previousPhotoStates = activeRecord.photoStates.slice(); const photoStates = previousPhotoStates.slice();
    photoStates[photoIndex - 1] = { ...state, photoIndex, confirmed: false, localReady: true, uploadKey, replacePending: replace || Boolean(state.replacePending || state.confirmed || state.serverUrl), error: '' };
    const stored = await putPhotoAndRecord({ ...activeRecord, photoStates }, photoIndex, blob, uploadKey, { fileName: file.name, mimeType: blob.type });
    if (!isCurrent()) return;
    activeRecord = { ...activeRecord, updatedAt: stored.record.updatedAt, photoStates: stored.record.photoStates.map((savedState, index) => index !== photoIndex - 1 && activeRecord.photoStates[index] !== previousPhotoStates[index] ? activeRecord.photoStates[index] : savedState) };
    activePhotos.set(photoIndex, { blob, uploadKey }); setPreviewUrl(photoIndex, URL.createObjectURL(blob));
    await saveActiveDraft(); if (isCurrent()) { updatePhotoGrid(); validateStepOne(false); }
  } catch (error) { if (isCurrent()) toast(friendlyError(error), 'error'); }
  finally { if (photoSelectionRequests.get(photoIndex) === request) photoSelectionRequests.delete(photoIndex); }
}

async function optimizePhoto(file) {
  if (!file.type.startsWith('image/')) throw new ApiError('Escolha um arquivo de imagem.', 'INVALID_PHOTO_TYPE');
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image(); image.decoding = 'async'; image.src = sourceUrl; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false }); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84)) || file;
  } catch { if (file.size <= 9 * 1024 * 1024) return file; throw new ApiError('Este formato não pôde ser otimizado neste aparelho. Use JPG ou PNG.', 'PHOTO_OPTIMIZATION_FAILED'); }
  finally { URL.revokeObjectURL(sourceUrl); }
}

async function removePhoto(photoIndex) {
  const state = activeRecord?.photoStates?.[photoIndex - 1]; if (!state) return;
  if (state.confirmed && !state.replacePending) { toast('Uma foto confirmada pode ser substituída, mas não removida isoladamente.', 'error'); return; }
  const revision = sessionRevision; const recordId = activeRecord.recordId; const request = { recordId };
  photoSelectionRequests.set(photoIndex, request);
  const isCurrent = () => revision === sessionRevision && activeRecord?.recordId === recordId && photoSelectionRequests.get(photoIndex) === request && activeRecord.photoStates[photoIndex - 1]?.uploadKey === state.uploadKey;
  try {
    const deleted = await deletePhoto(recordId, photoIndex, state.uploadKey || '');
    if (!isCurrent()) return;
    if (!deleted && await getPhoto(recordId, photoIndex)) return;
    if (!isCurrent()) return;
    activePhotos.delete(photoIndex); revokePreviewUrl(photoIndex);
    activeRecord.photoStates[photoIndex - 1] = { photoIndex, confirmed: Boolean(state.serverUrl), localReady: false, serverUrl: state.serverUrl || '', uploadKey: '', replacePending: false };
    await saveActiveDraft();
    if (revision === sessionRevision && activeRecord?.recordId === recordId && photoSelectionRequests.get(photoIndex) === request) { updatePhotoGrid(); validateStepOne(false); }
  } finally { if (photoSelectionRequests.get(photoIndex) === request) photoSelectionRequests.delete(photoIndex); }
}

function setPreviewUrl(index, url) { revokePreviewUrl(index); previewUrls.set(index, url); }
function revokePreviewUrl(index) { const current = previewUrls.get(index); if (current?.startsWith('blob:')) URL.revokeObjectURL(current); previewUrls.delete(index); }
function clearPreviewUrls() { for (const index of [...previewUrls.keys()]) revokePreviewUrl(index); activePhotos.clear(); photoSelectionRequests.clear(); }

function updatePhotoGrid() {
  let ready = 0;
  for (let index = 1; index <= 7; index += 1) {
    const state = activeRecord?.photoStates?.[index - 1] || {}; const local = Boolean(state.localReady) || activePhotos.has(index);
    const url = normalizePhotoUrl(previewUrls.get(index) || state.serverUrl || ''); const present = local || Boolean(url) || state.confirmed; if (present && index <= 5) ready += 1;
    const card = $(`[data-photo-card="${index}"]`); const preview = $(`[data-photo-preview="${index}"]`); const status = $(`[data-photo-status="${index}"]`); const secondary = $(`[data-photo-secondary="${index}"]`);
    if (card && index > 5) card.hidden = !normalizeOccurrenceTypes(activeRecord?.occurrenceTypes).includes(TYPE_TRAFO);
    card?.classList.toggle('has-photo', present);
    const label = index === 6 ? 'Evidência do transformador retirado' : index === 7 ? 'Evidência do transformador instalado' : `Foto ${index}`;
    if (preview) preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" data-fallback-src="${escapeHtml(photoFallbackUrl(url))}" />` : '<div class="photo-card__placeholder"><span aria-hidden="true">▧</span><span>Nenhuma evidência</span></div>';
    if (status) { status.textContent = state.confirmed && !state.replacePending ? 'Confirmada' : present ? 'Pronta' : 'Pendente'; status.className = `status-chip ${state.confirmed && !state.replacePending ? 'status-chip--success' : present ? 'status-chip--info' : 'status-chip--neutral'}`; }
    if (secondary) { secondary.hidden = !present; const button = $('[data-photo-delete]', secondary); if (button) button.hidden = Boolean(state.confirmed && !state.replacePending && !local); }
  }
  elements.photoProgressChip.textContent = `${ready}/5 fotos`; elements.photoProgressChip.className = `status-chip ${ready >= 3 ? 'status-chip--success' : 'status-chip--warning'}`;
  elements.continueToReviewButton.disabled = ready < 3;
}

function serviceTable(services = []) {
  services = normalizeServices(services);
  return `<div class="detail-section"><h4>Serviços</h4><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th>Contrato</th><th>QTD</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${services.map((service) => `<tr><td data-label="Código">${escapeHtml(service.code)}</td><td data-label="Descrição">${escapeHtml(service.catalogText)}</td><td data-label="Unidade">${escapeHtml(service.unit)}</td><td data-label="Contrato">${escapeHtml(service.contract || '—')}</td><td data-label="QTD">${escapeHtml(formatNumber(service.quantity))}</td><td data-label="Unitário">${escapeHtml(servicePriceText(service))}</td><td data-label="Total">${escapeHtml(service.referenceValue == null ? 'Indisponível' : formatCurrency(serviceTotal(service)))}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function materialTable(materials = []) {
  materials = normalizeMaterials(materials);
  return `<div class="detail-section"><h4>Materiais aplicados</h4><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Código</th><th>Descrição</th><th>Unidade</th><th>Quantidade</th></tr></thead><tbody>${materials.map((material) => {
    const quantity = parseMaterialQuantity(material.quantity);
    const quantityText = Number.isFinite(quantity) ? formatNumber(quantity) : String(material.quantity || '').trim();
    return `<tr><td data-label="Código">${escapeHtml(material.code || '')}</td><td data-label="Descrição">${escapeHtml(material.description)}</td><td data-label="Unidade">${escapeHtml(material.unit || '')}</td><td data-label="Quantidade">${escapeHtml(quantityText)}${quantityText && material.unit ? ` ${escapeHtml(material.unit)}` : ''}</td></tr>`;
  }).join('')}</tbody></table></div></div>`;
}

function photoUrlsForRecord(record = {}) {
  return Array.from({ length: 5 }, (_, index) => normalizePhotoUrl(
    record.photos?.[index] || record.photoStates?.[index]?.serverUrl || record.photoStates?.[index]?.url || previewUrls.get(index + 1) || ''
  ));
}

function photoMarkup(record) {
  return `<div class="review-photos">${photoUrlsForRecord(record).map((url, index) => url
    ? `<figure class="review-photo" data-photo-index="${index + 1}" data-record-photo-id="${escapeHtml(record.recordId || '')}"><img src="${escapeHtml(url)}" alt="Foto ${index + 1}" data-zoom-src="${escapeHtml(url)}" data-zoom-label="Foto ${index + 1}" data-fallback-src="${escapeHtml(photoFallbackUrl(url))}" /><span>Foto ${index + 1}</span></figure>`
    : `<figure class="review-photo review-photo--empty"><div class="photo-card__placeholder"><span aria-hidden="true">▧</span><span>Foto ${index + 1} indisponível</span></div><span>Foto ${index + 1}</span></figure>`).join('')}</div>`;
}

function transformerPhotoMarkup(record, kind) {
  const index = kind === 'removed' ? 6 : 7;
  const label = kind === 'removed' ? 'Evidência do transformador retirado' : 'Evidência do transformador instalado';
  const url = normalizePhotoUrl(record.transformerPhotos?.[kind] || record.photoStates?.[index - 1]?.serverUrl || record.photoStates?.[index - 1]?.url || previewUrls.get(index) || '');
  if (!url && !normalizeOccurrenceTypes(record.occurrenceTypes).includes(TYPE_TRAFO)) return '';
  return url
    ? `<figure class="review-photo transformer-review-photo" data-photo-index="${index}" data-record-photo-id="${escapeHtml(record.recordId || '')}"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" data-zoom-src="${escapeHtml(url)}" data-zoom-label="${escapeHtml(label)}" data-fallback-src="${escapeHtml(photoFallbackUrl(url))}" /><span>${escapeHtml(label)}</span></figure>`
    : `<figure class="review-photo review-photo--empty transformer-review-photo"><div class="photo-card__placeholder"><span aria-hidden="true">▧</span><span>Indisponível</span></div><span>${escapeHtml(label)}</span></figure>`;
}

function correctionRequest(record) {
  const audit = record?.audit && typeof record.audit === 'object' ? record.audit : {};
  const request = audit.lastCorrectionRequest || audit.lastPhotoCorrectionRequest || {};
  return {
    reason: String(request.reason || record?.reason || '').trim(),
    note: String(request.note || record?.supervisorNote || request.reason || record?.reason || '').trim(),
    supervisor: String(request.supervisor || record?.supervisor || '').trim(),
    requestedAt: request.requestedAt || record?.reviewedAt || '',
    lastRequestedAt: request.lastRequestedAt || request.requestedAt || record?.reviewedAt || '',
    photoIndexes: correctionPhotoIndexes(record)
  };
}

function correctionRequestMarkup(record) {
  if ((record?.status || record?.serverStatus) !== RECORD_STATUS.CORRECTION_REQUESTED) return '';
  const request = correctionRequest(record);
  const meta = [request.supervisor ? `Supervisor: ${request.supervisor}` : '', request.requestedAt ? formatDateTime(request.lastRequestedAt || request.requestedAt) : ''].filter(Boolean).join(' · ');
  const photos = request.photoIndexes.length ? `Fotos solicitadas: ${request.photoIndexes.map(photoIndexLabel).join(', ')}` : '';
  return `<section class="correction-request-callout"><strong>CORREÇÃO SOLICITADA PELO SUPERVISOR</strong><p>${escapeHtml(request.note || request.reason || 'Consulte o Supervisor responsável.')}</p>${photos ? `<small>${escapeHtml(photos)}</small>` : ''}${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</section>`;
}

function auditMarkup(record) {
  const audit = record?.audit && typeof record.audit === 'object' ? record.audit : {};
  const corrections = normalizeArray(record?.audit?.supervisorCorrections, 'audit.supervisorCorrections')
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  const recalculations = normalizeArray(record?.audit?.contractRecalculations, 'audit.contractRecalculations')
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  const timeline = normalizeArray(audit.timeline, 'audit.timeline')
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({ action: String(item.action || ''), at: item.at || item.timestamp || '', actor: item.actor || '', detail: item.detail || '' }))
    .filter((item) => item.action && item.at);
  if (record.registeredAt || record.createdAt) timeline.push({ action: 'CRIADA', at: record.registeredAt || record.createdAt, actor: record.user || '', detail: '' });
  corrections.forEach((item) => timeline.push({ action: 'CORRIGIDA_PELO_SUPERVISOR', at: item.correctedAt, actor: item.supervisor || '', detail: '' }));
  const lastRequest = audit.lastCorrectionRequest || audit.lastPhotoCorrectionRequest;
  if (lastRequest?.requestedAt) timeline.push({ action: 'CORRECAO_SOLICITADA', at: lastRequest.requestedAt, actor: lastRequest.supervisor || '', detail: lastRequest.note || lastRequest.reason || normalizeArray(lastRequest.photoIndexes).map(photoIndexLabel).join(', ') });
  const currentStatus = record.status || record.serverStatus;
  if (currentStatus && (record.updatedAt || record.reviewedAt)) timeline.push({ action: currentStatus, at: record.reviewedAt || record.updatedAt, actor: record.supervisor || '', detail: record.reason || '' });
  const uniqueTimeline = [...new Map(timeline.map((item) => [`${item.action}|${item.at}|${item.actor}`, item])).values()]
    .sort((left, right) => String(left.at).localeCompare(String(right.at)));
  const labels = { CRIADA: 'Criada', SALVA_LOCALMENTE: 'Salva localmente', PENDENTE_ENVIO: 'Pendente', SINCRONIZADA: 'Sincronizada', AGUARDANDO_SUPERVISOR: 'Aguardando supervisor', CORRECAO_SOLICITADA: 'Correção solicitada', CORRECAO_FOTOS_SOLICITADA: 'Correção solicitada', CORRECAO_REENVIADA: 'Correção reenviada', CORRIGIDA_PELO_SUPERVISOR: 'Corrigida pelo supervisor', SINCRONISMO_SOLICITADO: 'Sincronismo solicitado', SINCRONISMO_CONFIRMADO: 'Fotos sincronizadas', REPROVADA: 'Reprovada', APROVADA: 'Aprovada', APROVADA_E_PUBLICADA: 'Aprovada e publicada', PUBLICADA: 'Publicada', FOTOS_SENDO_SINCRONIZADAS: 'Fotos em sincronização' };
  const timelineEntries = uniqueTimeline.map((item) => `<article class="audit-entry"><div class="audit-entry__title"><strong>${escapeHtml(labels[item.action] || item.action.replaceAll('_', ' '))}</strong><time>${escapeHtml(formatDateTime(item.at))}</time></div>${item.actor || item.detail ? `<p>${escapeHtml([item.actor, item.detail].filter(Boolean).join(' · '))}</p>` : ''}</article>`).join('');
  const correctionEntries = corrections.map((item) => {
    const changes = normalizeArray(item.changes, 'audit.changes')
      .filter((change) => change && typeof change === 'object' && !Array.isArray(change));
    return `<article class="audit-entry"><div class="audit-entry__title"><strong>✓ Corrigido pelo supervisor — ${escapeHtml(item.supervisor || 'Supervisor')}</strong><time>${escapeHtml(formatDateTime(item.correctedAt))}</time></div><div class="audit-changes">${changes.map((change) => `<div><span>${escapeHtml(change.field)}</span><del>${escapeHtml(displayAuditValue(change.previousValue))}</del><ins>${escapeHtml(displayAuditValue(change.newValue))}</ins></div>`).join('')}</div></article>`;
  }).join('');
  const recalculationEntries = recalculations.map((item) => `<article class="audit-entry"><div class="audit-entry__title"><strong>Valor recalculado conforme contrato da Sub-base.</strong><time>${escapeHtml(formatDateTime(item.recalculatedAt))}</time></div><div class="audit-changes"><div><span>Sub-base</span><del>${escapeHtml(item.base || '—')}</del><ins>${escapeHtml(item.base || '—')}</ins></div><div><span>Contrato</span><del>${escapeHtml(item.previousContract || '—')}</del><ins>${escapeHtml(item.contract || '—')}</ins></div><div><span>Total</span><del>${escapeHtml(formatCurrency(item.previousTotal))}</del><ins>${escapeHtml(formatCurrency(item.newTotal))}</ins></div></div></article>`).join('');
  return `<section class="audit-timeline"><h4>Timeline da ocorrência</h4>${timelineEntries || '<p>Sem eventos adicionais comprováveis.</p>'}${correctionEntries}${recalculationEntries}</section>`;
}

function displayAuditValue(value) {
  if (value == null || value === '') return '—';
  const text = String(value);
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed.map((item) => typeof item === 'object' ? JSON.stringify(item) : item).join(' · ') || '—' : typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed); }
  catch { return text; }
}

function dailyDetailMarkup(record) {
  const total = occurrenceTotal(record.services || []); const daily = record.dailyProduction;
  const totalSent = Number(daily?.totalSent) || (record.serverConfirmed ? total : 0); const progress = goalProgress(totalSent, Number(daily?.goal) || TEAM_GOAL);
  return `<section class="daily-detail"><span class="live-indicator"><i></i> Ao vivo</span><div class="daily-detail__values"><div><span>Valor desta ocorrência</span><strong>${escapeHtml(formatCurrency(total))}</strong></div><div><span>Produção da equipe no dia</span><strong>${escapeHtml(formatCurrency(totalSent))} / ${escapeHtml(formatCurrency(Number(daily?.goal) || TEAM_GOAL))}</strong></div><div><span>Percentual diário</span><strong>${escapeHtml(formatNumber(progress.percentage))}%</strong></div></div></section>`;
}

function occurrenceTypesText(record = {}) {
  return normalizeOccurrenceTypes(record.occurrenceTypes).map((type) => (
    type === TYPE_OTHER && record.otherOccurrenceType ? `${TYPE_OTHER} — ${record.otherOccurrenceType}` : type
  )).join(' · ');
}

function occurrenceDetails(record, includePhotos = true) {
  const total = occurrenceTotal(record.services || []);
  const occurrenceTypes = normalizeOccurrenceTypes(record.occurrenceTypes);
  const transformer = (occurrenceTypes.includes(TYPE_TRAFO) || Object.values(record.transformer || {}).some(value => String(value ?? '').trim())) ? `<div class="detail-section"><h4>Transformadores</h4><div class="review-data__grid"><div><dt>Transformador retirado</dt><dd>Série: ${escapeHtml(record.transformer?.removedCode || '—')}<br>CIA: ${escapeHtml(record.transformer?.removedCia || '—')}<br>BTO: ${escapeHtml(record.transformer?.removedBto || '—')}</dd>${transformerPhotoMarkup(record, 'removed')}</div><div><dt>Transformador instalado</dt><dd>Série: ${escapeHtml(record.transformer?.newCode || '—')}<br>CIA: ${escapeHtml(record.transformer?.newCia || '—')}<br>BTO: ${escapeHtml(record.transformer?.newBto || '—')}</dd>${transformerPhotoMarkup(record, 'installed')}</div></div></div>` : '';
  const pgPost = (occurrenceTypes.includes(TYPE_POST) || record.pgPostRemoved || record.pgPostInstalled) ? `<div class="detail-section"><h4>PG do Poste</h4><div class="review-data__grid"><div><dt>PG retirado</dt><dd>${escapeHtml(record.pgPostRemoved || '—')}</dd></div><div><dt>PG instalado</dt><dd>${escapeHtml(record.pgPostInstalled || '—')}</dd></div></div></div>` : '';
  const pgConductor = (occurrenceTypes.includes(TYPE_CONDUCTOR) || record.pgConductorStart || record.pgConductorEnd) ? `<div class="detail-section"><h4>PG do Condutor</h4><div class="review-data__grid"><div><dt>PG inicial</dt><dd>${escapeHtml(record.pgConductorStart || '—')}</dd></div><div><dt>PG final</dt><dd>${escapeHtml(record.pgConductorEnd || '—')}</dd></div></div></div>` : '';
  const otherType = occurrenceTypes.includes(TYPE_OTHER) ? `<div><dt>Tipo avulso</dt><dd>${escapeHtml(record.otherOccurrenceType || '—')}</dd></div>` : '';
  const photos = includePhotos ? photoMarkup(record) : '';
  const status = record.status || record.serverStatus || RECORD_STATUS.DRAFT;
  return `${correctedAfterResend(record) ? '<span class="status-chip status-chip--success corrected-badge">CORRIGIDO</span>' : ''}${correctionRequestMarkup(record)}${dailyDetailMarkup(record)}${auditMarkup(record)}<dl class="review-data"><div class="review-data__grid"><div><dt>UUID</dt><dd>${escapeHtml(record.recordId || '—')}</dd></div><div><dt>Enviado por</dt><dd>${escapeHtml(record.user || '—')}</dd></div><div><dt>Sub-base</dt><dd>${escapeHtml(record.base || '—')}</dd></div><div><dt>Contrato</dt><dd>${escapeHtml(record.contract || '—')}</dd></div><div><dt>Equipe</dt><dd>${escapeHtml(record.team)}</dd></div><div><dt>Chefe de turma</dt><dd>${escapeHtml(record.crewLeader || '—')}</dd></div><div><dt>Nº ocorrência</dt><dd>${escapeHtml(record.occurrenceNumber)}</dd></div><div><dt>Tipo(s)</dt><dd>${escapeHtml(occurrenceTypesText(record))}</dd></div>${otherType}<div><dt>Total dos serviços</dt><dd>${escapeHtml(formatCurrency(total))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(statusLabel(status, countConfirmedPhotos(record)))}</dd></div><div><dt>Registrado em</dt><dd>${escapeHtml(formatDateTime(record.registeredAt || record.createdAt))}</dd></div><div><dt>Atualizado em</dt><dd>${escapeHtml(formatDateTime(record.updatedAt))}</dd></div>${status === RECORD_STATUS.PUBLISHED ? `<div><dt>Publicada em</dt><dd>${escapeHtml(formatDateTime(record.publishedAt || record.approvedAt || record.reviewedAt))}</dd></div>` : ''}</div>${transformer}${pgPost}${pgConductor}<div><dt>Observação</dt><dd>${escapeHtml(record.observation || '—')}</dd></div></dl>${serviceTable(record.services)}${materialTable(record.materials)}${photos}`;
}

function renderReview() { if (activeRecord) { syncFormToRecord(); activeRecord.dailyProduction = { ...dailyProduction, totalSent: Number(dailyProduction.totalExcludingRecord) || 0 }; elements.reviewSummary.innerHTML = occurrenceDetails(activeRecord); } }

async function submitOccurrence() {
  if (occurrenceSubmissionRunning) return;
  if (!activeRecord || !validateStepOne(true) || countReadyPhotoStates(activeRecord) < 3) { toast('Complete os dados e adicione pelo menos 3 fotos da ocorrência.', 'error'); return; }
  if (photoSelectionRequests.size) { toast('Aguarde o preparo das fotos antes de enviar.', 'error'); return; }
  syncFormToRecord();
  const candidate = JSON.parse(JSON.stringify(activeRecord)); const revision = sessionRevision;
  if (candidate.correctionMode) {
    if (!candidate.correctionOriginal) { toast('Atualize a lista e abra novamente a correção para confirmar os dados originais. Sua edição foi preservada.', 'error'); return; }
    Object.assign(candidate, correctionDelta(candidate.correctionOriginal, candidate));
    if (![candidate.expectedPatch, candidate.photoPatch, candidate.evidencePatch].some(patch => Object.keys(patch).length)) {
      toast('Nenhuma alteração foi detectada. Faça a correção solicitada antes de reenviar.', 'error'); return;
    }
  }
  const requestedWithoutReplacement = activeRecord.correctionMode
    ? normalizeArray(activeRecord.requestedPhotoIndexes, 'requestedPhotoIndexes').map(Number).filter((index) => !activeRecord.photoStates?.[index - 1]?.localReady)
    : [];
  if (requestedWithoutReplacement.length) { toast(`Adicione novamente: ${requestedWithoutReplacement.map(photoIndexLabel).join(', ')}.`, 'error'); return; }
  occurrenceSubmissionRunning = true;
  let locallyQueued = false;
  let submittedId = '';
  const previousStatus = activeRecord.status;
  try {
    if (!await confirmAction('Enviar para conferência?', 'Deseja enviar esta ocorrência para conferência do supervisor?', 'Enviar', 'success')) return;
    if (revision !== sessionRevision || activeRecord?.recordId !== candidate.recordId) return;
    submittedId = candidate.recordId;
    candidate.status = RECORD_STATUS.PENDING; candidate.lastError = '';
    setBusy(elements.submitOccurrenceButton, true, 'Guardando…');
    if (activeDraftSavePromise) await activeDraftSavePromise;
    if (revision !== sessionRevision || activeRecord?.recordId !== submittedId) return;
    await putRecord(candidate); locallyQueued = true;
    await clearMetaIfValue(ACTIVE_DRAFT_META, submittedId);
    toast('Ocorrência guardada na fila. A sincronização continuará automaticamente.');
    void syncSingleRecord(submittedId, false).then((result) => {
      if (result?.status === RECORD_STATUS.WAITING_SUPERVISOR) toast('Ocorrência enviada para conferência.', 'success');
      else if (result?.status === RECORD_STATUS.ERROR) toast(result.lastError || 'Falha ao sincronizar. Tente novamente pela fila.', 'error', 5200);
    }).catch((error) => { console.error('[Fila] Falha ao sincronizar ocorrência guardada.', error); toast('Falha ao sincronizar. O registro continua guardado para nova tentativa.', 'error'); });
  } catch (error) {
    console.error('[Envio] Falha ao preparar ocorrência na fila.', error);
    if (!locallyQueued && activeRecord?.recordId === submittedId) activeRecord.status = previousStatus;
    toast(locallyQueued ? 'Ocorrência guardada neste aparelho. Abra a fila para tentar sincronizar.' : 'Não foi possível guardar a ocorrência neste aparelho. Tente novamente.', 'error');
  } finally {
    occurrenceSubmissionRunning = false; setBusy(elements.submitOccurrenceButton, false);
    if (locallyQueued && activeRecord?.recordId === submittedId) {
      const wasInForm = currentView === 'new';
      resetForm({ preserveTeam: true });
      if (wasInForm) navigate('mine');
    }
  }
}

async function cacheDailySummary(summary, updateCurrentUi = true) {
  if (!summary?.team || !summary?.date) return;
  await setMeta(dailyCacheKey(summary.team, summary.date), { team: summary.team, date: summary.date, goal: summary.goal, totalSent: summary.totalSent, percentage: summary.percentage, status: summary.status });
  const current = typeof updateCurrentUi === 'function' ? updateCurrentUi() : updateCurrentUi;
  if (current && normalizeTeamKey(elements.team.value) === normalizeTeamKey(summary.team)) { dailyProduction = { ...emptyDailyProduction(summary.team), ...summary }; updateGoal(); }
}

async function syncSingleRecord(recordId, notify = true) {
  const running = recordSyncPromises.get(recordId);
  if (running) {
    if (notify) toast('Esta ocorrência já está sendo sincronizada.');
    return running;
  }
  const task = performSyncSingleRecord(recordId, notify);
  recordSyncPromises.set(recordId, task);
  try { return await task; }
  finally { if (recordSyncPromises.get(recordId) === task) recordSyncPromises.delete(recordId); }
}

async function performSyncSingleRecord(recordId, notify = true) {
  const requestSession = session; const revision = sessionRevision;
  const storedRecord = await getRecord(recordId); if (!storedRecord || !requestSession || requestSession.role !== 'field') return null;
  const record = normalizeOccurrenceRecord(storedRecord, 'localRecord');
  if (record.user && !sameUser(record.user, requestSession.user)) {
    console.warn('[Fila] Registro pertence a outro usuário; sincronização ignorada.', { recordId });
    return null;
  }
  if (!navigator.onLine) {
    record.status = RECORD_STATUS.PENDING; record.lastError = 'Sem internet';
    try { await putRecord(record, { expectedUpdatedAt: String(storedRecord.updatedAt || '') }); }
    catch (error) { if (error?.code === 'LOCAL_RECORD_CHANGED') return getRecord(recordId); throw error; }
    await updateQueueUi(); if (notify) toast('Sem internet. O registro continua guardado neste aparelho.'); return record;
  }
  const dailyTotalExcludingRecord = Number(dailyProduction.totalExcludingRecord) || 0;
  let next = { ...record, attempts: (record.attempts || 0) + 1, lastAttemptAt: new Date().toISOString(), lastError: '' };
  let localVersion = String(storedRecord.updatedAt || '');
  const save = async () => {
    const stored = await putRecord(next, { expectedUpdatedAt: localVersion });
    localVersion = String(stored?.updatedAt || next.updatedAt || localVersion);
    if (stored) next = stored;
  };
  const cacheSummary = summary => { void cacheDailySummary(summary, () => revision === sessionRevision && session?.token === requestSession.token).catch(error => console.warn('[Produção] Confirmação mantida; cache secundário indisponível.', { code: error?.code || error?.name })); };
  const markSynced = () => { void setMeta(LAST_SYNC_META, next.syncedAt).catch(error => console.warn('[Fila] Confirmação mantida; data do último sincronismo não pôde ser armazenada.', { code: error?.code || error?.name })); };
  let correctionPayload = null;
  let dataCommitConfirmed = false; let photoSyncStarted = false;
  try {
    if (next.correctionMode) {
      if (next.correctionOriginal) Object.assign(next, correctionDelta(next.correctionOriginal, next));
      const legacyData = correctionDataSnapshot(next);
      legacyData.services.forEach((service, index) => { service.quantity = Number(next.services[index].quantity); });
      legacyData.materials.forEach((material, index) => { material.quantity = Number(next.materials[index].quantity); });
      const legacySignature = JSON.stringify(legacyData);
      const signature = JSON.stringify({ data: correctionDataSnapshot(next), photoPatch: next.photoPatch || {}, evidencePatch: next.evidencePatch || {} });
      if (!next.correctionRequestId || ![signature, legacySignature].includes(next.correctionPayloadSignature)) next.correctionRequestId = generateUuid();
      next.correctionPayloadSignature = signature;
      if (!Object.hasOwn(next, 'correctionRequestedAt')) next.correctionRequestedAt = correctionRequest(next).lastRequestedAt || correctionRequest(next).requestedAt || '';
      await save();
      correctionPayload = { ...correctionFields(next), recordId: next.recordId, correctionRequestId: next.correctionRequestId, correctionRequestedAt: next.correctionRequestedAt,
        ...(next.correctionOriginal ? { expectedPatch: next.expectedPatch, beforePatch: next.beforePatch } : {}), photoPatch: next.photoPatch || {}, evidencePatch: next.evidencePatch || {} };
    }
    if (next.serverConfirmed || next.attempts > 1) {
      try {
        const serverState = await api.getRecordState(requestSession.token, next.recordId);
        dataCommitConfirmed = !next.correctionMode && serverState.record?.recordId === next.recordId
          && sameUser(serverState.record.user, requestSession.user)
          && Array.isArray(serverState.record.audit?.expectedPhotoIndexes)
          && normalizePhotoStates(next.photoStates).filter(photo => photo.localReady || photo.confirmed)
            .every(photo => serverState.record.audit.expectedPhotoIndexes.includes(photo.photoIndex))
          && JSON.stringify(correctionDataSnapshot(next)) === JSON.stringify(correctionDataSnapshot(serverState.record));
        next = reconcilePhotoStates(next, serverState); await save();
      }
      catch (error) { if (!(error instanceof ApiError) || error.code !== 'RECORD_NOT_FOUND') throw error; }
    }
    if (next.serverConfirmed && !next.correctionMode && [RECORD_STATUS.WAITING_SUPERVISOR, RECORD_STATUS.CORRECTION_REQUESTED, RECORD_STATUS.REJECTED, RECORD_STATUS.PUBLISHED].includes(next.serverStatus)) {
      if (next.serverStatus === RECORD_STATUS.WAITING_SUPERVISOR && next.photoStates.some(photo => photo.localReady || photo.replacePending)) throw new ApiError('Há uma foto local diferente da confirmação do servidor. Ela foi preservada; confira a ocorrência antes de tentar novamente.', 'PHOTO_CONFIRMATION_PENDING');
      next.status = next.serverStatus; next.lastError = ''; next.syncedAt = new Date().toISOString();
      await save(); markSynced(); cacheSummary(next.dailyProduction);
      if ([RECORD_STATUS.WAITING_SUPERVISOR, RECORD_STATUS.PUBLISHED].includes(next.status)) {
        for (const photo of next.photoStates) if (photo.confirmed && !photo.replacePending) await deletePhoto(recordId, photo.photoIndex, photo.uploadKey || '').catch(() => {});
      }
      return next;
    }
    if (!dataCommitConfirmed) {
      next.status = RECORD_STATUS.SYNCING_DATA; await save();
      const submitResult = await api.submitRecord(requestSession.token, {
        recordId: next.recordId, ...(correctionPayload ? { correctionRequestId: correctionPayload.correctionRequestId, correctionRequestedAt: correctionPayload.correctionRequestedAt,
          ...(next.correctionOriginal ? { expectedPatch: correctionPayload.expectedPatch, beforePatch: correctionPayload.beforePatch } : {}), photoPatch: correctionPayload.photoPatch, evidencePatch: correctionPayload.evidencePatch } : {}), base: next.base, contract: next.contract, team: next.team, crewLeader: next.crewLeader, occurrenceNumber: next.occurrenceNumber,
        expectedPhotoIndexes: normalizePhotoStates(next.photoStates).filter((photo) => photo.localReady || photo.confirmed).map((photo) => photo.photoIndex),
        occurrenceTypes: next.occurrenceTypes, otherOccurrenceType: next.otherOccurrenceType,
        pgPostRemoved: next.pgPostRemoved, pgPostInstalled: next.pgPostInstalled,
        pgConductorStart: next.pgConductorStart, pgConductorEnd: next.pgConductorEnd,
        transformer: next.transformer, services: serializeServicesForBackend(next.services), materials: serializeMaterialsForBackend(next.materials),
        totalServices: correctionPayload ? Number(next.totalServices) : occurrenceTotal(next.services), goalPercentage: dailyGoalProjection(dailyTotalExcludingRecord, correctionPayload ? Number(next.totalServices) : occurrenceTotal(next.services)).percentage,
        observation: next.observation
      }, APP_VERSION);
      if (correctionPayload && !correctionConfirmationMatches(correctionPayload, submitResult)) throw new ApiError('O servidor ainda não confirmou os campos corrigidos. A edição permanece na fila.', 'CORRECTION_DATA_UNCONFIRMED');
      next = reconcilePhotoStates(next, submitResult); cacheSummary(submitResult.dailyProduction || next.dailyProduction);
    }
    photoSyncStarted = true;
    next.status = RECORD_STATUS.SYNCING_PHOTOS; await save();
    next = reconcilePhotoStates(next, await api.getRecordState(requestSession.token, next.recordId)); await save();
    const lastPhotoIndex = normalizeOccurrenceTypes(next.occurrenceTypes).includes(TYPE_TRAFO) ? 7 : 5;
    for (let index = 1; index <= lastPhotoIndex; index += 1) {
      const state = next.photoStates[index - 1] || {};
      if (state.confirmed && !state.replacePending) { await deletePhoto(next.recordId, index, state.uploadKey || '').catch(() => {}); continue; }
      const localPhoto = await getPhoto(next.recordId, index);
      if (!localPhoto?.blob && index <= 5) {
        if (state.localReady) throw new ApiError(`A Foto ${index} não está mais disponível neste aparelho.`, 'LOCAL_PHOTO_MISSING');
        continue;
      }
      if (!localPhoto?.blob) throw new ApiError(index === 6 ? 'A evidência do transformador retirado não está disponível neste aparelho.' : 'A evidência do transformador instalado não está disponível neste aparelho.', 'LOCAL_PHOTO_MISSING');
      const photoResult = await api.uploadPhoto(requestSession.token, { ...localPhoto, dataUrl: await blobToDataUrl(localPhoto.blob) }, { replace: Boolean(state.replacePending) });
      next = reconcilePhotoStates(next, photoResult); next.photoStates[index - 1].replacePending = false; next.status = photoResult.status || RECORD_STATUS.SYNCING_PHOTOS; next.lastError = '';
      await save(); if (next.photoStates[index - 1]?.confirmed) await deletePhoto(next.recordId, index, localPhoto.uploadKey); await updateQueueUi();
    }
    const finalState = await api.getRecordState(requestSession.token, next.recordId);
    if (correctionPayload && !correctionConfirmationMatches(correctionPayload, finalState, true)) throw new ApiError('A releitura ainda não confirmou a correção completa. A edição permanece na fila.', 'CORRECTION_DATA_UNCONFIRMED');
    next = reconcilePhotoStates(next, finalState);
    if (requiredPhotoDeficit(next) > 0 || next.photoStates.some(photo => photo.localReady || photo.replacePending)) throw new ApiError('Ainda há evidências pendentes de confirmação. A fila foi preservada.', 'PHOTOS_INCOMPLETE');
    for (let index = 1; index <= lastPhotoIndex; index += 1) {
      if (next.photoStates[index - 1]?.confirmed && !next.photoStates[index - 1]?.replacePending) await deletePhoto(next.recordId, index, next.photoStates[index - 1].uploadKey || '').catch(() => {});
    }
    const confirmedStatus = String(finalState.status || '');
    const acceptedStatuses = next.correctionMode ? [RECORD_STATUS.WAITING_SUPERVISOR] : [RECORD_STATUS.WAITING_SUPERVISOR, RECORD_STATUS.CORRECTION_REQUESTED, RECORD_STATUS.REJECTED, RECORD_STATUS.PUBLISHED];
    if (!acceptedStatuses.includes(confirmedStatus)) {
      throw new ApiError('O servidor ainda não confirmou o estado final. A fila foi preservada para nova tentativa.', 'SERVER_CONFIRMATION_PENDING');
    }
    next.status = confirmedStatus; next.lastError = ''; next.syncedAt = new Date().toISOString(); next.correctionMode = false; next.requestedPhotoIndexes = [];
    await save(); markSynced(); cacheSummary(finalState.dailyProduction || next.dailyProduction); if (notify) toast(statusLabel(next.status, next.photoCount), 'success'); return next;
  } catch (error) {
    if (error?.code === 'LOCAL_RECORD_CHANGED') { if (notify) toast(friendlyError(error), 'error'); return getRecord(recordId); }
    next.status = error?.code === 'NO_CORRECTION_CHANGES' ? RECORD_STATUS.CORRECTION_REQUESTED : RECORD_STATUS.ERROR;
    next.lastError = !next.correctionMode && photoSyncStarted && !['AUTH_REQUIRED', 'LOCAL_PHOTO_MISSING'].includes(error?.code)
      ? 'Não foi possível concluir a sincronização das fotos. Os dados e fotos locais pendentes foram preservados. Tente novamente.'
      : !next.correctionMode && error?.code === 'CORRECTION_PERSISTENCE_MISMATCH'
        ? 'O servidor ainda não confirmou os dados da ocorrência. Os dados locais foram preservados; tente novamente.' : friendlyError(error);
    await save();
    if (error instanceof ApiError && error.code === 'AUTH_REQUIRED' && revision === sessionRevision) logout(); if (notify) toast(next.lastError, 'error', 5200); return next;
  } finally {
    await updateQueueUi().catch(error => console.error('[Fila] Falha ao atualizar o resumo após sincronização.', { code: error?.code || error?.name }));
    if (session?.role === 'field' && (currentView === 'mine' || mineRecords.some((item) => item.recordId === recordId && openPhotoSyncRequest(item, session.user)))) { if (!photoSyncAllRunning) refreshMine(false); }
  }
}

async function syncAll(notify = false) {
  const requestSession = session;
  if (syncRunning || !requestSession || requestSession.role !== 'field') return; syncRunning = true; setBusy(elements.syncNowButton, true, 'Sincronizando…');
  try {
    const queue = (await getAllRecords()).filter((record) => (!record.user || sameUser(record.user, requestSession.user)) && SYNCABLE_STATUSES.has(record.status));
    for (const record of queue) {
      if (session?.token !== requestSession.token) break;
      try { await syncSingleRecord(record.recordId, false); }
      catch (error) { console.error('[Fila] Falha local em uma ocorrência; os próximos itens continuam.', { recordId: record.recordId, code: error?.code || error?.name }); }
    }
    if (notify) toast(queue.length ? 'Fila verificada e atualizada.' : 'Nenhum registro pendente.', 'success');
  } catch (error) {
    console.error('[Fila] Falha ao verificar a fila.', error);
    if (notify) toast('Não foi possível verificar a fila. Tente novamente.', 'error');
  } finally { syncRunning = false; setBusy(elements.syncNowButton, false); await updateQueueUi().catch((error) => console.error('[Fila] Falha ao atualizar o painel.', error)); }
}

async function updateQueueUi() {
  const revision = sessionRevision; const owner = session?.role === 'field' ? session.user : '';
  const summary = await getQueueSummary(owner); if (revision !== sessionRevision) return;
  elements.syncPendingRecords.textContent = summary.pendingRecords.length; elements.syncPendingPhotos.textContent = summary.pendingPhotos;
  elements.syncPhotosSyncing.textContent = summary.syncingPhotos; elements.syncErrors.textContent = summary.errors; elements.syncNavCount.hidden = !summary.pendingRecords.length; elements.syncNavCount.textContent = summary.pendingRecords.length;
  const lastSync = await getMeta(LAST_SYNC_META); if (revision !== sessionRevision) return;
  elements.lastSyncAt.textContent = lastSync ? formatDateTime(lastSync) : 'Nenhuma sincronização concluída.'; renderSyncQueue(summary.pendingRecords);
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

function assertServerRecordList(records, label) {
  if (!Array.isArray(records) || records.some((record) => !record || typeof record !== 'object' || Array.isArray(record) || typeof record.recordId !== 'string' || !record.recordId.trim())) {
    throw new ApiError('O servidor retornou uma lista de ocorrências incompleta. Tente novamente.', 'INVALID_OCCURRENCE_PAYLOAD', { label });
  }
}

async function refreshMine(notify = false) {
  const requestSession = session; const revision = sessionRevision;
  if (!requestSession || requestSession.role !== 'field') return null;
  if (mineRefreshPromise && mineRefreshRevision === revision) return mineRefreshPromise;
  const initial = !mineServerDataLoaded;
  const isCurrent = () => revision === sessionRevision && session?.role === 'field';
  mineLoading = true; mineLoadError = null;
  setBusy(elements.refreshMineButton, true, 'Atualizando…');
  renderMineList();
  const task = (async () => {
    try {
      let localRecords = []; let serverRecords = []; let localError = null; let serverError = null; let serverLoaded = false;
      const renderAvailable = () => {
        if (!isCurrent()) return;
        mineRecords = mergeRecordCollections(localRecords, serverRecords);
        setupMineTeams(); renderMineFilters(); renderMineList(); renderPhotoSyncRequests();
      };
      // As duas fontes começam juntas; uma resposta remota válida pode aparecer antes do banco local.
      const localTask = (async () => {
        try {
          localRecords = normalizeOccurrenceRecords(await getAllRecords(), 'localRecords').filter((record) => sameUser(record.user, requestSession.user));
          if (initial && (localRecords.length || mineServerDataLoaded)) renderAvailable();
        } catch (error) { localError = error; }
      })();
      const serverTask = (async () => {
        if (!navigator.onLine || !endpointConfigured()) return;
        try {
          const records = await loadOccurrenceDataset(
            () => api.listMine(requestSession.token),
            (result) => { assertServerRecordList(result.records, 'listMine.records'); return normalizeOccurrenceRecords(result.records, 'listMine.records'); },
            { initial, isCurrent }
          );
          if (!isCurrent() || records === null) return;
          serverRecords = records; serverLoaded = true; mineServerDataLoaded = true;
          if (initial) renderAvailable();
        } catch (error) { serverError = error; }
      })();
      await Promise.all([localTask, serverTask]);
      if (!isCurrent()) return null;
      if (serverError?.code === 'AUTH_REQUIRED') { logout(); return null; }
      mineLoadError = serverError || (localError && !serverLoaded ? localError : null);
      if (localError) console.error('[Minhas ocorrências] Falha ao ler dados locais.', localError);
      mineLoading = false;
      mineRecords = mergeRecordCollections(localRecords, serverRecords);
      if (mineAutoFilterPending) { mineFilter = mineRecords.some(mineNeedsAttention) ? 'attention' : 'today'; mineAutoFilterPending = false; }
      renderAvailable();
      void refreshMineGoal(false).catch((error) => console.error('[Produção] Falha ao atualizar meta diária.', error));
      if (mineLoadError && notify) toast(friendlyError(mineLoadError), 'error');
      return mineLoadError && !mineRecords.length ? null : mineRecords;
    } catch (error) {
      if (!isCurrent()) return null;
      console.error('[Minhas ocorrências] Falha ao atualizar.', error);
      mineLoading = false; mineLoadError = error; renderMineList();
      if (notify) toast('Não foi possível atualizar suas ocorrências. Tente novamente.', 'error');
      return null;
    }
  })();
  mineRefreshPromise = task; mineRefreshRevision = revision;
  try { return await task; }
  finally {
    if (mineRefreshPromise === task) { mineRefreshPromise = null; mineRefreshRevision = -1; setBusy(elements.refreshMineButton, false); }
  }
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
  elements.mineGoalCard.hidden = false; const date = operationalDate(); const team = mineTeam;
  const requestId = ++mineGoalRequestId; const revision = sessionRevision; const requestSession = session;
  const fromRecord = mineRecords.find((record) => normalizeTeamKey(record.team) === normalizeTeamKey(team) && record.dailyProduction?.date === date)?.dailyProduction;
  let summary = fromRecord || await getMeta(dailyCacheKey(team, date)) || emptyDailyProduction(team);
  if (requestId !== mineGoalRequestId || revision !== sessionRevision || normalizeTeamKey(mineTeam) !== normalizeTeamKey(team)) return;
  if (navigator.onLine && endpointConfigured() && requestSession?.role === 'field') {
    try { summary = await api.getDailyTeamProduction(requestSession.token, team, date); if (requestId !== mineGoalRequestId || revision !== sessionRevision) return; await cacheDailySummary(summary); }
    catch (error) { if (notify) toast(friendlyError(error), 'error'); }
  }
  if (requestId === mineGoalRequestId && revision === sessionRevision && normalizeTeamKey(mineTeam) === normalizeTeamKey(team)) renderMineGoal(summary);
}

function renderMineGoal(summary = emptyDailyProduction(mineTeam)) {
  const progress = goalProgress(Number(summary.totalSent) || 0, Number(summary.goal) || TEAM_GOAL);
  elements.mineGoalValue.textContent = formatCurrency(progress.goal); elements.mineDailyValue.textContent = formatCurrency(progress.total);
  elements.mineGoalPercentage.textContent = `${formatNumber(progress.percentage)}%`; elements.mineGoalBar.style.width = `${progress.visualPercentage}%`;
  elements.mineGoalStatus.textContent = progress.label; elements.mineGoalStatus.className = `goal-status goal-status--${progress.state}`;
  elements.mineGoalCard.classList.toggle('is-achieved', progress.state === 'atingida'); elements.mineGoalCard.classList.toggle('is-exceeded', progress.state === 'superada');
}

function renderMineFilters() {
  const filters = [['attention', 'Pendências da equipe'], ['today', 'Hoje'], ['history', 'Outros dias'], ['all', 'Todas'], ['draft', 'Rascunhos'], ['pending', 'Pendentes'], ['waiting', 'Aguardando'], ['correction', 'Correção'], ['approved', 'Aprovadas'], ['rejected', 'Reprovadas']];
  elements.mineFilters.innerHTML = filters.map(([value, label]) => `<button class="filter-chip${mineFilter === value ? ' is-active' : ''}" type="button" data-filter="${value}">${label}</button>`).join('');
}

function renderMineList() {
  elements.mineList.setAttribute('aria-busy', String(mineLoading));
  const failure = mineLoadError ? `${emptyState('Não foi possível atualizar as ocorrências', friendlyError(mineLoadError))}<div class="empty-state-action"><button class="button button--primary" type="button" data-mine-retry>Tentar novamente</button></div>` : '';
  if (failure && !mineRecords.length) { elements.mineList.innerHTML = failure; return; }
  if (mineLoading && !mineServerDataLoaded && !mineRecords.length) {
    elements.mineList.innerHTML = emptyState('Carregando ocorrências…', 'Aguarde enquanto buscamos seus registros.'); return;
  }
  const today = operationalDate();
  const filtered = mineRecords.filter((record) => (mineFilter === 'attention' && mineNeedsAttention(record)) || (mineFilter === 'today' && occurrenceDate(record) === today) || (mineFilter === 'history' && occurrenceDate(record) !== today) || mineFilter === 'all' || (mineFilter === 'draft' && record.status === RECORD_STATUS.DRAFT) || (mineFilter === 'pending' && SYNCABLE_STATUSES.has(record.status)) || (mineFilter === 'waiting' && record.status === RECORD_STATUS.WAITING_SUPERVISOR) || (mineFilter === 'correction' && record.status === RECORD_STATUS.CORRECTION_REQUESTED) || (mineFilter === 'approved' && [RECORD_STATUS.APPROVED, RECORD_STATUS.PUBLISHED].includes(record.status)) || (mineFilter === 'rejected' && record.status === RECORD_STATUS.REJECTED));
  if (!filtered.length) { elements.mineList.innerHTML = failure + emptyState('Nenhuma ocorrência nesta visão', 'Quando houver registros com este status, eles aparecerão aqui.'); return; }
  elements.mineList.innerHTML = failure + filtered.map((record) => {
    const actions = [`<button class="button button--ghost button--small" type="button" data-mine-action="view" data-record-id="${escapeHtml(record.recordId)}">Ver ocorrência</button>`];
    if (record.status === RECORD_STATUS.DRAFT) actions.push(`<button class="button button--primary button--small" type="button" data-mine-action="continue" data-record-id="${escapeHtml(record.recordId)}">Continuar</button>`);
    else if (record.status === RECORD_STATUS.CORRECTION_REQUESTED) actions.push(`<button class="button button--warning button--small" type="button" data-mine-action="correct" data-record-id="${escapeHtml(record.recordId)}">Corrigir</button>`);
    else if (SYNCABLE_STATUSES.has(record.status)) actions.push(`<button class="button button--ghost button--small" type="button" data-mine-action="sync" data-record-id="${escapeHtml(record.recordId)}">Sincronizar agora</button>`);
    const action = `<div class="button-row">${actions.join('')}</div>`;
    return recordCard(record, action);
  }).join('');
}

function renderPhotoSyncRequests() {
  const requested = session?.role === 'field'
    ? uniqueRecordsById(mineRecords).filter((record) => openPhotoSyncRequest(record, session.user))
    : [];
  elements.photoSyncRequests.hidden = !requested.length;
  elements.photoSyncRequests.innerHTML = (requested.length > 1 ? `<div class="photo-sync-all"><strong>${requested.length} solicitações de sincronismo</strong><button class="button button--primary" type="button" data-photo-sync-all ${photoSyncAllRunning ? 'disabled' : ''}>${photoSyncAllRunning ? 'Sincronizando…' : 'Sincronizar tudo'}</button></div>` : '') + requested.map((record) => {
    const request = openPhotoSyncRequest(record, session.user);
    const busy = photoSyncAllRunning || photoSyncAttempts.has(record.recordId);
    return `<article class="photo-sync-callout"><div><strong>ATENÇÃO · SINCRONIZAÇÃO DE FOTOS SOLICITADA</strong><p>O Supervisor solicitou a sincronização das fotos da ocorrência Nº ${escapeHtml(record.occurrenceNumber || '—')}.</p><small>Mantenha este aparelho conectado à internet. As fotos pendentes precisam ser confirmadas pelo servidor.</small><small>${escapeHtml(request.supervisor || 'Supervisor')} · ${escapeHtml(formatDateTime(request.lastRequestedAt || request.requestedAt))}</small>${photoSyncFeedback.has(record.recordId) ? `<p class="photo-sync-error" role="alert">${escapeHtml(photoSyncFeedback.get(record.recordId))}</p>` : ''}</div><button class="button button--primary button--small" type="button" data-photo-sync-record="${escapeHtml(record.recordId)}" ${busy ? 'disabled' : ''}>${busy ? 'Sincronizando…' : 'Sincronizar agora'}</button></article>`;
  }).join('');
}

async function syncRequestedPhotos(recordId, { notify = true, refresh = true } = {}) {
  if (!session || session.role !== 'field' || photoSyncAttempts.has(recordId)) return;
  const revision = sessionRevision; const requestSession = session;
  const remote = mineRecords.find((record) => record.recordId === recordId && openPhotoSyncRequest(record, session.user));
  if (!remote) return;
  photoSyncAttempts.add(recordId); photoSyncFeedback.delete(recordId); renderPhotoSyncRequests();
  try {
    const local = await getRecord(recordId);
    const photos = local && (!local.user || sameUser(local.user, requestSession.user)) ? await getPhotosForRecord(recordId) : [];
    const stored = new Set(photos.filter((photo) => photo.blob).map((photo) => photo.photoIndex));
    if (revision !== sessionRevision) return { ok: false, recordId };
    if (!local || (local.user && !sameUser(local.user, requestSession.user))) {
      throw new ApiError('Não foi possível localizar neste dispositivo as fotos necessárias para concluir a sincronização.', 'LOCAL_PHOTO_MISSING');
    }
    const serverState = await api.getRecordState(requestSession.token, recordId);
    if (revision !== sessionRevision) return { ok: false, recordId };
    if (serverState.status === RECORD_STATUS.WAITING_SUPERVISOR) {
      if (refresh) await refreshMine(false);
      photoSyncFeedback.delete(recordId);
      if (notify) toast('Fotos já confirmadas pelo servidor. Ocorrência disponível ao Supervisor.', 'success');
      return { ok: true, recordId };
    }
    if (serverState.status !== RECORD_STATUS.SYNCING_PHOTOS) {
      if (refresh) await refreshMine(false);
      throw new ApiError('A ocorrência não está mais aguardando fotos. Atualize a lista.', 'PHOTO_SYNC_UPDATED');
    }
    const confirmed = normalizePhotoStates(serverState.photoStates);
    const available = {
      ...remote,
      photos: serverState.record?.photos || [],
      transformerPhotos: serverState.record?.transformerPhotos || {},
      photoStates: Array.from({ length: 7 }, (_, index) => ({
        photoIndex: index + 1,
        confirmed: Boolean(confirmed[index]?.confirmed),
        serverUrl: confirmed[index]?.confirmed ? confirmed[index]?.serverUrl || confirmed[index]?.url || '' : '',
        localReady: stored.has(index + 1)
      }))
    };
    const expected = normalizeArray(serverState.record?.audit?.expectedPhotoIndexes).map(Number);
    if (requiredPhotoDeficit(available) > 0 || expected.some((index) => !confirmed[index - 1]?.confirmed && !stored.has(index))) {
      throw new ApiError('Não foi possível localizar neste dispositivo as fotos necessárias para concluir a sincronização.', 'LOCAL_PHOTO_MISSING');
    }
    const result = await syncSingleRecord(recordId, false);
    if (result?.status !== RECORD_STATUS.WAITING_SUPERVISOR || result.audit?.photoSyncRequest?.status !== 'RESOLVED') {
      throw new ApiError(result?.lastError || 'As fotos ainda não foram confirmadas pelo servidor. Tente novamente.', 'PHOTO_SYNC_PENDING');
    }
    if (revision !== sessionRevision) return { ok: false, recordId };
    if (refresh) await refreshMine(false);
    photoSyncFeedback.delete(recordId);
    if (notify) toast('Fotos confirmadas pelo servidor. Ocorrência encaminhada ao Supervisor.', 'success');
    return { ok: true, recordId };
  } catch (error) {
    if (revision !== sessionRevision) return { ok: false, recordId };
    photoSyncFeedback.set(recordId, friendlyError(error));
    if (notify) toast(friendlyError(error), 'error', 5200);
    return { ok: false, recordId, message: friendlyError(error) };
  } finally { photoSyncAttempts.delete(recordId); renderPhotoSyncRequests(); }
}

async function syncAllRequestedPhotos() {
  if (photoSyncAllRunning || !session || session.role !== 'field') return;
  const revision = sessionRevision;
  const ids = uniqueRecordsById(mineRecords).filter((record) => openPhotoSyncRequest(record, session.user)).map((record) => record.recordId);
  if (!ids.length) return;
  photoSyncAllRunning = true; renderPhotoSyncRequests();
  let completed = 0; let pending = 0;
  try {
    for (const id of ids) {
      if (revision !== sessionRevision) return;
      const result = await syncRequestedPhotos(id, { notify: false, refresh: false });
      if (result?.ok) completed += 1; else pending += 1;
    }
    if (revision !== sessionRevision) return;
    await refreshMine(false);
    toast(`${completed} ${completed === 1 ? 'ocorrência sincronizada' : 'ocorrências sincronizadas'}; ${pending} ${pending === 1 ? 'continua pendente' : 'continuam pendentes'}.${pending ? ' Consulte os avisos e tente no aparelho que possui as fotos.' : ''}`, pending ? 'error' : 'success', 6000);
  } finally { if (revision === sessionRevision) { photoSyncAllRunning = false; renderPhotoSyncRequests(); } }
}

function recordCard(record, actionHtml = '') {
  const services = normalizeServices(record.services);
  const photoCount = Math.max(countConfirmedPhotos(record), countReadyPhotoStates(record)); const status = record.status || record.serverStatus; const total = occurrenceTotal(services); const serviceQuantity = services.reduce((sum, service) => sum + (Number(service.quantity) || 0), 0);
  const photoStates = normalizePhotoStates(record.photoStates).slice(0, 5);
  const localPhotoCount = photoStates.filter(photo => photo.localReady).length;
  const serverPhotoCount = photoStates.filter(photo => photo.confirmed && photo.serverUrl).length;
  const photoSummary = localPhotoCount ? `${localPhotoCount}/5 fotos salvas neste aparelho · ${serverPhotoCount}/5 confirmadas no servidor${photoStates.some(photo => photo.localReady && (!photo.confirmed || photo.replacePending)) ? ' · Sincronização pendente' : ''}` : `${serverPhotoCount}/5 fotos gerais confirmadas no servidor`;
  const correction = record?.audit?.lastSupervisorCorrection;
  return `<article class="record-card"><header class="record-card__header"><div><h3>${escapeHtml(record.occurrenceNumber ? `Ocorrência ${record.occurrenceNumber}` : 'Nova ocorrência')}</h3><small>${escapeHtml(record.recordId || '')}</small></div><span class="status-chip status-chip--${statusTone(status)}">${escapeHtml(statusLabel(status, photoCount))}</span></header><p>${escapeHtml(occurrenceTypesText(record) || 'Tipo não informado')}</p><div class="record-card__body"><div class="record-meta"><span>Sub-base</span><strong>${escapeHtml(record.base || '—')}</strong></div><div class="record-meta"><span>Contrato</span><strong>${escapeHtml(record.contract || '—')}</strong></div><div class="record-meta"><span>Equipe</span><strong>${escapeHtml(record.team || '—')}</strong></div><div class="record-meta"><span>Chefe de turma</span><strong>${escapeHtml(record.crewLeader || '—')}</strong></div><div class="record-meta"><span>Qtd. serviços</span><strong>${escapeHtml(formatNumber(serviceQuantity))}</strong></div><div class="record-meta"><span>Total</span><strong>${escapeHtml(formatCurrency(total))}</strong></div><div class="record-meta"><span>Registrado em</span><strong>${escapeHtml(formatDateTime(record.registeredAt || record.createdAt))}</strong></div></div>${correctionRequestMarkup(record)}${correction ? `<div class="supervisor-correction-badge">✓ Corrigido pelo supervisor — ${escapeHtml(correction.supervisor || 'Supervisor')} · ${escapeHtml(formatDateTime(correction.correctedAt))}</div>` : ''}${record.reason && status !== RECORD_STATUS.CORRECTION_REQUESTED ? `<div class="status-chip status-chip--warning">Motivo: ${escapeHtml(record.reason)}</div>` : ''}${record.lastError ? `<div class="status-chip status-chip--danger">${escapeHtml(record.lastError)}</div>` : ''}<div class="record-progress"><span style="width:${Math.min(100, photoCount / 3 * 100)}%"></span></div><footer class="record-card__footer"><span class="photo-count">▧ ${escapeHtml(photoSummary)}</span>${actionHtml}</footer></article>`;
}

function openScrollableDialog(dialog, body) {
  if (!dialog || !body) return;
  body.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => { body.scrollTop = 0; });
}

async function handleMineAction(event) {
  if (event.target.closest('[data-mine-retry]')) return refreshMine(true);
  const button = event.target.closest('[data-mine-action]'); if (!button) return; const recordId = button.dataset.recordId;
  if (button.dataset.mineAction === 'sync') return syncSingleRecord(recordId, true);
  const local = await getRecord(recordId); const server = mineRecords.find((item) => item.recordId === recordId);
  if (!local && !server) return;
  const record = normalizeOccurrenceRecord({ ...(local || {}), ...(server || {}), photos: server?.photos || local?.photos || [], photoStates: local?.photoStates || server?.photoStates || [], transformerPhotos: server?.transformerPhotos || local?.transformerPhotos || {}, ...(local?.correctionMode ? correctionFields(local) : {}), audit: server?.audit || local?.audit || {} }, 'selectedRecord');
  if (button.dataset.mineAction === 'view') {
    const detailRecord = { ...record, ...(server || {}), photos: server?.photos || record.photos, dailyProduction: server?.dailyProduction || record.dailyProduction };
    elements.mineDetailTitle.textContent = `Ocorrência ${detailRecord.occurrenceNumber || 'sem número'}`;
    elements.mineDetailContent.innerHTML = occurrenceDetails(detailRecord); openScrollableDialog(elements.mineDetailDialog, elements.mineDetailContent); return;
  }
  if (button.dataset.mineAction === 'correct') {
    const requested = new Set(normalizeArray(record.audit?.requestedPhotoIndexes ?? correctionPhotoIndexes(record), 'requestedPhotoIndexes').map(Number));
    const requestAt = correctionRequest(record).lastRequestedAt || correctionRequest(record).requestedAt || '';
    const resuming = local?.correctionMode && local?.correctionRequestedAt === requestAt;
    const states = normalizePhotoStates(record.photoStates).map((state) => requested.has(state.photoIndex) ? { ...state, confirmed: false, localReady: Boolean(resuming && state.localReady), replacePending: true } : { ...state, replacePending: Boolean(resuming && state.replacePending) });
    const correction = { ...record, correctionRequestedAt: requestAt, ...(local?.correctionRequestedAt !== requestAt ? { correctionRequestId: '', correctionPayloadSignature: '' } : {}), status: RECORD_STATUS.DRAFT, serverStatus: RECORD_STATUS.CORRECTION_REQUESTED, correctionMode: true, requestedPhotoIndexes: [...requested], photoStates: states };
    await putRecord(correction); await setMeta(ACTIVE_DRAFT_META, correction.recordId);
    toast(requested.size ? `Refaça: ${[...requested].map(photoIndexLabel).join(', ')}.` : 'Correção carregada. Confira a observação do Supervisor.');
    return loadRecordIntoForm(correction);
  }
  await setMeta(ACTIVE_DRAFT_META, record.recordId); await loadRecordIntoForm(record);
}

function renderFieldCorrectionBanner(record) {
  const active = Boolean(record?.correctionMode || (record?.status || record?.serverStatus) === RECORD_STATUS.CORRECTION_REQUESTED);
  elements.fieldCorrectionBanner.hidden = !active;
  elements.newTitle.textContent = active ? 'Corrigir ocorrência' : 'Nova ocorrência';
  elements.submitOccurrenceButton.textContent = active ? 'Reenviar ao Supervisor' : 'Enviar para conferência';
  if (!active) { elements.fieldCorrectionObservation.textContent = ''; elements.fieldCorrectionMeta.textContent = ''; return; }
  const request = correctionRequest(record);
  elements.fieldCorrectionObservation.textContent = request.note || request.reason || 'Consulte o Supervisor responsável.';
  elements.fieldCorrectionMeta.textContent = [request.supervisor ? `Supervisor: ${request.supervisor}` : '', request.requestedAt ? formatDateTime(request.lastRequestedAt || request.requestedAt) : '', request.photoIndexes.length ? `Fotos: ${request.photoIndexes.map(photoIndexLabel).join(', ')}` : ''].filter(Boolean).join(' · ');
}

async function loadRecordIntoForm(record) {
  const revision = sessionRevision; const token = session?.token;
  const loadId = loadRecordIntoForm.loadId = (loadRecordIntoForm.loadId || 0) + 1;
  record = normalizeOccurrenceRecord(record);
  if (record.correctionMode && (!record.correctionOriginal || record.correctionOriginalRequestedAt !== record.correctionRequestedAt)) {
    if (navigator.onLine) {
      const server = (await api.getRecordState(session.token, record.recordId)).record;
      if (revision !== sessionRevision || token !== session?.token || loadId !== loadRecordIntoForm.loadId) return;
      const receipt = server.audit?.lastCorrectionSubmission;
      const original = JSON.parse(JSON.stringify(server));
      if (receipt?.requestedAt === record.correctionRequestedAt && receipt.requestId === record.correctionRequestId) {
        Object.assign(original, receipt.beforePatch || {});
        for (const [index, before] of Object.entries({ ...receipt.beforePhotoPatch, ...receipt.beforeEvidencePatch })) {
          original.photoStates[Number(index) - 1] = { ...original.photoStates[Number(index) - 1], ...before };
        }
      }
      record.correctionOriginal = correctionOriginalSnapshot(original);
      record.correctionOriginalRequestedAt = record.correctionRequestedAt;
    }
  }
  if (record.correctionOriginal) record.correctionOriginal = correctionOriginalSnapshot({ ...record.correctionOriginal.data, photoStates: record.correctionOriginal.photoStates });
  fieldServiceSnapshot = record.registeredAt || record.serverConfirmed || record.correctionMode ? normalizeServices(record.audit?.pendingServices || record.services).map((service) => ({ ...service })) : [];
  const services = record.services.map((service, index) => ({ ...service, lineId: service.lineId || (fieldServiceSnapshot.length ? `historical:${record.recordId}:${index}` : generateUuid()) }));
  const materials = record.materials.map((material) => ({ ...material, lineId: material.lineId || generateUuid() })); const photoStates = record.photoStates;
  clearPreviewUrls(); activeRecord = { ...blankRecord(), ...record, status: RECORD_STATUS.DRAFT, occurrenceTypes: normalizeOccurrenceTypes(record.occurrenceTypes), transformer: { ...blankRecord().transformer, ...(record.transformer || {}) }, transformerPhotos: { ...blankRecord().transformerPhotos, ...(record.transformerPhotos || {}) }, services, materials, photoStates: Array.from({ length: 7 }, (_, index) => photoStates[index] || { photoIndex: index + 1, confirmed: index < 5 ? Boolean(record.photos?.[index]) : Boolean(index === 5 ? record.transformerPhotos?.removed : record.transformerPhotos?.installed), localReady: false, serverUrl: index < 5 ? record.photos?.[index] || '' : index === 5 ? record.transformerPhotos?.removed || '' : record.transformerPhotos?.installed || '', uploadKey: '', replacePending: false }) };
  if (fieldServiceSnapshot.length && !Array.isArray(activeRecord.audit?.pendingServices)) activeRecord.audit = { ...activeRecord.audit, pendingServices: fieldServiceSnapshot.map((service) => ({ ...service })) };
  renderFieldCorrectionBanner(activeRecord);
  if (!activeRecord.contract) activeRecord.contract = contractForBase(activeRecord.base);
  const loadingRecord = activeRecord;
  fieldAssignmentSnapshot = { base: activeRecord.base, team: activeRecord.team, crewLeader: activeRecord.crewLeader };
  elements.operationBase.value = loadingRecord.base || '';
  updateContractOutput(elements.operationContract, elements.operationBase.value);
  elements.operationBase.value = activeRecord.base || ''; updateContractOutput(elements.operationContract, elements.operationBase.value); renderAssignmentControls(false, activeRecord); elements.occurrenceNumber.value = activeRecord.occurrenceNumber || '';
  $$('input[type="checkbox"]', elements.occurrenceTypes).forEach((input) => { input.checked = activeRecord.occurrenceTypes.includes(input.value); });
  elements.otherOccurrenceType.value = activeRecord.otherOccurrenceType || '';
  elements.pgPostRemoved.value = activeRecord.pgPostRemoved || activeRecord.pg1 || ''; elements.pgPostInstalled.value = activeRecord.pgPostInstalled || activeRecord.pg2 || '';
  elements.pgConductorStart.value = activeRecord.pgConductorStart || activeRecord.pg1 || ''; elements.pgConductorEnd.value = activeRecord.pgConductorEnd || activeRecord.pg2 || '';
  elements.removedTransformerCode.value = activeRecord.transformer.removedCode || ''; elements.removedTransformerCia.value = activeRecord.transformer.removedCia || '';
  elements.removedTransformerBto.value = activeRecord.transformer.removedBto || ''; elements.newTransformerCode.value = activeRecord.transformer.newCode || '';
  elements.newTransformerCia.value = activeRecord.transformer.newCia || ''; elements.newTransformerBto.value = activeRecord.transformer.newBto || '';
  elements.transformerSection.hidden = !(activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_TRAFO)); elements.pgPostSection.hidden = !(activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_POST)); elements.pgConductorSection.hidden = !(activeRecord.correctionMode || activeRecord.occurrenceTypes.includes(TYPE_CONDUCTOR)); elements.otherTypeSection.hidden = !activeRecord.occurrenceTypes.includes(TYPE_OTHER); elements.observation.value = activeRecord.observation || ''; elements.observationCount.textContent = elements.observation.value.length;
  renderServices(); renderMaterials(); showDraftId(); validateStepOne(false); updatePhotoGrid(); goToStep(Math.min(3, Math.max(1, Number(activeRecord.step) || 1))); elements.resumeBanner.hidden = true; navigate('new');
  if (activeRecord.team) { localStorage.setItem(LAST_TEAM_KEY, activeRecord.team); void loadDailyProduction(activeRecord.team, false).catch((error) => console.error('[Produção] Falha ao atualizar meta diária.', error)); }
  try {
    const photos = await getPhotosForRecord(record.recordId);
    if (activeRecord !== loadingRecord) return;
    for (const photo of photos) {
      if (activePhotos.has(photo.photoIndex)) continue;
      const state = activeRecord.photoStates[photo.photoIndex - 1] || { photoIndex: photo.photoIndex };
      activeRecord.photoStates[photo.photoIndex - 1] = { ...state, localReady: true, uploadKey: photo.uploadKey || state.uploadKey || '' };
      activePhotos.set(photo.photoIndex, photo);
      setPreviewUrl(photo.photoIndex, URL.createObjectURL(photo.blob));
    }
    if (photos.length) await putRecord(activeRecord);
    if (activeRecord === loadingRecord) updatePhotoGrid();
  } catch (error) {
    console.error('[Rascunho] Falha ao recuperar evidências locais.', error);
    if (activeRecord === loadingRecord) toast('Não foi possível recuperar as fotos locais. Os demais dados continuam no formulário.', 'error');
  }
}

function resetForm({ preserveTeam = false } = {}) {
  loadRecordIntoForm.loadId = (loadRecordIntoForm.loadId || 0) + 1;
  const team = preserveTeam ? (activeRecord?.team || localStorage.getItem(LAST_TEAM_KEY) || '') : '';
  catalogSearchRequestId += 1; materialSearchRequestId += 1; clearTimeout(catalogSearchTimer); clearTimeout(materialSearchTimer); clearPreviewUrls(); activeRecord = null; currentStep = 1;
  [elements.operationBase, elements.team, elements.crewLeader, elements.occurrenceNumber, elements.otherOccurrenceType, elements.pgPostRemoved, elements.pgPostInstalled, elements.pgConductorStart, elements.pgConductorEnd, elements.removedTransformerCode, elements.removedTransformerCia, elements.removedTransformerBto, elements.newTransformerCode, elements.newTransformerCia, elements.newTransformerBto, elements.serviceSearch, elements.materialSearch, elements.observation].forEach((input) => { input.value = ''; });
  fieldAssignmentSnapshot = null;
  fieldServiceSnapshot = [];
  renderAssignmentControls();
  renderFieldCorrectionBanner(null);
  updateContractOutput(elements.operationContract, '');
  $$('input[type="checkbox"]', elements.occurrenceTypes).forEach((input) => { input.checked = false; });
  elements.transformerSection.hidden = true; elements.pgPostSection.hidden = true; elements.pgConductorSection.hidden = true; elements.otherTypeSection.hidden = true; elements.serviceResults.hidden = true; elements.materialResults.hidden = true; elements.materialSearchSpinner.hidden = true; elements.materialSearchHint.textContent = 'Digite pelo menos 2 caracteres.'; elements.observationCount.textContent = '0'; elements.draftIdBadge.hidden = true; elements.stepOneErrors.hidden = true;
  renderServices(); renderMaterials(); renderPhotoGrid(); validateStepOne(false); goToStep(1); if (team) loadDailyProduction(team, false);
}

function normalizeSupervisorRecordList(records, label, summary = false) {
  const valid = [];
  for (const [index, source] of records.entries()) {
    try {
      assertServerRecordList([source], label);
      const record = summary ? { ...source } : normalizeOccurrenceRecord(source, `${label}[${index}]`);
      record.recordId = source.recordId.trim();
      for (const field of ['base', 'team', 'crewLeader', 'occurrenceNumber', 'user', 'contract']) {
        const value = record[field];
        record[field] = value == null ? '' : String(value);
      }
      valid.push(record);
    } catch (error) {
      console.warn('[Supervisor] Registro inválido; os demais continuam disponíveis.', { label, index, recordId: source?.recordId, code: error.code || error.name });
    }
  }
  if (records.length && !valid.length) {
    throw new ApiError('O servidor retornou uma lista de ocorrências inválida. Tente novamente.', 'INVALID_OCCURRENCE_PAYLOAD', { label });
  }
  return uniqueRecordsById(valid);
}

function refreshSupervisor(notify = false) {
  const requestSession = session; const revision = sessionRevision;
  if (!requestSession || requestSession.role !== 'supervisor') return null;
  if (supervisorRefreshPromise && supervisorRefreshRevision === revision) return supervisorRefreshPromise;
  const isCurrent = () => revision === sessionRevision && session?.role === 'supervisor';
  // Registrar a Promise antes de renderizar evita cargas concorrentes na ativação.
  const task = Promise.resolve().then(async () => {
    if (!isCurrent()) return null;
    try {
      supervisorLoading = true;
      supervisorLoadState = 'loading';
      supervisorLoadError = null;
      setBusy(elements.refreshSupervisorButton, true, 'Atualizando…');
      if (!navigator.onLine) throw new ApiError('O painel do supervisor precisa de conexão.', 'OFFLINE');
      try { renderSupervisorList(); }
      catch (renderError) { console.error('[Supervisor] Falha ao exibir carregamento; a consulta continua.', renderError); }
      const result = await loadOccurrenceDataset(() => api.listPending(requestSession.token), (result) => {
        if (!Array.isArray(result?.records) || !Array.isArray(result?.pendingRecords) || !Array.isArray(result?.metricRecords)) {
          throw new ApiError('O servidor retornou um painel incompleto. Tente novamente.', 'INVALID_SUPERVISOR_PAYLOAD');
        }
        return {
          records: normalizeSupervisorRecordList(result.records, 'listPending.records'),
          pendingRecords: normalizeSupervisorRecordList(result.pendingRecords, 'listPending.pendingRecords'),
          metricRecords: normalizeSupervisorRecordList(result.metricRecords, 'listPending.metricRecords', true)
        };
      }, { initial: !supervisorDataLoaded, isCurrent });
      if (!isCurrent() || !result) return null;
      const records = result.records;
      const pendingRecords = result.pendingRecords;
      const metricSource = result.metricRecords || [];
      const metricRecords = uniqueRecordsById(metricSource.length ? metricSource : [...records, ...pendingRecords]);
      supervisorPhotoFailures.clear();
      supervisorRecords = records;
      supervisorPendingRecords = pendingRecords;
      supervisorMetricRecords = metricRecords;
      supervisorDataLoaded = true;
      supervisorLoading = false;
      supervisorLoadState = records.length || pendingRecords.length || metricRecords.length ? 'success' : 'empty';
      supervisorLastLoadedAt = new Date().toISOString();
      supervisorLoadError = null;
      populateSupervisorFilters();
      renderSupervisorList(); if (notify) toast('Painel atualizado.', 'success'); return [...supervisorRecords, ...supervisorPendingRecords];
    } catch (error) {
      if (revision !== sessionRevision) return null;
      supervisorLoading = false;
      supervisorLoadState = 'error';
      if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') logout();
      else {
        console.error('[Supervisor] Falha ao atualizar ocorrências.', error);
        const message = friendlyError(error);
        supervisorLoadError = error instanceof ApiError ? error : new ApiError('Não foi possível carregar as ocorrências. Tente novamente.', 'SUPERVISOR_REFRESH_ERROR');
        try { renderSupervisorList(supervisorLoadError); }
        catch (renderError) {
          console.error('[Supervisor] Falha ao renderizar estado de erro.', renderError);
          elements.supervisorList.setAttribute('aria-busy', 'false');
          elements.supervisorList.dataset.state = 'error';
          if (!supervisorDataLoaded) [elements.supervisorKpiTotal, elements.supervisorKpiWaiting, elements.supervisorKpiCorrection, elements.supervisorKpiRejected, elements.supervisorKpiSync, elements.supervisorOccurrencesBadge, elements.supervisorPendingBadge, elements.supervisorPublishedBadge, elements.supervisorPhotosBadge, elements.supervisorCorrectionBadge].forEach((item) => { item.textContent = 'Erro'; });
          setSupervisorSummary('Falha ao carregar', 'error');
          elements.supervisorList.innerHTML = `${emptyState('Não foi possível carregar as ocorrências.', friendlyError(supervisorLoadError))}<button class="button button--primary" type="button" data-supervisor-retry>Tentar novamente</button>`;
        }
        if (notify) toast(message, 'error');
      }
      return null;
    }
  });
  const monitored = task.finally(() => {
    if (supervisorRefreshPromise === monitored) {
      supervisorRefreshPromise = null; supervisorRefreshRevision = -1;
      if (isCurrent()) { supervisorLoading = false; setBusy(elements.refreshSupervisorButton, false); }
    }
  });
  supervisorRefreshPromise = monitored; supervisorRefreshRevision = revision;
  return monitored;
}

function populateSupervisorFilters() {
  const fill = (select, values) => {
    const current = select.value;
    select.innerHTML = `<option value="">${select === elements.supervisorTypeFilter ? 'Todos' : 'Todas'}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    if (values.includes(current)) select.value = current;
  };
  const available = uniqueRecordsById([...supervisorRecords, ...supervisorPendingRecords, ...supervisorPublishedRecords()]);
  fill(elements.supervisorBaseFilter, [...new Set(available.map((record) => record.base).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  fill(elements.supervisorTeamFilter, [...new Set(available.map((record) => record.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  fill(elements.supervisorTypeFilter, OCCURRENCE_TYPES.filter((type) => available.some((record) => normalizeOccurrenceTypes(record.occurrenceTypes).includes(type))));
}

function saveSupervisorFilters() {
  supervisorFiltersByTab[supervisorTab] = {
    search: elements.supervisorSearch.value, base: elements.supervisorBaseFilter.value,
    team: elements.supervisorTeamFilter.value, type: elements.supervisorTypeFilter.value,
    from: elements.supervisorDateFrom.value, to: elements.supervisorDateTo.value,
    mode: supervisorFiltersByTab[supervisorTab].mode
  };
}

function restoreSupervisorFilters() {
  const state = supervisorFiltersByTab[supervisorTab];
  for (const [name, input] of [['search', elements.supervisorSearch], ['base', elements.supervisorBaseFilter], ['team', elements.supervisorTeamFilter], ['type', elements.supervisorTypeFilter], ['from', elements.supervisorDateFrom], ['to', elements.supervisorDateTo]]) input.value = state[name];
  updateSupervisorDateControls();
}

function updateSupervisorDateControls() {
  const mode = supervisorFiltersByTab[supervisorTab].mode;
  $$('[data-supervisor-date]', elements.supervisorDatePresets).forEach((button) => {
    const active = button.dataset.supervisorDate === mode;
    button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
  });
  $$('.supervisor-custom-date').forEach((field) => { field.hidden = mode !== 'period'; });
}

function supervisorPublishedRecords() {
  return uniqueRecordsById(supervisorMetricRecords.filter((record) => [RECORD_STATUS.PUBLISHED, 'APROVADA_E_PUBLICADA'].includes(record.status)))
    .map((record) => publishedDetailCache.get(record.recordId) || record)
    .sort((a, b) => String(b.reviewedAt || b.publishedAt || '').localeCompare(String(a.reviewedAt || a.publishedAt || '')) || a.recordId.localeCompare(b.recordId));
}

function dateForSupervisorRecord(record) {
  return occurrenceDate(record);
}

function supervisorFilterRange() {
  const state = supervisorFiltersByTab[supervisorTab];
  return state.mode === 'period' ? { from: state.from, to: state.to } : supervisorDateWindow(state.mode);
}

function filteredSupervisorRecords() {
  const search = normalizeText(elements.supervisorSearch.value);
  const base = normalizeText(elements.supervisorBaseFilter.value);
  const team = normalizeText(elements.supervisorTeamFilter.value);
  const type = elements.supervisorTypeFilter.value;
  const { from, to } = supervisorFilterRange();
  if (!validDateRange(from, to)) return [];
  const source = supervisorTab === 'pending'
    ? supervisorPendingRecords.filter((record) => supervisorPendingFilter === 'correction' ? record.status === RECORD_STATUS.CORRECTION_REQUESTED : record.status === RECORD_STATUS.SYNCING_PHOTOS)
    : supervisorTab === 'published' ? supervisorPublishedRecords() : supervisorRecords;
  return source.filter((record) => {
    const date = dateForSupervisorRecord(record);
    return (!search || normalizeText(record.occurrenceNumber).includes(search) || (supervisorTab === 'published' && [record.team, record.crewLeader, record.base].some((value) => normalizeText(value).includes(search))))
      && (!base || normalizeText(record.base) === base)
      && (!team || normalizeText(record.team) === team)
      && (!type || normalizeOccurrenceTypes(record.occurrenceTypes).includes(type))
      && dateInRange(date, { from, to });
  });
}

function renderSupervisorNavigation() {
  const metrics = supervisorKpis(supervisorMetricRecords);
  const unavailable = supervisorLoadState === 'error' ? 'Erro' : '—';
  elements.supervisorKpis.setAttribute('aria-busy', String(supervisorLoading && !supervisorDataLoaded));
  if (supervisorDataLoaded) {
    elements.supervisorKpiTotal.textContent = metrics.published;
    elements.supervisorKpiWaiting.textContent = metrics.waitingConference;
    elements.supervisorKpiCorrection.textContent = metrics.waitingCorrection;
    elements.supervisorKpiRejected.textContent = metrics.rejected;
    elements.supervisorKpiSync.textContent = metrics.pendingSync;
  } else {
    [elements.supervisorKpiTotal, elements.supervisorKpiWaiting, elements.supervisorKpiCorrection, elements.supervisorKpiRejected, elements.supervisorKpiSync].forEach((item) => { item.textContent = unavailable; });
  }
  elements.supervisorOccurrencesBadge.textContent = supervisorDataLoaded ? metrics.waitingConference : unavailable;
  elements.supervisorPendingBadge.textContent = supervisorDataLoaded ? metrics.pending : unavailable;
  elements.supervisorPublishedBadge.textContent = supervisorDataLoaded ? metrics.published : unavailable;
  elements.supervisorPhotosBadge.textContent = supervisorDataLoaded ? metrics.pendingSync : unavailable;
  elements.supervisorCorrectionBadge.textContent = supervisorDataLoaded ? metrics.waitingCorrection : unavailable;
  const attentionCount = metrics.waitingConference + metrics.pending;
  elements.supervisorNavCount.hidden = !supervisorDataLoaded || !attentionCount;
  elements.supervisorNavCount.textContent = attentionCount;
  $$('.supervisor-tab').forEach((button) => {
    const active = button.dataset.supervisorTab === supervisorTab;
    button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active));
  });
  $$('.pending-filter').forEach((button) => {
    const active = button.dataset.supervisorPending === supervisorPendingFilter;
    button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active));
  });
  elements.supervisorPendingFilters.hidden = supervisorTab !== 'pending';
  elements.supervisorToolbar.hidden = supervisorTab !== 'occurrences';
  elements.supervisorTitle.textContent = supervisorTab === 'pending' ? 'Pendências do Supervisor' : supervisorTab === 'published' ? 'Ocorrências publicadas' : 'Ocorrências aguardando conferência';
}

function pendingCountLabel(count) {
  return `${count} ${count === 1 ? 'pendência' : 'pendências'}`;
}

function setSupervisorSummary(text, state = 'ready') {
  elements.supervisorFilterSummary.textContent = text;
  elements.supervisorFilterSummary.dataset.state = state;
}

function supervisorActiveRecords() {
  if (supervisorTab === 'published') return supervisorPublishedRecords();
  if (supervisorTab !== 'pending') return supervisorRecords;
  return supervisorPendingRecords.filter((record) => supervisorPendingFilter === 'correction'
    ? record.status === RECORD_STATUS.CORRECTION_REQUESTED
    : record.status === RECORD_STATUS.SYNCING_PHOTOS);
}

function supervisorActiveCountLabel(count) {
  if (supervisorTab === 'published') return `${count} ${count === 1 ? 'ocorrência publicada' : 'ocorrências publicadas'}`;
  if (supervisorTab !== 'pending') return `${count} ${count === 1 ? 'ocorrência aguardando conferência' : 'ocorrências aguardando conferência'}`;
  if (supervisorPendingFilter === 'correction') return `${count} ${count === 1 ? 'correção solicitada' : 'correções solicitadas'}`;
  return `${count} ${count === 1 ? 'ocorrência com fotos pendentes' : 'ocorrências com fotos pendentes'}`;
}

function pendingSupervisorCard(record) {
  const photoCount = Math.max(countConfirmedPhotos(record), countReadyPhotoStates(record));
  const status = record.status || record.serverStatus;
  const request = correctionRequest(record);
  const syncRequest = status === RECORD_STATUS.SYNCING_PHOTOS ? openPhotoSyncRequest(record) : null;
  const meta = status === RECORD_STATUS.CORRECTION_REQUESTED
    ? correctionRequestMarkup(record)
    : `<div class="status-chip status-chip--info">Fotos sendo sincronizadas · ${photoCount}/5</div>`;
  return `<article class="record-card supervisor-card supervisor-card--pending"><div class="supervisor-card__content"><header class="record-card__header"><div><h3>Ocorrência ${escapeHtml(record.occurrenceNumber || '—')}</h3><small>${escapeHtml(record.recordId)}</small></div><span class="status-chip status-chip--${statusTone(status)}">${escapeHtml(statusLabel(status, photoCount))}</span></header><p>${escapeHtml(occurrenceTypesText(record) || 'Tipo não informado')}</p><div class="record-card__body"><div class="record-meta"><span>Equipe</span><strong>${escapeHtml(record.team || '—')}</strong></div><div class="record-meta"><span>Sub-base</span><strong>${escapeHtml(record.base || '—')}</strong></div><div class="record-meta"><span>Enviado por</span><strong>${escapeHtml(record.user || '—')}</strong></div><div class="record-meta"><span>Fotos sincronizadas</span><strong>${photoCount}/5</strong></div></div>${meta}${syncRequest ? '<span class="status-chip status-chip--warning">SINCRONISMO SOLICITADO</span>' : ''}${status === RECORD_STATUS.CORRECTION_REQUESTED && request.photoIndexes.length ? `<div class="photo-count">▧ ${escapeHtml(request.photoIndexes.map(photoIndexLabel).join(', '))}</div>` : ''}<div class="record-progress"><span style="width:${Math.min(100, photoCount / 5 * 100)}%"></span></div><footer class="record-card__footer"><span class="photo-count">${escapeHtml(formatDateTime(record.updatedAt || record.reviewedAt || record.registeredAt))}</span><div class="button-row">${status === RECORD_STATUS.SYNCING_PHOTOS ? `<button class="button button--warning button--small" type="button" data-request-photo-sync="${escapeHtml(record.recordId)}" ${supervisorMutationRunning ? 'disabled' : ''}>${syncRequest ? 'Solicitar novamente' : 'Solicitar sincronismo'}</button>` : ''}<button class="button button--primary button--small" type="button" data-review-record="${escapeHtml(record.recordId)}">Ver ocorrência</button></div></footer></div></article>`;
}

function publishedSupervisorCard(record) {
  return `<article class="record-card supervisor-card supervisor-card--pending"><div class="supervisor-card__content"><header class="record-card__header"><div><h3>Ocorrência ${escapeHtml(record.occurrenceNumber || '—')}</h3><small>${escapeHtml(record.recordId)}</small></div><span class="status-chip status-chip--success">Publicada</span></header><div class="record-card__body"><div class="record-meta"><span>Sub-base</span><strong>${escapeHtml(record.base || '—')}</strong></div><div class="record-meta"><span>Equipe</span><strong>${escapeHtml(record.team || '—')}</strong></div><div class="record-meta"><span>Chefe de turma</span><strong>${escapeHtml(record.crewLeader || '—')}</strong></div><div class="record-meta"><span>Publicada em</span><strong>${escapeHtml(formatDateTime(record.publishedAt || record.approvedAt || record.reviewedAt))}</strong></div></div><footer class="record-card__footer"><span>Somente visualização</span><button class="button button--primary button--small" type="button" data-review-record="${escapeHtml(record.recordId)}">Ver ocorrência</button></footer></div></article>`;
}

function renderSupervisorCards(records, renderCard) {
  return records.map((record) => {
    try { return renderCard(record); }
    catch (error) {
      console.error('[Supervisor] Falha ao exibir uma ocorrência.', { recordId: record.recordId, error });
      return `<article class="record-card">${emptyState('Não foi possível exibir esta ocorrência.', `UUID: ${record.recordId}. Os demais registros continuam disponíveis.`)}</article>`;
    }
  }).join('');
}

function renderSupervisorList(error = null) {
  const loadError = error || supervisorLoadError;
  const photoSyncArea = supervisorTab === 'pending' && supervisorPendingFilter === 'photos';
  elements.photoSyncBatchToolbar.hidden = !photoSyncArea;
  elements.requestAllPhotoSyncButton.disabled = true;
  renderSupervisorNavigation();
  elements.supervisorList.setAttribute('aria-busy', String(supervisorLoading));
  elements.supervisorList.dataset.state = supervisorLoadState;
  elements.supervisorFilterSummary.dataset.updatedAt = supervisorLastLoadedAt;
  elements.supervisorFilterSummary.title = supervisorLastLoadedAt ? `Última carga válida: ${formatDateTime(supervisorLastLoadedAt)}` : '';
  if (loadError) {
    elements.approveAllFooter.hidden = true;
    setSupervisorSummary(supervisorDataLoaded ? 'Falha ao atualizar · números da última carga' : 'Falha ao carregar', 'error');
    selectedSupervisorIds.clear();
    elements.supervisorList.innerHTML = `${emptyState('Não foi possível carregar as ocorrências.', friendlyError(loadError))}<div class="empty-state-action"><button class="button button--primary" type="button" data-supervisor-retry>Tentar novamente</button></div>`;
    elements.approveSelectedButton.disabled = true; elements.approveAllButton.disabled = true; return;
  }
  if (supervisorLoading && !supervisorDataLoaded) {
    elements.approveAllFooter.hidden = true;
    setSupervisorSummary('Carregando ocorrências…', 'loading');
    elements.supervisorList.innerHTML = emptyState('Carregando ocorrências…', 'Aguarde enquanto buscamos ocorrências e pendências em uma única carga.');
    elements.approveSelectedButton.disabled = true; elements.approveAllButton.disabled = true; return;
  }
  const visibleRecords = filteredSupervisorRecords();
  const activeRecords = supervisorActiveRecords();
  elements.requestAllPhotoSyncButton.disabled = supervisorMutationRunning || supervisorLoading || !visibleRecords.length;
  elements.approveAllFooter.hidden = supervisorTab !== 'occurrences' || !visibleRecords.length;
  elements.approveAllButton.disabled = !visibleRecords.length;
  const { from, to } = supervisorFilterRange();
  if (!validDateRange(from, to)) {
    elements.approveAllFooter.hidden = true;
    setSupervisorSummary('Confira as datas: a inicial não pode ser posterior à final.', 'error');
    elements.supervisorList.innerHTML = emptyState('Período inválido', 'Ajuste as datas para aplicar o filtro.');
    updateSupervisorSelectionUi(); return;
  }
  const countText = visibleRecords.length === activeRecords.length
    ? supervisorActiveCountLabel(activeRecords.length)
    : `${supervisorActiveCountLabel(visibleRecords.length)} · ${activeRecords.length} no total`;
  setSupervisorSummary(supervisorLoading ? `Atualizando · ${countText}` : countText, supervisorLoading ? 'loading' : 'ready');
  if (!activeRecords.length) {
    const emptyTitle = supervisorTab === 'occurrences' ? 'Nenhuma ocorrência aguardando conferência.' : supervisorTab === 'published' ? 'Nenhuma ocorrência publicada.' : supervisorPendingFilter === 'correction' ? 'Nenhuma correção solicitada.' : 'Nenhuma foto pendente.';
    const emptyMessage = supervisorTab === 'occurrences' ? 'As ocorrências completas aparecerão aqui para conferência.' : supervisorTab === 'published' ? 'As ocorrências confirmadas aparecerão aqui para consulta.' : 'Quando uma ocorrência exigir esta ação, ela aparecerá aqui.';
    elements.supervisorList.innerHTML = emptyState(emptyTitle, emptyMessage);
    updateSupervisorSelectionUi(); return;
  }
  if (!visibleRecords.length) {
    elements.supervisorList.innerHTML = emptyState('Nenhuma ocorrência encontrada.', 'Ajuste os filtros para ver outras pendências.');
    updateSupervisorSelectionUi(); return;
  }
  if (supervisorTab === 'pending') {
    selectedSupervisorIds.clear();
    elements.supervisorList.innerHTML = renderSupervisorCards(visibleRecords, pendingSupervisorCard);
    updateSupervisorSelectionUi(); return;
  }
  if (supervisorTab === 'published') {
    selectedSupervisorIds.clear();
    elements.supervisorList.innerHTML = renderSupervisorCards(visibleRecords.slice(0, publishedVisibleLimit), publishedSupervisorCard)
      + (visibleRecords.length > publishedVisibleLimit ? `<div class="empty-state-action"><button class="button button--ghost" type="button" data-published-more>Carregar mais publicadas (${visibleRecords.length - publishedVisibleLimit} restantes)</button></div>` : '');
    updateSupervisorSelectionUi(); return;
  }
  elements.supervisorList.innerHTML = renderSupervisorCards(visibleRecords, (record) => {
    const failures = supervisorPhotoFailures.get(record.recordId) || new Set(); const issues = photoIssueIndexes(record, failures); const pricingIssues = supervisorPricingIssues(record); const eligible = !issues.length && !pricingIssues.length && record.status === RECORD_STATUS.WAITING_SUPERVISOR; const photoCount = Math.max(countConfirmedPhotos(record), countReadyPhotoStates(record));
    const checked = eligible && selectedSupervisorIds.has(record.recordId); const urls = photoUrlsForRecord(record);
    const thumbs = urls.map((url, index) => url ? `<button type="button" data-photo-index="${index + 1}" data-record-photo-id="${escapeHtml(record.recordId)}" data-zoom-src="${escapeHtml(url)}" data-zoom-label="Foto ${index + 1}"><img src="${escapeHtml(url)}" alt="Foto ${index + 1}" data-fallback-src="${escapeHtml(photoFallbackUrl(url))}" /></button>` : `<button type="button" disabled aria-label="Foto ${index + 1} indisponível"><span>${index + 1}</span></button>`).join('');
    const total = occurrenceTotal(record.services || []); const daily = record.dailyProduction || {}; const dailyProgress = goalProgress(Number(daily.totalSent) || 0, Number(daily.goal) || TEAM_GOAL);
    const correction = record?.audit?.lastSupervisorCorrection;
    return `<article class="record-card supervisor-card"><input type="checkbox" aria-label="Selecionar ocorrência ${escapeHtml(record.occurrenceNumber)}" data-supervisor-select="${escapeHtml(record.recordId)}" ${checked ? 'checked' : ''} ${eligible ? '' : 'disabled'} /><div class="supervisor-card__content"><header class="record-card__header"><div><div class="supervisor-title-line"><h3>Ocorrência ${escapeHtml(record.occurrenceNumber)}</h3>${correctedAfterResend(record) ? '<span class="status-chip status-chip--success corrected-badge">CORRIGIDO</span>' : ''}</div><small>${escapeHtml(record.recordId)}</small></div><span class="status-chip status-chip--${issues.length ? 'danger' : 'warning'}">${photoCount}/5 fotos gerais</span></header><p>${escapeHtml(occurrenceTypesText(record))}</p><div class="record-card__body"><div class="record-meta"><span>Sub-base</span><strong>${escapeHtml(record.base || '—')}</strong></div><div class="record-meta"><span>Contrato</span><strong>${escapeHtml(record.contract || '—')}</strong></div><div class="record-meta"><span>Equipe</span><strong>${escapeHtml(record.team)}</strong></div><div class="record-meta"><span>Chefe de turma</span><strong>${escapeHtml(record.crewLeader || '—')}</strong></div><div class="record-meta"><span>Valor desta ocorrência</span><strong>${escapeHtml(formatCurrency(total))}</strong></div><div class="record-meta"><span>Produção da equipe hoje</span><strong>${escapeHtml(formatCurrency(dailyProgress.total))}</strong></div><div class="record-meta"><span>Meta diária · Ao vivo</span><strong>${escapeHtml(formatNumber(dailyProgress.percentage))}%</strong></div></div>${pricingIssues.length ? `<div class="status-chip status-chip--danger">${escapeHtml(pricingIssues[0])}</div>` : ''}${correction ? `<div class="supervisor-correction-badge">✓ Corrigido pelo supervisor — ${escapeHtml(correction.supervisor || 'Supervisor')} · ${escapeHtml(formatDateTime(correction.correctedAt))}</div>` : ''}<div class="supervisor-thumbs">${thumbs}</div><footer class="record-card__footer"><span class="live-indicator"><i></i> Ao vivo</span><button class="button button--primary button--small" type="button" data-review-record="${escapeHtml(record.recordId)}">Conferir ocorrência</button></footer></div></article>`;
  }); updateSupervisorSelectionUi();
}

function handleSupervisorListClick(event) {
  const retry = event.target.closest('[data-supervisor-retry]');
  if (retry) return refreshSupervisor(true);
  if (event.target.closest('[data-published-more]')) { publishedVisibleLimit += 60; renderSupervisorList(); return; }
  const sync = event.target.closest('[data-request-photo-sync]');
  if (sync) return requestPhotoSync(sync.dataset.requestPhotoSync);
  const review = event.target.closest('[data-review-record]'); const zoom = event.target.closest('[data-zoom-src]');
  if (zoom) return openPhotoFromElement(zoom); if (review) openSupervisorReview(review.dataset.reviewRecord);
}

function handleSupervisorSelection(event) { const checkbox = event.target.closest('[data-supervisor-select]'); if (!checkbox) return; if (checkbox.checked) selectedSupervisorIds.add(checkbox.dataset.supervisorSelect); else selectedSupervisorIds.delete(checkbox.dataset.supervisorSelect); updateSupervisorSelectionUi(); }
function supervisorPricingIssues(record) {
  return serviceSnapshotErrors(record?.services);
}
function selectableSupervisorRecords() { return filteredSupervisorRecords().filter((record) => record.status === RECORD_STATUS.WAITING_SUPERVISOR && !photoIssueIndexes(record, supervisorPhotoFailures.get(record.recordId) || []).length && !supervisorPricingIssues(record).length); }
function selectAllSupervisorVisible() { if (elements.selectAllVisible.checked) selectableSupervisorRecords().forEach((record) => selectedSupervisorIds.add(record.recordId)); else selectedSupervisorIds.clear(); $$('[data-supervisor-select]').forEach((checkbox) => { checkbox.checked = selectedSupervisorIds.has(checkbox.dataset.supervisorSelect); }); updateSupervisorSelectionUi(); }
function updateSupervisorSelectionUi() {
  const selectable = selectableSupervisorRecords(); const selectableIds = new Set(selectable.map((record) => record.recordId));
  selectedSupervisorIds = new Set([...selectedSupervisorIds].filter((id) => selectableIds.has(id)));
  $$('[data-supervisor-select]', elements.supervisorList).forEach((checkbox) => { const eligible = selectableIds.has(checkbox.dataset.supervisorSelect); checkbox.disabled = !eligible; checkbox.checked = eligible && selectedSupervisorIds.has(checkbox.dataset.supervisorSelect); });
  const count = selectedSupervisorIds.size; elements.selectedCountLabel.textContent = `${count} ${count === 1 ? 'ocorrência selecionada' : 'ocorrências selecionadas'}`; elements.approveSelectedButton.disabled = !count; elements.selectAllVisible.checked = Boolean(selectable.length && count === selectable.length); elements.selectAllVisible.indeterminate = count > 0 && count < selectable.length;
}

function activeSupervisorPhotoIssues() { return activeSupervisorRecord ? photoIssueIndexes(activeSupervisorRecord, supervisorPhotoFailures.get(activeSupervisorRecord.recordId) || []) : []; }
function correctionPhotoIndexes(record) {
  const value = record?.audit?.lastCorrectionRequest?.photoIndexes ?? record?.audit?.lastPhotoCorrectionRequest?.photoIndexes ?? record?.audit?.requestedPhotoIndexes ?? [];
  return normalizeArray(value, 'audit.requestedPhotoIndexes').map(Number).filter((index) => Number.isInteger(index) && index >= 1 && index <= 7);
}
function photoIndexLabel(index) { return index === 6 ? 'Foto Trafo retirado' : index === 7 ? 'Foto Trafo instalado' : `Foto ${index}`; }
function updateSupervisorReviewActions() {
  const issues = activeSupervisorPhotoIssues(); const pricingIssues = supervisorPricingIssues(activeSupervisorRecord); const ready = !issues.length && !pricingIssues.length && activeSupervisorRecord?.status === RECORD_STATUS.WAITING_SUPERVISOR;
  const status = activeSupervisorRecord?.status;
  const position = reviewOrder.indexOf(activeSupervisorRecord?.recordId);
  const readOnly = reviewTab === 'published';
  elements.reviewDialogMode.textContent = readOnly ? 'Publicada · somente visualização' : 'Conferência detalhada';
  elements.reviewPosition.textContent = position < 0 ? '' : `${position + 1} de ${reviewOrder.length}`;
  elements.previousReviewButton.disabled = supervisorMutationRunning || position <= 0;
  elements.nextReviewButton.disabled = supervisorMutationRunning || position < 0 || position >= reviewOrder.length - 1;
  elements.editOccurrenceButton.hidden = status !== RECORD_STATUS.WAITING_SUPERVISOR;
  elements.requestCorrectionButton.hidden = !activeSupervisorRecord || ![RECORD_STATUS.WAITING_SUPERVISOR, RECORD_STATUS.SYNCING_PHOTOS].includes(status);
  elements.requestCorrectionButton.textContent = issues.length ? `Solicitar correção · ${issues.map(photoIndexLabel).join(', ')}` : 'Solicitar correção';
  elements.requestPhotoSyncButton.hidden = status !== RECORD_STATUS.SYNCING_PHOTOS;
  elements.requestPhotoSyncButton.disabled = supervisorMutationRunning;
  elements.requestPhotoSyncButton.textContent = openPhotoSyncRequest(activeSupervisorRecord) ? 'Solicitar novamente' : 'Solicitar sincronismo';
  elements.approveButton.hidden = status !== RECORD_STATUS.WAITING_SUPERVISOR;
  elements.rejectButton.hidden = status !== RECORD_STATUS.WAITING_SUPERVISOR;
  if (readOnly) {
    [elements.editOccurrenceButton, elements.requestCorrectionButton, elements.requestPhotoSyncButton, elements.approveButton, elements.rejectButton].forEach((button) => { button.hidden = true; });
  }
  elements.approveButton.disabled = !ready; elements.rejectButton.disabled = !ready;
}
function openSupervisorReview(recordId, preserveOrder = false) {
  if (!preserveOrder) { reviewOrder = filteredSupervisorRecords().map((record) => record.recordId); reviewTab = supervisorTab; }
  if (reviewTab !== supervisorTab || !reviewOrder.includes(recordId)) return;
  activeSupervisorRecord = filteredSupervisorRecords().find((record) => record.recordId === recordId) || null;
  if (!activeSupervisorRecord) return;
  const photoCount = Math.max(countConfirmedPhotos(activeSupervisorRecord), countReadyPhotoStates(activeSupervisorRecord));
  elements.reviewDialogTitle.textContent = reviewTab === 'published' ? `Ocorrência ${activeSupervisorRecord.occurrenceNumber || '—'} · Publicada` : `Ocorrência ${activeSupervisorRecord.occurrenceNumber} · ${photoCount}/5 fotos`;
  elements.reviewDialogContent.innerHTML = reviewTab === 'published' && !publishedDetailCache.has(recordId)
    ? emptyState('Carregando ocorrência publicada', 'Buscando os dados completos para consulta.')
    : occurrenceDetails(activeSupervisorRecord);
  updateSupervisorReviewActions(); openScrollableDialog(elements.reviewDialog, elements.reviewDialogContent);
  if (reviewTab === 'published' && !publishedDetailCache.has(recordId)) {
    void loadPublishedDetailBatch(recordId).then(() => {
      if (elements.reviewDialog.open && activeSupervisorRecord?.recordId === recordId && reviewTab === 'published') openSupervisorReview(recordId, true);
    }).catch((error) => {
      if (elements.reviewDialog.open && activeSupervisorRecord?.recordId === recordId) {
        elements.reviewDialogContent.innerHTML = `${emptyState('Não foi possível carregar a publicação', friendlyError(error))}<div class="empty-state-action"><button class="button button--primary" type="button" data-published-retry>Tentar novamente</button></div>`;
      }
    });
  }
}

function loadPublishedDetailBatch(recordId) {
  const index = reviewOrder.indexOf(recordId);
  if (index < 0) return Promise.reject(new ApiError('Ocorrência fora da lista atual.', 'INVALID_PUBLISHED_RECORD'));
  const batchIds = reviewOrder.slice(Math.floor(index / 20) * 20, Math.floor(index / 20) * 20 + 20)
    .filter((id) => !publishedDetailCache.has(id));
  if (!batchIds.length) return Promise.resolve();
  const key = batchIds.join('|');
  if (publishedDetailRequests.has(key)) return publishedDetailRequests.get(key);
  const revision = sessionRevision;
  const task = api.listPublishedRecords(session.token, batchIds).then((result) => {
    if (revision !== sessionRevision) return;
    if (!Array.isArray(result.records)) throw new ApiError('O servidor retornou uma lista de publicadas inválida.', 'INVALID_PUBLISHED_PAYLOAD');
    const requested = new Set(batchIds);
    for (const record of uniqueRecordsById(normalizeOccurrenceRecords(result.records, 'listPublishedRecords.records'))) {
      if (requested.has(record.recordId) && record.status === RECORD_STATUS.PUBLISHED) publishedDetailCache.set(record.recordId, record);
    }
    if (!publishedDetailCache.has(recordId)) throw new ApiError('Esta publicação não está mais disponível. Atualize o painel.', 'PUBLISHED_NOT_FOUND');
  }).finally(() => { if (publishedDetailRequests.get(key) === task) publishedDetailRequests.delete(key); });
  publishedDetailRequests.set(key, task);
  return task;
}

function moveSupervisorReview(direction) {
  if (!activeSupervisorRecord || supervisorMutationRunning || reviewTab !== supervisorTab) return;
  const index = reviewOrder.indexOf(activeSupervisorRecord.recordId);
  const id = reviewOrder[index + direction];
  if (id) openSupervisorReview(id, true);
}

function advanceSupervisorAfterAction(beforeIds, recordId) {
  const nextId = nextVisibleRecordId(beforeIds, recordId, filteredSupervisorRecords().map((record) => record.recordId));
  if (elements.reviewDialog.open) elements.reviewDialog.close();
  if (nextId && reviewTab === supervisorTab) openSupervisorReview(nextId);
  else activeSupervisorRecord = null;
}

function openSupervisorEditor() {
  if (!activeSupervisorRecord || reviewTab === 'published') return;
  supervisorEditRecord = JSON.parse(JSON.stringify(activeSupervisorRecord));
  supervisorEditRecord.occurrenceTypes = normalizeOccurrenceTypes(supervisorEditRecord.occurrenceTypes);
  supervisorEditRecord.services = normalizeServices(supervisorEditRecord.services).map((service) => ({ ...service, lineId: service.lineId || generateUuid() }));
  supervisorEditRecord.materials = normalizeMaterials(supervisorEditRecord.materials).map((material) => ({ ...material, lineId: material.lineId || generateUuid() }));
  elements.supervisorEditTitle.textContent = `Corrigir ocorrência ${supervisorEditRecord.occurrenceNumber}`;
  supervisorAssignmentSnapshot = { base: supervisorEditRecord.base, team: supervisorEditRecord.team, crewLeader: supervisorEditRecord.crewLeader };
  elements.editOperationBase.value = supervisorEditRecord.base || ''; updateContractOutput(elements.editOperationContract, supervisorEditRecord.base); renderAssignmentControls(true, supervisorEditRecord); elements.editOccurrenceNumber.value = supervisorEditRecord.occurrenceNumber || '';
  $$('input[type="checkbox"]', elements.editOccurrenceTypes).forEach((input) => { input.checked = supervisorEditRecord.occurrenceTypes?.includes(input.value); });
  elements.editOtherOccurrenceType.value = supervisorEditRecord.otherOccurrenceType || '';
  elements.editPgPostRemoved.value = supervisorEditRecord.pgPostRemoved || supervisorEditRecord.pg1 || ''; elements.editPgPostInstalled.value = supervisorEditRecord.pgPostInstalled || supervisorEditRecord.pg2 || '';
  elements.editPgConductorStart.value = supervisorEditRecord.pgConductorStart || supervisorEditRecord.pg1 || ''; elements.editPgConductorEnd.value = supervisorEditRecord.pgConductorEnd || supervisorEditRecord.pg2 || '';
  elements.editRemovedTransformerCode.value = supervisorEditRecord.transformer?.removedCode || ''; elements.editRemovedTransformerCia.value = supervisorEditRecord.transformer?.removedCia || '';
  elements.editRemovedTransformerBto.value = supervisorEditRecord.transformer?.removedBto || ''; elements.editNewTransformerCode.value = supervisorEditRecord.transformer?.newCode || '';
  elements.editNewTransformerCia.value = supervisorEditRecord.transformer?.newCia || ''; elements.editNewTransformerBto.value = supervisorEditRecord.transformer?.newBto || '';
  elements.editObservation.value = supervisorEditRecord.observation || ''; elements.editServiceSearch.value = ''; elements.editServiceResults.hidden = true; elements.editMaterialSearch.value = ''; elements.editMaterialResults.hidden = true; elements.supervisorEditErrors.textContent = '';
  syncSupervisorEditorFromForm(); renderSupervisorEditServices(); renderSupervisorEditMaterials();
  elements.reviewDialog.close(); openScrollableDialog(elements.supervisorEditDialog, elements.supervisorEditDialog.querySelector('.modal__body'));
}

function handleSupervisorBaseChange() {
  if (!supervisorEditRecord) return;
  supervisorAssignmentSnapshot = null; elements.editTeam.value = ''; elements.editCrewLeader.value = '';
  renderAssignmentControls(true);
  clearTimeout(supervisorEditSearchTimer);
  supervisorEditCatalogRequestId += 1;
  elements.editServiceResults.hidden = true;
  syncSupervisorEditorFromForm();
  renderSupervisorEditServices();
  elements.supervisorEditErrors.textContent = '';
  updateContractOutput(elements.editOperationContract, supervisorEditRecord.base);
}

function syncSupervisorEditorFromForm() {
  if (!supervisorEditRecord) return null;
  const occurrenceTypes = $$('input[type="checkbox"]', elements.editOccurrenceTypes).filter((input) => input.checked).map((input) => input.value);
  const hasTransformer = occurrenceTypes.includes(TYPE_TRAFO) || Object.values(supervisorEditRecord.transformer || {}).some(value => String(value ?? '').trim()); elements.editTransformerSection.hidden = !hasTransformer;
  const hasPost = occurrenceTypes.includes(TYPE_POST) || Boolean(supervisorEditRecord.pgPostRemoved || supervisorEditRecord.pgPostInstalled); elements.editPgPostSection.hidden = !hasPost;
  const hasConductor = occurrenceTypes.includes(TYPE_CONDUCTOR) || Boolean(supervisorEditRecord.pgConductorStart || supervisorEditRecord.pgConductorEnd); elements.editPgConductorSection.hidden = !hasConductor;
  const hasOther = occurrenceTypes.includes(TYPE_OTHER); elements.editOtherTypeSection.hidden = !hasOther;
  supervisorEditRecord = {
    ...supervisorEditRecord, base: elements.editOperationBase.value, contract: elements.editOperationBase.value === activeSupervisorRecord?.base ? (activeSupervisorRecord.contract || contractForBase(elements.editOperationBase.value)) : contractForBase(elements.editOperationBase.value), team: elements.editTeam.value.trim(), crewLeader: elements.editCrewLeader.value.trim(), occurrenceNumber: elements.editOccurrenceNumber.value.trim(), occurrenceTypes,
    otherOccurrenceType: hasOther ? elements.editOtherOccurrenceType.value.trim() : '',
    pgPostRemoved: hasPost ? elements.editPgPostRemoved.value.trim() : '', pgPostInstalled: hasPost ? elements.editPgPostInstalled.value.trim() : '',
    pgConductorStart: hasConductor ? elements.editPgConductorStart.value.trim() : '', pgConductorEnd: hasConductor ? elements.editPgConductorEnd.value.trim() : '', observation: elements.editObservation.value.trim(),
    transformer: hasTransformer ? { removedCode: elements.editRemovedTransformerCode.value.trim(), removedCia: elements.editRemovedTransformerCia.value.trim(), removedBto: elements.editRemovedTransformerBto.value.trim(), newCode: elements.editNewTransformerCode.value.trim(), newCia: elements.editNewTransformerCia.value.trim(), newBto: elements.editNewTransformerBto.value.trim() } : { removedCode: '', removedCia: '', removedBto: '', newCode: '', newCia: '', newBto: '' }
  };
  updateContractOutput(elements.editOperationContract, supervisorEditRecord.base);
  return supervisorEditRecord;
}

function renderSupervisorEditServices() {
  if (!supervisorEditRecord) return;
  elements.editServicesList.innerHTML = supervisorEditRecord.services.length ? supervisorEditRecord.services.map((service, index) => `<article class="selected-service"><div class="line-item__main"><div><span class="line-item__index">${index + 1}</span><strong>${escapeHtml(service.code)}</strong><p>${escapeHtml(service.catalogText)}</p><small>${escapeHtml(service.unit || '—')} · Contrato ${escapeHtml(service.contract || supervisorEditRecord.contract || '—')} · ${escapeHtml(servicePriceText(service))}</small></div><button class="icon-button delete-photo" type="button" data-edit-remove-service="${escapeHtml(service.lineId)}" aria-label="Remover serviço">×</button></div><div class="readonly-grid"><label class="field"><span>QTD *</span><input type="text" inputmode="decimal" data-edit-service-quantity="${escapeHtml(service.lineId)}" value="${escapeHtml(service.quantity)}" /></label><div class="field"><span>Valor unitário</span><strong>${escapeHtml(servicePriceText(service))}</strong></div><div class="field field--wide"><span>Valor total</span><strong>${escapeHtml(service.referenceValue == null ? 'Indisponível' : formatCurrency(serviceTotal(service)))}</strong></div></div></article>`).join('') : '<div class="line-items__empty">Adicione pelo menos um serviço da aba Emergência.</div>';
}

function renderSupervisorEditMaterials() {
  if (!supervisorEditRecord) return;
  elements.editMaterialsList.innerHTML = supervisorEditRecord.materials.length ? normalizeMaterials(supervisorEditRecord.materials).map((material, index) => `<article class="line-item material-row"><div class="line-item__main"><div><span class="line-item__index">${index + 1}</span>${material.code ? `<strong>${escapeHtml(material.code)}</strong>` : ''}<p>${escapeHtml(material.description)}</p>${material.unit ? `<small>Unidade: ${escapeHtml(material.unit)}</small>` : '<small>Registro histórico sem código/unidade</small>'}</div><button class="icon-button delete-photo" type="button" data-edit-remove-material="${escapeHtml(material.lineId)}" aria-label="Remover material">×</button></div><div class="line-item__fields"><label class="field material-quantity"><span>QTD *</span><div class="quantity-with-unit"><input type="text" inputmode="${normalizeText(material.unit) === 'UN' ? 'numeric' : 'decimal'}" data-edit-material-quantity="${escapeHtml(material.lineId)}" value="${escapeHtml(material.quantity)}" /><strong>${escapeHtml(material.unit || '')}</strong></div></label></div></article>`).join('') : '<div class="line-items__empty">Adicione pelo menos um material do Caderno de Materiais.</div>';
}

function searchSupervisorCatalog() {
  clearTimeout(supervisorEditSearchTimer); const query = elements.editServiceSearch.value.trim();
  const requestId = ++supervisorEditCatalogRequestId; const revision = sessionRevision; const requestSession = session; const recordId = supervisorEditRecord?.recordId;
  if (query.length < 2) { elements.editServiceResults.hidden = true; return; }
  const contract = contractForBase(elements.editOperationBase.value);
  if (!contract) { elements.editServiceResults.hidden = true; elements.supervisorEditErrors.textContent = 'Selecione a Sub-base para definir o contrato e os valores dos serviços.'; return; }
  supervisorEditSearchTimer = setTimeout(async () => {
    try {
      const result = await api.searchCatalog(requestSession.token, query, 25, contract);
      if (requestId !== supervisorEditCatalogRequestId || revision !== sessionRevision || supervisorEditRecord?.recordId !== recordId || elements.editServiceSearch.value.trim() !== query) return;
      supervisorEditCatalogResults = normalizeArray(result.results, 'searchCatalog.results').filter((item) => item && typeof item === 'object' && !Array.isArray(item)); elements.editServiceResults.innerHTML = supervisorEditCatalogResults.length ? supervisorEditCatalogResults.map((item, index) => { const priced = priceServiceForContract(item, contract); return `<button class="search-result" type="button" data-edit-catalog-index="${index}"><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.catalogText)}</span><small>${escapeHtml(item.unit)} · Contrato ${escapeHtml(contract)} · ${escapeHtml(servicePriceText(priced))}</small></button>`; }).join('') : '<p class="search-empty">Nenhum serviço encontrado.</p>'; elements.editServiceResults.hidden = false;
    } catch (error) { if (requestId === supervisorEditCatalogRequestId && revision === sessionRevision) elements.supervisorEditErrors.textContent = friendlyError(error); }
  }, 260);
}

function selectSupervisorCatalogItem(event) {
  const button = event.target.closest('[data-edit-catalog-index]'); if (!button || !supervisorEditRecord) return;
  const item = supervisorEditCatalogResults[Number(button.dataset.editCatalogIndex)]; if (!item) return;
  const contract = contractForBase(elements.editOperationBase.value);
  if (!contract) { elements.supervisorEditErrors.textContent = 'Selecione a Sub-base para definir o contrato e os valores dos serviços.'; return; }
  const priced = priceServiceForContract(item, contract);
  if (priced.referenceValue == null) { elements.supervisorEditErrors.textContent = `Serviço sem valor cadastrado para o contrato ${contract}.`; return; }
  const existing = supervisorEditRecord.services.find((service) => service.catalogKey === item.catalogKey && service.code === item.code);
  if (existing) existing.quantity = Math.max(1, parseServiceQuantity(existing.quantity) || 1);
  else supervisorEditRecord.services.push({ ...priced, lineId: generateUuid(), quantity: 1, totalValue: priced.referenceValue });
  elements.editServiceSearch.value = ''; elements.editServiceResults.hidden = true; renderSupervisorEditServices();
}

function handleSupervisorServiceEdit(event) {
  if (!supervisorEditRecord) return;
  const remove = event.target.closest('[data-edit-remove-service]'); if (remove) { supervisorEditRecord.services = supervisorEditRecord.services.filter((service) => service.lineId !== remove.dataset.editRemoveService); renderSupervisorEditServices(); return; }
  const input = event.target.closest('[data-edit-service-quantity]'); if (!input) return;
  const service = supervisorEditRecord.services.find((item) => item.lineId === input.dataset.editServiceQuantity); if (!service) return;
  service.quantity = input.value; if (event.type === 'input') { const total = input.closest('.selected-service')?.querySelector('.field--wide strong'); if (total) total.textContent = formatCurrency(serviceTotal(service)); }
}

function searchSupervisorMaterials() {
  clearTimeout(supervisorEditMaterialSearchTimer); const query = elements.editMaterialSearch.value.trim();
  const requestId = ++supervisorEditMaterialRequestId; const revision = sessionRevision; const recordId = supervisorEditRecord?.recordId;
  if (query.length < 2) { elements.editMaterialResults.hidden = true; return; }
  supervisorEditMaterialSearchTimer = setTimeout(async () => {
    try {
      await ensureMaterialCatalog();
      if (requestId !== supervisorEditMaterialRequestId || revision !== sessionRevision || supervisorEditRecord?.recordId !== recordId || elements.editMaterialSearch.value.trim() !== query) return;
      supervisorEditMaterialResults = searchMaterialCatalog(materialCatalog, query, 40);
      elements.editMaterialResults.innerHTML = supervisorEditMaterialResults.length ? supervisorEditMaterialResults.map((item, index) => `<button class="search-result" type="button" data-edit-material-index="${index}"><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.description)}</span><small>${escapeHtml(item.unit)}</small></button>`).join('') : '<p class="search-empty">Nenhum material encontrado no Caderno de Materiais.</p>';
      elements.editMaterialResults.hidden = false;
    } catch (error) { if (requestId === supervisorEditMaterialRequestId && revision === sessionRevision) elements.supervisorEditErrors.textContent = friendlyError(error); }
  }, 220);
}

function selectSupervisorMaterial(event) {
  const button = event.target.closest('[data-edit-material-index]'); if (!button || !supervisorEditRecord) return;
  const item = supervisorEditMaterialResults[Number(button.dataset.editMaterialIndex)]; if (!item) return;
  const key = materialKey(item);
  const existing = normalizeMaterials(supervisorEditRecord.materials).find((material) => materialKey(material) === key);
  if (existing) { toast('Este material já foi adicionado.', 'error'); return; }
  supervisorEditRecord.materials.push({ ...item, lineId: generateUuid(), materialKey: key, quantity: 1, origin: 'Caderno de Obras' });
  elements.editMaterialSearch.value = ''; elements.editMaterialResults.hidden = true; supervisorEditMaterialResults = []; renderSupervisorEditMaterials();
}

function handleSupervisorMaterialEdit(event) {
  if (!supervisorEditRecord) return;
  const remove = event.target.closest('[data-edit-remove-material]'); if (remove) { supervisorEditRecord.materials = supervisorEditRecord.materials.filter((material) => material.lineId !== remove.dataset.editRemoveMaterial); renderSupervisorEditMaterials(); return; }
  const quantity = event.target.closest('[data-edit-material-quantity]'); if (!quantity) return;
  const material = supervisorEditRecord.materials.find((item) => item.lineId === quantity.dataset.editMaterialQuantity); if (!material) return;
  material.quantity = quantity.value;
}

async function saveSupervisorCorrection(event) {
  const requestSession = session; const revision = sessionRevision;
  const isCurrent = () => revision === sessionRevision && session?.token === requestSession?.token;
  event.preventDefault(); if (!supervisorEditRecord || !activeSupervisorRecord || supervisorMutationRunning) return;
  const reviewedId = activeSupervisorRecord.recordId;
  const beforeIds = [...reviewOrder];
  const draft = syncSupervisorEditorFromForm();
  const errors = validateOccurrence(draft, { historicalServices: true });
  const relationError = assignmentError(draft, supervisorAssignmentSnapshot); if (relationError) errors.push(relationError);
  if (errors.length) { elements.supervisorEditErrors.innerHTML = errors.map((error) => `• ${escapeHtml(error)}`).join('<br>'); return; }
  if (!supervisorCorrectionChanges(activeSupervisorRecord, draft).length) { elements.supervisorEditErrors.textContent = 'Nenhuma alteração foi identificada.'; return; }
  supervisorMutationRunning = true;
  setBusy(elements.saveSupervisorEditButton, true, 'Salvando…'); elements.supervisorEditErrors.textContent = '';
  try {
    const result = await api.supervisorCorrectRecord(requestSession.token, { ...draft, services: serializeServicesForBackend(draft.services), materials: serializeMaterialsForBackend(draft.materials) });
    if (!isCurrent()) return;
    const corrected = normalizeOccurrenceRecord(result.record, 'supervisorCorrectRecord.record'); activeSupervisorRecord = corrected;
    const index = supervisorRecords.findIndex((record) => record.recordId === corrected.recordId); if (index >= 0) supervisorRecords[index] = corrected;
    elements.supervisorEditDialog.close(); renderSupervisorList();
    if (supervisorRefreshPromise) await supervisorRefreshPromise;
    if (!isCurrent()) return;
    const refreshed = await refreshSupervisor(false);
    if (!isCurrent()) return;
    if (refreshed) advanceSupervisorAfterAction(beforeIds, reviewedId);
    else { openSupervisorReview(reviewedId); toast('Correção salva. Atualize o painel antes de seguir para a próxima ocorrência.', 'error'); }
    toast(`Corrigido pelo supervisor — ${requestSession.user}`, 'success');
  } catch (error) { if (!isCurrent()) return; elements.supervisorEditErrors.textContent = friendlyError(error); }
  finally { if (isCurrent()) { setBusy(elements.saveSupervisorEditButton, false); supervisorMutationRunning = false; updateSupervisorReviewActions(); } }
}

async function decideSupervisor(decision) {
  const requestSession = session; const revision = sessionRevision;
  const isCurrent = () => revision === sessionRevision && session?.token === requestSession?.token;
  if (!activeSupervisorRecord || reviewTab === 'published' || supervisorMutationRunning) return;
  supervisorMutationRunning = true;
  updateSupervisorReviewActions();
  let reason = ''; let note = ''; let selectedPhotoIndexes = [];
  try {
    if (decision === 'approve') { if (!await confirmAction('Aprovar e publicar?', `A ocorrência ${activeSupervisorRecord.occurrenceNumber} será publicada na aba oficial.`, 'Aprovar e publicar', 'success')) return; }
    else { const values = await collectDecision(decision); if (!values) return; ({ reason, note } = values); selectedPhotoIndexes = values.photoIndexes || []; const label = decision === 'reject' ? 'reprovar' : 'solicitar correção'; if (!await confirmAction('Confirmar decisão?', `Deseja ${label} na ocorrência ${activeSupervisorRecord.occurrenceNumber}?`, 'Confirmar', decision === 'reject' ? 'danger' : 'warning')) return; }
    if (!isCurrent()) return;
    const button = decision === 'approve' ? elements.approveButton : decision === 'reject' ? elements.rejectButton : elements.requestCorrectionButton; setBusy(button, true, 'Salvando…');
    const reviewedId = activeSupervisorRecord.recordId;
    const beforeIds = [...reviewOrder];
    await api.supervisorAction(requestSession.token, decision, reviewedId, reason, decision === 'request_correction' ? (note || reason) : note, decision === 'request_correction' ? selectedPhotoIndexes : []);
    if (!isCurrent()) return;
    toast(decision === 'approve' ? 'Ocorrência aprovada e publicada.' : decision === 'reject' ? 'Ocorrência reprovada.' : 'Correção solicitada à equipe.', 'success');
    if (supervisorRefreshPromise) await supervisorRefreshPromise;
    if (!isCurrent()) return;
    const refreshed = await refreshSupervisor(false);
    if (!isCurrent()) return;
    if (refreshed) advanceSupervisorAfterAction(beforeIds, reviewedId);
    else { elements.reviewDialog.close(); activeSupervisorRecord = null; toast('Decisão salva. Atualize o painel antes de seguir para a próxima ocorrência.', 'error'); }
  } catch (error) { if (!isCurrent()) return; toast(friendlyError(error), 'error'); }
  finally {
    if (isCurrent()) {
      setBusy(elements.approveButton, false); setBusy(elements.rejectButton, false); setBusy(elements.requestCorrectionButton, false);
      supervisorMutationRunning = false; updateSupervisorReviewActions();
    }
  }
}

async function requestPhotoSync(recordId) {
  const requestSession = session; const revision = sessionRevision;
  const isCurrent = () => revision === sessionRevision && session?.token === requestSession?.token;
  const record = supervisorPendingRecords.find((item) => item.recordId === recordId);
  if (!record || record.status !== RECORD_STATUS.SYNCING_PHOTOS || supervisorMutationRunning) return;
  supervisorMutationRunning = true;
  try {
    if (!await confirmAction('Solicitar sincronismo?', `${record.user || 'O usuário responsável'} receberá um aviso para retomar o envio das fotos pendentes da ocorrência ${record.occurrenceNumber}.`, 'Solicitar', 'warning')) return;
    if (!isCurrent()) return;
    setBusy(elements.requestPhotoSyncButton, true, 'Salvando…');
    await api.supervisorAction(requestSession.token, 'request_photo_sync', recordId);
    if (!isCurrent()) return;
    if (elements.reviewDialog.open) elements.reviewDialog.close();
    await refreshSupervisor(false);
    if (!isCurrent()) return;
    toast(openPhotoSyncRequest(record) ? 'Sincronismo solicitado novamente ao usuário responsável.' : 'Sincronismo solicitado ao usuário responsável.', 'success');
  } catch (error) { if (!isCurrent()) return; toast(friendlyError(error), 'error'); }
  finally { if (isCurrent()) { supervisorMutationRunning = false; setBusy(elements.requestPhotoSyncButton, false); updateSupervisorReviewActions(); } }
}

async function requestAllPhotoSync() {
  const requestSession = session; const revision = sessionRevision;
  const isCurrent = () => revision === sessionRevision && session?.token === requestSession?.token;
  if (supervisorMutationRunning || supervisorLoading || supervisorLoadError || supervisorTab !== 'pending' || supervisorPendingFilter !== 'photos') return;
  const ids = uniqueRecordsById(filteredSupervisorRecords()).filter((record) => record.status === RECORD_STATUS.SYNCING_PHOTOS).map((record) => record.recordId);
  if (!ids.length) return;
  if (ids.length > 200) { toast('Use os filtros para solicitar até 200 ocorrências em um único lote.', 'error'); return; }
  supervisorMutationRunning = true; renderSupervisorList();
  try {
    if (!await confirmAction('Solicitar sincronismo de todas?', `Será enviado ou renovado o aviso ao usuário responsável por cada uma das ${ids.length} ocorrências com fotos pendentes exibidas.`, 'Solicitar de todas', 'warning')) return;
    if (!isCurrent()) return;
    setBusy(elements.requestAllPhotoSyncButton, true, 'Solicitando…');
    const result = await api.requestPhotoSyncBatch(requestSession.token, ids);
    if (!isCurrent()) return;
    const results = normalizeArray(result.results, 'requestPhotoSyncBatch.results');
    const requested = results.filter((item) => item.ok).length;
    const failed = ids.length - requested;
    await refreshSupervisor(false);
    if (!isCurrent()) return;
    elements.supervisorBatchResult.hidden = false;
    elements.supervisorBatchResult.textContent = `${requested} solicitações enviadas/renovadas; ${failed} não realizadas.${failed ? ' ' + results.filter((item) => !item.ok).map((item) => item.message).join(' · ') : ''}`;
    toast(elements.supervisorBatchResult.textContent, failed ? 'error' : 'success', 6000);
  } catch (error) { if (!isCurrent()) return; toast(friendlyError(error), 'error'); }
  finally { if (isCurrent()) { supervisorMutationRunning = false; setBusy(elements.requestAllPhotoSyncButton, false); renderSupervisorList(); } }
}

function validateDecisionSubmission(event) {
  if (elements.decisionReason.value.trim()) return;
  event.preventDefault();
  elements.decisionError.textContent = 'Informe a observação obrigatória antes de confirmar.';
  elements.decisionReason.focus();
}

function collectDecision(decision) {
  const isCorrection = decision === 'request_correction';
  elements.decisionDialogTitle.textContent = decision === 'reject' ? 'Reprovar ocorrência' : 'Solicitar correção'; elements.decisionReason.value = ''; elements.decisionNote.value = ''; elements.decisionError.textContent = ''; elements.decisionDialog.returnValue = '';
  elements.decisionReasonLabel.textContent = isCorrection ? 'Observação da correção *' : 'Motivo da reprovação *';
  elements.decisionReason.placeholder = isCorrection ? 'Descreva qualquer dado operacional que a equipe precisa corrigir.' : 'Informe o motivo da reprovação.';
  elements.decisionOccurrenceContext.hidden = !isCorrection;
  elements.decisionOccurrenceSummary.innerHTML = isCorrection && activeSupervisorRecord ? occurrenceDetails(activeSupervisorRecord) : '';
  elements.decisionNoteField.hidden = isCorrection;
  elements.decisionPhotoSelector.hidden = !isCorrection;
  if (isCorrection) {
    const types = normalizeOccurrenceTypes(activeSupervisorRecord?.occurrenceTypes);
    const indexes = [1, 2, 3, 4, 5].concat(types.includes(TYPE_TRAFO) ? [6, 7] : []);
    const detected = new Set(activeSupervisorPhotoIssues());
    elements.decisionPhotoChoices.innerHTML = indexes.map((index) => `<label class="choice-card"><input type="checkbox" value="${index}" ${detected.has(index) ? 'checked' : ''} /><span>${escapeHtml(photoIndexLabel(index))}</span></label>`).join('');
  } else elements.decisionPhotoChoices.innerHTML = '';
  elements.decisionDialog.showModal();
  return new Promise((resolve) => { const handler = () => {
    elements.decisionDialog.removeEventListener('close', handler);
    if (elements.decisionDialog.returnValue !== 'default' || !elements.decisionReason.value.trim()) return resolve(null);
    const photoIndexes = isCorrection ? $$('input:checked', elements.decisionPhotoChoices).map((input) => Number(input.value)) : [];
    resolve({ reason: elements.decisionReason.value.trim(), note: elements.decisionNote.value.trim(), photoIndexes });
  }; elements.decisionDialog.addEventListener('close', handler); });
}

async function approveSelected() {
  const requestSession = session; const revision = sessionRevision;
  const isCurrent = () => revision === sessionRevision && session?.token === requestSession?.token;
  updateSupervisorSelectionUi(); const ids = [...selectedSupervisorIds]; if (!ids.length) return;
  if (supervisorMutationRunning) return; supervisorMutationRunning = true;
  try {
    if (!await confirmAction('Aprovar selecionadas?', `${ids.length} ocorrência(s) apta(s) serão publicadas.`, 'Aprovar selecionadas', 'success')) return;
    if (!isCurrent()) return;
    await approveSupervisorRecords(ids, elements.approveSelectedButton);
  } catch (error) { if (!isCurrent()) return; toast(friendlyError(error), 'error'); }
  finally { if (isCurrent()) { setBusy(elements.approveSelectedButton, false); supervisorMutationRunning = false; updateSupervisorSelectionUi(); } }
}

async function approveAll() {
  const requestSession = session; const revision = sessionRevision;
  const isCurrent = () => revision === sessionRevision && session?.token === requestSession?.token;
  if (supervisorMutationRunning) return; supervisorMutationRunning = true;
  try {
    const ids = selectableSupervisorRecords().map((record) => record.recordId);
    if (!ids.length) return;
    if (!await confirmAction('Aprovar todas as exibidas?', `${ids.length} ocorrência(s) apta(s) e visível(is) serão publicadas.`, 'Sim, aprovar exibidas', 'success')) return;
    if (!isCurrent()) return;
    await approveSupervisorRecords(ids, elements.approveAllButton);
  } catch (error) { if (!isCurrent()) return; toast(friendlyError(error), 'error'); }
  finally { if (isCurrent()) { setBusy(elements.approveAllButton, false); supervisorMutationRunning = false; updateSupervisorSelectionUi(); } }
}

async function approveSupervisorRecords(ids, button) {
  const requestSession = session; const revision = sessionRevision;
  const isCurrent = () => revision === sessionRevision && session?.token === requestSession?.token;
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const labels = new Map(supervisorRecords.map((record) => [record.recordId, record.occurrenceNumber || record.recordId]));
  const successes = [];
  const failures = [];
  elements.supervisorBatchResult.hidden = false;
  for (let index = 0; index < uniqueIds.length; index += 1) {
    const recordId = uniqueIds[index];
    const progress = `Aprovando ${index + 1}/${uniqueIds.length}…`;
    setBusy(button, true, progress);
    elements.supervisorBatchResult.className = 'batch-result batch-result--progress';
    elements.supervisorBatchResult.textContent = progress;
    try {
      await api.supervisorAction(requestSession.token, 'approve', recordId);
      if (!isCurrent()) return { successes, failures, interrupted: true };
      successes.push(recordId);
      selectedSupervisorIds.delete(recordId);
    } catch (error) {
      if (!isCurrent()) return { successes, failures, interrupted: true };
      failures.push({ recordId, label: labels.get(recordId) || recordId, code: error?.code || 'SERVER_ERROR', message: friendlyError(error) });
    }
  }
  const summary = `${successes.length} sucesso(s) · ${failures.length} falha(s)`;
  elements.supervisorBatchResult.className = `batch-result ${failures.length ? 'batch-result--warning' : 'batch-result--success'}`;
  elements.supervisorBatchResult.innerHTML = `<strong>${escapeHtml(summary)}</strong>${failures.length ? `<ul>${failures.map((failure) => `<li><b>${escapeHtml(failure.label)}</b>: ${escapeHtml(failure.message)} <small>(${escapeHtml(failure.code)})</small></li>`).join('')}</ul>` : ''}`;
  toast(summary, failures.length ? 'error' : 'success', 5200);
  await refreshSupervisor(false);
  if (!isCurrent()) return { successes, failures, interrupted: true };
  return { successes, failures };
}

function confirmAction(title, message, actionLabel = 'Confirmar', tone = 'default') {
  if (confirmDialogPromise || elements.confirmDialog.open) return Promise.resolve(false);
  elements.confirmTitle.textContent = title; elements.confirmMessage.textContent = message; elements.confirmActionButton.textContent = actionLabel;
  elements.confirmActionButton.className = `button ${tone === 'danger' ? 'button--danger' : tone === 'success' ? 'button--success' : tone === 'warning' ? 'button--warning' : 'button--primary'}`;
  elements.confirmIcon.textContent = tone === 'danger' ? '!' : tone === 'success' ? '✓' : '?'; elements.confirmDialog.returnValue = ''; elements.confirmDialog.showModal();
  let task;
  task = new Promise((resolve) => { const handler = () => { elements.confirmDialog.removeEventListener('close', handler); if (confirmDialogPromise === task) confirmDialogPromise = null; resolve(elements.confirmDialog.returnValue === 'confirm'); }; elements.confirmDialog.addEventListener('close', handler); });
  confirmDialogPromise = task;
  return task;
}

function photoFallbackUrl(value) { const id = driveFileId(value); return id ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}` : ''; }
function handlePhotoLoadError(event) {
  const image = event.target.closest?.('img[data-fallback-src]'); if (!image) return;
  const fallback = image.dataset.fallbackSrc;
  if (!image.dataset.fallbackAttempted && fallback && image.src !== fallback) { image.dataset.fallbackAttempted = '1'; image.src = fallback; return; }
  image.removeAttribute('src'); image.alt = `${image.alt || 'Foto'} indisponível`; image.classList.add('is-photo-unavailable');
  if (!image.closest('#reviewDialog, #supervisorList')) return;
  const holder = image.closest('[data-photo-index]'); const recordId = image.closest('[data-record-photo-id]')?.dataset.recordPhotoId || '';
  const photoIndex = Number(holder?.dataset.photoIndex);
  if (recordId && photoIndex) { const failures = supervisorPhotoFailures.get(recordId) || new Set(); failures.add(photoIndex); supervisorPhotoFailures.set(recordId, failures); updateSupervisorSelectionUi(); if (activeSupervisorRecord?.recordId === recordId) updateSupervisorReviewActions(); }
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

function isTechnicalErrorMessage(value) {
  const message = String(value || '').trim();
  return /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError)\b|\.(?:map|filter|find|forEach)\s+is\s+not\s+a\s+function|\b(?:undefined|null)\b|Unexpected token|JSON\.parse|\n\s*at\s+/i.test(message);
}

function friendlyError(error) {
  if (error?.code === 'INVALID_CREDENTIALS') return 'Nome, perfil ou senha inválidos.';
  if (error?.code === 'AUTH_REQUIRED') return 'Sua sessão expirou. Entre novamente.';
  if (error?.code === 'NETWORK_ERROR') return navigator.onLine ? 'Não foi possível falar com o servidor.' : 'Sem internet. Os dados continuam guardados neste aparelho.';
  if (error?.code === 'TIMEOUT') return 'A conexão demorou demais. A fila foi preservada para nova tentativa.';
  if (error?.code === 'ENDPOINT_NOT_CONFIGURED') return 'A publicação do backend ainda está sendo concluída.';
  if (error instanceof ApiError) {
    if (isTechnicalErrorMessage(error.message)) { console.error('[Aplicativo] Resposta técnica ocultada do usuário.', error); return 'Ocorreu um erro inesperado.'; }
    return error.message || 'Ocorreu um erro inesperado.';
  }
  console.error('[Aplicativo] Erro inesperado.', error);
  return 'Ocorreu um erro inesperado.';
}

initialize().catch((error) => { elements.loginMessage.textContent = friendlyError(error); toast(friendlyError(error), 'error'); });
