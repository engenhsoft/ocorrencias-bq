import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';

const [beforeRoot, afterRoot, beforeBackend, afterBackend, output] = process.argv.slice(2);
if (!output) throw Error('Informe checkouts anterior/atual, backends anterior/atual e saída JSON.');
const testsRoot = new URL('./', import.meta.url);
const [audit, regression, publication, login] = await Promise.all(['stability-audit', 'audit-regression', 'publication-reconciliation', 'login-initial-load'].map(name => readFile(new URL(name + '.mjs', testsRoot), 'utf8')));
const extract = (source, name) => { const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(match, name); return match[0]; };
const plain = value => JSON.parse(JSON.stringify(value));
const clock = () => ({ setTimeout, clearTimeout });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = id => ({ recordId: id, user: 'Campo FICTÍCIO', occurrenceNumber: 'TESTE', registeredAt: '2026-10-01T09:00:00-03:00', updatedAt: '2026-10-06T10:00:00Z',
  team: 'LM TESTE', base: 'CAICÓ', contract: '4600080938', crewLeader: 'Chefe TESTE', status: 'PENDENTE_SINCRONIZACAO', occurrenceTypes: ['PODA'], transformer: {}, services: [], materials: [],
  photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: index < 3, serverUrl: index < 3 ? 'https://foto/' + index : '', uploadKey: 'k' + index })) });
const results = [];
for (const [phase, root, backendPath] of [['before', beforeRoot, beforeBackend], ['after', afterRoot, afterBackend]]) {
  const [appSource, apiSource, dbSource, coreSource, backend] = await Promise.all(['app.js', 'api.js', 'db.js', 'core.js'].map(name => readFile(root + '/' + name, 'utf8')).concat(readFile(backendPath, 'utf8')));
  const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
  const element = () => ({ hidden: false, innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, classList: { toggle() {} }, setAttribute() {} });
  const context = { assert, vm, core, ...core, appSource, apiSource, dbSource, oldTests: regression, extract, plain, clock, Blob, Date, Map, Set, Promise, console: { warn() {}, error() {} }, setTimeout, clearTimeout, queueMicrotask, structuredClone, AbortController, URL };
  const helpers = vm.runInNewContext([extract(audit, 'apiHarness'), extract(audit, 'dbHarness'), extract(audit, 'syncHarness')].join('\n') + '\n({apiHarness,dbHarness,syncHarness})', context);
  context.ApiError = helpers.apiHarness().ApiError;
  context.loadOccurrenceDataset = vm.runInNewContext(extract(apiSource, 'loadOccurrenceDataset') + '\nloadOccurrenceDataset', { ApiError: context.ApiError, setTimeout });
  const appHarness = vm.runInNewContext(extract(login, 'appHarness') + '\nappHarness', { ...context, element, retryWaits: [] });
  const fakeFactory = vm.runInNewContext('(' + extract(regression, 'createFakeIndexedDb') + ')', context);
  const backendHarness = vm.runInNewContext(publication.slice(publication.indexOf('class MemorySheet'), publication.indexOf('function assertComplete')) + '\nharness', { assert, vm, plain, backend, Date, Map, UUID: '00000001-1111-4111-8111-111111111111', console: context.console });
  async function measure(name, run) {
    const samples = []; for (let i = 0; i < 5; i++) samples.push(await run());
    const keys = Object.keys(samples[0]).filter(key => typeof samples[0][key] === 'number');
    const median = Object.fromEntries(keys.map(key => [key, +samples.map(s => s[key]).sort((a, b) => a - b)[2].toFixed(3)]));
    results.push({ phase, name, n: 5, median, samples });
  }
  await measure('Campo: login e primeira lista, rede de 40/120 ms simulada', async () => {
    const h = appHarness('field'), points = {}; let requests = 0;
    h.c.api.login = async () => { await pause(40); return { token: 'ficticio', user: 'Campo FICTÍCIO', role: 'field' }; };
    let hidden = true; Object.defineProperty(h.elements.appShell, 'hidden', { get: () => hidden, set(value) { hidden = value; if (!value) points.shell = performance.now(); } });
    h.c.api.listMine = async () => { requests++; await pause(120); return { records: Array.from({ length: 50 }, (_, i) => ({ ...record('r' + i), status: core.RECORD_STATUS.WAITING_SUPERVISOR })) }; };
    const start = performance.now(); await h.c.handleLogin({ preventDefault() {} }); await h.c.mineRefreshPromise;
    assert.equal(h.c.mineServerDataLoaded, true); assert.equal(requests, 1);
    return { loginMs: points.shell - start, firstContentMs: performance.now() - start, primaryRequests: requests };
  });
  await measure('IndexedDB: resumo da fila com 100 ocorrências e 300 fotos', async () => {
    const fake = fakeFactory(), h = helpers.dbHarness(fake);
    for (let i = 0; i < 100; i++) for (let index = 1; index <= 3; index++) await h.putPhotoAndRecord({ ...record('r' + i), status: core.RECORD_STATUS.PENDING }, index, new Blob(['foto']), 'k' + index);
    let reads = 0; const transaction = fake.database.transaction; fake.database.transaction = (...args) => { reads++; return transaction(...args); };
    const start = performance.now(); const summary = await h.getQueueSummary('Campo FICTÍCIO');
    assert.equal(summary.records.length, 100); assert.equal(summary.photos.length, 300);
    return { queueMs: performance.now() - start, transactions: reads, occurrences: summary.records.length, photos: summary.photos.length };
  });
  for (const action of ['listMine_', 'listPending_', 'getRecordState_']) await measure('Backend: ' + action + ', 100 pendências, cache de fotos aquecido', async () => {
    const h = backendHarness({ source: backend }); const { APP, COL, STATUS } = h.meta;
    for (let i = 1; i <= 100; i++) h.seed({ ...record(String(i).padStart(8, '0') + '-1111-4111-8111-111111111111'), status: core.RECORD_STATUS.WAITING_SUPERVISOR });
    for (const row of h.sheet(APP.pendingSheet).rows.slice(1)) for (let index = 0; index < 3; index++) row[COL.PHOTO_1 - 1 + index] = 'https://drive.google.com/uc?export=view&id=fixture_photo_' + row[0] + '_' + index;
    const published = h.sheet(APP.pendingSheet).rows.slice(1, 21).map((row, index) => { const copy = row.slice(); copy[0] = 'p' + index; copy[COL.STATUS - 1] = STATUS.PUBLISHED; return copy; });
    h.add(APP.officialSheet, published);
    h.add(APP.servicesSheet, published.flatMap(row => Array.from({ length: 3 }, (_, index) => [row[0], 'S' + index, 'Descrição histórica', 'un', .75, 2, 1.5, 'grupo', 'snapshot-' + index, '2026-10-01T09:00:00-03:00'])));
    h.add(APP.materialsSheet, published.flatMap(row => Array.from({ length: 4 }, (_, index) => [row[0], 'Material', .5, '2026-10-01T09:00:00-03:00', '000' + index, 'Material', 'un', 'TESTE'])));
    let cacheIndividual = 0, cacheBatch = 0;
    h.c.requireSession_ = () => ({ user: 'Campo FICTÍCIO', role: action === 'listPending_' ? 'supervisor' : 'field' });
    h.c.CacheService = { getScriptCache: () => ({ get() { cacheIndividual++; return '1'; }, getAll(keys) { cacheBatch++; return Object.fromEntries(keys.map(key => [key, '1'])); }, put() {} }) };
    h.reads.length = 0; const start = performance.now(); const payload = h.c[action]({ token: 'ficticio', recordId: '00000050-1111-4111-8111-111111111111' });
    return { cpuMs: performance.now() - start, ranges: h.reads.length, headerRanges: h.reads.filter(r => r.row === 1).length,
      cells: h.reads.reduce((total, r) => total + r.height * r.width, 0), cacheIndividual, cacheBatch, payloadBytes: Buffer.byteLength(JSON.stringify(payload)), writes: h.writes.length };
  });
  await measure('Upload de foto: CPU e lock em serviços Google simulados', async () => {
    const h = backendHarness({ source: backend }), id = '00000001-1111-4111-8111-111111111111', { APP, COL, STATUS } = h.meta;
    h.seed(record(id)); const row = h.sheet(APP.pendingSheet).rows[1]; row[COL.PHOTO_1 + 1] = ''; row[COL.UPLOAD_KEY_1 + 1] = ''; row[COL.STATUS - 1] = STATUS.SYNCING_PHOTOS;
    h.c.requireSession_ = () => ({ role: 'field', user: 'Campo FICTÍCIO' }); h.c.Utilities.base64Decode = () => [1]; h.c.Utilities.newBlob = (_bytes, _mime, name) => ({ name }); h.c.makePhotoPublic_ = () => {};
    const files = []; h.c.photoFolder_ = () => ({ createFile(blob) { const file = { name: blob.name, getId: () => 'fixture_photo_abcdefghijklmnop', setDescription() {} }; files.push(file); return file; }, getFilesByName(name) { let index = 0; const found = files.filter(f => f.name === name); return { hasNext: () => index < found.length, next: () => found[index++] }; } });
    const originalLock = h.c.LockService.getScriptLock; let entered, lockMs;
    h.c.LockService.getScriptLock = () => { const lock = originalLock(); return { waitLock(ms) { lock.waitLock(ms); entered = performance.now(); }, releaseLock() { lockMs = performance.now() - entered; lock.releaseLock(); } }; };
    h.writes.length = 0; const start = performance.now(); const payload = h.c.uploadPhoto_({ token: 'ficticio', recordId: id, photoIndex: 3, uploadKey: '00000002-1111-4111-8111-111111111111', dataUrl: 'data:image/jpeg;base64,AA==' });
    assert.equal(payload.photoStates[2].confirmed, true);
    return { cpuMs: performance.now() - start, lockMs, filesCreated: files.length, sheetWrites: h.writes.length };
  });
  await measure('Sincronismo: retry após confirmação remota, latência de 15 ms por chamada', async () => {
    const local = { ...record('a'), status: core.RECORD_STATUS.ERROR, attempts: 1, serverConfirmed: true };
    const h = helpers.syncHarness([local]); let requests = 0, submits = 0;
    const response = () => ({ recordId: 'a', record: { recordId: 'a' }, status: core.RECORD_STATUS.WAITING_SUPERVISOR,
      photoStates: local.photoStates.map(s => ({ ...s, url: s.serverUrl })) });
    h.c.api.getRecordState = async () => { requests++; await pause(15); return response(); };
    h.c.api.submitRecord = async () => { requests++; submits++; await pause(15); return response(); };
    const start = performance.now(); await h.c.syncSingleRecord('a', false);
    assert.equal(h.saved.get('a').status, core.RECORD_STATUS.WAITING_SUPERVISOR);
    return { syncMs: performance.now() - start, requests, submits };
  });
  await measure('Pesquisa obsoleta: fallback local de 20 ms simulado', async () => {
    let rejectRequest, cacheReads = 0;
    const c = { ...core, session: { token: 'ficticio' }, sessionRevision: 1, catalogSearchRequestId: 1,
      navigator: { onLine: true }, catalogResults: [], console: context.console,
      elements: { serviceSearch: { value: 'antigo' }, operationBase: { value: 'CAICÓ' }, searchSpinner: {}, serviceSearchHint: {}, serviceResults: {} },
      api: { searchCatalog: () => new Promise((_resolve, reject) => { rejectRequest = reject; }) },
      searchCachedCatalog: async () => { cacheReads++; await pause(20); return []; }, cacheCatalogResults: async () => {}, renderCatalogResults() {} };
    vm.createContext(c); vm.runInContext(extract(appSource, 'searchCatalog'), c);
    const start = performance.now(); const task = c.searchCatalog('antigo', 1);
    c.catalogSearchRequestId = 2; c.elements.serviceSearch.value = 'novo'; rejectRequest(Error('Falha simulada')); await task;
    assert.equal(cacheReads, phase === 'before' ? 1 : 0);
    return { obsoleteCompletionMs: performance.now() - start, cacheReads };
  });
}
const report = { environment: 'Node VM; DOM, rede, IndexedDB e serviços Google simulados. CPU do código real e latências controladas; não é medição no iPhone nem no Apps Script real.', realApplicationLogin: false, productionWrites: 0, results };
await writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(results.map(({ phase, name, n, median }) => ({ phase, name, n, median })), null, 2));
