// Editor-only recovery helper. No doGet/doPost route. Not included in the deployment.
// Requires a UUID-specific owner instruction and a saved backup. The operator's
// identity MUST first be verified in the authenticated Google project editor;
// pass that observed identity separately, never from an application's HTTP payload.
// A lossy encoding match alone is NEVER identity evidence.
function reconcileRecordIdentityUtf820261106_(spec, authenticatedEditor) {
  const owner = String(authenticatedEditor || '').toLowerCase();
  if (!spec || !owner || owner !== spec.authorizedOwner) throw new Error('IDENTITY_OWNER_AUTH_REQUIRED');
  if (spec.projectId !== '1S65w-vU8SNGI3XsrWjZl609yEu4uQRhRrnQrlnI1bSWg1Gyy_xvup94z' || APP.spreadsheetId !== spec.spreadsheetId) throw new Error('IDENTITY_PROJECT_MISMATCH');
  requireUuid_(spec.recordId);
  if (!spec.reconciliationId || !spec.expectedRowSha256 || !spec.identityEvidence || !spec.backupReference
    || !spec.previousUser || !spec.previousUser.includes('?') || !spec.user || spec.user.includes('?') || spec.user === spec.previousUser) throw new Error('IDENTITY_EVIDENCE_REQUIRED');
  const reproduced = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(Utilities.base64EncodeWebSafe(JSON.stringify({ user: spec.user })))).getDataAsString('UTF-8')).user;
  if (reproduced !== spec.previousUser) throw new Error('IDENTITY_DEFECT_MISMATCH');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const matches = [APP.pendingSheet, APP.officialSheet].flatMap(function(name) {
      return publicationRowsForId_(sheet_(name), spec.recordId, COL.WIDTH).map(function(row) { return { name: name, row: row.row, values: row.values }; });
    });
    if (matches.length !== 1 || matches[0].name !== spec.sheetName) throw new Error('IDENTITY_RECORD_NOT_UNIQUE');
    const found = matches[0], before = found.values, audit = safeJson_(before[COL.AUDIT - 1], null);
    if (!audit || typeof audit !== 'object' || Array.isArray(audit)) throw new Error('IDENTITY_INVALID_AUDIT');
    const prior = (audit.identityReconciliations || []).find(function(item) { return item.reconciliationId === spec.reconciliationId; });
    const historyNote = spec.reconciliationId + ': representação UTF-8 reconciliada; dados operacionais e histórico anterior preservados.';
    const appendHistory = function() {
      const exists = publicationRowsForId_(sheet_(APP.historySheet), spec.recordId, HISTORY_HEADERS.length).some(function(item) {
        return item.values[3] === 'IDENTIDADE_UTF8_RECONCILIADA' && item.values[7] === historyNote;
      });
      if (!exists) appendHistory_({ recordId: spec.recordId, occurrenceNumber: before[COL.OCCURRENCE_NUMBER - 1], team: before[COL.TEAM - 1],
        occurrenceTypes: String(before[COL.TYPES - 1]).split(' | '), base: before[COL.BASE - 1], crewLeader: before[COL.CREW_LEADER - 1],
        pgPostRemoved: before[COL.PG_POST_REMOVED - 1], pgPostInstalled: before[COL.PG_POST_INSTALLED - 1],
        pgConductorStart: before[COL.PG_CONDUCTOR_START - 1], pgConductorEnd: before[COL.PG_CONDUCTOR_END - 1],
        transformerPhotos: { removed: before[COL.TRAFO_REMOVED_PHOTO - 1], installed: before[COL.TRAFO_INSTALLED_PHOTO - 1] } },
      owner, 'IDENTIDADE_UTF8_RECONCILIADA', before[COL.STATUS - 1], before[COL.STATUS - 1], 'CORRECAO_REPRESENTACAO_UTF8', historyNote);
    };
    if (prior) {
      if (before[COL.USER - 1] !== spec.user || prior.previousUser !== spec.previousUser || prior.user !== spec.user) throw new Error('IDENTITY_RETRY_CONFLICT');
      appendHistory(); return { ok: true, alreadyApplied: true, recordId: spec.recordId, user: spec.user };
    }
    if (before[COL.USER - 1] !== spec.previousUser || sha256_(JSON.stringify(before)) !== spec.expectedRowSha256) throw new Error('IDENTITY_SOURCE_CHANGED');
    if (sheet_(found.name).getRange(found.row, 1, 1, COL.WIDTH).getFormulas()[0].some(Boolean)) throw new Error('IDENTITY_FORMULA_GUARD');
    const at = nowIso_(), next = before.slice();
    const entry = { reconciliationId: spec.reconciliationId, recordId: spec.recordId, previousUser: spec.previousUser, user: spec.user,
      actor: owner, at: at, evidence: spec.identityEvidence, beforeSha256: spec.expectedRowSha256, backupReference: spec.backupReference };
    audit.identityReconciliations = (audit.identityReconciliations || []).concat([entry]);
    // Preserve historical actors and timestamps. Only a current routing recipient is repaired.
    if (audit.photoSyncRequest && audit.photoSyncRequest.recipient === spec.previousUser) audit.photoSyncRequest.recipient = spec.user;
    audit.timeline = (audit.timeline || []).concat([{ action: 'IDENTIDADE_UTF8_RECONCILIADA', actor: owner, at: at, detail: spec.reconciliationId }]);
    next[COL.USER - 1] = spec.user; next[COL.AUDIT - 1] = JSON.stringify(audit);
    // Existing row has been checked for formulas before running this helper.
    sheet_(found.name).getRange(found.row, 1, 1, COL.WIDTH).setValues([next]); flushSheets_();
    const readback = sheet_(found.name).getRange(found.row, 1, 1, COL.WIDTH).getValues()[0];
    if (JSON.stringify(readback) !== JSON.stringify(next)) throw new Error('IDENTITY_WRITE_UNCONFIRMED');
    for (let index = 0; index < COL.WIDTH; index++) if (index !== COL.USER - 1 && index !== COL.AUDIT - 1 && JSON.stringify(before[index]) !== JSON.stringify(readback[index])) throw new Error('IDENTITY_OPERATIONAL_CHANGE');
    appendHistory();
    return { ok: true, alreadyApplied: false, recordId: spec.recordId, user: spec.user, changedColumns: [COL.USER, COL.AUDIT],
      status: readback[COL.STATUS - 1], beforeSha256: spec.expectedRowSha256, afterSha256: sha256_(JSON.stringify(readback)) };
  } finally { lock.releaseLock(); }
}
