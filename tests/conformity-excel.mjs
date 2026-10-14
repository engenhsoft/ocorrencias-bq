import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as core from '../core.js';
import { buildConformityComparison, conformityEvents, conformityMarkup } from '../supervisor-conformity.js';
import { collectExcelEntries, buildOccurrenceWorkbook, excelRecordData } from '../occurrence-excel.js';
import { excelSelectableRecords } from '../operational-features.js';

const require = createRequire(import.meta.url), ExcelJS = require('../vendor/exceljs-4.4.0.min.js'), sharp = require('sharp');
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const at = '2026-10-14T12:00:00-03:00';
const event = (action, timestamp = at) => ({ action, at: timestamp, actor: 'Supervisor FICTÍCIO' });
const record = (n, timeline = []) => ({ recordId: id(n), occurrenceNumber: '000' + n, status: 'AGUARDANDO_SUPERVISOR', user: 'Campo FICTÍCIO', base: 'CAICÓ', crewLeader: 'Chefe FICTÍCIO', audit: { timeline } });
const correction = (timestamp = at, field = 'Observação', before = 'Antes', after = 'Depois') => ({ supervisor: 'Supervisor FICTÍCIO', correctedAt: timestamp, changes: [{ field, previousValue: before, newValue: after }] });
const tests = [], test = (name, run) => tests.push({ name, run });
const compare = records => buildConformityComparison(records, { month: '2026-10' });
test('aprovação sem edição pertence apenas a Aprovadas', () => assert.deepEqual(compare([record(1, [event('APROVADA_E_PUBLICADA')])]).totals, { approved: 1, corrected: 0, rejected: 0, requested: 0 }));
test('edição direta persistida, mesmo antes da aprovação, pertence apenas a Corrigidas', () => {
  const r = record(1, [event('APROVADA_E_PUBLICADA')]); r.audit.supervisorCorrections = [correction()];
  assert.deepEqual(compare([r]).totals, { approved: 0, corrected: 1, rejected: 0, requested: 0 });
});
test('solicitação, edição da equipe, reenvio, comentário e reprovação não são edição direta', () => {
  const r = record(1, ['CORRECAO_SOLICITADA', 'CORRECAO_REENVIADA', 'COMENTARIO', 'REPROVADA', 'APROVADA_E_PUBLICADA'].map(action => event(action)));
  assert.deepEqual(compare([r]).totals, { approved: 1, corrected: 0, rejected: 1, requested: 1 });
});
test('múltiplos eventos e cópias do mesmo UUID contam uma vez em cada categoria', () => {
  const r = record(1, [event('CORRIGIDA_PELO_SUPERVISOR'), event('CORRIGIDA_PELO_SUPERVISOR'), event('REPROVADA'), event('REPROVADA'), event('CORRECAO_SOLICITADA'), event('CORRECAO_SOLICITADA')]);
  assert.deepEqual(compare([r, r]).totals, { approved: 0, corrected: 1, rejected: 1, requested: 1 });
});
test('edição anterior ao mês impede classificar aprovação posterior como sem edição', () => {
  const r = record(1, [event('CORRIGIDA_PELO_SUPERVISOR', '2026-09-29T12:00:00-03:00'), event('PUBLICADA')]);
  assert.equal(compare([r]).totals.approved, 0); assert.equal(compare([r]).totals.corrected, 0);
  assert.equal(buildConformityComparison([r], { period: 'all' }).totals.corrected, 1);
});
test('eventos usam fuso Bahia e filtros por Base e chefe histórico', () => {
  const r = record(1, [event('PUBLICADA', '2026-10-01T01:00:00Z')]); r.audit.registrationIdentity = { base: 'MOSSORÓ', crewLeader: 'Chefe Original' };
  assert.equal(compare([r]).totals.approved, 0);
  assert.equal(buildConformityComparison([r], { period: 'all', base: 'MOSSORÓ', crewLeader: 'Chefe Original', dimension: 'crewLeader' }).groups[0].label, 'Chefe Original');
  assert.equal(buildConformityComparison([r], { period: 'all', base: 'CAICÓ' }).groups.length, 0);
});
test('audit sem delta real e data inválida não simulam correções; fixtures excluídas', () => {
  const r = record(1); r.audit.supervisorCorrections = [correction(at, 'Observação', 'igual', 'igual'), correction('inválida')];
  assert.equal(conformityEvents(r).corrected.length, 0); r.audit.testOnly = true; r.audit.timeline = [event('PUBLICADA')]; assert.equal(compare([r]).totals.approved, 0);
});
test('grupos apenas com pedido à equipe aparecem somente quando essa categoria é selecionada', () => {
  const result = compare([record(1, [event('CORRECAO_SOLICITADA')])]);
  assert.match(conformityMarkup(result), /SEM DADOS/);
  assert.match(conformityMarkup(result, ['approved', 'corrected', 'requested']), /Correção solicitada à equipe · 1/);
});
test('histórico ausente mostra insuficiência e categorias opcionais não inventam total exclusivo', () => {
  const r = record(1); delete r.audit;
  assert.match(conformityMarkup(compare([r])), /SEM DADOS HISTÓRICOS SUFICIENTES/);
  const result = compare([record(1, [event('REPROVADA'), event('PUBLICADA')])]);
  assert.doesNotMatch(conformityMarkup(result), /comparison-fill--rejected/);
  assert.match(conformityMarkup(result, ['approved', 'corrected', 'rejected']), /comparison-fill--rejected/);
});

const backend = await readFile(new URL('../backend/OperationalFeatures20261014.gs', import.meta.url), 'utf8');
const originalBackend = execFileSync('git', ['show', '5041aff:backend/OperationalFeatures20261014.gs'], { encoding: 'utf8', cwd: new URL('../', import.meta.url) });
const COL = Object.fromEntries(['ID', 'AUDIT', 'BASE', 'TEAM', 'CREW_LEADER', 'STATUS', 'REGISTERED_AT', 'TOTAL', 'SUPERVISOR', 'REVIEWED_AT'].map((name, i) => [name, i + 1])); COL.WIDTH = 10;
const plain = value => JSON.parse(JSON.stringify(value));
function backendContext(source) {
  const c = vm.createContext({ COL, APP: { timeZone: 'America/Bahia' }, STATUS: { WAITING_SUPERVISOR: 'AGUARDANDO_SUPERVISOR', PUBLISHED: 'PUBLICADA', APPROVED: 'APROVADA' },
    normalize_: core.normalizeText, safeJson_: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
    isoValue_: value => value instanceof Date ? value.toISOString() : String(value || ''), operationalStatusFromValues_: row => row[COL.STATUS - 1],
    recordReadyForSupervisorValues_: () => true, roundMoney_: value => Math.round(value * 100) / 100, nowIso_: () => at,
    Utilities: { formatDate: value => core.operationalDate(value) }
  }); vm.runInContext(source, c); return c;
}
function row(n, timeline = [], status = 'AGUARDANDO_SUPERVISOR') { const r = []; const values = { ID: id(n), AUDIT: JSON.stringify({ timeline }), BASE: 'CAICÓ', TEAM: 'LM FICTÍCIA', CREW_LEADER: 'Chefe FICTÍCIO', STATUS: status, REGISTERED_AT: at, TOTAL: 100, SUPERVISOR: 'Supervisor FICTÍCIO', REVIEWED_AT: at }; for (const key of Object.keys(values)) r[COL[key] - 1] = values[key]; return r; }
test('backend inclui histórico completo anterior ao audit limitado, sem divulgar fotos ou segredos', () => {
  const c = backendContext(backend), h = []; h[0] = id(1); h[1] = at; h[2] = 'Supervisor FICTÍCIO'; h[3] = 'CORRIGIDA_PELO_SUPERVISOR';
  const projection = plain(c.buildConformityRecords_([row(1, [], 'PUBLICADA')], [h, h]));
  assert.equal(projection[0].audit.timeline.length, 1); assert.equal(compare(projection).totals.corrected, 1); assert.equal(compare(projection).totals.approved, 0);
  for (const key of ['photos', 'token', 'password', 'uploadKey', 'pendingServices']) assert.equal(JSON.stringify(projection).includes('"' + key + '"'), false);
});
test('novo resumo preserva TOP 3, distribuição e não conformidade existentes; Campo não recebe histórico', () => {
  const before = backendContext(originalBackend), after = backendContext(backend), rows = [row(1), row(2, [], 'PUBLICADA')];
  const old = plain(before.buildOperationalSummary_(rows, [], '2026-10', true)), current = plain(after.buildOperationalSummary_(rows, [], '2026-10', true));
  assert.equal(current.conformityRecords.length, 2); delete current.conformityRecords; assert.deepEqual(current, old);
  assert.deepEqual(plain(after.buildOperationalSummary_(rows, [], '2026-10', false)), plain(before.buildOperationalSummary_(rows, [], '2026-10', false)));
});
test('backend exige sessão Supervisor ou Campo no resumo e exclui fixtures da nova projeção', () => {
  const c = backendContext(backend); c.requireSession_ = (token, roles) => { if (!roles.includes(token)) throw Object.assign(new Error('Sessão inválida'), { code: 'AUTH_REQUIRED' }); return { role: token }; };
  assert.throws(() => c.getOperationalSummary_({ token: 'fiscal' }), error => error.code === 'AUTH_REQUIRED');
  const r = row(1); r[COL.AUDIT - 1] = JSON.stringify({ testOnly: true }); assert.equal(c.buildConformityRecords_([r], []).length, 0);
});

const imageBytes = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#237eb3' } }).png().toBuffer();
const photoData = 'data:image/png;base64,' + imageBytes.toString('base64');
const exportRecord = (n, trafo = false) => ({ ...record(n), contract: '4600080938', team: 'LM FICTÍCIA', registeredAt: at, updatedAt: at, observation: '=Texto literal sem fórmula', transformer: { removedCode: '000123', removedCia: '0012', removedBto: '0023', newCode: '000456' }, occurrenceTypes: [trafo ? 'SUBSTITUIÇÃO DE TRAFO' : 'PODA'], services: [{ code: '000123', catalogText: 'Serviço com preço histórico', unit: 'UN', quantity: 1.25, referenceValue: 10.5, totalValue: 13.125 }], materials: [{ code: '000067', description: 'Material', unit: 'M', quantity: 2.75 }], totalServices: 13.125, photoSlots: Array.from({ length: trafo ? 7 : 5 }, (_, i) => ({ photoIndex: i + 1, confirmed: true })), token: 'MUST-NOT-EXPORT', password: 'MUST-NOT-EXPORT', audit: { token: 'MUST-NOT-EXPORT' } });
const collect = (ids, options = {}) => collectExcelEntries(ids, { getRecord: async uuid => ({ record: exportRecord(Number(uuid.slice(0, 8)), Number(uuid.slice(0, 8)) === 2) }), getPhoto: async (uuid, index) => ({ recordId: uuid, photoIndex: index, available: true, dataUrl: photoData }), preparePhoto: async dataUrl => ({ dataUrl, extension: 'png', width: 600, height: 300 }), ...options });
test('seleção valida UUID, deduplica e respeita perfil Campo e Bases Fiscal', () => {
  const a = exportRecord(1), b = { ...exportRecord(2), base: 'MOSSORÓ', user: 'Outro Campo' };
  assert.equal(excelSelectableRecords([a, a, b], { role: 'supervisor' }).length, 2);
  assert.deepEqual(excelSelectableRecords([a, b], { role: 'field', user: a.user }).map(x => x.recordId), [id(1)]);
  assert.deepEqual(excelSelectableRecords([a, b], { role: 'fiscal', bases: ['CAICÓ'] }).map(x => x.recordId), [id(1)]);
  assert.equal(excelSelectableRecords([a], { role: 'fiscal', bases: [] }).length, 0);
});
test('exportação projeta somente dados permitidos sem segredos ou objetos de fórmula', () => {
  const data = excelRecordData(exportRecord(1)); assert.equal(data.token, undefined); assert.equal(data.audit, undefined); assert.equal(data.observation, '=Texto literal sem fórmula');
  assert.equal(data.services[0].code, '000123'); assert.equal(data.materials[0].code, '000067'); assert.equal(data.services[0].quantity, 1.25);
});
let consolidated;
test('uma ocorrência gera um XLSX verdadeiro com fotos incorporadas', async () => {
  const entries = await collect([id(1), id(1)]), output = await buildOccurrenceWorkbook(entries, { ExcelJS });
  assert.equal(Buffer.from(output.bytes).subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(output.bytes);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['OCORRÊNCIAS', 'SERVIÇOS', 'MATERIAIS', 'FOTOGRAFIAS']);
  assert.equal(workbook.getWorksheet('OCORRÊNCIAS').rowCount, 2); assert.equal(workbook.getWorksheet('FOTOGRAFIAS').getImages().length, 5);
});
test('várias ocorrências geram um único arquivo; serviços, materiais e 7 slots de Trafo ligados ao UUID', async () => {
  const entries = await collect([id(1), id(2)]); consolidated = await buildOccurrenceWorkbook(entries, { ExcelJS });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(consolidated.bytes);
  assert.equal(wb.getWorksheet('OCORRÊNCIAS').rowCount, 3); assert.equal(wb.getWorksheet('SERVIÇOS').rowCount, 3); assert.equal(wb.getWorksheet('MATERIAIS').rowCount, 3);
  const photos = wb.getWorksheet('FOTOGRAFIAS'); assert.equal(photos.rowCount, 13); assert.equal(photos.getImages().length, 12);
  assert.equal(photos.getCell('B2').value, id(1)); assert.equal(photos.getCell('B7').value, id(2)); assert.match(photos.getCell('C12').value, /Trafo retirado/); assert.match(photos.getCell('C13').value, /Trafo instalado/);
  for (const image of photos.getImages()) { const owner = photos.getCell(image.range.tl.nativeRow + 1, 2).value; assert.ok([id(1), id(2)].includes(owner)); assert.equal(image.range.ext.width / image.range.ext.height, 2); }
  assert.equal(wb.getWorksheet('SERVIÇOS').getCell('C2').value, '000123'); assert.equal(wb.getWorksheet('SERVIÇOS').getCell('F2').value, 1.25); assert.equal(wb.getWorksheet('SERVIÇOS').getCell('H2').value, 13.125);
  assert.equal(wb.getWorksheet('MATERIAIS').getCell('C2').value, '000067'); assert.equal(wb.getWorksheet('MATERIAIS').getCell('F2').value, 2.75);
  for (const s of wb.worksheets) assert.ok(s.autoFilter);
  assert.match(wb.getWorksheet('SERVIÇOS').getCell('G2').numFmt, /R\$/);
});
test('foto de outro UUID ou slot nunca é incorporada; indisponíveis são identificadas', async () => {
  const entries = await collect([id(1)], { getPhoto: async (uuid, index) => ({ recordId: index === 1 ? id(2) : uuid, photoIndex: index === 2 ? 7 : index, available: index <= 2, dataUrl: photoData }) });
  assert.equal(entries[0].photos.some(photo => photo.dataUrl), false); assert.match(entries[0].photos[0].message, /UUID ou slot/);
  const output = await buildOccurrenceWorkbook(entries, { ExcelJS }), wb = new ExcelJS.Workbook(); await wb.xlsx.load(output.bytes); assert.equal(wb.getWorksheet('FOTOGRAFIAS').getImages().length, 0);
});
test('negação de autorização de dados ou fotografias aborta exportação', async () => {
  for (const method of ['getRecord', 'getPhoto']) await assert.rejects(collect([id(1)], { [method]: async () => { throw Object.assign(new Error('Base não autorizada'), { code: 'FORBIDDEN' }); } }), error => error.code === 'FORBIDDEN');
});
test('sessão alterada, cancelamento e documento de outro UUID abortam sem download', async () => {
  await assert.rejects(collect([id(1)], { isCurrent: () => false }), error => error.code === 'AUTH_REQUIRED');
  const abort = new AbortController(); abort.abort(); await assert.rejects(collect([id(1)], { signal: abort.signal }), error => error.code === 'EXPORT_CANCELLED');
  await assert.rejects(collect([id(1)], { getRecord: async () => ({ record: exportRecord(2) }) }), /outra ocorrência/);
});
test('exportação deixa os objetos originais intactos', async () => {
  const r = exportRecord(1), before = JSON.stringify(r); await collect([id(1)], { getRecord: async () => ({ record: r }) }); assert.equal(JSON.stringify(r), before);
});
test('arquivo grande cede execução e permanece consolidado, sem converter códigos', async () => {
  const entries = await collect([id(1)]), r = entries[0].record; r.services = Array.from({ length: 1200 }, (_, i) => ({ ...r.services[0], code: String(i).padStart(8, '0') }));
  const output = await buildOccurrenceWorkbook(entries, { ExcelJS }); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output.bytes); assert.equal(wb.getWorksheet('SERVIÇOS').rowCount, 1201); assert.equal(wb.getWorksheet('SERVIÇOS').getCell('C2').value, '00000000');
});

let passed = 0; const failed = [];
for (const item of tests) { try { await item.run(); passed++; console.log('OK', item.name); } catch (error) { failed.push({ name: item.name, message: error.stack }); console.error('FAIL', item.name, error); } }
await mkdir(new URL('../../evidence/evolution/', import.meta.url), { recursive: true });
if (consolidated) await writeFile(new URL('../../evidence/evolution/consolidado-fixture.xlsx', import.meta.url), consolidated.bytes);
await writeFile(new URL('../../evidence/evolution/unit-results.json', import.meta.url), JSON.stringify({ passed, failed, total: tests.length }, null, 2));
console.log(JSON.stringify({ passed, failed: failed.length, total: tests.length })); if (failed.length) process.exitCode = 1;
