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
const catalog = [
  { codigoMaterial: '0210282', textoBreve: 'TRAFO 3F 30,0KVA 15,0KV AVARIADO', unidade: 'UN' },
  { code: '0210282', description: 'TRAFO 3F 30,0KVA 15,0KV AVARIADO', unit: 'UN' },
  { code: '0210376', description: 'TRAFO 3F 30KVA 13,8KV 380/220V 5T MI', unit: 'UN' },
  { code: '0300001', description: 'CABO COBRE ISOLADO 35 MM', unit: 'M' },
  { code: '0400001', description: 'ÓLEO ISOLANTE', unit: 'KG' }
];
const validRecord = {
  base: 'MOSSORÓ', team: 'LM 04', crewLeader: 'Anderson', occurrenceNumber: '2026 09 00001',
  occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE'], pgPostRemoved: 'o14520', pgPostInstalled: 'u58745',
  services: [{ catalogKey: 'servico', code: 'SDEVU4024II', quantity: 1 }],
  photos: ['1', '2', '3', '', '']
};

test('deduplica por código + descrição + unidade', () => assert.equal(core.dedupeMaterialCatalog(catalog).length, 4));
test('busca pelo código completo', () => assert.equal(core.searchMaterialCatalog(catalog, '0210282')[0].code, '0210282'));
test('busca por parte do código', () => assert.equal(core.searchMaterialCatalog(catalog, '10376')[0].code, '0210376'));
test('busca descrição por todas as palavras', () => assert.deepEqual(core.searchMaterialCatalog(catalog, 'trafo 30').map((item) => item.code), ['0210282', '0210376']));
test('busca ignora caixa, acentos e espaços excedentes', () => assert.equal(core.searchMaterialCatalog(catalog, '  oleo   isolante ').length, 1));
test('busca CABO encontra material correspondente', () => assert.equal(core.searchMaterialCatalog(catalog, 'cabo')[0].unit, 'M'));
test('unidade permanece exatamente como cadastrada', () => assert.equal(core.dedupeMaterialCatalog(catalog).find((item) => item.code === '0210376').unit, 'UN'));
test('quantidade UN inteira positiva é válida', () => assert.equal(core.isMaterialQuantityValid({ ...catalog[2], quantity: 2 }), true));
test('quantidade UN decimal é inválida', () => assert.equal(core.isMaterialQuantityValid({ ...catalog[2], quantity: '1,5' }), false));
test('quantidade M aceita vírgula decimal positiva', () => assert.equal(core.isMaterialQuantityValid({ ...catalog[3], quantity: '35,5' }), true));
test('quantidade KG aceita ponto decimal positivo', () => assert.equal(core.isMaterialQuantityValid({ ...catalog[4], quantity: '2.25' }), true));
test('quantidade zero é inválida', () => assert.equal(core.isMaterialQuantityValid({ ...catalog[3], quantity: 0 }), false));
test('quantidade negativa e texto são inválidos', () => {
  assert.equal(core.isMaterialQuantityValid({ ...catalog[3], quantity: -1 }), false);
  assert.equal(core.isMaterialQuantityValid({ ...catalog[3], quantity: 'dois' }), false);
});
test('materiais permanecem múltiplos e estruturados', () => {
  const result = core.normalizeMaterials([{ ...catalog[2], quantity: 2 }, { ...catalog[3], quantity: 35 }]);
  assert.equal(result.length, 2); assert.deepEqual(result.map(({ code, unit, quantity }) => ({ code, unit, quantity })), [{ code: '0210376', unit: 'UN', quantity: 2 }, { code: '0300001', unit: 'M', quantity: 35 }]);
});
test('chave idêntica impede colisão visual de duplicados', () => assert.equal(core.materialKey(catalog[0]), core.materialKey(catalog[1])));
test('registro sem material é bloqueado', () => assert.ok(core.validateOccurrence({ ...validRecord, materials: [] }).includes('Adicione pelo menos um material aplicado.')));
test('registro com QTD zero é bloqueado', () => assert.ok(core.validateOccurrence({ ...validRecord, materials: [{ ...catalog[2], quantity: 0 }] }).some((error) => error.includes('quantidade inteira positiva'))));
test('registro com dois materiais válidos é aceito', () => assert.deepEqual(core.validateOccurrence({ ...validRecord, materials: [{ ...catalog[2], quantity: 2 }, { ...catalog[3], quantity: '35,5' }] }), []));
test('serialização conserva dados estruturados no contrato legado', () => {
  const [serialized] = core.serializeMaterialsForBackend([{ ...catalog[2], quantity: 2 }]);
  assert.equal(serialized.code, '0210376'); assert.equal(serialized.catalogDescription, catalog[2].description); assert.equal(serialized.unit, 'UN');
  assert.equal(serialized.description, '[MATERIAL:0210376] TRAFO 3F 30KVA 13,8KV 380/220V 5T MI [UNIDADE:UN]');
});
test('descrição codificada reconstitui código, descrição e unidade', () => {
  const material = core.normalizeMaterial({ description: '[MATERIAL:0210376] TRAFO 3F 30KVA 13,8KV 380/220V 5T MI [UNIDADE:UN]', quantity: 2 });
  assert.deepEqual({ code: material.code, description: material.description, unit: material.unit, quantity: material.quantity }, { code: '0210376', description: catalog[2].description, unit: 'UN', quantity: 2 });
});
test('registro histórico MATERIAL + QUANTIDADE continua compatível', () => {
  const [material] = core.normalizeMaterials([{ MATERIAL: 'POSTE DE CONCRETO LEGADO', QUANTIDADE: 1 }]);
  assert.deepEqual({ code: material.code, description: material.description, unit: material.unit, quantity: material.quantity }, { code: '', description: 'POSTE DE CONCRETO LEGADO', unit: '', quantity: 1 });
  assert.deepEqual(core.validateOccurrence({ ...validRecord, materials: [material] }), []);
});

let apiSource = await read('api.js');
apiSource = apiSource.replace("from './config.js'", `from '${dataUrl("export const API_ENDPOINT='https://script.google.com/macros/s/test/exec'; export const MATERIAL_CATALOG_SOURCE={spreadsheetId:'sheet-id',sheetName:'Caderno de Obras',range:'A:C'};")}'`);
const apiModule = await import(dataUrl(apiSource));
test('carregamento JSONP usa a aba oficial e preserva código formatado', async () => {
  let requestedUrl = '';
  globalThis.document = {
    createElement: () => ({ remove() {} }),
    head: { append(script) {
      requestedUrl = script.src;
      const handler = new URL(script.src).searchParams.get('tqx').split('responseHandler:')[1];
      queueMicrotask(() => globalThis[handler]({ status: 'ok', table: { rows: [{ c: [{ v: 210282, f: '0210282' }, { v: 'TRAFO 30' }, { v: 'UN' }] }] } }));
    } }
  };
  const rows = await apiModule.loadMaterialCatalog({ timeoutMs: 100 });
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get('sheet'), 'Caderno de Obras'); assert.equal(url.searchParams.get('range'), 'A:C'); assert.equal(rows[0].code, '0210282');
});

function createFakeIndexedDb() {
  const stores = new Map();
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name) { const rows = new Map(); stores.set(name, rows); return { createIndex() {} }; },
    transaction() {
      const transaction = { oncomplete: null, onerror: null, onabort: null }; let pending = 0; let queued = false;
      const finish = () => { if (!pending && !queued) { queued = true; setTimeout(() => transaction.oncomplete?.(), 0); } };
      const request = (work) => { pending += 1; queued = false; const req = {}; queueMicrotask(() => { try { req.result = work(); req.onsuccess?.(); } catch (error) { req.error = error; req.onerror?.(); transaction.onerror?.(); } finally { pending -= 1; finish(); } }); return req; };
      transaction.objectStore = (name) => { const rows = stores.get(name); return { put(value) { return request(() => rows.set(value.key ?? value.recordId ?? value.catalogKey, structuredClone(value))); }, get(key) { return request(() => structuredClone(rows.get(key))); }, getAll() { return request(() => [...rows.values()].map((value) => structuredClone(value))); }, delete(key) { return request(() => rows.delete(key)); }, index(field) { return { getAll: (query) => request(() => [...rows.values()].filter((value) => value[field] === query).map((value) => structuredClone(value))) }; } }; }; queueMicrotask(finish); return transaction;
    }
  };
  return { open() { const req = {}; queueMicrotask(() => { req.result = database; if (!stores.size) req.onupgradeneeded?.(); req.onsuccess?.(); }); return req; } };
}

globalThis.indexedDB = createFakeIndexedDb();
globalThis.IDBKeyRange = { only: (value) => value };
let dbSource = await read('db.js');
dbSource = dbSource.replace("from './core.js'", `from '${coreUrl}'`);
const db = await import(dataUrl(dbSource));
test('catálogo deduplicado persiste no IndexedDB', async () => {
  await db.cacheMaterialCatalog(catalog); const cached = await db.getCachedMaterialCatalog(); assert.equal(cached.length, 4); assert.equal(cached.every((item) => item.origin === 'Caderno de Obras'), true);
});
test('atualização do catálogo remove item material obsoleto sem tocar serviços', async () => {
  await db.cacheCatalogResults([{ catalogKey: 'servico-1', code: 'S1', catalogText: 'SERVIÇO' }]);
  await db.cacheMaterialCatalog([catalog[2]]); const cached = await db.getCachedMaterialCatalog(); assert.deepEqual(cached.map((item) => item.code), ['0210376']); assert.equal((await db.searchCachedCatalog('SERVIÇO')).length, 1);
});
test('registro offline persiste código, descrição, unidade e quantidade', async () => {
  const record = { ...validRecord, recordId: 'offline-material', status: core.RECORD_STATUS.DRAFT, materials: [{ ...catalog[2], lineId: 'm-1', quantity: 2 }] };
  await db.putRecord(record); const stored = await db.getRecord('offline-material'); assert.deepEqual(stored.materials[0], record.materials[0]);
});

const appSource = await read('app.js');
const indexSource = await read('index.html');
test('formulário não oferece digitação livre de descrição/unidade', () => {
  assert.equal(indexSource.includes('addMaterialButton'), false); assert.equal(indexSource.includes('editAddMaterialButton'), false); assert.equal(appSource.includes('data-material-description'), false);
});
test('revisão, Minhas e Supervisor usam a tabela estruturada comum', () => {
  assert.match(appSource, /function materialTable\([\s\S]*?<th>Código<\/th><th>Descrição<\/th><th>Unidade<\/th><th>Quantidade<\/th>/);
  assert.match(appSource, /occurrenceDetails\([\s\S]*?materialTable\(record\.materials\)/);
});
test('seleção de campo e Supervisor rejeita a mesma chave de material', () => {
  assert.match(appSource, /normalizeMaterials\(activeRecord\.materials\)\.some\(\(material\) => materialKey\(material\) === key\)/);
  assert.match(appSource, /normalizeMaterials\(supervisorEditRecord\.materials\)\.find\(\(material\) => materialKey\(material\) === key\)/);
});

let passed = 0; const failures = [];
for (const item of tests) {
  try { await item.run(); passed += 1; }
  catch (error) { failures.push({ test: item.name, error: `${error.name}: ${error.message}` }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
