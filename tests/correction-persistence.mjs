import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

if (!process.argv[2]) throw Error('Informe o fonte oficial do backend como argumento.');
const backend = await readFile(process.argv[2], 'utf8');
const [coreSource, appSource] = await Promise.all(['core.js', 'app.js'].map(name => readFile(process.argv[4] ? process.argv[4] + '/' + name : new URL('../' + name, import.meta.url), 'utf8')));
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const tests = [];
const test = (name, run) => tests.push({ name, run });
const plain = value => JSON.parse(JSON.stringify(value));
const UUID = '11111111-1111-4111-8111-111111111111';
const SECOND_UUID = '22222222-2222-4222-8222-222222222222';
const historical = (code = 'A', options = {}) => ({
  lineId: 'line-' + code, catalogKey: 'Emergência:3', code, catalogText: 'Descrição histórica ' + code,
  unit: 'UN', group: 'Grupo histórico', contract: '4600080938', referenceValue: 20,
  quantity: 10, totalValue: 200, origin: 'Emergência', historicalAttribute: 'preservar',
  ...options
});
const catalogRow = (code = 'D', h = 150, i = 250) => [code, 'Descrição atual ' + code, 'M', 'Grupo atual', '999,00', '', '', String(h).replace('.', ','), String(i).replace('.', ',')];
const recordFixture = (services = [historical()], options = {}) => ({
  recordId: UUID, registeredAt: '2026-09-25T11:00:00-03:00', user: 'Equipe TESTE', base: 'CARAÚBAS',
  contract: '4600080938', team: 'LM TESTE', crewLeader: 'Chefe TESTE', occurrenceNumber: 'NÚMERO-REPETÍVEL',
  occurrenceTypes: ['PODA'], transformer: {}, services, materials: [{ code: '000123', description: 'Material TESTE', unit: 'UN', quantity: 1 }],
  observation: '', totalServices: Math.round(services.reduce((sum, item) => sum + Number(item.totalValue), 0) * 100) / 100,
  ...options
});

class MemorySheet {
  constructor(name, headers = [], rows = []) { this.name = name; this.rows = [headers.slice(), ...rows.map(row => row.slice())]; this.reads = 0; this.writes = 0; }
  getName() { return this.name; }
  getLastRow() { let count = this.rows.length; while (count && this.rows[count - 1].every(value => value == null || value === '')) count--; return count; }
  getLastColumn() { return Math.max(1, ...this.rows.map(row => row.length)); }
  getMaxColumns() { return Math.max(50, this.getLastColumn()); }
  insertColumnsAfter() {}
  getRange(row, column, height = 1, width = 1) {
    const sheet = this;
    const read = () => { sheet.reads++; return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => sheet.rows[row + y - 1]?.[column + x - 1] ?? '')); };
    const range = {
      getValues: read,
      getDisplayValues: () => read().map(values => values.map(value => String(value ?? ''))),
      setValues: values => {
        assert.equal(values.length, height); sheet.writes++;
        values.forEach((valuesRow, y) => {
          assert.equal(valuesRow.length, width);
          const target = sheet.rows[row + y - 1] ||= [];
          valuesRow.forEach((value, x) => { target[column + x - 1] = value ?? ''; });
        });
        return range;
      },
      setValue: value => range.setValues([[value]]),
      setNumberFormat: () => range
    };
    return range;
  }
  appendRow(row) { this.writes++; this.rows.push(row.slice()); }
  deleteRow(row) { this.writes++; this.rows.splice(row - 1, 1); }
}

function harness(catalog = [catalogRow()], source = backend) {
  const sheets = new Map();
  let lockDepth = 0;
  const spreadsheet = { getSheetByName: name => sheets.get(name) || null, insertSheet: name => { const sheet = new MemorySheet(name); sheets.set(name, sheet); return sheet; } };
  const context = vm.createContext({
    console, Date, JSON, Math, Number, String,
    SpreadsheetApp: { openById: () => spreadsheet, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() { lockDepth++; }, releaseLock() { lockDepth--; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => Array.from(createHash('sha256').update(String(value)).digest()),
      formatDate: (date, zone, pattern) => { const local = new Date(new Date(date).getTime() - 3 * 3600000).toISOString(); return pattern === 'yyyy-MM-dd' ? local.slice(0, 10) : local.slice(0, 19) + '-03:00'; }
    }
  });
  vm.runInContext(source + '\nthis.meta = { APP, COL, STATUS, MAIN_HEADERS, SERVICE_HEADERS, MATERIAL_HEADERS, HISTORY_HEADERS };', context);
  const { APP, MAIN_HEADERS, SERVICE_HEADERS, MATERIAL_HEADERS, HISTORY_HEADERS } = context.meta;
  for (const [name, headers] of [[APP.pendingSheet, MAIN_HEADERS], [APP.officialSheet, MAIN_HEADERS], [APP.servicesSheet, SERVICE_HEADERS], [APP.materialsSheet, MATERIAL_HEADERS], [APP.historySheet, HISTORY_HEADERS]]) {
    sheets.set(name, new MemorySheet(name, Array.from(headers)));
  }
  sheets.set(APP.catalogSheet, new MemorySheet(APP.catalogSheet, Array(9).fill(''), [Array(9).fill(''), ...catalog]));
  context.requireSession_ = () => ({ role: 'supervisor', user: 'Supervisor TESTE' });
  return {
    c: context, sheets, sheet: name => sheets.get(name), catalog: sheets.get(APP.catalogSheet),
    lockDepth: () => lockDepth,
    seed(record, { summaryOnly = false, status = context.meta.STATUS.WAITING_SUPERVISOR } = {}) {
      const audit = { timeline: [{ action: 'CRIADA', actor: record.user, at: record.registeredAt }], pendingMaterials: record.materials, expectedPhotoIndexes: [1, 2, 3] };
      if (!summaryOnly) audit.pendingServices = record.services;
      const model = { pgPostRemoved: '', pgPostInstalled: '', pgConductorStart: '', pgConductorEnd: '', otherOccurrenceType: '', goalPercentage: 0, ...record };
      const row = context.buildMainRow_(model, record.user, record.registeredAt, ['https://example.test/p1.jpg', 'https://example.test/p2.jpg', 'https://example.test/p3.jpg'], [], [], [], status, '', '', '', '', audit);
      sheets.get(APP.pendingSheet).appendRow(Array.from(row));
      return row;
    },
    approve: id => context.supervisorAction_({ token: 'fixture-only', decision: 'approve', recordId: id || UUID }),
    correct: record => context.supervisorCorrectRecord_({ token: 'fixture-only', record })
  };
}
const extractApp = name => {
  let start = appSource.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  if (appSource.slice(start - 6, start) === 'async ') start -= 6;
  const end = appSource.indexOf('\n}', start);
  return appSource.slice(start, end + 2);
};

function fieldHarness(catalog = [catalogRow('D')]) {
  const h = harness(catalog);
  h.c.CacheService = { getScriptCache: () => ({ get: () => '1', put() {}, remove() {} }) };
  h.c.assertTeamDirectorySelection_ = () => {}; // A relação equipe/base tem sua própria suíte.
  h.submit = record => {
    h.c.requireSession_ = () => ({ role: 'field', user: record.user });
    return h.c.submitRecord_({ token: 'fixture-only', record, clientVersion: core.APP_VERSION });
  };
  h.seedCorrection = (record, options = {}) => h.seed(record, { ...options, status: h.c.meta.STATUS.CORRECTION_REQUESTED });
  return h;
}
function assertResent(h, before, submitted, expectedServices = before.services, reads = 0) {
  const result = h.submit(submitted);
  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(result.recordId, before.recordId);
  assert.equal(result.record.occurrenceNumber, before.occurrenceNumber);
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR');
  assert.deepEqual(plain(result.record.services), plain(expectedServices));
  assert.equal(result.record.totalServices, Math.round(expectedServices.reduce((sum, line) => sum + Number(line.totalValue), 0) * 100) / 100);
  assert.equal(h.catalog.reads, reads);
  assert.equal(h.lockDepth(), 0);
  const { APP } = h.c.meta;
  assert.equal(h.sheet(APP.pendingSheet).getLastRow(), 2);
  assert.equal(h.sheet(APP.officialSheet).getLastRow(), 1);
  assert.equal(h.sheet(APP.servicesSheet).writes, 0);
  assert.equal(h.sheet(APP.materialsSheet).writes, 0);
  assert.equal(result.record.audit.timeline.filter(event => event.action === 'CORRECAO_REENVIADA').length, 1);
  assert.ok(!result.record.audit.timeline.some(event => event.action === 'CORRIGIDA_PELO_SUPERVISOR'));
  return result;
}
function fieldFormHarness() {
  const inputs = core.OCCURRENCE_TYPES.map(value => ({ value, checked: false }));
  const elements = new Proxy({}, { get(target, key) { return target[key] ||= { value: '', hidden: false, textContent: '', disabled: false, scrollIntoView() {} }; } });
  const context = vm.createContext({
    ...core, console, CSS: { escape: value => value }, elements, activeRecord: null, fieldServiceSnapshot: [], fieldAssignmentSnapshot: null,
    dailyProduction: { totalExcludingRecord: 0 }, catalogResults: [], previewUrls: new Map(), activePhotos: new Map(),
    TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO', TYPE_POST: 'SUBSTITUIÇÃO DE POSTE', TYPE_CONDUCTOR: 'SUBSTITUIÇÃO DE CONDUTOR', TYPE_OTHER: 'OUTRO',
    blankRecord: () => ({ transformer: {}, transformerPhotos: {}, photoStates: [] }),
    $$: () => inputs, $: () => ({ textContent: '' }), selectedTypes: () => inputs.filter(input => input.checked).map(input => input.value),
    clearPreviewUrls() {}, renderServices() {}, renderMaterials() {}, renderFieldCorrectionBanner() {}, updateContractOutput() {},
    renderAssignmentControls(edit, record) { elements.team.value = record.team || ''; elements.crewLeader.value = record.crewLeader || ''; },
    showDraftId() {}, updatePhotoGrid() {}, goToStep() {}, navigate() {}, assignmentError: () => '',
    toast() {}, localStorage: { setItem() {} }, LAST_TEAM_KEY: 'fixture-team', getPhotosForRecord: async () => [], loadDailyProduction: async () => {},
    ensureActiveRecord: async () => context.activeRecord, saveActiveDraft: async () => {}, updateGoal() {}, putRecord: async () => {}
  });
  for (const name of ['syncFormToRecord', 'validateStepOne', 'loadRecordIntoForm', 'handleServiceChange', 'selectCatalogItem', 'applyContractToRecord']) vm.runInContext(extractApp(name), context);
  return context;
}

const pgRecord = (options = {}) => recordFixture([historical()], { occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE', 'LINHA VIVA'], pgPostRemoved: 'PG-ANTIGO', pgPostInstalled: 'PG-INSTALADO', ...options });
const optionalTrafoRecord = () => pgRecord({ occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE', 'OUTRO'], otherOccurrenceType: 'REALOCAR TRAFO', transformer: { removedCode: '', removedCia: '', removedBto: '', newCode: '', newCia: '', newBto: '' } });
const changedTrafo = record => ({ ...plain(record), transformer: { ...record.transformer, removedCia: 'A', removedBto: 'B', newCia: 'C', newBto: 'D' } });
const resendCount = h => h.sheet(h.c.meta.APP.historySheet).rows.filter(row => row[3] === 'CORRECAO_REENVIADA').length;
const silentDrop = (sheet, column) => {
  const original = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => {
    const range = original(...args); const set = range.setValues;
    range.setValues = values => { const old = sheet.rows[args[0] - 1]?.[column - 1] ?? ''; const result = set(values); if (args[1] <= column && args[1] + (args[3] || 1) > column) sheet.rows[args[0] - 1][column - 1] = old; return result; };
    return range;
  };
  return () => { sheet.getRange = original; };
};

test('preflight de fotos preserva PG editado', () => {
  const local = pgRecord({ correctionMode: true, pgPostRemoved: 'PG-CORRIGIDO' });
  const result = core.reconcilePhotoStates(local, { record: pgRecord(), status: 'CORRECAO_SOLICITADA', photoStates: [] });
  assert.equal(result.pgPostRemoved, 'PG-CORRIGIDO');
});
test('formulário OUTRO preserva CIA/BTO A/B/C/D', async () => {
  const c = fieldFormHarness(); await c.loadRecordIntoForm({ ...optionalTrafoRecord(), correctionMode: true });
  for (const [key, value] of Object.entries({ removedTransformerCia: 'A', removedTransformerBto: 'B', newTransformerCia: 'C', newTransformerBto: 'D' })) c.elements[key].value = value;
  c.syncFormToRecord(); assert.deepEqual(plain(c.activeRecord.transformer), changedTrafo(optionalTrafoRecord()).transformer);
});
test('backend OUTRO persiste e relê CIA/BTO A/B/C/D', () => {
  const h = fieldHarness(); const before = optionalTrafoRecord(); h.seedCorrection(before);
  const result = h.submit(changedTrafo(before));
  assert.deepEqual(plain(result.record.transformer), changedTrafo(before).transformer);
  const found = h.c.findRowById_(h.sheet(h.c.meta.APP.pendingSheet), UUID);
  assert.equal(found.values[h.c.meta.COL.REMOVED_CIA - 1], 'A'); assert.equal(found.values[h.c.meta.COL.NEW_BTO - 1], 'D');
  assert.equal(resendCount(h), 1);
});
test('gravação parcial de PG não devolve sucesso nem evento de reenvio', () => {
  const h = fieldHarness(); const before = pgRecord(); h.seedCorrection(before);
  silentDrop(h.sheet(h.c.meta.APP.pendingSheet), h.c.meta.COL.PG_POST_REMOVED);
  assert.throws(() => h.submit({ ...before, pgPostRemoved: 'PG-CORRIGIDO' }), /persist|confirm|grava|verific/i);
  assert.equal(resendCount(h), 0);
});


const REQUEST_AT = '2026-10-05T15:42:04-03:00';
const SEND_ID = '33333333-3333-4333-8333-333333333333';
function seedRequested(h, record, photoIndexes = []) {
  const row = h.seedCorrection(record); const { APP, COL } = h.c.meta;
  const audit = JSON.parse(row[COL.AUDIT - 1]);
  const request = { requestedAt: REQUEST_AT, supervisor: 'Supervisor TESTE', note: 'Corrigir os campos solicitados', reason: 'Dados incorretos', photoIndexes };
  audit.lastCorrectionRequest = request; audit.correctionRequests = [request]; audit.requestedPhotoIndexes = photoIndexes;
  audit.timeline.push({ action: 'CORRECAO_SOLICITADA', actor: request.supervisor, at: REQUEST_AT, detail: request.note });
  row[COL.AUDIT - 1] = JSON.stringify(audit); row[COL.SUPERVISOR_NOTE - 1] = request.note; row[COL.SUPERVISOR - 1] = request.supervisor; row[COL.REVIEWED_AT - 1] = REQUEST_AT;
  h.sheet(APP.pendingSheet).rows[1] = Array.from(row);
  return { ...plain(record), correctionMode: true, serverConfirmed: true, audit, correctionRequestedAt: REQUEST_AT, correctionRequestId: SEND_ID };
}
function actualRow(h) { return h.c.uniqueCorrectionRow_(h.sheet(h.c.meta.APP.pendingSheet), UUID); }
function assertConfirmed(h, payload, result) {
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(result.recordId, UUID);
  assert.equal(result.record.audit.lastCorrectionSubmission.phase, 'COMPLETE');
  assert.ok(core.correctionConfirmationMatches(payload, result, true));
  assert.equal(resendCount(h), 1);
  assert.equal(result.record.audit.timeline.filter(e => e.action === 'CORRECAO_REENVIADA').length, 1);
  assert.equal(h.lockDepth(), 0);
  const fromSheet = h.c.recordFromValuesAt_(actualRow(h).values);
  assert.deepEqual(core.correctionDataSnapshot(plain(fromSheet)), core.correctionDataSnapshot(result.record));
}
const singleEdits = {
  base: p => { p.base = 'MOSSORÓ'; p.contract = '4600080939'; },
  team: p => { p.team = 'Equipe atualizada'; },
  crewLeader: p => { p.crewLeader = 'Chefe atualizado'; },
  occurrenceNumber: p => { p.occurrenceNumber = 'Nº CORRIGIDO'; },
  occurrenceTypes: p => { p.occurrenceTypes.push('PODA'); },
  otherOccurrenceType: p => { p.otherOccurrenceType = 'REALOCAR TRAFO CORRIGIDO'; },
  pgPostRemoved: p => { p.pgPostRemoved = 'PG-RETIRADO-NOVO'; },
  pgPostInstalled: p => { p.pgPostInstalled = 'PG-INSTALADO-NOVO'; },
  pgConductorStart: p => { p.pgConductorStart = 'PG-INICIAL-NOVO'; },
  pgConductorEnd: p => { p.pgConductorEnd = 'PG-FINAL-NOVO'; },
  removedCode: p => { p.transformer.removedCode = '999999'; },
  newCode: p => { p.transformer.newCode = 'SÉRIE-INSTALADA'; },
  removedCia: p => { p.transformer.removedCia = 'A'; },
  removedBto: p => { p.transformer.removedBto = 'B'; },
  newCia: p => { p.transformer.newCia = 'C'; },
  newBto: p => { p.transformer.newBto = 'D'; },
  observation: p => { p.observation = 'Observação corrigida'; },
  serviceQuantity: p => { p.services[0].quantity = 2; p.services[0].totalValue = 40; p.totalServices = 40; },
  materials: p => { p.materials = [{ code: '0500109', description: 'CABO CORRIGIDO', unit: 'M', quantity: 2.75 }]; }
};
for (const [field, edit] of Object.entries(singleEdits)) test('gravação + releitura + Supervisor: ' + field, () => {
  const h = fieldHarness(); const payload = seedRequested(h, optionalTrafoRecord()); edit(payload);
  assertConfirmed(h, payload, h.submit(payload));
});
test('vários campos, serviço decimal e material com zero inicial', () => {
  const h = fieldHarness(); const payload = seedRequested(h, optionalTrafoRecord());
  for (const edit of Object.values(singleEdits)) edit(payload);
  payload.services[0].quantity = 2.75; payload.services[0].totalValue = 55; payload.totalServices = 55;
  const result = h.submit(payload); assertConfirmed(h, payload, result);
  assert.equal(result.record.materials[0].code, '0500109'); assert.equal(h.catalog.reads, 0);
});
test('formulário abre campos opcionais durante correção sem exigir fotos Trafo', async () => {
  const c = fieldFormHarness(); await c.loadRecordIntoForm({ ...optionalTrafoRecord(), correctionMode: true });
  assert.equal(c.elements.transformerSection.hidden, false); assert.equal(c.elements.pgConductorSection.hidden, false);
  for (const [key, value] of Object.entries({ pgConductorStart: 'INÍCIO', pgConductorEnd: 'FIM', removedTransformerCode: '999999', removedTransformerCia: 'A', removedTransformerBto: 'B', newTransformerCode: 'INST', newTransformerCia: 'C', newTransformerBto: 'D' })) c.elements[key].value = value;
  assert.equal(c.validateStepOne(), true); assert.equal(c.activeRecord.transformer.newBto, 'D');
});
test('nova ocorrência mantém campos condicionais e regras de fotos anteriores', async () => {
  const c = fieldFormHarness(); await c.loadRecordIntoForm(optionalTrafoRecord());
  assert.equal(c.elements.transformerSection.hidden, true); assert.equal(c.elements.pgConductorSection.hidden, true);
  c.elements.newTransformerCia.value = 'NÃO APLICÁVEL'; c.syncFormToRecord(); assert.equal(c.activeRecord.transformer.newCia, '');
});
test('série instalada 999999 é inválida mesmo em correção opcional', () => {
  const h = fieldHarness(); const p = seedRequested(h, optionalTrafoRecord()); p.transformer.newCode = '999999';
  assert.throws(() => h.submit(p), /série válida/); assert.equal(resendCount(h), 0);
  assert.ok(core.validateOccurrence(p).some(error => error.includes('série válida')));
});
test('limpeza explícita permitida de observação, CIA/BTO e PG opcional', () => {
  const h = fieldHarness(); const p = seedRequested(h, changedTrafo(optionalTrafoRecord()));
  p.observation = ''; p.transformer = { removedCia: '', removedBto: '', newCia: '', newBto: '' }; p.pgConductorStart = ''; p.pgConductorEnd = '';
  const result = h.submit(p); assert.equal(result.record.transformer.removedCia, ''); assert.equal(result.record.transformer.newBto, '');
  assert.equal(result.record.observation, ''); assert.equal(resendCount(h), 1);
});
test('campos ausentes/undefined conservam o original; null opcional limpa', () => {
  const h = fieldHarness(); const before = changedTrafo(optionalTrafoRecord()); before.observation = 'ANTIGA'; before.pgConductorStart = 'MANTER';
  const p = seedRequested(h, before); const partial = { recordId: UUID, user: before.user, correctionRequestId: p.correctionRequestId, correctionRequestedAt: p.correctionRequestedAt, observation: null, transformer: { removedCia: undefined, newCia: null } };
  const result = h.submit(partial);
  assert.equal(result.record.transformer.removedCia, 'A'); assert.equal(result.record.transformer.newCia, '');
  assert.equal(result.record.transformer.newBto, 'D'); assert.equal(result.record.pgConductorStart, 'MANTER'); assert.equal(result.record.observation, '');
  assert.deepEqual(plain(result.record.services), before.services);
});
test('campo obrigatório vazio ou null rejeita sem reenvio', () => {
  for (const value of ['', null]) { const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = value; assert.throws(() => h.submit(p), /PG do poste retirado/); assert.equal(resendCount(h), 0); }
});
test('pedido mais recente bloqueia payload antigo e cliente anterior', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.correctionRequestedAt = '2026-10-01T00:00:00-03:00';
  assert.throws(() => h.submit(p), /solicitação.*mudou/); assert.equal(resendCount(h), 0);
  delete p.correctionRequestId; assert.throws(() => h.submit(p), /Atualize o aplicativo/);
});
test('outro proprietário, UUID duplicado e cabeçalho alterado não gravam', () => {
  for (const cause of ['owner', 'duplicate', 'headers']) {
    const h = fieldHarness(); const p = seedRequested(h, pgRecord());
    if (cause === 'owner') p.user = 'Outro usuário';
    if (cause === 'duplicate') h.sheet(h.c.meta.APP.pendingSheet).appendRow(actualRow(h).values);
    if (cause === 'headers') h.sheet(h.c.meta.APP.pendingSheet).rows[0][6] = 'COLUNA TROCADА';
    const writes = h.sheet(h.c.meta.APP.pendingSheet).writes; assert.throws(() => h.submit(p));
    assert.equal(h.sheet(h.c.meta.APP.pendingSheet).writes, writes); assert.equal(resendCount(h), 0); assert.equal(h.lockDepth(), 0);
  }
});
test('falha total na gravação mantém pendência e nenhuma confirmação', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'NOVO';
  const sheet = h.sheet(h.c.meta.APP.pendingSheet); const range = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => { const r = range(...args); r.setValues = () => { throw Error('Falha de gravação'); }; return r; };
  assert.throws(() => h.submit(p), /Falha de gravação/); assert.equal(resendCount(h), 0);
  assert.equal(actualRow(h).values[h.c.meta.COL.STATUS - 1], 'CORRECAO_SOLICITADA');
});
test('write parcial guarda intenção e retry conclui sem duplicação', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'NOVO';
  const restore = silentDrop(h.sheet(h.c.meta.APP.pendingSheet), h.c.meta.COL.PG_POST_REMOVED);
  assert.throws(() => h.submit(p));
  const audit = JSON.parse(actualRow(h).values[h.c.meta.COL.AUDIT - 1]);
  assert.equal(audit.lastCorrectionSubmission.expectedPatch.pgPostRemoved, 'NOVO'); assert.equal(resendCount(h), 0);
  restore(); assertConfirmed(h, p, h.submit(p)); assertConfirmed(h, p, h.submit(p));
});
test('falha ao liberar status não gera CORRIGIDO nem reenvio', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'NOVO';
  const restore = silentDrop(h.sheet(h.c.meta.APP.pendingSheet), h.c.meta.COL.STATUS);
  assert.throws(() => h.submit(p)); assert.equal(resendCount(h), 0);
  const state = h.c.recordFromValuesAt_(actualRow(h).values); assert.equal(state.status, 'CORRECAO_SOLICITADA'); assert.equal(core.correctedAfterResend(plain(state)), false);
  restore(); assertConfirmed(h, p, h.submit(p));
});
test('falha ao concluir recibo volta a pendência; retry confirma uma vez', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'NOVO';
  const sheet = h.sheet(h.c.meta.APP.pendingSheet); const original = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => { const r = original(...args); if (args[1] === h.c.meta.COL.AUDIT) { const set = r.setValue; r.setValue = value => { if (String(value).includes('"phase":"COMPLETE"')) throw Error('Falha de conclusão'); return set(value); }; } return r; };
  assert.throws(() => h.submit(p), /Falha de conclusão/); assert.equal(resendCount(h), 0);
  assert.equal(actualRow(h).values[h.c.meta.COL.STATUS - 1], 'CORRECAO_SOLICITADA');
  sheet.getRange = original; assertConfirmed(h, p, h.submit(p));
});
test('resposta perdida e retry não reverte dados nem duplica histórico', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'NOVO'; h.submit(p); // response intentionally discarded
  assertConfirmed(h, p, h.submit(p)); assertConfirmed(h, p, h.submit(p));
});
test('mesmo ID de envio com outros valores é rejeitado', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'NOVO'; h.submit(p);
  p.pgPostRemoved = 'OUTRO'; assert.throws(() => h.submit(p), /outros dados/); assert.equal(resendCount(h), 1);
});
function pipeline(h, initial) {
  let stored = plain(initial); let revision = 0; let submissions = 0; let lostResponse = false;
  class ApiError extends Error { constructor(message, code) { super(message); this.code = code; } }
  const c = vm.createContext({ ...core, console, ApiError, session: { role: 'field', user: initial.user, token: 'fixture-only' }, sessionRevision: 1, navigator: { onLine: true }, dailyProduction: { totalExcludingRecord: 0 },
    TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO', getRecord: async () => plain(stored), putRecord: async record => { stored = { ...plain(record), updatedAt: 'fixture-' + (++revision) }; return plain(stored); },
    setMeta: async () => {}, LAST_SYNC_META: 'fixture-sync', cacheDailySummary: async () => {}, updateQueueUi: async () => {}, getPhoto: async () => null, deletePhoto: async () => {},
    blobToDataUrl: async () => '', currentView: 'sync', mineRecords: [], refreshMine() {}, friendlyError: error => error.message, toast() {}, logout() {},
    correctionRequest: record => record.audit?.lastCorrectionRequest || {},
    api: { getRecordState: async (_, recordId) => { h.c.requireSession_ = () => ({ role: 'field', user: initial.user }); return plain(h.c.getRecordState_({ token: 'fixture-only', recordId })); },
      submitRecord: async (_, record) => { submissions++; const result = h.submit({ ...record, user: initial.user }); if (lostResponse) { lostResponse = false; throw new ApiError('Resposta perdida', 'NETWORK_ERROR'); } return plain(result); }, uploadPhoto: async () => { throw Error('Não deve reenviar fotos sem edição'); } }
  });
  vm.runInContext(extractApp('performSyncSingleRecord'), c);
  return { run: () => c.performSyncSingleRecord(initial.recordId, false), loseNextResponse: () => { lostResponse = true; }, value: () => plain(stored), submissions: () => submissions, c };
}
test('pipeline real IDB → preflight → payload → planilha → releitura → Supervisor', async () => {
  const h = fieldHarness(); const p = seedRequested(h, optionalTrafoRecord()); p.pgPostRemoved = 'PG-CORRIGIDO'; p.transformer = changedTrafo(p).transformer;
  const state = h.c.recordFromValuesAt_(actualRow(h).values); p.photoStates = plain(state.photoStates);
  const flow = pipeline(h, p); const result = await flow.run();
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(result.pgPostRemoved, 'PG-CORRIGIDO'); assert.equal(result.transformer.newBto, 'D');
  assert.equal(flow.value().correctionMode, false); assert.equal(resendCount(h), 1);
});
test('pipeline real conserva edição local após resposta perdida e retomada', async () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'PG-CORRIGIDO'; p.photoStates = plain(h.c.recordFromValuesAt_(actualRow(h).values).photoStates);
  const flow = pipeline(h, p); flow.loseNextResponse(); const failed = await flow.run();
  assert.equal(failed.status, core.RECORD_STATUS.ERROR); assert.equal(flow.value().pgPostRemoved, 'PG-CORRIGIDO'); assert.equal(flow.value().correctionMode, true);
  const success = await flow.run(); assert.equal(success.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(success.pgPostRemoved, 'PG-CORRIGIDO'); assert.equal(resendCount(h), 1);
});
test('API rejeita sucesso com dados antigos ou recibo ausente', async () => {
  const apiSource = await readFile(new URL('../api.js', import.meta.url), 'utf8');
  const configSource = await readFile(new URL('../config.js', import.meta.url), 'utf8');
  const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const patched = apiSource.replace(/(['"])\.\/core\.js\?v=[^'"]+\1/g, JSON.stringify(url(coreSource))).replace(/(['"])\.\/config\.js\?v=[^'"]+\1/g, JSON.stringify(url(configSource)));
  const apiModule = await import(url(patched)); const originalFetch = globalThis.fetch;
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'CORRIGIDO'; const real = plain(h.submit(p));
  try {
    for (const failure of ['data', 'receipt']) { const fake = plain(real); if (failure === 'data') fake.record.pgPostRemoved = 'PG-ANTIGO'; else delete fake.record.audit.lastCorrectionSubmission;
      globalThis.fetch = async () => new Response(JSON.stringify(fake)); await assert.rejects(apiModule.api.submitRecord('fixture-only', p, core.APP_VERSION), error => error.code === 'CORRECTION_DATA_UNCONFIRMED'); }
    globalThis.fetch = async () => new Response(JSON.stringify(real)); assert.equal((await apiModule.api.submitRecord('fixture-only', p, core.APP_VERSION)).record.pgPostRemoved, 'CORRIGIDO');
  } finally { globalThis.fetch = originalFetch; }
});
test('coleção Campo conserva dados da correção na retomada', () => {
  const local = pgRecord({ correctionMode: true, pgPostRemoved: 'CORRIGIDO', observation: '' }); const server = pgRecord({ observation: 'ANTIGA' });
  const merged = core.mergeRecordCollections([local], [server])[0]; assert.equal(merged.pgPostRemoved, 'CORRIGIDO'); assert.equal(merged.observation, '');
});
function recoveryPlan(h, classification = 'C') {
  const row = actualRow(h).values; const audit = JSON.parse(row[h.c.meta.COL.AUDIT - 1]);
  return { recordId: UUID, recoveryId: 'fixture-recovery', classification, expectedStatus: 'AGUARDANDO_SUPERVISOR', requestedAt: REQUEST_AT, lastResendAt: audit.timeline.filter(e => e.action === 'CORRECAO_REENVIADA').at(-1)?.at,
    expectedRowFingerprint: h.c.sha256_(h.c.publicationJson_(row)) };
}
test('recuperação C reabre somente UUID alvo e preserva pedido/histórico/fotos', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); h.submit(p);
  const before = Array.from(actualRow(h).values); const audit = JSON.parse(before[h.c.meta.COL.AUDIT - 1]);
  // Synthetic legacy lost-data case: no persisted payload exists.
  delete audit.lastCorrectionSubmission; before[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit); h.sheet(h.c.meta.APP.pendingSheet).rows[1] = before.slice();
  const plan = recoveryPlan(h); const result = h.c.recoverCorrectionCases_([plan])[0]; assert.equal(result.action, 'REOPENED_ORIGINAL_REQUEST'); assert.equal(result.newResendNeeded, true);
  const after = actualRow(h).values;
  before.forEach((value, index) => { if (![h.c.meta.COL.STATUS - 1, h.c.meta.COL.AUDIT - 1].includes(index)) assert.deepEqual(after[index], value); });
  const recovered = JSON.parse(after[h.c.meta.COL.AUDIT - 1]); assert.deepEqual(plain(recovered.timeline), audit.timeline); assert.deepEqual(plain(recovered.lastCorrectionRequest), audit.lastCorrectionRequest);
  assert.equal(core.correctedAfterResend(plain(h.c.recordFromValuesAt_(after))), false); assert.equal(resendCount(h), 1);
  assert.equal(h.c.recoverCorrectionCases_([plan])[0].action, 'ALREADY_APPLIED'); assert.equal(h.lockDepth(), 0);
});
test('recuperação B usa valor persistido verificável e não cria reenvio fictício', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'PG-CORRIGIDO'; h.submit(p);
  actualRow(h).values; h.sheet(h.c.meta.APP.pendingSheet).rows[1][h.c.meta.COL.PG_POST_REMOVED - 1] = 'PG-ANTIGO';
  const plan = recoveryPlan(h, 'B'); const receipt = JSON.parse(actualRow(h).values[h.c.meta.COL.AUDIT - 1]).lastCorrectionSubmission;
  plan.patch = plain(receipt.expectedPatch); plan.sourceRequestId = receipt.requestId;
  const result = h.c.recoverCorrectionCases_([plan])[0]; assert.equal(result.action, 'RESTORED_VERIFIED_PATCH'); assert.equal(result.status, 'AGUARDANDO_SUPERVISOR');
  assert.equal(h.c.recordFromValuesAt_(actualRow(h).values).pgPostRemoved, 'PG-CORRIGIDO'); assert.equal(resendCount(h), 1);
});
test('recuperação preserva A, rejeita fonte inventada, estado novo ou publicado', () => {
  for (const cause of ['A', 'source', 'stale', 'published']) {
    const h = fieldHarness(); const p = seedRequested(h, pgRecord()); h.submit(p); const plan = recoveryPlan(h, cause === 'A' ? 'A' : cause === 'source' ? 'B' : 'C');
    if (cause === 'source') { plan.patch = { pgPostRemoved: 'INVENTADO' }; plan.sourceRequestId = 'inexistente'; }
    if (cause === 'stale') h.sheet(h.c.meta.APP.pendingSheet).rows[1][h.c.meta.COL.OBSERVATION - 1] = 'ALTERADA APÓS ANÁLISE';
    if (cause === 'published') h.sheet(h.c.meta.APP.officialSheet).appendRow(actualRow(h).values);
    const writes = h.sheet(h.c.meta.APP.pendingSheet).writes; const result = h.c.recoverCorrectionCases_([plan])[0];
    assert.equal(result.changed, false); assert.equal(h.sheet(h.c.meta.APP.pendingSheet).writes, writes);
    if (cause === 'A') assert.equal(result.action, 'PRESERVED'); else assert.ok(result.error);
  }
});
if (process.argv[3]) test('fixture privada: CIA/BTO A/B/C/D após escrita e leitura', async () => {
  const fixture = JSON.parse(await readFile(process.argv[3], 'utf8')); assert.equal(fixture.readOnly, true);
  const row = fixture.recordRow; assert.equal(row.length, 46);
  const h = fieldHarness([]); h.sheet(h.c.meta.APP.pendingSheet).appendRow(row); const before = plain(h.c.recordFromValuesAt_(row));
  const form = fieldFormHarness(); await form.loadRecordIntoForm({ ...before, correctionMode: true });
  for (const [key, value] of Object.entries({ removedTransformerCia: 'A', removedTransformerBto: 'B', newTransformerCia: 'C', newTransformerBto: 'D' })) form.elements[key].value = value;
  assert.equal(form.validateStepOne(), true);
  const payload = { ...plain(form.activeRecord), correctionRequestId: SEND_ID, correctionRequestedAt: before.audit.lastCorrectionRequest.requestedAt, services: core.serializeServicesForBackend(form.activeRecord.services), materials: core.serializeMaterialsForBackend(form.activeRecord.materials) };
  const result = h.submit(payload); const reread = h.c.recordFromValuesAt_(h.c.uniqueCorrectionRow_(h.sheet(h.c.meta.APP.pendingSheet), before.recordId).values);
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.deepEqual(plain(reread.transformer), changedTrafo(before).transformer);
  assert.deepEqual(plain(reread.services), before.services); assert.deepEqual(core.correctionDataSnapshot(reread).materials, core.correctionDataSnapshot(before).materials);
  assert.deepEqual(plain(reread.photos), before.photos); assert.equal(h.catalog.reads, 0); assert.equal(resendCount(h), 1);
});


function fakePhotoDrive(h) {
  const files = new Map(); const trashed = []; let created = 0;
  const iterator = values => { let i = 0; return { hasNext: () => i < values.length, next: () => values[i++] }; };
  h.c.Utilities.base64Decode = value => Array.from(Buffer.from(value, 'base64'));
  h.c.Utilities.newBlob = (bytes, mime, name) => ({ bytes, mime, name });
  h.c.photoFolder_ = () => ({ getFilesByName: name => iterator(files.has(name) ? [files.get(name)] : []), createFile: blob => {
    const file = { id: 'new-file-' + (++created), description: '', getId() { return this.id; }, getDescription() { return this.description; }, setDescription(value) { this.description = value; } }; files.set(blob.name, file); return file;
  } });
  h.c.makePhotoPublic_ = () => {}; h.c.publicPhotoUrl_ = id => 'https://example.test/' + id;
  h.c.trashDriveFileFromUrl_ = url => trashed.push(url);
  return { created: () => created, trashed };
}
const photoPayload = { recordId: UUID, photoIndex: 3, uploadKey: '44444444-4444-4444-8444-444444444444', dataUrl: 'data:image/jpeg;base64,aGVsbG8=', replace: true };
test('foto solicitada: um slot muda após releitura; demais fotos e dados preservados', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord(), [3]); p.pgPostRemoved = 'PG-CORRIGIDO'; const old = Array.from(actualRow(h).values);
  assert.equal(h.submit(p).status, 'CORRECAO_SOLICITADA'); assert.equal(resendCount(h), 0);
  const drive = fakePhotoDrive(h); const result = h.c.uploadPhoto_({ token: 'fixture-only', ...photoPayload });
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(result.record.pgPostRemoved, 'PG-CORRIGIDO'); assert.equal(result.record.photos[2], 'https://example.test/new-file-1');
  assert.equal(result.record.photos[0], old[h.c.meta.COL.PHOTO_1 - 1]); assert.equal(result.record.photos[1], old[h.c.meta.COL.PHOTO_1]);
  assert.equal(drive.created(), 1); assert.deepEqual(drive.trashed, ['https://example.test/p3.jpg']); assert.equal(resendCount(h), 1);
  h.c.uploadPhoto_({ token: 'fixture-only', ...photoPayload }); assert.equal(drive.created(), 1); assert.equal(resendCount(h), 1);
});
test('foto com write parcial não confirma slot nem descarta imagem anterior; retry reusa arquivo', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord(), [3]); h.submit(p); const drive = fakePhotoDrive(h);
  const restore = silentDrop(h.sheet(h.c.meta.APP.pendingSheet), h.c.meta.COL.PHOTO_1 + 2);
  assert.throws(() => h.c.uploadPhoto_({ token: 'fixture-only', ...photoPayload })); assert.equal(drive.trashed.length, 0); assert.equal(resendCount(h), 0);
  const partial = h.c.recordFromValuesAt_(actualRow(h).values); assert.equal(partial.photoStates[2].confirmed, false); assert.equal(partial.status, 'CORRECAO_SOLICITADA');
  restore(); const result = h.c.uploadPhoto_({ token: 'fixture-only', ...photoPayload });
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(result.record.photos[2], 'https://example.test/new-file-1'); assert.equal(drive.created(), 1); assert.equal(resendCount(h), 1);
});
test('foto salva mas confirmação final perdida: retry confirma intenção sem reupload', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord(), [3]); h.submit(p); const drive = fakePhotoDrive(h);
  const sheet = h.sheet(h.c.meta.APP.pendingSheet); const original = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => { const r = original(...args); if (args[1] === h.c.meta.COL.AUDIT) { const set = r.setValue; r.setValue = value => { if (String(value).includes('"photoIndex":3') && String(value).includes('"verifiedAt"')) throw Error('Confirmação da foto interrompida'); return set(value); }; } return r; };
  assert.throws(() => h.c.uploadPhoto_({ token: 'fixture-only', ...photoPayload })); assert.equal(drive.trashed.length, 0); assert.equal(resendCount(h), 0);
  assert.equal(h.c.recordFromValuesAt_(actualRow(h).values).photoStates[2].confirmed, false);
  sheet.getRange = original; const result = h.c.uploadPhoto_({ token: 'fixture-only', ...photoPayload });
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(result.record.photos[2], 'https://example.test/new-file-1'); assert.equal(drive.created(), 1); assert.equal(resendCount(h), 1);
});
test('parcial com exceção após primeiras colunas conserva pendência e completa no retry', () => {
  const h = fieldHarness(); const p = seedRequested(h, optionalTrafoRecord()); p.pgPostRemoved = 'CORRIGIDO'; p.transformer = changedTrafo(p).transformer;
  const sheet = h.sheet(h.c.meta.APP.pendingSheet); const original = sheet.getRange.bind(sheet); let writes = 0;
  sheet.getRange = (...args) => { const r = original(...args); const set = r.setValues; r.setValues = values => { if (++writes === 2) { for (let i = 0; i < 9; i++) sheet.rows[args[0] - 1][args[1] - 1 + i] = values[0][i]; throw Error('Write parcial interrompido'); } return set(values); }; return r; };
  assert.throws(() => h.submit(p), /Write parcial/); assert.equal(resendCount(h), 0); assert.equal(actualRow(h).values[h.c.meta.COL.STATUS - 1], 'CORRECAO_SOLICITADA');
  sheet.getRange = original; assertConfirmed(h, p, h.submit(p));
});
test('Supervisor vê PG opcional e CIA/BTO no detalhe e os preserva ao editar observação', async () => {
  const before = changedTrafo(optionalTrafoRecord()); before.pgConductorStart = 'INÍCIO'; before.pgConductorEnd = 'FIM';
  const c = fieldFormHarness(); c.previewUrls = new Map();
  for (const name of ['occurrenceDetails', 'syncSupervisorEditorFromForm']) vm.runInContext(extractApp(name), c);
  c.serviceTable = () => ''; c.materialTable = () => ''; c.transformerPhotoMarkup = () => ''; c.dailyDetailMarkup = () => ''; c.auditMarkup = () => ''; c.correctionRequestMarkup = () => ''; c.occurrenceTypesText = r => r.occurrenceTypes.join(' | ');
  const html = c.occurrenceDetails(before, false); assert.ok(html.includes('CIA: A')); assert.ok(html.includes('BTO: D')); assert.ok(html.includes('INÍCIO'));
  c.supervisorEditRecord = plain(before); c.activeSupervisorRecord = plain(before);
  for (const [key, value] of Object.entries({ editOperationBase: before.base, editTeam: before.team, editCrewLeader: before.crewLeader, editOccurrenceNumber: before.occurrenceNumber, editOtherOccurrenceType: before.otherOccurrenceType, editPgPostRemoved: before.pgPostRemoved, editPgPostInstalled: before.pgPostInstalled, editPgConductorStart: before.pgConductorStart, editPgConductorEnd: before.pgConductorEnd, editRemovedTransformerCode: '', editRemovedTransformerCia: 'A', editRemovedTransformerBto: 'B', editNewTransformerCode: '', editNewTransformerCia: 'C', editNewTransformerBto: 'D', editObservation: 'CORRIGIDA' })) c.elements[key].value = value;
  c.$$ = () => before.occurrenceTypes.map(value => ({ checked: true, value })); const updated = c.syncSupervisorEditorFromForm();
  assert.deepEqual(plain(updated.transformer), before.transformer); assert.equal(updated.pgConductorStart, 'INÍCIO');
});
test('edição legítima do Supervisor mantém recibo compatível e aprovação apta', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'CORRIGIDO'; h.submit(p);
  h.c.requireSession_ = () => ({ role: 'supervisor', user: 'Supervisor TESTE' });
  const record = plain(h.c.recordFromValuesAt_(actualRow(h).values)); record.observation = 'Conferida pelo Supervisor';
  const edited = h.c.supervisorCorrectRecord_({ token: 'fixture-only', record }); assert.equal(edited.status, 'AGUARDANDO_SUPERVISOR');
  const snapshot = h.c.preparePublicationSnapshot_(UUID); assert.ok(snapshot);
});
test('recuperação B preserva todas as colunas não pedidas, inclusive resumos legados', () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord()); p.pgPostRemoved = 'CORRIGIDO'; h.submit(p);
  const sheet = h.sheet(h.c.meta.APP.pendingSheet); sheet.rows[1][h.c.meta.COL.PG_POST_REMOVED - 1] = 'PG-ANTIGO'; sheet.rows[1][h.c.meta.COL.SERVICES_SUMMARY - 1] = 'RESUMO LEGADO A PRESERVAR';
  const before = Array.from(actualRow(h).values); const plan = recoveryPlan(h, 'B'); const receipt = JSON.parse(before[h.c.meta.COL.AUDIT - 1]).lastCorrectionSubmission; plan.patch = plain(receipt.expectedPatch); plan.sourceRequestId = receipt.requestId;
  const result = h.c.recoverCorrectionCases_([plan])[0]; assert.equal(result.action, 'RESTORED_VERIFIED_PATCH');
  before.forEach((value, i) => { if (![h.c.meta.COL.PG_POST_REMOVED - 1, h.c.meta.COL.AUDIT - 1].includes(i)) assert.deepEqual(actualRow(h).values[i], value); });
});


test('pipeline preserva total histórico arredondado sem recalcular multiplicação', async () => {
  const h = fieldHarness(); const p = seedRequested(h, pgRecord({ services: [historical('A', { quantity: 3, referenceValue: 1.005, totalValue: 3.02 })], totalServices: 3.02 })); p.pgPostRemoved = 'CORRIGIDO'; p.photoStates = plain(h.c.recordFromValuesAt_(actualRow(h).values).photoStates);
  const flow = pipeline(h, p); const result = await flow.run(); assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(result.totalServices, 3.02); assert.equal(resendCount(h), 1);
});

let failures = 0;
for (const item of tests) { try { await item.run(); console.log('PASS ' + item.name); } catch (error) { failures++; console.error('FAIL ' + item.name + ': ' + error.message); } }
console.log(JSON.stringify({ tests: tests.length, passed: tests.length - failures, failed: failures }));
if (failures) process.exitCode = 1;
