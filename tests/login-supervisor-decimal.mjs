import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const tests = [];
const test = (name, run) => tests.push({ name, run });

const coreSource = await read('core.js');
const appSource = await read('app.js');
const apiSource = await read('api.js');
const cssSource = await read('styles.css');
const core = await import(dataUrl(coreSource));

for (const [input, expected] of [['15,50', 15.5], ['15.50', 15.5], ['0,75', 0.75], ['0.75', 0.75], ['2,5', 2.5], ['2.5', 2.5], ['125,567', 125.567], ['125.567', 125.567], ['1', 1]]) {
  test(`QTD de serviço aceita ${input}`, () => assert.equal(core.parseServiceQuantity(input), expected));
}

test('QTD decimal conserva valor no total e no payload', () => {
  const service = { catalogKey: 's1', code: 'S1', quantity: '15,50', referenceValue: 2, contract: '4600080939' };
  assert.equal(core.serviceTotal(service), 31);
  assert.equal(core.serializeServicesForBackend([service])[0].quantity, 15.5);
});

test('validação aceita QTD positiva menor que 1', () => {
  const errors = core.validateOccurrence({
    base: 'MOSSORÓ', contract: '4600080939', team: 'E1', crewLeader: 'Chefe', occurrenceNumber: '1',
    occurrenceTypes: ['PODA'], services: [{ catalogKey: 's1', code: 'S1', quantity: '0,75', referenceValue: 2, contract: '4600080939' }],
    materials: [{ description: 'Material histórico', quantity: 1 }], photos: ['1', '2', '3']
  });
  assert.equal(errors.some((error) => error.includes('QTD válida')), false);
});

test('inputs de serviço usam teclado decimal sem step inteiro', () => {
  assert.equal((appSource.match(/data-(?:edit-)?service-quantity=/g) || []).length, 2);
  assert.equal((appSource.match(/type="text" inputmode="decimal" data-(?:edit-)?service-quantity=/g) || []).length, 2);
  assert.equal(/step="1"[^>]*data-(?:edit-)?service-quantity/.test(appSource), false);
});

test('login não aguarda a carga secundária do Supervisor', () => {
  assert.match(appSource, /if \(session\.role === 'supervisor'\)[\s\S]*?\n\s*navigate\('supervisor'\);/);
  assert.doesNotMatch(appSource, /await navigate\('supervisor'\)/);
});

test('Supervisor diferencia carregando, erro e lista sem duplicar request', () => {
  assert.match(appSource, /supervisorRefreshPromise && supervisorRefreshRevision === revision/);
  assert.match(appSource, /Carregando painel…/);
  assert.match(appSource, /Falha ao atualizar/);
  assert.match(appSource, /aria-busy/);
});

test('contador pluraliza pendência e pendências', () => {
  assert.match(appSource, /count === 1 \? 'pendência' : 'pendências'/);
  assert.doesNotMatch(appSource, /pendência\(s\)/);
});

test('contador tem destaque e proteção mobile', () => {
  assert.match(cssSource, /\.filter-summary\s*\{[\s\S]*?font-size:\s*1rem[\s\S]*?font-weight:\s*850/);
  assert.match(cssSource, /@media \(max-width:\s*640px\)[\s\S]*?\.filter-summary\s*\{[^}]*width:\s*100%/);
});

test('requests continuam protegidos por AbortController e timeout', () => {
  assert.match(apiSource, /new AbortController\(\)/);
  assert.match(apiSource, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
  assert.match(apiSource, /options\.timeoutMs \|\| 35000/);
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try { await item.run(); passed += 1; }
  catch (error) { failures.push({ test: item.name, error: `${error.name}: ${error.message}` }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
