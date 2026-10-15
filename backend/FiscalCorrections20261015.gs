// Incremental addition to the existing official backend. No migration or bootstrap.
function fiscalCorrectionRoute_(audit) {
  const request = audit && audit.lastCorrectionRequest || {};
  return request.routingVersion === 'FISCAL_ASSIGNED' ? request : null;
}
function fiscalCorrectionCandidates_(base) {
  const accounts = fiscalAccounts_();
  return Object.keys(accounts).map(function (key) { return accounts[key]; }).filter(function (account) {
    return account && account.active === true && account.kind !== 'master' && Array.isArray(account.bases) && account.bases.indexOf(base) >= 0;
  });
}
function newFiscalCorrectionRoute_(request, base) {
  const candidates = fiscalCorrectionCandidates_(base);
  const principals = candidates.filter(function (account) { return (account.correctionBases || []).indexOf(base) >= 0; });
  const selected = candidates.length === 1 ? candidates[0] : principals.length === 1 ? principals[0] : null;
  return Object.assign(request, { routingVersion: 'FISCAL_ASSIGNED', routingRequestId: Utilities.getUuid(), assignmentRevision: Utilities.getUuid(),
    base: base, assignedFiscal: selected ? selected.user : '', assignmentStatus: selected ? 'ASSIGNED' : 'WAITING_ASSIGNMENT',
    assignmentReason: selected ? '' : candidates.length ? 'MULTIPLE_FISCALS_WITHOUT_PRINCIPAL' : 'NO_ACTIVE_FISCAL' });
}
function fiscalCorrectionRecipientValid_(request) {
  if (!request || !request.assignedFiscal) return false;
  return fiscalCorrectionCandidates_(request.base).some(function (account) { return normalize_(account.user) === normalize_(request.assignedFiscal); });
}
function fiscalCorrectionProjection_(audit) {
  const request = fiscalCorrectionRoute_(audit);
  if (!request) return { routingVersion: 'LEGACY_FIELD' };
  const complete = request.assignmentStatus === 'COMPLETE';
  return { routingVersion: request.routingVersion, routingRequestId: request.routingRequestId, assignmentRevision: request.assignmentRevision,
    base: request.base, assignedFiscal: request.assignedFiscal || '', assignmentStatus: complete ? 'COMPLETE' : fiscalCorrectionRecipientValid_(request) ? 'ASSIGNED' : 'WAITING_ASSIGNMENT',
    assignmentReason: !complete && !fiscalCorrectionRecipientValid_(request) ? request.assignmentReason || 'RECIPIENT_UNAVAILABLE' : '', requestedAt: request.requestedAt };
}
function authorizeFiscalCorrection_(auth, values, context, allowComplete) {
  const current = fiscalSession_(auth), audit = safeJson_(values[COL.AUDIT - 1], {}), request = fiscalCorrectionRoute_(audit);
  authorizeDocumentRow_(current, values);
  if (!request || normalize_(request.assignedFiscal) !== normalize_(current.user) || current.bases.indexOf(request.base) < 0 || !fiscalCorrectionRecipientValid_(request)) throw apiError_('FORBIDDEN', 'A correção não está atribuída a este Fiscal. Atualize a lista.');
  if (context && (context.routingRequestId !== request.routingRequestId || context.assignmentRevision !== request.assignmentRevision)) throw apiError_('FISCAL_ASSIGNMENT_CHANGED', 'A atribuição mudou. Seu rascunho foi preservado; atualize a solicitação.');
  const status = operationalStatusFromValues_(values);
  if (status !== STATUS.CORRECTION_REQUESTED && !(allowComplete && status === STATUS.WAITING_SUPERVISOR && request.assignmentStatus === 'COMPLETE')) throw apiError_('CORRECTION_CLOSED', 'A solicitação já foi concluída ou recebeu uma decisão.');
  return request;
}
function authorizeCorrectionWrite_(auth, values, context, allowComplete) {
  if (auth.role === 'fiscal') {
    if (!values || !context) throw apiError_('FORBIDDEN', 'O Fiscal só pode editar uma solicitação atribuída e aberta pelo formulário de correção.');
    return authorizeFiscalCorrection_(auth, values, context, allowComplete);
  }
  if (values) {
    assertOwner_(auth, values[COL.USER - 1]);
    if (fiscalCorrectionRoute_(safeJson_(values[COL.AUDIT - 1], {}))) throw apiError_('FISCAL_CORRECTION_REQUIRED', 'Esta solicitação deve ser corrigida pelo Fiscal responsável.');
  }
  return null;
}
function authorizeCorrectionPhoto_(auth, values, payload) {
  const audit = safeJson_(values[COL.AUDIT - 1], {}), route = fiscalCorrectionRoute_(audit);
  if (auth.role === 'fiscal') {
    authorizeCorrectionWrite_(auth, values, payload.fiscalCorrection, true);
    const receipt = audit.lastCorrectionSubmission;
    const slot = receipt && Object.assign({}, receipt.photoPatch || {}, receipt.evidencePatch || {})[payload.photoIndex];
    if (!receipt || receipt.routingRequestId !== route.routingRequestId || receipt.assignmentRevision !== route.assignmentRevision || !receipt.dataVerifiedAt || !slot || slot.uploadKey !== payload.uploadKey) throw apiError_('CORRECTION_DATA_UNCONFIRMED', 'Confirme primeiro o envio dos campos e das fotos declaradas nesta correção.');
  } else {
    assertOwner_(auth, values[COL.USER - 1]);
    if (!route) return;
    const sync = audit.photoSyncRequest || {}, index = Number(payload.photoIndex);
    const declared = Object.assign({}, audit.lastCorrectionSubmission && audit.lastCorrectionSubmission.photoPatch || {}, audit.lastCorrectionSubmission && audit.lastCorrectionSubmission.evidencePatch || {})[index];
    const previous = (audit.photoSubmissions || {})[index];
    if (!declared && !payload.replace && previous && previous.originalFieldSync === true && previous.uploadKey === payload.uploadKey && values[photoUploadKeyColumn_(index) - 1] === payload.uploadKey && values[photoUrlColumn_(index) - 1] === previous.expectedUrl) return;
    if (declared || payload.replace || values[photoUrlColumn_(index) - 1] || sync.status !== 'OPEN') throw apiError_('FISCAL_CORRECTION_REQUIRED', 'A correção pertence ao Fiscal. O Campo pode apenas sincronizar fotos originais ainda ausentes quando solicitado.');
  }
}
function fiscalCorrectionVerified_(audit, receipt, previousTotal, total) {
  const route = fiscalCorrectionRoute_(audit);
  if (!route || !receipt || receipt.routingRequestId !== route.routingRequestId) return;
  const events = Array.isArray(audit.fiscalCorrections) ? audit.fiscalCorrections.slice() : [];
  if (Number(previousTotal) !== Number(total) && !events.some(function (event) { return event.requestId === receipt.requestId; })) {
    if (!audit.firstFiscalFinancialIntervention) audit.firstFiscalFinancialIntervention = { correctedAt: receipt.dataVerifiedAt, changes: [{ field: 'Total da ocorrência', previousValue: Number(previousTotal), newValue: Number(total) }] };
    events.push({ requestId: receipt.requestId, routingRequestId: route.routingRequestId, fiscal: receipt.actor, correctedAt: receipt.dataVerifiedAt,
      changes: [{ field: 'Total da ocorrência', previousValue: Number(previousTotal), newValue: Number(total) }] });
    audit.fiscalCorrections = events.slice(-30);
  }
}
function listFiscalCorrections_(payload) {
  const auth = requireSession_(payload.token, ['fiscal']);
  const records = dataRows_(sheet_(APP.pendingSheet), COL.WIDTH).filter(function (values) {
    return auth.bases.indexOf(featureBase_(values[COL.BASE - 1])) >= 0 && operationalStatusFromValues_(values) === STATUS.CORRECTION_REQUESTED;
  }).map(function (values) {
    const audit = safeJson_(values[COL.AUDIT - 1], {}), route = fiscalCorrectionProjection_(audit);
    return Object.assign(fiscalRecordSummary_(values), { reason: String(values[COL.REASON - 1] || ''), supervisorNote: String(values[COL.SUPERVISOR_NOTE - 1] || ''),
      fiscalCorrection: route, canCorrect: route.routingVersion === 'FISCAL_ASSIGNED' && route.assignmentStatus === 'ASSIGNED' && normalize_(route.assignedFiscal) === normalize_(auth.user) });
  });
  return { ok: true, success: true, records: records, bases: auth.bases, aclRevision: auth.aclRevision, calculatedAt: nowIso_() };
}
function openFiscalCorrection_(payload) {
  const auth = requireSession_(payload.token, ['fiscal']), id = requireUuid_(payload.recordId);
  const found = uniqueCorrectionRow_(sheet_(APP.pendingSheet), id);
  if (!found) throw apiError_('RECORD_NOT_FOUND', 'Solicitação não encontrada.');
  authorizeFiscalCorrection_(auth, found.values, payload.fiscalCorrection, false);
  const record = recordFromValuesAt_(found.values);
  record.fiscalCorrection = fiscalCorrectionProjection_(record.audit);
  return { ok: true, success: true, record: record, aclRevision: auth.aclRevision };
}
function reassignFiscalCorrection_(payload) {
  requireFiscalMaster_(payload.token);
  const id = requireUuid_(payload.recordId), lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const auth = requireFiscalMaster_(payload.token), pending = sheet_(APP.pendingSheet), found = uniqueCorrectionRow_(pending, id);
    if (!found) throw apiError_('RECORD_NOT_FOUND', 'Solicitação não encontrada.');
    const audit = safeJson_(found.values[COL.AUDIT - 1], {}), route = fiscalCorrectionRoute_(audit);
    if (!route || operationalStatusFromValues_(found.values) !== STATUS.CORRECTION_REQUESTED || route.assignmentStatus === 'COMPLETE') throw apiError_('CORRECTION_CLOSED', 'Somente solicitações novas e abertas podem ser atribuídas.');
    if (route.routingRequestId !== payload.routingRequestId || route.assignmentRevision !== payload.expectedRevision) throw apiError_('FISCAL_ASSIGNMENT_CHANGED', 'A atribuição mudou. Atualize a lista.');
    const selected = fiscalCorrectionCandidates_(route.base).filter(function (account) { return normalize_(account.user) === normalize_(payload.assignedFiscal); })[0];
    if (!selected) throw apiError_('INVALID_FISCAL_ASSIGNMENT', 'Selecione um Fiscal ativo e autorizado para esta Base.');
    if (route.assignedFiscal === selected.user && route.assignmentStatus === 'ASSIGNED') return { ok: true, success: true, recordId: id, idempotent: true, fiscalCorrection: fiscalCorrectionProjection_(audit) };
    const previous = route.assignedFiscal || '', receipt = audit.lastCorrectionSubmission;
    // Confirmed fields/photos remain in the row. Preserve unfinished intent and
    // require remaining declared evidence again under the new assignment.
    if (receipt && receipt.requestedAt === correctionRequestedAt_(audit) && receipt.phase !== 'COMPLETE') {
      const remaining = Object.keys(Object.assign({}, receipt.photoPatch || {}, receipt.evidencePatch || {})).map(Number).filter(function (index) {
        const slot = Object.assign({}, receipt.photoPatch || {}, receipt.evidencePatch || {})[index];
        return !found.values[photoUrlColumn_(index) - 1] || found.values[photoUploadKeyColumn_(index) - 1] !== slot.uploadKey;
      });
      audit.requestedPhotoIndexes = normalizePhotoIndexes_((audit.requestedPhotoIndexes || []).concat(remaining));
      audit.transferredCorrectionSubmissions = (audit.transferredCorrectionSubmissions || []).concat([receipt]).slice(-10);
      delete audit.lastCorrectionSubmission;
    }
    route.assignedFiscal = selected.user; route.assignmentRevision = Utilities.getUuid(); route.assignmentStatus = 'ASSIGNED'; route.assignmentReason = '';
    route.reassignedAt = nowIso_(); route.reassignedBy = auth.user;
    appendAuditTimeline_(audit, 'CORRECAO_FISCAL_ATRIBUIDA', auth.user, route.reassignedAt, (previous || 'Sem responsável') + ' → ' + selected.user);
    const confirmed = writeCorrectionAudit_(pending, found, audit);
    appendHistory_(recordFromValuesAt_(confirmed.values), auth.user, 'CORRECAO_FISCAL_ATRIBUIDA', STATUS.CORRECTION_REQUESTED, STATUS.CORRECTION_REQUESTED, '', (previous || 'Sem responsável') + ' → ' + selected.user);
    return { ok: true, success: true, recordId: id, fiscalCorrection: fiscalCorrectionProjection_(audit) };
  } finally { lock.releaseLock(); }
}
function fiscalSummaryScope_(auth, rows, history) {
  const originals = {};
  history.forEach(function (event) { if (String(event[3]) === 'CRIADA' && !originals[String(event[0])]) originals[String(event[0])] = { base: event[11], team: event[9], crewLeader: event[12] }; });
  const allowed = rows.filter(function (row) {
    return auth.bases.indexOf(featureBase_(row[COL.BASE - 1])) >= 0 && auth.bases.indexOf(featureIdentity_(row, originals[String(row[COL.ID - 1])]).base) >= 0;
  });
  const ids = {}; allowed.forEach(function (row) { ids[String(row[COL.ID - 1])] = true; });
  return { rows: allowed, history: history.filter(function (event) { return ids[String(event[0])]; }) };
}
