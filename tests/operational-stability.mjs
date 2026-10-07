import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const appSource = await read('app.js');
const dbSource = await read('db.js');
const core = await import(`data:text/javascript;base64,${Buffer.from(await read('core.js')).toString('base64')}`);
const tests = [];
const test = (name, run) => tests.push({ name, run });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function submissionHarness({ delayedSave = false } = {}) {
  const save = deferred();
  const sync = deferred();
  const events = [];
  const context = {
    activeRecord: { recordId: 'registro-a', base: 'ASSÚ', correctionMode: false, status: 'RASCUNHO' },
    currentView: 'new', occurrenceSubmissionRunning: false, activeDraftSavePromise: null, photoSelectionRequests: new Map(), sessionRevision: 1,
    ACTIVE_DRAFT_META: 'activeDraftId',
    RECORD_STATUS: { PENDING: 'PENDENTE_ENVIO', WAITING_SUPERVISOR: 'AGUARDANDO_SUPERVISOR', ERROR: 'ERRO' },
    validateStepOne: () => true, countReadyPhotoStates: () => 3,
    confirmAction: async () => true, syncFormToRecord: () => {},
    putRecord: async () => { events.push('save'); if (delayedSave) await save.promise; },
    clearMetaIfValue: async (_, id) => { events.push(`clear:${id}`); },
    syncSingleRecord: (id) => { events.push(`sync:${id}`); return sync.promise; },
    resetForm: () => { events.push('reset'); context.activeRecord = null; },
    navigate: (view) => { events.push(`navigate:${view}`); },
    toast: (message) => { events.push(`toast:${message}`); },
    setBusy: () => {}, elements: { submitOccurrenceButton: {} }, console
  };
  const source = appSource.match(/async function submitOccurrence\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'função de envio encontrada');
  const submit = vm.runInNewContext(`${source}\nsubmitOccurrence`, context);
  return { context, events, save, sync, submit };
}

test('submissão libera o formulário antes da resposta remota e mantém o UUID na fila', async () => {
  const harness = submissionHarness();
  await harness.submit();
  assert.ok(harness.events.includes('sync:registro-a'));
  assert.ok(harness.events.includes('clear:registro-a'));
  assert.ok(harness.events.includes('reset'));
  assert.ok(harness.events.includes('navigate:mine'));
  harness.sync.resolve({ status: 'AGUARDANDO_SUPERVISOR' });
});

test('resposta tardia não limpa a Sub-base de outro registro aberto', async () => {
  const harness = submissionHarness({ delayedSave: true });
  const pending = harness.submit();
  for (let index = 0; index < 8 && !harness.events.includes('save'); index += 1) await Promise.resolve();
  assert.ok(harness.events.includes('save'));
  harness.context.activeRecord = { recordId: 'registro-b', base: 'MOSSORÓ' };
  harness.save.resolve();
  await pending;
  assert.equal(harness.context.activeRecord.base, 'MOSSORÓ');
  assert.ok(harness.events.includes('sync:registro-a'));
  assert.equal(harness.events.includes('reset'), false);
  assert.equal(harness.events.includes('navigate:mine'), false);
  harness.sync.resolve({ status: 'AGUARDANDO_SUPERVISOR' });
});

test('restauração protege a ocorrência ativa e não espera meta diária para exibir o formulário', () => {
  const source = appSource.match(/async function loadRecordIntoForm\(record\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  assert.ok(source.indexOf('elements.operationBase.value = loadingRecord.base') < source.indexOf('await getPhotosForRecord'));
  assert.match(source, /if \(activeRecord !== loadingRecord\) return;/);
  assert.ok(source.indexOf("navigate('new')") < source.indexOf('void loadDailyProduction'));
  assert.doesNotMatch(source, /await loadDailyProduction/);
});

test('troca de Sub-base invalida resultados de busca anterior', () => {
  const source = appSource.match(/async function handleFormInput\(event\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  assert.match(source, /catalogSearchRequestId \+= 1;/);
  assert.match(source, /catalogResults = \[\];/);
  assert.match(source, /void runLocalAction\(handleCatalogInput\)/);
  assert.equal(core.contractForBase('ASSÚ'), '4600080939');
  assert.equal(core.contractForBase('MOSSORÓ'), '4600080939');
  assert.equal(core.contractForBase('CAICÓ'), '4600080938');
  assert.equal(core.contractForBase('PAU DOS FERROS'), '4600080938');
});

test('armazenamento bloqueado termina e pode tentar abrir novamente sem apagar dados', () => {
  assert.match(dbSource, /setTimeout\(\(\) => \{[\s\S]*?connectionPromise = null;[\s\S]*?\}, 12000\)/);
  assert.match(dbSource, /if \(invalidated\) \{\s*request\.result\.close\(\)/);
  assert.match(dbSource, /clearMetaIfValue\(key, expectedValue\)/);
  assert.match(dbSource, /request\.result\?\.value === expectedValue/);
});

test('Supervisor coalesce refresh e termina em erro recuperável', () => {
  assert.match(appSource, /supervisorRefreshPromise && supervisorRefreshRevision === revision/);
  assert.match(appSource, /supervisorLoading = false;[\s\S]*?renderSupervisorList\(supervisorLoadError\)/);
  assert.match(appSource, /data-supervisor-retry/);
  assert.match(appSource, /números da última carga/);
  assert.match(appSource, /!Array\.isArray\(result\?\.records\) \|\| !Array\.isArray\(result\?\.pendingRecords\)/);
  assert.match(appSource, /supervisorDataLoaded \? metrics\.pending : unavailable/);
});

test('login e troca de perfil rejeitam submissões concorrentes', () => {
  assert.match(appSource, /async function handleLogin\(event\) \{\s*event\.preventDefault\(\);\s*if \(loginRunning\) return;/);
  assert.match(appSource, /finally \{ loginRunning = false; setBusy\(elements\.loginButton, false\); \}/);
  assert.match(appSource, /async function handleProfileSwitch\(event\) \{\s*event\.preventDefault\(\);\s*if \(profileSwitchRunning\) return;/);
  assert.doesNotMatch(appSource.match(/async function handleLogin\(event\) \{[\s\S]*?\n\}/)?.[0], /await ensureLocalStorage/);
});

test('login termina loading após falha e aceita nova tentativa sem duplicar chamada', async () => {
  const source = appSource.match(/async function handleLogin\(event\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const first = deferred();
  const busy = [];
  let calls = 0;
  let entered = 0;
  const fields = { user: 'Teste', password: 'simulado', role: 'supervisor' };
  const context = {
    loginRunning: false,
    FormData: class { get(key) { return fields[key]; } },
    elements: { loginForm: {}, loginMessage: { textContent: '' }, loginButton: {}, loginPassword: { value: 'simulado' } },
    navigator: { onLine: true },
    setBusy: (_, value) => busy.push(value), ensureLocalStorage: async () => {},
    api: { login: async () => { calls += 1; if (calls === 1) return first.promise; return { token: 'token', user: 'Teste', role: 'supervisor' }; } },
    clearSessionUiState: () => {}, persistSession: () => {}, tokenExpiry: () => 1,
    localStorage: { setItem: () => {} }, LAST_USER_KEY: 'lastUser',
    enterApplication: async () => { entered += 1; }, friendlyError: (error) => error.message
  };
  const login = vm.runInNewContext(`${source}\nhandleLogin`, context);
  const event = { preventDefault: () => {} };
  const pending = login(event);
  await login(event);
  assert.equal(calls, 1);
  first.resolve(Promise.reject(new Error('Falha de rede temporária')));
  await pending;
  assert.equal(context.loginRunning, false);
  assert.equal(context.elements.loginMessage.textContent, 'Falha de rede temporária');
  assert.equal(busy.at(-1), false);
  await login(event);
  assert.equal(calls, 2);
  assert.equal(entered, 1);
  assert.equal(busy.at(-1), false);
});

test('falha transitória mantém UUID na fila e o retry chega à confirmação', async () => {
  const source = appSource.match(/async function performSyncSingleRecord\(recordId, notify = true\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const statuses = [];
  const recordId = 'registro-offline-1';
  let stored = { recordId, user: 'Teste', status: 'PENDENTE_ENVIO', services: [], materials: [], occurrenceTypes: ['PODA'], photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: index < 3 })), attempts: 0 };
  let submissions = 0;
  const serverState = { status: 'AGUARDANDO_SUPERVISOR', photoStates: stored.photoStates };
  class ApiError extends Error { constructor(message, code) { super(message); this.code = code; } }
  const context = {
    session: { user: 'Teste', token: 'token', role: 'field' }, sessionRevision: 0,
    getRecord: async () => structuredClone(stored),
    putRecord: async (record) => { stored = structuredClone(record); statuses.push(stored.status); },
    normalizeOccurrenceRecord: (record) => record, navigator: { onLine: true },
    sameUser: core.sameUser,
    normalizePhotoStates: core.normalizePhotoStates,
    RECORD_STATUS: { PENDING: 'PENDENTE_ENVIO', SYNCING_DATA: 'SINCRONIZANDO_DADOS', SYNCING_PHOTOS: 'FOTOS_SENDO_SINCRONIZADAS', ERROR: 'ERRO', WAITING_SUPERVISOR: 'AGUARDANDO_SUPERVISOR' },
    dailyProduction: { totalExcludingRecord: 0 }, dailyGoalProjection: () => ({ percentage: 0 }),
    serializeServicesForBackend: () => [], serializeMaterialsForBackend: () => [], occurrenceTotal: () => 0,
    APP_VERSION: 'teste', TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO', normalizeOccurrenceTypes: (types) => types,
    reconcilePhotoStates: (record, response) => ({ ...record, ...response, serverStatus: response.status, photoStates: response.photoStates || record.photoStates, serverConfirmed: true }),
    requiredPhotoDeficit: () => 0, getPhoto: async () => null, deletePhoto: async () => {},
    blobToDataUrl: async () => '', cacheDailySummary: async () => {}, setMeta: async () => {}, LAST_SYNC_META: 'lastSyncAt',
    updateQueueUi: async () => {}, currentView: 'sync', mineRecords: [], refreshMine: () => {},
    friendlyError: (error) => error.message, statusLabel: (status) => status, toast: () => {}, console, ApiError,
    api: {
      getRecordState: async () => serverState,
      submitRecord: async () => { submissions += 1; if (submissions === 1) throw new ApiError('Falha de rede transitória', 'NETWORK_ERROR'); return { status: 'FOTOS_SENDO_SINCRONIZADAS', photoStates: stored.photoStates }; },
      uploadPhoto: async () => serverState
    }
  };
  const sync = vm.runInNewContext(`${source}\nperformSyncSingleRecord`, context);
  await sync(recordId, false);
  assert.equal(stored.status, 'ERRO');
  assert.equal(stored.recordId, recordId);
  assert.equal(stored.lastError, 'Falha de rede transitória');
  await sync(recordId, false);
  assert.equal(stored.status, 'AGUARDANDO_SUPERVISOR');
  assert.equal(stored.recordId, recordId);
  assert.ok(statuses.includes('SINCRONIZANDO_DADOS'));
  assert.ok(statuses.includes('ERRO'));
  assert.equal(statuses.at(-1), 'AGUARDANDO_SUPERVISOR');
  assert.equal(submissions, 1, 'retry reconhece a confirmação remota sem reenviar os dados');
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try { await item.run(); passed += 1; }
  catch (error) { failures.push({ test: item.name, error: `${error.name}: ${error.message}` }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
