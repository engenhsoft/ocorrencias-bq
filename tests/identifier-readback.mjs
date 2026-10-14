import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const [fixed, baseline, coreSource, persistenceTests, createTests, appSource, apiSource] = await Promise.all([
  readFile(process.argv[2], 'utf8'), readFile(process.argv[3], 'utf8'),
  ...['core.js', 'tests/correction-persistence.mjs', 'tests/create-photo-commit.mjs', 'app.js', 'api.js'].map(p => readFile(new URL('../' + p, import.meta.url), 'utf8'))
]);
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const extract = (s, name) => { const m = s.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(m, name); return m[0]; };
const factory = vm.runInNewContext(persistenceTests.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(persistenceTests, 'harness') + '\nharness', { vm, backend: fixed, createHash, assert, core });
const record = vm.runInNewContext(extract(createTests, 'record') + '\nrecord', { core, UUID: '11111111-1111-4111-8111-111111111111', key: n => `${String(n).padStart(8, '0')}-2222-4222-8222-222222222222` });
const fakeDrive = vm.runInNewContext(extract(persistenceTests, 'fakePhotoDrive') + '\nfakePhotoDrive', { Buffer });
const client = vm.runInNewContext(extract(createTests, 'client') + '\nclient', { core, record, appSource, apiSource, extract, Buffer, Blob, Map, Set, Date, JSON, structuredClone, vm, URL, AbortController, setTimeout, clearTimeout, UUID: '11111111-1111-4111-8111-111111111111', key: n => `${String(n).padStart(8, '0')}-2222-4222-8222-222222222222` });
const tests = []; const test = (name, run) => tests.push({ name, run });
function harness(source = fixed) {
  const h = factory([['SDMMU4201II', 'AVISO DE DESLIGAMENTO POR TRAFO', 'UD', 'REDES EMERGÊNCIA', '', '', '', '96,96', '96,96']], source);
  h.c.requireSession_ = () => ({ role: 'field', user: 'Campo FICTÍCIO' });
  h.c.assertTeamDirectorySelection_ = () => {};
  h.c.CacheService = { getScriptCache: () => ({ get: () => '1', put() {}, remove() {} }) };
  const { APP, COL } = h.c.meta, sheet = h.sheet(APP.pendingSheet);
  const columns = ['CONTRACT', 'OCCURRENCE_NUMBER', 'PG_POST_REMOVED', 'PG_POST_INSTALLED', 'PG_CONDUCTOR_START', 'PG_CONDUCTOR_END', 'REMOVED_CODE', 'REMOVED_CIA', 'REMOVED_BTO', 'NEW_CODE', 'NEW_CIA', 'NEW_BTO'];
  const range = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => {
    const r = range(...args), read = r.getValues;
    r.getValues = () => read().map(row => row.map((value, index) => columns.some(k => COL[k] === args[1] + index) && typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value));
    return r;
  };
  h.drive = fakeDrive(h);
  h.submit = p => h.c.submitRecord_({ token: 'fixture', record: p, clientVersion: core.APP_VERSION });
  h.state = () => h.c.getRecordState_({ token: 'fixture', recordId: record().recordId });
  return h;
}
function trafo() { return { ...record(), occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], otherOccurrenceType: '', transformer: { removedCode: '654321', removedCia: '123456', removedBto: '345678', newCode: '765432', newCia: '234567', newBto: '456789' }, expectedPhotoIndexes: [1, 2, 3, 4, 5, 6, 7] }; }
test('baseline CREATE reproduz identificadores numéricos e interrompe antes das fotos', () => {
  const h = harness(baseline); assert.throws(() => h.submit(trafo()), e => e.code === 'DATA_COMMIT_UNCONFIRMED');
  assert.equal(h.sheet(h.c.meta.APP.pendingSheet).getLastRow(), 2); assert.equal(h.drive.created(), 0);
});
test('CREATE confirma Série/CIA/BTO sem dispensar os sete slots exigidos', () => {
  const h = harness(), p = trafo(), r = h.submit(p);
  assert.equal(r.status, 'FOTOS_SENDO_SINCRONIZADAS'); assert.equal(r.photoStates.filter(p => p.confirmed).length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r.record.transformer)), p.transformer);
  assert.deepEqual(JSON.parse(JSON.stringify(r.record.audit.expectedPhotoIndexes)), p.expectedPhotoIndexes);
});
test('cinco fotos gerais e duas evidências locais: retry dos dados já gravados conclui sem novo submit', async () => {
  const h = harness(), ui = client(h); const p = trafo();
  for (const i of [6, 7]) { const uploadKey = `${String(i).padStart(8, '0')}-2222-4222-8222-222222222222`; p.photoStates[i - 1] = { ...p.photoStates[i - 1], localReady: true, uploadKey }; ui.photos.set(p.recordId + ':' + i, { recordId: p.recordId, photoIndex: i, uploadKey, blob: new Blob(['photo' + i], { type: 'image/jpeg' }) }); }
  ui.saved.set(p.recordId, structuredClone(p));
  assert.throws(() => { const old = harness(baseline); old.submit(p); }, e => e.code === 'DATA_COMMIT_UNCONFIRMED');
  h.submit(p); ui.saved.set(p.recordId, { ...p, attempts: 1 });
  const result = await ui.c.syncSingleRecord(p.recordId, false);
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR', result.lastError); assert.equal(ui.submitted.length, 0);
  assert.deepEqual(Array.from(ui.uploads), [1, 2, 3, 4, 5, 6, 7]); assert.equal(h.sheet(h.c.meta.APP.pendingSheet).getLastRow(), 2);
});
test('baseline CORRECTION grava os identificadores mas deixa recibo STAGED', () => {
  const h = harness(baseline), before = record(); h.seed(before, { status: h.c.meta.STATUS.CORRECTION_REQUESTED });
  assert.throws(() => h.submit({ ...record(), transformer: trafo().transformer, expectedPhotoIndexes: [1, 2, 3], correctionRequestId: 'aaaaaaaa-1111-4111-8111-111111111111', correctionRequestedAt: '' }), e => e.code === 'CORRECTION_PERSISTENCE_MISMATCH');
  assert.equal(h.state().record.audit.lastCorrectionSubmission.phase, 'STAGED');
});
test('retry de recibo STAGED confirma delta, fingerprint e histórico uma única vez', () => {
  const old = harness(baseline), p = { ...record(), transformer: trafo().transformer, expectedPhotoIndexes: [1, 2, 3], correctionRequestId: 'aaaaaaaa-1111-4111-8111-111111111111', correctionRequestedAt: '' };
  old.seed(record(), { status: old.c.meta.STATUS.CORRECTION_REQUESTED }); assert.throws(() => old.submit(p));
  const h = harness(); h.sheet(h.c.meta.APP.pendingSheet).rows = structuredClone(old.sheet(old.c.meta.APP.pendingSheet).rows);
  const r = h.submit(p); assert.equal(r.record.audit.lastCorrectionSubmission.phase, 'COMPLETE');
  assert.equal(r.status, 'AGUARDANDO_SUPERVISOR'); assert.deepEqual(JSON.parse(JSON.stringify(r.record.transformer)), p.transformer);
  const history = h.sheet(h.c.meta.APP.historySheet).getLastRow(); h.submit(p);
  assert.equal(h.sheet(h.c.meta.APP.historySheet).getLastRow(), history);
  assert.equal(h.sheet(h.c.meta.APP.pendingSheet).getLastRow(), 2);
});
for (const column of ['CONTRACT', 'OCCURRENCE_NUMBER', 'PG_POST_REMOVED', 'PG_POST_INSTALLED', 'PG_CONDUCTOR_START', 'PG_CONDUCTOR_END', 'REMOVED_CODE', 'REMOVED_CIA', 'REMOVED_BTO', 'NEW_CODE', 'NEW_CIA', 'NEW_BTO']) {
  test(column + ': representação numérica equivalente aceita; zeros e divergência real rejeitados', () => {
    const h = harness(), { COL } = h.c.meta, expected = Array(COL.WIDTH).fill(''), actual = expected.slice();
    expected[COL[column] - 1] = '123456'; actual[COL[column] - 1] = 123456;
    assert.equal(h.c.pendingPersistenceSnapshot_(actual), h.c.pendingPersistenceSnapshot_(expected));
    expected[COL[column] - 1] = '0123456'; assert.notEqual(h.c.pendingPersistenceSnapshot_(actual), h.c.pendingPersistenceSnapshot_(expected));
    expected[COL[column] - 1] = '123457'; assert.notEqual(h.c.pendingPersistenceSnapshot_(actual), h.c.pendingPersistenceSnapshot_(expected));
  });
}
let passed = 0;
for (const { name, run } of tests) { await run(); passed++; console.log('PASS ' + name); }
console.log(JSON.stringify({ passed, failed: 0, productionWrites: 0 }));
