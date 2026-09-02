import { API_ENDPOINT, MATERIAL_CATALOG_SOURCE } from './config.js';

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
  let data;
  try { data = JSON.parse(text); } catch {
    throw new ApiError('O servidor retornou uma resposta inválida.', 'INVALID_SERVER_RESPONSE', { status: response.status, text: text.slice(0, 220) });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError('O servidor retornou uma resposta inválida.', 'INVALID_SERVER_RESPONSE', { status: response.status, responseType: Array.isArray(data) ? 'array' : typeof data });
  }
  if (!response.ok || data.ok === false || data.success === false) {
    throw new ApiError(data.message || `Falha no servidor (${response.status}).`, data.error || 'SERVER_ERROR', data);
  }
  return data;
}

async function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await promiseFactory(controller.signal); }
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
    return parseResponse(response);
  }, options.timeoutMs || 35000);
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
        reject(new ApiError('Não foi possível carregar o Caderno de Obras.', 'MATERIAL_CATALOG_ERROR', response));
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
    script.onerror = () => finish(() => reject(new ApiError('Não foi possível carregar o Caderno de Obras.', 'MATERIAL_CATALOG_ERROR')));
    const timer = setTimeout(() => finish(() => reject(new ApiError('Tempo esgotado ao carregar o Caderno de Obras.', 'TIMEOUT'))), timeoutMs);
    script.src = url.toString();
    script.async = true;
    document.head.append(script);
  });
}

export const api = Object.freeze({
  login: (user, password, role) => apiRequest('login', { user, password, role }),
  searchCatalog: (token, query, limit = 25) => apiRequest('searchCatalog', { token, query, limit }),
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
  listMine: (token) => apiRequest('listMine', { token }),
  listPending: (token) => apiRequest('listPending', { token }),
  supervisorCorrectRecord: (token, record) => apiRequest('supervisorCorrectRecord', { token, record }, { timeoutMs: 60000 }),
  supervisorAction: (token, decision, recordId, reason = '', note = '', photoIssueIndexes = []) => apiRequest('supervisorAction', { token, decision, recordId, reason, note, photoIssueIndexes }),
  approveBatch: (token, recordIds = [], all = false, note = '') => apiRequest('approveBatch', { token, recordIds, all, note }, { timeoutMs: 60000 })
});

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler a foto.'));
    reader.readAsDataURL(blob);
  });
}
