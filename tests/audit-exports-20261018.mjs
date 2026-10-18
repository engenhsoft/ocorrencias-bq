// Isolated fixtures only. No operational accounts or production requests.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as core from '../core.js';
import { buildConformityComparison } from '../supervisor-conformity.js';
import { excelSelectableRecords } from '../operational-features.js';
import { collectExcelEntries, buildOccurrenceWorkbook, excelRecordData } from '../occurrence-excel.js';
import { createOccurrencePdf } from '../occurrence-pdf.js';
import { fiscalCardMarkup } from '../occurrence-card.js';

const require = createRequire(import.meta.url);
const ExcelJS = require('../vendor/exceljs-4.4.0.min.js'), pdfLib = require('../vendor/pdf-lib-1.17.1.min.js');
const [logoBytes, features, pdfSource] = await Promise.all(['assets/icon-192.png', 'operational-features.js', 'occurrence-pdf.js'].map(name => readFile(new URL('../' + name, import.meta.url), name.endsWith('.js') ? 'utf8' : undefined)));
const uuid = 'aaaaaaaa-1111-4111-8111-111111111111', at = '2026-10-18T12:00:00-03:00';
const fixture = extras => ({ recordId: uuid, occurrenceNumber: 'FIXTURE-AUDIT', status: 'PUBLICADA', registeredAt: at, base: 'CAICÓ', team: 'Equipe FICTÍCIA', user: 'Campo FICTÍCIO', crewLeader: 'Chefe FICTÍCIO', occurrenceTypes: ['PODA'], services: [], materials: [], audit: { timeline: [{ actor: 'Supervisor FICTÍCIO', action: 'PUBLICADA', at }] }, photoSlots: [], ...extras });
const tests = [], test = (name, run) => tests.push({ name, run });
const variants = () => [fixture(), fixture({ recordId: uuid.toUpperCase() })];
const pdf = record => createOccurrencePdf(record, { pdfLib, logoBytes: new Uint8Array(logoBytes) });

test('conformidade conta UUID sem distinguir maiúsculas uma única vez', () => {
  assert.equal(buildConformityComparison(variants(), { month: '2026-10' }).totals.approved, 1);
});
test('seleção Excel deduplica UUID canônico sem mudar o identificador recebido', () => {
  const selected = excelSelectableRecords(variants(), { role: 'supervisor' });
  assert.equal(selected.length, 1); assert.ok([uuid, uuid.toUpperCase()].includes(selected[0].recordId));
});
test('coleta Excel consulta o mesmo UUID apenas uma vez', async () => {
  const calls = [];
  const entries = await collectExcelEntries([uuid, uuid.toUpperCase()], { getRecord: async recordId => { calls.push(recordId); return { record: fixture({ recordId }) }; } });
  assert.equal(calls.length, 1); assert.equal(entries.length, 1); assert.equal(entries[0].photos.length, 5);
});
test('coleta Excel preserva o suporte a coleções iteráveis existentes', async () => {
  const entries = await collectExcelEntries(new Set([uuid]), { getRecord: async recordId => ({ record: fixture({ recordId }) }) });
  assert.equal(entries.length, 1);
  await assert.rejects(collectExcelEntries(undefined), /Selecione ocorrências válidas/);
});
test('workbook Excel não duplica UUID canônico nas quatro abas', async () => {
  const entries = variants().map(record => ({ record: excelRecordData({ ...record, services: [{ code: '00001', quantity: 1.25 }], materials: [{ code: '00002', quantity: 2.75 }] }), photos: [{ photoIndex: 1, message: 'Pendente' }] }));
  const output = await buildOccurrenceWorkbook(entries, { ExcelJS }), workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output.bytes);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['OCORRÊNCIAS', 'SERVIÇOS', 'MATERIAIS', 'FOTOGRAFIAS']);
  for (const sheet of workbook.worksheets) assert.equal(sheet.rowCount, 2, sheet.name);
  assert.equal(workbook.getWorksheet('SERVIÇOS').getCell('C2').value, '00001');
});
test('PDF mantém os cinco slots obrigatórios quando o servidor retorna lista vazia', async () => {
  const result = await pdf(fixture()); assert.equal(result.photos.length, 5);
  assert.deepEqual(result.photos.map(photo => photo.photoIndex), [1, 2, 3, 4, 5]);
  assert.ok(result.photos.every(photo => !photo.available));
});
test('PDF Trafo deduplica slots e recusa índices fora do escopo e confirmação malformada', async () => {
  const calls = [];
  const result = await createOccurrencePdf(fixture({ occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], photoSlots: [{ photoIndex: 1, confirmed: 'false' }, { photoIndex: 1, confirmed: 'false' }, { photoIndex: 99, confirmed: true }, { recordId: 'bbbbbbbb-1111-4111-8111-111111111111', photoIndex: 2, confirmed: true }] }), { pdfLib, logoBytes: new Uint8Array(logoBytes), getPhoto: async index => { calls.push(index); return { recordId: uuid, photoIndex: index, available: false }; } });
  assert.deepEqual(result.photos.map(photo => photo.photoIndex), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(calls, []);
});
test('falha de inicialização da biblioteca PDF permite nova tentativa', async () => {
  let appends = 0;
  const context = vm.createContext({ ...core, setTimeout, Uint8Array, atob, URL, document: { createElement: () => ({ remove() {} }), head: { append(script) { appends++; setImmediate(() => { if (appends > 1) context.PDFLib = { fixture: true }; script.onload(); }); } } } });
  vm.runInContext(pdfSource.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', "'file:///fixture/'") + '\nthis.load = loadPdfLibrary;', context);
  await assert.rejects(context.load(), /Biblioteca PDF indisponível/);
  assert.equal((await context.load()).fixture, true); assert.equal(appends, 2);
});
test('dois botões PDF da mesma ocorrência não duplicam consulta simultânea', async () => {
  const listeners = {}, hosts = new Map(); let calls = 0, finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const host = selector => { if (!hosts.has(selector)) hosts.set(selector, { innerHTML: '', textContent: '', value: '', hidden: true, setAttribute() {}, removeAttribute() {} }); return hosts.get(selector); };
  const context = vm.createContext({ ...core, console, navigator: { onLine: true }, createFiscalAdmin: () => ({ reset() {}, enter() {} }), createFiscalWorkspace: () => ({ reset() {}, enter() {} }), api: { async getOccurrenceDocument() { calls++; await pending; throw new Error('Falha simulada recuperável'); } }, document: { querySelector: host, querySelectorAll: () => [], addEventListener(type, handler) { listeners[type] = handler; } } });
  vm.runInContext(features.replace(/^import .*?;\n/gm, '').replace(/^export /gm, ''), context);
  context.createOperationalFeatures({ getSession: () => ({ token: 'fixture-only', role: 'supervisor' }), getRevision: () => 1, onLogout() {} });
  const button = () => ({ textContent: 'GERAR PDF', disabled: false, dataset: { exportRecord: uuid }, hasAttribute: () => false });
  const first = button(), second = button();
  listeners.click({ target: { closest: () => first } }); listeners.click({ target: { closest: () => second } });
  try { assert.equal(calls, 1); assert.equal(first.disabled, true); }
  finally { finish(); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(first.disabled, false);
  listeners.click({ target: { closest: () => first } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2, 'falha recuperável permite nova tentativa'); assert.equal(first.disabled, false);
});
test('texto não confiável permanece literal no XLSX e escapado nos cartões', async () => {
  const dangerous = '=HYPERLINK("https://fixture.invalid","literal")';
  const output = await buildOccurrenceWorkbook([{ record: excelRecordData(fixture({ observation: dangerous, crewLeader: '<img src=x onerror=alert(1)>', services: [{ code: '00042', catalogText: dangerous, quantity: 1.25 }], materials: [{ code: '00001', description: '@SUM(1+1)', quantity: 2.75 }] })), photos: [] }], { ExcelJS });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(output.bytes);
  assert.equal(workbook.getWorksheet('SERVIÇOS').getCell('D2').value, dangerous);
  assert.equal(workbook.getWorksheet('SERVIÇOS').getCell('D2').type, ExcelJS.ValueType.String);
  assert.doesNotMatch(fiscalCardMarkup(fixture({ crewLeader: '<img src=x onerror=alert(1)>' })), /<img src=x/);
});

let passed = 0; const failures = [];
for (const { name, run } of tests) { try { await run(); passed++; } catch (error) { failures.push({ name, error: error.stack }); } }
const result = { total: tests.length, passed, failed: failures.length, productionWrites: 0, failures };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2)); if (failures.length) process.exitCode = 1;
