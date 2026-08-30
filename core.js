export const APP_VERSION = '2026.08.30.2';

export const TEAM_GOAL = 6000;

export const OCCURRENCE_TYPES = Object.freeze([
  'SUBSTITUIÇÃO DE TRAFO',
  'SUBSTITUIÇÃO DE POSTE',
  'SUBSTITUIÇÃO DE CONDUTOR'
]);

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

export function formatNumber(value) {
  const number = Number(value);
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
    .format(Number.isFinite(number) ? number : 0);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
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

export function serviceTotal(service) {
  const quantity = Number(service?.quantity);
  const unitValue = Number(service?.referenceValue);
  return Number.isFinite(quantity) && Number.isFinite(unitValue) ? quantity * unitValue : 0;
}

export function occurrenceTotal(services = []) {
  return services.reduce((total, service) => total + serviceTotal(service), 0);
}

export function operationalDate(value = new Date(), timeZone = 'America/Bahia') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function normalizeTeamKey(value) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '');
}

export function dailyTeamKey(team, date = operationalDate()) {
  return `${date}|${normalizeTeamKey(team)}`;
}

export function dailyGoalProjection(totalSent = 0, currentOccurrence = 0, goal = TEAM_GOAL) {
  const sent = Math.max(0, Number(totalSent) || 0);
  const current = Math.max(0, Number(currentOccurrence) || 0);
  return {
    totalSent: sent,
    currentOccurrence: current,
    projectedTotal: sent + current,
    ...goalProgress(sent + current, goal)
  };
}

export function driveFileId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const patterns = [
    /\/d\/([A-Za-z0-9_-]{20,})/,
    /[?&]id=([A-Za-z0-9_-]{20,})/,
    /\/thumbnail\?id=([A-Za-z0-9_-]{20,})/,
    /\/d\/([A-Za-z0-9_-]{20,})=/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

export function normalizePhotoUrl(value, size = 1600) {
  const text = String(value || '').trim();
  if (!text || /^(blob:|data:)/i.test(text)) return text;
  const fileId = driveFileId(text);
  return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w${Math.max(320, Number(size) || 1600)}` : text;
}

export function goalProgress(total, goal = TEAM_GOAL) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeGoal = Math.max(1, Number(goal) || TEAM_GOAL);
  const percentage = safeTotal / safeGoal * 100;
  return {
    total: safeTotal,
    goal: safeGoal,
    percentage,
    visualPercentage: Math.min(100, percentage),
    state: percentage > 100 ? 'superada' : percentage === 100 ? 'atingida' : 'abaixo',
    label: percentage > 100 ? 'META SUPERADA' : percentage === 100 ? 'META ATINGIDA' : 'ABAIXO DA META'
  };
}

export function validateOccurrence(record = {}) {
  const errors = [];
  const types = Array.isArray(record.occurrenceTypes) ? record.occurrenceTypes : [];
  if (!String(record.team || '').trim()) errors.push('Informe a equipe.');
  if (!String(record.occurrenceNumber || '').trim()) errors.push('Informe o Nº da ocorrência.');
  if (!types.length || types.some((type) => !OCCURRENCE_TYPES.includes(type))) errors.push('Selecione pelo menos um tipo da ocorrência.');
  if (types.includes('SUBSTITUIÇÃO DE POSTE') || types.includes('SUBSTITUIÇÃO DE CONDUTOR')) {
    if (![record.pg1, record.pg2, record.pg3].some((value) => String(value || '').trim())) errors.push('Informe pelo menos um PG.');
  }
  if (types.includes('SUBSTITUIÇÃO DE TRAFO')) {
    if (!String(record.transformer?.removedCode || '').trim()) errors.push('Informe o código do trafo retirado ou 999999.');
    if (!String(record.transformer?.removedCia || '').trim()) errors.push('Informe a CIA do trafo retirado.');
    if (!String(record.transformer?.newCode || '').trim() || String(record.transformer?.newCode || '').trim() === '999999') errors.push('Informe um código válido para o trafo novo.');
    if (!String(record.transformer?.newCia || '').trim()) errors.push('Informe a CIA do trafo novo.');
  }
  if (!Array.isArray(record.services) || !record.services.length) errors.push('Adicione pelo menos um serviço da aba Emergência.');
  (record.services || []).forEach((service, index) => {
    if (!service?.catalogKey || !service?.code) errors.push(`Serviço ${index + 1} inválido.`);
    if (!(Number(service?.quantity) >= 1)) errors.push(`Informe uma QTD válida no serviço ${index + 1}.`);
  });
  if (!Array.isArray(record.materials) || !record.materials.length) errors.push('Informe o material aplicado.');
  (record.materials || []).forEach((material, index) => {
    if (!String(material?.description || '').trim()) errors.push(`Informe o material aplicado no item ${index + 1}.`);
    if (!(Number(material?.quantity) > 0)) errors.push(`Informe a quantidade do material no item ${index + 1}.`);
  });
  return [...new Set(errors)];
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

export function photoIssueIndexes(record, failedIndexes = []) {
  const urls = Array.from({ length: 5 }, (_, index) => record?.photos?.[index] || record?.photoStates?.[index]?.serverUrl || record?.photoStates?.[index]?.url || '');
  const issues = urls.map((url, index) => url ? 0 : index + 1).filter(Boolean);
  for (const index of failedIndexes || []) if (Number.isInteger(Number(index)) && Number(index) >= 1 && Number(index) <= 5) issues.push(Number(index));
  return [...new Set(issues)].sort((left, right) => left - right);
}

export function supervisorCorrectionChanges(before = {}, after = {}) {
  const changes = [];
  const add = (field, previousValue, newValue) => {
    const previous = typeof previousValue === 'string' ? previousValue : JSON.stringify(previousValue ?? '');
    const next = typeof newValue === 'string' ? newValue : JSON.stringify(newValue ?? '');
    if (previous !== next) changes.push({ field, previousValue: previous, newValue: next });
  };
  add('Equipe', before.team, after.team);
  add('Nº da ocorrência', before.occurrenceNumber, after.occurrenceNumber);
  add('Tipo(s) da ocorrência', before.occurrenceTypes || [], after.occurrenceTypes || []);
  add('PG 1', before.pg1, after.pg1); add('PG 2', before.pg2, after.pg2); add('PG 3', before.pg3, after.pg3);
  add('Transformador retirado', before.transformer ? { code: before.transformer.removedCode, cia: before.transformer.removedCia } : {}, after.transformer ? { code: after.transformer.removedCode, cia: after.transformer.removedCia } : {});
  add('Transformador novo', before.transformer ? { code: before.transformer.newCode, cia: before.transformer.newCia } : {}, after.transformer ? { code: after.transformer.newCode, cia: after.transformer.newCia } : {});
  add('Serviços selecionados', (before.services || []).map(({ catalogKey, code, quantity }) => ({ catalogKey, code, quantity })), (after.services || []).map(({ catalogKey, code, quantity }) => ({ catalogKey, code, quantity })));
  add('Materiais aplicados', (before.materials || []).map(({ description, quantity }) => ({ description, quantity })), (after.materials || []).map(({ description, quantity }) => ({ description, quantity })));
  add('Observação', before.observation, after.observation);
  return changes;
}

export function summarizeQueue(records = []) {
  const pendingStatuses = new Set([
    RECORD_STATUS.PENDING,
    RECORD_STATUS.SYNCING_DATA,
    RECORD_STATUS.SYNCING_PHOTOS,
    RECORD_STATUS.ERROR
  ]);
  const pendingRecords = records.filter((record) => pendingStatuses.has(record.status));
  const pendingPhotos = pendingRecords.reduce((total, record) => total + Math.max(0, 5 - countConfirmedPhotos(record)), 0);
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
      return { ...current, photoIndex: index + 1, confirmed: false, localReady: Boolean(current.localReady), serverUrl: server?.url || current.serverUrl || '' };
    }
    if (!server?.confirmed) {
      return { ...current, photoIndex: index + 1, confirmed: false, localReady: Boolean(current.localReady), serverUrl: current.serverUrl || '' };
    }
    return { ...current, photoIndex: index + 1, confirmed: true, localReady: false, serverUrl: server.url || current.serverUrl || '', error: '' };
  });
  return {
    ...localRecord,
    ...(serverState?.record || {}),
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
    const key = [item.code, item.catalogText, item.unit, item.group, Number(item.referenceValue)].map(normalizeText).join('|');
    if (!grouped.has(key)) grouped.set(key, { ...item });
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
