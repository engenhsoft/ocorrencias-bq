import { summarizeQueue } from './core.js';

const DB_NAME = 'ocorrencias-bq-db';
const DB_VERSION = 1;
const STORE = Object.freeze({
  records: 'records',
  photos: 'photos',
  catalog: 'catalog',
  meta: 'meta'
});

let connectionPromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha no IndexedDB.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha na transação local.'));
    transaction.onabort = () => reject(transaction.error || new Error('Transação local cancelada.'));
  });
}

export function openDatabase() {
  if (connectionPromise) return connectionPromise;
  connectionPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
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
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      connectionPromise = null;
      reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
    };
    request.onblocked = () => reject(new Error('Feche outras versões do aplicativo para atualizar o armazenamento local.'));
  });
  return connectionPromise;
}

async function storeTransaction(storeNames, mode = 'readonly') {
  const database = await openDatabase();
  const transaction = database.transaction(storeNames, mode);
  return { transaction, store: (name) => transaction.objectStore(name) };
}

export async function putRecord(record) {
  const next = { ...record, updatedAt: new Date().toISOString() };
  const { transaction, store } = await storeTransaction([STORE.records], 'readwrite');
  store(STORE.records).put(next);
  await transactionDone(transaction);
  return next;
}

export async function putPhotoAndRecord(record, photoIndex, blob, uploadKey, metadata = {}) {
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
  store(STORE.records).put(nextRecord);
  store(STORE.photos).put(photo);
  await transactionDone(transaction);
  return { record: nextRecord, photo };
}

export async function getRecord(recordId) {
  const { store } = await storeTransaction([STORE.records]);
  return requestResult(store(STORE.records).get(recordId));
}

export async function getAllRecords() {
  const { store } = await storeTransaction([STORE.records]);
  const records = await requestResult(store(STORE.records).getAll());
  return records.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function deleteRecord(recordId) {
  const { transaction, store } = await storeTransaction([STORE.records, STORE.photos], 'readwrite');
  store(STORE.records).delete(recordId);
  const index = store(STORE.photos).index('recordId');
  const cursorRequest = index.openCursor(IDBKeyRange.only(recordId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await transactionDone(transaction);
}

export async function putPhoto(recordId, photoIndex, blob, uploadKey, metadata = {}) {
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
  const { store } = await storeTransaction([STORE.photos]);
  return requestResult(store(STORE.photos).get(`${recordId}:${photoIndex}`));
}

export async function getPhotosForRecord(recordId) {
  const { store } = await storeTransaction([STORE.photos]);
  const photos = await requestResult(store(STORE.photos).index('recordId').getAll(IDBKeyRange.only(recordId)));
  return photos.sort((a, b) => a.photoIndex - b.photoIndex);
}

export async function deletePhoto(recordId, photoIndex) {
  const { transaction, store } = await storeTransaction([STORE.photos], 'readwrite');
  store(STORE.photos).delete(`${recordId}:${photoIndex}`);
  await transactionDone(transaction);
}

export async function cacheCatalogResults(results) {
  if (!results?.length) return;
  const { transaction, store } = await storeTransaction([STORE.catalog], 'readwrite');
  for (const result of results) {
    const keys = result.catalogKeys?.length ? result.catalogKeys : [result.catalogKey];
    for (const key of keys) {
      if (!key) continue;
      store(STORE.catalog).put({ ...result, catalogKey: key, cachedAt: new Date().toISOString() });
    }
  }
  await transactionDone(transaction);
}

export async function searchCachedCatalog(query, limit = 25) {
  const normalized = String(query || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const { store } = await storeTransaction([STORE.catalog]);
  const rows = await requestResult(store(STORE.catalog).getAll());
  return rows
    .filter((item) => [item.code, item.catalogText, item.group]
      .some((value) => String(value || '').toUpperCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').includes(normalized)))
    .sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR'))
    .slice(0, limit);
}

export async function setMeta(key, value) {
  const { transaction, store } = await storeTransaction([STORE.meta], 'readwrite');
  store(STORE.meta).put({ key, value, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
}

export async function getMeta(key, fallback = null) {
  const { store } = await storeTransaction([STORE.meta]);
  const row = await requestResult(store(STORE.meta).get(key));
  return row ? row.value : fallback;
}

export async function getQueueSummary() {
  const records = await getAllRecords();
  const photos = [];
  for (const record of records) photos.push(...await getPhotosForRecord(record.recordId));
  const queue = summarizeQueue(records);
  return {
    records,
    photos,
    ...queue
  };
}

export { DB_NAME };
