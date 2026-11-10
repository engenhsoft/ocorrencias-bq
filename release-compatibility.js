import { confirmedCompatibility, healthCheck, incompatibleActions } from './api.js?v=2026.11.09.1';
import { APP_VERSION } from './core.js?v=2026.11.09.1';

export const API_CONTRACT = 'OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12';
const releasePattern = /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/;
const newerRelease = (version, current) => releasePattern.test(version || '') &&
  version.localeCompare(current, 'en', { numeric: true }) > 0;

export function classifyCompatibility({ client, backend, published, waiting, worker, assets, localSchema }) {
  const blocked = incompatibleActions(backend?.compatibility, client);
  const assetMismatch = assets.some(version => version !== client.version) || localSchema != null && localSchema !== client.schema;
  const update = newerRelease(published?.version, client.version) || newerRelease(waiting, client.version)
    || newerRelease(worker, client.version);
  const policy = backend?.compatibility;
  const confirmed = policy?.schema === 1 && Array.isArray(policy.acceptedContracts) && Array.isArray(policy.localSchemas)
    || !policy && backend?.contract === client.contract;
  const state = blocked.length || assetMismatch ? 'ATUALIZAÇÃO NECESSÁRIA' : update ? 'ATUALIZAÇÃO DISPONÍVEL'
    : confirmed ? 'ATUALIZADO' : 'VERSÃO NÃO CONFIRMADA';
  return { state, blocked, assetMismatch };
}

export function currentWorkerVersion(worker) {
  if (!worker || typeof MessageChannel !== 'function') return Promise.resolve('');
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = value => { clearTimeout(timeout); channel.port1.close(); resolve(releasePattern.test(value || '') ? value : ''); };
    const timeout = setTimeout(() => finish(''), 600);
    channel.port1.onmessage = event => finish(event.data?.version);
    try { worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]); } catch { finish(''); }
  });
}

async function publishedRelease() {
  if (!navigator.onLine) return null;
  try {
    const response = await fetch('./release-info.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const item = await response.json();
    if (!releasePattern.test(item.version) || typeof item.contract !== 'string') return null;
    return item;
  } catch { return null; }
}

async function storedSchema() {
  try {
    const databases = await indexedDB.databases();
    return databases.find(database => database.name === 'ocorrencias-bq-db')?.version;
  } catch { return undefined; }
}

export function createCompatibilityView({ schema, onUpdate, onChecked }) {
  const dialog = document.querySelector('#compatibilityDialog');
  const detail = dialog.querySelector('#compatibilityDetails');
  const update = dialog.querySelector('#compatibilityUpdate');
  const buttons = [...document.querySelectorAll('[data-compatibility]')];
  const client = { version: APP_VERSION, contract: API_CONTRACT, schema };
  let pending = null, checkedAt = 0, waiting = null, last = null;
  const assets = [...document.querySelectorAll('script[src*="/app.js?"], link[href*="/styles.css?"]')]
    .map(element => new URL(element.src || element.href).searchParams.get('v'));
  const draw = () => {
    const state = last?.state || 'VERSÃO NÃO CONFIRMADA';
    buttons.forEach(button => {
      button.textContent = state === 'ATUALIZADO' ? 'Compatibilidade' : state;
      button.classList.toggle('is-active', state.startsWith('ATUALIZAÇÃO'));
    });
    const lines = [
      ['Aplicativo', client.version], ['Servidor', last?.backend?.version || 'Versão não confirmada'],
      ['Contrato em uso', client.contract], ['Contrato do servidor', last?.backend?.contract || 'Sem confirmação'],
      ['Esquema local', last?.localSchema == null ? schema + ' (esperado)' : last.localSchema],
      ['Service Worker', last?.worker || 'Versão não confirmada'],
      ['Assets principais', assets.length ? [...new Set(assets)].join(', ') : 'Sem confirmação'],
      ['Release publicada', last?.published?.version || 'Sem confirmação']
    ];
    detail.replaceChildren(...lines.map(([label, value]) => {
      const item = document.createElement('li'); item.textContent = label + ' · ' + value; return item;
    }));
    dialog.querySelector('#compatibilityState').textContent = state;
    dialog.querySelector('#compatibilityBlocked').textContent = last?.blocked.length
      ? 'Operações remotas incompatíveis: ' + last.blocked.join(', ') + '. O armazenamento local continua disponível.' : '';
    update.hidden = !waiting;
  };
  async function check(force = false) {
    if (pending) return pending;
    if (!force && Date.now() - checkedAt < 300000) return last;
    checkedAt = Date.now();
    const task = (async () => {
      const known = confirmedCompatibility();
      const recent = known && Date.now() - known.at < 15000 && !force;
      const backendRequest = !navigator.onLine ? Promise.resolve(null)
        : recent ? Promise.resolve({ version: known.version, contract: known.contract, compatibility: known.policy }) : healthCheck().catch(() => null);
      const [backend, published, worker, nextWorker, localSchema] = await Promise.all([
        backendRequest, publishedRelease(), currentWorkerVersion(navigator.serviceWorker?.controller), currentWorkerVersion(waiting), storedSchema()
      ]);
      last = { backend, published, worker, localSchema, ...classifyCompatibility({ client, backend, published,
        waiting: nextWorker || (waiting ? published?.version : ''), worker, assets, localSchema }) };
      if (waiting && last.state !== 'ATUALIZAÇÃO NECESSÁRIA') last.state = 'ATUALIZAÇÃO DISPONÍVEL';
      draw(); onChecked?.(); return last;
    })();
    pending = task;
    try { return await task; } finally { if (pending === task) pending = null; }
  }
  buttons.forEach(button => button.addEventListener('click', () => { draw(); dialog.showModal(); void check(); }));
  dialog.querySelector('#compatibilityCheck').addEventListener('click', () => void check(true));
  update.addEventListener('click', () => { dialog.close(); onUpdate(); });
  draw();
  return { check, offer: worker => { waiting = worker; if (last && last.state !== 'ATUALIZAÇÃO NECESSÁRIA') last.state = 'ATUALIZAÇÃO DISPONÍVEL'; draw(); void check(true); } };
}
