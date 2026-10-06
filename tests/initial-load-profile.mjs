import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

if (!process.argv[2] || !process.argv[3]) throw Error('Informe backend corrigido e baseline 2026.10.01.2.');
const [fixed, baseline, existing] = await Promise.all([
  readFile(process.argv[2], 'utf8'), readFile(process.argv[3], 'utf8'),
  readFile(new URL('./login-initial-load.mjs', import.meta.url), 'utf8')
]);
// The performance baseline predates later, approved correctness fixes.
// A third source pins the functions protected by this audit to its actual starting version.
const invariantBaseline = process.argv[4] ? await readFile(process.argv[4], 'utf8') : baseline;
const extract = (source, name) => {
  const match = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(match, name); return match[0];
};
const sheetClass = existing.match(/class Sheet \{[^]*?\n\}/)[0];
const backendHarness = vm.runInNewContext(sheetClass + '\n' + extract(existing, 'backendHarness') + '\nbackendHarness', { vm, Date, Map, console });
const plain = value => JSON.parse(JSON.stringify(value));
const tests = []; const test = (name, run) => tests.push({ name, run });

function harness(source, mode = 'warm', includePublishedPendingCopy = false) {
  const h = backendHarness(source), { APP, COL, STATUS } = h.c.meta;
  const reads = [], cache = new Map(), permissions = new Map();
  const calls = { individualCache: 0, bulkCache: 0, drive: 0, sharing: 0 };
  for (const sheet of h.sheets.values()) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (row, column, rows, columns) => {
      const range = getRange(row, column, rows, columns);
      for (const name of ['getValues', 'getDisplayValues']) {
        const read = range[name];
        range[name] = () => { reads.push({ sheet: sheet.name, row, column, rows, columns }); return read(); };
      }
      return range;
    };
  }
  const rows = h.sheets.get(APP.pendingSheet).rows;
  const template = rows[1].slice(); rows.splice(1);
  for (let index = 0; index < 34; index++) {
    const row = template.slice();
    row[COL.ID - 1] = `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`;
    row[COL.STATUS - 1] = index < 30 ? STATUS.WAITING_SUPERVISOR : index < 33 ? STATUS.SYNCING_PHOTOS : STATUS.CORRECTION_REQUESTED;
    row[COL.OCCURRENCE_NUMBER - 1] = '00001';
    for (let photo = 0; photo < 7; photo++) {
      const id = `fixture_${String(index).padStart(4, '0')}_${photo}_abcdefghijklmnopqrstuvwxyz`;
      const column = photo < 5 ? COL.PHOTO_1 + photo : photo === 5 ? COL.TRAFO_REMOVED_PHOTO : COL.TRAFO_INSTALLED_PHOTO;
      row[column - 1] = `https://drive.google.com/file/d/${id}/view`;
      permissions.set(id, mode === 'private' ? 'PRIVATE' : 'PUBLIC');
      if (mode === 'warm' || (mode === 'partial' && photo % 2 === 0)) cache.set('photo-public-' + id, '1');
    }
    if (index >= 30 && index < 33) {
      const audit = JSON.parse(row[COL.AUDIT - 1]); audit.expectedPhotoIndexes = [1, 2, 3]; row[COL.AUDIT - 1] = JSON.stringify(audit);
      row[COL.PHOTO_1 + 1] = '';
    }
    rows.push(row);
  }
  // Uma cópia mais antiga não deve vencer o UUID; o número de ocorrência se repete.
  const duplicate = rows[1].slice(); duplicate[COL.UPDATED_AT - 1] = '2026-09-01T09:00:00-03:00'; duplicate[COL.TOTAL - 1] = 999; rows.push(duplicate);
  // Cenário de publicação interrompida é verificado separadamente: sua origem continua acionável.
  if (includePublishedPendingCopy) {
    const published = h.sheets.get(APP.officialSheet).rows[1];
    const copy = template.slice(); copy[COL.ID - 1] = published[COL.ID - 1]; rows.push(copy);
  }
  h.c.CacheService = { getScriptCache: () => ({
    get(key) { calls.individualCache++; return cache.get(key) || null; },
    getAll(keys) { calls.bulkCache++; if (mode === 'batch-error') throw Error('batch unavailable'); return Object.fromEntries(keys.filter(key => cache.has(key)).map(key => [key, cache.get(key)])); },
    put(key, value) { cache.set(key, value); }
  }) };
  h.c.DriveApp = { Access: { ANYONE_WITH_LINK: 'PUBLIC' }, Permission: { VIEW: 'VIEW' },
    getFileById(id) { calls.drive++; if (mode === 'broken') throw Error('missing'); return {
      getSharingAccess: () => permissions.get(id),
      setSharing(access) { calls.sharing++; permissions.set(id, access); }
    }; }
  };
  return { ...h, reads, calls, cache, permissions, pendingRows: rows };
}
function compare(mode) {
  const before = harness(baseline, mode), after = harness(fixed, mode);
  const a = before.c.listPending_({ token: 'fixture-only' }), b = after.c.listPending_({ token: 'fixture-only' });
  assert.deepEqual(plain(b), plain(a));
  assert.equal(JSON.stringify(b), JSON.stringify(a));
  assert.equal(after.counts().writes, 0);
  return { before, after, payload: b };
}

test('payload byte a byte, UUID repetido, números iguais, snapshots e métricas preservados', () => {
  const { payload } = compare('warm');
  assert.equal(payload.records.length, 30); assert.equal(payload.pendingRecords.length, 4);
  assert.ok(payload.records.every(r => r.occurrenceNumber === '00001' && r.totalServices === 1.5));
  assert.equal(payload.records[0].services[0].quantity, .75);
  assert.equal(payload.records[0].materials[0].code, '000123');
  assert.equal(payload.records[0].materials[0].quantity, .5);
  assert.equal(payload.records[0].photoStates.length, 7);
});
test('235 consultas individuais viram uma consulta em lote com cache disponível', () => {
  const { before, after } = compare('warm');
  assert.equal(before.calls.individualCache, 235); assert.equal(after.calls.individualCache, 0);
  assert.equal(after.calls.bulkCache, 1); assert.equal(after.calls.drive, 0); assert.equal(after.calls.sharing, 0);
});
test('somente dois ranges operacionais, 46 e 41 colunas, sem cabeçalhos/histórico/catálogos', () => {
  const { before, after } = compare('warm'); const { APP } = after.c.meta;
  assert.deepEqual(plain(before.counts()), { opens: 1, dataReads: 4, headerReads: 5, writes: 0 });
  assert.deepEqual(plain(after.counts()), { opens: 1, dataReads: 2, headerReads: 0, writes: 0 });
  assert.deepEqual(after.reads.map(r => [r.sheet, r.row, r.columns]), [[APP.pendingSheet, 2, 46], [APP.officialSheet, 2, 41]]);
});
for (const mode of ['cold', 'partial', 'private', 'broken', 'batch-error']) {
  test(`cache ${mode}: mesmas URLs, confirmações e fallback de permissões`, () => {
    const { before, after, payload } = compare(mode);
    assert.equal(after.calls.drive, before.calls.drive);
    assert.equal(after.calls.sharing, before.calls.sharing);
    if (mode === 'broken') assert.ok(payload.records.every(r => r.photoCount === 0));
    if (mode === 'private') assert.equal(after.calls.sharing, 235);
  });
}
test('cache de referência não armazena sessão nem dataset operacional', () => {
  const { after } = compare('warm');
  assert.ok([...after.cache.keys()].every(key => key.startsWith('photo-public-')));
  after.pendingRows.splice(1);
  const next = after.c.listPending_({ token: 'fixture-only' });
  assert.equal(next.records.length, 0); assert.equal(next.pendingRecords.length, 0);
  assert.equal(after.opens(), 2); assert.equal(after.calls.bulkCache, 1);
});
test('lista vazia preserva métricas publicadas e não consulta cache de fotos', () => {
  const before = harness(baseline), after = harness(fixed);
  before.pendingRows.splice(1); after.pendingRows.splice(1);
  assert.deepEqual(plain(after.c.listPending_({ token: 'fixture-only' })), plain(before.c.listPending_({ token: 'fixture-only' })));
  assert.equal(after.calls.bulkCache, 0);
});
test('Campo mantém payload e remove a inspeção dos cinco cabeçalhos', () => {
  const before = harness(baseline), after = harness(fixed);
  assert.deepEqual(plain(after.c.listMine_({ token: 'fixture-only' })), plain(before.c.listMine_({ token: 'fixture-only' })));
  assert.deepEqual(plain(after.counts()), { opens: 1, dataReads: 4, headerReads: 0, writes: 0 });
  assert.equal(before.counts().headerReads, 5); assert.equal(after.calls.bulkCache, 1);
});
test('login, sessão, edição, fotos e leituras alheias à publicação não foram alteradas', () => {
  for (const name of ['login_', 'credentialHash_', 'signingSecret_', 'requireSession_', 'supervisorCorrectRecord_', 'requestPhotoSync_', 'ensurePhotoPublic_', 'listPublishedRecords_']) {
    assert.equal(extract(fixed, name), extract(invariantBaseline, name), name);
  }
});
test('cópia de publicação ainda pendente permanece acionável com dois ranges e sem histórico', () => {
  const before = harness(baseline, 'warm', true), after = harness(fixed, 'warm', true);
  const a = before.c.listPending_({ token: 'fixture-only' }), b = after.c.listPending_({ token: 'fixture-only' });
  assert.equal(b.records.length, a.records.length + 1);
  const id = after.sheets.get(after.c.meta.APP.officialSheet).rows[1][0];
  assert.equal(b.records.filter(record => record.recordId === id).length, 1);
  assert.equal(b.metricRecords.find(record => record.recordId === id).status, 'AGUARDANDO_SUPERVISOR');
  assert.equal(after.counts().dataReads, 2); assert.equal(after.counts().writes, 0);
  assert.equal(after.calls.bulkCache, 1);
});
test('mais de 500 referências usa lotes limitados e preserva todas as chaves', () => {
  const h = harness(fixed); const { COL } = h.c.meta; const rows = []; const requested = [];
  for (let index = 0; index < 1100; index++) {
    const row = Array(COL.WIDTH).fill(''); row[COL.PHOTO_1 - 1] = 'fixture_' + String(index).padStart(4, '0') + '_abcdefghijklmnopqrstuvwxyz'; rows.push(row);
  }
  h.c.CacheService = { getScriptCache: () => ({ getAll(keys) { requested.push(keys); return Object.fromEntries(keys.map(key => [key, '1'])); } }) };
  assert.equal(Object.keys(h.c.cachedPublicPhotosForRows_(rows)).length, 1100);
  assert.deepEqual(requested.map(keys => keys.length), [500, 500, 100]);
});

let passed = 0; const failures = [];
for (const { name, run } of tests) { try { run(); passed++; } catch (error) { failures.push({ name, error: error.message }); } }
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
