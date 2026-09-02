import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const read = (name) => readFile(new URL(name, root), 'utf8');
const tests = [];
const test = (name, run) => tests.push({ name, run });

const coreSource = await read('core.js');
const coreUrl = dataUrl(coreSource);
const core = await import(coreUrl);

const realPost = {
  recordId: '11111111-1111-4111-8111-111111111111',
  base: 'MOSSORÓ', team: 'EQUIPE TESTE', crewLeader: 'ENCARREGADO TESTE', occurrenceNumber: 'TESTE POSTE 3 FOTOS',
  occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE'], pgPostRemoved: 'PG-RET-TESTE', pgPostInstalled: 'PG-INS-TESTE',
  services: [{ catalogKey: 'k', code: 'SDEVU4024II', quantity: 1, referenceValue: 144.26 }],
  materials: [{ description: 'poste', quantity: 1 }], photos: ['a', 'b', 'c', '', '']
};

test('fixture POSTE com 3/5 é válida', () => assert.deepEqual(core.validateOccurrence(realPost), []));
test('fixture POSTE não tem pendência de foto', () => assert.deepEqual(core.photoIssueIndexes(realPost), []));
test('POSTE não exige foto de trafo', () => assert.equal(core.requiredPhotoDeficit(realPost), 0));
test('2/5 permanece inválido', () => assert.equal(core.requiredPhotoDeficit({ ...realPost, photos: ['a', 'b', '', '', ''] }), 1));
test('QTD 1 calcula 1x', () => assert.equal(core.occurrenceTotal([{ quantity: 1, referenceValue: 144.26 }]), 144.26));
test('QTD 2 calcula 2x', () => assert.equal(core.occurrenceTotal([{ quantity: 2, referenceValue: 144.26 }]), 288.52));
test('QTD 3 calcula 3x', () => assert.equal(core.occurrenceTotal([{ quantity: 3, referenceValue: 144.26 }]), 432.78));
test('services malformado não lança exceção', () => assert.ok(core.validateOccurrence({ ...realPost, services: {} }).length));
test('materials malformado não lança exceção', () => assert.ok(core.validateOccurrence({ ...realPost, materials: {} }).length));
test('total tolera coleção histórica malformada', () => assert.equal(core.occurrenceTotal('legado'), 0));
test('tipos ausentes não lançam exceção', () => assert.equal(core.requiredPhotoDeficit({ ...realPost, occurrenceTypes: undefined }), 0));
test('tipos objeto não lançam exceção', () => assert.deepEqual(core.photoIssueIndexes({ ...realPost, occurrenceTypes: {} }), []));
test('tipos históricos separados por pipe são preservados', () => assert.deepEqual(core.normalizeOccurrenceTypes('SUBSTITUIÇÃO DE POSTE | PODA'), ['SUBSTITUIÇÃO DE POSTE', 'PODA']));
test('photos string não é contado como cinco evidências', () => {
  const record = core.normalizeOccurrenceRecord({ ...realPost, photos: 'https://foto' }); assert.deepEqual(record.photos, []); assert.ok(core.photoIssueIndexes(record).length);
});
test('OUTRO exige tipo avulso', () => assert.ok(core.validateOccurrence({ ...realPost, occurrenceTypes: ['OUTRO'], otherOccurrenceType: '' }).includes('Informe o tipo da ocorrência.')));
test('OUTRO preenchido é aceito', () => assert.equal(core.validateOccurrence({ ...realPost, occurrenceTypes: ['OUTRO'], otherOccurrenceType: 'AVULSO' }).includes('Informe o tipo da ocorrência.'), false));
test('CONDUTOR exige PG inicial', () => assert.ok(core.validateOccurrence({ ...realPost, occurrenceTypes: ['SUBSTITUIÇÃO DE CONDUTOR'], pgConductorStart: '', pgConductorEnd: 'F' }).some((item) => item.includes('PG inicial'))));
test('CONDUTOR exige PG final', () => assert.ok(core.validateOccurrence({ ...realPost, occurrenceTypes: ['SUBSTITUIÇÃO DE CONDUTOR'], pgConductorStart: 'I', pgConductorEnd: '' }).some((item) => item.includes('PG final'))));
test('TRAFO exige evidências específicas', () => assert.ok(core.validateOccurrence({ ...realPost, occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '999999', removedCia: '1', removedBto: '1', newCode: '2', newCia: '2', newBto: '2' } }).some((item) => item.includes('evidência'))));
test('999999 continua aceito somente no trafo retirado', () => assert.equal(core.validateOccurrence({ ...realPost, occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '999999', removedCia: '1', removedBto: '1', newCode: '2', newCia: '2', newBto: '2' }, transformerPhotos: { removed: 'r', installed: 'i' } }).some((item) => item.includes('código do trafo retirado')), false));
test('999999 continua inválido no trafo novo', () => assert.ok(core.validateOccurrence({ ...realPost, occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '1', removedCia: '1', removedBto: '1', newCode: '999999', newCia: '2', newBto: '2' }, transformerPhotos: { removed: 'r', installed: 'i' } }).some((item) => item.includes('trafo novo'))));

for (const [value, expected] of [
  [undefined, []], [null, []], ['', []], [[], []], [[1, 2], [1, 2]], ['1,2', [1, 2]], ['[1,2]', [1, 2]], [2, [2]], [{}, []]
]) test(`failedIndexes normaliza ${String(value)}`, () => assert.deepEqual(core.normalizeFailedIndexes(value), expected));

test('correção do supervisor tolera coleções malformadas', () => assert.doesNotThrow(() => core.supervisorCorrectionChanges({ services: {}, materials: 'x' }, { services: [], materials: [] })));
test('correção do supervisor ignora item nulo em serviços históricos', () => {
  assert.doesNotThrow(() => core.supervisorCorrectionChanges({ services: [null, { code: 'S1' }] }, { services: [] }));
});
test('reconciliação tolera photoStates malformado', () => assert.doesNotThrow(() => core.reconcilePhotoStates(realPost, { photoStates: 'x' })));
test('reconciliação parcial preserva foto confirmada', () => {
  const result = core.reconcilePhotoStates({ photoStates: [{ photoIndex: 1, confirmed: true, serverUrl: 'a' }] }, { photoStates: [{ photoIndex: 2, confirmed: true, url: 'b' }] });
  assert.equal(result.photoStates[0].confirmed, true); assert.equal(result.photoStates[1].confirmed, true);
});
test('merge usa photoStates do servidor quando o local está vazio', () => {
  const [record] = core.mergeRecordCollections([{ recordId: '1', photoStates: [] }], [{ recordId: '1', photoStates: [{ confirmed: true }] }]);
  assert.equal(record.photoStates.length, 1);
});
test('merge preserva coleções locais quando resposta histórica as omite', () => {
  const [record] = core.mergeRecordCollections([{ ...realPost, recordId: '1' }], [{ recordId: '1', status: 'PUBLICADA' }]); assert.equal(record.services.length, 1); assert.equal(record.materials.length, 1); assert.equal(record.photos.length, 5);
});
test('contagem usa URLs quando photoStates está vazio', () => assert.equal(core.countConfirmedPhotos({ photoStates: [], photos: ['a', 'b', 'c'] }), 3));
test('fila tolera records malformado', () => assert.deepEqual(core.summarizeQueue('x').pendingRecords, []));
test('fila conta fotos locais que ainda precisam de upload', () => {
  const record = {
    status: core.RECORD_STATUS.PENDING,
    photoStates: [1, 2, 3].map((photoIndex) => ({ photoIndex, localReady: true, confirmed: false }))
  };
  assert.equal(core.summarizeQueue([record]).pendingPhotos, 3);
  assert.equal(core.summarizeQueue([{ ...record, status: core.RECORD_STATUS.SYNCING_PHOTOS }]).syncingPhotos, 3);
});
test('fila não conta foto já confirmada sem substituição', () => {
  const record = {
    status: core.RECORD_STATUS.PENDING,
    photoStates: [{ photoIndex: 1, localReady: false, confirmed: true, serverUrl: 'ok' }]
  };
  assert.equal(core.summarizeQueue([record]).pendingPhotos, 0);
});

let apiSource = await read('api.js');
apiSource = apiSource.replace("from './config.js'", `from '${dataUrl("export const API_ENDPOINT='https://script.google.com/macros/s/test/exec'; export const MATERIAL_CATALOG_SOURCE={spreadsheetId:'test',sheetName:'Caderno de Obras',range:'A:C'};")}'`);
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const apiModule = await import(dataUrl(apiSource));
const response = (text, { ok = true, status = 200 } = {}) => ({ ok, status, text: async () => text });
test('API aceita JSON objeto válido', async () => assert.deepEqual(await apiModule.parseResponse(response('{"ok":true,"value":1}')), { ok: true, value: 1 }));
test('API rejeita HTML inesperado', async () => assert.rejects(() => apiModule.parseResponse(response('<html>erro</html>')), (error) => error.code === 'INVALID_SERVER_RESPONSE'));
test('API rejeita JSON null', async () => assert.rejects(() => apiModule.parseResponse(response('null')), (error) => error.code === 'INVALID_SERVER_RESPONSE'));
test('API rejeita JSON array', async () => assert.rejects(() => apiModule.parseResponse(response('[]')), (error) => error.code === 'INVALID_SERVER_RESPONSE'));
test('API preserva erro ok:false', async () => assert.rejects(() => apiModule.parseResponse(response('{"ok":false,"error":"X","message":"falha"}')), (error) => error.code === 'X'));
test('API converte timeout em erro recuperável', async () => {
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { const error = new Error('abort'); error.name = 'AbortError'; reject(error); }));
  await assert.rejects(() => apiModule.apiRequest('test', {}, { timeoutMs: 5 }), (error) => error.code === 'TIMEOUT');
});
test('API converte falha de rede online', async () => {
  globalThis.navigator.onLine = true; globalThis.fetch = async () => { throw new Error('network'); };
  await assert.rejects(() => apiModule.apiRequest('test'), (error) => error.code === 'NETWORK_ERROR');
});
test('API converte falha de rede offline', async () => {
  globalThis.navigator.onLine = false; globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(() => apiModule.apiRequest('test'), (error) => error.code === 'NETWORK_ERROR' && error.message.includes('mantido'));
  globalThis.navigator.onLine = true;
});
test('API envia POST text/plain com action', async () => {
  let request; globalThis.fetch = async (url, options) => { request = { url, options }; return response('{"ok":true}'); };
  await apiModule.apiRequest('listMine', { token: 't' }); assert.equal(request.options.method, 'POST'); assert.equal(request.options.headers['Content-Type'], 'text/plain;charset=utf-8'); assert.deepEqual(JSON.parse(request.options.body), { action: 'listMine', token: 't' });
});

function createFakeIndexedDb() {
  const stores = new Map();
  let openCount = 0;
  let closeCount = 0;
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    close() { closeCount += 1; },
    createObjectStore(name) {
      const rows = new Map(); stores.set(name, rows);
      return { createIndex() {} };
    },
    transaction(names) {
      const transaction = { oncomplete: null, onerror: null, onabort: null };
      let pending = 0; let completionQueued = false;
      const finish = () => { if (!pending && !completionQueued) { completionQueued = true; setTimeout(() => transaction.oncomplete?.(), 0); } };
      const request = (work) => {
        pending += 1; const req = {};
        queueMicrotask(() => { try { req.result = work(); req.onsuccess?.(); } catch (error) { req.error = error; req.onerror?.(); transaction.onerror?.(); } finally { pending -= 1; finish(); } });
        return req;
      };
      const store = (name) => {
        const rows = stores.get(name);
        return {
          put(value) { request(() => rows.set(value.key ?? value.recordId, structuredClone(value))); },
          get(key) { return request(() => structuredClone(rows.get(key))); },
          getAll() { return request(() => [...rows.values()].map((value) => structuredClone(value))); },
          delete(key) { request(() => rows.delete(key)); },
          index(field) { return { getAll: (query) => request(() => [...rows.values()].filter((value) => value[field] === query).map((value) => structuredClone(value))) }; }
        };
      };
      transaction.objectStore = store; queueMicrotask(finish); return transaction;
    }
  };
  return {
    open() {
      openCount += 1;
      const req = {};
      queueMicrotask(() => { req.result = database; if (!stores.size) req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
    stats: () => ({ openCount, closeCount }),
    database
  };
}

const fakeIndexedDb = createFakeIndexedDb();
globalThis.indexedDB = fakeIndexedDb;
globalThis.IDBKeyRange = { only: (value) => value };
let dbSource = await read('db.js');
dbSource = dbSource.replace("from './core.js'", `from '${coreUrl}'`);
const db = await import(dataUrl(dbSource));
const storedRecord = { ...realPost, status: core.RECORD_STATUS.PENDING, user: 'Alice', otherOccurrenceType: '', pgConductorStart: '', pgConductorEnd: '', transformer: {}, photoStates: [{ photoIndex: 1, localReady: true, uploadKey: 'up-1' }] };
test('IndexedDB abre o banco oficial', async () => assert.equal((await db.openDatabase()).objectStoreNames.contains('records'), true));
test('IndexedDB reabre conexão após mudança de versão', async () => {
  const first = await db.openDatabase(); first.onversionchange(); await db.openDatabase();
  assert.deepEqual(fakeIndexedDb.stats(), { openCount: 2, closeCount: 1 });
});
test('IndexedDB grava registro e blob atomicamente', async () => {
  await db.putPhotoAndRecord(storedRecord, 1, new Blob(['foto'], { type: 'image/jpeg' }), 'up-1');
  assert.equal((await db.getRecord(storedRecord.recordId)).base, 'MOSSORÓ'); assert.equal((await db.getPhoto(storedRecord.recordId, 1)).uploadKey, 'up-1');
});
test('foto persiste como Blob após nova leitura', async () => assert.equal((await db.getPhoto(storedRecord.recordId, 1)).blob instanceof Blob, true));
test('campos atuais persistem no registro local', async () => {
  const record = await db.getRecord(storedRecord.recordId);
  for (const field of ['base', 'team', 'crewLeader', 'occurrenceTypes', 'pgPostRemoved', 'pgPostInstalled', 'services', 'materials', 'photoStates']) assert.ok(field in record);
});
test('retry sobrescreve o mesmo UUID em vez de duplicar', async () => {
  await db.putRecord({ ...storedRecord, attempts: 2 }); const matches = (await db.getAllRecords()).filter((item) => item.recordId === storedRecord.recordId); assert.equal(matches.length, 1);
});
test('fila é isolada por usuário autenticado', async () => {
  await db.putRecord({ ...storedRecord, recordId: 'bob-record', user: 'Bob' });
  const summary = await db.getQueueSummary('Alice'); assert.equal(summary.pendingRecords.some((item) => item.user === 'Bob'), false); assert.equal(summary.pendingRecords.some((item) => item.user === 'Alice'), true);
});
test('fila sem sessão não expõe registros', async () => assert.equal((await db.getQueueSummary('')).pendingRecords.length, 0));
test('exclusão de foto não remove o registro', async () => { await db.deletePhoto(storedRecord.recordId, 1); assert.equal(await db.getPhoto(storedRecord.recordId, 1), undefined); assert.ok(await db.getRecord(storedRecord.recordId)); });
test('IndexedDB permite nova tentativa depois de abertura bloqueada', async () => {
  let attempts = 0;
  const database = { objectStoreNames: { contains: () => true }, close() {} };
  globalThis.indexedDB = { open() { attempts += 1; const request = {}; queueMicrotask(() => { if (attempts === 1) request.onblocked?.(); else { request.result = database; request.onsuccess?.(); } }); return request; } };
  const isolated = await import(dataUrl(`${dbSource}\n// blocked-retry`));
  await assert.rejects(() => isolated.openDatabase()); await isolated.openDatabase(); assert.equal(attempts, 2);
  globalThis.indexedDB = fakeIndexedDb;
});
test('IndexedDB fecha conexão tardia de uma abertura já bloqueada', async () => {
  let closeCount = 0; let firstRequest;
  const lateDatabase = { objectStoreNames: { contains: () => true }, close() { closeCount += 1; } };
  globalThis.indexedDB = { open() { const request = {}; firstRequest ||= request; return request; } };
  const isolated = await import(dataUrl(`${dbSource}\n// blocked-late-success`));
  const pending = isolated.openDatabase(); firstRequest.onblocked(); await assert.rejects(() => pending);
  firstRequest.result = lateDatabase; firstRequest.onsuccess(); assert.equal(closeCount, 1);
  globalThis.indexedDB = fakeIndexedDb;
});

function fakeElement() {
  const listeners = new Map();
  const element = {
    hidden: false, disabled: false, checked: false, indeterminate: false, value: '', returnValue: '', textContent: '', innerHTML: '', dataset: {}, style: {}, open: false, className: '',
    classList: { add() {}, remove() {}, toggle() {} }, append() {}, remove() {}, focus() {}, scrollIntoView() {}, querySelector() { return null; }, querySelectorAll() { return this.queryResults || []; },
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    dispatchEvent(event) { for (const handler of [...(listeners.get(event.type) || [])]) handler.call(this, event); },
    showModal() { if (this.open) { const error = new Error('The dialog is already open.'); error.name = 'InvalidStateError'; throw error; } this.open = true; },
    close(value) { if (value !== undefined) this.returnValue = value; if (!this.open) return; this.open = false; this.dispatchEvent({ type: 'close', target: this }); }
  };
  return element;
}

async function loadAppHarness() {
  const dbStub = dataUrl(`
    export const cacheCatalogResults=async()=>{}; export const cacheMaterialCatalog=async()=>{}; export const deletePhoto=async(recordId,index)=>{globalThis.__deletedPhotos?.push([recordId,index])}; export const deleteRecord=async()=>{};
    export const getAllRecords=async()=>globalThis.__dbRecords||[]; export const getCachedMaterialCatalog=async()=>[]; export const getMeta=async()=>null;
    export const getPhoto=async(recordId,index)=>globalThis.__photos?.get(index)||null; export const getPhotosForRecord=async()=>[];
    export const getQueueSummary=async()=>({pendingRecords:[],pendingPhotos:0,syncingPhotos:0,errors:0});
    export const getRecord=async()=>globalThis.__dbRecord||null; export const openDatabase=async()=>{};
    export const putPhotoAndRecord=async record=>({record,photo:{}}); export const putRecord=async record=>globalThis.__putRecord?globalThis.__putRecord(record):record;
    export const searchCachedCatalog=async()=>[]; export const setMeta=async()=>{};
  `);
  const apiStub = dataUrl(`
    export class ApiError extends Error { constructor(message,code='API_ERROR'){super(message);this.code=code;} }
    const call=(name,...args)=>globalThis.__apiHandlers?.[name]?.(...args);
    export const api=new Proxy({}, {get:(_,name)=>(...args)=>call(name,...args)});
    export const blobToDataUrl=async()=> 'data:image/jpeg;base64,AA=='; export const endpointConfigured=()=>true; export const healthCheck=async()=>({version:'test',timestamp:new Date().toISOString()}); export const loadMaterialCatalog=async()=>[];
  `);
  let source = await read('app.js');
  source = source.replace("from './core.js'", `from '${coreUrl}'`).replace("from './db.js'", `from '${dbStub}'`).replace("from './api.js'", `from '${apiStub}'`);
  source = source.replace(/\ninitialize\(\)\.catch\([\s\S]*?\);\s*$/, '\n');
  source += `
    export function __set(v={}){if('session'in v)session=v.session;if('activeRecord'in v)activeRecord=v.activeRecord;if('mineRecords'in v)mineRecords=v.mineRecords;if('supervisorRecords'in v)supervisorRecords=v.supervisorRecords;if('selectedIds'in v)selectedSupervisorIds=new Set(v.selectedIds);if('activeSupervisorRecord'in v)activeSupervisorRecord=v.activeSupervisorRecord;if('supervisorEditRecord'in v)supervisorEditRecord=v.supervisorEditRecord;supervisorPhotoFailures.clear()}
    export function __get(){return{session,activeRecord,mineRecords,supervisorRecords,selectedIds:[...selectedSupervisorIds],activeSupervisorRecord,supervisorEditRecord}}
    export{logout,persistSession,refreshSupervisor,refreshMine,handlePhotoLoadError,friendlyError,performSyncSingleRecord,confirmAction,collectDecision,decideSupervisor,occurrenceDetails,renderSupervisorList,submitOccurrence,updateSupervisorReviewActions,ApiError as __ApiError};
  `;
  const elements = new Map();
  globalThis.document = { visibilityState: 'visible', querySelector(selector) { if (!elements.has(selector)) elements.set(selector, fakeElement()); return elements.get(selector); }, querySelectorAll() { return []; }, addEventListener() {}, createElement: fakeElement, body: fakeElement() };
  globalThis.window = { addEventListener() {}, scrollTo() {} };
  const storage = new Map(); globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
  return import(dataUrl(source));
}

const app = await loadAppHarness();
function prepareSubmissionRecord() {
  const record = { ...structuredClone(realPost), status: core.RECORD_STATUS.DRAFT, user: 'Alice', photoStates: [] };
  document.querySelector('#operationBase').value = record.base; document.querySelector('#team').value = record.team; document.querySelector('#crewLeader').value = record.crewLeader;
  document.querySelector('#occurrenceNumber').value = record.occurrenceNumber; document.querySelector('#pgPostRemoved').value = record.pgPostRemoved; document.querySelector('#pgPostInstalled').value = record.pgPostInstalled;
  document.querySelector('#occurrenceTypes').queryResults = [{ value: 'SUBSTITUIÇÃO DE POSTE', checked: true }];
  app.__set({ session: { token: 'alice', user: 'Alice', role: 'field' }, activeRecord: record }); globalThis.__dbRecord = record;
  return record;
}
test('logout limpa estado dos dois perfis', () => {
  app.__set({ session: { token: 'a', user: 'A', role: 'field' }, activeRecord: { recordId: 'A' }, mineRecords: [{ recordId: 'A' }], supervisorRecords: [{ recordId: 'S' }], selectedIds: ['S'], activeSupervisorRecord: { recordId: 'S' }, supervisorEditRecord: { recordId: 'S' } });
  app.logout(); const state = app.__get(); assert.equal(state.activeRecord, null); assert.deepEqual(state.mineRecords, []); assert.deepEqual(state.supervisorRecords, []); assert.deepEqual(state.selectedIds, []); assert.equal(state.activeSupervisorRecord, null); assert.equal(state.supervisorEditRecord, null);
});
test('falha de foto remove seleção inválida do Supervisor', () => {
  const record = { recordId: 'S', status: core.RECORD_STATUS.WAITING_SUPERVISOR, occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE'], photos: ['a', 'b', 'c', '', ''] };
  app.__set({ session: { token: 's', user: 'Sup', role: 'supervisor' }, supervisorRecords: [record], selectedIds: ['S'] });
  const image = { dataset: { fallbackSrc: '', fallbackAttempted: '1' }, src: 'bad', alt: 'Foto 1', classList: { add() {} }, removeAttribute() {}, closest(selector) { if (selector === 'img[data-fallback-src]') return this; if (selector === '#reviewDialog, #supervisorList') return {}; if (selector === '[data-photo-index]') return { dataset: { photoIndex: '1' } }; if (selector === '[data-record-photo-id]') return { dataset: { recordPhotoId: 'S' } }; return null; } };
  app.handlePhotoLoadError({ target: image }); assert.deepEqual(app.__get().selectedIds, []);
});
test('resposta Supervisor de sessão antiga é descartada', async () => {
  let resolveList; globalThis.__apiHandlers = { listPending: () => new Promise((resolve) => { resolveList = resolve; }) };
  app.__set({ session: { token: 'old', user: 'Old', role: 'supervisor' }, supervisorRecords: [] }); const pending = app.refreshSupervisor(false); await Promise.resolve();
  app.persistSession({ token: 'new', user: 'New', role: 'field' }); resolveList({ records: [{ recordId: 'OLD', status: core.RECORD_STATUS.WAITING_SUPERVISOR }] }); await pending; assert.deepEqual(app.__get().supervisorRecords, []);
});
test('refresh Supervisor simultâneo reutiliza uma chamada', async () => {
  let calls = 0; let resolveList; globalThis.__apiHandlers = { listPending: () => { calls += 1; return new Promise((resolve) => { resolveList = resolve; }); } };
  app.persistSession({ token: 'same', user: 'Sup', role: 'supervisor' }); const first = app.refreshSupervisor(false); const second = app.refreshSupervisor(false); await Promise.resolve(); assert.equal(calls, 1); resolveList({ records: [] }); await Promise.all([first, second]);
});
test('resposta Minhas de sessão antiga é descartada', async () => {
  let resolveMine; globalThis.__apiHandlers = { listMine: () => new Promise((resolve) => { resolveMine = resolve; }) };
  app.__set({ session: { token: 'old-field', user: 'Old', role: 'field' }, mineRecords: [] }); const pending = app.refreshMine(false); await Promise.resolve(); app.persistSession({ token: 'new-field', user: 'New', role: 'field' }); resolveMine({ records: [{ recordId: 'OLD', user: 'Old' }] }); await pending; assert.deepEqual(app.__get().mineRecords, []);
});
test('erro técnico recebe mensagem amigável', () => assert.equal(app.friendlyError(new TypeError('items.map is not a function')), 'Ocorreu um erro inesperado.'));
test('erro técnico vindo da API não é exibido cru', () => {
  assert.equal(app.friendlyError(new app.__ApiError('TypeError: failedIndexes.map is not a function')), 'Ocorreu um erro inesperado.');
});
test('tratamento de foto não envia error.message diretamente ao usuário', async () => {
  const source = await read('app.js');
  assert.doesNotMatch(source, /catch \(error\) \{ toast\(error\.message \|\| 'Não foi possível preparar a foto\.'/);
  assert.match(source, /catch \(error\) \{ toast\(friendlyError\(error\), 'error'\); \}/);
});
test('duas confirmações simultâneas não reabrem o mesmo dialog', async () => {
  const dialog = document.querySelector('#confirmDialog');
  const first = app.confirmAction('Primeira', 'Primeira ação');
  let second; let error = null;
  try { second = app.confirmAction('Segunda', 'Segunda ação'); } catch (caught) { error = caught; }
  dialog.close('cancel');
  await first;
  if (second) await second;
  assert.equal(error, null);
  assert.equal(await second, false);
});
test('fechar confirmação por Escape não reutiliza confirmação anterior', async () => {
  const dialog = document.querySelector('#confirmDialog');
  dialog.returnValue = 'confirm';
  const pending = app.confirmAction('Teste', 'Cancelar pelo teclado');
  dialog.close();
  assert.equal(await pending, false);
});
test('fechar decisão por Escape não reutiliza confirmação anterior', async () => {
  const dialog = document.querySelector('#decisionDialog'); dialog.returnValue = 'default';
  const pending = app.collectDecision('reject'); document.querySelector('#decisionReason').value = 'Motivo digitado'; dialog.close();
  assert.equal(await pending, null);
});
test('Supervisor deriva contagem de fotos em registro histórico', () => {
  const record = { recordId: 'S-history', occurrenceNumber: 'HISTORY', status: core.RECORD_STATUS.WAITING_SUPERVISOR, occurrenceTypes: ['PODA'], photos: ['a', 'b', 'c'] };
  app.__set({ supervisorRecords: [record], selectedIds: [] }); app.renderSupervisorList();
  assert.match(document.querySelector('#supervisorList').innerHTML, />3\/5 fotos gerais</); assert.doesNotMatch(document.querySelector('#supervisorList').innerHTML, /undefined\/5/);
});
test('detalhe histórico ignora entradas nulas de auditoria', () => {
  const record = { ...realPost, audit: { supervisorCorrections: [null, { supervisor: 'Sup', correctedAt: '2026-09-02T10:00:00Z', changes: [null, { field: 'Equipe', previousValue: 'A', newValue: 'B' }] }] } };
  assert.doesNotThrow(() => app.occurrenceDetails(record)); assert.match(app.occurrenceDetails(record), /Corrigido pelo supervisor/);
});
test('envio não aceita uma segunda submissão durante persistência local', async () => {
  prepareSubmissionRecord(); globalThis.navigator.onLine = false;
  let writes = 0; let releaseWrite;
  globalThis.__putRecord = (record) => { writes += 1; if (writes === 1) return new Promise((resolve) => { releaseWrite = () => resolve(record); }); return Promise.resolve(record); };
  const first = app.submitOccurrence(); document.querySelector('#confirmDialog').close('confirm'); await Promise.resolve(); await Promise.resolve();
  const second = app.submitOccurrence(); await Promise.resolve(); const reopened = document.querySelector('#confirmDialog').open;
  if (reopened) document.querySelector('#confirmDialog').close('cancel'); releaseWrite?.(); await Promise.all([first, second]);
  delete globalThis.__putRecord; globalThis.navigator.onLine = true; assert.equal(reopened, false);
});
test('falha ao persistir envio mantém a ocorrência no formulário', async () => {
  const record = prepareSubmissionRecord(); globalThis.__putRecord = async () => { throw new Error('quota'); };
  const pending = app.submitOccurrence(); document.querySelector('#confirmDialog').close('confirm'); await pending;
  assert.equal(app.__get().activeRecord?.recordId, record.recordId); delete globalThis.__putRecord;
});
test('decisão do Supervisor não aceita uma segunda mutação concorrente', async () => {
  const record = { recordId: 'S-lock', occurrenceNumber: 'LOCK', status: core.RECORD_STATUS.WAITING_SUPERVISOR, occurrenceTypes: ['PODA'], photos: ['a', 'b', 'c'] };
  let calls = 0; let resolveAction;
  globalThis.__apiHandlers = {
    supervisorAction: () => { calls += 1; return new Promise((resolve) => { resolveAction = resolve; }); },
    listPending: async () => ({ records: [] })
  };
  app.__set({ session: { token: 's', user: 'Sup', role: 'supervisor' }, supervisorRecords: [record], activeSupervisorRecord: record });
  const confirm = document.querySelector('#confirmDialog');
  const first = app.decideSupervisor('approve');
  confirm.close('confirm');
  await Promise.resolve(); await Promise.resolve();
  const second = app.decideSupervisor('approve');
  await Promise.resolve();
  const reopened = confirm.open;
  if (reopened) confirm.close('cancel');
  resolveAction?.({ ok: true });
  await Promise.all([first, second]);
  assert.equal(reopened, false);
  assert.equal(calls, 1);
});
test('falha ao solicitar correção não reabilita aprovação com foto inválida', async () => {
  const record = { recordId: 'S-photo', occurrenceNumber: 'PHOTO', status: core.RECORD_STATUS.WAITING_SUPERVISOR, occurrenceTypes: ['PODA'], photos: ['a', 'b', 'c'] };
  app.__set({ session: { token: 's', user: 'Sup', role: 'supervisor' }, supervisorRecords: [record], activeSupervisorRecord: record });
  const image = { dataset: { fallbackSrc: '', fallbackAttempted: '1' }, src: 'bad', alt: 'Foto 1', classList: { add() {} }, removeAttribute() {}, closest(selector) { if (selector === 'img[data-fallback-src]') return this; if (selector === '#reviewDialog, #supervisorList') return {}; if (selector === '[data-photo-index]') return { dataset: { photoIndex: '1' } }; if (selector === '[data-record-photo-id]') return { dataset: { recordPhotoId: 'S-photo' } }; return null; } };
  app.handlePhotoLoadError({ target: image }); app.updateSupervisorReviewActions();
  assert.equal(document.querySelector('#approveButton').disabled, true);
  globalThis.__apiHandlers = { supervisorAction: async () => { throw new app.__ApiError('Falha temporária', 'NETWORK_ERROR'); } };
  const pending = app.decideSupervisor('request_correction');
  document.querySelector('#decisionReason').value = 'Foto indisponível';
  document.querySelector('#decisionDialog').close('default');
  await Promise.resolve(); await Promise.resolve();
  document.querySelector('#confirmDialog').close('confirm');
  await pending;
  assert.equal(document.querySelector('#approveButton').disabled, true);
});
test('registro de outro usuário não é sincronizado', async () => {
  let submits = 0; globalThis.__dbRecord = { ...storedRecord, recordId: 'alice-only', user: 'Alice' }; globalThis.__apiHandlers = { submitRecord: async () => { submits += 1; } }; app.__set({ session: { token: 'bob', user: 'Bob', role: 'field' } }); await app.performSyncSingleRecord('alice-only', false); assert.equal(submits, 0);
});
test('blob local ausente sai de SINCRONIZANDO para ERRO', async () => {
  globalThis.__photos = new Map(); globalThis.__dbRecord = { ...storedRecord, recordId: 'missing-photo', user: 'Alice', photoStates: [{ photoIndex: 1, localReady: true, uploadKey: 'same-key' }] };
  globalThis.__apiHandlers = { submitRecord: async () => ({ status: core.RECORD_STATUS.SYNCING_PHOTOS, photoStates: [] }), getRecordState: async () => ({ status: core.RECORD_STATUS.SYNCING_PHOTOS, photoStates: [] }) };
  app.persistSession({ token: 'alice', user: 'Alice', role: 'field' }); const result = await app.performSyncSingleRecord('missing-photo', false); assert.equal(result.status, core.RECORD_STATUS.ERROR);
});
test('retry conserva UUID e uploadKey das fotos', async () => {
  const uploadKeys = ['key-1', 'key-2', 'key-3']; globalThis.__deletedPhotos = []; globalThis.__photos = new Map(uploadKeys.map((uploadKey, offset) => [offset + 1, { recordId: 'retry-id', photoIndex: offset + 1, uploadKey, blob: new Blob(['x']), mimeType: 'image/jpeg', fileName: 'x.jpg' }]));
  globalThis.__dbRecord = { ...storedRecord, recordId: 'retry-id', user: 'Alice', photoStates: uploadKeys.map((uploadKey, offset) => ({ photoIndex: offset + 1, localReady: true, uploadKey, replacePending: true })) };
  const submitted = []; const uploaded = []; const confirmed = [];
  globalThis.__apiHandlers = {
    submitRecord: async (_token, record) => { submitted.push(record.recordId); return { status: core.RECORD_STATUS.SYNCING_PHOTOS, photoStates: [] }; },
    getRecordState: async () => ({ status: confirmed.length >= 3 ? core.RECORD_STATUS.WAITING_SUPERVISOR : core.RECORD_STATUS.SYNCING_PHOTOS, photoStates: confirmed.map((photoIndex) => ({ photoIndex, confirmed: true, url: `u${photoIndex}` })) }),
    uploadPhoto: async (_token, photo) => { uploaded.push(photo.uploadKey); confirmed.push(photo.photoIndex); return { status: core.RECORD_STATUS.SYNCING_PHOTOS, photoStates: confirmed.map((photoIndex) => ({ photoIndex, confirmed: true, url: `u${photoIndex}` })) }; }
  };
  app.persistSession({ token: 'alice', user: 'Alice', role: 'field' }); const result = await app.performSyncSingleRecord('retry-id', false); assert.deepEqual(submitted, ['retry-id']); assert.deepEqual(uploaded, uploadKeys); assert.equal(result.status, core.RECORD_STATUS.WAITING_SUPERVISOR); assert.deepEqual(globalThis.__deletedPhotos, [['retry-id', 1], ['retry-id', 2], ['retry-id', 3]]);
});

let passed = 0; const failures = [];
for (const item of tests) {
  try { await item.run(); passed += 1; }
  catch (error) { failures.push({ test: item.name, error: `${error.name}: ${error.message}` }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
