import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const tests = [];
const test = (name, run) => tests.push({ name, run });

const [coreSource, appSource, htmlSource, cssSource] = await Promise.all([
  read('core.js'), read('app.js'), read('index.html'), read('styles.css')
]);
const core = await import(dataUrl(coreSource));

test('KPIs contam UUID único, nunca o número da ocorrência', () => {
  const records = [
    { recordId: 'a', occurrenceNumber: '100', status: core.RECORD_STATUS.WAITING_SUPERVISOR },
    { recordId: 'a', occurrenceNumber: '100', status: core.RECORD_STATUS.WAITING_SUPERVISOR },
    { recordId: 'b', occurrenceNumber: '100', status: core.RECORD_STATUS.WAITING_SUPERVISOR },
    { recordId: 'c', status: core.RECORD_STATUS.CORRECTION_REQUESTED },
    { recordId: 'd', status: core.RECORD_STATUS.REJECTED },
    { recordId: 'e', status: core.RECORD_STATUS.SYNCING_PHOTOS },
    { recordId: 'f', status: core.RECORD_STATUS.PUBLISHED }
  ];
  assert.deepEqual(core.supervisorKpis(records), {
    published: 1, waitingConference: 2, waitingCorrection: 1, rejected: 1, pendingSync: 1, pending: 2
  });
});

test('registros sem UUID não entram nos KPIs', () => {
  assert.equal(core.supervisorKpis([{ occurrenceNumber: 'repetida', status: core.RECORD_STATUS.PUBLISHED }]).published, 0);
});

test('KPI Publicadas inclui somente estados finais publicados por UUID', () => {
  const metrics = core.supervisorKpis([
    { recordId: 'p1', status: core.RECORD_STATUS.PUBLISHED },
    { recordId: 'p1', status: core.RECORD_STATUS.PUBLISHED },
    { recordId: 'p2', status: 'APROVADA_E_PUBLICADA' },
    { recordId: 'a1', status: core.RECORD_STATUS.APPROVED },
    { recordId: 'w1', status: core.RECORD_STATUS.WAITING_SUPERVISOR },
    { recordId: 'r1', status: core.RECORD_STATUS.REJECTED }
  ]);
  assert.equal(metrics.published, 2);
});

test('Supervisor contém os cinco KPIs e os badges solicitados', () => {
  for (const id of ['supervisorKpiTotal', 'supervisorKpiWaiting', 'supervisorKpiCorrection', 'supervisorKpiRejected', 'supervisorKpiSync', 'supervisorOccurrencesBadge', 'supervisorPendingBadge', 'supervisorPhotosBadge', 'supervisorCorrectionBadge']) {
    assert.match(htmlSource, new RegExp(`id="${id}"`));
  }
  assert.match(htmlSource, /<span>Publicadas<\/span>/);
  assert.doesNotMatch(htmlSource, /<span>Total de ocorrências<\/span>/);
});

test('abas e filtros de pendência são exatamente os solicitados', () => {
  assert.match(htmlSource, /data-supervisor-tab="occurrences">Ocorrências/);
  assert.match(htmlSource, /data-supervisor-tab="pending">Pendências/);
  assert.match(htmlSource, /data-supervisor-pending="photos">Fotos pendentes/);
  assert.match(htmlSource, /data-supervisor-pending="correction">Correção solicitada/);
});

test('painel deriva tudo de uma única chamada listPending', () => {
  assert.equal((appSource.match(/await api\.listPending\(/g) || []).length, 1);
  assert.match(appSource, /result\.pendingRecords/);
  assert.match(appSource, /result\.metricRecords/);
});

test('pendências usam os estados canônicos existentes', () => {
  assert.match(appSource, /record\.status === RECORD_STATUS\.CORRECTION_REQUESTED/);
  assert.match(appSource, /record\.status === RECORD_STATUS\.SYNCING_PHOTOS/);
});

test('observação da correção é obrigatória e não exige foto', () => {
  assert.match(htmlSource, /id="decisionReason"[^>]*required/);
  assert.equal((htmlSource.match(/value="cancel" formnovalidate/g) || []).length >= 2, true);
  assert.match(appSource, /Observação da correção \*/);
  assert.doesNotMatch(appSource, /Selecione pelo menos uma foto para correção/);
  assert.match(appSource, /value\.trim\(\)/);
  assert.match(appSource, /event\.preventDefault\(\)/);
});

test('modal de correção mostra a ocorrência completa sem permitir edição', () => {
  assert.match(htmlSource, /id="decisionOccurrenceContext"/);
  assert.match(htmlSource, /id="decisionOccurrenceSummary"/);
  assert.match(htmlSource, /Nenhum dado é editado nesta tela/);
  assert.match(appSource, /occurrenceDetails\(activeSupervisorRecord\)/);
  assert.match(appSource, /<dt>UUID<\/dt>/);
  assert.match(appSource, /<dt>Enviado por<\/dt>/);
});

test('equipe recebe destaque, abre o mesmo registro e pode reenviar', () => {
  assert.match(htmlSource, /id="fieldCorrectionBanner"/);
  assert.match(appSource, /CORREÇÃO SOLICITADA PELO SUPERVISOR/);
  assert.match(appSource, /const correction = \{ \.\.\.record,[\s\S]*correctionMode: true/);
  assert.match(appSource, /Reenviar ao Supervisor/);
  assert.match(appSource, /loadRecordIntoForm\(correction\)/);
  assert.match(appSource, /record\.services/);
  assert.match(appSource, /record\.materials/);
});

test('fotos opcionais solicitadas usam também o pedido de correção geral', () => {
  assert.match(appSource, /lastCorrectionRequest\?\.photoIndexes/);
});

test('correções pedidas não aparecem como aptas para aprovação', () => {
  assert.match(appSource, /status !== RECORD_STATUS\.WAITING_SUPERVISOR/);
  assert.match(appSource, /elements\.approveButton\.hidden = status !== RECORD_STATUS\.WAITING_SUPERVISOR/);
});

test('layout mantém duas colunas no mobile e uma coluna em 360px', () => {
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*\.supervisor-kpis \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(cssSource, /@media \(max-width: 360px\)[\s\S]*\.supervisor-kpis \{ grid-template-columns: minmax\(0,1fr\)/);
  assert.match(cssSource, /\.supervisor-tab, \.pending-filter[\s\S]*min-height: 46px/);
});

test('QTD decimal de serviço permanece intacta', () => {
  assert.equal(core.parseServiceQuantity('15,50'), 15.5);
  assert.equal(core.parseServiceQuantity('0.75'), 0.75);
  assert.equal(core.serializeServicesForBackend([{ quantity: '125,567' }])[0].quantity, 125.567);
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try { await item.run(); passed += 1; }
  catch (error) { failures.push({ test: item.name, error: `${error.name}: ${error.message}` }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
