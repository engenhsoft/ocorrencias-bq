import { API_ENDPOINT } from './config.js';

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
  listMine: (token) => apiRequest('listMine', { token }),
  listPending: (token) => apiRequest('listPending', { token }),
  supervisorAction: (token, decision, recordId, reason = '', note = '') => apiRequest('supervisorAction', { token, decision, recordId, reason, note }),
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
