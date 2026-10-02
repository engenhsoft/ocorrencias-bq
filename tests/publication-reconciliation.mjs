import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread && !process.argv[2]) throw Error('Informe o fonte privado do backend; fixtures read-only são um argumento opcional.');
const backend = isMainThread ? await readFile(process.argv[2], 'utf8') : workerData.backend;
const tests = []; const test = (name, run) => tests.push({ name, run });
const plain = value => JSON.parse(JSON.stringify(value));
const idFor = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const UUID = idFor(1);
const service = (code = 'LEGADO', extra = {}) => ({ lineId: 'linha-' + code, code, catalogKey: 'Catálogo removido:9', catalogText: 'Descrição histórica ' + code, unit: 'M', group: 'Grupo histórico', contract: '4600080938', origin: 'Histórico', quantity: 2.125, referenceValue: 10, totalValue: 21.25, retainedAttribute: 'conservar', ...extra });
const material = (code = '000123', extra = {}) => ({ lineId: 'material-' + code, code, description: 'Material ' + code, unit: 'UN', quantity: 3, ...extra });
const fixture = (extra = {}) => {
  const record = { recordId: UUID, registeredAt: '2026-09-25T11:00:00-03:00', user: 'Equipe FICTÍCIA', base: 'CARAÚBAS', contract: '4600080938', team: 'LM FICTÍCIA', crewLeader: 'Chefe FICTÍCIO', occurrenceNumber: 'MESMO NÚMERO', occurrenceTypes: ['PODA'], transformer: {}, services: [service('A'), service('B'), service('C')], materials: [material(), material('000124')], observation: 'Preservar observação', ...extra };
  record.totalServices = record.services.reduce((sum, item) => sum + Number(item.totalValue), 0); return record;
};

// Armazenamento compartilhado somente em RAM para dois workers simultâneos.
function sharedStore(shared) {
  const meta = new Int32Array(shared.meta); const bytes = new Uint8Array(shared.data);
  function exclusive(run) {
    while (Atomics.compareExchange(meta, 1, 0, 1) !== 0) Atomics.wait(meta, 1, 1, 1000);
    try { return run(); } finally { Atomics.store(meta, 1, 0); Atomics.notify(meta, 1); }
  }
  return {
    read: name => exclusive(() => plain(JSON.parse(Buffer.from(bytes.subarray(0, Atomics.load(meta, 4))).toString())[name])),
    update: (name, mutate) => exclusive(() => {
      const data = JSON.parse(Buffer.from(bytes.subarray(0, Atomics.load(meta, 4))).toString());
      data[name] ||= [[]]; mutate(data[name]);
      const encoded = Buffer.from(JSON.stringify(data)); assert.ok(encoded.length <= bytes.length);
      bytes.set(encoded); Atomics.store(meta, 4, encoded.length);
    })
  };
}

class MemorySheet {
  constructor(name, headers, h, store) { this.name = name; this.h = h; this.localRows = [headers.slice()]; this.store = store; }
  get rows() { return this.store ? this.store.read(this.name) : this.localRows; }
  set rows(value) { if (this.store) this.store.update(this.name, rows => rows.splice(0, rows.length, ...value)); else this.localRows = value; }
  mutate(run) { if (this.store) this.store.update(this.name, run); else run(this.localRows); }
  getName() { return this.name; }
  getLastRow() { const rows = this.rows; let n = rows.length; while (n && rows[n - 1].every(v => v == null || v === '')) n--; return n; }
  getLastColumn() { return Math.max(1, ...this.rows.map(row => row.length)); }
  getMaxColumns() { return Math.max(50, this.getLastColumn()); }
  insertColumnsAfter() { throw Error('Nenhuma alteração de esquema é autorizada no harness.'); }
  getRange(row, column, height = 1, width = 1) {
    const sheet = this; const h = this.h;
    const read = () => {
      h.reads.push({ table: sheet.name, row, column, height, width }); const rows = sheet.rows;
      return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => rows[row + y - 1]?.[column + x - 1] ?? ''));
    };
    const range = {
      getRow: () => row, getValues: read, getDisplayValues: () => read().map(r => r.map(v => String(v ?? ''))),
      getDisplayValue: () => String(read()[0][0]),
      setNumberFormat: () => range,
      setValue: value => range.setValues([[value]]),
      setValues: values => {
        assert.equal(values.length, height); values.forEach(r => assert.equal(r.length, width));
        const event = { table: sheet.name, row, column, height, width, kind: 'setValues' };
        const prefixFailure = h.prefixFault && h.prefixFault.table === sheet.name && column === 1;
        const count = prefixFailure ? h.prefixFault.count : values.length;
        sheet.mutate(rows => values.slice(0, count).forEach((r, y) => { const target = rows[row + y - 1] ||= []; r.forEach((value, x) => { target[column + x - 1] = value ?? ''; }); }));
        h.wrote(event);
        if (prefixFailure) { h.prefixFault = null; throw Error('Falha depois do prefixo já persistido'); }
        return range;
      },
      createTextFinder: text => {
        let entire = false, caseSensitive = false;
        const finder = {
          matchEntireCell: v => { entire = v; return finder; }, matchCase: v => { caseSensitive = v; return finder; }, useRegularExpression: () => finder,
          findAll: () => {
            assert.equal(entire, true); assert.equal(caseSensitive, true); h.finders.push({ table: sheet.name, width, column });
            return sheet.rows.slice(row - 1, row + height - 1).flatMap((r, y) => r.slice(column - 1, column + width - 1).flatMap((v, x) => String(v) === text ? [sheet.getRange(row + y, column + x)] : []));
          }
        }; return finder;
      }
    }; return range;
  }
  appendRow(row) { const start = this.getLastRow() + 1; this.mutate(rows => { rows[start - 1] = row.slice(); }); this.h.wrote({ table: this.name, row: start, column: 1, height: 1, width: row.length, kind: 'appendRow' }); }
  deleteRow(row) {
    const event = { table: this.name, row, kind: 'deleteRow' };
    this.h.beforeDelete?.(event); this.mutate(rows => rows.splice(row - 1, 1)); this.h.wrote(event);
  }
}

function harness({ source = backend, shared = null, actor = 'Supervisor FICTÍCIO', barrier = false } = {}) {
  const h = { reads: [], writes: [], finders: [], logs: [], sheets: new Map(), lockDepth: 0, acquisitions: 0, releases: 0, seeding: true, partialFault: null };
  const store = shared && sharedStore(shared); const meta = shared && new Int32Array(shared.meta);
  h.wrote = event => { if (!h.seeding) assert.equal(h.lockDepth, 1, 'escrita deve ocorrer sob o lock de commit'); h.writes.push(event); h.afterWrite?.(event); };
  const properties = new Map();
  const c = vm.createContext({ Date, JSON, Math, Number, String, console: { log() {}, error: message => h.logs.push(message) },
    SpreadsheetApp: { openById: id => {
      assert.ok([h.meta?.APP.spreadsheetId, h.meta?.APP.transformerSpreadsheetId].includes(id));
      return { getSheetByName: name => h.sheets.get(name), insertSheet() { throw Error('Proibido criar aba'); } };
    }, flush() { h.flushHook?.(); } },
    LockService: { getScriptLock: () => ({ waitLock() {
      h.beforeLock?.();
      if (barrier) { Atomics.add(meta, 2, 1); Atomics.notify(meta, 2); while (Atomics.load(meta, 2) < 2) Atomics.wait(meta, 2, Atomics.load(meta, 2), 1000); }
      if (shared) while (Atomics.compareExchange(meta, 0, 0, 1) !== 0) Atomics.wait(meta, 0, 1, 1000);
      assert.equal(h.lockDepth, 0); h.lockDepth++; h.acquisitions++;
    }, releaseLock() { assert.equal(h.lockDepth, 1); h.lockDepth--; h.releases++; if (shared) { Atomics.store(meta, 0, 0); Atomics.notify(meta, 0); } } }) },
    CacheService: { getScriptCache: () => ({ get: () => '1', getAll: keys => Object.fromEntries(keys.map(key => [key, '1'])), put() {} }) },
    DriveApp: { getFileById() { throw Error('Operação externa de Drive proibida'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties.get(k), setProperty(k, v) { properties.set(k, v); h.propertyHook?.(k); }, deleteProperty: k => properties.delete(k) }) },
    Utilities: { formatDate(date, zone, pattern) { const local = new Date(new Date(date).getTime() - 3 * 3600000).toISOString(); return pattern === 'yyyy-MM-dd' ? local.slice(0, 10) : local.slice(0, 19) + '-03:00'; } }
  });
  vm.runInContext(source + '\nthis.meta = { APP, COL, STATUS, MAIN_HEADERS, SERVICE_HEADERS, MATERIAL_HEADERS, HISTORY_HEADERS };', c); h.c = c; h.meta = c.meta;
  const { APP } = h.meta;
  for (const [name, headers] of [[APP.pendingSheet, h.meta.MAIN_HEADERS], [APP.officialSheet, h.meta.MAIN_HEADERS], [APP.servicesSheet, h.meta.SERVICE_HEADERS], [APP.materialsSheet, h.meta.MATERIAL_HEADERS], [APP.historySheet, h.meta.HISTORY_HEADERS], [APP.catalogSheet, []], [APP.transformerSheet, ['DATA DE ENVIO', 'CIA', 'N ° DE SERIE', 'BASES', 'POTENCIA', 'TENSÃO', 'FOTO 1', 'FOTO 2', 'FOTO 3', 'CONDIÇÃO DO TRANSFORMADOR', 'TIPO DE MOVIMENTAÇÃO', 'OBSERVAÇÃO', 'CÓDIGO DO TRANSFORMADOR', 'BTO', 'Nº OCORRÊNCIA']]]) h.sheets.set(name, new MemorySheet(name, Array.from(headers), h, store));
  c.requireSession_ = () => ({ role: 'supervisor', user: actor });
  let clock = 0; c.nowIso_ = () => new Date(Date.UTC(2026, 9, 2, 15, 0, clock++)).toISOString();
  h.sheet = name => h.sheets.get(name); h.rows = name => h.sheet(name).rows.slice(1).filter(r => r[0]);
  h.seed = record => {
    const model = { pgPostRemoved: '', pgPostInstalled: '', pgConductorStart: '', pgConductorEnd: '', otherOccurrenceType: '', goalPercentage: 0, ...record };
    const audit = { pendingServices: record.services, pendingMaterials: record.materials, expectedPhotoIndexes: [1, 2, 3], originalAuditAttribute: 'conservar', timeline: [{ action: 'CRIADA', actor: record.user, at: record.registeredAt }] };
    h.seeding = true;
    h.sheet(APP.pendingSheet).appendRow(Array.from(c.buildMainRow_(model, record.user, record.registeredAt, ['https://example.test/1', 'https://example.test/2', 'https://example.test/3'], ['key1', 'key2', 'key3'], record.occurrenceTypes.includes('SUBSTITUIÇÃO DE TRAFO') ? ['https://example.test/retirado', 'https://example.test/instalado'] : [], ['tr-key1', 'tr-key2'], h.meta.STATUS.WAITING_SUPERVISOR, '', '', '', '', audit)));
    h.seeding = false; h.writes = []; return record;
  };
  h.approve = (id = UUID, note = '') => c.supervisorAction_({ token: 'somente-harness', recordId: id, decision: 'approve', note });
  h.batch = ids => c.approveBatch_({ token: 'somente-harness', recordIds: ids });
  h.plan = (id = UUID) => { const snapshot = c.preparePublicationSnapshot_(id, actor, '', []); const state = c.publicationStateForId_(snapshot.sheets, id); return { snapshot, state, expected: c.bindPublicationExpectation_(id, snapshot, state) }; };
  h.add = (name, rows) => { h.seeding = true; rows.forEach(r => h.sheet(name).appendRow(Array.from(r))); h.seeding = false; h.writes = []; };
  h.failAfter = predicate => { h.afterWrite = event => { if (predicate(event)) { h.afterWrite = null; throw Error('Falha injetada após gravação'); } }; };
  h.seeding = false; return h;
}

function assertComplete(h, record = fixture()) {
  const { APP } = h.meta; const id = record.recordId;
  const rows = name => h.rows(name).filter(r => r[0] === id);
  assert.equal(rows(APP.officialSheet).length, 1); assert.equal(rows(APP.pendingSheet).length, 0);
  assert.equal(rows(APP.servicesSheet).length, record.services.length); assert.equal(rows(APP.materialsSheet).length, record.materials.length);
  assert.equal(rows(APP.historySheet).filter(r => r[3] === 'APROVADA_E_PUBLICADA').length, 1);
  const result = h.c.verifyPublishedIntegrity_(id, { repair: false }); assert.equal(result.state, 'INTEGRITY_OK');
  assert.equal(result.finalHistoryEvents, 1); assert.equal(h.lockDepth, 0); assert.equal(h.acquisitions, h.releases);
  assert.equal(h.reads.filter(r => r.table === APP.catalogSheet).length, 0);
}
function seedPartial(h, tables) {
  h.seed(fixture()); const { expected } = h.plan(); const { APP } = h.meta;
  if (tables.official) h.add(APP.officialSheet, [expected.main]);
  if (tables.services) h.add(APP.servicesSheet, expected.services.slice(0, tables.services));
  if (tables.materials) h.add(APP.materialsSheet, expected.materials.slice(0, tables.materials));
  if (tables.history) h.add(APP.historySheet, [expected.history]);
  return expected;
}

test('publicação normal, preços históricos, evidências e UUID intactos', () => {
  const h = harness(); const record = h.seed(fixture()); const response = h.approve();
  assert.equal(response.reconciliationState, 'NOT_STARTED'); assert.deepEqual(plain(response.record.services), record.services);
  assert.equal(response.record.audit.originalAuditAttribute, 'conservar'); assertComplete(h, record);
});
for (const [name, state] of [['só um serviço', { services: 1 }], ['só material', { materials: 1 }], ['serviços e materiais', { services: 2, materials: 1 }], ['ocorrência final sem itens', { official: true }], ['todos itens sem histórico', { official: true, services: 3, materials: 2 }], ['histórico isolado', { history: true }]]) {
  test('subconjunto reconciliável: ' + name, () => {
    const h = harness(); seedPartial(h, state); const { snapshot, expected, state: before } = h.plan();
    assert.equal(h.c.inspectPublication_(UUID, expected, before).state, 'PARTIAL_RECONCILABLE');
    const preserved = [h.rows(h.meta.APP.servicesSheet), h.rows(h.meta.APP.materialsSheet)];
    const result = h.approve(); assert.equal(result.reconciliationState, 'PARTIAL_RECONCILABLE'); assertComplete(h);
    assert.ok(preserved[0].every(row => h.rows(h.meta.APP.servicesSheet).some(r => JSON.stringify(r) === JSON.stringify(row))));
    assert.ok(preserved[1].every(row => h.rows(h.meta.APP.materialsSheet).some(r => JSON.stringify(r) === JSON.stringify(row))));
    assert.equal(snapshot.model.recordId, UUID);
    assert.ok(h.writes.filter(x => x.kind === 'deleteRow').every(x => x.table === h.meta.APP.pendingSheet));
  });
}
test('destinos completos com pendência restante retiram a origem somente após confirmação', () => {
  const h = harness(); seedPartial(h, { official: true, services: 3, materials: 2, history: true });
  const result = h.approve(); assert.equal(result.alreadyPublished, true); assert.equal(result.reconciliationState, 'PARTIAL_RECONCILABLE'); assertComplete(h);
  assert.ok(!h.writes.some(x => [h.meta.APP.servicesSheet, h.meta.APP.materialsSheet, h.meta.APP.historySheet].includes(x.table)));
});
test('timeout após commit: retry completo retorna sucesso sem qualquer gravação', () => {
  const h = harness(); h.seed(fixture()); h.approve(); const before = plain([...h.sheets].map(([name, sheet]) => [name, sheet.rows])); h.writes = [];
  const retry = h.approve(); assert.equal(retry.idempotent, true); assert.equal(retry.alreadyPublished, true); assert.equal(retry.reconciliationState, 'COMPLETE');
  assert.equal(h.writes.length, 0); assert.deepEqual(plain([...h.sheets].map(([name, sheet]) => [name, sheet.rows])), before); assertComplete(h);
});

for (const phase of ['OCORRENCIAS', 'UM_SERVICO', 'TODOS_SERVICOS', 'UM_MATERIAL', 'MATERIAIS', 'HISTORICO', 'AUDITORIA', 'ANTES_DE_RETIRAR_PENDENTE', 'DEPOIS_DE_RETIRAR_PENDENTE']) {
  test('interrupção persistente e retomada: ' + phase, () => {
    const h = harness(); h.seed(fixture()); const { APP, COL } = h.meta;
    if (phase === 'UM_SERVICO') h.prefixFault = { table: APP.servicesSheet, count: 1 };
    else if (phase === 'UM_MATERIAL') h.prefixFault = { table: APP.materialsSheet, count: 1 };
    else if (phase === 'ANTES_DE_RETIRAR_PENDENTE') h.beforeDelete = () => { h.beforeDelete = null; throw Error('Falha antes de retirar pendente'); };
    else h.failAfter(event => phase === 'OCORRENCIAS' ? event.table === APP.officialSheet && event.column === 1 : phase === 'TODOS_SERVICOS' ? event.table === APP.servicesSheet : phase === 'MATERIAIS' ? event.table === APP.materialsSheet : phase === 'HISTORICO' ? event.table === APP.historySheet : phase === 'AUDITORIA' ? event.table === APP.officialSheet && event.column === COL.AUDIT : event.kind === 'deleteRow');
    assert.throws(() => h.approve()); assert.equal(h.lockDepth, 0); assert.equal(h.acquisitions, h.releases);
    if (phase !== 'DEPOIS_DE_RETIRAR_PENDENTE') assert.equal(h.rows(APP.pendingSheet).length, 1);
    const services = plain(h.rows(APP.servicesSheet)); const materials = plain(h.rows(APP.materialsSheet));
    assert.equal(h.approve().ok, true); assertComplete(h);
    assert.ok(services.every(row => h.rows(APP.servicesSheet).some(r => JSON.stringify(r) === JSON.stringify(row))));
    assert.ok(materials.every(row => h.rows(APP.materialsSheet).some(r => JSON.stringify(r) === JSON.stringify(row))));
  });
}
test('falha na resposta após publicação não afeta a retomada', () => {
  const h = harness(); h.seed(fixture()); const original = h.c.stateResponse_; h.c.stateResponse_ = () => { throw Error('Conexão caiu depois do commit'); };
  assert.throws(() => h.approve()); h.c.stateResponse_ = original; assertComplete(h); assert.equal(h.approve().alreadyPublished, true);
});
test('duas solicitações simultâneas, snapshots obtidos antes do lock, um único commit', async () => {
  const h = harness(); h.seed(fixture());
  const data = Object.fromEntries([...h.sheets].map(([name, sheet]) => [name, sheet.rows]));
  const shared = { meta: new SharedArrayBuffer(32), data: new SharedArrayBuffer(512000) };
  const encoded = Buffer.from(JSON.stringify(data)); new Uint8Array(shared.data).set(encoded); Atomics.store(new Int32Array(shared.meta), 4, encoded.length);
  const workers = [1, 2].map(n => new Worker(new URL(import.meta.url), { workerData: { backend, shared, actor: 'Supervisor concorrente ' + n } }));
  const results = await Promise.all(workers.map(worker => new Promise((resolve, reject) => { worker.once('message', message => message.error ? reject(Error(message.error)) : resolve(message)); worker.once('error', reject); worker.once('exit', code => { if (code) reject(Error('Worker terminou: ' + code)); }); })));
  assert.equal(results.filter(r => r.response.alreadyPublished).length, 1); assert.ok(results.every(r => r.response.ok));
  assert.ok(results.every(r => r.acquisitions === 1 && r.releases === 1)); assert.equal(Atomics.load(new Int32Array(shared.meta), 0), 0);
  const check = harness({ shared }); assertComplete(check);
});
test('alteração da origem entre preparo e lock não perde alterações do Supervisor', () => {
  const h = harness(); h.seed(fixture()); h.beforeLock = () => { h.beforeLock = null; h.sheet(h.meta.APP.pendingSheet).rows[1][h.meta.COL.OBSERVATION - 1] = 'Alterado por outro Supervisor'; };
  assert.throws(() => h.approve(), error => error.code === 'PUBLICATION_SOURCE_CHANGED'); assert.equal(h.writes.length, 0); assert.equal(h.lockDepth, 0);
  assert.equal(h.approve().record.observation, 'Alterado por outro Supervisor'); assertComplete(h);
});
test('lote lógico com normal/parcial/concluída/conflito: 3 sucessos e 1 falha independente', () => {
  const h = harness(); const { APP } = h.meta;
  for (const n of [1, 2, 3, 4]) h.seed(fixture({ recordId: idFor(n) }));
  const partial = h.plan(idFor(2)); h.add(APP.servicesSheet, partial.expected.services.slice(0, 1)); h.approve(idFor(3));
  const conflict = h.plan(idFor(4)); const bad = Array.from(conflict.expected.services[0]); bad[4] = 100; h.add(APP.servicesSheet, [bad]);
  const first = h.batch([idFor(1), idFor(2), idFor(3), idFor(4)]); assert.equal(first.batchLimit, 3); assert.equal(first.remainingCount, 1);
  const second = h.batch([idFor(4)]); assert.equal(first.approvedCount + second.approvedCount, 3); assert.equal(first.skippedCount + second.skippedCount, 1);
  assert.equal(second.results[0].code, 'PUBLISHED_RECONCILIATION_CONFLICT'); assert.equal(h.rows(APP.pendingSheet).length, 1);
  for (const n of [1, 2, 3]) assertComplete(h, fixture({ recordId: idFor(n) }));
});
test('zero materiais: publicação e retry válidos, sem criar item artificial', () => {
  const h = harness(); const record = h.seed(fixture({ materials: [] })); h.approve(); assertComplete(h, record); assert.equal(h.approve().alreadyPublished, true);
});
test('zero serviços continua sujeito à regra operacional existente', () => {
  const h = harness(); h.seed(fixture({ services: [] })); assert.throws(() => h.approve(), error => error.code === 'SERVICE_REQUIRED'); assert.equal(h.writes.length, 0);
});
test('multiconjunto: duas linhas idênticas legítimas, somente uma delas persistida', () => {
  const h = harness(); const same = service('DUP'); const record = h.seed(fixture({ services: [same, { ...same, lineId: 'segunda linha' }], materials: [material(), { ...material(), lineId: 'segundo material' }] }));
  const plan = h.plan(); h.add(h.meta.APP.servicesSheet, plan.expected.services.slice(0, 1)); h.add(h.meta.APP.materialsSheet, plan.expected.materials.slice(0, 1)); h.approve(); assertComplete(h, record);
  assert.equal(h.approve().alreadyPublished, true);
});
test('mesmo código com quantidades distintas não se confunde no multiconjunto', () => {
  const h = harness(); const record = h.seed(fixture({ services: [service('IGUAL'), service('IGUAL', { lineId: 'segunda', quantity: 3, totalValue: 30 })] })); const plan = h.plan(); h.add(h.meta.APP.servicesSheet, plan.expected.services.slice(1)); h.approve(); assertComplete(h, record);
});
test('número repetido pertence a dois UUIDs independentes', () => {
  const h = harness(); h.seed(fixture()); h.seed(fixture({ recordId: idFor(2), services: [service('OUTRO')] })); h.approve(); h.approve(idFor(2));
  assertComplete(h); assertComplete(h, fixture({ recordId: idFor(2), services: [service('OUTRO')] }));
});
for (const [name, alter] of [
  ['quantidade de serviço', plan => { plan.services[0][4] = 100; }], ['preço unitário', plan => { plan.services[0][5] = 150; }], ['preço total', plan => { plan.services[0][6] = 150; }], ['descrição de serviço', plan => { plan.services[0][2] += ' diferente'; }], ['grupo', plan => { plan.services[0][7] = 'Outro'; }], ['catalog_key', plan => { plan.services[0][8] = 'Outra:8'; }], ['código do material com zero removido', plan => { plan.materials[0][4] = '123'; }], ['quantidade do material', plan => { plan.materials[0][2] = 100; }], ['descrição do material', plan => { plan.materials[0][5] = 'Outro'; }], ['unidade do material', plan => { plan.materials[0][6] = 'KG'; }], ['Nº vinculado ao material', plan => { plan.materials[0][7] = 'Outra ocorrência'; }], ['linha de serviço excedente', plan => { plan.services.push(plan.services[0].slice()); }], ['material excedente', plan => { plan.materials.push(plan.materials[0].slice()); }], ['ocorrência divergente', plan => { plan.main[17] = 'Observação diferente'; }], ['histórico divergente', plan => { plan.history[9] = 'Equipe diferente'; }]
]) {
  test('conflito preserva todos os registros antes de qualquer escrita: ' + name, () => {
    const h = harness(); h.seed(fixture()); const { expected } = h.plan(); const plan = plain(expected); alter(plan); const { APP } = h.meta;
    h.add(APP.officialSheet, [plan.main]); h.add(APP.servicesSheet, plan.services); h.add(APP.materialsSheet, plan.materials); h.add(APP.historySheet, [plan.history]);
    const before = plain([...h.sheets].map(([name, sheet]) => [name, sheet.rows]));
    assert.throws(() => h.approve(), error => error.code === 'PUBLISHED_RECONCILIATION_CONFLICT' && error.details.recordId === UUID && Boolean(error.details.table));
    assert.equal(h.writes.length, 0); assert.equal(h.lockDepth, 0); assert.deepEqual(plain([...h.sheets].map(([name, sheet]) => [name, sheet.rows])), before);
  });
}
for (const table of ['official', 'history', 'pending']) test('duplicidade de identidade/evento é conflito: ' + table, () => {
  const h = harness(); seedPartial(h, { official: true, services: 3, materials: 2, history: true }); const name = h.meta.APP[table === 'official' ? 'officialSheet' : table === 'history' ? 'historySheet' : 'pendingSheet'];
  h.add(name, [h.rows(name)[0]]); assert.throws(() => h.approve(), error => error.code === 'PUBLISHED_RECONCILIATION_CONFLICT'); assert.equal(h.writes.length, 0);
});
test('quantidade inválida não se transforma em zero ou igual ao esperado', () => {
  const h = harness(); h.seed(fixture()); const { expected } = h.plan(); expected.services[0][4] = 'inválida'; h.add(h.meta.APP.servicesSheet, [expected.services[0]]);
  assert.throws(() => h.approve(), error => error.code === 'PUBLISHED_RECONCILIATION_CONFLICT'); assert.equal(h.writes.length, 0);
});
test('pós-condições impedem histórico/remoção se um item não foi realmente persistido', () => {
  const h = harness(); h.seed(fixture()); const sheet = h.sheet(h.meta.APP.materialsSheet); sheet.getRange = ((original) => (...args) => { const range = original(...args); if (args[1] === 1) range.setValues = () => range; return range; })(sheet.getRange.bind(sheet));
  assert.throws(() => h.approve(), error => error.code === 'PUBLICATION_INCOMPLETE'); assert.equal(h.rows(h.meta.APP.historySheet).length, 0); assert.equal(h.rows(h.meta.APP.pendingSheet).length, 1); assert.equal(h.lockDepth, 0);
});
test('conflito descoberto na releitura não retira a pendência', () => {
  const h = harness(); h.seed(fixture()); h.afterWrite = event => { if (event.table === h.meta.APP.historySheet) { h.afterWrite = null; h.sheet(h.meta.APP.servicesSheet).rows[1][4] = 100; } };
  assert.throws(() => h.approve(), error => error.code === 'PUBLISHED_RECONCILIATION_CONFLICT'); assert.equal(h.rows(h.meta.APP.pendingSheet).length, 1); assert.equal(h.lockDepth, 0);
});
test('verificação read-only não escreve e reparo explícito não apaga conflito', () => {
  const h = harness(); h.seed(fixture()); h.approve(); h.writes = []; h.c.verifyPublishedIntegrity_(UUID, { repair: false }); assert.equal(h.writes.length, 0);
  h.sheet(h.meta.APP.servicesSheet).rows[1][4] = 100;
  assert.throws(() => h.c.verifyPublishedIntegrity_(UUID, { repair: true, cleanupPending: true, actor: 'Supervisor FICTÍCIO' }), error => error.code === 'PUBLISHED_RECONCILIATION_CONFLICT'); assert.equal(h.writes.length, 0);
});
test('fila mantém publicação interrompida acionável sem leituras adicionais', () => {
  const h = harness(); seedPartial(h, { official: true }); h.reads = []; const response = h.c.listPending_({ token: 'somente-harness' });
  assert.equal(response.records.length, 1); assert.equal(response.metricRecords[0].status, h.meta.STATUS.WAITING_SUPERVISOR);
  assert.equal(h.reads.length, 2); assert.ok(h.reads.every(r => [h.meta.APP.pendingSheet, h.meta.APP.officialSheet].includes(r.table))); assert.equal(h.acquisitions, 0); assert.equal(h.writes.length, 0);
});
test('TextFinder lê a coluna de UUID e somente os blocos selecionados', () => {
  const h = harness(); h.seed(fixture()); const { expected } = h.plan(); const { APP } = h.meta;
  h.add(APP.servicesSheet, Array.from({ length: 1500 }, (_, i) => [idFor(i + 20), 'IRRELEVANTE', '', '', 1, 1, 1, '', '', ''])); h.add(APP.servicesSheet, expected.services.slice(0, 1)); h.reads = []; h.finders = [];
  h.approve(); assertComplete(h); assert.ok(h.finders.every(r => r.width === 1 && r.column === 1));
  assert.ok(!h.reads.some(r => [APP.servicesSheet, APP.materialsSheet, APP.historySheet].includes(r.table) && r.width > 1 && r.height > 3));
});
test('retries interrompidos repetidamente preservam o prefixo e completam o multiconjunto', () => {
  const h = harness(); h.seed(fixture()); const { APP } = h.meta;
  h.prefixFault = { table: APP.servicesSheet, count: 1 }; assert.throws(() => h.approve());
  h.prefixFault = { table: APP.servicesSheet, count: 1 }; assert.throws(() => h.approve());
  assert.equal(h.rows(APP.servicesSheet).length, 2); h.approve(); assertComplete(h);
});
test('flush pode falhar depois da remoção: liberação garantida e retry sem duplicação', () => {
  const h = harness(); h.seed(fixture());
  h.flushHook = () => { if (!h.rows(h.meta.APP.pendingSheet).length) { h.flushHook = null; throw Error('Falha na confirmação após retirada'); } };
  assert.throws(() => h.approve()); assert.equal(h.lockDepth, 0); assert.equal(h.approve().alreadyPublished, true); assertComplete(h);
});
test('fila que reaparece após preparo a partir do oficial nunca é apagada sem conferir sua origem', () => {
  const h = harness(); const record = h.seed(fixture()); const pending = h.rows(h.meta.APP.pendingSheet)[0].slice(); h.approve();
  const snapshot = h.c.preparePublicationSnapshot_(UUID, 'Supervisor FICTÍCIO', '', []);
  pending[h.meta.COL.OBSERVATION - 1] = 'Alteração que deve permanecer'; h.add(h.meta.APP.pendingSheet, [pending]);
  assert.throws(() => h.c.reconcilePublication_(UUID, snapshot), error => error.code === 'PUBLICATION_SOURCE_CHANGED');
  assert.equal(h.rows(h.meta.APP.pendingSheet).length, 1); assert.equal(h.writes.length, 0); assert.equal(h.lockDepth, 0);
  assert.equal(record.recordId, UUID);
});
test('crescimento normal de linhas respeita o limite físico da aba', () => {
  const h = harness(); h.seed(fixture()); const sheet = h.sheet(h.meta.APP.officialSheet); let capacity = 1, added = 0;
  sheet.getMaxRows = () => capacity;
  sheet.insertRowsAfter = (after, count) => { assert.equal(after, capacity); assert.equal(h.lockDepth, 1); capacity += count; added += count; };
  h.approve(); assert.equal(added, 1); assertComplete(h);
});
const transformerFixture = () => fixture({ occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: 'FICTICIO-RETIRADO', removedCia: 'CIA-RET', removedBto: 'BTO-RET', newCode: 'FICTICIO-INSTALADO', newCia: 'CIA-INS', newBto: 'BTO-INS' } });
for (const phase of ['PRIMEIRO_TRAFO', 'SEGUNDO_TRAFO', 'HISTORICO_TRAFO', 'PROPERTY_TRAFO']) test('retomada da integração já existente de Trafo: ' + phase, () => {
  const h = harness(); const record = h.seed(transformerFixture()); let count = 0;
  if (phase === 'PROPERTY_TRAFO') h.propertyHook = () => { h.propertyHook = null; throw Error('Falha após marcador e linha de trafo'); };
  else h.failAfter(event => phase === 'HISTORICO_TRAFO' ? event.table === h.meta.APP.historySheet : event.table === h.meta.APP.transformerSheet && ++count === (phase === 'PRIMEIRO_TRAFO' ? 1 : 2));
  assert.throws(() => h.approve()); assert.equal(h.lockDepth, 0); const response = h.approve(); assertComplete(h, record); assert.equal(response.transformerIntegration.applies, true);
  assert.equal(h.rows(h.meta.APP.transformerSheet).length, 2); h.approve(); assert.equal(h.rows(h.meta.APP.transformerSheet).length, 2);
});

if (isMainThread && process.argv[4]) {
  const previous = await readFile(process.argv[4], 'utf8');
  test('baseline reproduz PUBLISHED_RECONCILIATION_REQUIRED após prefixo persistido', () => {
    const h = harness({ source: previous }); h.seed(fixture()); h.prefixFault = { table: h.meta.APP.servicesSheet, count: 1 };
    assert.throws(() => h.approve(), error => error.code === 'PUBLISHED_RECONCILIATION_REQUIRED');
    assert.equal(h.rows(h.meta.APP.servicesSheet).length, 1); assert.equal(h.rows(h.meta.APP.pendingSheet).length, 1);
    assert.equal(h.rows(h.meta.APP.historySheet).length, 0); assert.equal(h.lockDepth, 0);
  });
  test('baseline reproduz substituição destrutiva de serviço divergente; novo fluxo bloqueia', () => {
    const old = harness({ source: previous }); old.seed(fixture()); const current = harness(); current.seed(fixture()); const { expected } = current.plan();
    const divergent = Array.from(expected.services[0]); divergent[4] = 100; old.add(old.meta.APP.servicesSheet, [divergent]);
    assert.equal(old.approve().ok, true); assert.ok(old.writes.some(event => event.table === old.meta.APP.servicesSheet && event.kind === 'deleteRow'));
    current.add(current.meta.APP.servicesSheet, [divergent]); assert.throws(() => current.approve(), error => error.code === 'PUBLISHED_RECONCILIATION_CONFLICT'); assert.equal(current.writes.length, 0);
  });
}

if (isMainThread && process.argv[3]) {
  const live = JSON.parse(await readFile(process.argv[3], 'utf8'));
  for (const partial of live.partials) test('cópia read-only real: subconjunto e conclusão em RAM ' + partial.uuid, () => {
    const h = harness(); const { APP } = h.meta; const row = live.pending.find(r => r[0] === partial.uuid);
    h.add(APP.pendingSheet, [row]); h.add(APP.servicesSheet, live.services.filter(r => r[0] === partial.uuid)); h.add(APP.materialsSheet, live.materials.filter(r => r[0] === partial.uuid)); h.add(APP.historySheet, live.history.filter(r => r.values[0] === partial.uuid).map(r => r.values));
    const { expected, state, snapshot } = h.plan(partial.uuid); assert.equal(h.c.inspectPublication_(partial.uuid, expected, state).state, 'PARTIAL_RECONCILABLE');
    const preserved = { services: plain(h.rows(APP.servicesSheet)), materials: plain(h.rows(APP.materialsSheet)), pending: plain(row) };
    assert.equal(h.approve(partial.uuid).ok, true); assertComplete(h, snapshot.model);
    assert.ok(preserved.services.every(row => h.rows(APP.servicesSheet).some(r => JSON.stringify(r) === JSON.stringify(row))));
    assert.ok(preserved.materials.every(row => h.rows(APP.materialsSheet).some(r => JSON.stringify(r) === JSON.stringify(row))));
  });
}

if (!isMainThread) {
  try { const h = harness({ shared: workerData.shared, barrier: true, actor: workerData.actor }); const response = h.approve(); parentPort.postMessage({ response: plain(response), acquisitions: h.acquisitions, releases: h.releases }); }
  catch (error) { parentPort.postMessage({ error: String(error.stack || error) }); }
} else {
  let passed = 0; const failures = [];
  for (const item of tests) { try { await item.run(); passed++; } catch (error) { failures.push({ test: item.name, error: String(error.stack || error) }); } }
  console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, productionWrites: 0, concurrentWorkers: 2, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
