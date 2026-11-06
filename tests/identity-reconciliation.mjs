import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../maintenance/identity-reconciliation-20261106.gs', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const UUID = '11111111-2222-4333-8444-555555555555', owner = 'owner@fixture.invalid';
function harness() {
  const COL = { ID: 1, REGISTERED_AT: 2, USER: 3, TEAM: 4, OCCURRENCE_NUMBER: 5, TYPES: 6, PHOTO_1: 19, STATUS: 24, AUDIT: 29, UPDATED_AT: 30,
    PG_POST_REMOVED: 7, PG_POST_INSTALLED: 8, PG_CONDUCTOR_START: 9, PG_CONDUCTOR_END: 39, BASE: 40, CREW_LEADER: 41, TRAFO_REMOVED_PHOTO: 42, TRAFO_INSTALLED_PHOTO: 43, WIDTH: 51 };
  const row = Array(51).fill('');
  Object.assign(row, { 0: UUID, 1: '2026-11-01T12:00:00-03:00', 2: 'Jos? Simi?o', 3: 'Equipe TESTE', 4: 'FICTICIA', 5: 'PODA', 14: 123.45, 23: 'FOTOS_SENDO_SINCRONIZADAS', 29: '2026-11-01T12:30:00-03:00', 39: 'CAICÓ' });
  row[28] = JSON.stringify({ pendingServices: [{ code: 'S1', quantity: 1 }], pendingMaterials: [{ code: '001', quantity: 2 }], expectedPhotoIndexes: [1, 2, 3, 4, 5],
    updatedBy: 'Jos? Simi?o', timeline: [{ action: 'CRIADA', actor: 'Jos? Simi?o', at: row[1] }], photoSyncRequest: { recipient: 'Jos? Simi?o', requestedAt: row[29] } });
  const tables = new Map([['pending', [row]], ['official', []], ['history', [[UUID, 'old-time', 'Jos? Simi?o', 'CRIADA']]]]);
  let writes = 0, lockDepth = 0, formula = false, editor = owner;
  const spec = { recordId: UUID, previousUser: row[2], user: 'José Simião', expectedRowSha256: hash(JSON.stringify(row)), sheetName: 'pending', authorizedOwner: owner,
    projectId: '1S65w-vU8SNGI3XsrWjZl609yEu4uQRhRrnQrlnI1bSWg1Gyy_xvup94z', spreadsheetId: 'fixture-spreadsheet', reconciliationId: 'fixture-repair', identityEvidence: 'UUID-specific authenticated owner instruction', backupReference: 'fixture-backup' };
  const sheet = name => ({ name, getRange(number, _column, _height, width) { return {
    getValues: () => [tables.get(name)[number - 2].slice(0, width)],
    getFormulas: () => [Array(width).fill(formula ? '=1' : '')],
    setValues(values) { assert.equal(lockDepth, 1); writes++; tables.get(name)[number - 2] = Array.from(values[0]); }
  }; } });
  const c = vm.createContext({ console, JSON, Object, String, Array, Session: { getActiveUser: () => ({ getEmail: () => owner }), getEffectiveUser: () => ({ getEmail: () => owner }) },
    ScriptApp: { getScriptId: () => spec.projectId }, APP: { spreadsheetId: spec.spreadsheetId, pendingSheet: 'pending', officialSheet: 'official', historySheet: 'history' }, COL, HISTORY_HEADERS: Array(19).fill(''),
    Utilities: { base64EncodeWebSafe: value => Buffer.from(value.replace(/[^\x00-\x7f]/g, '?')).toString('base64url'), base64DecodeWebSafe: value => [...Buffer.from(value, 'base64url')], newBlob: value => ({ getDataAsString: charset => { assert.equal(charset, 'UTF-8'); return Buffer.from(value).toString('utf8'); } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { lockDepth++; }, releaseLock: () => { lockDepth--; } }) },
    requireUuid_: value => assert.equal(value, UUID), sheet_: sheet, safeJson_: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
    publicationRowsForId_: (sh, id) => tables.get(sh.name).map((values, index) => ({ row: index + 2, values: structuredClone(values) })).filter(item => item.values[0] === id),
    sha256_: hash, nowIso_: () => '2026-11-06T13:00:00-03:00', flushSheets_() {},
    appendHistory_: (record, actor, action, before, after, reason, note) => { assert.equal(lockDepth, 1); tables.get('history').push([record.recordId, 'new-time', actor, action, before, after, reason, note]); }
  });
  vm.runInContext(source, c);
  return { c, spec, tables, original: structuredClone(row), run: () => c.reconcileRecordIdentityUtf820261106_(spec, editor), writes: () => writes, lockDepth: () => lockDepth, formula: () => { formula = true; }, otherEditor: () => { editor = 'other@fixture.invalid'; } };
}
const tests = [], test = (name, run) => tests.push({ name, run });
test('reconciliação autorizada altera somente identidade, auditoria e destinatário atual', () => {
  const h = harness(), result = h.run(), row = h.tables.get('pending')[0];
  assert.equal(result.ok, true); assert.equal(result.alreadyApplied, false); assert.equal(h.writes(), 1); assert.equal(h.lockDepth(), 0);
  row.forEach((value, index) => { if (![2, 28].includes(index)) assert.deepEqual(value, h.original[index]); });
  const audit = JSON.parse(row[28]), old = JSON.parse(h.original[28]);
  assert.equal(row[2], 'José Simião'); assert.equal(audit.updatedBy, old.updatedBy); assert.deepEqual(audit.timeline[0], old.timeline[0]);
  assert.deepEqual(audit.pendingServices, old.pendingServices); assert.deepEqual(audit.pendingMaterials, old.pendingMaterials); assert.deepEqual(audit.expectedPhotoIndexes, old.expectedPhotoIndexes);
  assert.equal(audit.photoSyncRequest.recipient, 'José Simião'); assert.equal(audit.photoSyncRequest.requestedAt, old.photoSyncRequest.requestedAt);
  assert.equal(h.tables.get('history').length, 2); assert.equal(h.tables.get('history')[0][2], old.updatedBy);
});
test('retry é idempotente; falha após a linha recupera apenas auditoria de histórico ausente', () => {
  const h = harness(); h.run(); assert.equal(h.run().alreadyApplied, true); assert.equal(h.writes(), 1); assert.equal(h.tables.get('history').length, 2);
  h.tables.get('history').pop(); h.run(); assert.equal(h.tables.get('history').length, 2); assert.equal(h.writes(), 1);
});
for (const [name, change, code] of [
  ['outro operador', h => { h.otherEditor(); }, 'IDENTITY_OWNER_AUTH_REQUIRED'],
  ['sem evidência original', h => { h.spec.identityEvidence = ''; }, 'IDENTITY_EVIDENCE_REQUIRED'],
  ['sem backup', h => { h.spec.backupReference = ''; }, 'IDENTITY_EVIDENCE_REQUIRED'],
  ['fonte modificada', h => { h.tables.get('pending')[0][14] = 999; }, 'IDENTITY_SOURCE_CHANGED'],
  ['UUID duplicado', h => { h.tables.get('official').push(h.original.slice()); }, 'IDENTITY_RECORD_NOT_UNIQUE'],
  ['nova identidade incompatível', h => { h.spec.user = 'Outra Pessoa'; }, 'IDENTITY_DEFECT_MISMATCH'],
  ['fórmula preservada', h => { h.formula(); }, 'IDENTITY_FORMULA_GUARD']
]) test(`${name} bloqueia antes da escrita`, () => {
  const h = harness(); change(h); const before = JSON.stringify([...h.tables]);
  assert.throws(h.run, error => error.message === code); assert.equal(h.writes(), 0); assert.equal(h.lockDepth(), 0); assert.equal(JSON.stringify([...h.tables]), before);
});
const failures = [];
for (const { name, run } of tests) try { await run(); } catch (error) { failures.push({ name, error: error.stack }); }
console.log(JSON.stringify({ total: tests.length, passed: tests.length - failures.length, failed: failures.length, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
