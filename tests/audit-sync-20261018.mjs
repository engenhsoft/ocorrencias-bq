// Actual frontend functions and isolated storage/server contracts. No network.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';
import { createRequire } from 'node:module';
const { IDBFactory, IDBKeyRange } = createRequire(import.meta.url)('fake-indexeddb');

const app = await readFile(process.env.OCCBQ_AUDIT_APP_SOURCE || new URL('../app.js', import.meta.url), 'utf8');
const extract = name => { const match = app.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(match, name); return match[0]; };
const tests = [], results = [], test = (name, run) => tests.push({ name, run });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const UUID = '11111111-2222-4333-8444-555555555555';
const T0 = '2026-10-18T10:00:00.000Z';
const clone = value => structuredClone(value);
const record = () => ({ recordId: UUID, user: 'Campo fixture', status: core.RECORD_STATUS.DRAFT, updatedAt: T0, observation: 'original', photoStates: core.normalizePhotoStates([]) });
function draftRuntime({ fiscal = false, existing = true } = {}) {
  let saved = existing ? record() : null, counter = 0, gate = null;
  const writes = [], notices = [];
  const storage = { putRecord: async (value, options = {}) => {
    if (gate) { const wait = gate; gate = null; await wait; }
    writes.push({ value: clone(value), options: clone(options) });
    if (options.expectedUpdatedAt != null && options.expectedUpdatedAt !== String(saved?.updatedAt || '')) throw Object.assign(Error('newer draft preserved'), { code: 'LOCAL_RECORD_CHANGED' });
    saved = { ...clone(value), updatedAt: new Date(Date.parse(T0) + ++counter * 1000).toISOString() };
    return clone(saved);
  } };
  const c = { activeRecord: existing ? record() : null, occurrenceSubmissionRunning: false, activeDraftSavePromise: null,
    currentStep: 1, sessionRevision: 1, session: { user: 'Campo fixture', role: fiscal ? 'fiscal' : 'field' }, Date,
    editingStorage: () => storage, putRecord: storage.putRecord, blankRecord: record,
    setMeta: async () => {}, ACTIVE_DRAFT_META: 'active', showDraftId: () => notices.push('saved') };
  if (fiscal && c.activeRecord) c.activeRecord.fiscalCorrection = { assignedFiscal: 'Campo fixture' };
  vm.createContext(c); vm.runInContext(extract('ensureActiveRecord') + '\n' + extract('saveActiveDraft'), c);
  return { c, writes, storage, saved: () => saved, replace: next => { saved = clone(next); }, gate: promise => { gate = promise; } };
}
for (const fiscal of [false, true]) test(`${fiscal ? 'Fiscal' : 'Campo'} autosave rejects newer draft from another tab`, async () => {
  const h = draftRuntime({ fiscal }); h.replace({ ...h.saved(), observation: 'newer tab', updatedAt: '2026-10-18T10:00:10.000Z' }); h.c.activeRecord.observation = 'stale tab';
  await assert.rejects(h.c.saveActiveDraft(), error => error.code === 'LOCAL_RECORD_CHANGED');
  assert.equal(h.saved().observation, 'newer tab'); assert.equal(h.c.activeRecord.observation, 'stale tab');
});
test('autosave incorporates the committed revision into the active draft', async () => {
  const h = draftRuntime(); await h.c.saveActiveDraft(); assert.equal(h.c.activeRecord.updatedAt, h.saved().updatedAt);
  h.c.activeRecord.observation = 'next edit'; await h.c.saveActiveDraft(); assert.equal(h.saved().observation, 'next edit');
});
test('two autosaves queued before the first commits preserve the latest fields', async () => {
  const h = draftRuntime(), gate = deferred(); h.gate(gate.promise);
  h.c.activeRecord.observation = 'first'; const first = h.c.saveActiveDraft();
  h.c.activeRecord.observation = 'second'; const second = h.c.saveActiveDraft(); gate.resolve();
  await Promise.all([first, second]); assert.equal(h.saved().observation, 'second'); assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].options.expectedUpdatedAt, '2026-10-18T10:00:01.000Z');
});
test('a photo committed after an autosave supplies its own revision to the next save', async () => {
  const h = draftRuntime(); await h.c.saveActiveDraft(); const updated = { ...h.saved(), updatedAt: '2026-10-18T10:00:20.000Z', photoStates: core.normalizePhotoStates([{ photoIndex: 1, localReady: true, uploadKey: 'photo-1' }]) };
  h.replace(updated); h.c.activeRecord = clone(updated); h.c.activeRecord.observation = 'with photo'; await h.c.saveActiveDraft();
  assert.equal(h.saved().photoStates[0].uploadKey, 'photo-1'); assert.equal(h.saved().observation, 'with photo');
});
test('photo revision is preserved while the preceding autosave still awaits metadata', async () => {
  const h = draftRuntime(), metadata = deferred(); h.c.setMeta = () => metadata.promise;
  const first = h.c.saveActiveDraft(); await tick();
  const withPhoto = { ...h.saved(), updatedAt: '2026-10-18T10:00:20.000Z', photoStates: core.normalizePhotoStates([{ photoIndex: 1, localReady: true, uploadKey: 'new-photo' }]) };
  h.replace(withPhoto); h.c.activeRecord = clone(withPhoto); h.c.activeRecord.observation = 'photo still current';
  const second = h.c.saveActiveDraft(); metadata.resolve(); await Promise.all([first, second]);
  assert.equal(h.writes[1].options.expectedUpdatedAt, withPhoto.updatedAt); assert.equal(h.saved().photoStates[0].uploadKey, 'new-photo');
});
test('three queued saves preserve the committed version throughout the chain', async () => {
  const h = draftRuntime(), gate = deferred(); h.gate(gate.promise); const saves = [];
  for (const value of ['first', 'second', 'third']) { h.c.activeRecord.observation = value; saves.push(h.c.saveActiveDraft()); }
  gate.resolve(); await Promise.all(saves); assert.equal(h.saved().observation, 'third'); assert.equal(h.c.activeRecord.updatedAt, h.saved().updatedAt);
});
test('a third save started after an ancestor commits follows the pending child revision', async () => {
  const h = draftRuntime(), metadata = deferred(); h.c.setMeta = () => metadata.promise;
  h.c.activeRecord.observation = 'first'; const first = h.c.saveActiveDraft();
  h.c.activeRecord.observation = 'second'; const second = h.c.saveActiveDraft(); await tick();
  assert.equal(h.c.activeRecord.updatedAt, '2026-10-18T10:00:01.000Z'); h.c.activeRecord.observation = 'third'; const third = h.c.saveActiveDraft();
  metadata.resolve(); await Promise.all([first, second, third]); assert.equal(h.saved().observation, 'third'); assert.equal(h.c.activeRecord.updatedAt, h.saved().updatedAt);
  assert.equal(h.writes[2].options.expectedUpdatedAt, '2026-10-18T10:00:02.000Z');
});
test('creation in progress serializes an autosave and adopts the committed revision', async () => {
  const h = draftRuntime({ existing: false }), gate = deferred(); h.gate(gate.promise);
  const creating = h.c.ensureActiveRecord(); h.c.activeRecord.observation = 'typed while opening'; const saving = h.c.saveActiveDraft(); gate.resolve();
  await Promise.all([creating, saving]); assert.equal(h.saved().observation, 'typed while opening'); assert.equal(h.c.activeRecord.updatedAt, h.saved().updatedAt);
});
test('failed autosave cannot rebase a second stale edit over another tab', async () => {
  const h = draftRuntime(), gate = deferred(); h.gate(gate.promise);
  const first = h.c.saveActiveDraft(); h.c.activeRecord.observation = 'second stale edit'; const second = h.c.saveActiveDraft();
  h.replace({ ...h.saved(), observation: 'newer tab', updatedAt: '2026-10-18T10:00:20.000Z' }); gate.resolve();
  const outcomes = await Promise.allSettled([first, second]); assert.ok(outcomes.every(result => result.status === 'rejected' && result.reason.code === 'LOCAL_RECORD_CHANGED'));
  assert.equal(h.saved().observation, 'newer tab');
});

test('submission does not overwrite a draft changed in another tab during confirmation', async () => {
  const h = draftRuntime(), confirmation = deferred(), messages = []; let syncs = 0;
  Object.assign(h.c, { ...core, photoSelectionRequests: new Map(), fieldServiceSnapshot: [],
    validateStepOne: () => true, countReadyPhotoStates: () => 3, validateOccurrence: () => [], syncFormToRecord() {},
    confirmAction: () => confirmation.promise, setBusy() {}, elements: { submitOccurrenceButton: {} },
    toast: message => messages.push(message), clearMetaIfValue: async () => {},
    syncSingleRecord: async () => { syncs++; }, resetForm() {}, navigate() {}, currentView: 'new', console: { error() {} }, friendlyError: e => e.message });
  vm.runInContext(extract('submitOccurrence'), h.c); const submit = h.c.submitOccurrence();
  h.replace({ ...h.saved(), observation: 'newer tab', updatedAt: '2026-10-18T10:00:20.000Z' }); confirmation.resolve(true); await submit;
  assert.equal(h.saved().observation, 'newer tab'); assert.equal(syncs, 0); assert.equal(h.c.occurrenceSubmissionRunning, false); assert.equal(h.c.activeRecord.observation, 'original');
});
const [dbSource, fiscalSource] = await Promise.all(['db.js', 'fiscal-drafts.js'].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')));
const body = source => source.replace(/^import[^;]*;\n/gm, '').replace(/^export /gm, '').replace(/^\{ DB_NAME \};$/m, '');
async function indexedRuntime(fiscal) {
  const notices = [];
  const c = { ...core, indexedDB: new IDBFactory(), IDBKeyRange, setTimeout, clearTimeout, structuredClone, Date,
    session: { user: 'Campo fixture', role: 'field' }, sessionRevision: 1, activeRecord: null,
    occurrenceSubmissionRunning: false, activeDraftSavePromise: null, currentStep: 1,
    blankRecord: record, ACTIVE_DRAFT_META: 'active', showDraftId() {}, console,
    photoSelectionRequests: new Map(), activePhotos: new Map(), optimizePhoto: async file => file,
    ApiError, URL: { createObjectURL: () => 'blob:fixture' }, setPreviewUrl() {}, updatePhotoGrid() {}, validateStepOne() {},
    toast: message => notices.push(message), friendlyError: error => error.message };
  vm.createContext(c); vm.runInContext(body(dbSource) + '\n' + body(fiscalSource) + '\n' + extract('ensureActiveRecord') + '\n' + extract('saveActiveDraft') + '\n' + extract('storeSelectedPhoto'), c);
  const key = 'fiscalCorrection:actual-idb-fixture';
  const storage = fiscal ? c.fiscalDraftStorage(key) : { getRecord: c.getRecord, putRecord: c.putRecord, putPhotoAndRecord: c.putPhotoAndRecord, getPhoto: c.getPhoto };
  c.editingStorage = () => storage;
  if (fiscal) { c.activeRecord = await storage.putRecord({ ...record(), fiscalCorrection: { assignedFiscal: 'Campo fixture' } }); }
  else await c.ensureActiveRecord();
  return { c, storage, notices };
}
for (const fiscal of [false, true]) test(`${fiscal ? 'Fiscal' : 'Campo'} actual IndexedDB adapters preserve rapid saves and reject stale overwrite`, async () => {
  const { c, storage } = await indexedRuntime(fiscal);
  c.activeRecord.observation = 'first'; const first = c.saveActiveDraft();
  c.activeRecord.observation = 'second'; const second = c.saveActiveDraft(); await Promise.all([first, second]);
  let persisted = await storage.getRecord(UUID); assert.equal(persisted.observation, 'second'); assert.equal(c.activeRecord.updatedAt, persisted.updatedAt);
  await storage.putRecord({ ...persisted, observation: 'other tab newer' }); c.activeRecord.observation = 'stale overwrite';
  await assert.rejects(c.saveActiveDraft(), error => error.code === 'LOCAL_RECORD_CHANGED');
  persisted = await storage.getRecord(UUID); assert.equal(persisted.observation, 'other tab newer'); assert.equal(c.activeRecord.observation, 'stale overwrite');
});
for (const fiscal of [false, true]) test(`${fiscal ? 'Fiscal' : 'Campo'} delayed photo UI preserves newer persisted data and keeps Blob recoverable`, async () => {
  const h = await indexedRuntime(fiscal), oldVersion = h.c.activeRecord.updatedAt, optimizing = deferred();
  h.c.optimizePhoto = () => optimizing.promise;
  const selecting = h.c.storeSelectedPhoto(1, new Blob(['selected-photo'], { type: 'image/jpeg' }), false); await tick();
  const newer = await h.storage.putRecord({ ...await h.storage.getRecord(UUID), observation: 'newer tab', pgPostRemoved: 'NEW-PG', services: [{ code: 'S2', quantity: 5 }], materials: [{ code: '0002', quantity: 2.5 }], correctionRequestId: 'newer-receipt' });
  optimizing.resolve(new Blob(['selected-photo'], { type: 'image/jpeg' })); await selecting;
  const persisted = await h.storage.getRecord(UUID);
  for (const field of ['observation', 'pgPostRemoved', 'services', 'materials', 'correctionRequestId']) assert.deepEqual(persisted[field], newer[field]);
  assert.equal(await (await h.storage.getPhoto(UUID, 1)).blob.text(), 'selected-photo');
  assert.equal(h.c.activeRecord.updatedAt, oldVersion); assert.equal(h.c.activeRecord.observation, 'original'); assert.ok(h.notices.some(message => /reabra/i.test(message)));
  await assert.rejects(h.c.saveActiveDraft(), error => error.code === 'LOCAL_RECORD_CHANGED'); assert.equal((await h.storage.getRecord(UUID)).observation, 'newer tab');
});
for (const fiscal of [false, true]) test(`${fiscal ? 'Fiscal' : 'Campo'} simultaneous photo selections keep both UUID/slot/key tuples`, async () => {
  const h = await indexedRuntime(fiscal);
  await Promise.all([h.c.storeSelectedPhoto(1, new Blob(['photo-1'], { type: 'image/jpeg' }), false), h.c.storeSelectedPhoto(2, new Blob(['photo-2'], { type: 'image/jpeg' }), false)]);
  const persisted = await h.storage.getRecord(UUID);
  for (const index of [1, 2]) { const photo = await h.storage.getPhoto(UUID, index); assert.equal(photo.recordId, UUID); assert.equal(photo.photoIndex, index); assert.equal(photo.uploadKey, persisted.photoStates[index - 1].uploadKey); assert.equal(await photo.blob.text(), 'photo-' + index); }
  assert.equal(persisted.observation, 'original');
});
for (const fiscal of [false, true]) test(`${fiscal ? 'Fiscal' : 'Campo'} late same-slot selection cannot overwrite another tab's newer photo`, async () => {
  const h = await indexedRuntime(fiscal), optimizing = deferred(); h.c.optimizePhoto = () => optimizing.promise;
  const selecting = h.c.storeSelectedPhoto(1, new Blob(['old-selection-A'], { type: 'image/jpeg' }), false); await tick();
  const current = await h.storage.getRecord(UUID), states = clone(current.photoStates); states[0] = { photoIndex: 1, uploadKey: 'newer-photo-B', localReady: true };
  await h.storage.putPhotoAndRecord({ ...current, photoStates: states }, 1, new Blob(['newer-photo-B'], { type: 'image/jpeg' }), 'newer-photo-B');
  optimizing.resolve(new Blob(['old-selection-A'], { type: 'image/jpeg' })); await selecting;
  const photo = await h.storage.getPhoto(UUID, 1), persisted = await h.storage.getRecord(UUID);
  assert.equal(photo.uploadKey, 'newer-photo-B'); assert.equal(persisted.photoStates[0].uploadKey, 'newer-photo-B'); assert.equal(await photo.blob.text(), 'newer-photo-B');
  assert.ok(h.notices.some(message => /outra aba/i.test(message)));
});
test('a photo finishing after guarded draft deletion cannot recreate the draft or its Blob', async () => {
  const h = await indexedRuntime(false), optimizing = deferred(); h.c.optimizePhoto = () => optimizing.promise;
  const selecting = h.c.storeSelectedPhoto(1, new Blob(['deleted-photo'], { type: 'image/jpeg' }), false); await tick();
  await h.c.deleteRecord(UUID, { expectedUpdatedAt: h.c.activeRecord.updatedAt, expectedStatus: core.RECORD_STATUS.DRAFT });
  optimizing.resolve(new Blob(['deleted-photo'], { type: 'image/jpeg' })); await selecting;
  assert.equal(await h.storage.getRecord(UUID), undefined); assert.equal(await h.storage.getPhoto(UUID, 1), undefined); assert.ok(h.notices.some(message => /outra aba/i.test(message)));
});
for (const fiscal of [false, true]) test(`${fiscal ? 'Fiscal' : 'Campo'} late photo cannot change a draft already queued by another tab`, async () => {
  const h = await indexedRuntime(fiscal), optimizing = deferred(); h.c.optimizePhoto = () => optimizing.promise;
  const selecting = h.c.storeSelectedPhoto(1, new Blob(['late-photo'], { type: 'image/jpeg' }), false); await tick();
  await h.storage.putRecord({ ...await h.storage.getRecord(UUID), status: core.RECORD_STATUS.PENDING });
  optimizing.resolve(new Blob(['late-photo'], { type: 'image/jpeg' })); await selecting;
  assert.equal((await h.storage.getRecord(UUID)).status, core.RECORD_STATUS.PENDING); assert.ok(!await h.storage.getPhoto(UUID, 1)); assert.ok(h.notices.some(message => /outra aba/i.test(message)));
});

class ApiError extends Error { constructor(message, code) { super(message); this.code = code; } }
function photoRuntime(mismatch = {}, { fiscal = false } = {}) {
  let saved = { ...record(), status: core.RECORD_STATUS.PENDING, occurrenceTypes: ['PODA'], attempts: 0,
    services: [], materials: [], photoStates: core.normalizePhotoStates(Array.from({ length: 3 }, (_, i) => ({ photoIndex: i + 1, uploadKey: 'slot-' + (i + 1), localReady: true }))) };
  const photos = new Map(Array.from({ length: 3 }, (_, i) => [i + 1, { recordId: UUID, photoIndex: i + 1, uploadKey: 'slot-' + (i + 1), blob: new Blob(['fixture'], { type: 'image/jpeg' }) }]));
  Object.assign(photos.get(1), mismatch);
  const uploaded = [], states = core.normalizePhotoStates([]); let clock = 0;
  const server = () => ({ recordId: UUID, status: uploaded.length >= 3 ? core.RECORD_STATUS.WAITING_SUPERVISOR : core.RECORD_STATUS.SYNCING_PHOTOS,
    record: { ...clone(saved), recordId: UUID, audit: { expectedPhotoIndexes: [1, 2, 3] } }, photoStates: clone(states) });
  const storage = { getRecord: async () => clone(saved), putRecord: async (next, options = {}) => {
    if (options.expectedUpdatedAt != null && options.expectedUpdatedAt !== saved.updatedAt) throw Object.assign(Error('CAS'), { code: 'LOCAL_RECORD_CHANGED' });
    saved = { ...clone(next), updatedAt: String(++clock) }; return clone(saved);
  }, getPhoto: async (_id, index) => photos.get(index), deletePhoto: async (_id, index, key) => { if (photos.get(index)?.uploadKey === key) photos.delete(index); } };
  const key = 'fiscalCorrection:fixture'; if (fiscal) { saved.fiscalDraftKey = key; saved.fiscalCorrection = { assignedFiscal: 'Campo fixture' }; }
  const c = { ...core, ApiError, ...storage, recordSyncPromises: new Map(), sessionRevision: 1,
    session: { token: 'fixture', user: 'Campo fixture', role: fiscal ? 'fiscal' : 'field' }, navigator: { onLine: true },
    fiscalDraftStorage: () => storage, dailyProduction: { totalExcludingRecord: 0 }, TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO',
    featuresController: () => ({ fiscalSyncChanged() {} }), currentView: 'fixture', mineRecords: [], photoSyncAllRunning: false,
    cacheDailySummary: async () => {}, setMeta: async () => {}, LAST_SYNC_META: 'fixture', updateQueueUi: async () => {},
    refreshMine() {}, toast() {}, logout() {}, console: { error() {}, warn() {} }, friendlyError: e => e.message,
    ambiguousMutationError: () => false, blobToDataUrl: async () => 'data:image/jpeg;base64,Zml4dHVyZQ==',
    api: { submitRecord: async () => server(), getRecordState: async () => server(), uploadPhoto: async (_token, photo) => {
      uploaded.push({ recordId: photo.recordId, photoIndex: photo.photoIndex, uploadKey: photo.uploadKey });
      states[photo.photoIndex - 1] = { photoIndex: photo.photoIndex, confirmed: true, uploadKey: photo.uploadKey, url: 'https://fixture.test/' + photo.photoIndex };
      return server();
    } } };
  vm.createContext(c); vm.runInContext(extract('syncSingleRecord') + '\n' + extract('performSyncSingleRecord'), c);
  return { c, photos, uploaded, saved: () => saved, run: () => c.syncSingleRecord(UUID, false, fiscal ? key : '') };
}
for (const [label, mismatch] of [['UUID', { recordId: '99999999-2222-4333-8444-555555555555' }], ['slot', { photoIndex: 2 }], ['upload key', { uploadKey: 'old-slot-1' }], ['missing key', { uploadKey: '' }]]) {
  test(`Campo refuses ${label} mismatch before uploading and preserves every Blob`, async () => {
    const h = photoRuntime(mismatch), result = await h.run(); assert.equal(result.lastSyncError?.code, 'LOCAL_PHOTO_IDENTITY_MISMATCH');
    assert.equal(h.uploaded.length, 0); assert.equal(h.photos.size, 3); assert.equal(result.recordId, UUID);
  });
}
test('valid UUID/slot/upload keys synchronize once and delete only confirmed Blobs', async () => {
  const h = photoRuntime(), result = await h.run(); assert.equal(result.syncPhase, 'confirmed', result.lastError); assert.equal(h.uploaded.length, 3); assert.equal(h.photos.size, 0);
  assert.deepEqual(h.uploaded.map(photo => [photo.recordId, photo.photoIndex, photo.uploadKey]), [1, 2, 3].map(index => [UUID, index, 'slot-' + index]));
});
test('Fiscal keeps the existing identity guard', async () => {
  const h = photoRuntime({ uploadKey: 'old-slot-1' }, { fiscal: true }), result = await h.run(); assert.equal(result.lastSyncError?.code, 'LOCAL_PHOTO_IDENTITY_MISMATCH'); assert.equal(h.uploaded.length, 0); assert.equal(h.photos.size, 3);
});

for (const item of tests) { try { await item.run(); results.push({ name: item.name, ok: true }); } catch (error) { results.push({ name: item.name, ok: false, error: error.stack }); } }
const report = { total: results.length, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length, skipped: 0, productionWrites: 0, results };
console.log(JSON.stringify(report, null, 2)); if (process.env.OCCBQ_SYNC_AUDIT_RESULT) await writeFile(process.env.OCCBQ_SYNC_AUDIT_RESULT, JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
