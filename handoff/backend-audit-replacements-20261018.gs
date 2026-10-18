// HANDOFF: replace these EXISTING functions in ApprovalIntegrity20260911.gs.
// Do NOT install as an additive file: duplicate Apps Script function declarations
// would make selection ambiguous. No private configuration is included.

function fiscalCorrectionCandidates_(base, snapshot) {
  const accounts = snapshot || fiscalAccounts_();
  return Object.keys(accounts).map(function (key) { return accounts[key]; }).filter(function (account) {
    return account && account.active === true && account.kind !== 'master' && Array.isArray(account.bases) && account.bases.indexOf(base) >= 0;
  });
}

function fiscalCorrectionRecipientValid_(request, accounts) {
  if (!request || !request.assignedFiscal) return false;
  return fiscalCorrectionCandidates_(request.base, accounts).some(function (account) { return normalize_(account.user) === normalize_(request.assignedFiscal); });
}

function fiscalCorrectionProjection_(audit, accounts) {
  const request = fiscalCorrectionRoute_(audit);
  if (!request) return { routingVersion: 'LEGACY_FIELD' };
  const complete = request.assignmentStatus === 'COMPLETE';
  const recipientValid = complete || fiscalCorrectionRecipientValid_(request, accounts);
  return { routingVersion: request.routingVersion, routingRequestId: request.routingRequestId, assignmentRevision: request.assignmentRevision,
    base: request.base, assignedFiscal: request.assignedFiscal || '', assignmentStatus: complete ? 'COMPLETE' : recipientValid ? 'ASSIGNED' : 'WAITING_ASSIGNMENT',
    assignmentReason: !recipientValid ? request.assignmentReason || 'RECIPIENT_UNAVAILABLE' : '', requestedAt: request.requestedAt };
}

function listFiscalCorrections_(payload) {
  const auth = requireSession_(payload.token, ['fiscal']), accounts = fiscalAccounts_();
  const records = dataRows_(sheet_(APP.pendingSheet), COL.WIDTH).filter(function (values) {
    return auth.bases.indexOf(featureBase_(values[COL.BASE - 1])) >= 0 && operationalStatusFromValues_(values) === STATUS.CORRECTION_REQUESTED;
  }).map(function (values) {
    const audit = safeJson_(values[COL.AUDIT - 1], {}), route = fiscalCorrectionProjection_(audit, accounts);
    return Object.assign(fiscalRecordSummary_(values), { reason: String(values[COL.REASON - 1] || ''), supervisorNote: String(values[COL.SUPERVISOR_NOTE - 1] || ''),
      fiscalCorrection: route, canCorrect: route.routingVersion === 'FISCAL_ASSIGNED' && route.assignmentStatus === 'ASSIGNED' && normalize_(route.assignedFiscal) === normalize_(auth.user) });
  });
  const current = requireSession_(payload.token, ['fiscal']);
  return { ok: true, success: true, records: records, bases: current.bases, aclRevision: current.aclRevision, calculatedAt: nowIso_() };
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
        return !photoSlotConfirmed_(found.values, audit, index) || found.values[photoUploadKeyColumn_(index) - 1] !== slot.uploadKey;
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

function listFiscalRecords_(payload) {
  const auth = requireSession_(payload.token, ['fiscal']); const bases = auth.bases;
  const filters = payload.filters || {}, base = filters.base ? featureBase_(filters.base) : '';
  if (filters.base && (!base || bases.indexOf(base) < 0)) throw apiError_('FORBIDDEN', 'Base não autorizada.');
  const from = filters.from ? featureDateInput_(filters.from) : '', to = filters.to ? featureDateInput_(filters.to) : '';
  if (from && to && from > to) throw apiError_('INVALID_DATE_RANGE', 'Período inválido.');
  const month = todayOperational_().slice(0, 7), period = filters.period === 'all' ? 'all' : filters.period === 'custom' ? 'custom' : 'month';
  const rows = featureRows_(spreadsheet_()).filter(function (row) { return bases.indexOf(featureBase_(row[COL.BASE - 1])) >= 0; });
  const records = rows.filter(function (row) {
    if (!String(row[COL.REGISTERED_AT - 1] || '') || String(row[COL.STATUS - 1]) === 'RASCUNHO') return false;
    const date = featureDate_(row[COL.REGISTERED_AT - 1]);
    return (!base || featureBase_(row[COL.BASE - 1]) === base) && (!filters.team || normalize_(row[COL.TEAM - 1]) === normalize_(filters.team))
      && (!filters.crewLeader || normalize_(row[COL.CREW_LEADER - 1]) === normalize_(filters.crewLeader))
      && (!filters.status || operationalStatusFromValues_(row) === filters.status)
      && (period !== 'month' || date.slice(0, 7) === month) && (!from || date >= from) && (!to || date <= to)
      && (!filters.search || normalize_(String(row[COL.OCCURRENCE_NUMBER - 1]) + ' ' + String(row[COL.ID - 1])).indexOf(normalize_(cleanText_(filters.search, 120))) >= 0);
  });
  const summary = { total: records.length, waiting: 0, published: 0, correction: 0, rejected: 0, photoPending: 0, eligibleValue: 0 };
  records.forEach(function (row) {
    const status = operationalStatusFromValues_(row);
    if (status === STATUS.WAITING_SUPERVISOR) summary.waiting++;
    if ([STATUS.PUBLISHED, STATUS.APPROVED].indexOf(status) >= 0) summary.published++;
    if (status === STATUS.CORRECTION_REQUESTED) summary.correction++;
    if (status === STATUS.REJECTED) summary.rejected++;
    if (status === STATUS.SYNCING_PHOTOS) summary.photoPending++;
    if (featureEligible_(row)) summary.eligibleValue = roundMoney_(summary.eligibleValue + (Number(row[COL.TOTAL - 1]) || 0));
  });
  records.sort(function (a, b) { return String(b[COL.REGISTERED_AT - 1]).localeCompare(String(a[COL.REGISTERED_AT - 1])) || String(a[0]).localeCompare(String(b[0])); });
  const offset = Math.max(0, Math.floor(Number(payload.offset) || 0)), limit = 60;
  requireSession_(payload.token, ['fiscal']);
  return { ok: true, success: true, bases: bases, summary: summary, records: records.slice(offset, offset + limit).map(fiscalRecordSummary_), offset: offset, nextOffset: offset + limit < records.length ? offset + limit : null, calculatedAt: nowIso_() };
}

function getOccurrenceDocument_(payload) {
  const auth = requireSession_(payload.token, ['field', 'supervisor', 'fiscal']), id = requireUuid_(payload.recordId);
  const found = findAcrossMainSheets_(id); if (!found) throw apiError_(auth.role === 'fiscal' ? 'FORBIDDEN' : 'RECORD_NOT_FOUND', auth.role === 'fiscal' ? 'Ocorrência não disponível nas Bases autorizadas.' : 'Ocorrência não encontrada.');
  authorizeDocumentRow_(auth, found.values);
  const status = operationalStatusFromValues_(found.values);
  if (auth.role !== 'fiscal' && !payload.detail && [STATUS.WAITING_SUPERVISOR, STATUS.PUBLISHED, STATUS.APPROVED].indexOf(status) < 0) throw apiError_('RECORD_NOT_READY', 'PDF disponível nas ocorrências aguardando conferência ou publicadas.');
  const record = occurrenceDocumentData_(found.values, spreadsheet_());
  authorizeDocumentRow_(requireSession_(payload.token, ['field', 'supervisor', 'fiscal']), found.values);
  return { ok: true, success: true, record: record };
}
