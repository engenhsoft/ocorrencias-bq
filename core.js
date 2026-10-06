export const APP_VERSION = '2026.10.06.3';
export const APP_BUILD = '2026-10-06-correction-persistence';

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

export const SERVICE_CONTRACTS = Object.freeze({
  CONTRACT_80938: '4600080938',
  CONTRACT_80939: '4600080939'
});

export const CONTRACT_BY_BASE = Object.freeze({
  'CARAÚBAS': SERVICE_CONTRACTS.CONTRACT_80938,
  'PAU DOS FERROS': SERVICE_CONTRACTS.CONTRACT_80938,
  'CURRAIS NOVOS': SERVICE_CONTRACTS.CONTRACT_80938,
  'CAICÓ': SERVICE_CONTRACTS.CONTRACT_80938,
  'MOSSORÓ': SERVICE_CONTRACTS.CONTRACT_80939,
  'ASSÚ': SERVICE_CONTRACTS.CONTRACT_80939
});

export function contractForBase(base) {
  return CONTRACT_BY_BASE[String(base || '').trim().toUpperCase()] || '';
}

function parseCatalogPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const text = String(value ?? '').replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!text) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

export function contractValuesForService(service = {}) {
  const source = service?.contractValues && typeof service.contractValues === 'object' && !Array.isArray(service.contractValues)
    ? service.contractValues
    : {};
  return {
    [SERVICE_CONTRACTS.CONTRACT_80938]: parseCatalogPrice(source[SERVICE_CONTRACTS.CONTRACT_80938] ?? service.value4600080938),
    [SERVICE_CONTRACTS.CONTRACT_80939]: parseCatalogPrice(source[SERVICE_CONTRACTS.CONTRACT_80939] ?? service.value4600080939)
  };
}

export function serviceValueForContract(service, contract) {
  const value = contractValuesForService(service)[String(contract || '')];
  return Number.isFinite(value) ? value : null;
}

export function priceServiceForContract(service = {}, contract = '') {
  const referenceValue = serviceValueForContract(service, contract);
  const quantity = parseServiceQuantity(service.quantity);
  return {
    ...service,
    contractValues: contractValuesForService(service),
    contract: String(contract || ''),
    referenceValue,
    totalValue: referenceValue == null || !Number.isFinite(quantity) ? null : Math.round(referenceValue * quantity * 100) / 100,
    pricingError: referenceValue == null ? `Serviço sem valor cadastrado para o contrato ${contract}.` : ''
  };
}

export function repriceServicesForBase(services, base) {
  const contract = contractForBase(base);
  const repriced = normalizeServices(services).map((service) => priceServiceForContract(service, contract));
  return {
    contract,
    services: repriced,
    missingCodes: repriced.filter((service) => service.referenceValue == null).map((service) => service.code || service.catalogKey || 'sem código')
  };
}

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

export function correctedAfterResend(record) {
  if (!record?.recordId || record.status !== RECORD_STATUS.WAITING_SUPERVISOR) return false;
  const receipt = record.audit?.lastCorrectionSubmission;
  if (receipt && receipt.phase !== 'COMPLETE') return false;
  const timeline = Array.isArray(record.audit?.timeline) ? record.audit.timeline : [];
  let correctionRequested = false; let resent = false;
  for (const event of timeline) {
    if (['CORRECAO_SOLICITADA', 'CORRECAO_FOTOS_SOLICITADA'].includes(event?.action)) { correctionRequested = true; resent = false; }
    if (event?.action === 'CORRECAO_REENVIADA' && correctionRequested) resent = true;
  }
  return resent;
}

const EDITABLE_CORRECTION_FIELDS = ['base', 'contract', 'team', 'crewLeader', 'occurrenceNumber', 'occurrenceTypes', 'otherOccurrenceType', 'pgPostRemoved', 'pgPostInstalled', 'pgConductorStart', 'pgConductorEnd', 'transformer', 'services', 'materials', 'totalServices', 'observation'];
export function correctionFields(record) {
  return Object.fromEntries(EDITABLE_CORRECTION_FIELDS.filter(key => Object.hasOwn(record || {}, key)).map(key => [key, record[key]]));
}

// Compare operational values, ignoring UI-only IDs and catalog search metadata.
export function correctionDataSnapshot(record = {}) {
  const text = value => String(value ?? '').trim();
  const result = {};
  for (const key of EDITABLE_CORRECTION_FIELDS.filter(key => !['occurrenceTypes', 'transformer', 'services', 'materials', 'totalServices'].includes(key))) result[key] = text(record[key]);
  result.occurrenceTypes = normalizeOccurrenceTypes(record.occurrenceTypes);
  result.transformer = Object.fromEntries(['removedCode', 'removedCia', 'removedBto', 'newCode', 'newCia', 'newBto'].map(key => [key, text(record.transformer?.[key])]));
  result.services = normalizeServices(record.services).map(service => ({ ...Object.fromEntries(['catalogKey', 'code', 'catalogText', 'unit', 'group', 'contract', 'origin'].map(key => [key, text(service[key])])), quantity: Number(service.quantity), referenceValue: Number(service.referenceValue), totalValue: Number(service.totalValue) }));
  result.materials = normalizeMaterials(record.materials).map(material => ({ code: text(material.code), description: text(material.description), unit: text(material.unit), quantity: Number(material.quantity) }));
  result.totalServices = Math.round(Number(record.totalServices ?? occurrenceTotal(record.services)) * 100) / 100;
  return result;
}

export function correctionConfirmationMatches(submitted, state, complete = false) {
  const receipt = state?.record?.audit?.lastCorrectionSubmission;
  return state?.recordId === submitted?.recordId && receipt?.requestId === submitted?.correctionRequestId
    && receipt?.requestedAt === submitted?.correctionRequestedAt && Boolean(receipt?.dataVerifiedAt)
    && (complete ? receipt.phase === 'COMPLETE' : ['DATA_VERIFIED', 'COMPLETE'].includes(receipt.phase))
    && JSON.stringify(correctionDataSnapshot(submitted)) === JSON.stringify(correctionDataSnapshot(state.record));
}

export function openPhotoSyncRequest(record, recipient = '') {
  if (!record?.recordId || record.status !== RECORD_STATUS.SYNCING_PHOTOS) return null;
  const request = record.audit?.photoSyncRequest;
  if (!request || request.status !== 'OPEN' || request.reason !== 'FOTOS_PENDENTES') return null;
  if (record.user && !sameUser(record.user, request.recipient)) return null;
  if (recipient && !sameUser(request.recipient, recipient)) return null;
  return request;
}

// O login atual identifica a pessoa pelo nome, não pela equipe.
export function sameUser(left, right) {
  const key = (value) => normalizeText(value).replace(/\s+/g, ' ');
  return Boolean(key(left)) && key(left) === key(right);
}

export function normalizeTeamDirectory(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Relação de equipes indisponível.');
  const byKey = new Map();
  for (const entry of entries) {
    const base = OPERATION_BASES.find((value) => normalizeText(value) === normalizeText(entry?.base));
    const team = String(entry?.team || '').trim();
    const crewLeader = String(entry?.crewLeader || '').trim();
    if (!base || !team || !crewLeader || ['EQUIPE', 'CHEFE DE TURMA'].includes(normalizeText(crewLeader))) throw new Error('Relação de equipes inválida.');
    const key = `${base}|${normalizeText(team)}`;
    const previous = byKey.get(key);
    if (previous && normalizeText(previous.crewLeader) !== normalizeText(crewLeader)) throw new Error('Equipe com chefes conflitantes no cadastro.');
    byKey.set(key, { base, team, crewLeader });
  }
  return [...byKey.values()];
}

export function teamsForBase(entries = [], base = '') {
  return entries.filter((entry) => normalizeText(entry.base) === normalizeText(base));
}

export function teamDirectoryEntry(entries = [], base = '', team = '') {
  return teamsForBase(entries, base).find((entry) => normalizeText(entry.team) === normalizeText(team)) || null;
}

export function occurrenceDate(record = {}) {
  const value = record.registeredAt || record.createdAt;
  return value ? operationalDate(value) : '';
}

export function dateInRange(date, { from = '', to = '' } = {}) {
  return validDateRange(from, to) && ((!from && !to) || Boolean(date)) && (!from || date >= from) && (!to || date <= to);
}

export function uniqueRecordsById(records = []) {
  const byId = new Map();
  for (const record of normalizeArray(records, 'records')) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const recordId = String(record.recordId || '').trim();
    if (!recordId || byId.has(recordId)) continue;
    byId.set(recordId, record);
  }
  return [...byId.values()];
}

export function mineNeedsAttention(record) {
  if (record?.status === RECORD_STATUS.CORRECTION_REQUESTED || record?.status === RECORD_STATUS.SYNCING_PHOTOS) return true;
  return record?.status === RECORD_STATUS.ERROR && (
    record.serverStatus === RECORD_STATUS.SYNCING_PHOTOS
    || (record.serverConfirmed && normalizePhotoStates(record.photoStates).some((photo) => photo.localReady && !photo.confirmed))
  );
}

export function supervisorDateWindow(mode, today = operationalDate()) {
  if (mode === 'today') return { from: today, to: today };
  if (mode === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: '', to: '' };
}

export function validDateRange(from, to) {
  const valid = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value);
  return valid(from) && valid(to) && (!from || !to || from <= to);
}

export function nextVisibleRecordId(beforeIds, currentId, afterIds) {
  const index = beforeIds.indexOf(currentId);
  if (index < 0) return '';
  const remaining = new Set(afterIds);
  return beforeIds.slice(index + 1).find((id) => remaining.has(id)) || '';
}

export function supervisorKpis(records = []) {
  const unique = uniqueRecordsById(records);
  const count = (...statuses) => unique.filter((record) => statuses.includes(record.status)).length;
  const published = count(RECORD_STATUS.PUBLISHED, 'APROVADA_E_PUBLICADA');
  const waitingConference = count(RECORD_STATUS.WAITING_SUPERVISOR);
  const waitingCorrection = count(RECORD_STATUS.CORRECTION_REQUESTED);
  const rejected = count(RECORD_STATUS.REJECTED);
  const pendingSync = count(RECORD_STATUS.SYNCING_PHOTOS);
  return {
    published,
    waitingConference,
    waitingCorrection,
    rejected,
    pendingSync,
    pending: waitingCorrection + pendingSync
  };
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

export function normalizeServices(value, label = 'services') {
  return normalizeArray(value, label)
    .filter((service) => service && typeof service === 'object' && !Array.isArray(service));
}

export function parseServiceQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? '').trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return NaN;
  return Number(text.replace(',', '.'));
}

export function serializeServicesForBackend(value) {
  return normalizeServices(value).map((service) => {
    const quantity = parseServiceQuantity(service.quantity);
    return { ...service, quantity: Number.isFinite(quantity) ? quantity : service.quantity };
  });
}

export function historicalServiceIndex(service, originalServices = [], recordId = '') {
  return normalizeServices(originalServices).findIndex((previous, index) => {
    const sameLine = previous.lineId
      ? Boolean(service?.lineId) && previous.lineId === service.lineId
      : (!service?.lineId || service.lineId === `historical:${recordId}:${index}`);
    return sameLine && ['catalogKey', 'code', 'catalogText', 'unit', 'group', 'origin', 'contract'].every((field) => String(previous[field] ?? '') === String(service?.[field] ?? ''))
      && Number(previous.referenceValue) === Number(service?.referenceValue);
  });
}

export function occurrenceSnapshotTotal(services, originalServices = [], recordId = '') {
  const total = normalizeServices(services).reduce((sum, service) => {
    const index = historicalServiceIndex(service, originalServices, recordId);
    const previous = index >= 0 ? originalServices[index] : null;
    const unchangedQuantity = previous && parseServiceQuantity(previous.quantity) === parseServiceQuantity(service.quantity);
    const lineTotal = unchangedQuantity ? Number(previous.totalValue) : Math.round(serviceTotal(service) * 100) / 100;
    return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
  }, 0);
  return Math.round(total * 100) / 100;
}

export function serviceSnapshotErrors(value) {
  if (!Array.isArray(value) || !value.length) return ['A ocorrência não possui um snapshot válido dos serviços.'];
  const errors = [];
  value.forEach((service, index) => {
    const quantity = parseServiceQuantity(service?.quantity);
    const unitValue = service?.referenceValue;
    const total = service?.totalValue;
    const validNumber = (number) => ['number', 'string'].includes(typeof number) && String(number).trim() !== '' && Number.isFinite(Number(number)) && Number(number) >= 0;
    if (!service || typeof service !== 'object' || Array.isArray(service) || !String(service.code || '').trim() || !String(service.catalogText || '').trim() || !(quantity > 0) || !validNumber(unitValue) || !validNumber(total)) {
      errors.push(`Snapshot histórico inválido no serviço ${index + 1}.`);
    }
  });
  return errors;
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

const STRUCTURED_MATERIAL_PATTERN = /^\[MATERIAL:([^\]]+)\]\s*(.*?)\s*\[UNIDADE:([^\]]+)\]$/i;

export function parseMaterialQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? '').trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return NaN;
  return Number(text.replace(',', '.'));
}

export function materialKey(value = {}) {
  const material = normalizeMaterial(value);
  if (!material.code || !material.description || !material.unit) return '';
  return [material.code, material.description, material.unit].map(normalizeText).join('|');
}

export function normalizeMaterial(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  let code = String(source.code ?? source.codigo ?? source.materialCode ?? source.codigoMaterial ?? source['Código do Material'] ?? '').trim();
  let description = String(source.catalogDescription ?? source.descricao ?? source.textoBreve ?? source['Texto breve'] ?? source.text ?? source.description ?? source.material ?? source.MATERIAL ?? '').trim();
  let unit = String(source.unit ?? source.unidade ?? source.Unidade ?? '').trim();
  const encoded = description.match(STRUCTURED_MATERIAL_PATTERN);
  if (encoded) {
    code ||= encoded[1].trim();
    description = encoded[2].trim();
    unit ||= encoded[3].trim();
  }
  return {
    ...source,
    lineId: String(source.lineId || ''),
    code,
    description,
    unit,
    quantity: source.quantity ?? source.quantidade ?? source.QUANTIDADE ?? '',
    origin: source.origin || (code && unit ? 'Caderno de Obras' : 'Histórico')
  };
}

export function normalizeMaterials(value, label = 'materials') {
  return normalizeArray(value, label)
    .filter((material) => material && typeof material === 'object' && !Array.isArray(material))
    .map(normalizeMaterial);
}

export function isMaterialQuantityValid(value = {}) {
  const material = normalizeMaterial(value);
  const quantity = parseMaterialQuantity(material.quantity);
  if (!(quantity > 0)) return false;
  return normalizeText(material.unit) !== 'UN' || Number.isInteger(quantity);
}

export function encodeMaterialDescription(value = {}) {
  const material = normalizeMaterial(value);
  if (!material.code || !material.unit) return material.description;
  return `[MATERIAL:${material.code}] ${material.description} [UNIDADE:${material.unit}]`;
}

export function serializeMaterialsForBackend(value) {
  return normalizeMaterials(value).map((item) => {
    const quantity = parseMaterialQuantity(item.quantity);
    return {
      ...item,
      catalogDescription: item.description,
      description: encodeMaterialDescription(item),
      quantity: Number.isFinite(quantity) ? quantity : item.quantity
    };
  });
}

export function dedupeMaterialCatalog(value) {
  const grouped = new Map();
  for (const raw of normalizeArray(value, 'materialCatalog')) {
    const material = normalizeMaterial(raw);
    const key = materialKey(material);
    if (!key || normalizeText(material.code) === 'CODIGO DO MATERIAL' || grouped.has(key)) continue;
    grouped.set(key, { ...material, materialKey: key, origin: 'Caderno de Obras' });
  }
  return [...grouped.values()].sort((left, right) => String(left.code).localeCompare(String(right.code), 'pt-BR'));
}

export function searchMaterialCatalog(value, query, limit = 40) {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return dedupeMaterialCatalog(value)
    .filter((material) => {
      const searchable = normalizeText(`${material.code} ${material.description}`);
      return tokens.every((token) => searchable.includes(token));
    })
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function normalizeOccurrenceRecord(value, label = 'record') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (source !== value && value != null && value !== '') globalThis.console?.warn?.(`[Contrato] ${label} deveria ser Object; usando objeto vazio.`, { type: typeof value });
  return {
    ...source,
    occurrenceTypes: normalizeOccurrenceTypes(source.occurrenceTypes),
    services: normalizeServices(source.services, `${label}.services`),
    materials: normalizeMaterials(source.materials, `${label}.materials`),
    photos: normalizePhotoUrls(source.photos, `${label}.photos`),
    photoStates: normalizePhotoStates(source.photoStates, `${label}.photoStates`),
    transformer: source.transformer && typeof source.transformer === 'object' && !Array.isArray(source.transformer) ? source.transformer : {},
    transformerPhotos: source.transformerPhotos && typeof source.transformerPhotos === 'object' && !Array.isArray(source.transformerPhotos) ? source.transformerPhotos : {}
  };
}

export function normalizePhotoUrls(value, label = 'photos') {
  const normalized = Array(5).fill('');
  normalizeArray(value, label).forEach((entry, position) => {
    const isObject = entry && typeof entry === 'object' && !Array.isArray(entry);
    const index = Number(isObject ? (entry.photoIndex ?? entry.index ?? position + 1) : position + 1);
    if (!Number.isInteger(index) || index < 1 || index > 5) {
      globalThis.console?.warn?.(`[Fotos] ${label} contém índice inválido; entrada ignorada.`, { index });
      return;
    }
    const url = isObject ? (entry.serverUrl || entry.url || entry.src || '') : entry;
    normalized[index - 1] = typeof url === 'string' ? url : '';
  });
  return normalized;
}

export function normalizePhotoStates(value, label = 'photoStates') {
  const normalized = Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1 }));
  normalizeArray(value, label).forEach((entry, position) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      globalThis.console?.warn?.(`[Fotos] ${label} contém estado inválido; entrada ignorada.`);
      return;
    }
    const index = Number(entry.photoIndex ?? entry.index ?? position + 1);
    if (!Number.isInteger(index) || index < 1 || index > 7) {
      globalThis.console?.warn?.(`[Fotos] ${label} contém índice inválido; entrada ignorada.`, { index });
      return;
    }
    normalized[index - 1] = { ...entry, photoIndex: index };
  });
  return normalized;
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
  const number = parseServiceQuantity(value);
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
  const quantity = parseServiceQuantity(service?.quantity);
  const unitValue = Number(service?.referenceValue);
  return Number.isFinite(quantity) && Number.isFinite(unitValue) ? quantity * unitValue : 0;
}

export function occurrenceTotal(services = []) {
  return normalizeServices(services).reduce((total, service) => total + serviceTotal(service), 0);
}

export function operationalDate(value = new Date(), timeZone = 'America/Bahia') {
  if (typeof value === 'string') {
    const text = value.trim();
    // Uma data sem hora é um dia do calendário, não meia-noite em UTC.
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validDateRange(text, text) ? text : '';
    const local = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/);
    const calendar = local ? `${local[3]}-${local[2]}-${local[1]}` : text.match(/^(\d{4}-\d{2}-\d{2})[ T]/)?.[1];
    if (calendar && !validDateRange(calendar, calendar)) return '';
    if (local) value = `${local[3]}-${local[2]}-${local[1]}T${local[4] || '12:00:00'}-03:00`;
    else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) value = `${text.replace(' ', 'T')}-03:00`;
    else value = text;
  }
  if (!value) return '';
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

export function validateOccurrence(record = {}, { historicalServices = false, originalServices = [] } = {}) {
  const errors = [];
  const types = normalizeOccurrenceTypes(record.occurrenceTypes);
  const services = normalizeServices(record.services);
  const materials = normalizeMaterials(record.materials, 'materials');
  const expectedContract = contractForBase(record.base);
  if (!OPERATION_BASES.includes(String(record.base || '').trim())) errors.push('Selecione a Sub-base.');
  else if (!historicalServices && (!record.contract || String(record.contract) !== expectedContract)) errors.push('O contrato da Sub-base está inválido. Selecione novamente a Sub-base.');
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
    if (!String(record.transformer?.removedCode || '').trim()) errors.push('Informe a série do transformador retirado ou 999999.');
    if (!String(record.transformer?.removedCia || '').trim()) errors.push('Informe a CIA do trafo retirado.');
    if (!String(record.transformer?.removedBto || '').trim()) errors.push('Informe o BTO do transformador retirado.');
    if (!String(record.transformer?.newCode || '').trim() || String(record.transformer?.newCode || '').trim() === '999999') errors.push('Informe uma série válida para o transformador instalado.');
    if (!String(record.transformer?.newCia || '').trim()) errors.push('Informe a CIA do trafo novo.');
    if (!String(record.transformer?.newBto || '').trim()) errors.push('Informe o BTO do transformador instalado.');
    if (!transformerPhotoReady(record, 'removed')) errors.push('Adicione a evidência do transformador retirado.');
    if (!transformerPhotoReady(record, 'installed')) errors.push('Adicione a evidência do transformador instalado.');
  }
  if (record.correctionMode && !types.includes('SUBSTITUIÇÃO DE TRAFO') && String(record.transformer?.newCode ?? '').trim() === '999999') errors.push('Informe uma série válida para o transformador instalado.');
  if (!services.length) errors.push('Adicione pelo menos um serviço da aba Emergência.');
  if (historicalServices) errors.push(...serviceSnapshotErrors(record.services));
  else services.forEach((service, index) => {
    if (historicalServiceIndex(service, originalServices, record.recordId) >= 0) {
      errors.push(...serviceSnapshotErrors([service]));
      if (!String(service.unit || '').trim() || !Object.values(SERVICE_CONTRACTS).includes(String(service.contract || ''))) errors.push(`Snapshot histórico inválido no serviço ${index + 1}.`);
      return;
    }
    if (!service?.catalogKey || !service?.code) errors.push(`Serviço ${index + 1} inválido.`);
    if (!(parseServiceQuantity(service?.quantity) > 0)) errors.push(`Informe uma QTD válida no serviço ${index + 1}.`);
    if (service?.referenceValue == null || !Number.isFinite(Number(service.referenceValue)) || String(service.contract || '') !== expectedContract) {
      errors.push(`Serviço sem valor cadastrado para o contrato ${expectedContract || 'da Sub-base'}.`);
    }
  });
  if (!materials.length) errors.push('Adicione pelo menos um material aplicado.');
  materials.forEach((material, index) => {
    if (!String(material?.description || '').trim()) errors.push(`Informe o material aplicado no item ${index + 1}.`);
    if (material.code && !material.unit) errors.push(`Unidade ausente no material ${index + 1}.`);
    if (!isMaterialQuantityValid(material)) {
      errors.push(normalizeText(material.unit) === 'UN'
        ? `Informe uma quantidade inteira positiva no material ${index + 1}.`
        : `Informe uma quantidade positiva no material ${index + 1}.`);
    }
  });
  return [...new Set(errors)];
}

export function countConfirmedPhotos(record) {
  const stateCount = normalizePhotoStates(record?.photoStates).slice(0, 5).filter((state) => state.confirmed).length;
  const urlCount = normalizePhotoUrls(record?.photos).filter(Boolean).length;
  return Math.max(stateCount, urlCount);
}

export function countReadyPhotoStates(record) {
  const stateCount = normalizePhotoStates(record?.photoStates).slice(0, 5)
    .filter((state) => state?.confirmed || state?.serverUrl || state?.localReady).length;
  const urlCount = normalizePhotoUrls(record?.photos).filter(Boolean).length;
  return Math.max(stateCount, urlCount);
}

export function transformerPhotoReady(record, kind) {
  const index = kind === 'removed' ? 6 : 7;
  const state = normalizePhotoStates(record?.photoStates)[index - 1];
  const url = kind === 'removed' ? record?.transformerPhotos?.removed : record?.transformerPhotos?.installed;
  return Boolean(state.confirmed || state.serverUrl || state.url || state.localReady || url);
}

export function requiredPhotoDeficit(record) {
  const general = Math.max(0, 3 - countReadyPhotoStates(record));
  if (!normalizeOccurrenceTypes(record?.occurrenceTypes).includes('SUBSTITUIÇÃO DE TRAFO')) return general;
  return general + (transformerPhotoReady(record, 'removed') ? 0 : 1) + (transformerPhotoReady(record, 'installed') ? 0 : 1);
}

export function countPendingPhotoUploads(record) {
  return normalizePhotoStates(record?.photoStates).slice(0, 7)
    .filter((state) => state && typeof state === 'object' && !Array.isArray(state))
    .filter((state) => Boolean(state.localReady) && (!state.confirmed || state.replacePending)).length;
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
  const photos = normalizePhotoUrls(record?.photos);
  const states = normalizePhotoStates(record?.photoStates);
  const urls = Array.from({ length: 5 }, (_, index) => photos[index] || states[index].serverUrl || states[index].url || '');
  const validGeneral = urls.map((url, index) => Boolean(url) && !failed.has(index + 1));
  const issues = [];
  const missingGeneral = validGeneral.map((valid, index) => valid ? 0 : index + 1).filter(Boolean);
  issues.push(...missingGeneral.slice(0, Math.max(0, 3 - validGeneral.filter(Boolean).length)));
  if (normalizeOccurrenceTypes(record?.occurrenceTypes).includes('SUBSTITUIÇÃO DE TRAFO')) {
    if (!transformerPhotoReady(record, 'removed') || failed.has(6)) issues.push(6);
    if (!transformerPhotoReady(record, 'installed') || failed.has(7)) issues.push(7);
  }
  for (const index of failed) if (index >= 1 && index <= 5) issues.push(index);
  return [...new Set(issues)].sort((left, right) => left - right);
}

export function supervisorCorrectionChanges(before = {}, after = {}) {
  const changes = [];
  const add = (field, previousValue, newValue) => {
    const previous = typeof previousValue === 'string' ? previousValue : JSON.stringify(previousValue ?? '');
    const next = typeof newValue === 'string' ? newValue : JSON.stringify(newValue ?? '');
    if (previous !== next) changes.push({ field, previousValue: previous, newValue: next });
  };
  add('Sub-base', before.base, after.base);
  add('Contrato', before.contract, after.contract);
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
  add('Serviços selecionados', normalizeServices(before.services).map(({ catalogKey, code, quantity, referenceValue, contract }) => ({ catalogKey, code, quantity, referenceValue, contract })), normalizeServices(after.services).map(({ catalogKey, code, quantity, referenceValue, contract }) => ({ catalogKey, code, quantity, referenceValue, contract })));
  add('Total dos serviços', Math.round(occurrenceTotal(before.services) * 100) / 100, Math.round(occurrenceTotal(after.services) * 100) / 100);
  add('Materiais aplicados', normalizeMaterials(before.materials).map(({ code, description, unit, quantity }) => ({ code, description, unit, quantity })), normalizeMaterials(after.materials).map(({ code, description, unit, quantity }) => ({ code, description, unit, quantity })));
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
  const pendingPhotos = pendingRecords.reduce((total, record) => total + countPendingPhotoUploads(record), 0);
  const syncingPhotos = records
    .filter((record) => record.status === RECORD_STATUS.SYNCING_PHOTOS)
    .reduce((total, record) => total + countPendingPhotoUploads(record), 0);
  return {
    pendingRecords,
    pendingPhotos,
    syncingPhotos,
    errors: records.filter((record) => record.status === RECORD_STATUS.ERROR || record.lastError).length
  };
}

export function reconcilePhotoStates(localRecord, serverState) {
  const serverStates = normalizePhotoStates(serverState?.photoStates, 'serverState.photoStates');
  const serverRecord = serverState?.record && typeof serverState.record === 'object' && !Array.isArray(serverState.record) ? serverState.record : {};
  const byIndex = new Map(serverStates
    .filter((state) => state.confirmed || state.serverUrl || state.url || state.uploadKey)
    .map((state) => [state.photoIndex, state]));
  const currentStates = normalizePhotoStates(localRecord?.photoStates, 'localRecord.photoStates');
  const localStates = Array.from({ length: 7 }, (_, index) => {
    const current = currentStates[index];
    const server = byIndex.get(index + 1);
    const matchingUpload = Boolean(current.uploadKey && server?.uploadKey === current.uploadKey && server.confirmed);
    if (current.replacePending && !matchingUpload) {
      return { ...current, photoIndex: index + 1, confirmed: false, localReady: Boolean(current.localReady), serverUrl: server?.url || current.serverUrl || '' };
    }
    if (current.localReady && current.uploadKey && server && server.uploadKey !== current.uploadKey) {
      return { ...current, photoIndex: index + 1, confirmed: false, localReady: true, serverUrl: server.url || server.serverUrl || current.serverUrl || '' };
    }
    if (!server) {
      return { ...current, photoIndex: index + 1, confirmed: Boolean(current.confirmed), localReady: Boolean(current.localReady), serverUrl: current.serverUrl || '' };
    }
    if (!server.confirmed) {
      return { ...current, photoIndex: index + 1, confirmed: false, localReady: Boolean(current.localReady), serverUrl: current.serverUrl || '' };
    }
    return { ...current, photoIndex: index + 1, confirmed: true, localReady: false, replacePending: false, uploadKey: current.uploadKey || server.uploadKey || '', serverUrl: server.url || server.serverUrl || current.serverUrl || '', error: '' };
  });
  return normalizeOccurrenceRecord({
    ...localRecord,
    ...serverRecord,
    ...(localRecord?.correctionMode ? correctionFields(localRecord) : {}),
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
    const values = contractValuesForService(item);
    const key = [item.code, item.catalogText, item.unit, item.group, values[SERVICE_CONTRACTS.CONTRACT_80938], values[SERVICE_CONTRACTS.CONTRACT_80939]].map(normalizeText).join('|');
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
    const existingLocal = merged.get(server.recordId);
    const local = existingLocal || normalizeOccurrenceRecord({}, 'localRecord');
    merged.set(server.recordId, {
      ...local,
      ...server,
      localStatus: local.status,
      status: server.status || local.status,
      occurrenceTypes: server.occurrenceTypes.length ? server.occurrenceTypes : local.occurrenceTypes,
      services: server.services.length ? server.services : local.services,
      materials: server.materials.length ? server.materials : local.materials,
      photoStates: existingLocal ? reconcilePhotoStates(local, { photoStates: server.photoStates }).photoStates : server.photoStates,
      photos: server.photos.length ? server.photos : local.photos,
      transformer: Object.keys(server.transformer).length ? server.transformer : local.transformer,
      transformerPhotos: Object.keys(server.transformerPhotos).length ? server.transformerPhotos : local.transformerPhotos,
      ...(local.correctionMode ? correctionFields(local) : {})
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
