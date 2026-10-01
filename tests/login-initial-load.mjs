import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

if (!process.argv[2] || !process.argv[3]) throw Error('Informe os fontes oficial corrigido e anterior do backend.');
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const [appSource, apiSource, coreSource, backend, baseline] = await Promise.all([
  read('app.js'), read('api.js'), read('core.js'), readFile(process.argv[2], 'utf8'), readFile(process.argv[3], 'utf8')
]);
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const core = await import(dataUrl(coreSource));
const apiModule = await import(dataUrl(apiSource.replace(/^import .*?;\n/, "const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec'; const MATERIAL_CATALOG_SOURCE={};\n")));
const { ApiError } = apiModule;
const baselineApp = process.argv[4] ? await readFile(process.argv[4], 'utf8') : null;
const tests = [];
const test = (name, run) => tests.push({ name, run });
const plain = value => JSON.parse(JSON.stringify(value));
const extract = (source, name) => {
  const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(match, name); return match[0];
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const retryWaits = [];
const loadOccurrenceDataset = vm.runInNewContext(extract(apiSource, 'loadOccurrenceDataset') + '\nloadOccurrenceDataset', {
  ApiError, setTimeout: (done, delay) => { retryWaits.push(delay); queueMicrotask(done); }
});
const emptyPayload = () => ({ records: [], pendingRecords: [], metricRecords: [] });
const fixture = options => ({ recordId: '11111111-1111-4111-8111-111111111111', user: 'Campo TESTE',
  occurrenceNumber: '00001', registeredAt: '2026-10-01T09:00:00-03:00', base: 'CAICÓ', team: 'LM TESTE',
  crewLeader: 'Chefe TESTE', occurrenceTypes: ['PODA'], services: [], materials: [], status: core.RECORD_STATUS.WAITING_SUPERVISOR, ...options });
const element = () => ({ hidden: false, innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, attributes: {},
  classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; } });

function appHarness(role = 'supervisor', source = appSource) {
  const elements = new Proxy({}, { get: (target, key) => target[key] ||= element() });
  const events = []; const intervals = [];
  const c = {
    ...core, ApiError, loadOccurrenceDataset, elements, session: { token: 'fixture', role, user: 'Campo TESTE' }, sessionRevision: 1,
    loginRunning: false, currentView: 'login', mineRecords: [], mineServerDataLoaded: false, mineLoading: false, mineLoadError: null,
    mineRefreshPromise: null, mineRefreshRevision: -1, mineFilter: 'all', mineAutoFilterPending: false,
    supervisorRefreshPromise: null, supervisorRefreshRevision: -1, supervisorLoading: false, supervisorLoadError: null,
    supervisorDataLoaded: false, supervisorRecords: [], supervisorPendingRecords: [], supervisorMetricRecords: [],
    supervisorPhotoFailures: new Map(), selectedSupervisorIds: new Set(), supervisorTab: 'occurrences', supervisorPendingFilter: 'photos',
    supervisorMutationRunning: false, supervisorRefreshTimer: null, LAST_USER_KEY: 'fixture-last-user',
    SYNCABLE_STATUSES: new Set([core.RECORD_STATUS.PENDING, core.RECORD_STATUS.ERROR]),
    navigator: { onLine: true }, document: { visibilityState: 'visible' }, window: { scrollTo() {} },
    localStorage: { getItem() { return null; }, setItem() {} }, console: { error() {}, warn() {} },
    FormData: class { get(key) { return { user: 'Campo TESTE', password: 'fixture-only', role }[key]; } },
    setTimeout: () => {}, setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {},
    $$: () => [], endpointConfigured: () => true,
    api: { login: async () => ({ token: 'fixture', user: 'Campo TESTE', role }), listPending: async () => emptyPayload(), listMine: async () => ({ records: [] }) },
    openDatabase: async () => {}, getAllRecords: async () => [],
    clearSessionUiState() {}, persistSession(value) { c.session = value; c.sessionRevision++; }, tokenExpiry: () => Date.now() + 100000,
    setBusy(button, busy) { button.disabled = busy; }, toast: message => events.push(message), friendlyError: error => error.message,
    loadTeamDirectory: () => { events.push('directory'); return new Promise(() => {}); },
    updateQueueUi: () => { events.push('queue'); return new Promise(() => {}); }, detectDraft: () => new Promise(() => {}),
    updateGoal() {}, syncAll: () => new Promise(() => {}), loadDailyProduction: () => new Promise(() => {}),
    showReleaseNoticeOnce() {}, saveSupervisorFilters() {}, restoreSupervisorFilters() {}, renderMineFilters() {},
    setupMineTeams() {}, renderPhotoSyncRequests() {}, refreshMineGoal: async () => {},
    populateSupervisorFilters() {}, renderSupervisorNavigation() {}, updateSupervisorSelectionUi() {},
    filteredSupervisorRecords: () => c.supervisorRecords, supervisorActiveRecords: () => c.supervisorRecords,
    supervisorFilterRange: () => ({ from: '', to: '' }), supervisorActiveCountLabel: count => String(count),
    setSupervisorSummary: text => { elements.supervisorFilterSummary.textContent = text; },
    photoUrlsForRecord: () => [], supervisorPricingIssues: () => [], occurrenceTypesText: () => 'PODA',
    recordCard: record => `<article>${record.recordId}</article>`,
    logout: () => { c.session = null; c.sessionRevision++; events.push('logout'); },
    bindEvents() {}, renderPhotoGrid() {}, renderMaterials() {}, renderServices() {}, updateNetworkUi() {}, setupServiceWorker() {}
  };
  const names = ['emptyState', 'ensureLocalStorage', 'showLogin', 'initialize', 'handleLogin', 'enterApplication', 'navigate', 'assertServerRecordList', 'refreshMine', 'renderMineList', 'refreshSupervisor', 'renderSupervisorList'];
  vm.createContext(c); vm.runInContext(names.filter(name => source.includes('function ' + name + '(')).map(name => extract(source, name)).join('\n'), c);
  return { c, elements, events, intervals };
}

test('autenticação abre o Supervisor antes do IndexedDB e das referências secundárias', async () => {
  const h = appHarness(); const database = deferred(); const dataset = deferred(); let calls = 0;
  h.c.openDatabase = () => database.promise;
  h.c.api.listPending = () => { calls++; return dataset.promise; };
  await h.c.handleLogin({ preventDefault() {} });
  assert.equal(h.elements.appShell.hidden, false); assert.equal(h.c.currentView, 'supervisor');
  assert.equal(h.c.loginRunning, false); assert.equal(calls, 1);
  assert.match(h.elements.supervisorList.innerHTML, /Carregando ocorrências/);
  assert.deepEqual(h.events, ['directory', 'queue']);
  dataset.resolve(emptyPayload()); await h.c.supervisorRefreshPromise;
});
test('inicialização sem sessão exibe login sem esperar banco e resumo da fila', async () => {
  const h = appHarness(); h.c.session = null; h.c.openDatabase = () => new Promise(() => {});
  await h.c.initialize(); assert.equal(h.elements.loginView.hidden, false); assert.equal(h.elements.appShell.hidden, true);
});
test('falha recuperável do IndexedDB preserva sessão e deixa autenticação utilizável', async () => {
  const h = appHarness(); h.c.session = null; h.c.openDatabase = async () => { throw Error('blocked'); };
  await h.c.initialize(); await tick(); assert.ok(h.events.some(message => /Armazenamento local/.test(message)));
  await h.c.handleLogin({ preventDefault() {} }); assert.equal(h.c.session.role, 'supervisor'); assert.equal(h.elements.appShell.hidden, false);
  await h.c.supervisorRefreshPromise;
});
test('duplo clique no login usa uma autenticação e encerra o loading', async () => {
  const h = appHarness(); const auth = deferred(); let calls = 0;
  h.c.api.login = () => { calls++; return auth.promise; };
  const first = h.c.handleLogin({ preventDefault() {} }); await h.c.handleLogin({ preventDefault() {} });
  assert.equal(calls, 1); auth.resolve({ token: 'fixture', user: 'Campo TESTE', role: 'supervisor' }); await first;
  assert.equal(h.c.loginRunning, false); assert.equal(h.elements.loginButton.disabled, false); await h.c.supervisorRefreshPromise;
});
test('Campo abre interface própria sem consultar o dataset do Supervisor', async () => {
  const h = appHarness('field'); let supervisorCalls = 0, mineCalls = 0;
  h.c.api.listPending = async () => { supervisorCalls++; return emptyPayload(); };
  h.c.api.listMine = async () => { mineCalls++; return { records: [] }; };
  await h.c.handleLogin({ preventDefault() {} }); await h.c.mineRefreshPromise;
  assert.equal(h.c.currentView, 'new'); assert.equal(supervisorCalls, 0); assert.equal(mineCalls, 1); assert.equal(h.elements.appShell.hidden, false);
});
for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'HTTP_SERVER_ERROR', 'SERVICE_UNAVAILABLE']) {
  test(`primeira carga recupera ${code} com exatamente uma nova tentativa`, async () => {
    const h = appHarness(); let calls = 0;
    h.c.api.listPending = async () => { calls++; if (calls === 1) throw new ApiError('transitório', code); return emptyPayload(); };
    await h.c.refreshSupervisor(); assert.equal(calls, 2); assert.equal(h.c.supervisorDataLoaded, true); assert.equal(h.c.supervisorLoading, false);
    assert.equal(h.elements.refreshSupervisorButton.disabled, false);
  });
}
test('duas falhas encerram loading, exibem erro e Tentar novamente sem loop', async () => {
  const h = appHarness(); let calls = 0;
  h.c.api.listPending = async () => { calls++; throw new ApiError('Sem resposta', 'TIMEOUT'); };
  await h.c.enterApplication(); await h.c.supervisorRefreshPromise;
  for (const timer of h.intervals) timer(); await tick();
  assert.equal(calls, 2); assert.equal(h.c.supervisorLoading, false);
  assert.match(h.elements.supervisorList.innerHTML, /Sem resposta/); assert.match(h.elements.supervisorList.innerHTML, /data-supervisor-retry/);
  assert.doesNotMatch(h.elements.supervisorList.innerHTML, /Nenhuma ocorrência/);
});
for (const code of ['INVALID_CREDENTIALS', 'AUTH_REQUIRED', 'FORBIDDEN', 'INVALID_SUPERVISOR_PAYLOAD', 'INVALID_SERVER_RESPONSE', 'INVALID_SERVICE_SNAPSHOT']) {
  test(`${code} não recebe retry automático`, async () => {
    let calls = 0;
    await assert.rejects(loadOccurrenceDataset(async () => { calls++; throw new ApiError(code, code, { status: 503 }); }, x => x, { initial: true }), error => error.code === code);
    assert.equal(calls, 1);
  });
}
test('resposta válida sem ocorrências termina em vazio válido', async () => {
  const h = appHarness(); await h.c.refreshSupervisor(); assert.equal(h.c.supervisorDataLoaded, true);
  assert.match(h.elements.supervisorList.innerHTML, /Nenhuma ocorrência aguardando conferência/);
  assert.doesNotMatch(h.elements.supervisorList.innerHTML, /data-supervisor-retry/);
});
for (const payload of [{ records: [] }, { records: [], pendingRecords: [] }, { records: [], pendingRecords: null }, { records: {}, pendingRecords: [] }, { records: [], pendingRecords: [], metricRecords: {} }, { records: [null], pendingRecords: [], metricRecords: [] }, { records: [{}], pendingRecords: [], metricRecords: [] }]) {
  test(`payload inválido ${JSON.stringify(payload)} não vira lista vazia e não é retentado`, async () => {
    const h = appHarness(); let calls = 0; h.c.api.listPending = async () => { calls++; return payload; };
    await h.c.refreshSupervisor(); assert.equal(calls, 1); assert.equal(h.c.supervisorDataLoaded, false);
    assert.match(h.elements.supervisorList.innerHTML, /data-supervisor-retry/); assert.doesNotMatch(h.elements.supervisorList.innerHTML, /Nenhuma ocorrência/);
  });
}
test('mount, atualização e navegação simultâneos compartilham um request', async () => {
  const h = appHarness(); const dataset = deferred(); let calls = 0;
  h.c.api.listPending = () => { calls++; return dataset.promise; };
  await h.c.enterApplication(); const second = h.c.refreshSupervisor(true); const third = h.c.navigate('supervisor');
  assert.equal(calls, 1); dataset.resolve(emptyPayload()); await Promise.all([second, third]);
  assert.equal(calls, 1); assert.equal(h.c.supervisorRefreshPromise, null);
});
test('resposta de sessão anterior não sobrescreve a sessão nova', async () => {
  const h = appHarness(); const old = deferred(); h.c.api.listPending = () => old.promise;
  const request = h.c.refreshSupervisor(); h.c.sessionRevision++; h.c.api.listPending = async () => emptyPayload();
  await h.c.refreshSupervisor(); old.resolve({ records: [fixture()], pendingRecords: [], metricRecords: [] }); await request;
  assert.deepEqual(plain(h.c.supervisorRecords), []);
});
test('troca de sessão durante retry impede segunda chamada da sessão antiga', async () => {
  let current = true, calls = 0;
  const helper = vm.runInNewContext(extract(apiSource, 'loadOccurrenceDataset') + '\nloadOccurrenceDataset', {
    ApiError, setTimeout: done => { current = false; queueMicrotask(done); }
  });
  assert.equal(await helper(async () => { calls++; throw new ApiError('rede', 'NETWORK_ERROR'); }, x => x, { initial: true, isCurrent: () => current }), null);
  assert.equal(calls, 1);
});
test('refresh posterior ao sucesso não cria retry de carga inicial', async () => {
  const h = appHarness(); await h.c.refreshSupervisor(); let calls = 0;
  h.c.api.listPending = async () => { calls++; throw new ApiError('rede', 'NETWORK_ERROR'); };
  await h.c.refreshSupervisor(); assert.equal(calls, 1); assert.equal(h.c.supervisorDataLoaded, true);
});
test('Campo inicia consulta remota com leitura local ainda pendente e renderiza resposta', async () => {
  const h = appHarness('field'); const local = deferred(); let calls = 0;
  h.c.getAllRecords = () => local.promise; h.c.api.listMine = async () => { calls++; return { records: [fixture()] }; };
  const request = h.c.refreshMine(); await tick(); assert.equal(calls, 1); assert.match(h.elements.mineList.innerHTML, /11111111/);
  local.resolve([]); await request; assert.equal(h.c.mineLoading, false);
});
test('Campo continua com dados remotos quando o banco local falha', async () => {
  const h = appHarness('field'); h.c.getAllRecords = async () => { throw Error('blocked'); };
  h.c.api.listMine = async () => ({ records: [fixture()] }); await h.c.refreshMine();
  assert.equal(h.c.mineLoadError, null); assert.equal(h.c.mineRecords.length, 1); assert.equal(h.c.mineLoading, false);
});
test('Campo preserva fila local, fotos e merge por UUID durante atualização', async () => {
  const h = appHarness('field'); const local = fixture({ status: core.RECORD_STATUS.PENDING, photoStates: [{ photoIndex: 1, localReady: true, uploadKey: 'local-photo' }] });
  h.c.getAllRecords = async () => [local]; h.c.api.listMine = async () => ({ records: [fixture()] }); await h.c.refreshMine();
  assert.equal(h.c.mineRecords.length, 1); assert.equal(h.c.mineRecords[0].photoStates[0].localReady, true);
  assert.equal(h.c.mineRecords[0].photoStates[0].uploadKey, 'local-photo');
});
test('Campo faz um retry e distingue payload inválido de vazio válido', async () => {
  const h = appHarness('field'); let calls = 0;
  h.c.api.listMine = async () => { calls++; if (calls === 1) throw new ApiError('rede', 'NETWORK_ERROR'); return { records: [] }; };
  await h.c.refreshMine(); assert.equal(calls, 2); assert.match(h.elements.mineList.innerHTML, /Nenhuma ocorrência/);
  h.c.mineServerDataLoaded = false; calls = 0; h.c.api.listMine = async () => { calls++; return {}; };
  await h.c.refreshMine(); assert.equal(calls, 1); assert.match(h.elements.mineList.innerHTML, /data-mine-retry/);
  assert.doesNotMatch(h.elements.mineList.innerHTML, /Nenhuma ocorrência/);
});
test('Campo coalesce consultas simultâneas e meta diária não retém request principal', async () => {
  const h = appHarness('field'); const remote = deferred(); let calls = 0;
  h.c.api.listMine = () => { calls++; return remote.promise; }; h.c.refreshMineGoal = () => new Promise(() => {});
  const first = h.c.refreshMine(), second = h.c.refreshMine(); remote.resolve({ records: [] }); await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(h.c.mineRefreshPromise, null); assert.equal(h.elements.refreshMineButton.disabled, false);
});
test('Campo encerra duas falhas e conserva registros locais com aviso recuperável', async () => {
  const h = appHarness('field'); let calls = 0;
  h.c.getAllRecords = async () => [fixture({ status: core.RECORD_STATUS.PENDING })];
  h.c.api.listMine = async () => { calls++; throw new ApiError('Falha transitória', 'NETWORK_ERROR'); };
  await h.c.refreshMine(); assert.equal(calls, 2); assert.equal(h.c.mineLoading, false); assert.equal(h.c.mineRecords.length, 1);
  assert.match(h.elements.mineList.innerHTML, /data-mine-retry/); assert.match(h.elements.mineList.innerHTML, /11111111/);
});
test('Campo mantém modo offline e não consulta servidor', async () => {
  const h = appHarness('field'); h.c.navigator.onLine = false; let calls = 0;
  h.c.getAllRecords = async () => [fixture({ status: core.RECORD_STATUS.PENDING })];
  h.c.api.listMine = async () => { calls++; return { records: [] }; };
  await h.c.refreshMine(); assert.equal(calls, 0); assert.equal(h.c.mineRecords.length, 1); assert.equal(h.c.mineLoadError, null);
});
test('Campo não aceita resposta tardia de outro usuário', async () => {
  const h = appHarness('field'); const old = deferred(); h.c.api.listMine = () => old.promise;
  const request = h.c.refreshMine(); h.c.sessionRevision++; h.c.session = { token: 'new', user: 'Outro', role: 'field' };
  h.c.api.listMine = async () => ({ records: [] }); await h.c.refreshMine(); old.resolve({ records: [fixture()] }); await request;
  assert.deepEqual(plain(h.c.mineRecords), []);
});
test('payload inválido após um retry encerra carga sem terceira chamada', async () => {
  const h = appHarness(); let calls = 0;
  h.c.api.listPending = async () => { calls++; if (calls === 1) throw new ApiError('timeout', 'TIMEOUT'); return { records: [], pendingRecords: [], metricRecords: [null] }; };
  await h.c.refreshSupervisor(); assert.equal(calls, 2); assert.equal(h.c.supervisorLoading, false); assert.match(h.elements.supervisorList.innerHTML, /data-supervisor-retry/);
});
if (baselineApp) {
  test('fonte anterior reproduz bloqueio do login no banco, falha sem recuperação e falso vazio no Campo', async () => {
    const old = appHarness('supervisor', baselineApp); const database = deferred(); let authCalls = 0;
    old.c.openDatabase = () => database.promise; old.c.api.login = async () => { authCalls++; return { token: 'fixture', user: 'Campo TESTE', role: 'supervisor' }; };
    const login = old.c.handleLogin({ preventDefault() {} }); await tick(); assert.equal(authCalls, 0); assert.equal(old.c.loginRunning, true);
    database.resolve(); await login; await old.c.supervisorRefreshPromise; assert.equal(authCalls, 1);
    const firstLoad = appHarness('supervisor', baselineApp); let loadCalls = 0;
    firstLoad.c.api.listPending = async () => { loadCalls++; if (loadCalls === 1) throw new ApiError('transitório', 'NETWORK_ERROR'); return emptyPayload(); };
    await firstLoad.c.refreshSupervisor(); assert.equal(loadCalls, 1); assert.equal(firstLoad.c.supervisorDataLoaded, false);
    const field = appHarness('field', baselineApp); field.c.api.listMine = async () => ({}); await field.c.refreshMine();
    assert.match(field.elements.mineList.innerHTML, /Nenhuma ocorrência/);
  });
}
test('HTML HTTP 503 é transitório, JSON/HTML inválido com HTTP 200 é erro estrutural', async () => {
  await assert.rejects(apiModule.parseResponse({ ok: false, status: 503, text: async () => '<html>unavailable</html>' }), e => e.code === 'HTTP_SERVER_ERROR');
  await assert.rejects(apiModule.parseResponse({ ok: true, status: 200, text: async () => '<html>invalid</html>' }), e => e.code === 'INVALID_SERVER_RESPONSE');
  await assert.rejects(apiModule.parseResponse({ ok: false, status: 503, text: async () => JSON.stringify({ ok: false, error: 'AUTH_REQUIRED' }) }), e => e.code === 'AUTH_REQUIRED');
});
test('lista usa timeout finito de 60s, aborta transporte e mantém login em 35s', async () => {
  const timers = []; const context = {
    URL, AbortController, navigator: { onLine: true },
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; }, clearTimeout: timer => { timer.cleared = true; },
    fetch: (_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { const error = Error('abort'); error.name = 'AbortError'; reject(error); }))
  };
  vm.createContext(context); vm.runInContext(apiSource.replace(/^import .*?;\n/, "const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec'; const MATERIAL_CATALOG_SOURCE={};\n").replace(/^export /gm, '') + '\nthis.client=api;', context);
  const list = context.client.listPending('fixture'); assert.equal(timers.at(-1).ms, 60000); timers.at(-1).fn();
  await assert.rejects(list, e => e.code === 'TIMEOUT'); assert.equal(timers.at(-1).cleared, true);
  const login = context.client.login('fixture', 'fixture-only', 'field'); assert.equal(timers.at(-1).ms, 35000); timers.at(-1).fn();
  await assert.rejects(login, e => e.code === 'TIMEOUT');
});

class Sheet {
  constructor(name, headers) { this.name = name; this.rows = [Array.from(headers)]; this.dataReads = 0; this.headerReads = 0; this.writes = 0; }
  getMaxColumns() { return 60; } getLastRow() { return this.rows.length; }
  getRange(row, col, height, width) {
    const read = () => { if (row === 1) this.headerReads++; else this.dataReads++; return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => this.rows[row - 1 + i]?.[col - 1 + j] ?? '')); };
    return { getValues: read, getDisplayValues: () => read().map(r => r.map(String)), setValues: () => { this.writes++; } };
  }
}
function backendHarness(source) {
  const sheets = new Map(); let opens = 0;
  const c = vm.createContext({ console: { error() {}, warn() {} }, Date, JSON, Math, Number, String,
    SpreadsheetApp: { openById: () => { opens++; return { getSheetByName: name => sheets.get(name) || null }; } },
    Utilities: { formatDate: date => new Date(new Date(date).getTime() - 3 * 3600000).toISOString().slice(0, 10) }
  });
  vm.runInContext(source + '\nthis.meta={APP,COL,STATUS,MAIN_HEADERS,SERVICE_HEADERS,MATERIAL_HEADERS,HISTORY_HEADERS};', c);
  const m = c.meta;
  for (const [name, headers] of [[m.APP.pendingSheet, m.MAIN_HEADERS], [m.APP.officialSheet, m.MAIN_HEADERS], [m.APP.servicesSheet, m.SERVICE_HEADERS], [m.APP.materialsSheet, m.MATERIAL_HEADERS], [m.APP.historySheet, m.HISTORY_HEADERS]]) sheets.set(name, new Sheet(name, headers));
  c.requireSession_ = () => ({ role: 'supervisor', user: 'Campo TESTE' });
  const service = { code: 'S1', catalogKey: 'historical', catalogText: 'Serviço histórico', unit: 'UN', quantity: 0.75, referenceValue: 2, totalValue: 1.5, contract: '4600080938' };
  const material = { code: '000123', description: 'Material histórico', unit: 'UN', quantity: 0.5 };
  for (const [index, status] of [m.STATUS.WAITING_SUPERVISOR, m.STATUS.SYNCING_PHOTOS, m.STATUS.CORRECTION_REQUESTED, m.STATUS.PUBLISHED].entries()) {
    const row = Array(m.COL.WIDTH).fill('');
    const values = { ID: `${index + 1}1111111-1111-4111-8111-111111111111`, USER: 'Campo TESTE', REGISTERED_AT: '2026-10-01T09:00:00-03:00', UPDATED_AT: '2026-10-01T09:00:00-03:00', BASE: 'CAICÓ', CONTRACT: '4600080938', TEAM: 'LM TESTE', TOTAL: 1.5, STATUS: status, OCCURRENCE_NUMBER: '00001', TYPES: 'PODA', AUDIT: JSON.stringify({ pendingServices: [service], finalServices: [service], pendingMaterials: [material] }) };
    for (const [key, value] of Object.entries(values)) row[m.COL[key] - 1] = value;
    if (status === m.STATUS.WAITING_SUPERVISOR) for (let photo = 1; photo <= 3; photo++) row[m.COL.PHOTO_1 - 2 + photo] = `https://example.test/photo-${photo}.jpg`;
    sheets.get(status === m.STATUS.PUBLISHED ? m.APP.officialSheet : m.APP.pendingSheet).rows.push(row);
  }
  const materialRow = [sheets.get(m.APP.officialSheet).rows[1][m.COL.ID - 1], 'Material histórico', '0,5', '', '000123', 'Material histórico', 'UN'];
  sheets.get(m.APP.materialsSheet).rows.push(materialRow);
  sheets.get(m.APP.servicesSheet).rows.push([materialRow[0], 'S1', 'Serviço histórico', 'UN', 0.75, 2, 1.5, 'Grupo', 'historical']);
  return { c, sheets, opens: () => opens, counts: () => ({ opens, dataReads: [...sheets.values()].reduce((n, s) => n + s.dataReads, 0), headerReads: [...sheets.values()].reduce((n, s) => n + s.headerReads, 0), writes: [...sheets.values()].reduce((n, s) => n + s.writes, 0) }) };
}
const beforeAfter = {};
for (const action of ['listPending_', 'listMine_']) {
  test(`${action}: payload preservado, sete aberturas viram uma e seis leituras viram quatro`, () => {
    const old = backendHarness(baseline), fixed = backendHarness(backend);
    const oldPayload = old.c[action]({ token: 'fixture' }), fixedPayload = fixed.c[action]({ token: 'fixture' });
    assert.deepEqual(plain(fixedPayload), plain(oldPayload));
    assert.deepEqual(old.counts(), { opens: 7, dataReads: 6, headerReads: 5, writes: 0 });
    assert.deepEqual(fixed.counts(), { opens: 1, dataReads: 4, headerReads: 5, writes: 0 });
    beforeAfter[action] = { before: old.counts(), after: fixed.counts() };
  });
}
test('backend não mantém cache operacional entre execuções', () => {
  const h = backendHarness(backend); const first = h.c.listPending_({ token: 'fixture' });
  h.sheets.get(h.c.meta.APP.pendingSheet).rows.splice(1);
  const second = h.c.listPending_({ token: 'fixture' }); assert.equal(first.records.length, 1); assert.equal(second.records.length, 0); assert.equal(h.opens(), 2);
});
test('login do backend autentica sem abrir planilha e mantém erro de credencial', () => {
  const h = backendHarness(backend); h.c.credentialHash_ = () => 'fixture-hash'; h.c.sha256_ = password => password === 'fixture-only' ? 'fixture-hash' : 'invalid'; h.c.createToken_ = () => 'fixture-token';
  assert.equal(h.c.login_({ user: 'Teste', role: 'supervisor', password: 'fixture-only' }).role, 'supervisor'); assert.equal(h.opens(), 0);
  assert.throws(() => h.c.login_({ user: 'Teste', role: 'supervisor', password: 'invalid' }), e => e.code === 'INVALID_CREDENTIALS');
});
test('retry tem intervalo curto único e alterações não removem proteções do banco local', async () => {
  assert.ok(retryWaits.length); assert.ok(retryWaits.every(ms => ms === 600));
  const db = await read('db.js'); assert.match(db, /\}, 12000\)/); assert.match(db, /if \(invalidated\) \{\s*request\.result\.close\(\)/);
  assert.doesNotMatch(db, /deleteDatabase/);
});

let passed = 0; const failures = [];
for (const item of tests) { try { await item.run(); passed++; } catch (error) { failures.push({ test: item.name, error: `${error.name}: ${error.message}` }); } }
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, beforeAfter, failures }, null, 2));
if (failures.length) process.exitCode = 1;
