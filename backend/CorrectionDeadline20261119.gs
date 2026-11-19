// Additive policy: correction state stays in the existing request/receipt audit.
const BQ_DEADLINE = Object.freeze({ hours: 72, warning: 24, timeZone: 'America/Fortaleza',
  expired: 'FORA_DO_PRAZO_DE_CORRECAO', replaced: 'SUBSTITUIDA_POR_NOVO_LANCAMENTO',
  message: 'Prazo de correção encerrado. Esta ocorrência ultrapassou o limite de 3 dias. Será necessário realizar um novo lançamento.' });
const BQ_REMOVAL_PROPERTY = 'BQ_REMOVED_RECORDS_20261119';
let BQ_REMOVED_CACHE_ = null;
function bqRemovedIds_() {
  if (BQ_REMOVED_CACHE_) return BQ_REMOVED_CACHE_;
  const saved = safeJson_(PropertiesService.getScriptProperties().getProperty(BQ_REMOVAL_PROPERTY) || '[]', []);
  if (!Array.isArray(saved)) throw apiError_('REMOVAL_POLICY_INVALID', 'Não foi possível conferir os registros removidos.');
  BQ_REMOVED_CACHE_ = saved;
  return saved;
}
function bqIsRemoved_(id) { return bqRemovedIds_().indexOf(String(id || '')) >= 0; }
function bqAssertNotRemoved_(id) {
  if (bqIsRemoved_(id)) throw apiError_('RECORD_REMOVED', 'Este registro foi excluído pelo proprietário e não pode ser recriado.', { recordId: String(id) });
}
function bqDeadline_(values, clock) {
  const audit = safeJson_(values[COL.AUDIT - 1], {}), request = audit.lastCorrectionRequest;
  const rawStatus = String(values[COL.STATUS - 1] || '');
  if (!request) return null;
  // Only a formal server audit proves the start. Never infer it from browser dates,
  // lastUpdated, a photograph-sync request, or a later review.
  const start = Date.parse(request.requestedAt);
  if (!Number.isFinite(start) || !request.supervisor || !(request.reason || request.note)) return { status: 'DATA_NAO_COMPROVADA', requestedAt: '', dueAt: '', open: rawStatus === STATUS.CORRECTION_REQUESTED };
  const now = clock == null ? Date.now() : clock, due = start + BQ_DEADLINE.hours * 3600000;
  const receipt = audit.lastCorrectionSubmission;
  const complete = receipt && receipt.requestedAt === correctionRequestedAt_(audit) && receipt.phase === 'COMPLETE';
  const replaced = request.replacementRecordId || rawStatus === BQ_DEADLINE.replaced;
  const open = !complete && !replaced && operationalStatusFromValues_(values) === STATUS.CORRECTION_REQUESTED;
  const status = replaced ? BQ_DEADLINE.replaced : complete ? request.deadlineSchema === 1 ? 'CORRIGIDA_DENTRO_DO_PRAZO' : 'CORRIGIDA_ANTERIORMENTE'
    : !open ? 'ENCERRADA' : now >= due ? BQ_DEADLINE.expired : due - now <= BQ_DEADLINE.warning * 3600000 ? 'PRAZO_PROXIMO_DO_VENCIMENTO' : 'AGUARDANDO_CORRECAO';
  return { schema: 1, status: status, open: open, roundId: request.routingRequestId || request.requestedAt,
    requestedAt: new Date(start).toISOString(), dueAt: new Date(due).toISOString(), serverNow: new Date(now).toISOString(),
    responsible: request.routingVersion === 'FISCAL_ASSIGNED' ? request.assignedFiscal || '' : String(values[COL.USER - 1] || ''),
    correctedAt: request.validCorrectionReceivedAt || (complete ? receipt.completedAt || '' : ''),
    replacementRecordId: request.replacementRecordId || '', elapsedMs: Math.max(0, now - start), remainingMs: Math.max(0, due - now) };
}
function bqPersistExpired_(values) {
  const deadline = bqDeadline_(values);
  if (!deadline || deadline.status !== BQ_DEADLINE.expired) return;
  const audit = safeJson_(values[COL.AUDIT - 1], {}), request = audit.lastCorrectionRequest;
  if (request.deadlineStatus === BQ_DEADLINE.expired) return;
  request.deadlineStatus = BQ_DEADLINE.expired; request.dueAt = deadline.dueAt;
  appendAuditTimeline_(audit, BQ_DEADLINE.expired, 'SERVIDOR', deadline.dueAt, 'Limite de 72 horas corridas encerrado');
  const found = uniqueCorrectionRow_(sheet_(APP.pendingSheet), String(values[COL.ID - 1]));
  if (!found) return;
  // Caller holds the script lock. Change only audit; keep operational data/photos.
  writeCorrectionAudit_(sheet_(APP.pendingSheet), found, audit);
  values[COL.AUDIT - 1] = correctionAuditJson_(audit);
}
function bqValidCorrectionReceivedAt_(values, requestId) {
  const audit = safeJson_(values[COL.AUDIT - 1], {}), receipt = audit.lastCorrectionSubmission;
  if (!receipt || receipt.requestId !== requestId || receipt.requestedAt !== correctionRequestedAt_(audit)
    || !receipt.dataVerifiedAt || !correctionReceiptHasChanges_(values, receipt, true)
    || correctionFingerprint_(correctionDataFromValues_(values)) !== receipt.expectedFingerprint
    || normalizePhotoIndexes_(audit.requestedPhotoIndexes).length || !recordReadyForSupervisorValues_(values)) return null;
  const times = [Date.parse(receipt.dataVerifiedAt)];
  Object.keys(Object.assign({}, receipt.photoPatch || {}, receipt.evidencePatch || {})).forEach(function (slot) {
    const photo = (audit.photoSubmissions || {})[slot];
    times.push(photo && photo.phase === 'COMPLETE' ? Date.parse(photo.verifiedAt) : NaN);
  });
  return times.every(Number.isFinite) ? Math.max.apply(null, times) : null;
}
function bqAssertDeadline_(values, retryId) {
  if (!values) return;
  const deadline = bqDeadline_(values);
  if (!deadline || !deadline.open || deadline.status !== BQ_DEADLINE.expired) return;
  // A lost response may be reconciled only from already validated server receipts.
  const received = retryId && bqValidCorrectionReceivedAt_(values, retryId);
  if (received != null && received !== false && received < Date.parse(deadline.dueAt)) return;
  bqPersistExpired_(values);
  throw apiError_('CORRECTION_DEADLINE_EXPIRED', BQ_DEADLINE.message, { recordId: String(values[COL.ID - 1]), correctionDeadline: deadline });
}
function bqRefreshDeadlines_() {
  const lock = LockService.getScriptLock();
  if (typeof lock.tryLock === 'function') { if (!lock.tryLock(1000)) return; } else lock.waitLock(1000);
  try { dataRows_(sheet_(APP.pendingSheet), COL.WIDTH).forEach(bqPersistExpired_); }
  finally { lock.releaseLock(); }
}
function bqStartDeadline_(request, audit) {
  request.deadlineSchema = 1; request.deadlineStatus = 'AGUARDANDO_CORRECAO';
  request.dueAt = new Date(Date.parse(request.requestedAt) + 72 * 3600000).toISOString();
  request.round = Math.max(Number(audit.lastCorrectionRequest?.round) || 0, Array.isArray(audit.correctionRequests) ? audit.correctionRequests.length : 0) + 1;
  return request;
}
function bqReplacementOriginal_(auth, submitted, model) {
  if (!submitted.replacementOf) return null;
  if (auth.role !== 'field') throw apiError_('FORBIDDEN', 'Utilize o fluxo operacional para realizar o novo lançamento.');
  const id = requireUuid_(submitted.replacementOf); bqAssertNotRemoved_(id);
  const found = uniqueCorrectionRow_(sheet_(APP.pendingSheet), id);
  if (!found) throw apiError_('RECORD_NOT_FOUND', 'Ocorrência anterior não encontrada.');
  assertOwner_(auth, found.values[COL.USER - 1]);
  const deadline = bqDeadline_(found.values);
  if (!deadline || ![BQ_DEADLINE.expired, BQ_DEADLINE.replaced].includes(deadline.status)) throw apiError_('REPLACEMENT_NOT_ALLOWED', 'O novo lançamento relacionado exige uma ocorrência anterior fora do prazo.');
  if (deadline.replacementRecordId && deadline.replacementRecordId !== model.recordId) throw apiError_('REPLACEMENT_EXISTS', 'Esta ocorrência já possui um novo lançamento relacionado.');
  if (id === model.recordId || normalize_(model.occurrenceNumber).replace(/[^a-z0-9]/gi, '') === normalize_(found.values[COL.OCCURRENCE_NUMBER - 1]).replace(/[^a-z0-9]/gi, '')) throw apiError_('REPLACEMENT_IDENTITY_REQUIRED', 'Informe um novo número de ocorrência. O identificador também deve ser próprio.');
  return found;
}
function bqLinkReplacement_(auth, original, createdId) {
  if (!original) return;
  const audit = safeJson_(original.values[COL.AUDIT - 1], {}), request = audit.lastCorrectionRequest;
  if (request.replacementRecordId === createdId) return;
  request.replacementRecordId = createdId; request.replacedAt = nowIso_(); request.deadlineStatus = BQ_DEADLINE.replaced;
  appendAuditTimeline_(audit, BQ_DEADLINE.replaced, auth.user, request.replacedAt, createdId);
  const next = original.values.slice(); next[COL.AUDIT - 1] = correctionAuditJson_(audit); next[COL.STATUS - 1] = BQ_DEADLINE.replaced;
  writeAndReadCorrection_(sheet_(APP.pendingSheet), original.row, next);
}
function bqAssertPhotoDeadline_(values, payload) {
  const deadline = bqDeadline_(values);
  if (!deadline || deadline.status !== BQ_DEADLINE.expired) return;
  const audit = safeJson_(values[COL.AUDIT - 1], {}), receipt = audit.lastCorrectionSubmission;
  const sameConfirmedSlot = String(values[photoUploadKeyColumn_(Number(payload.photoIndex)) - 1]) === payload.uploadKey
    && photoSlotConfirmed_(values, audit, Number(payload.photoIndex));
  // Reconcile a known slot; never admit new bytes using another slot's receipt.
  bqAssertDeadline_(values, sameConfirmedSlot && receipt && receipt.requestId);
}
