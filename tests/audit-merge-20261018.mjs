// Collection merge contract; no I/O beyond reading the tested source/result.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.env.OCCBQ_FRONTEND_SOURCE || path.resolve(new URL('../', import.meta.url).pathname);
const core = await import('data:text/javascript;base64,' + Buffer.from(await readFile(path.join(root, 'core.js'), 'utf8')).toString('base64'));
const ID = '11111111-2222-4333-8444-555555555555', OTHER = '22222222-2222-4222-8222-222222222222';
const service = code => ({ code, catalogText: 'Serviço fixture', unit: 'UN', quantity: 1, referenceValue: 10, totalValue: 10 });
const material = code => ({ code, description: 'Material fixture', unit: 'UN', quantity: 1 });
const local = () => ({ recordId: ID, services: [service('S-OLD')], materials: [material('000001')] });
const merge = (old, remote) => core.mergeRecordCollections([old], [remote])[0];
const tests = [], test = (name, run) => tests.push({ name, run });
for (const field of ['services', 'materials']) {
  test(`${field}: array explicitamente vazio do servidor elimina itens locais antigos`, () => assert.deepEqual(merge(local(), { recordId: ID, [field]: [] })[field], []));
  test(`${field}: vazio continua autoritativo depois de normalizações repetidas`, () => {
    const remote = core.normalizeOccurrenceRecord(core.normalizeOccurrenceRecord({ recordId: ID, [field]: [] }));
    assert.deepEqual(merge(local(), remote)[field], []);
  });
  test(`${field}: resposta resumida que omite campo conserva coleção local`, () => {
    assert.equal(merge(local(), { recordId: ID, status: 'PUBLICADA' })[field][0].code, local()[field][0].code);
  });
  test(`${field}: resumo normalizado que omite campo não se transforma em exclusão`, () => {
    const remote = core.normalizeOccurrenceRecord(core.normalizeOccurrenceRecord({ recordId: ID, status: 'PUBLICADA' }));
    assert.equal(merge(local(), remote)[field][0].code, local()[field][0].code);
  });
  test(`${field}: payload malformado não apaga histórico local`, () => {
    assert.equal(merge(local(), core.normalizeOccurrenceRecord({ recordId: ID, [field]: {} }))[field][0].code, local()[field][0].code);
    assert.equal(merge(local(), core.normalizeOccurrenceRecord({ recordId: ID, [field]: [null, 'invalid'] }))[field][0].code, local()[field][0].code);
  });
  test(`${field}: correção local pendente mantém edição e exclusão ainda não confirmadas`, () => {
    const edited = field === 'services' ? service('S-EDITED') : material('000002');
    assert.equal(merge({ ...local(), correctionMode: true, [field]: [edited] }, { recordId: ID, [field]: [] })[field][0].code, edited.code);
    assert.deepEqual(merge({ ...local(), correctionMode: true, [field]: [] }, local())[field], []);
  });
}
test('substituição válida não combina coleção antiga e nova nem remove outro UUID', () => {
  const result = core.mergeRecordCollections([local(), { recordId: OTHER, materials: [material('000003')] }], [{ recordId: ID, services: [service('S-NEW')], materials: [material('000002')] }]);
  assert.deepEqual(result.find(record => record.recordId === ID).materials.map(item => item.code), ['000002']);
  assert.deepEqual(result.find(record => record.recordId === ID).services.map(item => item.code), ['S-NEW']);
  assert.deepEqual(result.find(record => record.recordId === OTHER).materials.map(item => item.code), ['000003']);
});
const failures = []; let passed = 0;
for (const { name, run } of tests) { try { await run(); passed++; } catch (error) { failures.push({ name, error: error.stack }); } }
const result = { total: tests.length, passed, failed: failures.length, productionRequests: 0, productionWrites: 0, failures };
console.log(JSON.stringify(result, null, 2)); if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2)); if (failures.length) process.exitCode = 1;
