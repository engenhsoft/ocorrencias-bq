import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../core.js', import.meta.url), 'utf8');
const core = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const tests = [];
const test = (name, run) => tests.push({ name, run });

const APRUMAR_POSTE = {
  catalogKey: 'Emergência:7', code: 'SDMMU4042SC', catalogText: 'APRUMAR POSTE', unit: 'UD', group: 'REDES EMERGÊNCIA',
  contractValues: { '4600080938': 87.02, '4600080939': 96.30 }, quantity: 1
};
const APRUMAR_POSTE_LV = {
  catalogKey: 'Emergência:8', code: 'SDMVU4042SC', catalogText: 'APRUMAR POSTE LV', unit: 'UD', group: 'LV EMERGÊNCIA',
  contractValues: { '4600080938': 'R$ 612,14', '4600080939': '712,33' }, quantity: 1
};

for (const [base, contract] of [
  ['CARAÚBAS', '4600080938'], ['PAU DOS FERROS', '4600080938'], ['CURRAIS NOVOS', '4600080938'], ['CAICÓ', '4600080938'],
  ['MOSSORÓ', '4600080939'], ['ASSÚ', '4600080939']
]) test(`${base} deriva o contrato ${contract}`, () => assert.equal(core.contractForBase(base), contract));

test('CARAÚBAS usa H no SDMMU4042SC', () => assert.equal(core.priceServiceForContract(APRUMAR_POSTE, core.contractForBase('CARAÚBAS')).referenceValue, 87.02));
test('MOSSORÓ usa I no SDMMU4042SC', () => assert.equal(core.priceServiceForContract(APRUMAR_POSTE, core.contractForBase('MOSSORÓ')).referenceValue, 96.30));
test('CARAÚBAS usa H no SDMVU4042SC', () => assert.equal(core.priceServiceForContract(APRUMAR_POSTE_LV, core.contractForBase('CARAÚBAS')).referenceValue, 612.14));
test('MOSSORÓ usa I no SDMVU4042SC', () => assert.equal(core.priceServiceForContract(APRUMAR_POSTE_LV, core.contractForBase('MOSSORÓ')).referenceValue, 712.33));

test('QTD 2 em CARAÚBAS totaliza R$ 174,04', () => {
  const result = core.repriceServicesForBase([{ ...APRUMAR_POSTE, quantity: 2 }], 'CARAÚBAS');
  assert.equal(result.contract, '4600080938');
  assert.equal(result.services[0].referenceValue, 87.02);
  assert.equal(core.occurrenceTotal(result.services), 174.04);
});

test('troca para MOSSORÓ mantém serviço e QTD e totaliza R$ 192,60', () => {
  const first = core.repriceServicesForBase([{ ...APRUMAR_POSTE, quantity: 2 }], 'CARAÚBAS');
  const next = core.repriceServicesForBase(first.services, 'MOSSORÓ');
  assert.equal(next.services.length, 1);
  assert.equal(next.services[0].code, 'SDMMU4042SC');
  assert.equal(next.services[0].quantity, 2);
  assert.equal(next.services[0].referenceValue, 96.30);
  assert.equal(core.occurrenceTotal(next.services), 192.60);
});

test('coluna E não é aceita como fallback', () => {
  const result = core.priceServiceForContract({ ...APRUMAR_POSTE, contractValues: {}, referenceValue: 42.63 }, '4600080938');
  assert.equal(result.referenceValue, null);
  assert.match(result.pricingError, /4600080938/);
});

test('valor ausente no contrato bloqueia validação', () => {
  const priced = core.priceServiceForContract({ ...APRUMAR_POSTE, contractValues: { '4600080938': 87.02 } }, '4600080939');
  const record = {
    base: 'MOSSORÓ', contract: '4600080939', team: 'LM 01', crewLeader: 'Chefe', occurrenceNumber: '1',
    occurrenceTypes: ['PODA'], services: [priced], materials: [{ description: 'Histórico', quantity: 1 }]
  };
  assert.ok(core.validateOccurrence(record).some((error) => error === 'Serviço sem valor cadastrado para o contrato 4600080939.'));
});

test('normalização histórica não inventa contrato ausente', () => {
  const historical = core.normalizeOccurrenceRecord({ base: 'MOSSORÓ', status: 'PUBLICADA', services: [{ code: 'S1', referenceValue: 10 }] });
  assert.equal(historical.contract, undefined);
  assert.equal(historical.services[0].referenceValue, 10);
});

test('auditoria da correção registra Sub-base Contrato e Total', () => {
  const before = { base: 'CARAÚBAS', contract: '4600080938', services: core.repriceServicesForBase([{ ...APRUMAR_POSTE, quantity: 2 }], 'CARAÚBAS').services };
  const after = { base: 'MOSSORÓ', contract: '4600080939', services: core.repriceServicesForBase(before.services, 'MOSSORÓ').services };
  const fields = core.supervisorCorrectionChanges(before, after).map((change) => change.field);
  assert.ok(fields.includes('Sub-base'));
  assert.ok(fields.includes('Contrato'));
  assert.ok(fields.includes('Total dos serviços'));
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try { await item.run(); passed += 1; }
  catch (error) { failures.push({ test: item.name, error: `${error.name}: ${error.message}` }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
