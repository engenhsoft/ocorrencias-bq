import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as core from '../core.js';
import { excelRecordData, buildOccurrenceWorkbook } from '../occurrence-excel.js';
import { id, keyValues, extract } from './chaves-fixtures.mjs';

const require = createRequire(import.meta.url), ExcelJS = require('../vendor/exceljs-4.4.0.min.js');
const baseline = await import('data:text/javascript;base64,' + Buffer.from(execFileSync('git', ['show', '5685860:core.js'], { encoding: 'utf8' })).toString('base64'));
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const record = (changes = {}) => ({ recordId: id(1), formVersion: 1, occurrenceNumber: '00001-CHAVES', base: 'CAICÓ', contract: '4600080938', team: 'LM A', crewLeader: 'Chefe A', occurrenceTypes: ['CHAVES'], ...keyValues,
  services: [{ lineId: 's1', code: 'D', catalogKey: 'Emergência:3', catalogText: 'Serviço fixture', unit: 'UN', group: 'Fixture', contract: '4600080938', quantity: 1, referenceValue: 100, totalValue: 100 }],
  materials: [{ code: '00001', description: 'Material fixture', unit: 'UN', quantity: 1 }], photos: [], transformer: {}, observation: '', totalServices: 100, ...changes });
const tests = [], test = (name, run) => tests.push({ name, run });

test('CHAVES está na seleção múltipla', () => assert.ok(core.OCCURRENCE_TYPES.includes('CHAVES')));
test('nova ocorrência recebe versão de criação persistente', () => {
  const blank = vm.runInNewContext(extract(app, 'blankRecord') + '\nblankRecord()', { ...core, Date, session: { user: 'Campo fixture' } });
  assert.equal(blank.formVersion, 1);
});
for (const key of core.CHAVES_FIELDS) test('dados exigem somente o campo ausente: ' + key, () => {
  const errors = core.validateOccurrence(record({ [key]: '' }), { validationStage: 'data' });
  assert.equal(errors.length, 1); assert.match(errors[0], /chave/);
});
test('campos de dados válidos liberam fotos sem evidências antecipadas', () => assert.deepEqual(core.validateOccurrence(record(), { validationStage: 'data' }), []));
test('CHAVES mantém apenas o mínimo de três fotos gerais', () => {
  assert.deepEqual(core.validateOccurrence(record(), { validationStage: 'photos' }), ['Adicione pelo menos 3 fotos da ocorrência.']);
  assert.deepEqual(core.validateOccurrence(record({ photos: ['a', 'b', 'c'] }), { validationStage: 'final' }), []);
});
test('CHAVES + POSTE mantém PGs próprios e independentes', () => {
  const value = record({ occurrenceTypes: ['CHAVES', 'SUBSTITUIÇÃO DE POSTE'] });
  assert.equal(core.validateOccurrence(value, { validationStage: 'data' }).length, 2);
  assert.deepEqual(core.validateOccurrence({ ...value, pgPostRemoved: 'POSTE-R', pgPostInstalled: 'POSTE-I' }, { validationStage: 'data' }), []);
});
test('CHAVES + TRAFO mantém dados e duas fotografias especiais', () => {
  const value = record({ occurrenceTypes: ['CHAVES', 'SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '999999', removedCia: '0001', removedBto: '0002', newCode: '0003', newCia: '0004', newBto: '0005' } });
  assert.deepEqual(core.validateOccurrence(value, { validationStage: 'data' }), []);
  assert.equal(core.validateOccurrence({ ...value, photos: ['a', 'b', 'c'] }, { validationStage: 'photos' }).length, 2);
});
test('80 caracteres são aceitos, 81 são recusados sem conversão numérica', () => {
  assert.deepEqual(core.validateOccurrence(record({ pgKeyRemoved: '0'.repeat(80) }), { validationStage: 'data' }), []);
  assert.equal(core.validateOccurrence(record({ pgKeyRemoved: '0'.repeat(81) }), { validationStage: 'data' }).length, 1);
  assert.equal(core.normalizeOccurrenceRecord(record()).pgKeyRemoved, keyValues.pgKeyRemoved);
});
test('histórico permanece versão zero apesar de edição e criação aparentes recentes', () => {
  const old = record({ formVersion: undefined, updatedAt: '2030-01-01', createdAt: '2020-01-01', ...Object.fromEntries(core.CHAVES_FIELDS.map(key => [key, ''])) });
  const value = core.normalizeOccurrenceRecord(old);
  assert.equal(value.formVersion, 0); assert.deepEqual(core.validateOccurrence(value, { validationStage: 'data' }), []);
});
test('snapshots e assinaturas legadas continuam exatamente iguais', () => {
  const old = record({ formVersion: undefined, occurrenceTypes: ['PODA'], ...Object.fromEntries(core.CHAVES_FIELDS.map(key => [key, ''])) });
  assert.deepEqual(core.correctionDataSnapshot(old), baseline.correctionDataSnapshot(old));
  assert.deepEqual(core.correctionDelta({ data: baseline.correctionDataSnapshot(old) }, { ...old, observation: 'Revisada' }).expectedPatch, { observation: 'Revisada' });
});
test('delta de CHAVES registra valor anterior, UUID e somente o PG alterado', () => {
  const before = record(), after = { ...before, pgKeyInstalled: '00099-REV' };
  const delta = core.correctionDelta(core.correctionOriginalSnapshot(before), after);
  assert.deepEqual(delta.expectedPatch, { pgKeyInstalled: '00099-REV' });
  assert.deepEqual(delta.beforePatch, { pgKeyInstalled: keyValues.pgKeyInstalled });
  assert.equal(after.recordId, before.recordId);
});
test('remoção de CHAVES declara explicitamente os quatro códigos vazios', () => {
  const before = record(), after = record({ occurrenceTypes: ['PODA'], ...Object.fromEntries(core.CHAVES_FIELDS.map(key => [key, ''])) });
  const delta = core.correctionDelta(core.correctionOriginalSnapshot(before), after);
  for (const key of core.CHAVES_FIELDS) assert.equal(delta.expectedPatch[key], '');
});
test('Excel individual e múltiplo mantêm códigos string, formato texto e colunas antigas', async () => {
  const entries = [record(), record({ recordId: id(2) })].map(value => ({ record: excelRecordData(value), photos: [] }));
  for (const selected of [entries.slice(0, 1), entries]) {
    const output = await buildOccurrenceWorkbook(selected, { ExcelJS }), book = new ExcelJS.Workbook();
    await book.xlsx.load(output.bytes); const sheet = book.getWorksheet('OCORRÊNCIAS');
    assert.equal(sheet.rowCount, selected.length + 1);
    const headings = sheet.getRow(1).values;
    for (const [index, label] of ['PG chave retirada', 'BTO chave retirada', 'PG chave instalada', 'BTO chave instalada'].entries()) {
      const column = headings.indexOf(label);
      assert.equal(sheet.getCell(2, column).value, keyValues[core.CHAVES_FIELDS[index]]);
      assert.equal(sheet.getColumn(column).numFmt, '@');
    }
    assert.equal(sheet.getCell(2, headings.indexOf('Valor total')).value, 100);
  }
});

let passed = 0; const failures = [];
for (const item of tests) { try { await item.run(); passed++; } catch (error) { failures.push({ test: item.name, error: String(error.stack || error) }); } }
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures, productionWrites: 0 }, null, 2));
if (failures.length) process.exitCode = 1;
