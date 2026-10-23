import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../core.js';
import { fixtureFactory, seedKeys, keyValues, plain, id } from './chaves-fixtures.mjs';

if (!process.argv[2] || !process.argv[3]) throw Error('Informe candidato e baseline oficiais privados.');
const [candidate, baseline] = await Promise.all(process.argv.slice(2, 4).map(file => readFile(file, 'utf8')));
const [make, makeOld] = await Promise.all([fixtureFactory(candidate), fixtureFactory(baseline)]);
const tests = [], test = (name, run) => tests.push({ name, run });
const snapshot = h => JSON.stringify([...h.sheets.values()].map(sheet => sheet.rows));

test('esquema mantém as 46 posições e acrescenta somente cinco colunas', () => {
  const h = make(), old = makeOld();
  for (const [key, value] of Object.entries(old.c.meta.COL)) if (key !== 'WIDTH') assert.equal(h.c.meta.COL[key], value, key);
  assert.equal(h.c.meta.COL.WIDTH, 51);
  assert.deepEqual(plain(h.c.meta.MAIN_HEADERS.slice(0, 46)), plain(old.c.meta.MAIN_HEADERS));
  assert.deepEqual(plain(h.c.meta.HISTORY_HEADERS), plain(old.c.meta.HISTORY_HEADERS));
});
test('instalação aditiva preserva todas as células históricas e é idempotente', () => {
  const h = make(); h.add(1); const { APP } = h.c.meta;
  const pending = h.sheet(APP.pendingSheet), official = h.sheet(APP.officialSheet);
  for (const sheet of [pending, official]) sheet.rows = sheet.rows.map(row => row.slice(0, 46));
  const before = JSON.stringify(pending.rows[1]); h.c.installChavesSchema_();
  assert.equal(JSON.stringify(pending.rows[1]), before);
  assert.equal(pending.rows[0].length, 51);
  const writes = pending.writes + official.writes; h.c.installChavesSchema_();
  assert.equal(pending.writes + official.writes, writes);
});
test('conflito na segunda aba interrompe instalação antes de qualquer gravação', () => {
  const h = make(), { APP } = h.c.meta;
  const pending = h.sheet(APP.pendingSheet), official = h.sheet(APP.officialSheet);
  pending.rows[0] = pending.rows[0].slice(0, 46); official.rows[0][46] = 'COLUNA EXISTENTE';
  const before = snapshot(h);
  assert.throws(() => h.c.installChavesSchema_(), error => error.code === 'CHAVES_SCHEMA_CONFLICT');
  assert.equal(snapshot(h), before);
});
test('primeira gravação além da última linha alocada expande somente o fim da aba', () => {
  const h = make(); let maximum = 2; const calls = [];
  h.c.formatChavesRow_({ getMaxRows: () => maximum,
    insertRowsAfter: (after, count) => { calls.push([after, count]); maximum += count; },
    getRange: (row, column, height, width) => {
      assert.ok(row + height - 1 <= maximum); assert.equal(column, 47); assert.equal(width, 4);
      return { setNumberFormat: format => assert.equal(format, '@') };
    }
  }, 3, 1);
  assert.deepEqual(calls, [[2, 1]]);
});
for (const key of core.CHAVES_FIELDS) test('nova CHAVES exige ' + key, () => {
  const h = make(); seedKeys(h); const record = h.c.recordFromValuesAt_(h.row(1)); record[key] = '';
  assert.throws(() => h.c.validateAndNormalizeRecord_(record, { serviceMode: 'snapshot', original: record }), error => error.code === 'CHAVES_FIELD_REQUIRED');
});
test('CHAVES nova sem marcador também exige os quatro campos no backend', () => {
  const h = make(); seedKeys(h); const record = h.c.recordFromValuesAt_(h.row(1)); delete record.formVersion; record.pgKeyRemoved = '';
  assert.throws(() => h.c.validateAndNormalizeRecord_(record), error => error.code === 'CHAVES_FIELD_REQUIRED');
});
test('rascunho anterior com versão zero conserva a classificação no primeiro envio', () => {
  const h = make(); h.add(1); const old = h.c.recordFromValuesAt_(h.row(1));
  const model = h.c.validateAndNormalizeRecord_({ ...old, formVersion: 0, occurrenceTypes: ['CHAVES'] }, { serviceMode: 'snapshot', original: undefined });
  assert.equal(model.formVersion, 0); assert.equal(model.pgKeyRemoved, '');
});
test('PG/BTO alfanuméricos e zeros são relidos como texto sem mudar o catálogo', () => {
  const h = make(); seedKeys(h); const record = h.c.recordFromValuesAt_(h.row(1));
  for (const key of core.CHAVES_FIELDS) assert.equal(record[key], keyValues[key]);
  assert.equal(h.catalog.reads, 0);
  assert.deepEqual(plain(h.c.correctionDataFromValues_(h.row(1))).formVersion, 1);
});
test('novo envio persiste versão e códigos; retry reutiliza o mesmo UUID', () => {
  const h = make(); h.add(1); const old = h.c.recordFromValuesAt_(h.row(1));
  const record = { ...old, recordId: id(10), occurrenceTypes: ['CHAVES'], formVersion: 1, ...keyValues, services: [{ code: 'D', catalogKey: 'Emergência:3', quantity: 1 }] };
  h.catalog.rows[2] = ['D', 'Serviço fixture', 'UN', 'Fixture', '', '', '', '100', '100'];
  const submit = () => h.c.submitRecord_({ token: h.token('field'), record });
  const first = submit(), retry = submit();
  assert.equal(first.recordId, id(10)); assert.equal(retry.recordId, id(10));
  assert.equal(h.sheet(h.c.meta.APP.pendingSheet).rows.filter(row => row[0] === id(10)).length, 1);
  for (const key of core.CHAVES_FIELDS) assert.equal(retry.record[key], keyValues[key]);
  assert.equal(retry.record.formVersion, 1);
});
test('Fiscal corrige somente BTO de CHAVES, conserva UUID, beforePatch e recibo idempotente', () => {
  const h = make(); h.grant(); seedKeys(h); h.add(2); h.request(1);
  h.row(1)[h.c.meta.COL.TYPES - 1] = 'CHAVES | SUBSTITUIÇÃO DE POSTE';
  h.row(1)[h.c.meta.COL.PG_POST_REMOVED - 1] = '000POSTE-RET';
  h.row(1)[h.c.meta.COL.PG_POST_INSTALLED - 1] = '000POSTE-INS';
  const untouched = JSON.stringify(h.row(2)), opened = h.open(1), before = plain(opened);
  const payload = h.payload(opened, { btoKeyInstalled: '0000099-REVISADO' });
  const result = h.submit(payload), retry = h.submit(payload);
  assert.equal(result.recordId, id(1)); assert.equal(result.status, 'AGUARDANDO_SUPERVISOR');
  assert.equal(retry.record.audit.lastCorrectionSubmission.requestId, payload.correctionRequestId);
  assert.deepEqual(plain(result.record.audit.lastCorrectionSubmission.expectedPatch), { btoKeyInstalled: '0000099-REVISADO' });
  assert.deepEqual(plain(result.record.audit.lastCorrectionSubmission.beforePatch), { btoKeyInstalled: keyValues.btoKeyInstalled });
  for (const key of ['services', 'materials', 'transformer', 'pgPostRemoved', 'pgConductorStart']) assert.deepEqual(plain(result.record[key]), before[key]);
  assert.equal(JSON.stringify(h.row(2)), untouched);
});
test('Supervisor consulta, audita e corrige PG de CHAVES sem edição financeira', () => {
  const h = make(); seedKeys(h); const before = h.c.recordFromValuesAt_(h.row(1));
  const result = h.c.supervisorCorrectRecord_({ token: h.token('supervisor'), record: { ...before, pgKeyRemoved: '00001-REV' } });
  assert.equal(result.record.pgKeyRemoved, '00001-REV');
  assert.equal(result.record.totalServices, before.totalServices);
  assert.ok(result.record.audit.lastSupervisorCorrection.changes.some(change => change.field === 'PG da chave retirada'));
  const document = h.c.getOccurrenceDocument_({ token: h.token('supervisor'), recordId: id(1), detail: true });
  assert.equal(document.record.pgKeyRemoved, '00001-REV');
  h.grant();
  assert.equal(h.c.getOccurrenceDocument_({ token: h.login(), recordId: id(1), detail: true }).record.pgKeyRemoved, '00001-REV');
});
test('retirar CHAVES limpa somente os quatro códigos no delta e no servidor', () => {
  const h = make(); h.grant(); seedKeys(h); h.request(1); const record = h.open(1);
  const changes = { occurrenceTypes: ['PODA'], ...Object.fromEntries(core.CHAVES_FIELDS.map(key => [key, ''])) };
  const result = h.submit(h.payload(record, changes));
  for (const key of core.CHAVES_FIELDS) assert.equal(result.record[key], '');
  assert.equal(result.record.formVersion, 1);
});
test('correção direta em registro legado formata os novos códigos como texto antes de gravar', () => {
  const h = make(); h.add(1);
  const sheet = h.sheet(h.c.meta.APP.pendingSheet), getRange = sheet.getRange.bind(sheet), formats = [];
  sheet.getRange = (...args) => {
    const range = getRange(...args), format = range.setNumberFormat;
    range.setNumberFormat = value => { formats.push([...args, value]); return format(value); }; return range;
  };
  const before = h.c.recordFromValuesAt_(h.row(1));
  const result = h.c.supervisorCorrectRecord_({ token: h.token('supervisor'), record: { ...before, occurrenceTypes: ['CHAVES'], ...keyValues } });
  assert.ok(formats.some(args => args[0] === 2 && args[1] === 47 && args[3] === 4 && args[4] === '@'));
  assert.equal(result.record.btoKeyRemoved, '000034');
  assert.equal(Number(result.record.formVersion || 0), 0);
});
test('edição recente não promove registro histórico nem exige campos retroativos', () => {
  const h = make(); h.grant(); h.add(1); h.request(1); const record = h.open(1);
  const result = h.submit(h.payload(record, { formVersion: 1, updatedAt: '2030-01-01', occurrenceTypes: ['CHAVES'] }));
  assert.equal(Number(result.record.formVersion || 0), 0);
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR');
});
test('fingerprints legados permanecem idênticos ao backend anterior', () => {
  const h = make(), old = makeOld(); h.add(1); old.add(1);
  assert.equal(h.c.correctionFingerprint_(h.c.correctionDataFromValues_(h.row(1))), old.c.correctionFingerprint_(old.c.correctionDataFromValues_(old.row(1))));
});
test('recibo legado COMPLETE continua confirmado e publicável após extensão', () => {
  const old = makeOld(); old.grant(); old.add(1); old.request(1);
  old.submit(old.payload(old.open(1), { observation: 'Correção histórica concluída' }));
  const h = make(); h.grant();
  for (const [name, sheet] of old.sheets) if (h.sheets.has(name)) h.sheets.get(name).rows = [h.sheets.get(name).rows[0], ...sheet.rows.slice(1).map(row => row.slice())];
  const row = h.row(1), audit = h.audit(1);
  assert.equal(h.c.correctionFingerprint_(h.c.correctionDataFromValues_(row)), audit.lastCorrectionSubmission.expectedFingerprint);
  assert.equal(h.c.operationalStatusFromValues_(row), 'AGUARDANDO_SUPERVISOR');
  const prepared = h.c.preparePublicationSnapshot_(id(1), 'Supervisor A', '', []);
  assert.equal(Number(prepared.model.formVersion || 0), 0);
});

let passed = 0; const failures = [];
for (const item of tests) {
  try { await item.run(); passed++; } catch (error) { failures.push({ test: item.name, error: String(error.stack || error) }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures, productionWrites: 0 }, null, 2));
if (failures.length) process.exitCode = 1;
