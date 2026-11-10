import { escapeHtml, formatDateTime, normalizeOccurrenceTypes, normalizePhotoStates, RECORD_STATUS } from './core.js?v=2026.11.09.2';

const text = value => escapeHtml(String(value ?? ''));
const syncable = new Set([RECORD_STATUS.PENDING, RECORD_STATUS.SYNCING_DATA, RECORD_STATUS.SYNCING_PHOTOS, RECORD_STATUS.ERROR]);
export const partiallyConfirmed = record => record.syncProgress?.dataConfirmed === true || record.serverConfirmed === true;

export function prioritizeQueue(records) {
  return [...records].sort((left, right) => Number(partiallyConfirmed(right)) - Number(partiallyConfirmed(left))
    || String(left.registeredAt || left.createdAt || '').localeCompare(String(right.registeredAt || right.createdAt || '')));
}

export function canQueueRetry(record, automatic = false) {
  return syncable.has(record.status) && record.lastSyncError?.code !== 'DATA_COMMIT_CONFLICT' && (!automatic || (record.attempts || 0) < 3);
}

export function synchronizationQueueState(record, { online, busy = false, localSlots }) {
  const photos = normalizePhotoStates(record.photoStates)
    .filter(photo => photo.photoIndex <= 5 || normalizeOccurrenceTypes(record.occurrenceTypes).includes('SUBSTITUIÇÃO DE TRAFO'));
  const expected = new Set([...(record.audit?.expectedPhotoIndexes || []), ...(record.requestedPhotoIndexes || [])].map(Number));
  const confirmed = photos.filter(photo => photo.confirmed && (photo.serverUrl || photo.url) && !photo.replacePending);
  const local = new Set(localSlots || photos.filter(photo => photo.localReady).map(photo => photo.photoIndex));
  const target = photos.filter(photo => expected.has(photo.photoIndex) || local.has(photo.photoIndex) || confirmed.includes(photo) || photo.replacePending);
  const next = target.find(photo => !confirmed.includes(photo));
  const data = partiallyConfirmed(record);
  const complete = record.syncPhase === 'confirmed';
  const error = record.status === RECORD_STATUS.ERROR || record.syncPhase === 'error';
  const phase = complete ? 'CONCLUÍDO' : !online ? 'AGUARDANDO CONEXÃO'
    : busy ? record.syncPhase === 'photos' ? 'SINCRONIZANDO FOTOS' : record.syncPhase === 'confirming' ? 'AGUARDANDO CONFIRMAÇÃO' : 'ENVIANDO DADOS'
      : error ? 'ERRO RECUPERÁVEL' : data ? 'DADOS CONFIRMADOS' : 'SALVO LOCALMENTE';
  const action = complete ? 'Envio confirmado' : !online ? 'Aguardar conexão'
    : record.lastSyncError?.code === 'DATA_COMMIT_CONFLICT' ? 'Revisar divergência'
      : busy && record.syncPhase === 'confirming' ? 'Conferir recibo do servidor' : next && data ? 'Foto ' + next.photoIndex
        : data ? 'Conferir recibo do servidor' : 'Confirmar dados no servidor';
  return { phase, action, complete, data, local: photos.filter(photo => local.has(photo.photoIndex)).length, confirmed: confirmed.length, total: target.length };
}

export function syncQueueMarkup(record, options, controls = '') {
  const state = synchronizationQueueState(record, options);
  return '<article class="record-card sync-item"><header class="record-card__header"><div><h3>Ocorrência ' + text(record.occurrenceNumber || 'sem número')
    + '</h3><small>' + text(record.recordId) + '</small></div><span class="status-chip status-chip--' + (state.complete ? 'success' : 'warning') + '">'
    + text(state.phase) + '</span></header><p>' + text(record.base || 'Base sem confirmação') + ' · ' + text(formatDateTime(record.registeredAt || record.createdAt))
    + '</p><dl class="monitor-facts"><div><dt>Dados</dt><dd>' + (state.data || state.complete ? 'Confirmados' : 'A confirmar')
    + '</dd></div><div><dt>Fotos no aparelho</dt><dd>' + state.local + '</dd></div><div><dt>Fotos confirmadas</dt><dd>' + state.confirmed
    + (state.total ? ' de ' + state.total : '') + '</dd></div><div><dt>Última tentativa</dt><dd>'
    + text(record.lastAttemptAt ? formatDateTime(record.lastAttemptAt) : 'Aguardando primeira tentativa') + '</dd></div><div><dt>Próxima ação</dt><dd>'
    + text(state.action) + '</dd></div></dl>' + (record.lastError ? '<p class="sync-feedback">' + text(record.lastError) + '</p>' : '')
    + (controls ? '<footer class="record-card__footer">' + controls + '</footer>' : '') + '</article>';
}
