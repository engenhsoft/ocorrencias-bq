export const APP_VERSION = '2026.08.29.2';

export const RECORD_STATUS = Object.freeze({
  DRAFT: 'RASCUNHO',
  PENDING: 'PENDENTE_ENVIO',
  SYNCING_DATA: 'SINCRONIZANDO_DADOS',
  SYNCING_PHOTOS: 'FOTOS_SENDO_SINCRONIZADAS',
  WAITING_SUPERVISOR: 'AGUARDANDO_SUPERVISOR',
  CORRECTION_REQUESTED: 'CORRECAO_SOLICITADA',
  REJECTED: 'REPROVADA',
  APPROVED: 'APROVADA',
  PUBLISHED: 'PUBLICADA',
  ERROR: 'ERRO_SINCRONIZACAO'
});

const STATUS_META = Object.freeze({
  RASCUNHO: ['Rascunho', 'neutral'],
  PENDENTE_ENVIO: ['Pendente de envio', 'warning'],
  SINCRONIZANDO_DADOS: ['Sincronizando dados', 'info'],
  FOTOS_SENDO_SINCRONIZADAS: ['Fotos sendo sincronizadas', 'info'],
  AGUARDANDO_SUPERVISOR: ['Aguardando conferência do supervisor', 'warning'],
  CORRECAO_SOLICITADA: ['Correção solicitada', 'warning'],
  REPROVADA: ['Reprovada', 'danger'],
  APROVADA: ['Aprovada', 'success'],
  PUBLICADA: ['Publicada', 'success'],
  ERRO_SINCRONIZACAO: ['Erro de sincronização', 'danger']
});

export function statusLabel(status, photoCount) {
  if (status === RECORD_STATUS.SYNCING_PHOTOS && Number.isFinite(photoCount)) {
    return `Fotos sendo sincronizadas — ${photoCount}/5`;
  }
  return (STATUS_META[status] || [String(status || 'Sem status'), 'neutral'])[0];
}

export function statusTone(status) {
  return (STATUS_META[status] || ['', 'neutral'])[1];
}

export function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function formatCurrency(value) {
  const number = Number(value);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number.isFinite(number) ? number : 0);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

export function generateUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function countConfirmedPhotos(record) {
  if (Array.isArray(record?.photoStates)) return record.photoStates.filter((state) => state?.confirmed).length;
  if (Array.isArray(record?.photos)) return record.photos.filter(Boolean).length;
  return Number(record?.photoCount) || 0;
}

export function countReadyPhotoStates(record) {
  if (Array.isArray(record?.photoStates)) {
    return record.photoStates.filter((state) => state?.confirmed || state?.serverUrl || state?.localReady).length;
  }
  if (Array.isArray(record?.photos)) return record.photos.filter(Boolean).length;
  return Number(record?.photoCount) || 0;
}

export function summarizeQueue(records = []) {
  const pendingStatuses = new Set([
    RECORD_STATUS.PENDING,
    RECORD_STATUS.SYNCING_DATA,
    RECORD_STATUS.SYNCING_PHOTOS,
    RECORD_STATUS.ERROR
  ]);
  const pendingRecords = records.filter((record) => pendingStatuses.has(record.status));
  const pendingPhotos = pendingRecords.reduce((total, record) => (
    total + Math.max(0, 5 - countConfirmedPhotos(record))
  ), 0);
  const syncingPhotos = records
    .filter((record) => record.status === RECORD_STATUS.SYNCING_PHOTOS)
    .reduce((total, record) => total + Math.max(0, 5 - countConfirmedPhotos(record)), 0);
  return {
    pendingRecords,
    pendingPhotos,
    syncingPhotos,
    errors: records.filter((record) => record.status === RECORD_STATUS.ERROR || record.lastError).length
  };
}

export function reconcilePhotoStates(localRecord, serverState) {
  const byIndex = new Map((serverState?.photoStates || []).map((state) => [Number(state.photoIndex), state]));
  const localStates = Array.from({ length: 5 }, (_, index) => {
    const current = localRecord?.photoStates?.[index] || {};
    const server = byIndex.get(index + 1);
    if (current.replacePending) {
      return {
        ...current,
        photoIndex: index + 1,
        confirmed: false,
        localReady: Boolean(current.localReady),
        serverUrl: server?.url || current.serverUrl || ''
      };
    }
    if (!server?.confirmed) {
      return {
        ...current,
        photoIndex: index + 1,
        confirmed: false,
        localReady: Boolean(current.localReady),
        serverUrl: current.serverUrl || ''
      };
    }
    return {
      ...current,
      photoIndex: index + 1,
      confirmed: true,
      localReady: false,
      serverUrl: server.url || current.serverUrl || '',
      error: ''
    };
  });
  return {
    ...localRecord,
    serverConfirmed: true,
    serverStatus: serverState?.status || localRecord?.serverStatus || '',
    status: serverState?.status || localRecord?.status,
    photoStates: localStates,
    photoCount: localStates.filter((state) => state.confirmed).length,
    updatedAt: new Date().toISOString()
  };
}

export function dedupeCatalogResults(items) {
  const grouped = new Map();
  for (const item of items || []) {
    const key = [item.code, item.catalogText, item.unit, item.group, Number(item.referenceValue)]
      .map(normalizeText).join('|');
    if (!grouped.has(key)) {
      grouped.set(key, { ...item, origins: [...(item.origins || [item.origin])], catalogKeys: [...(item.catalogKeys || [item.catalogKey])] });
      continue;
    }
    const existing = grouped.get(key);
    for (const origin of item.origins || [item.origin]) if (origin && !existing.origins.includes(origin)) existing.origins.push(origin);
    for (const catalogKey of item.catalogKeys || [item.catalogKey]) if (catalogKey && !existing.catalogKeys.includes(catalogKey)) existing.catalogKeys.push(catalogKey);
    existing.origin = existing.origins.join(' | ');
  }
  return [...grouped.values()];
}

export function mergeRecordCollections(localRecords, serverRecords) {
  const merged = new Map();
  for (const record of localRecords || []) merged.set(record.recordId, { ...record });
  for (const server of serverRecords || []) {
    const local = merged.get(server.recordId) || {};
    merged.set(server.recordId, {
      ...local,
      ...server,
      localStatus: local.status,
      status: server.status || local.status,
      photoStates: local.photoStates || server.photoStates,
      photos: server.photos || local.photos
    });
  }
  return [...merged.values()].sort((a, b) => String(b.updatedAt || b.registeredAt || '').localeCompare(String(a.updatedAt || a.registeredAt || '')));
}

export function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

export function tokenExpiry(token) {
  try {
    const payload = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    return Number(JSON.parse(atob(padded)).exp) || 0;
  } catch {
    return 0;
  }
}
