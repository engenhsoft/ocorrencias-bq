import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

if (!process.argv[2]) throw Error('Informe o fonte oficial do backend como argumento.');
const backend = await readFile(process.argv[2], 'utf8');
const [coreSource, appSource] = await Promise.all(['core.js', 'app.js'].map(name => readFile(new URL('../' + name, import.meta.url), 'utf8')));
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
  const start = appSource.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = appSource.indexOf('\n}', start);
  return appSource.slice(start, end + 2);
};
function assertPublished(h, expected) {
  const result = h.approve(expected.recordId);
  assert.equal(result.ok, true); assert.equal(result.status, 'PUBLICADA'); assert.equal(result.record.recordId, expected.recordId);
  assert.deepEqual(plain(result.record.services), plain(expected.services));
  assert.equal(result.record.totalServices, expected.totalServices);
  assert.equal(result.record.registeredAt, expected.registeredAt);
  assert.equal(result.record.contract, expected.contract);
  assert.equal(h.catalog.reads, 0);
  assert.equal(h.lockDepth(), 0);
  const { APP } = h.c.meta;
  assert.equal(h.sheet(APP.pendingSheet).getLastRow(), 1);
  assert.equal(h.sheet(APP.officialSheet).getLastRow(), 2);
  assert.ok(!result.record.audit.timeline.some(event => event.action === 'CORRIGIDA_PELO_SUPERVISOR'));
  assert.equal(result.record.audit.timeline.filter(event => event.action === 'APROVADA_E_PUBLICADA').length, 1);
  assert.equal(result.record.audit.pricingValidation.mode, 'SNAPSHOT_HISTORICO');
  assert.equal(h.sheet(APP.materialsSheet).rows[1][4], '000123');
  return result;
}

test('A: código removido e linha reutilizada não bloqueiam a publicação do snapshot', () => {
  const h = harness(); const record = recordFixture(); h.seed(record); assertPublished(h, record);
});
test('B: preço atual 150 não altera snapshot 2 × 100 = 200', () => {
  const h = harness([catalogRow('B', 150)]); const record = recordFixture([historical('B', { quantity: 2, referenceValue: 100, totalValue: 200 })]);
  h.seed(record); assertPublished(h, record);
});
test('C: catálogo vazio não impede a aprovação de serviço existente', () => {
  const h = harness([]); const record = recordFixture([historical('C')]); h.seed(record); assertPublished(h, record);
});
test('descrição, unidade, grupo e atributos históricos não são substituídos', () => {
  const h = harness([catalogRow('A', 20)]); const record = recordFixture(); h.seed(record); assertPublished(h, record);
});
test('origem e chave de catálogo legadas são aceitas sem lookup atual', () => {
  const h = harness(); const record = recordFixture([historical('A', { catalogKey: 'Catálogo anterior:42', origin: 'Fonte histórica' })]);
  h.seed(record); assertPublished(h, record);
});
test('contrato histórico diferente da derivação atual permanece intacto na aprovação', () => {
  const h = harness(); const record = recordFixture([historical('A', { contract: '4600080939' })], { contract: '4600080939' });
  h.seed(record); assertPublished(h, record);
});
test('contrato arquivado anterior aos contratos atuais é preservado sem migração', () => {
  const h = harness([]); const record = recordFixture([historical('A', { contract: 'CONTRATO-ARQUIVADO' })], { contract: 'CONTRATO-ARQUIVADO' });
  h.seed(record); assertPublished(h, record);
});
test('retry publica uma única UUID e um único evento final', () => {
  const h = harness(); const record = recordFixture(); h.seed(record); h.approve();
  const retry = h.approve(); const { APP } = h.c.meta;
  assert.equal(retry.idempotent, true);
  assert.equal(h.sheet(APP.officialSheet).getLastRow(), 2);
  assert.equal(h.sheet(APP.servicesSheet).getLastRow(), 2);
  assert.equal(h.sheet(APP.historySheet).rows.filter(row => row[0] === UUID && row[3] === 'APROVADA_E_PUBLICADA').length, 1);
  assert.equal(h.catalog.reads, 0);
});
test('Nº repetido não confunde duas UUIDs na publicação', () => {
  const h = harness(); h.seed(recordFixture()); h.seed(recordFixture([historical('C')], { recordId: SECOND_UUID }));
  h.approve(UUID); h.approve(SECOND_UUID);
  const rows = h.sheet(h.c.meta.APP.servicesSheet).rows.slice(1);
  assert.deepEqual(rows.map(row => row[0]).sort(), [UUID, SECOND_UUID].sort());
});
test('D: ocorrência nova consulta apenas os valores atuais H/I', () => {
  for (const [base, price, contract] of [['CARAÚBAS', 150, '4600080938'], ['MOSSORÓ', 250, '4600080939']]) {
    const h = harness(); const input = recordFixture([historical('D', { quantity: '2,5', referenceValue: 1, totalValue: 2.5 })], { base, contract });
    const model = h.c.validateAndNormalizeRecord_(input);
    assert.equal(model.services[0].referenceValue, price); assert.equal(model.services[0].quantity, 2.5);
    assert.equal(model.totalServices, price * 2.5); assert.ok(h.catalog.reads > 0);
  }
});
test('nova ocorrência não pode invocar o modo histórico por propriedade do cliente', () => {
  const h = harness(); const input = recordFixture([historical()], { serviceMode: 'snapshot', original: recordFixture() });
  assert.throws(() => h.c.validateAndNormalizeRecord_(input), error => error.code === 'CATALOG_MISMATCH');
});
test('busca de novos serviços continua no catálogo atual', () => {
  const h = harness(); const result = h.c.searchCatalog_({ token: 'fixture-only', query: 'Descrição', contract: '4600080938' });
  assert.equal(result.results.length, 1); assert.equal(result.results[0].code, 'D'); assert.equal(result.results[0].referenceValue, 150);
});
test('E: editar QTD somente em B conserva A/C e o preço histórico de B', () => {
  const h = harness([catalogRow(), catalogRow('B', 999)]);
  const record = recordFixture([historical('A'), historical('B', { catalogKey: 'Emergência:4', quantity: 2, referenceValue: 100, totalValue: 200 }), historical('C', { catalogKey: 'Emergência:5' })]);
  h.seed(record); const submitted = plain(record); submitted.services[1].quantity = '3,5';
  const result = h.correct(submitted); const expected = plain(record.services); expected[1].quantity = 3.5; expected[1].totalValue = 350;
  assert.deepEqual(plain(result.record.services), expected); assert.equal(result.record.totalServices, 750); assert.equal(h.catalog.reads, 0);
  assert.ok(result.correction.changes.some(change => change.field === 'QTD do serviço B'));
  assert.equal(result.record.audit.timeline[0].action, 'CRIADA');
  assert.deepEqual(plain(h.approve().record.services), expected);
});
test('F: adicionar D usa catálogo atual e conserva integralmente A/B', () => {
  const h = harness(); const record = recordFixture([historical('A'), historical('B', { catalogKey: 'Emergência:4' })]); h.seed(record);
  const submitted = plain(record); submitted.services.push(historical('D', { lineId: 'new-D', referenceValue: 1, quantity: 2, totalValue: 2 }));
  const result = h.correct(submitted);
  assert.deepEqual(plain(result.record.services.slice(0, 2)), record.services);
  assert.equal(result.record.services[2].referenceValue, 150); assert.equal(result.record.services[2].totalValue, 300);
  assert.equal(result.record.totalServices, 700); assert.equal(h.catalog.reads, 1);
});
test('substituir B por D usa catálogo atual somente na nova linha', () => {
  const h = harness(); const record = recordFixture([historical('A'), historical('B', { catalogKey: 'Emergência:4' }), historical('C', { catalogKey: 'Emergência:5' })]); h.seed(record);
  const submitted = plain(record); submitted.services[1] = historical('D', { lineId: 'new-D', quantity: 1 });
  const result = h.correct(submitted);
  assert.deepEqual(plain(result.record.services[0]), record.services[0]); assert.deepEqual(plain(result.record.services[2]), record.services[2]);
  assert.equal(result.record.services[1].referenceValue, 150); assert.equal(result.record.totalServices, 550);
});
test('remover B conserva os snapshots restantes e audita a remoção', () => {
  const h = harness([]); const record = recordFixture([historical('A'), historical('B', { catalogKey: 'Emergência:4' })]); h.seed(record);
  const submitted = plain(record); submitted.services.pop(); const result = h.correct(submitted);
  assert.deepEqual(plain(result.record.services), [record.services[0]]); assert.equal(result.record.totalServices, 200);
  assert.ok(result.changes.some(change => change.field === 'Serviço B'));
});
test('editar somente observação não consulta nem altera os serviços', () => {
  const h = harness([]); const record = recordFixture(); h.seed(record); const submitted = plain(record); submitted.observation = 'Observação editada';
  const result = h.correct(submitted); assert.deepEqual(plain(result.record.services), record.services);
  assert.equal(result.record.totalServices, 200); assert.equal(h.catalog.reads, 0);
});
test('total histórico zero é preservado sem falsa mudança na auditoria', () => {
  const h = harness([]); const record = recordFixture([historical('A', { totalValue: 0 })]); h.seed(record);
  const submitted = plain(record); submitted.observation = 'Observação editada';
  const result = h.correct(submitted);
  assert.equal(result.record.totalServices, 0); assert.equal(result.record.services[0].totalValue, 0);
  assert.ok(!result.changes.some(change => change.field.startsWith('Total')));
  assert.equal(h.c.serviceAuditValue_(result.record.services[0]).total, 0);
  assert.equal(h.catalog.reads, 0);
});
test('salvar sem alterações não cria falsa correção', () => {
  const h = harness([]); const record = recordFixture(); h.seed(record);
  assert.throws(() => h.correct(plain(record)), error => error.code === 'NO_CHANGES');
  assert.equal(h.sheet(h.c.meta.APP.historySheet).getLastRow(), 1);
});
test('edição legada sem lineId aceita ID de interface sem converter o serviço em novo', () => {
  const service = historical(); delete service.lineId;
  const h = harness([]); const record = recordFixture([service]); h.seed(record); const submitted = plain(record);
  submitted.services[0].lineId = 'gerado-pela-interface'; submitted.observation = 'Nova observação';
  const result = h.correct(submitted); assert.deepEqual(plain(result.record.services), record.services);
  assert.ok(!result.changes.some(change => change.field.startsWith('Serviço '))); assert.equal(h.catalog.reads, 0);
});
test('troca de Base não reprecifica itens existentes; item novo usa o contrato da Base final', () => {
  const h = harness(); const record = recordFixture(); h.seed(record);
  h.c.assertTeamDirectorySelection_ = () => {}; // relação mockada, sem alteração de cadastro
  const submitted = plain(record); submitted.base = 'MOSSORÓ'; submitted.contract = '4600080939';
  submitted.services.push(historical('D', { lineId: 'new-D', quantity: 1 }));
  const result = h.correct(submitted);
  assert.deepEqual(plain(result.record.services[0]), record.services[0]); assert.equal(result.record.services[1].referenceValue, 250);
  assert.equal(result.record.services[1].contract, '4600080939'); assert.equal(result.record.totalServices, 450);
});
test('alteração do preço enviada pelo cliente não forja valor legado', () => {
  const h = harness([catalogRow('A', 150)]); const record = recordFixture(); h.seed(record); const submitted = plain(record);
  submitted.services[0].referenceValue = 1; submitted.services[0].totalValue = 10;
  const result = h.correct(submitted); assert.equal(result.record.services[0].referenceValue, 150);
  assert.ok(result.changes.some(change => change.field === 'Valor unitário do serviço A'));
});
test('alterar somente total sem QTD ou substituição válida é rejeitado', () => {
  const h = harness([]); const record = recordFixture(); h.seed(record); const submitted = plain(record); submitted.services[0].totalValue = 1;
  assert.throws(() => h.correct(submitted), error => error.code === 'INVALID_SERVICE_SNAPSHOT');
});
for (const quantity of ['15,50', '15.50', '0,75', '0.75', '2,5', '125,567']) test('QTD decimal editada ' + quantity + ' usa o preço do snapshot', () => {
  const h = harness([]); const record = recordFixture(); h.seed(record); const submitted = plain(record); submitted.services[0].quantity = quantity;
  const result = h.correct(submitted); const number = Number(quantity.replace(',', '.'));
  assert.equal(result.record.services[0].quantity, number); assert.equal(result.record.services[0].referenceValue, 20);
  assert.equal(result.record.totalServices, Math.round(number * 20 * 100) / 100);
});
test('fallback de resumo preserva código, descrição, unidade, QTD fracionária e total sem catálogo', () => {
  const h = harness(); const record = recordFixture([historical('C', { quantity: 0.75, totalValue: 15 })]); h.seed(record, { summaryOnly: true });
  const result = h.approve(); const item = result.record.services[0];
  assert.equal(item.code, 'C'); assert.equal(item.catalogText, 'Descrição histórica C'); assert.equal(item.unit, 'UN');
  assert.equal(item.quantity, 0.75); assert.equal(item.referenceValue, 20); assert.equal(item.totalValue, 15); assert.equal(h.catalog.reads, 0);
});
for (const field of ['code', 'catalogText', 'quantity', 'referenceValue', 'totalValue']) test('snapshot inválido em ' + field + ' bloqueia antes de publicar', () => {
  const h = harness(); const service = historical(); service[field] = field === 'quantity' ? 0 : '';
  const record = recordFixture([service]); h.seed(record);
  assert.throws(() => h.approve(), error => error.code === 'INVALID_SERVICE_SNAPSHOT');
  assert.equal(h.sheet(h.c.meta.APP.officialSheet).getLastRow(), 1); assert.equal(h.lockDepth(), 0);
});
test('total histórico inconsistente exige conferência e não gera publicação parcial', () => {
  const h = harness(); const record = recordFixture(undefined, { totalServices: 1 }); h.seed(record);
  assert.throws(() => h.approve(), error => error.code === 'INVALID_SERVICE_SNAPSHOT');
  assert.equal(h.sheet(h.c.meta.APP.officialSheet).getLastRow(), 1);
});
test('aprovação continua bloqueada enquanto faltam fotos obrigatórias', () => {
  const h = harness(); const record = recordFixture(); const row = h.seed(record);
  row[h.c.meta.COL.PHOTO_1 - 1] = ''; h.sheet(h.c.meta.APP.pendingSheet).rows[1] = Array.from(row);
  assert.throws(() => h.approve(), error => error.code === 'RECORD_NOT_READY'); assert.equal(h.catalog.reads, 0);
});
test('frontend permite aprovação do snapshot sem contrato/key atuais e mantém validação de corrupção', () => {
  const issues = vm.runInNewContext(extractApp('supervisorPricingIssues') + '\nsupervisorPricingIssues', { ...core });
  const record = recordFixture([historical('A', { contract: '', catalogKey: '' })]);
  assert.equal(issues(record).length, 0);
  assert.ok(issues({ ...record, services: [{ ...record.services[0], referenceValue: null }] }).length);
});
test('frontend usa validação histórica apenas na edição do Supervisor', () => {
  const record = recordFixture([historical('A', { contract: '', catalogKey: '' })]);
  assert.equal(core.validateOccurrence(record, { historicalServices: true }).length, 0);
  assert.ok(core.validateOccurrence(record).length);
  assert.match(extractApp('saveSupervisorCorrection'), /historicalServices: true/);
});
test('troca de Base no editor não reprecifica a lista; seleção de serviço novo mantém catálogo atual', () => {
  assert.doesNotMatch(extractApp('handleSupervisorBaseChange'), /applyContractToRecord|repriceServicesForBase/);
  assert.match(extractApp('selectSupervisorCatalogItem'), /priceServiceForContract/);
  assert.match(extractApp('selectSupervisorCatalogItem'), /service.code === item.code/);
});

const failures = [];
let passed = 0;
for (const item of tests) {
  try { await item.run(); passed++; }
  catch (error) { failures.push({ test: item.name, error: String(error.stack || error) }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
