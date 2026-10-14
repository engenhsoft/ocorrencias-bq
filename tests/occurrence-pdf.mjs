import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url), pdfLib = require('pdf-lib'), sharp = require('sharp');
const coreSource = await readFile(new URL('../core.js', import.meta.url), 'utf8');
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const pdfSource = await readFile(new URL('../occurrence-pdf.js', import.meta.url), 'utf8');
const context = vm.createContext({ ...core, Uint8Array, atob, Blob, setTimeout: done => done(), URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} } });
vm.runInContext(await readFile(new URL('../vendor/pdf-lib-1.17.1.min.js', import.meta.url), 'utf8'), context);
const browserPdfLib = vm.runInContext('PDFLib', context);
vm.runInContext(pdfSource.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', "'file:///fixture/'") + '\nthis.create = createOccurrencePdf; this.download = downloadOccurrencePdf; this.filename = occurrencePdfFilename;', context);
const output = new URL('../../evidence/pdf-fixtures/', import.meta.url); await mkdir(output, { recursive: true });
const logoBytes = await readFile(new URL('../assets/icon-192.png', import.meta.url));
const photos = [];
for (let i = 1; i <= 7; i++) {
  const bytes = await sharp({ create: { width: i % 2 ? 1400 : 500, height: i % 2 ? 700 : 1000, channels: 3, background: { r: 20 + i * 20, g: 90 + i * 10, b: 120 } } }).png().toBuffer();
  photos.push('data:image/png;base64,' + bytes.toString('base64'));
}
const base = { recordId: '11111111-1111-4111-8111-111111111111', occurrenceNumber: 'FIXTURE-001', user: 'Campo FICTÍCIO', base: 'CAICÓ', contract: '4600080938', team: 'LM FICTÍCIA', crewLeader: 'Chefe FICTÍCIO', registeredAt: '2026-10-14T09:00:00-03:00', updatedAt: '2026-10-14T10:00:00-03:00', reviewedAt: '2026-10-14T10:00:00-03:00', status: 'AGUARDANDO_SUPERVISOR', occurrenceTypes: ['PODA'], observation: 'Observação de teste com acentos, valores e condições operacionais.', services: [{ code: 'HISTORICO', catalogText: 'Serviço com preço histórico preservado', unit: 'UN', contract: '4600080938', quantity: 15.5, referenceValue: 20, totalValue: 310 }], materials: [{ code: '000123', description: 'Material com código de zeros iniciais', unit: 'M', quantity: 2.5 }], totalServices: 310, photoSlots: Array.from({ length: 5 }, (_, i) => ({ photoIndex: i + 1, confirmed: true })) };
const fixtures = [
  ['simples', base],
  ['poste', { ...base, occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE'], pgPostRemoved: 'PG-ANTES', pgPostInstalled: 'PG-DEPOIS' }],
  ['condutor', { ...base, occurrenceTypes: ['SUBSTITUIÇÃO DE CONDUTOR'], pgConductorStart: 'PG-INICIAL', pgConductorEnd: 'PG-FINAL' }],
  ['trafo', { ...base, occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '000321', removedCia: 'CIA-A', removedBto: 'BTO-A', newCode: '000654', newCia: 'CIA-B', newBto: 'BTO-B' }, photoSlots: Array.from({ length: 7 }, (_, i) => ({ photoIndex: i + 1, confirmed: true })) }],
  ['muitas-linhas', { ...base, observation: 'Observação longa com descrição detalhada. '.repeat(80), services: Array.from({ length: 80 }, (_, i) => ({ ...base.services[0], code: 'COD-' + i, catalogText: 'Descrição extensa de serviço número ' + i + ', com unidade, quantidade decimal e preço histórico preservado.' })), materials: Array.from({ length: 70 }, (_, i) => ({ ...base.materials[0], code: String(i).padStart(7, '0'), description: 'Descrição completa de material ' + i })) }],
  ['foto-ausente', { ...base, photoSlots: base.photoSlots.map(slot => ({ ...slot, confirmed: slot.photoIndex !== 3 })) }],
  ['correcao', { ...base, status: 'CORRECAO_SOLICITADA', supervisor: 'Supervisor FICTÍCIO', reason: 'Informar BTO e CIA', supervisorNote: 'Conferir os dois transformadores.' }],
  ['publicada', { ...base, status: 'PUBLICADA', publishedAt: '2026-10-14T10:10:00-03:00' }]
];
const results = [];
for (const [name, record] of fixtures) {
  const result = await context.create(record, { pdfLib: browserPdfLib, logoBytes: new Uint8Array(logoBytes), getPhoto: async index => ({ recordId: record.recordId, photoIndex: index, available: true, dataUrl: photos[index - 1] }) });
  assert.equal(Buffer.from(result.bytes).subarray(0, 5).toString(), '%PDF-');
  const parsed = await pdfLib.PDFDocument.load(result.bytes); assert.ok(parsed.getPageCount() >= 1);
  assert.equal(result.photos.filter(photo => photo.available).length, record.photoSlots.filter(slot => slot.confirmed).length);
  await writeFile(new URL(name + '.pdf', output), result.bytes);
  results.push({ name, pages: parsed.getPageCount(), bytes: result.bytes.length, photos: result.photos });
}
assert.ok(results.find(item => item.name === 'muitas-linhas').pages > 5);
assert.equal(context.filename({ ...base, occurrenceNumber: '../unsafe<> / arquivo' }).includes('/'), false);
const foreign = await context.create(base, { pdfLib: browserPdfLib, logoBytes: new Uint8Array(logoBytes), getPhoto: async index => ({ recordId: '22222222-2222-4222-8222-222222222222', photoIndex: index, available: true, dataUrl: photos[index - 1] }) });
assert.equal(foreign.photos.some(photo => photo.available), false);
await assert.rejects(() => context.create(base, { pdfLib: browserPdfLib, logoBytes: new Uint8Array(logoBytes), getPhoto: async () => { const error = new Error('Revogado'); error.code = 'AUTH_REQUIRED'; throw error; } }), /Revogado/);
for (const viewport of ['desktop', 'mobile']) {
  const downloads = [];
  context.document = { createElement: () => ({ style: {}, click() { downloads.push({ href: this.href, filename: this.download, viewport }); }, remove() {} }), body: { append() {} } };
  context.download({ bytes: foreign.bytes, filename: foreign.filename }); assert.equal(downloads.length, 1); assert.match(downloads[0].filename, /\.pdf$/);
}
console.log(JSON.stringify({ passed: fixtures.length + 5, failed: 0, productionWrites: 0, results }, null, 2));
await writeFile(new URL('results.json', output), JSON.stringify({ passed: fixtures.length + 5, failed: 0, results }, null, 2));
