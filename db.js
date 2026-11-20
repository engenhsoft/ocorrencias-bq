import { dedupeMaterialCatalog, materialKey, summarizeQueue, sameUser } from './core.js?v=2026.11.19.3';

const DB_NAME = 'ocorrencias-bq-db';
export const DB_VERSION = 1;
const STORE = Object.freeze({
  records: 'records',
  photos: 'photos',
  catalog: 'catalog',
  meta: 'meta'
});

let connectionPromise;

// Reuse the existing meta store without changing the IndexedDB schema. Fiscal
// drafts must never overwrite a Campo record or its UUID/slot photo keys.
export async function updateFiscalCorrectionDraft(key, mutate) {
  const removed = await getMeta('occbq-removed-records', []);
  if (removed.some(id => key.includes('"' + id + '"'))) throw Object.assign(new Error('Registro removido.'), { code: 'RECORD_REMOVED' });
  if (!String(key).startsWith('fiscalCorrection:')) throw new Error('Identificador de rascunho fiscal inválido.');
  const { transaction, store: objectStore } = await storeTransaction([STORE.meta], 'readwrite');
  const done = transactionDone(transaction), store = objectStore(STORE.meta);
  let result;
  const request = store.get(key);
  request.onsuccess = () => {
    try {
      result = mutate(request.result?.value || { record: null, photos: {} });
      store.put({ key, value: result, updatedAt: new Date().toISOString() });
    } catch (error) { transaction.abort(); result = error; }
  };
  try { await done; } catch (error) { throw result instanceof Error ? result : error; }
  return result;
}

export async function getFiscalCorrectionDrafts(user, aclRevision = '') {
  const entries = await readStoreValue(STORE.meta, store => store.getAll());
  return entries.filter(entry => entry.key?.startsWith('fiscalCorrection:'))
    .map(entry => entry.value?.record ? { ...entry.value.record, queueLocalPhotoSlots: Object.values(entry.value.photos || {}).filter(photo => photo.blob).map(photo => photo.photoIndex) } : null).filter(record => record?.fiscalDraftKey
      && sameUser(record.fiscalCorrection?.assignedFiscal, user)
      && String(record.fiscalAclRevision || '') === String(aclRevision));
}

function requestResult(request, transaction) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Tempo esgotado ao ler o armazenamento local. Tente novamente.'));
      try { transaction?.abort(); } catch { /* A transação já pode estar encerrada. */ }
    }, 12000);
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(request.error || new Error('Falha no IndexedDB.')); };
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Tempo esgotado na transação local. Os dados não foram confirmados; tente novamente.'));
      try { transaction.abort(); } catch { /* A transação já pode estar encerrada. */ }
    }, 12000);
    const finish = (handler) => { clearTimeout(timer); handler(); };
    transaction.oncomplete = () => finish(resolve);
    transaction.onerror = () => finish(() => reject(transaction.error || new Error('Falha na transação local.')));
    transaction.onabort = () => finish(() => reject(transaction.error || new Error('Transação local cancelada.')));
  });
}

export function openDatabase() {
  if (connectionPromise) return connectionPromise;
  const opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let invalidated = false;
    const timer = setTimeout(() => {
      invalidated = true;
      if (connectionPromise === opening) connectionPromise = null;
      reject(new Error('Tempo esgotado ao abrir o armazenamento local. Feche outras abas do aplicativo e tente novamente.'));
    }, 12000);
    request.onupgradeneeded = () => {
      if (invalidated) { request.transaction?.abort(); return; }
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE.records)) {
        const records = database.createObjectStore(STORE.records, { keyPath: 'recordId' });
        records.createIndex('status', 'status', { unique: false });
        records.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!database.objectStoreNames.contains(STORE.photos)) {
        const photos = database.createObjectStore(STORE.photos, { keyPath: 'key' });
        photos.createIndex('recordId', 'recordId', { unique: false });
      }
      if (!database.objectStoreNames.contains(STORE.catalog)) {
        const catalog = database.createObjectStore(STORE.catalog, { keyPath: 'catalogKey' });
        catalog.createIndex('code', 'code', { unique: false });
      }
      if (!database.objectStoreNames.contains(STORE.meta)) {
        database.createObjectStore(STORE.meta, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (invalidated) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => {
        request.result.close();
        if (connectionPromise === opening) connectionPromise = null;
      };
      request.result.onclose = () => { if (connectionPromise === opening) connectionPromise = null; };
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      if (connectionPromise === opening) connectionPromise = null;
      reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      invalidated = true;
      if (connectionPromise === opening) connectionPromise = null;
      reject(new Error('Feche outras versões do aplicativo para atualizar o armazenamento local.'));
    };
  });
  connectionPromise = opening;
  void opening.catch(() => { if (connectionPromise === opening) connectionPromise = null; });
  return opening;
}

async function storeTransaction(storeNames, mode = 'readonly') {
  const opening = openDatabase();
  let database = await opening;
  let transaction;
  try { transaction = database.transaction(storeNames, mode); }
  catch (error) {
    if (error?.name !== 'InvalidStateError') throw error;
    if (connectionPromise === opening) connectionPromise = null;
    database = await openDatabase();
    transaction = database.transaction(storeNames, mode);
  }
  return { transaction, store: (name) => transaction.objectStore(name) };
}

async function readStoreValue(name, request) {
  const { transaction, store } = await storeTransaction([name]);
  const done = transactionDone(transaction);
  const [value] = await Promise.all([requestResult(request(store(name)), transaction), done]);
  return value;
}

export async function putRecord(record, options = {}) {
  await assertRecordNotRemoved(record.recordId);
  const next = { ...record, updatedAt: new Date().toISOString() };
  const { transaction, store } = await storeTransaction([STORE.records], 'readwrite');
  const done = transactionDone(transaction);
  let conflict;
  const records = store(STORE.records); const request = records.get(record.recordId);
  request.onsuccess = () => {
      if (typeof options.expectedUpdatedAt === 'string' && String(request.result?.updatedAt || '') !== options.expectedUpdatedAt) {
        conflict = new Error('Esta ocorrência foi alterada neste aparelho durante a sincronização. A versão local foi preservada; tente novamente.');
        conflict.code = 'LOCAL_RECORD_CHANGED';
      } else {
        next.updatedAt = new Date(Math.max(Date.now(), (Date.parse(request.result?.updatedAt || '') || 0) + 1)).toISOString();
        records.put(next);
      }
  };
  await done;
  if (conflict) throw conflict;
  return next;
}

export async function putPhotoAndRecord(record, photoIndex, blob, uploadKey, metadata = {}) {
  await assertRecordNotRemoved(record.recordId);
  const now = new Date().toISOString();
  const nextRecord = { ...record, updatedAt: now };
  const photo = {
    key: `${record.recordId}:${photoIndex}`,
    recordId: record.recordId,
    photoIndex,
    blob,
    uploadKey,
    mimeType: blob?.type || metadata.mimeType || 'image/jpeg',
    fileName: metadata.fileName || `FOTO_${photoIndex}.jpg`,
    size: blob?.size || 0,
    updatedAt: now
  };
  const { transaction, store } = await storeTransaction([STORE.records, STORE.photos], 'readwrite');
  const done = transactionDone(transaction); const records = store(STORE.records); const request = records.get(record.recordId);
  let conflict;
  request.onsuccess = () => {
    const current = request.result;
    if ((Object.hasOwn(metadata, 'expectedUploadKey') || Object.hasOwn(metadata, 'expectedRecordStatus')) && (!current
      || Object.hasOwn(metadata, 'expectedRecordStatus') && current.status !== metadata.expectedRecordStatus
      || Object.hasOwn(metadata, 'expectedUploadKey') && String(current.photoStates?.[photoIndex - 1]?.uploadKey || '') !== metadata.expectedUploadKey)) {
      conflict = Object.assign(new Error('Esta ocorrência ou foto foi alterada em outra aba. A versão atual foi preservada; reabra a ocorrência antes de continuar.'), { code: 'LOCAL_RECORD_CHANGED' });
      return;
    }
    if (current && current.updatedAt !== record.updatedAt) {
      const selectedState = record.photoStates?.[photoIndex - 1];
      Object.assign(nextRecord, current, { photoStates: Array.from({ length: 7 }, (_, index) => index === photoIndex - 1 ? selectedState : current.photoStates?.[index] || { photoIndex: index + 1 }) });
    }
    nextRecord.updatedAt = new Date(Math.max(Date.now(), (Date.parse(current?.updatedAt || '') || 0) + 1)).toISOString();
    records.put(nextRecord); store(STORE.photos).put(photo);
  };
  await done;
  if (conflict) throw conflict;
  return { record: nextRecord, photo };
}

export async function getRecord(recordId) {
  const removed = await getMeta('occbq-removed-records', []);
  if (removed.includes(recordId)) return null;
  return readStoreValue(STORE.records, store => store.get(recordId));
}

export async function getAllRecords() {
  const { transaction, store } = await storeTransaction([STORE.records, STORE.meta]);
  const done = transactionDone(transaction);
  const [all, policy] = await Promise.all([requestResult(store(STORE.records).getAll(), transaction), requestResult(store(STORE.meta).get('occbq-removed-records'), transaction), done]);
  const removed = policy?.value || [];
  const records = all.filter(record => !removed.includes(record.recordId));
  return records.filter((record, index) => {
    const valid = record && typeof record === 'object' && !Array.isArray(record) && typeof record.recordId === 'string' && record.recordId.trim();
    if (!valid) console.warn('[Fila] Registro local inválido; os demais continuam disponíveis.', { index });
    return valid;
  }).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function deleteRecord(recordId, options = {}) {
  const { transaction, store } = await storeTransaction([STORE.records, STORE.photos], 'readwrite');
  const done = transactionDone(transaction);
  const records = store(STORE.records);
  let conflict;
  const remove = () => {
    records.delete(recordId);
    const index = store(STORE.photos).index('recordId');
    const cursorRequest = index.openCursor(IDBKeyRange.only(recordId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  };
  if (typeof options.expectedUpdatedAt === 'string' || typeof options.expectedStatus === 'string') {
    const request = records.get(recordId);
    request.onsuccess = () => {
      const current = request.result;
      if (!current || typeof options.expectedUpdatedAt === 'string' && String(current.updatedAt || '') !== options.expectedUpdatedAt
        || typeof options.expectedStatus === 'string' && current.status !== options.expectedStatus) {
        conflict = Object.assign(new Error('Esta ocorrência mudou neste aparelho. A exclusão foi cancelada; confira a versão atual.'), { code: 'LOCAL_RECORD_CHANGED' });
      } else remove();
    };
  } else remove();
  await done;
  if (conflict) throw conflict;
}

export async function putPhoto(recordId, photoIndex, blob, uploadKey, metadata = {}) {
  await assertRecordNotRemoved(recordId);
  const key = `${recordId}:${photoIndex}`;
  const photo = {
    key,
    recordId,
    photoIndex,
    blob,
    uploadKey,
    mimeType: blob?.type || metadata.mimeType || 'image/jpeg',
    fileName: metadata.fileName || `FOTO_${photoIndex}.jpg`,
    size: blob?.size || 0,
    updatedAt: new Date().toISOString()
  };
  const { transaction, store } = await storeTransaction([STORE.photos], 'readwrite');
  store(STORE.photos).put(photo);
  await transactionDone(transaction);
  return photo;
}

export async function getPhoto(recordId, photoIndex) {
  return readStoreValue(STORE.photos, store => store.get(`${recordId}:${photoIndex}`));
}

export async function getPhotosForRecord(recordId) {
  const photos = await readStoreValue(STORE.photos, store => store.index('recordId').getAll(IDBKeyRange.only(recordId)));
  return photos.sort((a, b) => a.photoIndex - b.photoIndex);
}

export async function deletePhoto(recordId, photoIndex, expectedUploadKey) {
  const { transaction, store } = await storeTransaction([STORE.photos], 'readwrite');
  const done = transactionDone(transaction); const photos = store(STORE.photos); const key = `${recordId}:${photoIndex}`;
  let deleted = false;
  if (expectedUploadKey !== undefined) {
    const request = photos.get(key);
    request.onsuccess = () => { if (request.result?.uploadKey === expectedUploadKey) { photos.delete(key); deleted = true; } };
  } else { photos.delete(key); deleted = true; }
  await done;
  return deleted;
}

export async function cacheCatalogResults(results) {
  if (!results?.length) return;
  const { transaction, store } = await storeTransaction([STORE.catalog], 'readwrite');
  for (const result of results) {
    const keys = result.catalogKeys?.length ? result.catalogKeys : [result.catalogKey];
    for (const key of keys) {
      if (!key) continue;
      store(STORE.catalog).put({ ...result, kind: 'service', catalogKey: key, cachedAt: new Date().toISOString() });
    }
  }
  await transactionDone(transaction);
}

export async function searchCachedCatalog(query, limit = 25) {
  const normalized = String(query || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const rows = await readStoreValue(STORE.catalog, store => store.getAll());
  return rows
    .filter((item) => item.kind !== 'material' && item.contractValues && typeof item.contractValues === 'object' && [item.code, item.catalogText, item.group]
      .some((value) => String(value || '').toUpperCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').includes(normalized)))
    .sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR'))
    .slice(0, limit);
}

export async function cacheMaterialCatalog(results) {
  const materials = dedupeMaterialCatalog(results);
  if (!materials.length) return [];
  const { transaction, store } = await storeTransaction([STORE.catalog], 'readwrite');
  const catalogStore = store(STORE.catalog);
  const existingRows = await requestResult(catalogStore.getAll(), transaction);
  for (const existing of existingRows) {
    if (existing.kind === 'material' && existing.catalogKey) catalogStore.delete(existing.catalogKey);
  }
  for (const material of materials) {
    const key = material.materialKey || materialKey(material);
    if (!key) continue;
    catalogStore.put({
      ...material,
      kind: 'material',
      materialKey: key,
      catalogKey: `material:${key}`,
      cachedAt: new Date().toISOString()
    });
  }
  await transactionDone(transaction);
  return materials;
}

export async function getCachedMaterialCatalog() {
  const rows = await readStoreValue(STORE.catalog, store => store.getAll());
  return dedupeMaterialCatalog(rows.filter((item) => item.kind === 'material'));
}

export async function setMeta(key, value) {
  const { transaction, store } = await storeTransaction([STORE.meta], 'readwrite');
  store(STORE.meta).put({ key, value, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
}

export async function clearMetaIfValue(key, expectedValue) {
  const { transaction, store } = await storeTransaction([STORE.meta], 'readwrite');
  const metaStore = store(STORE.meta);
  const request = metaStore.get(key);
  request.onsuccess = () => {
    if (request.result?.value === expectedValue) metaStore.put({ key, value: null, updatedAt: new Date().toISOString() });
  };
  await transactionDone(transaction);
}

export async function getMeta(key, fallback = null) {
  const row = await readStoreValue(STORE.meta, store => store.get(key));
  return row ? row.value : fallback;
}

export async function getQueueSummary(owner) {
  const allRecords = await getAllRecords();
  const records = owner === undefined
    ? allRecords
    : owner
      ? allRecords.filter((record) => sameUser(record.user, owner))
      : [];
  const ids = new Set(records.map(record => record.recordId));
  const photos = records.length ? (await readStoreValue(STORE.photos, store => store.getAll())).filter(photo => ids.has(photo?.recordId)) : [];
  const queue = summarizeQueue(records);
  return {
    records,
    photos,
    ...queue
  };
}

export { DB_NAME };

const REMOVED_META = 'occbq-removed-records';
const PROTECTED_RECORD = 'e11b519b-9f26-4854-8de0-b7c5d835bb7c';
export async function assertRecordNotRemoved(recordId) {
  const removed = await getMeta(REMOVED_META, []);
  if (removed.includes(recordId)) throw Object.assign(new Error('Este registro foi excluído pelo proprietário.'), { code: 'RECORD_REMOVED' });
}
export async function purgeRemovedRecords(ids) {
  const selected = [...new Set(ids)].filter(id => /^[a-f0-9-]{36}$/.test(id));
  if (!selected.length) return;
  if (selected.includes(PROTECTED_RECORD)) throw new Error('A ocorrência protegida não pode ser removida.');
  const known = await getMeta(REMOVED_META, []);
  const removed = [...new Set([...known, ...selected])];
  const announce = selected.some(id => !known.includes(id));
  const { transaction, store } = await storeTransaction([STORE.records, STORE.photos, STORE.meta], 'readwrite');
  const done = transactionDone(transaction), targets = new Set(removed);
  for (const name of [STORE.records, STORE.photos, STORE.meta]) {
    const cursor = store(name).openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result; if (!item) return;
      const value = item.value;
      const id = value.recordId || value.value?.recordId || value.value?.record?.recordId;
      if (targets.has(id) || name === STORE.meta && (targets.has(value.value)
        || removed.some(id => value.key?.startsWith('fiscalCorrection:') && value.key.includes('"' + id + '"'))
        || value.key?.startsWith('dailyProduction:'))) item.delete();
      item.continue();
    };
  }
  store(STORE.meta).put({ key: REMOVED_META, value: removed, updatedAt: new Date().toISOString() });
  await done;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('occbq-records-removed', { detail: removed }));
  try { if (announce) localStorage.setItem('occbq-removal-signal', JSON.stringify(removed)); } catch { /* Backend still blocks stale clients. */ }
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === 'occbq-removal-signal' && event.newValue) {
    try { void purgeRemovedRecords(JSON.parse(event.newValue)); } catch { /* Never broaden removal on invalid input. */ }
  }
});
