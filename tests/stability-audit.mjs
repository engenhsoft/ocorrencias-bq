import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = process.argv[3] || new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const read = name => readFile(root + '/' + name, 'utf8');
const [appSource, apiSource, dbSource, workerSource, coreSource, oldTests, publicationTests] = await Promise.all(
  ['app.js', 'api.js', 'db.js', 'service-worker.js', 'core.js', 'tests/audit-regression.mjs', 'tests/publication-reconciliation.mjs'].map(read));
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const tests = []; const test = (name, run) => tests.push({ name, run });
const plain = value => JSON.parse(JSON.stringify(value));
const extract = (source, name) => {
  const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(match, name); return match[0];
};
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function clock() {
  let id = 0; const pending = new Map();
  return { pending, setTimeout(fn, ms) { pending.set(++id, { fn, ms }); return id; }, clearTimeout(id) { pending.delete(id); },
    fire(ms) { for (const [id, timer] of [...pending]) if (timer.ms === ms) { pending.delete(id); timer.fn(); } } };
}
function apiHarness(fetch = () => new Promise(() => {}), reader = class {}) {
  const timers = clock(); const c = vm.createContext({ ...timers, fetch, AbortController, URL, navigator: { onLine: true }, FileReader: reader, console });
  vm.runInContext(apiSource.replace(/^import .*?;\n/, "const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec'; const MATERIAL_CATALOG_SOURCE={};\n").replace(/^export /gm, '') + '\nthis.client={api,apiRequest,healthCheck,blobToDataUrl,parseResponse,ApiError};', c);
  return { c, timers, ...c.client };
}
for (const action of ['login', 'listMine', 'submitRecord', 'uploadPhoto', 'supervisorAction', 'getRecordState']) test('deadline encerra ' + action + ' mesmo se fetch ignora abort', async () => {
  const h = apiHarness(); let error;
  h.apiRequest(action, {}, { timeoutMs: 60000 }).catch(value => { error = value; });
  h.timers.fire(60000); await settle(); assert.equal(error?.code, 'TIMEOUT'); assert.equal(h.timers.pending.size, 0);
});
test('deadline também encerra leitura de corpo parado depois de headers', async () => {
  const h = apiHarness(async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) })); let error;
  h.apiRequest('login', {}, { timeoutMs: 35000 }).catch(value => { error = value; }); await settle();
  h.timers.fire(35000); await settle(); assert.equal(error?.code, 'TIMEOUT');
});
test('health possui deadline independente do abort', async () => {
  const h = apiHarness(); let error; h.healthCheck().catch(value => { error = value; }); h.timers.fire(18000); await settle(); assert.equal(error?.code, 'TIMEOUT');
});
for (const payload of [{}, [], null, 'x']) test('resposta HTTP 200 incompleta não significa sucesso: ' + JSON.stringify(payload), async () => {
  const h = apiHarness(); await assert.rejects(h.parseResponse({ ok: true, status: 200, text: async () => JSON.stringify(payload) }), error => error.code === 'INVALID_SERVER_RESPONSE');
});
test('500 é transitório e erro de regra é preservado', async () => {
  const h = apiHarness(); await assert.rejects(h.parseResponse({ ok: false, status: 500, text: async () => '<html>erro</html>' }), e => e.code === 'HTTP_SERVER_ERROR');
  await assert.rejects(h.parseResponse({ ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: 'FORBIDDEN', message: 'Sem autorização' }) }), e => e.code === 'FORBIDDEN');
});
test('foto local com FileReader preso termina em erro sem apagar o blob', async () => {
  let aborted = 0;
  const h = apiHarness(undefined, class { readAsDataURL() {} abort() { aborted++; this.onabort?.(); } }); let error;
  h.blobToDataUrl(new Blob(['preservar'])).catch(value => { error = value; }); h.timers.fire(12000); await settle();
  assert.equal(error?.code, 'LOCAL_PHOTO_READ_TIMEOUT'); assert.equal(aborted, 1);
});
const syncState = (id = 'a', extra = {}) => ({ ok: true, recordId: id, record: { recordId: id }, status: core.RECORD_STATUS.WAITING_SUPERVISOR,
  photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: index < 3, url: index < 3 ? 'foto-' + index : '', uploadKey: 'k' + index })), ...extra });
for (const [name, change] of [
  ['sem identidade', value => { delete value.recordId; }], ['outro UUID', value => { value.recordId = 'outro'; }],
  ['sem record', value => { delete value.record; }], ['estado ausente', value => { delete value.status; }],
  ['lista incompleta', value => { value.photoStates.pop(); }], ['índice repetido', value => { value.photoStates[6].photoIndex = 1; }],
  ['confirmada sem URL', value => { value.photoStates[0].url = ''; }], ['booleano inválido', value => { value.photoStates[0].confirmed = 'true'; }]
]) test('resposta de sincronização inválida é rejeitada: ' + name, async () => {
  const value = syncState(); change(value); const h = apiHarness(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(value) }));
  await assert.rejects(h.api.getRecordState('ficticio', 'a'), e => e.code === 'INVALID_RECORD_STATE');
});
test('confirmação completa do mesmo UUID é aceita', async () => {
  const value = syncState(); const h = apiHarness(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(value) }));
  assert.equal((await h.api.getRecordState('ficticio', 'a')).recordId, 'a');
});
test('foto confirmada com outra uploadKey não autoriza limpeza local', async () => {
  const h = apiHarness(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(syncState()) }));
  await assert.rejects(h.api.uploadPhoto('ficticio', { recordId: 'a', photoIndex: 1, uploadKey: 'outra' }), e => e.code === 'PHOTO_CONFIRMATION_PENDING');
});
test('login não abre perfil com identidade incompleta', async () => {
  const h = apiHarness(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, token: 'ficticio' }) }));
  await assert.rejects(h.api.login('Campo FICTÍCIO', 'senha-ficticia', 'field'), e => e.code === 'INVALID_SESSION_RESPONSE');
});
test('merge aplica confirmação remota quando estados locais estão vazios', () => {
  const [r] = core.mergeRecordCollections([{ recordId: 'a', photoStates: [] }], [{ recordId: 'a', photoStates: [{ photoIndex: 1, confirmed: true, url: 'remota', uploadKey: 'k' }] }]);
  assert.equal(r.photoStates.length, 7); assert.equal(r.photoStates[0].confirmed, true); assert.equal(r.photoStates[0].serverUrl, 'remota');
});
test('merge preserva substituição local sem aceitar confirmação da foto antiga', () => {
  const [r] = core.mergeRecordCollections([{ recordId: 'a', photoStates: [{ photoIndex: 1, localReady: true, replacePending: true, uploadKey: 'nova' }] }], [{ recordId: 'a', photoStates: [{ photoIndex: 1, confirmed: true, url: 'antiga', uploadKey: 'velha' }] }]);
  assert.equal(r.photoStates[0].confirmed, false); assert.equal(r.photoStates[0].uploadKey, 'nova'); assert.equal(r.photoStates[0].localReady, true);
});
test('confirmação da chave antiga não consome uma foto local nova', () => {
  const r = core.reconcilePhotoStates({ photoStates: [{ photoIndex: 1, localReady: true, uploadKey: 'nova' }] }, { photoStates: [{ photoIndex: 1, confirmed: true, url: 'antiga', uploadKey: 'velha' }] });
  assert.equal(r.photoStates[0].confirmed, false); assert.equal(r.photoStates[0].localReady, true);
});
test('resposta perdida de substituição é recuperada pela mesma chave confirmada', () => {
  const r = core.reconcilePhotoStates({ photoStates: [{ photoIndex: 1, localReady: true, replacePending: true, uploadKey: 'nova' }] }, { photoStates: [{ photoIndex: 1, confirmed: true, url: 'nova-url', uploadKey: 'nova' }] });
  assert.equal(r.photoStates[0].confirmed, true); assert.equal(r.photoStates[0].replacePending, false); assert.equal(r.photoStates[0].localReady, false);
});
function dbHarness(indexedDB) {
  const timers = clock(); const c = vm.createContext({ ...timers, indexedDB, IDBKeyRange: { only: x => x }, Date, console: { warn() {} }, ...core });
  vm.runInContext(dbSource.replace(/^import .*?;\n/, '').replace(/^export /gm, '').replace(/^\{ DB_NAME \};$/m, '') + '\nthis.db={openDatabase,getRecord,getAllRecords,getQueueSummary,deletePhoto,putRecord,putPhotoAndRecord,getPhoto,transactionDone};', c);
  return { c, timers, ...c.db };
}
test('erro tardio da abertura bloqueada não invalida a conexão nova', async () => {
  const requests = []; const h = dbHarness({ open() { const r = {}; requests.push(r); return r; } });
  const first = h.openDatabase(); const firstError = first.catch(e => e); requests[0].onblocked(); await firstError;
  const second = h.openDatabase(); const db = { close() {} }; requests[1].result = db; requests[1].onsuccess(); await second;
  requests[0].error = Error('erro da abertura antiga'); requests[0].onerror();
  assert.equal(h.openDatabase(), second); assert.equal(requests.length, 2);
});
test('leitura local não informa sucesso se a transação abortar depois do request', async () => {
  let tx, request;
  const database = { close() {}, transaction() { tx = { objectStore: () => ({ get() { request = {}; return request; } }), abort() { tx.onabort?.(); } }; return tx; } };
  const h = dbHarness({ open() { const r = {}; queueMicrotask(() => { r.result = database; r.onsuccess(); }); return r; } }); let result, error;
  h.getRecord('a').then(x => { result = x; }, x => { error = x; }); await settle(); request.result = { recordId: 'a' }; request.onsuccess(); await settle();
  tx.error = Error('abort real'); tx.onabort?.(); await settle(); assert.equal(result, undefined); assert.match(error?.message || '', /abort real/);
});
test('transação travada termina em timeout e tentativa de abort', async () => {
  const h = dbHarness({}); let aborted = 0, error;
  h.transactionDone({ abort() { aborted++; } }).catch(e => { error = e; }); h.timers.fire(12000); await settle();
  assert.match(error?.message || '', /Tempo esgotado/); assert.equal(aborted, 1);
});
const fakeFactory = vm.runInNewContext('(' + extract(oldTests, 'createFakeIndexedDb') + ')', { Map, setTimeout, queueMicrotask, structuredClone });
test('limpeza condicional preserva blob substituído durante o upload', async () => {
  const fake = fakeFactory(), h = dbHarness(fake); const record = syncRecord('a');
  await h.putPhotoAndRecord(record, 1, new Blob(['antiga']), 'antiga');
  await h.putPhotoAndRecord(await h.getRecord('a'), 1, new Blob(['nova']), 'nova');
  assert.equal(await h.deletePhoto('a', 1, 'antiga'), false); assert.equal((await h.getPhoto('a', 1)).uploadKey, 'nova');
  assert.equal(await h.deletePhoto('a', 1, 'nova'), true); assert.equal(await h.getPhoto('a', 1), undefined);
});
test('sincronização não sobrescreve registro alterado enquanto aguardava a rede', async () => {
  const fake = fakeFactory(), h = dbHarness(fake); const original = await h.putRecord({ ...syncRecord('a'), observation: 'original' });
  await h.putRecord({ ...original, observation: 'alteração local mais nova' });
  await assert.rejects(h.putRecord({ ...original, status: core.RECORD_STATUS.WAITING_SUPERVISOR }, { expectedUpdatedAt: original.updatedAt }), e => e.code === 'LOCAL_RECORD_CHANGED');
  assert.equal((await h.getRecord('a')).observation, 'alteração local mais nova');
});
test('versão local cresce mesmo com duas gravações no mesmo milissegundo', async () => {
  const h = dbHarness(fakeFactory()); const time = Date.parse('2026-10-06T10:00:00Z');
  h.c.Date = class extends Date { constructor(...args) { super(args.length ? args[0] : time); } static now() { return time; } };
  const first = await h.putRecord(syncRecord('a')), second = await h.putRecord(first); assert.ok(second.updatedAt > first.updatedAt);
});
test('registro local inesperado não derruba os outros nem é apagado', async () => {
  const fake = fakeFactory(), h = dbHarness(fake); await h.putRecord(syncRecord('a')); await h.putRecord({ recordId: 4, status: core.RECORD_STATUS.PENDING });
  assert.deepEqual(plain((await h.getAllRecords()).map(r => r.recordId)), ['a']);
  assert.ok(await h.getRecord(4));
});
test('resumo da fila usa duas transações para várias ocorrências e mantém o proprietário', async () => {
  const fake = fakeFactory(), h = dbHarness(fake);
  for (let i = 0; i < 4; i++) await h.putPhotoAndRecord({ ...syncRecord('a' + i), user: i === 3 ? 'Outro FICTÍCIO' : 'Campo FICTÍCIO' }, 1, new Blob(['foto']), 'k');
  let reads = 0; const transaction = fake.database.transaction; fake.database.transaction = (...args) => { reads++; return transaction(...args); };
  const summary = await h.getQueueSummary('Campo FICTÍCIO'); assert.equal(reads, 2); assert.equal(summary.records.length, 3); assert.equal(summary.photos.length, 3);
});
function workerHarness(source = workerSource) {
  const origin = 'https://fixture.test'; const scope = origin + '/ocorrencias-bq/'; const listeners = {}, stores = new Map(); let failPut = false;
  const key = value => new URL(typeof value === 'string' ? value : value.url, scope).href;
  const caches = { async open(name) { if (!stores.has(name)) stores.set(name, new Map()); const rows = stores.get(name); return {
    async put(k, value) { if (failPut) throw Error('quota simulada'); rows.set(key(k), value.clone()); },
    async match(k, options) { const wanted = key(k); for (const [actual, value] of rows) if (actual === wanted || (options?.ignoreSearch && actual.split('?')[0] === wanted.split('?')[0])) return value.clone(); },
    async addAll() {} }; }, async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); },
    async match(k, options) { for (const name of stores.keys()) { const result = await (await this.open(name)).match(k, options); if (result) return result; } } };
  const version = source.match(/WORKER_VERSION = '([^']+)'/)[1];
  const c = vm.createContext({ URL, Response, Request: class extends Request { constructor(url, options) { super(key(url), options); } }, caches, fetch: async () => new Response('network'), self: { location: { origin, href: scope + 'service-worker.js' }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener(type, fn) { listeners[type] = fn; } }, console });
  vm.runInContext(source, c);
  return { c, listeners, stores, caches, version, scope, failPut: () => { failPut = true; }, async request(url, mode = 'cors', method = 'GET') {
    const waits = []; let response; listeners.fetch({ request: { url: new URL(url, scope).href, mode, method }, respondWith(value) { response = Promise.resolve(value); }, waitUntil(value) { waits.push(value); } });
    const result = await response; await Promise.all(waits); await settle(); return result;
  } };
}
test('navegação com SW antigo mantém HTML da mesma release quando há atualização pendente', async () => {
  const h = workerHarness(); const cache = await h.caches.open('ocorrencias-bq-' + h.version);
  await cache.put('./index.html', new Response('<script type="module" src="./app.js?v=' + h.version + '"></script>'));
  h.c.fetch = async () => new Response('<script type="module" src="./app.js?v=2099.01.01.1"></script>');
  const response = await h.request('./', 'navigate'); assert.match(await response.text(), new RegExp(h.version.replaceAll('.', '\\.')));
  assert.match(await (await cache.match('./index.html')).text(), new RegExp(h.version.replaceAll('.', '\\.')));
});
test('SW nunca usa asset de outro cache como fallback', async () => {
  const h = workerHarness(); const old = await h.caches.open('ocorrencias-bq-obsoleto'); await old.put('./core.js?v=' + h.version, new Response('código velho'));
  h.c.fetch = async () => { throw Error('offline'); }; const response = await h.request('./core.js?v=' + h.version);
  assert.notEqual(await response.text(), 'código velho');
});
test('SW deixa API externa e POST fora da interceptação', async () => {
  const h = workerHarness(); assert.equal(await h.request('https://script.google.com/macros/s/fixture/exec'), undefined); assert.equal(await h.request('./endpoint', 'cors', 'POST'), undefined);
});
test('asset confirmado no cache não dispara download duplicado', async () => {
  const h = workerHarness(); const cache = await h.caches.open('ocorrencias-bq-' + h.version); await cache.put('./app.js?v=' + h.version, new Response('versão certa'));
  let calls = 0; h.c.fetch = async () => { calls++; return new Response('network'); }; assert.equal(await (await h.request('./app.js?v=' + h.version)).text(), 'versão certa'); assert.equal(calls, 0);
});
test('erro de quota no cache não rejeita resposta válida nem gera unhandled rejection', async () => {
  const h = workerHarness(); h.failPut(); assert.equal(await (await h.request('./icon.png')).text(), 'network');
});
test('falha de instalação remove apenas o cache incompleto da nova release', async () => {
  const h = workerHarness(); await h.caches.open('outro-aplicativo');
  h.c.fetch = async () => new Response('indisponível', { status: 500 }); let task;
  h.listeners.install({ waitUntil(value) { task = value; } }); await assert.rejects(task); assert.equal(h.stores.has('ocorrencias-bq-' + h.version), false); assert.equal(h.stores.has('outro-aplicativo'), true);
});
test('reconexão inicia fila antes da conclusão do health check', async () => {
  const handler = appSource.match(/window\.addEventListener\('online', ([^]*?)\);\n  window\.addEventListener\('offline'/)?.[1]; assert.ok(handler);
  const events = [], health = deferred(); const c = { updateNetworkUi() {}, session: { role: 'field' }, loadTeamDirectory() {}, testConnection() { events.push('health'); return health.promise; }, syncAll() { events.push('sync'); return Promise.resolve(); }, console };
  const run = vm.runInNewContext('(' + handler + ')', c); const task = run(); await settle(); assert.ok(events.includes('sync')); health.resolve(true); await task;
});
function syncHarness(records = []) {
  const saved = new Map(records.map(r => [r.recordId, structuredClone(r)])), photos = new Map(), calls = [], c = {
    ...core, ApiError: apiHarness().ApiError, session: { user: 'Campo FICTÍCIO', token: 'token-ficticio', role: 'field' }, sessionRevision: 1, navigator: { onLine: true },
    dailyProduction: { totalExcludingRecord: 0 }, APP_VERSION: core.APP_VERSION, TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO',
    recordSyncPromises: new Map(), syncRunning: false, elements: { syncNowButton: {} }, SYNCABLE_STATUSES: new Set([core.RECORD_STATUS.PENDING, core.RECORD_STATUS.ERROR]),
    getRecord: async id => structuredClone(saved.get(id)), getAllRecords: async () => [...saved.values()].map(r => structuredClone(r)),
    putRecord: async (r, options = {}) => {
      if (options.expectedUpdatedAt !== undefined && String(saved.get(r.recordId)?.updatedAt || '') !== options.expectedUpdatedAt) throw new c.ApiError('Alteração local preservada', 'LOCAL_RECORD_CHANGED');
      const next = { ...r, updatedAt: new Date(Math.max(Date.now(), Date.parse(saved.get(r.recordId)?.updatedAt || '') + 1 || 0)).toISOString() };
      saved.set(r.recordId, structuredClone(next)); return next;
    }, getPhoto: async (id, index) => photos.get(id + ':' + index),
    deletePhoto: async (id, index, key) => { const photo = photos.get(id + ':' + index); if (key !== undefined && photo?.uploadKey !== key) return false; photos.delete(id + ':' + index); return true; },
    setMeta: async () => {}, cacheDailySummary: async () => {}, LAST_SYNC_META: 'lastSyncAt', updateQueueUi: async () => {},
    currentView: 'sync', mineRecords: [], photoSyncAllRunning: false, refreshMine() {}, logout() {}, toast() {}, setBusy() {}, console: { warn() {}, error() {} },
    statusLabel: x => x, friendlyError: e => e.message, blobToDataUrl: async () => 'data:image/jpeg;base64,AA==', api: {}
  };
  vm.createContext(c); vm.runInContext(['syncSingleRecord', 'performSyncSingleRecord', 'syncAll'].map(name => extract(appSource, name)).join('\n'), c);
  return { c, saved, photos, calls };
}
const syncRecord = id => ({ recordId: id, updatedAt: '2026-10-06T10:00:00Z', user: 'Campo FICTÍCIO', status: core.RECORD_STATUS.PENDING, occurrenceTypes: ['PODA'], services: [], materials: [], photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: index < 3, serverUrl: index < 3 ? 'https://foto/' + index : '', uploadKey: 'k' + index })) });
test('falha local em um UUID não impede os próximos da fila', async () => {
  const h = syncHarness([syncRecord('a'), syncRecord('b'), syncRecord('c')]); const processed = [];
  h.c.syncSingleRecord = async id => { processed.push(id); if (id === 'b') throw Error('leitura local falhou'); };
  await h.c.syncAll(false); assert.deepEqual(processed, ['a', 'b', 'c']); assert.equal(h.c.syncRunning, false);
});
test('duas execuções de sincronismo do mesmo UUID compartilham uma operação', async () => {
  const h = syncHarness(); const work = deferred(); let count = 0; h.c.performSyncSingleRecord = async () => { count++; return work.promise; };
  const a = h.c.syncSingleRecord('a', false), b = h.c.syncSingleRecord('a', false); work.resolve('ok'); assert.deepEqual(await Promise.all([a, b]), ['ok', 'ok']); assert.equal(count, 1); assert.equal(h.c.recordSyncPromises.size, 0);
});
for (const status of [core.RECORD_STATUS.WAITING_SUPERVISOR, core.RECORD_STATUS.CORRECTION_REQUESTED, core.RECORD_STATUS.REJECTED, core.RECORD_STATUS.PUBLISHED]) test('retry respeita decisão remota e não reenvia dados: ' + status, async () => {
  const h = syncHarness([{ ...syncRecord('a'), attempts: 1 }]); let submissions = 0;
  h.c.api.getRecordState = async () => syncState('a', { status }); h.c.api.submitRecord = async () => { submissions++; throw Error('não deveria reenviar'); };
  const result = await h.c.syncSingleRecord('a', false); assert.equal(result.status, status); assert.equal(submissions, 0);
});
test('offline mantém UUID, fotos e item da fila sem request', async () => {
  const h = syncHarness([syncRecord('a')]); h.c.navigator.onLine = false; h.photos.set('a:1', { blob: new Blob(['foto']), uploadKey: 'k' });
  let requests = 0; h.c.api.submitRecord = async () => { requests++; }; await h.c.syncSingleRecord('a', false);
  assert.equal(h.saved.get('a').recordId, 'a'); assert.equal(h.saved.get('a').status, core.RECORD_STATUS.PENDING); assert.equal(h.photos.size, 1); assert.equal(requests, 0);
});
test('cache secundário indisponível não converte confirmação real em falha de sincronização', async () => {
  const h = syncHarness([{ ...syncRecord('a'), attempts: 1 }]); h.c.api.getRecordState = async () => syncState(); h.c.cacheDailySummary = async () => { throw Error('quota'); }; h.c.setMeta = async () => { throw Error('quota'); };
  const result = await h.c.syncSingleRecord('a', false); await settle(); assert.equal(result.status, core.RECORD_STATUS.WAITING_SUPERVISOR); assert.equal(h.saved.get('a').lastError, '');
});
test('sincronizar tudo completa dois UUIDs e preserva o item sem foto local', async () => {
  const records = ['a', 'b', 'c'].map(id => ({ ...syncRecord(id), photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, localReady: index < 3, uploadKey: id + '-' + index })) }));
  const h = syncHarness(records); const confirmed = new Map();
  const response = id => { const keys = confirmed.get(id) || new Map(); return syncState(id, { status: keys.size >= 3 ? core.RECORD_STATUS.WAITING_SUPERVISOR : core.RECORD_STATUS.SYNCING_PHOTOS, photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: keys.has(index + 1), url: keys.has(index + 1) ? 'foto-' + index : '', uploadKey: keys.get(index + 1) || '' })) }); };
  h.c.api.submitRecord = async (_token, record) => response(record.recordId); h.c.api.getRecordState = async (_token, id) => response(id);
  h.c.api.uploadPhoto = async (_token, photo) => { if (!confirmed.has(photo.recordId)) confirmed.set(photo.recordId, new Map()); confirmed.get(photo.recordId).set(photo.photoIndex, photo.uploadKey); return response(photo.recordId); };
  for (const record of records.filter(r => r.recordId !== 'b')) for (let index = 1; index <= 3; index++) h.photos.set(record.recordId + ':' + index, { recordId: record.recordId, photoIndex: index, uploadKey: record.recordId + '-' + (index - 1), blob: new Blob(['foto']) });
  await h.c.syncAll(false); assert.equal(h.saved.get('a').status, core.RECORD_STATUS.WAITING_SUPERVISOR); assert.equal(h.saved.get('c').status, core.RECORD_STATUS.WAITING_SUPERVISOR); assert.equal(h.saved.get('b').status, core.RECORD_STATUS.ERROR); assert.match(h.saved.get('b').lastError, /não está mais disponível/); assert.equal(h.saved.size, 3);
});
test('perda de conexão no upload mantém blob e a reconexão recupera a mesma chave', async () => {
  const record = { ...syncRecord('a'), photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, localReady: index < 3, uploadKey: 'k' + index })) };
  const h = syncHarness([record]); const uploaded = new Map(); let failed = false, submissions = 0;
  const response = () => syncState('a', { status: uploaded.size >= 3 ? core.RECORD_STATUS.WAITING_SUPERVISOR : core.RECORD_STATUS.SYNCING_PHOTOS, photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: uploaded.has(index + 1), url: uploaded.has(index + 1) ? 'foto-' + index : '', uploadKey: uploaded.get(index + 1) || '' })) });
  h.c.api.submitRecord = async () => { submissions++; return response(); }; h.c.api.getRecordState = async () => response();
  h.c.api.uploadPhoto = async (_token, photo) => { uploaded.set(photo.photoIndex, photo.uploadKey); if (!failed) { failed = true; h.c.navigator.onLine = false; throw new h.c.ApiError('resposta perdida', 'NETWORK_ERROR'); } return response(); };
  for (let index = 1; index <= 3; index++) h.photos.set('a:' + index, { recordId: 'a', photoIndex: index, uploadKey: 'k' + (index - 1), blob: new Blob(['foto']) });
  await h.c.syncSingleRecord('a', false); assert.equal(h.saved.get('a').status, core.RECORD_STATUS.ERROR); assert.equal(h.photos.size, 3);
  h.c.navigator.onLine = true; await h.c.syncSingleRecord('a', false); assert.equal(h.saved.get('a').status, core.RECORD_STATUS.WAITING_SUPERVISOR); assert.equal(uploaded.size, 3); assert.equal(h.photos.size, 0); assert.equal(submissions, 2);
});
test('finally da consulta publicada antiga não remove a Promise da sessão nova', async () => {
  const first = deferred(), second = deferred(); const c = { ApiError: apiHarness().ApiError, session: { token: 'old' }, sessionRevision: 1, reviewOrder: ['a'], publishedDetailCache: new Map(), publishedDetailRequests: new Map(), api: { listPublishedRecords: () => first.promise }, ...core };
  vm.createContext(c); vm.runInContext(extract(appSource, 'loadPublishedDetailBatch'), c);
  const old = c.loadPublishedDetailBatch('a'); c.sessionRevision++; c.publishedDetailRequests.clear(); c.api.listPublishedRecords = () => second.promise;
  const current = c.loadPublishedDetailBatch('a'); first.resolve({ records: [] }); await old;
  assert.equal(c.publishedDetailRequests.size, 1); second.resolve({ records: [{ recordId: 'a', status: core.RECORD_STATUS.PUBLISHED }] }); await current;
});
test('falha ao salvar edição local é mostrada e a rejeição é tratada sem descartar o rascunho', async () => {
  const draft = { recordId: 'preservado', observation: 'texto digitado' }, events = [];
  const c = { activeRecord: draft, console: { error: () => events.push('technical') }, toast: message => events.push(message), friendlyError: e => e.message };
  const run = vm.runInNewContext(extract(appSource, 'runLocalAction') + '\nrunLocalAction', c);
  assert.equal(await run(async () => { throw Error('Armazenamento local indisponível'); }), null);
  assert.equal(c.activeRecord, draft); assert.deepEqual(events, ['technical', 'Armazenamento local indisponível']);
});
function supervisorHarness() {
  const events = [], c = { ...core, session: { token: 'antiga', role: 'supervisor' }, sessionRevision: 1, activeSupervisorRecord: { recordId: 'a', occurrenceNumber: 'TESTE' },
    supervisorMutationRunning: false, reviewTab: 'occurrences', reviewOrder: ['a', 'b'], supervisorRefreshPromise: null,
    supervisorRecords: [{ recordId: 'a' }, { recordId: 'b' }], selectedSupervisorIds: new Set(['a', 'b']),
    elements: { approveButton: {}, rejectButton: {}, requestCorrectionButton: {}, supervisorBatchResult: {}, reviewDialog: { close() { events.push('close'); } } },
    confirmAction: async () => true, api: {}, refreshSupervisor: async () => { events.push('refresh'); return []; },
    advanceSupervisorAfterAction: () => events.push('advance'), setBusy() {}, toast: () => events.push('toast'), friendlyError: e => e.message,
    updateSupervisorReviewActions() {}, console };
  vm.createContext(c); vm.runInContext(['decideSupervisor', 'approveSupervisorRecords'].map(name => extract(appSource, name)).join('\n'), c);
  return { c, events };
}
test('decisão concluída na sessão antiga não avança nem libera a operação da sessão nova', async () => {
  const h = supervisorHarness(), work = deferred(); h.c.api.supervisorAction = () => work.promise;
  const task = h.c.decideSupervisor('approve'); await settle(); h.c.sessionRevision++; h.c.session = { token: 'nova', role: 'supervisor' }; h.c.supervisorMutationRunning = true;
  work.resolve({ ok: true }); await task; assert.deepEqual(h.events, []); assert.equal(h.c.supervisorMutationRunning, true);
});
test('troca de sessão interrompe lote antes do próximo UUID e preserva a seleção nova', async () => {
  const h = supervisorHarness(), work = deferred(), calls = []; h.c.api.supervisorAction = async (token, action, id) => { calls.push([token, id]); if (id === 'a') await work.promise; };
  const task = h.c.approveSupervisorRecords(['a', 'b'], {}); await settle(); h.c.sessionRevision++; h.c.session = { token: 'nova', role: 'supervisor' };
  work.resolve({ ok: true }); await task; assert.deepEqual(calls, [['antiga', 'a']]); assert.equal(h.c.selectedSupervisorIds.size, 2); assert.deepEqual(h.events, []);
});
if (process.argv[2]) {
  const backend = await readFile(process.argv[2], 'utf8');
  const harnessFactory = vm.runInNewContext(publicationTests.slice(publicationTests.indexOf('class MemorySheet'), publicationTests.indexOf('function assertComplete')) + '\nharness', { assert, vm, plain, backend, Date, Map, UUID: '00000001-1111-4111-8111-111111111111', console });
  function photoBackend() {
    const h = harnessFactory(); const id = '00000001-1111-4111-8111-111111111111'; const { APP, COL } = h.meta;
    h.seed({ recordId: id, registeredAt: '2026-10-01T09:00:00-03:00', user: 'Campo FICTÍCIO', team: 'LM TESTE', base: 'CAICÓ', contract: '4600080938', crewLeader: 'Chefe TESTE', occurrenceNumber: 'TESTE', occurrenceTypes: ['PODA'], transformer: {}, services: [], materials: [], totalServices: 0 });
    const row = h.sheet(APP.pendingSheet).rows[1]; row[COL.PHOTO_1 + 1] = ''; row[COL.UPLOAD_KEY_1 + 1] = ''; row[COL.STATUS - 1] = h.meta.STATUS.SYNCING_PHOTOS;
    const files = []; h.c.requireSession_ = () => ({ role: 'field', user: 'Campo FICTÍCIO' }); h.c.recordFromValuesAt_ = values => h.c.recordFromRow_(values, {}, {}, {});
    h.c.Utilities.base64Decode = () => [1]; h.c.Utilities.newBlob = (_bytes, _mime, name) => ({ name });
    h.c.makePhotoPublic_ = () => {}; h.c.photoFolder_ = () => ({ createFile(blob) { const file = { name: blob.name, id: 'fixture_drive_file_' + files.length + '_abcdefghijklmnop', setDescription() {}, getId() { return this.id; } }; files.push(file); h.fileFault?.(); return file; }, getFilesByName(name) { const found = files.filter(f => f.name === name); let index = 0; return { hasNext: () => index < found.length, next: () => found[index++] }; } });
    return Object.assign(h, { files, payload: { token: 'ficticio', recordId: id, photoIndex: 3, uploadKey: '00000002-1111-4111-8111-111111111111', dataUrl: 'data:image/jpeg;base64,AA==' } });
  }
  test('upload interrompido após criar arquivo reutiliza UUID/slot/uploadKey no retry', () => {
    const h = photoBackend(); h.fileFault = () => { h.fileFault = null; throw Error('resposta do Drive perdida'); };
    assert.throws(() => h.c.uploadPhoto_(h.payload)); const result = h.c.uploadPhoto_(h.payload); assert.equal(h.files.length, 1); assert.equal(result.photoStates[2].confirmed, true);
  });
  test('upload interrompido entre URL e uploadKey completa o commit no retry', () => {
    const h = photoBackend(); h.failAfter(e => e.column === h.meta.COL.PHOTO_1 + 2 || (e.column === 1 && e.table === h.meta.APP.pendingSheet));
    assert.throws(() => h.c.uploadPhoto_(h.payload)); const result = h.c.uploadPhoto_(h.payload); assert.equal(h.files.length, 1); assert.equal(result.status, h.meta.STATUS.WAITING_SUPERVISOR);
  });
  test('listMine é leitura sem headers e sem reparo operacional', () => {
    const h = photoBackend(); h.c.listMine_({ token: 'ficticio' }); assert.equal(h.writes.length, 0); assert.equal(h.reads.filter(r => r.row === 1).length, 0);
  });
  test('falha de compartilhamento após criar a foto não gera outro arquivo no retry', () => {
    const h = photoBackend(); let failed = false; h.c.makePhotoPublic_ = () => { if (!failed) { failed = true; throw Error('Drive indisponível'); } };
    assert.throws(() => h.c.uploadPhoto_(h.payload)); h.c.uploadPhoto_(h.payload); assert.equal(h.files.length, 1);
  });
  test('retry da mesma chave já confirmada não grava linha nem duplica arquivo', () => {
    const h = photoBackend(); h.c.uploadPhoto_(h.payload); h.writes.length = 0;
    const result = h.c.uploadPhoto_(h.payload); assert.equal(result.photoStates[2].confirmed, true); assert.equal(h.files.length, 1); assert.equal(h.writes.length, 0);
  });
  test('resposta perdida após reenvio de correção mantém um único evento de histórico', () => {
    const h = photoBackend(), { APP, COL, STATUS } = h.meta, row = h.sheet(APP.pendingSheet).rows[1];
    row[COL.STATUS - 1] = STATUS.CORRECTION_REQUESTED; const audit = JSON.parse(row[COL.AUDIT - 1]); audit.requestedPhotoIndexes = [3]; row[COL.AUDIT - 1] = JSON.stringify(audit); h.payload.replace = true;
    h.failAfter(e => e.table === APP.historySheet); assert.throws(() => h.c.uploadPhoto_(h.payload));
    const result = h.c.uploadPhoto_(h.payload); assert.equal(result.status, STATUS.WAITING_SUPERVISOR);
    assert.equal(h.rows(APP.historySheet).filter(r => r[3] === 'CORRECAO_REENVIADA').length, 1); assert.equal(h.files.length, 1);
  });
}
let passed = 0; const failures = [];
for (const { name, run } of tests) { try { await run(); passed++; } catch (error) { failures.push({ name, error: error.message }); } }
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
