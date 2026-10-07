import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = process.argv[3] || new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const [appSource, coreSource] = await Promise.all(['app.js', 'core.js'].map(name => readFile(root + '/' + name, 'utf8')));
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const extract = name => {
  const found = appSource.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(found, name); return found[0];
};
const load = (context, ...names) => {
  vm.createContext(context); vm.runInContext(names.map(extract).join('\n'), context); return context;
};
const tests = [];
const test = (name, run) => tests.push({ name, run });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
const record = (id = 'A') => ({ recordId: id, user: 'Campo FICTÍCIO', updatedAt: '2026-10-06T20:00:00Z',
  status: core.RECORD_STATUS.DRAFT, observation: 'preservar ' + id, photoStates: core.normalizePhotoStates([]) });

for (const [input, expected] of [['1.', 1], ['1,', 1], ['15,50', 15.5], ['15.50', 15.5], ['0,75', .75], ['0.75', .75], ['2,5', 2.5], ['2.5', 2.5], ['125,567', 125.567], ['125.567', 125.567]]) {
  test('QTD de serviço normaliza ' + input, () => assert.equal(core.parseServiceQuantity(input), expected));
}
test('QTD com separador final chega ao backend como número, sem mudar materiais', () => {
  assert.equal(core.serializeServicesForBackend([{ quantity: '1.' }])[0].quantity, 1);
  assert.ok(Number.isNaN(core.parseMaterialQuantity('1.')));
});
for (const input of ['.', ',', '', '-1', '1e3', '1.2.3']) test('QTD inválida permanece rejeitada: ' + JSON.stringify(input), () => assert.ok(Number.isNaN(core.parseServiceQuantity(input))));

function catalogHarness() {
  const rendered = [];
  const c = { ...core, session: { token: 'FICTÍCIO' }, sessionRevision: 1, catalogSearchRequestId: 1,
    navigator: { onLine: true }, catalogResults: [], elements: { serviceSearch: { value: 'antigo' }, operationBase: { value: 'CAICÓ' },
    searchSpinner: { hidden: true }, serviceSearchHint: { textContent: '' }, serviceResults: { hidden: false } },
    api: {}, cacheCatalogResults: async () => {}, searchCachedCatalog: async () => [{ code: 'ANTIGO' }],
    renderCatalogResults: error => rendered.push({ code: c.catalogResults[0]?.code, error: error?.message }),
    friendlyError: error => error.message, console: { warn() {}, error() {} } };
  load(c, 'searchCatalog'); return { c, rendered };
}
test('fallback tardio não troca o serviço mostrado por resultado de pesquisa anterior', async () => {
  const h = catalogHarness(), old = deferred();
  h.c.api.searchCatalog = (_token, query) => query === 'antigo' ? old.promise : Promise.resolve({ results: [{ code: 'NOVO' }] });
  const a = h.c.searchCatalog('antigo', 1);
  h.c.catalogSearchRequestId = 2; h.c.elements.serviceSearch.value = 'novo';
  await h.c.searchCatalog('novo', 2); old.reject(Error('rede')); await a;
  assert.equal(h.c.catalogResults[0].code, 'NOVO');
  assert.deepEqual(h.rendered.map(result => result.code), ['NOVO']);
});
test('falha da API e do cache termina com erro recuperável sem rejeição abandonada', async () => {
  const h = catalogHarness();
  h.c.api.searchCatalog = async () => { throw Error('Rede indisponível'); };
  h.c.searchCachedCatalog = async () => { throw Error('Armazenamento indisponível'); };
  await assert.doesNotReject(h.c.searchCatalog('antigo', 1));
  assert.equal(h.c.elements.searchSpinner.hidden, true);
  assert.ok(h.rendered[0]?.error); assert.equal(h.c.catalogResults.length, 0);
});
test('resposta antiga não contamina pesquisa após troca de sessão', async () => {
  const h = catalogHarness(), work = deferred(); h.c.api.searchCatalog = () => work.promise;
  const a = h.c.searchCatalog('antigo', 1); h.c.sessionRevision++; h.c.catalogResults = [{ code: 'NOVA-SESSÃO' }];
  work.reject(Error('rede')); await a;
  assert.equal(h.c.catalogResults[0].code, 'NOVA-SESSÃO');
  assert.equal(h.rendered.length, 0);
});
test('resultado remoto válido permanece disponível quando a escrita do cache falha', async () => {
  const h = catalogHarness(); h.c.api.searchCatalog = async () => ({ results: [{ code: 'REMOTO' }] });
  h.c.cacheCatalogResults = async () => { throw Error('quota'); };
  await h.c.searchCatalog('antigo', 1); assert.equal(h.c.catalogResults[0].code, 'REMOTO');
  assert.equal(h.rendered[0].error, undefined);
});
test('erro de pesquisa obsoleta não provoca leitura desnecessária do cache', async () => {
  const h = catalogHarness(), work = deferred(); let reads = 0;
  h.c.api.searchCatalog = () => work.promise; h.c.searchCachedCatalog = async () => { reads++; return []; };
  const task = h.c.searchCatalog('antigo', 1); h.c.catalogSearchRequestId = 2; h.c.elements.serviceSearch.value = 'novo';
  work.reject(Error('rede')); await task; assert.equal(reads, 0);
});
for (const [handler, prefix, runSearch] of [['handleCatalogInput', 'catalog', 'searchCatalog'], ['handleMaterialCatalogInput', 'material', 'searchMaterials']]) {
  test(handler + ': primeira abertura lenta não cancela pesquisa digitada depois', async () => {
    const work = deferred(), timers = new Map(), searches = []; let calls = 0, timer = 0;
    const field = { value: 'antigo' };
    const c = { sessionRevision: 1, activeRecord: record(), ensureActiveRecord: () => ++calls === 1 ? work.promise : Promise.resolve(),
      catalogSearchTimer: 0, materialSearchTimer: 0, catalogSearchRequestId: 0, materialSearchRequestId: 0,
      elements: { serviceSearch: field, materialSearch: field, operationBase: { value: 'CAICÓ' } },
      contractForBase: () => 'CONTRATO', clearTimeout: id => timers.delete(id), setTimeout: callback => { timers.set(++timer, callback); return timer; },
      [runSearch]: query => searches.push(query) };
    load(c, handler); const first = c[handler](); field.value = 'novo'; await c[handler](); work.resolve(); await first;
    for (const callback of timers.values()) callback(); assert.deepEqual(searches, ['novo']);
  });
}

function photoHarness() {
  const writes = [], previews = [], feedback = [];
  let counter = 0;
  const c = { ...core, sessionRevision: 1, session: { user: 'Campo FICTÍCIO' }, activeRecord: record(), photoSelectionRequests: new Map(),
    activePhotos: new Map(), ensureActiveRecord: async () => c.activeRecord, optimizePhoto: async file => file,
    generateUuid: () => 'upload-' + ++counter, putPhotoAndRecord: async (r, index, blob, key) => {
      writes.push({ id: r.recordId, index, blob, key });
      return { record: structuredClone(r), photo: { blob, uploadKey: key } };
    }, saveActiveDraft: async () => {}, setPreviewUrl: (index, url) => previews.push([index, url]),
    URL: { createObjectURL: blob => 'blob:' + blob.name }, updatePhotoGrid() {}, validateStepOne() {},
    ApiError: class extends Error {}, friendlyError: error => error.message, toast: text => feedback.push(text) };
  load(c, 'storeSelectedPhoto', 'removePhoto'); return { c, writes, previews, feedback };
}
const image = name => ({ name, type: 'image/jpeg', size: 20 });
test('foto em decodificação não é anexada a outro UUID', async () => {
  const h = photoHarness(), work = deferred(); h.c.optimizePhoto = () => work.promise;
  const task = h.c.storeSelectedPhoto(1, image('A'), false); await tick();
  const other = record('B'); h.c.activeRecord = other; work.resolve(image('A')); await task;
  assert.equal(h.c.activeRecord, other); assert.equal(h.writes.length, 0); assert.equal(h.previews.length, 0);
});
test('logout durante decodificação não grava foto nem produz erro da sessão antiga', async () => {
  const h = photoHarness(), work = deferred(); h.c.optimizePhoto = () => work.promise;
  const task = h.c.storeSelectedPhoto(1, image('A'), false); await tick();
  h.c.sessionRevision++; h.c.activeRecord = null; work.resolve(image('A')); await task;
  assert.equal(h.writes.length, 0); assert.equal(h.feedback.length, 0);
});
test('última seleção do mesmo slot vence decodificação em ordem inversa', async () => {
  const h = photoHarness(), old = deferred(); h.c.optimizePhoto = file => file.name === 'antiga' ? old.promise : Promise.resolve(file);
  const first = h.c.storeSelectedPhoto(1, image('antiga'), false); await tick();
  await h.c.storeSelectedPhoto(1, image('nova'), false); old.resolve(image('antiga')); await first;
  assert.deepEqual(h.writes.map(write => write.blob.name), ['nova']);
  assert.equal(h.c.activePhotos.get(1).blob.name, 'nova');
});
test('gravação concluída não reabre formulário de outro UUID', async () => {
  const h = photoHarness(), work = deferred(); h.c.putPhotoAndRecord = () => work.promise;
  const task = h.c.storeSelectedPhoto(1, image('A'), false); await tick();
  const other = record('B'); h.c.activeRecord = other; work.resolve({ record: record('A') }); await task;
  assert.equal(h.c.activeRecord, other); assert.equal(h.previews.length, 0);
});
test('abertura local lenta não encaminha foto para formulário trocado', async () => {
  const h = photoHarness(), work = deferred(); h.c.ensureActiveRecord = () => work.promise;
  const task = h.c.storeSelectedPhoto(1, image('A'), false); h.c.activeRecord = record('B');
  work.resolve(record('A')); await task; assert.equal(h.writes.length, 0);
});
test('falha ao gravar foto preserva o estado anterior em memória', async () => {
  const h = photoHarness(); const before = plain(h.c.activeRecord.photoStates);
  h.c.putPhotoAndRecord = async () => { throw Error('quota'); };
  await h.c.storeSelectedPhoto(1, image('A'), false);
  assert.deepEqual(plain(h.c.activeRecord.photoStates), before); assert.equal(h.previews.length, 0);
  assert.equal(h.feedback.length, 1);
});
test('respostas de slots distintos em ordem inversa preservam ambas as fotos', async () => {
  const h = photoHarness(), old = deferred(); let persisted = record();
  h.c.putPhotoAndRecord = async (r, index) => {
    persisted.photoStates[index - 1] = structuredClone(r.photoStates[index - 1]);
    persisted.updatedAt = '2026-10-06T20:00:0' + index + 'Z';
    const response = { record: structuredClone(persisted) };
    return index === 1 ? old.promise.then(() => response) : response;
  };
  h.c.getRecord = async () => structuredClone(persisted);
  const first = h.c.storeSelectedPhoto(1, image('um'), false); await tick();
  await h.c.storeSelectedPhoto(2, image('dois'), false); old.resolve(); await first;
  assert.equal(h.c.activeRecord.photoStates[0].localReady, true);
  assert.equal(h.c.activeRecord.photoStates[1].localReady, true);
});
test('fotos de slots distintos mantêm o mesmo UUID e suas chaves', async () => {
  const h = photoHarness();
  await h.c.storeSelectedPhoto(1, image('um'), false); await h.c.storeSelectedPhoto(2, image('dois'), false);
  assert.deepEqual(h.writes.map(write => [write.id, write.index]), [['A', 1], ['A', 2]]);
  assert.notEqual(h.c.activePhotos.get(1).uploadKey, h.c.activePhotos.get(2).uploadKey);
});
test('exclusão local pendente não limpa slot de outro formulário', async () => {
  const h = photoHarness(), work = deferred(); h.c.activeRecord.photoStates[0] = { photoIndex: 1, localReady: true, uploadKey: 'antiga' };
  h.c.deletePhoto = () => work.promise; h.c.revokePreviewUrl = () => {};
  const task = h.c.removePhoto(1); await tick();
  const other = record('B'); other.photoStates[0] = { photoIndex: 1, localReady: true, uploadKey: 'nova' }; h.c.activeRecord = other;
  work.resolve(true); await task; assert.equal(h.c.activeRecord.photoStates[0].uploadKey, 'nova');
});
test('exclusão não apaga imagem substituída enquanto aguardava o armazenamento', async () => {
  const h = photoHarness(), work = deferred(); h.c.activeRecord.photoStates[0] = { photoIndex: 1, localReady: true, uploadKey: 'antiga' };
  const deletionKeys = []; h.c.deletePhoto = (_id, _index, key) => { deletionKeys.push(key); return work.promise; }; h.c.revokePreviewUrl = () => {};
  const task = h.c.removePhoto(1); await tick();
  h.c.activeRecord.photoStates[0] = { photoIndex: 1, localReady: true, uploadKey: 'nova' };
  work.resolve(false); await task;
  assert.deepEqual(deletionKeys, ['antiga']); assert.equal(h.c.activeRecord.photoStates[0].uploadKey, 'nova');
});
test('fallback da exclusão não limpa formulário trocado durante leitura da foto', async () => {
  const h = photoHarness(), work = deferred(); h.c.activeRecord.photoStates[0] = { photoIndex: 1, localReady: true, uploadKey: 'antiga' };
  h.c.deletePhoto = async () => false; h.c.getPhoto = () => work.promise; h.c.revokePreviewUrl = () => {};
  const task = h.c.removePhoto(1); await tick();
  const other = record('B'); other.photoStates[0] = { photoIndex: 1, localReady: true, uploadKey: 'nova' }; h.c.activeRecord = other;
  work.resolve(null); await task; assert.equal(other.photoStates[0].uploadKey, 'nova');
});
test('exclusão não renderiza formulário encerrado enquanto salvava rascunho', async () => {
  const h = photoHarness(), work = deferred(); let renders = 0;
  h.c.deletePhoto = async () => true; h.c.revokePreviewUrl = () => {}; h.c.saveActiveDraft = () => work.promise;
  h.c.updatePhotoGrid = () => renders++;
  const task = h.c.removePhoto(1); await tick(); h.c.sessionRevision++; h.c.activeRecord = null;
  work.resolve(); await task; assert.equal(renders, 0);
});
test('primeiro rascunho não acessa sessão encerrada durante gravação', async () => {
  const work = deferred(), metas = [];
  const c = { activeRecord: null, currentStep: 1, sessionRevision: 1, session: { user: 'Campo FICTÍCIO' }, Date,
    blankRecord: () => record(), putRecord: () => work.promise, setMeta: async (...args) => metas.push(args), ACTIVE_DRAFT_META: 'activeDraftId', showDraftId() {} };
  load(c, 'ensureActiveRecord', 'saveActiveDraft'); const task = c.ensureActiveRecord();
  c.sessionRevision++; c.session = null; c.activeRecord = null; work.resolve(record());
  await assert.doesNotReject(task); assert.equal(metas.length, 0);
});
test('salvar rascunho durante logout não acessa formulário encerrado', async () => {
  const work = deferred(), metas = [];
  const c = { activeRecord: record(), currentStep: 2, session: { user: 'Campo FICTÍCIO' }, sessionRevision: 1, Date,
    putRecord: () => work.promise, setMeta: async (...args) => metas.push(args), ACTIVE_DRAFT_META: 'activeDraftId', showDraftId() {} };
  c.occurrenceSubmissionRunning = false; c.activeDraftSavePromise = null; load(c, 'saveActiveDraft'); const task = c.saveActiveDraft(); c.sessionRevision++; c.session = null; c.activeRecord = null;
  work.resolve(record()); await assert.doesNotReject(task); assert.equal(metas.length, 0);
});
test('sincronização offline não sobrescreve edição posterior de outra aba', async () => {
  const original = record(); original.status = core.RECORD_STATUS.PENDING;
  let latest = { ...record(), observation: 'edição mais recente', updatedAt: '2026-10-06T20:00:01Z' }, reads = 0;
  const c = { ...core, session: { role: 'field', user: 'Campo FICTÍCIO', token: 'FICTÍCIO' }, sessionRevision: 1,
    getRecord: async () => structuredClone(++reads === 1 ? original : latest), navigator: { onLine: false },
    putRecord: async (r, options = {}) => {
      if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== latest.updatedAt) {
        const error = Error('versão local mudou'); error.code = 'LOCAL_RECORD_CHANGED'; throw error;
      }
      latest = structuredClone(r); return latest;
    }, updateQueueUi: async () => {}, toast() {}, console: { warn() {} } };
  load(c, 'performSyncSingleRecord'); await c.performSyncSingleRecord('A', false);
  assert.equal(latest.observation, 'edição mais recente');
});
const previousWorkerUrl = 'https://app.test/ocorrencias-bq/service-worker.js?v=' + core.APP_VERSION.replace(/\d+$/, revision => Number(revision) - 1);
for (const [name, controllerUrl, expectedUrl] of [
  ['atualização mantém URL do controlador e não reinstala a mesma release', previousWorkerUrl, previousWorkerUrl],
  ['primeira instalação usa versão atual', '', 'https://app.test/ocorrencias-bq/service-worker.js?v=' + core.APP_VERSION],
  ['controlador de outro aplicativo não é reutilizado', 'https://app.test/outro/service-worker.js?v=antiga', 'https://app.test/ocorrencias-bq/service-worker.js?v=' + core.APP_VERSION]
]) {
  test('PWA: ' + name, async () => {
    const registrations = [];
    const c = { APP_VERSION: core.APP_VERSION, URL, location: { href: 'https://app.test/ocorrencias-bq/' },
      navigator: { serviceWorker: { controller: controllerUrl ? { scriptURL: controllerUrl } : null,
        register: async url => { registrations.push(new URL(String(url), 'https://app.test/ocorrencias-bq/').href); return { waiting: null, addEventListener() {}, update: async () => {} }; },
        addEventListener() {} } }, console: { warn() {} } };
    load(c, 'setupServiceWorker'); await c.setupServiceWorker(); assert.deepEqual(registrations, [expectedUrl]);
  });
}

let passed = 0;
const failures = [];
for (const { name, run } of tests) {
  try { await run(); passed++; }
  catch (error) { failures.push({ name, error: error.message }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, skipped: 0, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
