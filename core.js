export const APP_VERSION = '2026.09.01.3';

export const TEAM_GOAL = 6000;

export const OCCURRENCE_TYPES = Object.freeze([
  'SUBSTITUIÇÃO DE TRAFO',
  'SUBSTITUIÇÃO DE POSTE',
  'SUBSTITUIÇÃO DE CONDUTOR',
  'PODA',
  'LINHA VIVA',
  'CAVA & ROCHA',
  'OUTRO'
]);

export const OPERATION_BASES = Object.freeze([
  'ASSÚ', 'CAICÓ', 'CARAÚBAS', 'CURRAIS NOVOS', 'MOSSORÓ', 'PAU DOS FERROS'
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

export function normalizeArray(value, label = 'valor') {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  globalThis.console?.warn?.(`[Contrato] ${label} deveria ser Array; usando [].`, { type: typeof value });
  return [];
}

export function normalizeOccurrenceTypes(value) {
  let source = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      try { source = JSON.parse(text); }
      catch { source = text.split('|'); }
    } else source = text.split('|');
  }
  return [...new Set(normalizeArray(source, 'occurrenceTypes')
    .map((type) => String(type ?? '').trim())
    .filter(Boolean))];
}

export function normalizeOccurrenceRecord(value, label = 'record') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (source !== value && value != null && value !== '') globalThis.console?.warn?.(`[Contrato] ${label} deveria ser Object; usando objeto vazio.`, { type: typeof value });
  return {
    ...source,
    occurrenceTypes: normalizeOccurrenceTypes(source.occurrenceTypes),
    services: normalizeArray(source.services, `${label}.services`),
    materials: normalizeArray(source.materials, `${label}.materials`),
    photos: normalizeArray(source.photos, `${label}.photos`),
    photoStates: normalizeArray(source.photoStates, `${label}.photoStates`),
    transformer: source.transformer && typeof source.transformer === 'object' && !Array.isArray(source.transformer) ? source.transformer : {},
    transformerPhotos: source.transformerPhotos && typeof source.transformerPhotos === 'object' && !Array.isArray(source.transformerPhotos) ? source.transformerPhotos : {}
  };
}

export function normalizeOccurrenceRecords(value, label = 'records') {
  return normalizeArray(value, label)
    .filter((record) => record && typeof record === 'object' && !Array.isArray(record))
    .map((record, index) => normalizeOccurrenceRecord(record, `${label}[${index}]`));
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
  return normalizeArray(services, 'services').reduce((total, service) => total + serviceTotal(service), 0);
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
  const types = normalizeOccurrenceTypes(record.occurrenceTypes);
  const services = normalizeArray(record.services, 'services');
  const materials = normalizeArray(record.materials, 'materials');
  if (!OPERATION_BASES.includes(String(record.base || '').trim())) errors.push('Selecione a base.');
  if (!String(record.team || '').trim()) errors.push('Informe a equipe.');
  if (!String(record.crewLeader || '').trim()) errors.push('Informe o chefe de turma.');
  if (!String(record.occurrenceNumber || '').trim()) errors.push('Informe o Nº da ocorrência.');
  if (!types.length || types.some((type) => !OCCURRENCE_TYPES.includes(type))) errors.push('Selecione pelo menos um tipo da ocorrência.');
  if (types.includes('OUTRO') && !String(record.otherOccurrenceType || '').trim()) errors.push('Informe o tipo da ocorrência.');
  if (types.includes('SUBSTITUIÇÃO DE POSTE')) {
    if (!String(record.pgPostRemoved || '').trim()) errors.push('Informe o PG do poste retirado.');
    if (!String(record.pgPostInstalled || '').trim()) errors.push('Informe o PG do poste instalado.');
  }
  if (types.includes('SUBSTITUIÇÃO DE CONDUTOR')) {
    if (!String(record.pgConductorStart || '').trim()) errors.push('Informe o PG inicial da substituição do condutor.');
    if (!String(record.pgConductorEnd || '').trim()) errors.push('Informe o PG final da substituição do condutor.');
  }
  if (types.includes('SUBSTITUIÇÃO DE TRAFO')) {
    if (!String(record.transformer?.removedCode || '').trim()) errors.push('Informe o código do trafo retirado ou 999999.');
    if (!String(record.transformer?.removedCia || '').trim()) errors.push('Informe a CIA do trafo retirado.');
    if (!String(record.transformer?.removedBto || '').trim()) errors.push('Informe o BTO do transformador retirado.');
    if (!String(record.transformer?.newCode || '').trim() || String(record.transformer?.newCode || '').trim() === '999999') errors.push('Informe um código válido para o trafo novo.');
    if (!String(record.transformer?.newCia || '').trim()) errors.push('Informe a CIA do trafo novo.');
    if (!String(record.transformer?.newBto || '').trim()) errors.push('Informe o BTO do transformador instalado.');
    if (!transformerPhotoReady(record, 'removed')) errors.push('Adicione a evidência do transformador retirado.');
    if (!transformerPhotoReady(record, 'installed')) errors.push('Adicione a evidência do transformador instalado.');
  }
  if (!services.length) errors.push('Adicione pelo menos um serviço da aba Emergência.');
  services.forEach((service, index) => {
    if (!service?.catalogKey || !service?.code) errors.push(`Serviço ${index + 1} inválido.`);
    if (!(Number(service?.quantity) >= 1)) errors.push(`Informe uma QTD válida no serviço ${index + 1}.`);
  });
  if (!materials.length) errors.push('Informe o material aplicado.');
  materials.forEach((material, index) => {
    if (!String(material?.description || '').trim()) errors.push(`Informe o material aplicado no item ${index + 1}.`);
    if (!(Number(material?.quantity) > 0)) errors.push(`Informe a quantidade do material no item ${index + 1}.`);
  });
  return [...new Set(errors)];
}

export function countConfirmedPhotos(record) {
  const stateCount = normalizeArray(record?.photoStates, 'photoStates').slice(0, 5).filter((state) => state?.confirmed).length;
  const urlCount = normalizeArray(record?.photos, 'photos').slice(0, 5).filter(Boolean).length;
  return Math.max(stateCount, urlCount, Number(record?.photoCount) || 0);
}

export function countReadyPhotoStates(record) {
  const stateCount = normalizeArray(record?.photoStates, 'photoStates').slice(0, 5)
    .filter((state) => state?.confirmed || state?.serverUrl || state?.localReady).length;
  const urlCount = normalizeArray(record?.photos, 'photos').slice(0, 5).filter(Boolean).length;
  return Math.max(stateCount, urlCount, Number(record?.photoCount) || 0);
}

export function transformerPhotoReady(record, kind) {
  const index = kind === 'removed' ? 5 : 6;
  const state = record?.photoStates?.[index] || {};
  const url = kind === 'removed' ? record?.transformerPhotos?.removed : record?.transformerPhotos?.installed;
  return Boolean(state.confirmed || state.serverUrl || state.url || state.localReady || url);
}

export function requiredPhotoDeficit(record) {
  const general = Math.max(0, 3 - countReadyPhotoStates(record));
  if (!normalizeOccurrenceTypes(record?.occurrenceTypes).includes('SUBSTITUIÇÃO DE TRAFO')) return general;
  return general + (transformerPhotoReady(record, 'removed') ? 0 : 1) + (transformerPhotoReady(record, 'installed') ? 0 : 1);
}

export function normalizeFailedIndexes(value) {
  if (value == null || value === '') return [];

  let source;
  if (Array.isArray(value)) source = value;
  else if (value instanceof Set) source = [...value];
  else if (typeof value === 'number') source = [value];
  else if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) source = parsed;
      else if (typeof parsed === 'number') source = [parsed];
      else {
        globalThis.console?.warn?.('[Supervisor] failedIndexes incompatível; usando [].', { type: typeof parsed });
        return [];
      }
    } catch {
      source = text.split(',').map((item) => item.trim()).filter(Boolean);
    }
  } else {
    globalThis.console?.warn?.('[Supervisor] failedIndexes incompatível; usando [].', { type: typeof value });
    return [];
  }

  const normalized = source
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 1 && index <= 7);
  if (normalized.length !== source.length) {
    globalThis.console?.warn?.('[Supervisor] failedIndexes contém índices inválidos; valores incompatíveis foram ignorados.');
  }
  return normalized;
}

export function photoIssueIndexes(record, failedIndexes = []) {
  const failed = new Set(normalizeFailedIndexes(failedIndexes));
  const urls = Array.from({ length: 5 }, (_, index) => record?.photos?.[index] || record?.photoStates?.[index]?.serverUrl || record?.photoStates?.[index]?.url || '');
  const validGeneral = urls.map((url, index) => Boolean(url) && !failed.has(index + 1));
  const issues = [];
  const missingGeneral = validGeneral.map((valid, index) => valid ? 0 : index + 1).filter(Boolean);
  issues.push(...missingGeneral.slice(0, Math.max(0, 3 - validGeneral.filter(Boolean).length)));
  if (normalizeOccurrenceTypes(record?.occurrenceTypes).includes('SUBSTITUIÇÃO DE TRAFO')) {
    if (!transformerPhotoReady(record, 'removed') || failed.has(6)) issues.push(6);
    if (!transformerPhotoReady(record, 'installed') || failed.has(7)) issues.push(7);
  }
  for (const index of failed) if (index >= 1 && index <= 7 && index <= 5 && validGeneral.filter(Boolean).length < 3) issues.push(index);
  return [...new Set(issues)].sort((left, right) => left - right);
}

export function supervisorCorrectionChanges(before = {}, after = {}) {
  const changes = [];
  const add = (field, previousValue, newValue) => {
    const previous = typeof previousValue === 'string' ? previousValue : JSON.stringify(previousValue ?? '');
    const next = typeof newValue === 'string' ? newValue : JSON.stringify(newValue ?? '');
    if (previous !== next) changes.push({ field, previousValue: previous, newValue: next });
  };
  add('Base', before.base, after.base);
  add('Equipe', before.team, after.team);
  add('Chefe de turma', before.crewLeader, after.crewLeader);
  add('Nº da ocorrência', before.occurrenceNumber, after.occurrenceNumber);
  add('Tipo(s) da ocorrência', normalizeOccurrenceTypes(before.occurrenceTypes), normalizeOccurrenceTypes(after.occurrenceTypes));
  add('Tipo de ocorrência avulso', before.otherOccurrenceType, after.otherOccurrenceType);
  add('PG do poste retirado', before.pgPostRemoved, after.pgPostRemoved);
  add('PG do poste instalado', before.pgPostInstalled, after.pgPostInstalled);
  add('PG inicial do condutor', before.pgConductorStart, after.pgConductorStart);
  add('PG final do condutor', before.pgConductorEnd, after.pgConductorEnd);
  add('Transformador retirado', before.transformer ? { code: before.transformer.removedCode, cia: before.transformer.removedCia, bto: before.transformer.removedBto } : {}, after.transformer ? { code: after.transformer.removedCode, cia: after.transformer.removedCia, bto: after.transformer.removedBto } : {});
  add('Transformador instalado', before.transformer ? { code: before.transformer.newCode, cia: before.transformer.newCia, bto: before.transformer.newBto } : {}, after.transformer ? { code: after.transformer.newCode, cia: after.transformer.newCia, bto: after.transformer.newBto } : {});
  add('Serviços selecionados', normalizeArray(before.services, 'services').map(({ catalogKey, code, quantity }) => ({ catalogKey, code, quantity })), normalizeArray(after.services, 'services').map(({ catalogKey, code, quantity }) => ({ catalogKey, code, quantity })));
  add('Materiais aplicados', normalizeArray(before.materials, 'materials').map(({ description, quantity }) => ({ description, quantity })), normalizeArray(after.materials, 'materials').map(({ description, quantity }) => ({ description, quantity })));
  add('Observação', before.observation, after.observation);
  return changes;
}

export function summarizeQueue(records = []) {
  records = normalizeArray(records, 'records');
  const pendingStatuses = new Set([
    RECORD_STATUS.PENDING,
    RECORD_STATUS.SYNCING_DATA,
    RECORD_STATUS.SYNCING_PHOTOS,
    RECORD_STATUS.ERROR
  ]);
  const pendingRecords = records.filter((record) => pendingStatuses.has(record.status));
  const pendingPhotos = pendingRecords.reduce((total, record) => total + requiredPhotoDeficit(record), 0);
  const syncingPhotos = records
    .filter((record) => record.status === RECORD_STATUS.SYNCING_PHOTOS)
    .reduce((total, record) => total + requiredPhotoDeficit(record), 0);
  return {
    pendingRecords,
    pendingPhotos,
    syncingPhotos,
    errors: records.filter((record) => record.status === RECORD_STATUS.ERROR || record.lastError).length
  };
}

export function reconcilePhotoStates(localRecord, serverState) {
  const serverStates = normalizeArray(serverState?.photoStates, 'serverState.photoStates');
  const serverRecord = serverState?.record && typeof serverState.record === 'object' && !Array.isArray(serverState.record) ? serverState.record : {};
  const byIndex = new Map(serverStates.map((state) => [Number(state?.photoIndex), state]));
  const localStates = Array.from({ length: 7 }, (_, index) => {
    const current = localRecord?.photoStates?.[index] || {};
    const server = byIndex.get(index + 1);
    if (current.replacePending) {
      return { ...current, photoIndex: index + 1, confirmed: false, localReady: Boolean(current.localReady), serverUrl: server?.url || current.serverUrl || '' };
    }
    if (!server) {
      return { ...current, photoIndex: index + 1, confirmed: Boolean(current.confirmed), localReady: Boolean(current.localReady), serverUrl: current.serverUrl || '' };
    }
    if (!server.confirmed) {
      return { ...current, photoIndex: index + 1, confirmed: false, localReady: Boolean(current.localReady), serverUrl: current.serverUrl || '' };
    }
    return { ...current, photoIndex: index + 1, confirmed: true, localReady: false, serverUrl: server.url || current.serverUrl || '', error: '' };
  });
  return normalizeOccurrenceRecord({
    ...localRecord,
    ...serverRecord,
    serverConfirmed: true,
    serverStatus: serverState?.status || localRecord?.serverStatus || '',
    status: serverState?.status || localRecord?.status,
    photoStates: localStates,
    photoCount: localStates.slice(0, 5).filter((state) => state.confirmed).length,
    updatedAt: new Date().toISOString()
  }, 'reconciledRecord');
}

export function dedupeCatalogResults(items) {
  const grouped = new Map();
  for (const item of normalizeArray(items, 'catalogResults')) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const key = [item.code, item.catalogText, item.unit, item.group, Number(item.referenceValue)].map(normalizeText).join('|');
    if (!grouped.has(key)) grouped.set(key, { ...item });
  }
  return [...grouped.values()];
}

export function mergeRecordCollections(localRecords, serverRecords) {
  const merged = new Map();
  for (const record of normalizeOccurrenceRecords(localRecords, 'localRecords')) {
    merged.set(record.recordId, { ...record });
  }
  for (const server of normalizeOccurrenceRecords(serverRecords, 'serverRecords')) {
    const local = merged.get(server.recordId) || normalizeOccurrenceRecord({}, 'localRecord');
    merged.set(server.recordId, {
      ...local,
      ...server,
      localStatus: local.status,
      status: server.status || local.status,
      occurrenceTypes: server.occurrenceTypes.length ? server.occurrenceTypes : local.occurrenceTypes,
      services: server.services.length ? server.services : local.services,
      materials: server.materials.length ? server.materials : local.materials,
      photoStates: Array.isArray(local.photoStates) && local.photoStates.length ? local.photoStates : server.photoStates,
      photos: server.photos.length ? server.photos : local.photos,
      transformer: Object.keys(server.transformer).length ? server.transformer : local.transformer,
      transformerPhotos: Object.keys(server.transformerPhotos).length ? server.transformerPhotos : local.transformerPhotos
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
