import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

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
const pgRecord = (services, options = {}) => recordFixture(services, { occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE', 'LINHA VIVA'], pgPostRemoved: 'PG-ANTIGO', pgPostInstalled: 'PG-INSTALADO', ...options });
const changePg = record => ({ ...plain(record), pgPostRemoved: 'PG-CORRIGIDO' });

test('PG apenas: linha reutilizada não invalida os serviços históricos', () => {
  const h = fieldHarness(); const before = pgRecord([historical()]); h.seedCorrection(before);
  const result = assertResent(h, before, changePg(before));
  assert.equal(result.record.pgPostRemoved, 'PG-CORRIGIDO');
  assert.deepEqual(plain(result.record.materials).map(({ lineId, ...rest }) => rest), before.materials);
  assert.equal(result.record.photoCount, 3);
});
test('serviço removido do catálogo permite reenvio histórico', () => {
  const h = fieldHarness([]); const before = pgRecord([historical()]); h.seedCorrection(before); assertResent(h, before, changePg(before));
});
test('preço histórico 10 permanece 10 quando o atual é 15', () => {
  const h = fieldHarness([catalogRow('A', 15)]); const before = pgRecord([historical('A', { referenceValue: 10, totalValue: 100 })]);
  h.seedCorrection(before); assertResent(h, before, changePg(before));
});
test('descrição, unidade e grupo atuais não substituem os históricos', () => {
  const h = fieldHarness([catalogRow('A', 20)]); const before = pgRecord([historical('A', { catalogText: 'INSTALAR CONECTOR' })]);
  h.seedCorrection(before); assertResent(h, before, changePg(before));
});
test('catalogKey histórico fora da posição atual permanece válido', () => {
  const h = fieldHarness([catalogRow('A')]); const before = pgRecord([historical('A', { catalogKey: 'Emergência:775' })]);
  h.seedCorrection(before); assertResent(h, before, changePg(before));
});
test('quantidade 3 → 4 usa 36,19 históricos e resulta em 144,76', () => {
  const h = fieldHarness([catalogRow('A', 150)]); const before = pgRecord([historical('A', { quantity: 3, referenceValue: 36.19, totalValue: 108.57 }), historical('B')]);
  h.seedCorrection(before); const submitted = changePg(before); submitted.services[0].quantity = '4';
  assertResent(h, before, submitted, [{ ...before.services[0], quantity: 4, totalValue: 144.76 }, before.services[1]]);
});
test('historical A + novo B: somente B consulta H atual', () => {
  const h = fieldHarness([catalogRow('B', 15)]); const before = pgRecord([historical()]); h.seedCorrection(before);
  const submitted = changePg(before); submitted.services.push(historical('B', { lineId: 'new-B', quantity: 2, referenceValue: 1, totalValue: 2 }));
  assertResent(h, before, submitted, [before.services[0], { lineId: 'new-B', catalogKey: 'Emergência:3', code: 'B', catalogText: 'Descrição atual B', unit: 'M', group: 'Grupo atual', contract: '4600080938', referenceValue: 15, quantity: 2, totalValue: 30, origin: 'Emergência' }], 1);
});
test('remover A e selecionar B usa somente B atual', () => {
  const h = fieldHarness([catalogRow('B', 15)]); const before = pgRecord([historical()]); h.seedCorrection(before);
  const submitted = changePg(before); submitted.services = [historical('B', { lineId: 'new-B', quantity: 1 })];
  const expected = [{ lineId: 'new-B', catalogKey: 'Emergência:3', code: 'B', catalogText: 'Descrição atual B', unit: 'M', group: 'Grupo atual', contract: '4600080938', referenceValue: 15, quantity: 1, totalValue: 15, origin: 'Emergência' }];
  assertResent(h, before, submitted, expected, 1);
});
test('remover e reselecionar o mesmo código é seleção atual', () => {
  const h = fieldHarness([catalogRow('A', 15)]); const before = pgRecord([historical('A', { referenceValue: 10, totalValue: 100 })]); h.seedCorrection(before);
  const submitted = changePg(before); submitted.services = [{ ...before.services[0], lineId: 'new-A', quantity: 2 }];
  const result = h.submit(submitted); assert.equal(result.ok, true); assert.equal(result.record.services[0].referenceValue, 15); assert.equal(result.record.services[0].totalValue, 30); assert.equal(h.catalog.reads, 1);
});
test('A/B/C permanecem integralmente históricos após correção do PG', () => {
  const h = fieldHarness(); const before = pgRecord(['A', 'B', 'C'].map(code => historical(code))); h.seedCorrection(before); assertResent(h, before, changePg(before));
});
test('reenvio repetido e retomada da fila preservam o snapshot já salvo', () => {
  const h = fieldHarness([]); const before = pgRecord([historical()]); h.seedCorrection(before); const submitted = changePg(before);
  assertResent(h, before, submitted); assertResent(h, before, submitted);
});
test('correção → reenvio → aprovação mantém UUID, número e snapshot', () => {
  const h = fieldHarness([]); const before = pgRecord([historical()]); h.seedCorrection(before);
  assertResent(h, before, changePg(before));
  h.c.requireSession_ = () => ({ role: 'supervisor', user: 'Supervisor TESTE' });
  const published = h.approve(before.recordId);
  assert.equal(published.recordId, before.recordId); assert.equal(published.status, 'PUBLICADA');
  assert.equal(published.record.occurrenceNumber, before.occurrenceNumber); assert.deepEqual(plain(published.record.services), before.services);
  assert.equal(published.record.audit.timeline.filter(event => event.action === 'APROVADA_E_PUBLICADA').length, 1);
  assert.equal(h.catalog.reads, 0);
  const retried = h.submit(changePg(before)); assert.equal(retried.status, 'PUBLICADA'); assert.equal(h.catalog.reads, 0);
});
test('reenvio de dados mantém pedido de substituição da foto pendente', () => {
  const h = fieldHarness([]); const before = pgRecord([historical()]); h.seedCorrection(before);
  const values = h.sheet(h.c.meta.APP.pendingSheet).rows[1]; const audit = JSON.parse(values[h.c.meta.COL.AUDIT - 1]); audit.requestedPhotoIndexes = [3]; values[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit);
  const result = h.submit(changePg(before)); assert.equal(result.status, 'CORRECAO_SOLICITADA');
  assert.deepEqual(plain(result.record.services), before.services); assert.deepEqual(plain(result.record.audit.requestedPhotoIndexes), [3]); assert.equal(h.catalog.reads, 0);
});
test('ocorrência nova não pode simular histórico com campos do cliente', () => {
  const h = fieldHarness(); const submitted = pgRecord([historical()], { serviceMode: 'snapshot', correctionMode: true, audit: { pendingServices: [historical()] } });
  assert.throws(() => h.submit(submitted), error => error.code === 'CATALOG_MISMATCH');
  assert.equal(h.sheet(h.c.meta.APP.pendingSheet).getLastRow(), 1);
});
test('alterar identidade de linha histórica exige catálogo atual', () => {
  const h = fieldHarness(); const before = pgRecord([historical()]); h.seedCorrection(before); const submitted = changePg(before); submitted.services[0].code = 'FORJADO';
  assert.throws(() => h.submit(submitted), error => error.code === 'CATALOG_MISMATCH');
});
for (const field of ['catalogKey', 'catalogText', 'unit', 'group', 'origin', 'contract']) test('alterar ' + field + ' exige validar seleção atual', () => {
  const h = fieldHarness(); const before = pgRecord([historical()]); h.seedCorrection(before); const submitted = changePg(before);
  submitted.services[0][field] = field === 'catalogKey' ? 'Emergência:4' : 'ALTERADO';
  assert.throws(() => h.submit(submitted), error => error.code === 'CATALOG_MISMATCH'); assert.equal(h.catalog.reads, 1);
});
test('alterar só o preço não passa como linha histórica', () => {
  const h = fieldHarness(); const before = pgRecord([historical()]); h.seedCorrection(before); const submitted = changePg(before); submitted.services[0].referenceValue = 1;
  assert.throws(() => h.submit(submitted), error => error.code === 'CATALOG_MISMATCH');
});
test('alterar só total sem alterar quantidade é rejeitado', () => {
  const h = fieldHarness(); const before = pgRecord([historical()]); h.seedCorrection(before); const submitted = changePg(before); submitted.services[0].totalValue = 1;
  assert.throws(() => h.submit(submitted), error => error.code === 'INVALID_SERVICE_SNAPSHOT');
});
for (const [field, value] of [['unit', ''], ['contract', 'INVALIDO'], ['referenceValue', null], ['totalValue', null]]) test('snapshot histórico inválido em ' + field + ' é rejeitado estruturalmente', () => {
  const h = fieldHarness([]); const before = pgRecord([historical('A', { [field]: value })]); h.seedCorrection(before);
  assert.throws(() => h.submit(changePg(before)), error => error.code === 'INVALID_SERVICE_SNAPSHOT');
});
for (const quantity of ['0', '-1', 'texto', null, Infinity]) test('QTD histórica inválida ' + quantity + ' não grava', () => {
  const h = fieldHarness(); const before = pgRecord([historical()]); h.seedCorrection(before); const submitted = changePg(before); submitted.services[0].quantity = quantity;
  const count = h.sheet(h.c.meta.APP.pendingSheet).writes;
  assert.throws(() => h.submit(submitted), error => error.code === 'INVALID_QUANTITY');
  assert.equal(h.sheet(h.c.meta.APP.pendingSheet).writes, count); assert.equal(h.lockDepth(), 0);
});
test('ID do usuário é verificado antes de validar o histórico', () => {
  const h = fieldHarness([]); const before = pgRecord([historical()]); h.seedCorrection(before); const submitted = changePg(before); submitted.user = 'OUTRA EQUIPE';
  assert.throws(() => h.submit(submitted), error => error.code === 'FORBIDDEN');
});
test('UUID inválido permanece bloqueado', () => {
  const h = fieldHarness(); assert.throws(() => h.submit(pgRecord([historical()], { recordId: 'invalido' })), error => error.code === 'INVALID_ID');
});
test('linha sem ID: ID estável de interface preserva snapshot legado', () => {
  const line = historical(); delete line.lineId;
  const h = fieldHarness([]); const before = pgRecord([line]); h.seedCorrection(before); const submitted = changePg(before); submitted.services[0].lineId = 'historical:' + UUID + ':0';
  assertResent(h, before, submitted);
});
test('linha sem ID: reseleção UUID novo usa catálogo mesmo com dados iguais', () => {
  const current = { catalogKey: 'Emergência:3', code: 'A', catalogText: 'Descrição atual A', unit: 'M', group: 'Grupo atual', contract: '4600080938', referenceValue: 15, quantity: 1, totalValue: 15, origin: 'Emergência' };
  const h = fieldHarness([catalogRow('A', 15)]); const before = pgRecord([current]); h.seedCorrection(before); const submitted = changePg(before); submitted.services[0].lineId = 'new-A';
  assertResent(h, before, submitted, [{ ...current, lineId: 'new-A' }], 1);
});
test('resumo legado sem pendingServices é recuperado sem catálogo', () => {
  const h = fieldHarness([]); const before = pgRecord([historical()]); h.seedCorrection(before, { summaryOnly: true });
  const values = h.sheet(h.c.meta.APP.pendingSheet).rows[1]; const services = plain(h.c.pendingServicesFromRow_(values, {}, before.contract));
  const submitted = changePg({ ...before, services }); assertResent(h, before, submitted, services);
});
test('validação frontend distingue histórico de serviço novo sem contrato', () => {
  const before = pgRecord([historical('A', { catalogKey: '' })]); const submitted = changePg(before);
  assert.deepEqual(core.validateOccurrence(submitted, { originalServices: before.services }), []);
  submitted.services.push(historical('B', { lineId: 'new-B', contract: '' }));
  assert.ok(core.validateOccurrence(submitted, { originalServices: before.services }).some(error => error.includes('sem valor cadastrado')));
});
test('total frontend preserva arredondamento histórico e recalcula apenas QTD', () => {
  const before = pgRecord([historical('A', { quantity: 3, referenceValue: 36.19, totalValue: 108.57 }), historical('B', { quantity: 3, referenceValue: 1.005, totalValue: 3.02 })]);
  assert.equal(core.occurrenceSnapshotTotal(before.services, before.services, before.recordId), 111.59);
  const submitted = changePg(before); submitted.services[0].quantity = '4';
  assert.equal(core.occurrenceSnapshotTotal(submitted.services, before.services, before.recordId), 147.78);
});
test('frontend aplica modo por linha na correção e impede reprecificação ao abrir', () => {
  assert.match(extractApp('validateStepOne'), /originalServices: fieldServiceSnapshot/);
  assert.doesNotMatch(extractApp('loadRecordIntoForm'), /applyContractToRecord\(activeRecord\)/);
});

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
test('formulário real de correção carrega snapshot integral sem reprecificar contractValues', async () => {
  const c = fieldFormHarness(); const before = pgRecord([historical('A', { contractValues: { '4600080938': 999 } })], { correctionMode: true, audit: {} });
  await c.loadRecordIntoForm(before); assert.deepEqual(plain(c.activeRecord.services), before.services);
  c.elements.pgPostRemoved.value = 'PG-NOVO'; assert.equal(c.validateStepOne(), true, JSON.stringify(core.validateOccurrence(c.activeRecord, { originalServices: c.fieldServiceSnapshot })));
  assert.equal(c.activeRecord.pgPostRemoved, 'PG-NOVO'); assert.deepEqual(plain(c.activeRecord.services), before.services);
  assert.equal(c.activeRecord.totalServices, before.totalServices);
});
test('quantidade editada e restaurada recupera total salvo e mantém baseline imutável', async () => {
  const c = fieldFormHarness(); const before = pgRecord([historical('A', { quantity: 3, referenceValue: 1.005, totalValue: 3.02 })], { correctionMode: true, audit: {} });
  await c.loadRecordIntoForm(before);
  for (const value of ['4', '3']) await c.handleServiceChange({ target: { closest: selector => selector === '[data-service-quantity]' ? { value, dataset: { serviceQuantity: 'line-A' } } : null } });
  assert.equal(c.activeRecord.services[0].totalValue, 3.02); assert.equal(c.activeRecord.totalServices, 3.02);
  assert.deepEqual(plain(c.fieldServiceSnapshot), before.services);
});
test('remoção e reseleção do mesmo código cria novo lineId e usa dados da pesquisa', async () => {
  const c = fieldFormHarness(); const before = pgRecord([historical()], { correctionMode: true, audit: {} }); await c.loadRecordIntoForm(before);
  await c.handleServiceChange({ target: { closest: selector => selector === '[data-remove-service]' ? { dataset: { removeService: 'line-A' } } : null } });
  await c.selectCatalogItem({ catalogKey: 'Emergência:3', code: 'A', catalogText: 'Descrição atual A', unit: 'M', group: 'Grupo atual', contractValues: { '4600080938': 15 } });
  assert.equal(c.activeRecord.services.length, 1); assert.notEqual(c.activeRecord.services[0].lineId, 'line-A');
  assert.equal(c.activeRecord.services[0].referenceValue, 15); assert.equal(c.activeRecord.services[0].totalValue, 15);
  assert.equal(core.historicalServiceIndex(c.activeRecord.services[0], before.services, before.recordId), -1);
});
test('rascunho de correção retomado conserva baseline salvo, quantidade e seleção nova', async () => {
  const c = fieldFormHarness(); const before = pgRecord([historical()], { correctionMode: true, audit: {} }); await c.loadRecordIntoForm(before);
  await c.handleServiceChange({ target: { closest: selector => selector === '[data-service-quantity]' ? { value: '4', dataset: { serviceQuantity: 'line-A' } } : null } });
  await c.selectCatalogItem({ catalogKey: 'Emergência:4', code: 'B', catalogText: 'Atual B', unit: 'M', contractValues: { '4600080938': 15 } });
  const saved = plain(c.activeRecord); await c.loadRecordIntoForm(saved);
  assert.deepEqual(plain(c.fieldServiceSnapshot), before.services); assert.deepEqual(plain(c.activeRecord.services), saved.services);
  assert.equal(c.activeRecord.totalServices, 95);
});
test('linhas legadas sem ID mantêm distinção após remover, editar e retomar', async () => {
  const c = fieldFormHarness(); const lines = ['A', 'B'].map(code => { const line = historical(code); delete line.lineId; return line; });
  const before = pgRecord(lines, { correctionMode: true, audit: {} }); await c.loadRecordIntoForm(before);
  const removedId = c.activeRecord.services[0].lineId; const retainedId = c.activeRecord.services[1].lineId;
  await c.handleServiceChange({ target: { closest: selector => selector === '[data-remove-service]' ? { dataset: { removeService: removedId } } : null } });
  await c.handleServiceChange({ target: { closest: selector => selector === '[data-service-quantity]' ? { value: '4', dataset: { serviceQuantity: retainedId } } : null } });
  await c.loadRecordIntoForm(plain(c.activeRecord));
  assert.equal(c.activeRecord.services[0].lineId, retainedId); assert.equal(core.historicalServiceIndex(c.activeRecord.services[0], c.fieldServiceSnapshot, before.recordId), 1);
  assert.equal(c.activeRecord.totalServices, 80);
});
test('troca de Base preserva histórico e reprecifica somente seleção atual', async () => {
  const c = fieldFormHarness(); const before = pgRecord([historical()], { correctionMode: true, audit: {} }); await c.loadRecordIntoForm(before);
  await c.selectCatalogItem({ catalogKey: 'Emergência:4', code: 'B', catalogText: 'Atual B', unit: 'M', contractValues: { '4600080938': 15, '4600080939': 25 } });
  c.activeRecord.base = 'MOSSORÓ'; c.applyContractToRecord(c.activeRecord);
  assert.deepEqual(plain(c.activeRecord.services[0]), before.services[0]); assert.equal(c.activeRecord.services[1].referenceValue, 25);
  assert.equal(c.activeRecord.services[1].contract, '4600080939');
});
for (const [base, contract, expected] of [['CAICÓ', '4600080938', 150], ['MOSSORÓ', '4600080939', 250]]) test('nova seleção em ' + base + ' usa H/I, nunca E', () => {
  const h = fieldHarness(); const submitted = pgRecord([historical('D', { lineId: 'new-D', quantity: 2 })], { base, contract });
  const result = h.submit(submitted); assert.equal(result.record.services[0].referenceValue, expected); assert.equal(result.record.totalServices, expected * 2); assert.equal(h.catalog.reads, 1);
});
if (process.argv[3]) test('fixture operacional somente leitura: serviços, fotos e total preservados', async () => {
  const fixture = JSON.parse(await readFile(process.argv[3], 'utf8'));
  assert.equal(fixture.readOnly, true);
  const h = fieldHarness([]); const { APP, COL } = h.c.meta;
  h.sheet(APP.pendingSheet).appendRow(fixture.recordRow);
  const before = plain(h.c.recordFromValuesAt_(fixture.recordRow));
  const expectedTotal = Number(fixture.recordRow[COL.TOTAL - 1]);
  assert.equal(before.recordId, fixture.recordRow[COL.ID - 1]);
  assert.ok(before.services.length); assert.equal(before.totalServices, expectedTotal);
  const form = fieldFormHarness(); await form.loadRecordIntoForm({ ...before, correctionMode: true });
  form.elements.pgPostRemoved.value = 'PG-CORRIGIDO'; assert.equal(form.validateStepOne(), true);
  assert.deepEqual(plain(core.serializeServicesForBackend(form.activeRecord.services)), before.services);
  assert.equal(form.activeRecord.totalServices, expectedTotal);
  h.catalog.rows[1031] = fixture.currentFirstCatalogRow;
  const result = assertResent(h, before, changePg(before));
  assert.equal(result.record.totalServices, expectedTotal); assert.equal(result.record.photoCount, before.photoCount);
  assert.deepEqual(plain(result.record.photos), before.photos);
});

const failures = []; let passed = 0;
for (const item of tests) {
  try { await item.run(); passed++; }
  catch (error) { failures.push({ test: item.name, error: String(error.stack || error) }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
