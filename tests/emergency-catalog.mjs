import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixtureFactory, id, plain } from './chaves-fixtures.mjs';
import { dataCommitMatches, synchronizationDiagnostic } from '../core.js';
import { canQueueRetry, catalogQueueIssue } from '../sync-queue.js';

const [candidate, baseline] = await Promise.all(process.argv.slice(2, 4).map(file => readFile(file, 'utf8')));
assert.ok(candidate && baseline, 'Informe as fontes privadas candidata e da versão 49.');
const [make, makeBaseline] = await Promise.all([fixtureFactory(candidate), fixtureFactory(baseline)]);
const contract = '4600080938';
const actor = 'Campo Fixture';
const row = (code, description, h = '17,35', i = '20,41') => [code, description, 'UD', 'GRUPO', '', '', '', h, i];
const first = row('0123', 'SERVIÇO PRINCIPAL');
const second = row('S002', 'SERVIÇO COMPLEMENTAR', '12,50');
const other = row('00123', 'OUTRO CÓDIGO');

function setup(makeBackend = make, catalogRows = [first, second]) {
  const h = makeBackend();
  const { APP } = h.c.meta;
  const catalog = h.sheet(APP.catalogSheet);
  catalog.rows.splice(2, catalog.rows.length, ...catalogRows.map(item => item.slice()));
  h.c.requireSession_ = () => ({ role: 'field', user: actor });
  h.c.assertTeamDirectorySelection_ = () => {};
  const search = (query, currentContract = contract) => plain(h.c.searchCatalog_({ token: 'fixture', query, contract: currentContract }).results);
  const pick = (code, quantity, currentContract = contract) => {
    const result = search(code, currentContract).find(item => item.code === code);
    assert.ok(result, code);
    return { ...result, lineId: 'line-' + code, quantity, totalValue: Math.round(result.referenceValue * quantity * 100) / 100 };
  };
  const record = (services = [pick('0123', 2), pick('S002', 3)]) => ({
    recordId: id(940), user: actor, base: 'CURRAIS NOVOS', contract, team: 'Equipe Fixture', crewLeader: 'Chefe Fixture',
    occurrenceNumber: 'FIXTURE-0001', occurrenceTypes: ['PODA'], transformer: {}, services,
    materials: [{ lineId: 'm', code: '000123', description: 'MATERIAL', unit: 'UD', quantity: 1 }],
    observation: 'Fixture', expectedPhotoIndexes: [1, 2, 3, 4, 5]
  });
  const submit = (value, client = {}) => h.c.submitRecord_({ token: 'fixture', record: value, ...client });
  return { h, catalog, pending: h.sheet(APP.pendingSheet), search, pick, record, submit };
}
const issue = (code, reason, serviceIndex = 1) => error => error.code === code
  && error.details.catalogIssue.reason === reason && error.details.catalogIssue.serviceIndex === serviceIndex;

test('versão 49 reproduz CATALOG_MISMATCH no serviço 2 após inserção, sem gravar dados', () => {
  const h = setup(makeBaseline);
  const draft = h.record();
  h.catalog.rows.splice(3, 0, other);
  assert.throws(() => h.submit(draft), error => error.code === 'CATALOG_MISMATCH' && /serviço 2/.test(error.message));
  assert.equal(h.pending.getLastRow(), 1);
});

for (const [label, change] of [
  ['inserção', rows => rows.splice(3, 0, other)],
  ['ordenação', rows => rows.splice(2, 2, second, first)],
  ['exclusão de linha antecedente', rows => rows.splice(2, 1)]
]) test('referência antiga após ' + label + ' preserva a seleção, o contrato e a releitura v12', () => {
  const h = setup(make, [other, first, second]);
  const draft = h.record();
  if (label === 'ordenação') h.catalog.rows.splice(2, 3, second, first, other);
  else change(h.catalog.rows);
  const result = h.submit(draft, { clientVersion: '2026.11.09.2' });
  assert.ok(dataCommitMatches(draft, result));
  assert.equal(result.record.totalServices, 72.2);
  assert.equal(result.record.services[0].code, '0123');
  assert.equal(result.record.services[1].catalogKey, draft.services[1].catalogKey);
  assert.equal(result.record.services[1].referenceValue, 12.5);
  assert.equal(result.recordId, draft.recordId);
  assert.equal(result.photoStates.filter(photo => photo.confirmed).length, 0);
  assert.equal(h.pending.getLastRow(), 2);
});

test('a criação valida todos os serviços contra um único retrato do catálogo e aceita cada contrato válido', () => {
  const h = setup();
  const draft = h.record([h.pick('0123', 2, '4600080939'), h.pick('S002', 1, '4600080939')]);
  draft.base = 'MOSSORÓ'; draft.contract = '4600080939';
  const reads = h.catalog.reads;
  const result = h.submit(draft);
  assert.equal(h.catalog.reads - reads, 1);
  assert.equal(result.record.services[0].referenceValue, 20.41);
  assert.equal(result.record.services[0].quantity, 2);
});

test('código removido nunca é substituído por código semelhante com zeros diferentes', () => {
  const h = setup(make, [first, second, other]);
  const draft = h.record();
  h.catalog.rows.splice(2, 1);
  assert.throws(() => h.submit(draft), issue('CATALOG_MISMATCH', 'NOT_FOUND'));
  assert.equal(h.pending.getLastRow(), 1);
});

test('duplicata com identidade igual exige resolução do catálogo mesmo na linha original', () => {
  const h = setup(); const draft = h.record();
  h.catalog.rows.push(row('S002', second[1], '51,20'));
  assert.throws(() => h.submit(draft), issue('CATALOG_MISMATCH', 'AMBIGUOUS', 2));
  assert.equal(h.search('S002').filter(item => item.catalogAmbiguous).length, 2);
  assert.equal(h.pending.getLastRow(), 1);
});

test('duplicatas distinguíveis só passam após seleção inequívoca na linha atual', () => {
  const h = setup(); const draft = h.record([h.pick('0123', 2)]);
  const alternate = row('0123', 'SERVIÇO COM OUTRA IDENTIDADE', '22,50');
  h.catalog.rows.splice(2, 0, alternate);
  assert.throws(() => h.submit(draft), issue('CATALOG_MISMATCH', 'AMBIGUOUS'));
  const choices = h.search('0123');
  assert.equal(choices.length, 2);
  assert.ok(choices.every(item => !item.catalogAmbiguous));
  const selected = choices.find(item => item.catalogText === first[1]);
  const complete = h.submit({ ...draft, services: [{ ...draft.services[0], ...selected }] });
  assert.equal(complete.record.services[0].catalogKey, 'Emergência:4');
  assert.equal(complete.record.services[0].totalValue, 34.7);
});

for (const [name, alter, error, reason] of [
  ['descrição alterada', (h, draft) => { h.catalog.rows[2][1] = 'ALTERADO'; }, 'CATALOG_MISMATCH', 'IDENTITY_CHANGED'],
  ['preço alterado na mesma linha', (h, draft) => { h.catalog.rows[2][7] = '22,00'; }, 'CATALOG_MISMATCH', 'PRICE_CHANGED'],
  ['preço alterado e linha deslocada', (h, draft) => { h.catalog.rows[2][7] = '22,00'; h.catalog.rows.splice(2, 0, other); }, 'CATALOG_MISMATCH', 'PRICE_CHANGED'],
  ['sem preço', (h, draft) => { h.catalog.rows[2][7] = ''; }, 'SERVICE_PRICE_NOT_FOUND', 'PRICE_NOT_FOUND'],
  ['quantidade inválida', (h, draft) => { draft.services[0].quantity = -1; }, 'INVALID_QUANTITY', 'INVALID_QUANTITY'],
  ['contrato forjado', (h, draft) => { draft.services[0].contract = '4600080939'; }, 'CATALOG_MISMATCH', 'CONTRACT_CHANGED'],
  ['valor unitário forjado', (h, draft) => { draft.services[0].referenceValue = 0.01; }, 'CATALOG_MISMATCH', 'PRICE_CHANGED'],
  ['total forjado', (h, draft) => { draft.services[0].totalValue = 0.01; }, 'CATALOG_MISMATCH', 'TOTAL_CHANGED'],
  ['referência legada incompleta deslocada', (h, draft) => { delete draft.services[0].unit; h.catalog.rows.splice(2, 0, other); }, 'CATALOG_MISMATCH', 'IDENTITY_CHANGED']
]) test(name + ' impede escrita antes das fotos', () => {
  const h = setup(); const draft = h.record();
  alter(h, draft);
  assert.throws(() => h.submit(draft), issue(error, reason));
  assert.equal(h.pending.getLastRow(), 1);
});

test('seleção explícita do preço vigente usa o valor oficial e conserva o UUID', () => {
  const h = setup(); const draft = h.record();
  h.catalog.rows[2][7] = '22,00';
  assert.throws(() => h.submit(draft), issue('CATALOG_MISMATCH', 'PRICE_CHANGED'));
  const updated = { ...draft, services: [h.pick('0123', 2), draft.services[1]] };
  const result = h.submit(updated);
  assert.equal(result.record.totalServices, 81.5);
  assert.ok(dataCommitMatches(updated, result));
  assert.equal(result.record.recordId, draft.recordId);
});

test('compatibilidade de diagnóstico: fila legada e fila nova aguardam ação; dados HTTP privados ficam de fora', () => {
  const legacy = { status: 'ERRO_SINCRONIZACAO', lastError: 'O serviço 2 diverge da aba Emergência. Pesquise novamente.' };
  assert.deepEqual(catalogQueueIssue(legacy), {});
  assert.equal(canQueueRetry(legacy, true), false);
  const details = { details: { catalogIssue: { serviceIndex: 2, reason: 'PRICE_CHANGED', fields: ['referenceValue'], secret: 'fixture' } } };
  const diagnostic = synchronizationDiagnostic({ code: 'CATALOG_MISMATCH', details }, { stage: 'submit_data' });
  assert.deepEqual(diagnostic.catalogIssue, { serviceIndex: 2, reason: 'PRICE_CHANGED' });
  assert.equal(canQueueRetry({ ...legacy, lastSyncError: diagnostic }, true), false);
});
