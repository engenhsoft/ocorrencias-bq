// Frontend contract tests only. Actual app/API/IDB adapters, in-memory IDB and
// a synthetic server/Drive contract. This does NOT execute private Apps Script.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as core from '../core.js';

const read = name => readFile(process.env.OCCBQ_FRONTEND_SOURCE && !name.startsWith('tests/') ? path.join(process.env.OCCBQ_FRONTEND_SOURCE, name) : new URL('../' + name, import.meta.url), 'utf8');
const [app, api, db, drafts, audit] = await Promise.all(['app.js', 'api.js', 'db.js', 'fiscal-drafts.js', 'tests/audit-regression.mjs'].map(read));
const extract = (source, name) => {
  const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(match, name); return match[0];
};
const moduleBody = source => source.replace(/^import[^;]*;\n/gm, '').replace(/^export /gm, '');
const fakeIdb = vm.runInNewContext(extract(audit, 'createFakeIndexedDb') + '\ncreateFakeIndexedDb', { Map, queueMicrotask, setTimeout, structuredClone });
const clone = value => structuredClone(value);
const UUID = '11111111-2222-4333-8444-555555555555';
const ROUTE = { routingVersion: 'FISCAL_ASSIGNED', routingRequestId: '22222222-2222-4222-8222-222222222222', assignmentRevision: '33333333-3333-4333-8333-333333333333', assignedFiscal: 'FISCAL FIXTURE', base: 'ASSÚ', assignmentStatus: 'ASSIGNED', requestedAt: '2026-10-15T19:09:44-03:00' };
const oldKey = index => `${String(index).repeat(8)}-4444-4444-8444-444444444444`;
function originalRecord() {
  const photos = Array.from({ length: 5 }, (_, index) => `https://example.test/old-photo-${index + 1}`);
  return core.normalizeOccurrenceRecord({ recordId: UUID, user: 'CAMPO FIXTURE', registeredAt: '2026-10-15T18:00:00-03:00',
    base: 'ASSÚ', contract: '4600080939', team: 'EQUIPE FIXTURE', crewLeader: 'CHEFE FIXTURE', occurrenceNumber: 'FIXTURE FOTO 1',
    occurrenceTypes: ['LINHA VIVA'], observation: '', totalServices: 100,
    services: [{ lineId: 'service-fixture', catalogKey: 'fixture:1', code: 'S-FIXTURE', catalogText: 'Serviço sintético', unit: 'UD', group: 'FIXTURE', origin: 'Emergência', contract: '4600080939', referenceValue: 100, quantity: 1, totalValue: 100 }],
    materials: [{ lineId: 'material-fixture', code: '000001', description: 'Material sintético', unit: 'UN', quantity: 2 }],
    photos, photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: index < 5, serverUrl: photos[index] || '', uploadKey: index < 5 ? oldKey(index + 1) : '' })),
    status: core.RECORD_STATUS.CORRECTION_REQUESTED, fiscalCorrection: clone(ROUTE),
    audit: { expectedPhotoIndexes: [1, 2, 3, 4, 5], requestedPhotoIndexes: [1], lastCorrectionRequest: clone(ROUTE), timeline: [] } });
}

async function runtime({ slots = [1], changes = {}, preverified = true, field = false } = {}) {
  const original = originalRecord(), events = [], logs = [], notices = [], drive = new Map();
  const route = field ? { routingVersion: 'LEGACY_FIELD', requestedAt: ROUTE.requestedAt } : clone(ROUTE);
  const local = { ...clone(original), ...changes, correctionMode: true, correctionOriginal: core.correctionOriginalSnapshot(original),
    correctionRequestedAt: ROUTE.requestedAt, correctionRequestId: randomUUID(), serverConfirmed: true,
    fiscalCorrection: field ? undefined : route, fiscalAclRevision: field ? undefined : 'acl-fixture', status: core.RECORD_STATUS.PENDING };
  for (const index of slots) local.photoStates[index - 1] = { ...local.photoStates[index - 1], uploadKey: randomUUID(), confirmed: false, localReady: true, replacePending: true };
  Object.assign(local, core.correctionDelta(local.correctionOriginal, local));
  local.correctionPayloadSignature = JSON.stringify({ data: core.correctionDataSnapshot(local), photoPatch: local.photoPatch, evidencePatch: local.evidencePatch });
  let server = clone(original), fault = '', submitted = 0, uploadCalls = 0, lost = '', loggedOut = false;
  const time = '2026-10-15T19:12:06-03:00';
  const verifyData = record => {
    server = { ...server, ...core.correctionFields(record) };
    server.audit.lastCorrectionSubmission = { requestId: record.correctionRequestId, requestedAt: ROUTE.requestedAt, receivedAt: time, dataVerifiedAt: time,
      phase: 'DATA_VERIFIED', expectedPatch: clone(record.expectedPatch), beforePatch: clone(record.beforePatch), photoPatch: clone(record.photoPatch), evidencePatch: clone(record.evidencePatch) };
  };
  if (preverified) verifyData(local);
  const state = () => ({ ok: true, success: true, recordId: UUID, status: server.status, record: clone(server), photoStates: clone(server.photoStates) });
  function handle(payload) {
    const context = payload.fiscalCorrection || payload.record?.fiscalCorrection;
    if (!field && (!context || context.routingRequestId !== server.fiscalCorrection.routingRequestId || context.assignmentRevision !== server.fiscalCorrection.assignmentRevision || context.assignedFiscal !== ROUTE.assignedFiscal)) return { ok: false, error: 'FISCAL_ASSIGNMENT_CHANGED', message: 'A atribuição mudou. O rascunho foi preservado.' };
    if (payload.action === 'getRecordState') {
      if (fault === 'readback' && server.audit.lastCorrectionSubmission?.phase === 'COMPLETE') throw Error('Synthetic network failure');
      return state();
    }
    if (payload.action === 'submitRecord') { submitted++; verifyData(payload.record); return state(); }
    assert.equal(payload.action, 'uploadPhoto'); uploadCalls++;
    if (fault === 'upload') throw Error('Synthetic network failure before upload');
    if (fault === 'technical') return { ok: false, error: 'SERVER_ERROR', message: 'TypeError: fixture-secret-token data:image/jpeg;base64,SECRET', details: { token: 'fixture-secret-token' } };
    if (fault === 'forbidden') return { ok: false, error: 'FORBIDDEN', message: 'Este Fiscal não está autorizado.' };
    const receipt = server.audit.lastCorrectionSubmission;
    const declared = { ...receipt.photoPatch, ...receipt.evidencePatch }[payload.photoIndex];
    assert.equal(declared?.uploadKey, payload.uploadKey, 'contract fixture requires declared key');
    if (fault === 'wrong-key') return state();
    if (!drive.has(payload.uploadKey)) drive.set(payload.uploadKey, `https://example.test/new-photo-${drive.size + 1}`);
    if (fault === 'after-drive') throw Error('Synthetic failure after file creation, before sheet persistence');
    const index = payload.photoIndex, oldUrl = server.photoStates[index - 1].serverUrl, url = drive.get(payload.uploadKey);
    server.photoStates[index - 1] = { photoIndex: index, confirmed: true, uploadKey: payload.uploadKey, serverUrl: url };
    if (index <= 5) server.photos[index - 1] = url;
    else server.transformerPhotos[index === 6 ? 'removed' : 'installed'] = url;
    server.audit.photoSubmissions ||= {};
    server.audit.photoSubmissions[index] = { uploadKey: payload.uploadKey, phase: 'COMPLETE', expectedUrl: url, previousUrl: oldUrl, requestedAt: ROUTE.requestedAt, receivedAt: '2026-10-15T19:12:07-03:00' };
    const declaredAll = { ...receipt.photoPatch, ...receipt.evidencePatch };
    if (fault !== 'receipt' && Object.entries(declaredAll).every(([slot, entry]) => server.photoStates[Number(slot) - 1].uploadKey === entry.uploadKey)) {
      receipt.phase = 'COMPLETE'; server.status = core.RECORD_STATUS.WAITING_SUPERVISOR;
      server.audit.requestedPhotoIndexes = []; server.audit.timeline = [{ action: 'CORRECAO_REENVIADA' }];
      if (server.fiscalCorrection) server.fiscalCorrection.assignmentStatus = 'COMPLETE';
    }
    return state();
  }
  const idb = fakeIdb();
  class FileReader {
    readAsDataURL(blob) {
      if (fault === 'encode') { this.error = new Error('PRIVATE FILE PATH'); queueMicrotask(() => this.onerror()); return; }
      blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); });
    }
    abort() { this.onabort?.(); }
  }
  const c = vm.createContext({ ...core, Map, Set, Object, Date, Blob, JSON, Buffer, URL, AbortController, structuredClone, queueMicrotask, setTimeout, clearTimeout, FileReader,
    crypto: { randomUUID }, navigator: { onLine: true }, indexedDB: idb, IDBKeyRange: { only: value => value },
    session: { token: 'fixture-secret-token', user: field ? original.user : ROUTE.assignedFiscal, role: field ? 'field' : 'fiscal', aclRevision: 'acl-fixture' }, sessionRevision: 1,
    recordSyncPromises: new Map(), TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO', dailyProduction: { totalExcludingRecord: 0 }, LAST_SYNC_META: 'fixture-last-sync',
    cacheDailySummary: async () => {}, updateQueueUi: async () => {}, currentView: 'fixture', mineRecords: [], photoSyncAllRunning: false,
    refreshMine() {}, logout() { loggedOut = true; }, toast() {},
    featuresController: () => ({ fiscalSyncChanged: record => notices.push(clone(record.syncProgress)), fiscalConfirmed() {} }),
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body); events.push({ action: payload.action, uploadKey: payload.uploadKey, photoIndex: payload.photoIndex, replace: payload.replace, context: clone(payload.fiscalCorrection) });
      const result = handle(payload);
      if (lost === payload.action) { lost = ''; throw Error('Synthetic response lost after persistence'); }
      return { ok: true, status: 200, text: async () => JSON.stringify(result) };
    }
  });
  vm.runInContext(moduleBody(db) + '\n' + moduleBody(drafts) + "\nconst API_ENDPOINT='https://script.google.com/macros/s/fixture/exec';const MATERIAL_CATALOG_SOURCE={};\n" + moduleBody(api), c);
  vm.runInContext(['correctionRequest', 'syncSingleRecord', 'performSyncSingleRecord', 'isTechnicalErrorMessage', 'friendlyError'].map(name => extract(app, name)).join('\n'), c);
  const key = field ? '' : c.fiscalDraftKey(ROUTE.assignedFiscal, UUID, ROUTE, 'acl-fixture'); local.fiscalDraftKey = key;
  const storage = field ? { getRecord: c.getRecord, putRecord: c.putRecord, getPhoto: c.getPhoto, putPhotoAndRecord: c.putPhotoAndRecord } : c.fiscalDraftStorage(key);
  await c.putRecord({ ...clone(original), marker: 'CAMPO_PRESERVADO' });
  if (!field) await storage.putRecord(local);
  else await c.putRecord(local);
  for (const index of slots) await storage.putPhotoAndRecord(await storage.getRecord(UUID), index, new Blob(['synthetic-image'], { type: 'image/jpeg' }), local.photoStates[index - 1].uploadKey, { mimeType: 'image/jpeg', fileName: 'fixture.jpg' });
  return { c, key, storage, drive, events, logs, notices, original, local,
    run: () => c.syncSingleRecord(UUID, false, key), state, server: () => server, fault: value => { fault = value; }, lose: value => { lost = value; }, counts: () => ({ submitted, uploadCalls }), loggedOut: () => loggedOut,
    reassign: () => { server.fiscalCorrection.assignmentRevision = randomUUID(); } };
}

const tests = [], results = [];
const test = (name, run) => tests.push({ name, run });
function assertComplete(h, result, slots = [1]) {
  assert.equal(result.syncPhase, 'confirmed', result.lastError); assert.equal(result.recordId, UUID); assert.equal(result.status, core.RECORD_STATUS.WAITING_SUPERVISOR);
  assert.equal(h.server().audit.lastCorrectionSubmission.phase, 'COMPLETE');
  for (const index of slots) assert.equal(h.server().photoStates[index - 1].uploadKey, h.local.photoStates[index - 1].uploadKey);
  assert.equal(h.server().audit.timeline.filter(event => event.action === 'CORRECAO_REENVIADA').length, 1);
}
function assertOtherDataPreserved(h) {
  for (const field of ['recordId', 'user', 'registeredAt', 'services', 'materials']) assert.deepEqual(h.server()[field], h.original[field], field);
  for (const index of [2, 3, 4, 5]) assert.deepEqual(h.server().photoStates[index - 1], h.original.photoStates[index - 1]);
}

test('photo-only DATA_VERIFIED resumes Foto 1, zero data resubmissions, UUID and slots 2–5 preserved', async () => {
  const h = await runtime(), result = await h.run(); assertComplete(h, result); assertOtherDataPreserved(h);
  assert.deepEqual(h.counts(), { submitted: 0, uploadCalls: 1 }); assert.equal(h.drive.size, 1);
  assert.equal(h.events.find(event => event.action === 'uploadPhoto').replace, true);
  assert.deepEqual(h.events.find(event => event.action === 'uploadPhoto').context, ROUTE);
  assert.equal((await h.c.getRecord(UUID)).marker, 'CAMPO_PRESERVADO'); assert.ok(await h.storage.getRecord(UUID));
});
test('photo-only fresh send creates one data receipt then confirms one photo', async () => {
  const h = await runtime({ preverified: false }); assertComplete(h, await h.run()); assert.deepEqual(h.counts(), { submitted: 1, uploadCalls: 1 });
});
test('mixed data + photo preserves confirmed data and sends no repeated data', async () => {
  const h = await runtime({ changes: { observation: 'Texto sintético corrigido' } }); assertComplete(h, await h.run()); assert.equal(h.server().observation, 'Texto sintético corrigido'); assert.equal(h.counts().submitted, 0);
});
test('failure reading IDB photo stores stage/code, keeps Blob and retries same key', async () => {
  const h = await runtime(), originalStorage = h.c.fiscalDraftStorage;
  h.c.fiscalDraftStorage = key => ({ ...originalStorage(key), getPhoto: async () => { throw Object.assign(new Error('private-message'), { name: 'InvalidStateError' }); } });
  const result = await h.run(); assert.equal(result.lastSyncError.stage, 'read_photo'); assert.equal(result.lastSyncError.code, 'INVALID_STATE_ERROR');
  assert.ok((await h.storage.getPhoto(UUID, 1)).blob instanceof Blob); assert.equal(h.counts().uploadCalls, 0);
  h.c.fiscalDraftStorage = originalStorage; assertComplete(h, await h.run());
});
test('failure converting Blob reports encode stage and preserves local photograph', async () => {
  const h = await runtime(); h.fault('encode'); const result = await h.run(); assert.equal(result.lastSyncError.stage, 'encode_photo'); assert.equal(result.lastSyncError.code, 'LOCAL_PHOTO_READ_ERROR');
  assert.ok((await h.storage.getPhoto(UUID, 1)).blob instanceof Blob); assert.equal(h.counts().uploadCalls, 0); h.fault(''); assertComplete(h, await h.run());
});
test('network failure before upload preserves photo and retries without resubmitting data', async () => {
  const h = await runtime(); h.fault('upload'); const first = await h.run(); assert.equal(first.syncPhase, 'error'); assert.equal(first.lastSyncError.code, 'NETWORK_ERROR');
  assert.match(first.lastError, /Dados confirmados.*Foto 1 pendente/); assert.ok((await h.storage.getPhoto(UUID, 1)).blob instanceof Blob);
  const receipt = h.server().audit.lastCorrectionSubmission.requestId; h.fault(''); assertComplete(h, await h.run()); assert.equal(h.counts().submitted, 0); assert.equal(h.server().audit.lastCorrectionSubmission.requestId, receipt);
});
test('technical server exception stores type/code/stage and logs no token, image or response body', async () => {
  const h = await runtime(); h.fault('technical'); const result = await h.run();
  assert.deepEqual(JSON.parse(JSON.stringify(result.lastSyncError)), { stage: 'upload_photo', code: 'SERVER_ERROR', exception: 'TypeError', photoIndex: 1, dataConfirmed: true });
  assert.match(result.lastError, /upload_photo\/SERVER_ERROR/); assert.ok((await h.storage.getPhoto(UUID, 1)).blob);
  assert.doesNotMatch(JSON.stringify({ logs: h.logs, error: result.lastSyncError, text: result.lastError }), /fixture-secret-token|data:image|SECRET|private-message/);
});
test('response lost after upload reconciles by exact key, one upload and one file', async () => {
  const h = await runtime(); h.lose('uploadPhoto'); assertComplete(h, await h.run()); assert.equal(h.drive.size, 1); assert.equal(h.counts().uploadCalls, 1); assert.equal(h.counts().submitted, 0);
});
test('response lost after data commit does not submit data a second time', async () => {
  const h = await runtime({ preverified: false, changes: { observation: 'Mista' } }); h.lose('submitRecord'); assertComplete(h, await h.run()); assert.equal(h.counts().submitted, 1);
});
test('retry after Drive creation before sheet response reuses same key and one synthetic file', async () => {
  const h = await runtime(); h.fault('after-drive'); assert.equal((await h.run()).syncPhase, 'error'); assert.equal(h.drive.size, 1); assert.ok((await h.storage.getPhoto(UUID, 1)).blob);
  h.fault(''); assertComplete(h, await h.run()); assert.equal(h.drive.size, 1); assert.equal(h.counts().submitted, 0);
});
test('lost final readback retains draft; retry only reads and confirms COMPLETE', async () => {
  const h = await runtime(); h.fault('readback'); const first = await h.run(); assert.equal(first.lastSyncError.stage, 'confirm_correction'); assert.equal(first.syncPhase, 'error'); assert.ok(await h.storage.getRecord(UUID));
  h.fault(''); assertComplete(h, await h.run()); assert.equal(h.counts().uploadCalls, 1); assert.equal(h.counts().submitted, 0);
});
test('photoPatch intent or old key alone never confirms corrected photograph', async () => {
  const h = await runtime(); h.fault('wrong-key'); const result = await h.run(); assert.equal(result.syncPhase, 'error'); assert.equal(result.lastSyncError.code, 'PHOTO_CONFIRMATION_PENDING');
  assert.ok((await h.storage.getPhoto(UUID, 1)).blob); assert.equal((await h.storage.getRecord(UUID)).photoStates[0].replacePending, true); assert.equal(h.server().status, core.RECORD_STATUS.CORRECTION_REQUESTED);
});
test('new photo without COMPLETE receipt does not show correction success', async () => {
  const h = await runtime(); h.fault('receipt'); const result = await h.run(); assert.equal(result.syncPhase, 'error'); assert.equal(result.lastSyncError.code, 'CORRECTION_DATA_UNCONFIRMED'); assert.ok(await h.storage.getRecord(UUID));
});
test('wrong local uploadKey is blocked before upload and Blob remains', async () => {
  const h = await runtime(), record = await h.storage.getRecord(UUID); record.photoStates[0].uploadKey = randomUUID();
  // Keep the signed data intent unchanged and force only a local identity mismatch.
  const adapter = h.c.fiscalDraftStorage;
  h.c.fiscalDraftStorage = key => ({ ...adapter(key), getPhoto: async (...args) => ({ ...await adapter(key).getPhoto(...args), uploadKey: randomUUID() }) });
  const result = await h.run(); assert.equal(result.lastSyncError.code, 'LOCAL_PHOTO_IDENTITY_MISMATCH'); assert.equal(h.counts().uploadCalls, 0); assert.ok((await h.storage.getPhoto(UUID, 1)).blob);
});
test('backend authorization rejection is preserved and does not remove draft or image', async () => {
  const h = await runtime(); h.fault('forbidden'); const result = await h.run(); assert.equal(result.lastSyncError.code, 'FORBIDDEN'); assert.equal(result.lastError, 'Este Fiscal não está autorizado.'); assert.ok((await h.storage.getPhoto(UUID, 1)).blob); assert.equal(h.drive.size, 0);
});
test('changed assignment blocks client continuation before photo upload', async () => {
  const h = await runtime(); h.reassign(); const result = await h.run(); assert.equal(result.lastSyncError.code, 'FISCAL_ASSIGNMENT_CHANGED'); assert.equal(h.counts().uploadCalls, 0); assert.ok((await h.storage.getPhoto(UUID, 1)).blob);
});
test('legacy Campo correction keeps photo-only retry working', async () => {
  const h = await runtime({ field: true }); assertComplete(h, await h.run()); assert.equal(h.counts().submitted, 0);
});
test('mixed general and Trafo evidence 6/7 remain separate and complete after all slots', async () => {
  const h = await runtime({ slots: [1, 6, 7], changes: { observation: 'Mista', occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '21', removedCia: '22', removedBto: '23', newCode: '24', newCia: '25', newBto: '26' } } });
  assertComplete(h, await h.run(), [1, 6, 7]); assert.equal(h.drive.size, 3); assert.equal(h.counts().submitted, 0);
});
test('progress identifies Foto 1 read, conversion and upload after confirmed data', async () => {
  const h = await runtime(); assertComplete(h, await h.run());
  for (const stage of ['read_photo', 'encode_photo', 'upload_photo']) assert.ok(h.notices.some(progress => progress.stage === stage && progress.photoIndex === 1 && progress.dataConfirmed));
  assert.match(core.synchronizationFeedback({ syncPhase: 'photos', syncProgress: { stage: 'upload_photo', photoIndex: 1, dataConfirmed: true } }).detail, /Dados confirmados.*Foto 1: enviando/);
});
test('malformed local Blob fails with recoverable code before FileReader starts', async () => {
  const h = await runtime(); await assert.rejects(() => h.c.blobToDataUrl({ size: 12 }), error => error.code === 'LOCAL_PHOTO_INVALID');
});
test('session change during Blob conversion stops upload and preserves pending photograph', async () => {
  const h = await runtime(), encode = h.c.blobToDataUrl;
  h.c.blobToDataUrl = async blob => { const url = await encode(blob); h.c.sessionRevision++; return url; };
  const result = await h.run(); assert.equal(result.lastSyncError.code, 'SESSION_CHANGED'); assert.equal(h.counts().uploadCalls, 0); assert.ok((await h.storage.getPhoto(UUID, 1)).blob);
});
test('new runtime storage adapter after a failed send resumes the same persisted Blob/key', async () => {
  const h = await runtime(); h.fault('upload'); await h.run();
  const reopened = h.c.fiscalDraftStorage(h.key), saved = await reopened.getPhoto(UUID, 1);
  assert.ok(saved.blob instanceof Blob); assert.equal(saved.uploadKey, h.local.photoStates[0].uploadKey);
  assert.equal(await saved.blob.text(), 'synthetic-image'); h.fault(''); assertComplete(h, await h.run());
});

for (const item of tests) {
  try { await item.run(); results.push({ name: item.name, passed: true }); }
  catch (error) { results.push({ name: item.name, passed: false, error: error.message, stack: error.stack?.split('\n').slice(0, 4).join('\n') }); }
}
const report = { kind: 'frontend-contract-fixtures', privateAppsScriptExecuted: false, realServerConfirmation: false, productionWrites: 0,
  total: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); if (report.failed) process.exitCode = 1;
