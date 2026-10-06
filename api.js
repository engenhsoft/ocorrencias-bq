import { correctionConfirmationMatches } from './core.js?v=2026.10.06.3';
import { API_ENDPOINT, MATERIAL_CATALOG_SOURCE } from './config.js?v=2026.10.06.3';

export class ApiError extends Error {
  constructor(message, code = 'API_ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export function endpointConfigured() {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_ENDPOINT);
}

export async function parseResponse(response) {
  const text = await response.text();
  const unavailable = () => new ApiError('Servidor temporariamente indisponível. Tente novamente.', 'HTTP_SERVER_ERROR', { status: response.status });
  let data;
  try { data = JSON.parse(text); } catch {
    if (response.status >= 500) throw unavailable();
    throw new ApiError('O servidor retornou uma resposta inválida.', 'INVALID_SERVER_RESPONSE', { status: response.status, text: text.slice(0, 220) });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    if (response.status >= 500) throw unavailable();
    throw new ApiError('O servidor retornou uma resposta inválida.', 'INVALID_SERVER_RESPONSE', { status: response.status, responseType: Array.isArray(data) ? 'array' : typeof data });
  }
  if (!response.ok || data.ok === false || data.success === false) {
    throw new ApiError(data.message || `Falha no servidor (${response.status}).`, data.error || (response.status >= 500 ? 'HTTP_SERVER_ERROR' : 'SERVER_ERROR'), { ...data, status: response.status });
  }
  if (data.ok !== true && data.success !== true) {
    throw new ApiError('O servidor retornou uma resposta incompleta. Tente novamente.', 'INVALID_SERVER_RESPONSE', { status: response.status });
  }
  return data;
}

export async function loadOccurrenceDataset(request, validate, { initial = false, isCurrent = () => true } = {}) {
  const transient = (error) => error instanceof ApiError && (
    ['TIMEOUT', 'NETWORK_ERROR', 'HTTP_SERVER_ERROR', 'SERVICE_UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE'].includes(error.code)
    || (error.code === 'SERVER_ERROR' && error.details?.status >= 500)
  );
  try {
    const result = await request();
    return isCurrent() ? validate(result) : null;
  } catch (error) {
    if (!isCurrent()) return null;
    if (!initial || !transient(error)) throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (!isCurrent()) return null;
  const result = await request();
  return isCurrent() ? validate(result) : null;
}

async function withTimeout(promiseFactory, timeoutMs, enforceDeadline = true) {
  const controller = new AbortController();
  let rejectDeadline;
  const deadline = enforceDeadline ? new Promise((_, reject) => { rejectDeadline = reject; }) : null;
  const timer = setTimeout(() => {
    rejectDeadline?.(new ApiError('Tempo de conexão esgotado. Tente novamente; os dados locais foram preservados.', 'TIMEOUT'));
    controller.abort();
  }, timeoutMs);
  try {
    const request = promiseFactory(controller.signal);
    return await (deadline ? Promise.race([request, deadline]) : request);
  }
  catch (error) {
    if (error?.name === 'AbortError') throw new ApiError('Tempo de conexão esgotado. O item foi mantido para nova tentativa.', 'TIMEOUT');
    if (error instanceof ApiError) throw error;
    throw new ApiError(navigator.onLine ? 'Não foi possível falar com o servidor.' : 'Sem internet. O item foi mantido neste aparelho.', 'NETWORK_ERROR', error);
  } finally { clearTimeout(timer); }
}

function assertEndpoint() {
  if (!endpointConfigured()) throw new ApiError('O endpoint do aplicativo ainda não foi configurado.', 'ENDPOINT_NOT_CONFIGURED');
}

export async function healthCheck() {
  assertEndpoint();
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'health');
  url.searchParams.set('_', String(Date.now()));
  return withTimeout(async (signal) => {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store', signal });
    return parseResponse(response);
  }, 18000);
}

export async function apiRequest(action, payload = {}, options = {}) {
  assertEndpoint();
  const body = JSON.stringify({ action, ...payload });
  return withTimeout(async (signal) => {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      signal
    });
    const data = await parseResponse(response);
    if (['submitRecord', 'uploadPhoto', 'getRecordState'].includes(action)) {
      const recordId = payload.recordId || payload.record?.recordId;
      const states = data.photoStates;
      const indexes = new Set(Array.isArray(states) ? states.map(state => state?.photoIndex) : []);
      if (!recordId || data.recordId !== recordId || data.record?.recordId !== recordId
        || !['AGUARDANDO_SUPERVISOR', 'FOTOS_SENDO_SINCRONIZADAS', 'CORRECAO_SOLICITADA', 'REPROVADA', 'APROVADA', 'PUBLICADA'].includes(data.status)
        || !Array.isArray(states) || states.length !== 7 || indexes.size !== 7
        || states.some(state => !Number.isInteger(state?.photoIndex) || state.photoIndex < 1 || state.photoIndex > 7 || typeof state.confirmed !== 'boolean' || (state.confirmed && !String(state.url || state.serverUrl || '').trim()))) {
        throw new ApiError('O servidor não confirmou completamente esta ocorrência. Os dados locais foram preservados; tente novamente.', 'INVALID_RECORD_STATE');
      }
      if (action === 'submitRecord' && payload.record?.correctionRequestId && !correctionConfirmationMatches(payload.record, data)) {
        throw new ApiError('O servidor não confirmou os dados corrigidos. A edição permanece neste aparelho.', 'CORRECTION_DATA_UNCONFIRMED');
      }
      if (action === 'uploadPhoto' && !states.some(state => state.photoIndex === payload.photoIndex && state.confirmed && state.uploadKey === payload.uploadKey)) {
        throw new ApiError('O servidor ainda não confirmou esta foto. Ela continua guardada neste aparelho.', 'PHOTO_CONFIRMATION_PENDING');
      }
    }
    if (action === 'login' && (!String(data.token || '').trim() || typeof data.user !== 'string' || !data.user.trim() || data.role !== (payload.role === 'supervisor' ? 'supervisor' : 'field'))) {
      throw new ApiError('O servidor retornou uma sessão incompleta. Tente novamente.', 'INVALID_SESSION_RESPONSE');
    }
    return data;
  }, options.timeoutMs || 35000, options.enforceDeadline !== false);
}

export function loadMaterialCatalog(options = {}) {
  const timeoutMs = options.timeoutMs || 25000;
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new ApiError('O catálogo de materiais não está disponível neste ambiente.', 'MATERIAL_CATALOG_UNAVAILABLE'));
      return;
    }
    const callbackName = `__ocbqMaterialCatalog_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const url = new URL(`https://docs.google.com/spreadsheets/d/${MATERIAL_CATALOG_SOURCE.spreadsheetId}/gviz/tq`);
    url.searchParams.set('tqx', `out:json;responseHandler:${callbackName}`);
    url.searchParams.set('sheet', MATERIAL_CATALOG_SOURCE.sheetName);
    url.searchParams.set('range', MATERIAL_CATALOG_SOURCE.range);
    url.searchParams.set('tq', 'select A,B,C where A is not null');
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      try { delete globalThis[callbackName]; } catch { globalThis[callbackName] = undefined; }
    };
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler();
    };
    globalThis[callbackName] = (response) => finish(() => {
      if (!response || response.status !== 'ok' || !Array.isArray(response.table?.rows)) {
        reject(new ApiError('Não foi possível carregar o Caderno de Materiais.', 'MATERIAL_CATALOG_ERROR', response));
        return;
      }
      const cellText = (cell) => String(cell?.f ?? cell?.v ?? '').trim();
      const rows = response.table.rows.map((row) => ({
        code: cellText(row?.c?.[0]),
        description: cellText(row?.c?.[1]),
        unit: cellText(row?.c?.[2]),
        origin: 'Caderno de Obras'
      }));
      resolve(rows);
    });
    script.onerror = () => finish(() => reject(new ApiError('Não foi possível carregar o Caderno de Materiais.', 'MATERIAL_CATALOG_ERROR')));
    const timer = setTimeout(() => finish(() => reject(new ApiError('Tempo esgotado ao carregar o Caderno de Materiais.', 'TIMEOUT'))), timeoutMs);
    script.src = url.toString();
    script.async = true;
    document.head.append(script);
  });
}

export const api = Object.freeze({
  login: (user, password, role) => apiRequest('login', { user, password, role }),
  searchCatalog: (token, query, limit = 25, contract = '') => apiRequest('searchCatalog', { token, query, limit, contract }),
  getTeamDirectory: (token) => apiRequest('getTeamDirectory', { token }),
  submitRecord: (token, record, clientVersion) => apiRequest('submitRecord', { token, record, clientVersion }),
  uploadPhoto: (token, photo, options = {}) => apiRequest('uploadPhoto', {
    token,
    recordId: photo.recordId,
    photoIndex: photo.photoIndex,
    uploadKey: photo.uploadKey,
    mimeType: photo.mimeType,
    fileName: photo.fileName,
    dataUrl: photo.dataUrl,
    replace: Boolean(options.replace)
  }, { timeoutMs: 60000 }),
  getRecordState: (token, recordId) => apiRequest('getRecordState', { token, recordId }),
  getDailyTeamProduction: (token, team, date, recordId = '') => apiRequest('getDailyTeamProduction', { token, team, date, recordId }),
  listMine: (token) => apiRequest('listMine', { token }, { timeoutMs: 60000 }),
  listPending: (token) => apiRequest('listPending', { token }, { timeoutMs: 60000, enforceDeadline: true }),
  listPublishedRecords: (token, recordIds) => apiRequest('listPublishedRecords', { token, recordIds }),
  supervisorCorrectRecord: (token, record) => apiRequest('supervisorCorrectRecord', { token, record }, { timeoutMs: 60000 }),
  supervisorAction: (token, decision, recordId, reason = '', note = '', photoIssueIndexes = []) => apiRequest('supervisorAction', { token, decision, recordId, reason, note, photoIssueIndexes }, { timeoutMs: 60000 }),
  requestPhotoSyncBatch: (token, recordIds) => apiRequest('requestPhotoSyncBatch', { token, recordIds }, { timeoutMs: 60000 }),
  approveBatch: (token, recordIds = [], all = false, note = '') => apiRequest('approveBatch', { token, recordIds, all, note }, { timeoutMs: 60000 })
});

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (handler) => { if (settled) return; settled = true; clearTimeout(timer); handler(); };
    const timer = setTimeout(() => {
      finish(() => reject(new ApiError('Não foi possível ler a foto no tempo esperado. Ela continua guardada neste aparelho.', 'LOCAL_PHOTO_READ_TIMEOUT')));
      try { reader.abort(); } catch { /* A leitura já pode ter terminado. */ }
    }, 12000);
    reader.onload = () => finish(() => resolve(String(reader.result)));
    reader.onerror = () => finish(() => reject(reader.error || new Error('Não foi possível ler a foto.')));
    reader.onabort = () => finish(() => reject(new ApiError('Leitura da foto interrompida. Tente novamente.', 'LOCAL_PHOTO_READ_ABORTED')));
    try { reader.readAsDataURL(blob); }
    catch (error) { finish(() => reject(error)); }
  });
}
