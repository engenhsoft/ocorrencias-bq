// Isolated IndexedDB/frontend regressions: synthetic records and Blobs only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';

const root = process.env.OCCBQ_FRONTEND_SOURCE || new URL('../', import.meta.url).pathname;
const read = name => readFile(path.join(root, name), 'utf8');
const [dbSource, draftSource, coreSource, fixtures] = await Promise.all(
  ['db.js', 'fiscal-drafts.js', 'core.js', 'tests/audit-regression.mjs'].map(read));
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const factory = fixtures.match(/function createFakeIndexedDb\([^]*?\n\}/)?.[0];
assert.ok(factory, 'existing isolated IndexedDB fixture');
const fakeIdb = vm.runInNewContext(factory + '\ncreateFakeIndexedDb', { Map, queueMicrotask, setTimeout, structuredClone });
const body = source => source.replace(/^import[^;]*;\n/gm, '').replace(/^export /gm, '');
const clone = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const UUID = '11111111-2222-4333-8444-555555555555';
const ROUTE = { routingVersion: 'FISCAL_ASSIGNED', routingRequestId: 'request-fixture', assignmentRevision: 'assignment-fixture', assignedFiscal: 'Fiscal FIXTURE', base: 'ASSÚ' };
const fixture = () => ({ recordId: UUID, user: 'Campo FIXTURE', pgPostRemoved: 'PG original', observation: 'original',
  services: [{ code: 'S01', quantity: 1 }], materials: [{ code: '00001', quantity: 1.5 }],
  fiscalCorrection: clone(ROUTE), fiscalAclRevision: 'acl-fixture',
  photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: false, uploadKey: '', localReady: false })) });

function harness() {
  const indexedDB = fakeIdb();
  const transaction = indexedDB.database.transaction;
  indexedDB.database.transaction = (...args) => {
    const tx = transaction(...args);
    tx.abort = () => queueMicrotask(() => tx.onabort?.());
    const objectStore = tx.objectStore;
    tx.objectStore = name => {
      const store = objectStore(name), index = store.index;
      store.index = field => {
        const result = index(field);
        result.openCursor = query => {
          const request = {}, rowsRequest = result.getAll(query);
          rowsRequest.onsuccess = () => {
            let offset = 0;
            const advance = () => {
              const row = rowsRequest.result[offset];
              request.result = row ? { delete: () => store.delete(row.key), continue: () => { offset++; queueMicrotask(advance); } } : null;
              request.onsuccess?.();
            };
            advance();
          };
          return request;
        };
        return result;
      };
      return store;
    };
    return tx;
  };
  const c = vm.createContext({ ...core, indexedDB, IDBKeyRange: { only: value => value }, Date, console, setTimeout, clearTimeout });
  vm.runInContext(body(dbSource) + '\n' + body(draftSource), c);
  const key = c.fiscalDraftKey(ROUTE.assignedFiscal, UUID, ROUTE, 'acl-fixture');
  return { c, indexedDB, key, storage: c.fiscalDraftStorage(key) };
}

const tests = [], results = [];
const test = (name, run) => tests.push({ name, run });

test('fiscal: delayed photo preserves newer fields, correction receipt and other slots', async () => {
  const h = harness(); const original = await h.storage.putRecord(fixture());
  const newer = await h.storage.putRecord({ ...original, pgPostRemoved: 'PG edited in another tab', observation: 'newer data',
    services: [{ code: 'S02', quantity: 12.5 }], materials: [{ code: '00002', quantity: 2.75 }],
    correctionRequestId: 'newer-request', correctionPayloadSignature: 'newer-signature',
    photoStates: original.photoStates.map(state => state.photoIndex === 2 ? { ...state, uploadKey: 'other-slot', localReady: true } : state) });
  const selected = { ...original, photoStates: original.photoStates.map(state => state.photoIndex === 1 ? { ...state, uploadKey: 'selected-photo', localReady: true } : state) };
  const saved = await h.storage.putPhotoAndRecord(selected, 1, new Blob(['synthetic-photo'], { type: 'image/jpeg' }), 'selected-photo');
  for (const field of ['pgPostRemoved', 'observation', 'services', 'materials', 'correctionRequestId', 'correctionPayloadSignature']) {
    assert.deepEqual(plain(saved.record[field]), plain(newer[field]), field);
  }
  assert.equal(saved.record.photoStates[0].uploadKey, 'selected-photo');
  assert.equal(saved.record.photoStates[1].uploadKey, 'other-slot');
  assert.ok(saved.record.updatedAt > newer.updatedAt);
  const photo = await h.storage.getPhoto(UUID, 1);
  assert.equal(photo.recordId, UUID); assert.equal(photo.photoIndex, 1); assert.equal(photo.uploadKey, 'selected-photo');
  assert.equal(await photo.blob.text(), 'synthetic-photo');
  assert.equal(await h.c.getRecord(UUID), undefined, 'Fiscal draft does not replace Campo queue');
});

test('fiscal: current photo snapshot keeps its data and atomically persists its Blob', async () => {
  const h = harness(); const current = await h.storage.putRecord(fixture());
  const selected = { ...current, observation: 'current form edit', photoStates: current.photoStates.map(state => state.photoIndex === 7 ? { ...state, uploadKey: 'evidence-7', localReady: true } : state) };
  const saved = await h.storage.putPhotoAndRecord(selected, 7, new Blob(['trafo-fixture']), 'evidence-7');
  assert.equal(saved.record.observation, 'current form edit');
  assert.equal(saved.record.photoStates[6].uploadKey, 'evidence-7');
  assert.equal(await (await h.storage.getPhoto(UUID, 7)).blob.text(), 'trafo-fixture');
});

test('fiscal: closed IndexedDB connection is reopened without losing the draft', async () => {
  const h = harness(); const original = await h.storage.putRecord(fixture());
  const transaction = h.indexedDB.database.transaction; let fail = true;
  h.indexedDB.database.transaction = (...args) => {
    if (fail) { fail = false; const error = new Error('Synthetic closed connection'); error.name = 'InvalidStateError'; throw error; }
    return transaction(...args);
  };
  const saved = await h.storage.putRecord({ ...original, observation: 'saved after reconnect' });
  assert.equal(saved.observation, 'saved after reconnect');
  assert.equal((await h.storage.getRecord()).observation, 'saved after reconnect');
  assert.equal(h.indexedDB.stats().openCount, 2);
});

test('fiscal: compare-and-set rejects stale synchronization and preserves newer data', async () => {
  const h = harness(); const original = await h.storage.putRecord(fixture());
  await h.storage.putRecord({ ...original, observation: 'newer local edit' });
  await assert.rejects(h.storage.putRecord({ ...original, observation: 'stale network result' }, { expectedUpdatedAt: original.updatedAt }), error => error.code === 'LOCAL_RECORD_CHANGED');
  assert.equal((await h.storage.getRecord()).observation, 'newer local edit');
});

test('fiscal: replacement Blob survives cleanup from an older upload', async () => {
  const h = harness(); let record = await h.storage.putRecord(fixture());
  const select = key => ({ ...record, photoStates: record.photoStates.map(state => state.photoIndex === 1 ? { ...state, uploadKey: key, localReady: true } : state) });
  record = (await h.storage.putPhotoAndRecord(select('old-key'), 1, new Blob(['old']), 'old-key')).record;
  record = (await h.storage.putPhotoAndRecord(select('new-key'), 1, new Blob(['new']), 'new-key')).record;
  assert.equal(await h.storage.deletePhoto(UUID, 1, 'old-key'), false);
  assert.equal(await (await h.storage.getPhoto(UUID, 1)).blob.text(), 'new');
  assert.equal(await h.storage.deletePhoto(UUID, 1, 'new-key'), true);
  assert.equal(await h.storage.getPhoto(UUID, 1), null);
});

test('fiscal: ACL/user filtering preserves other drafts while hiding them', async () => {
  const h = harness(); await h.storage.putRecord(fixture());
  assert.equal((await h.c.getFiscalCorrectionDrafts('Fiscal FIXTURE', 'acl-fixture')).length, 1);
  assert.equal((await h.c.getFiscalCorrectionDrafts('Other FIXTURE', 'acl-fixture')).length, 0);
  assert.equal((await h.c.getFiscalCorrectionDrafts('Fiscal FIXTURE', 'new-acl')).length, 0);
  assert.equal((await h.storage.getRecord()).recordId, UUID);
});

test('Campo: delayed photo preserves newer data with the same transaction contract', async () => {
  const h = harness(); const original = await h.c.putRecord(fixture());
  const newer = await h.c.putRecord({ ...original, observation: 'newer Campo data' });
  const selected = { ...original, photoStates: original.photoStates.map(state => state.photoIndex === 1 ? { ...state, uploadKey: 'campo-photo', localReady: true } : state) };
  await h.c.putPhotoAndRecord(selected, 1, new Blob(['Campo fixture']), 'campo-photo');
  const saved = await h.c.getRecord(UUID);
  assert.equal(saved.observation, newer.observation); assert.equal(saved.photoStates[0].uploadKey, 'campo-photo');
  assert.equal(await (await h.c.getPhoto(UUID, 1)).blob.text(), 'Campo fixture');
});

test('Campo: stale deletion preserves changed record and every local Blob', async () => {
  const h = harness(); const original = await h.c.putRecord({ ...fixture(), status: core.RECORD_STATUS.DRAFT });
  const current = await h.c.putPhotoAndRecord(original, 1, new Blob(['preserve-local-photo']), 'photo-current');
  await assert.rejects(h.c.deleteRecord(UUID, { expectedUpdatedAt: original.updatedAt, expectedStatus: original.status }), error => error.code === 'LOCAL_RECORD_CHANGED');
  assert.equal((await h.c.getRecord(UUID)).updatedAt, current.record.updatedAt);
  assert.equal(await (await h.c.getPhoto(UUID, 1)).blob.text(), 'preserve-local-photo');
});

test('Campo: deletion checks status even when caller provides current timestamp', async () => {
  const h = harness(); const current = await h.c.putRecord({ ...fixture(), status: core.RECORD_STATUS.PENDING });
  await assert.rejects(h.c.deleteRecord(UUID, { expectedUpdatedAt: current.updatedAt, expectedStatus: core.RECORD_STATUS.DRAFT }), error => error.code === 'LOCAL_RECORD_CHANGED');
  assert.equal((await h.c.getRecord(UUID)).status, core.RECORD_STATUS.PENDING);
});

test('Campo: guarded deletion removes only its exact UUID and associated photos', async () => {
  const h = harness(); const first = await h.c.putRecord({ ...fixture(), status: core.RECORD_STATUS.DRAFT });
  const saved = await h.c.putPhotoAndRecord(first, 1, new Blob(['delete-this-fixture']), 'first-key');
  const otherId = '99999999-2222-4333-8444-555555555555';
  await h.c.putPhotoAndRecord({ ...fixture(), recordId: otherId, occurrenceNumber: 'SAME-NUMBER' }, 1, new Blob(['preserve-other-fixture']), 'other-key');
  await h.c.deleteRecord(UUID, { expectedUpdatedAt: saved.record.updatedAt, expectedStatus: core.RECORD_STATUS.DRAFT });
  assert.equal(await h.c.getRecord(UUID), undefined); assert.equal(await h.c.getPhoto(UUID, 1), undefined);
  assert.equal((await h.c.getRecord(otherId)).recordId, otherId);
  assert.equal(await (await h.c.getPhoto(otherId, 1)).blob.text(), 'preserve-other-fixture');
});

for (const { name, run } of tests) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, ok: false }); console.error('FAIL', name, error); }
}
const passed = results.filter(result => result.ok).length;
console.log(JSON.stringify({ suite: 'audit-offline-20261018', passed, failed: results.length - passed, total: results.length }));
if (passed !== results.length) process.exitCode = 1;
