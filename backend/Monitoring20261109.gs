// Install in the existing Apps Script project. All helpers stay private.
const BQ_MONITOR = Object.freeze({
  sheet: 'MONITORAMENTO_OCORRENCIAS',
  property: 'BQ_MONITOR_LEDGER_V1',
  version: 1,
  clientSchema: 1,
  legacyContract: 'OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12',
  errorLimit: 180,
  presenceTtl: 1800,
  mutations: ['submitRecord', 'uploadPhoto', 'supervisorCorrectRecord', 'supervisorAction',
    'requestPhotoSyncBatch', 'approveBatch', 'saveFiscalAccount', 'changeFiscalMasterPassword', 'reassignFiscalCorrection'],
  errorModules: {
    login: 'Login', submitRecord: 'Salvamento / correção', uploadPhoto: 'Fotos', getRecordState: 'Sincronização',
    openFiscalCorrection: 'Correções', listFiscalCorrections: 'Correções', reassignFiscalCorrection: 'Correções',
    supervisorCorrectRecord: 'Correções', supervisorAction: 'Decisão / publicação', approveBatch: 'Aprovação / publicação',
    requestPhotoSyncBatch: 'Sincronização', verifyPublishedIntegrity: 'Publicação', getOccurrenceDocument: 'PDF / consulta',
    getDocumentPhoto: 'Fotos / PDF', pdf: 'PDF', excel: 'Excel', localSync: 'Sincronização',
    listMine: 'API', listPending: 'API', listPublishedRecords: 'API', listFiscalRecords: 'API', searchCatalog: 'API',
    getOperationalSummary: 'API', getTeamDirectory: 'API', getDailyTeamProduction: 'API',
    saveFiscalAccount: 'Permissões', changeFiscalMasterPassword: 'Permissões', listFiscalAccounts: 'Permissões', health: 'API'
  }
});

function bqCompatibility_() {
  return { schema: 1, acceptedContracts: [APP.contract], localSchemas: [BQ_MONITOR.clientSchema],
    operationContracts: {}, monitoring: BQ_MONITOR.version };
}

function bqCheckContract_(action, payload, policy) {
  const integrityRepair = action === 'verifyPublishedIntegrity' && payload.repair === true;
  if (!integrityRepair && !BQ_MONITOR.mutations.includes(action)) return;
  const compatibility = policy || bqCompatibility_();
  const accepted = compatibility.operationContracts[action] || compatibility.acceptedContracts;
  const contract = payload.clientContract == null ? BQ_MONITOR.legacyContract : payload.clientContract;
  if (!accepted.includes(contract)) throw apiError_('CLIENT_UPDATE_REQUIRED', 'Atualize o aplicativo antes desta operação.');
  if (payload.clientSchema != null && !compatibility.localSchemas.includes(payload.clientSchema)) {
    throw apiError_('CLIENT_UPDATE_REQUIRED', 'O esquema local desta operação não é compatível.');
  }
}

function bqLiteralRow_(row) {
  // Sheets treats a leading equals sign as a formula and a leading
  // apostrophe as its text escape. Preserve both as literal user data.
  return row.map(function (value) { return typeof value === 'string' && /^[=']/.test(value) ? "'" + value : value; });
}

function bqUuid_(value) {
  const id = String(value || '').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : '';
}

function bqVersion_(value) {
  return /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/.test(String(value || '')) ? String(value) : '';
}

function bqMonitorSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(BQ_MONITOR.property);
  if (!id || id === APP.spreadsheetId) return null;
  return SpreadsheetApp.openById(id).getSheetByName(BQ_MONITOR.sheet);
}

// The operational workbook can be shared. Keep access, errors and new evidence
// in a different, owner-only file created from the existing script's editor.
function instalarMonitoramentoBQ() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties(), existing = properties.getProperty(BQ_MONITOR.property);
    if (existing === APP.spreadsheetId) throw Error('O armazenamento técnico deve ser separado da planilha operacional.');
    const ss = existing ? SpreadsheetApp.openById(existing) : SpreadsheetApp.create('Ocorrências B&Q — Monitoramento privado', 1000, 2);
    const file = DriveApp.getFileById(ss.getId()), owner = file.getOwner()?.getEmail();
    const shared = file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
      [...file.getEditors(), ...file.getViewers()].some(user => user.getEmail() !== owner);
    if (!owner || shared) throw Error('O arquivo de monitoramento deve ter acesso restrito ao proprietário.');
    const sheet = existing ? ss.getSheetByName(BQ_MONITOR.sheet) : ss.getSheets()[0].setName(BQ_MONITOR.sheet);
    if (!sheet) throw Error('Aba de monitoramento ausente.');
    if (!existing) sheet.getRange(1, 1, 1, 2).setValues([['UUID', 'EVENTO_JSON_V1']]);
    if (sheet.getRange(1, 1, 1, 2).getValues()[0].join('|') !== 'UUID|EVENTO_JSON_V1') throw Error('Cabeçalho de monitoramento divergente.');
    if (!existing) properties.setProperty(BQ_MONITOR.property, ss.getId());
    const result = { ok: true, schema: 1, storageId: ss.getId(), private: true, historicalRecordWrites: 0 };
    console.info(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}

function bqAppendEvent_(event) {
  try {
    const sheet = bqMonitorSheet_();
    if (!sheet) return false;
    const envelope = Object.assign({ at: nowIso_(), backendVersion: APP.version }, event);
    let json = JSON.stringify(envelope);
    if (json.length > 45000) {
      delete envelope.cycle; delete envelope.changes; envelope.evidenceLimited = true;
      json = JSON.stringify(envelope);
    }
    sheet.appendRow([bqUuid_(event.recordId), json]);
    return true;
  } catch (failure) {
    console.warn('[Monitoramento] Não foi possível registrar o evento.');
    return false;
  }
}

function bqRecentEvents_(scan, before) {
  const sheet = bqMonitorSheet_();
  if (!sheet) return { items: [], next: null, available: false };
  const end = Math.min(sheet.getLastRow(), Number.isInteger(before) && before >= 2 ? before : Infinity);
  const start = Math.max(2, end - scan + 1);
  const items = end < start ? [] : sheet.getRange(start, 2, end - start + 1, 1).getValues().reverse()
    .map(function (row, index) { return { row: end - index, event: safeJson_(row[0], null) }; })
    .filter(function (item) { return item.event && typeof item.event.kind === 'string'; });
  return { items: items, next: start > 2 ? start - 1 : null, available: true };
}

function bqMonitorSession_(auth) {
  return sha256_('bq-monitor-v1:' + String(auth.nonce || '')).slice(0, 32);
}

function bqFiscalLogin_(result, payload) {
  const auth = verifyToken_(result.token);
  if (!auth || !auth.nonce) return;
  bqAppendEvent_({ kind: 'ACESSO', type: 'LOGIN_CONFIRMADO', sessionId: bqMonitorSession_(auth),
    accountId: fiscalAccountKey_(result.user), user: result.user, role: 'fiscal', bases: result.bases,
    revision: result.aclRevision, expiresAt: result.expiresAt, frontendVersion: bqVersion_(payload.clientVersion) });
}

function bqPresenceKey_(id) { return 'bq-presence-' + id.slice(0, 1); }

function bqPresence_(payload, ending) {
  const auth = requireSession_(payload.token, ['field', 'fiscal']);
  if (!auth.nonce) return { ok: true, available: false };
  const id = bqMonitorSession_(auth), cache = CacheService.getScriptCache(), key = bqPresenceKey_(id);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25)) return { ok: true, available: false };
  try {
    const entries = safeJson_(cache.get(key), {});
    const existing = entries[id];
    if (existing && existing.ended) return { ok: true, available: true };
    const now = Date.now();
    const base = featureBase_(payload.base);
    const fiscal = auth.role === 'fiscal';
    const entry = { sessionId: id, user: auth.user, role: auth.role, accountId: fiscal ? fiscalAccountKey_(auth.user) : '',
      revision: fiscal ? auth.aclRevision : '', base: fiscal ? (auth.bases.includes(base) ? base : '') : base,
      bases: fiscal ? auth.bases : [], team: fiscal ? '' : cleanText_(payload.team, 80),
      at: now, expires: Number(auth.exp), ended: Boolean(ending) };
    // Reuse the cache as an expiring directory, partitioned so its entries stay small.
    entries[id] = entry;
    const current = Object.keys(entries).filter(function (item) { return now - entries[item].at < BQ_MONITOR.presenceTtl * 1000; })
      .sort(function (a, b) { return entries[b].at - entries[a].at; }).slice(0, 32);
    const bounded = {};
    current.forEach(function (item) { bounded[item] = entries[item]; });
    if (ending && fiscal && !bqAppendEvent_({ kind: 'ACESSO', type: 'LOGOUT_CONFIRMADO', sessionId: id,
      accountId: entry.accountId, user: entry.user, role: entry.role, bases: entry.bases, revision: entry.revision,
      expiresAt: new Date(entry.expires).toISOString(), frontendVersion: bqVersion_(payload.clientVersion) })) {
      return { ok: true, available: false };
    }
    cache.put(key, JSON.stringify(bounded), BQ_MONITOR.presenceTtl);
    return { ok: true, available: true };
  } finally { lock.releaseLock(); }
}

function bqOnline_(accounts) {
  const keys = Array.from('0123456789abcdef', function (char) { return 'bq-presence-' + char; });
  const all = CacheService.getScriptCache().getAll(keys);
  const now = Date.now();
  return keys.flatMap(function (key) {
    return Object.values(safeJson_(all[key], {})).filter(function (entry) {
      return now - entry.at < BQ_MONITOR.presenceTtl * 1000;
    }).map(function (entry) {
      const account = entry.role === 'fiscal' && accounts[entry.accountId];
      const ended = entry.ended || entry.expires <= now || entry.role === 'fiscal' && (!account || !account.active || account.revision !== entry.revision);
      const state = ended || now - entry.at >= 900000 ? 'DESCONECTADO' : now - entry.at >= 300000 ? 'INATIVO' : 'ONLINE';
      return { sessionId: entry.sessionId, user: entry.user, role: entry.role, base: entry.base, bases: entry.bases,
        team: entry.team, state: state, at: new Date(entry.at).toISOString(), identity: entry.role === 'field' ? 'DECLARADA' : 'CONTA_FISCAL' };
    });
  }).sort(function (a, b) { return b.at.localeCompare(a.at); });
}

function bqKnownError_(code) {
  return /^(?:AUTH_REQUIRED|INVALID_CREDENTIALS|FORBIDDEN|[A-Z][A-Z0-9_]{2,43})$/.test(code);
}

function bqTechnicalError_(action, code, auth, id, correlation, version, origin, stage) {
  if (!Object.prototype.hasOwnProperty.call(BQ_MONITOR.errorModules, action)) return false;
  const normalized = bqKnownError_(String(code || '')) ? String(code) : 'SERVER_ERROR';
  const authentication = ['AUTH_REQUIRED', 'INVALID_CREDENTIALS', 'FORBIDDEN'].includes(normalized);
  const recordId = authentication || !auth ? '' : bqUuid_(id);
  const role = auth ? auth.role : '';
  const cache = CacheService.getScriptCache();
  const step = ['prepare', 'read_data', 'submit_data', 'read_photo', 'encode_photo', 'upload_photo', 'confirm_photo', 'confirm_record', 'confirm_correction'].includes(stage) ? stage : action;
  const key = 'bq-error-' + sha256_([action, normalized, role, recordId, step].join('|')).slice(0, 32);
  const dayKey = 'bq-errors-' + featureDate_(new Date());
  if (cache.get(key) || Number(cache.get(dayKey) || 0) >= BQ_MONITOR.errorLimit) return false;
  cache.put(key, '1', 300);
  cache.put(dayKey, String(Number(cache.get(dayKey) || 0) + 1), 21600);
  const critical = /CONFLICT|PUBLICATION_(?:INCOMPLETE|INTERRUPTED|UNCONFIRMED)|RECONCILIATION|WRITE_UNCONFIRMED|DELTA_MISMATCH|SERVER_ERROR/.test(normalized);
  const module = BQ_MONITOR.errorModules[action];
  const message = authentication ? 'Autenticação ou permissão recusada.'
    : critical ? 'A confirmação da operação exige verificação.' : 'A operação não retornou confirmação.';
  return bqAppendEvent_({ kind: 'ERRO', action: action, stage: step, code: normalized, message: message,
    module: module, role: role, recordId: recordId, severity: critical ? 'CRÍTICO' : 'ATENÇÃO',
    correlationId: bqUuid_(correlation) || Utilities.getUuid(), frontendVersion: bqVersion_(version),
    origin: origin, resolution: 'SEM_RESOLUÇÃO_REGISTRADA' });
}

function bqServerError_(error, payload) {
  try {
    const action = String(payload.action || '');
    if (!Object.prototype.hasOwnProperty.call(BQ_MONITOR.errorModules, action)) return;
    const auth = verifyToken_(payload.token) || (action === 'login' && ['field', 'fiscal', 'supervisor'].includes(payload.role) ? { role: payload.role } : null);
    bqTechnicalError_(action, error.code || 'SERVER_ERROR', auth, payload.recordId || payload.record && payload.record.recordId,
      payload.correlationId, payload.clientVersion, 'SERVIDOR');
  } catch (failure) { /* Monitoring must never replace the original error. */ }
}

function bqReportClient_(payload) {
  const auth = requireSession_(payload.token, ['field', 'fiscal', 'supervisor']);
  const cache = CacheService.getScriptCache(), throttle = 'bq-client-report-' + bqMonitorSession_(auth);
  if (cache.get(throttle)) return { ok: true };
  cache.put(throttle, '1', 5);
  const accepted = ['NETWORK_ERROR', 'TIMEOUT', 'HTTP_SERVER_ERROR', 'INVALID_SERVER_RESPONSE', 'INVALID_RECORD_STATE',
    'DATA_COMMIT_CONFLICT', 'LOCAL_PHOTO_READ_ERROR', 'LOCAL_PHOTO_MISSING', 'LOCAL_RECORD_CHANGED', 'PHOTO_PLAN_UNCONFIRMED',
    'CORRECTION_DATA_UNCONFIRMED', 'CORRECTION_DELTA_MISMATCH', 'PHOTO_CONFIRMATION_PENDING', 'PHOTO_SYNC_PENDING',
    'PUBLICATION_UNCONFIRMED', 'PDF_ERROR', 'EXCEL_ERROR', 'LOCAL_SYNC_ERROR'];
  const byId = Object.create(null);
  (Array.isArray(payload.events) ? payload.events.slice(0, 6) : []).forEach(function (event) {
    if (!event || !accepted.includes(event.code)) return;
    try {
      const id = bqUuid_(event.recordId);
      if (id && !Object.prototype.hasOwnProperty.call(byId, id)) {
        const found = findAcrossMainSheets_(id);
        if (found) authorizeDocumentRow_(auth, found.values);
        byId[id] = Boolean(found);
      }
      bqTechnicalError_(String(event.action || ''), event.code, auth, byId[id] === true ? id : '',
        event.correlationId, payload.clientVersion, 'APLICATIVO', event.stage);
    } catch (failure) { /* Invalid scope or unavailable telemetry. */ }
  });
  return { ok: true };
}

function bqLocalDiscard_(payload) {
  const auth = requireSession_(payload.token, ['field']), id = requireUuid_(payload.recordId);
  const cache = CacheService.getScriptCache(), key = 'bq-local-discard-' + bqMonitorSession_(auth);
  if (cache.get(key) || findAcrossMainSheets_(id)) return { ok: true, recorded: false };
  cache.put(key, '1', 15);
  return { ok: true, recorded: bqAppendEvent_({ kind: 'OPERACAO', type: 'RASCUNHO_EXCLUÍDO_NO_APARELHO',
    actor: auth.user, role: 'field', result: 'CONFIRMAÇÃO INFORMADA PELO APARELHO', recordId: id }) };
}

function bqAccountEvent_(auth, before, after, passwordChanged) {
  const project = function (account) {
    return account ? { active: account.active, bases: account.bases, correctionBases: account.correctionBases || [] } : null;
  };
  return { kind: 'OPERACAO', type: before ? 'FISCAL_ATUALIZADO' : 'FISCAL_CADASTRADO',
    actor: auth.user, role: 'fiscal-admin', subject: after.user, accountId: fiscalAccountKey_(after.user),
    result: 'CONFIRMADO', changes: { before: project(before), after: project(after), passwordChanged: Boolean(passwordChanged) } };
}

function bqPhotoEvent_(auth, recordId, index, replacing, values, uploadKey) {
  const audit = safeJson_(values[COL.AUDIT - 1], {}), cycle = bqCorrectionCycle_(values, audit.lastCorrectionSubmission);
  const matches = cycle?.photos.some(function (photo) { return photo.slot === index && photo.after.key === bqUuid_(uploadKey); });
  return { kind: 'OPERACAO', type: replacing ? 'FOTO_SUBSTITUÍDA' : 'FOTO_CONFIRMADA',
    actor: auth.user, role: auth.role, recordId: bqUuid_(recordId), result: 'CONFIRMADO',
    changes: { slot: index }, ...(matches ? { cycle: cycle } : {}) };
}

function bqDataEvent_(values, auth, original, model, receipt) {
  try {
    const audit = safeJson_(values[COL.AUDIT - 1], {});
    const cycle = receipt ? bqCorrectionCycle_(values, audit.lastCorrectionSubmission) : null;
    if (receipt && !cycle) return null;
    const changes = cycle ? cycle.changes : supervisorChanges_(original, model);
    if (!changes.length && !cycle?.photos.length) return null;
    return { kind: 'OPERACAO', type: cycle ? 'CORRECAO_CONFIRMADA' : 'DADOS_ALTERADOS', actor: auth.user,
      role: auth.role, recordId: model.recordId, base: model.base, result: 'CONFIRMADO', changes: changes,
      ...(cycle ? { cycle: cycle } : {}) };
  } catch (error) { return null; }
}

function bqMonitor_(payload) {
  requireSession_(payload.token, ['supervisor']);
  const view = String(payload.section || ''), filters = payload.filters || {};
  let result;
  if (view === 'online') result = { items: bqOnline_(fiscalAccounts_()) };
  else if (view === 'health' || view === 'late') result = bqHealth_(filters, view === 'late');
  else if (['errors', 'access', 'history'].includes(view)) result = bqLedger_(view, filters, payload.cursor);
  else if (view === 'diagnosis' || view === 'compare' || view === 'comparisonPhoto') {
    const id = requireUuid_(payload.recordId);
    result = view === 'diagnosis' ? bqDiagnosis_(id) : bqCompare_(id, view === 'comparisonPhoto' ? payload : null);
    if (view === 'comparisonPhoto') requireSession_(payload.token, ['supervisor']);
  } else throw apiError_('UNKNOWN_ACTION', 'Área de monitoramento inválida.');
  return Object.assign({ ok: true, at: nowIso_() }, result);
}

function bqDates_(filters) {
  const from = filters.from ? featureDateInput_(filters.from) : '';
  const to = filters.to ? featureDateInput_(filters.to) : '';
  if (from && to && from > to) throw apiError_('INVALID_DATE', 'A data inicial deve anteceder a final.');
  return { from: from, to: to };
}

function bqInPeriod_(at, range) {
  if (!range.from && !range.to) return true;
  const date = featureDate_(at);
  return Boolean(date && (!range.from || date >= range.from) && (!range.to || date <= range.to));
}

function bqHistoryEvent_(values) {
  const type = String(values[3] || ''), note = String(values[7] || '');
  const role = (
    ['APROVADA_E_PUBLICADA', 'CORRIGIDA_PELO_SUPERVISOR', 'CORRECAO_SOLICITADA', 'REPROVADA', 'SINCRONISMO_SOLICITADO'].includes(type) ? 'supervisor'
      : ['CRIADA', 'DADOS_ATUALIZADOS'].includes(type) ? 'field' : type === 'CORRECAO_FISCAL_ATRIBUIDA' ? 'fiscal-admin' : '');
  return { kind: 'OPERACAO', type: type, role: role, at: isoValue_(values[1]), actor: String(values[2] || ''),
    recordId: String(values[0] || ''), base: String(values[11] || ''), result: 'CONFIRMADO',
    previousStatus: String(values[4] || ''), status: String(values[5] || ''), reason: String(values[6] || ''),
    changes: type === 'CORRIGIDA_PELO_SUPERVISOR' ? safeJson_(note, []) : null,
    detail: type === 'CORRIGIDA_PELO_SUPERVISOR' ? '' : note.slice(0, 600) };
}

function bqHistoryWindow_(before, range) {
  const sheet = sheet_(APP.historySheet);
  const end = Math.min(sheet.getLastRow(), Number.isInteger(before) && before >= 2 ? before : Infinity);
  const start = Math.max(2, end - 300 + 1);
  const rows = end < start ? [] : sheet.getRange(start, 1, end - start + 1, HISTORY_HEADERS.length).getValues();
  const matches = rows.reverse().map(function (row, index) { return { row: end - index, values: row }; })
    .filter(function (item) { return bqUuid_(item.values[0]) && bqInPeriod_(item.values[1], range); });
  const limit = 24;
  return { items: matches.slice(0, limit).map(function (item) { return bqHistoryEvent_(item.values); }),
    next: matches.length > limit ? matches[limit - 1].row - 1 : start > 2 ? start - 1 : null };
}

function bqLedger_(view, filters, cursor) {
  const range = bqDates_(filters);
  const page = bqRecentEvents_(300, cursor && cursor.technical);
  const kind = { access: 'ACESSO', errors: 'ERRO', history: 'OPERACAO' }[view];
  const matches = page.items.filter(function (item) {
    const event = item.event;
    if (event.kind !== kind || !bqInPeriod_(event.at, range)) return false;
    if (view === 'access') return (!filters.user || sameUser_(event.user, filters.user))
      && (!filters.base || event.bases.includes(featureBase_(filters.base)));
    if (view === 'errors') return (!filters.severity || filters.severity === event.severity)
      && (!filters.recordId || bqUuid_(filters.recordId) === event.recordId);
    return true;
  });
  const limit = 45;
  let items = matches.slice(0, limit).map(function (item) { const { cycle, ...visible } = item.event; return visible; });
  if (view === 'access') {
    const accounts = fiscalAccounts_();
    items = items.map(function (event) {
      const account = accounts[event.accountId], expiry = Date.parse(event.expiresAt);
      let state = event.type;
      if (state === 'LOGIN_CONFIRMADO') {
        if (Number.isFinite(expiry) && expiry <= Date.now()) state = 'EXPIRAÇÃO_PREVISTA_ATINGIDA';
        else if (!account || !account.active || account.revision !== event.revision) state = 'AUTORIZAÇÃO_REVOGADA';
        else state = 'SESSÃO EMITIDA';
      }
      const { revision, ...publicEvent } = event;
      return Object.assign(publicEvent, { state: state });
    });
  }
  let operational = { items: [], next: null };
  if (view === 'history' && (!cursor || cursor.history !== null)) operational = bqHistoryWindow_(cursor && cursor.history, range);
  if (cursor && cursor.technical === null) items = [];
  items = items.concat(operational.items).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  const next = { technical: cursor && cursor.technical === null ? null
    : matches.length > limit ? matches[limit - 1].row - 1 : page.next, history: operational.next };
  return { items: items, available: page.available, cursor: next.technical || next.history ? next : null };
}

function bqReadRecord_(id) {
  const ss = spreadsheet_(), pending = findRowsById_(sheet_(APP.pendingSheet, ss), id), official = findRowsById_(sheet_(APP.officialSheet, ss), id);
  const current = pending[0] || official[0];
  if (!current) throw apiError_('RECORD_NOT_FOUND', 'Ocorrência não encontrada no servidor.');
  return { ss: ss, row: current.values, pending: pending, official: official,
    audit: safeJson_(current.values[COL.AUDIT - 1], {}) };
}

function bqPhotoState_(row, audit) {
  const trafo = String(row[COL.TYPES - 1] || '').split(' | ').includes(TYPES[0]);
  const applicable = trafo ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
  const expected = normalizePhotoIndexes_([].concat(audit.expectedPhotoIndexes || [], audit.requestedPhotoIndexes || [], trafo ? [6, 7] : []))
    .filter(function (index) { return applicable.includes(index); });
  const confirmed = applicable.filter(function (index) { return photoSlotConfirmed_(row, audit, index); });
  const pending = expected.filter(function (index) {
    return !confirmed.includes(index) || normalizePhotoIndexes_(audit.requestedPhotoIndexes).includes(index);
  });
  const discrepancy = applicable.filter(function (index) {
    const receipt = (audit.photoSubmissions || {})[index];
    return receipt && receipt.phase === 'COMPLETE' && !confirmed.includes(index);
  });
  const inConfirmation = applicable.filter(function (index) { return (audit.photoSubmissions || {})[index]?.phase === 'STAGED'; });
  return { expected: expected, confirmed: confirmed, pending: pending, discrepancy: discrepancy, inConfirmation: inConfirmation,
    generalMissing: Math.max(0, 3 - confirmed.filter(function (index) { return index <= 5; }).length),
    lastConfirmedAt: String(audit.lastPhotoConfirmation || ''), localState: 'ESTADO LOCAL NÃO VERIFICÁVEL PELO SERVIDOR' };
}

function bqFormalCorrection_(row, audit, accounts, status) {
  if (status !== STATUS.CORRECTION_REQUESTED) return null;
  const request = audit.lastCorrectionRequest || {};
  const requestedAt = request.requestedAt || isoValue_(row[COL.REVIEWED_AT - 1]);
  const reason = request.reason || row[COL.REASON - 1];
  const supervisor = request.supervisor || row[COL.SUPERVISOR - 1];
  if (!requestedAt || (!audit.lastCorrectionRequest && (!reason || !supervisor))) return null;
  const route = fiscalCorrectionProjection_(audit, accounts);
  if (route.assignmentStatus === 'COMPLETE' || (audit.lastCorrectionSubmission?.phase === 'COMPLETE'
    && audit.lastCorrectionSubmission.requestedAt === correctionRequestedAt_(audit))) return null;
  const elapsedHours = (Date.now() - Date.parse(requestedAt)) / 3600000;
  const band = elapsedHours > 72 ? 72 : elapsedHours > 48 ? 48 : elapsedHours > 24 ? 24 : 0;
  return { requestedAt: requestedAt, reason: String(reason || ''), supervisor: String(supervisor || ''),
    responsible: route.routingVersion === 'LEGACY_FIELD' ? String(row[COL.USER - 1] || '') : route.assignedFiscal || '',
    role: route.routingVersion === 'LEGACY_FIELD' ? 'field' : 'fiscal',
    unassigned: route.assignmentStatus === 'WAITING_ASSIGNMENT', elapsedHours: Number.isFinite(elapsedHours) ? elapsedHours : null, band: band };
}

function bqRecordSummary_(row, status) {
  return { recordId: String(row[COL.ID - 1]), occurrenceNumber: String(row[COL.OCCURRENCE_NUMBER - 1] || ''),
    base: String(row[COL.BASE - 1] || ''), team: String(row[COL.TEAM - 1] || ''), user: String(row[COL.USER - 1] || ''),
    status: status, registeredAt: isoValue_(row[COL.REGISTERED_AT - 1]), updatedAt: isoValue_(row[COL.UPDATED_AT - 1]) };
}

function bqErrorIndex_(events) {
  const errors = Object.create(null);
  events.items.forEach(function (item) {
    const event = item.event;
    if (event.kind !== 'ERRO' || !event.recordId) return;
    if (!errors[event.recordId]) errors[event.recordId] = [];
    errors[event.recordId].push(event);
  });
  return errors;
}

function bqHealth_(filters, lateOnly) {
  const range = bqDates_(filters), ss = spreadsheet_(), accounts = fiscalAccounts_();
  const pending = dataRows_(sheet_(APP.pendingSheet, ss), COL.WIDTH);
  const official = dataRows_(sheet_(APP.officialSheet, ss), COL.WIDTH);
  const byId = new Map();
  [official, pending].forEach(function (rows, index) {
    rows.forEach(function (row) {
      const id = bqUuid_(row[COL.ID - 1]);
      if (!id) return;
      const item = byId.get(id) || { official: 0, pending: 0 };
      item[index ? 'pending' : 'official'] += 1;
      item.row = row;
      byId.set(id, item);
    });
  });
  const recent = lateOnly ? { items: [], available: false } : bqRecentEvents_(500);
  const errors = bqErrorIndex_(recent);
  const items = [], counts = { sync: 0, photos: 0, errors: 0, corrections: 0, publications: 0, unassigned: 0, recurrent: 0, late: 0 };
  byId.forEach(function (item, id) {
    const row = item.row;
    if (!bqInPeriod_(row[COL.REGISTERED_AT - 1], range)
      || (filters.base && normalize_(row[COL.BASE - 1]) !== normalize_(filters.base))
      || (filters.team && !normalize_(row[COL.TEAM - 1]).includes(normalize_(filters.team)))) return;
    const status = operationalStatusFromValues_(row), audit = safeJson_(row[COL.AUDIT - 1], {});
    const info = bqRecordSummary_(row, status), correction = bqFormalCorrection_(row, audit, accounts, status);
    if ((filters.status && status !== filters.status)
      || (filters.responsible && !normalize_(correction?.responsible || info.user).includes(normalize_(filters.responsible)))) return;
    if (lateOnly && !correction?.band) return;
    const photo = bqPhotoState_(row, audit), active = ![STATUS.PUBLISHED, STATUS.REJECTED].includes(status);
    const lastError = (errors[id] || [])[0] || null;
    const lastEvidence = Math.max(0, ...[audit.lastDataConfirmation, audit.lastPhotoConfirmation, audit.lastCorrectionSubmission?.completedAt, audit.publishedAt]
      .map(function (at) { return Date.parse(at) || 0; }));
    const unresolved = lastError && Date.parse(lastError.at) >= lastEvidence;
    const publication = item.pending && item.official || status === STATUS.APPROVED || audit.publicationState === 'RECONCILIACAO_NECESSARIA';
    const conflict = item.pending > 1 || item.official > 1 || photo.discrepancy.length || unresolved && lastError.severity === 'CRÍTICO';
    const tags = {
      sync: active && (status === STATUS.SYNCING_PHOTOS || photo.inConfirmation.length > 0 || Boolean(audit.lastCorrectionSubmission && audit.lastCorrectionSubmission.phase !== 'COMPLETE')),
      photos: active && Boolean(photo.generalMissing || photo.pending.length || photo.inConfirmation.length),
      errors: Boolean(unresolved), corrections: Boolean(correction), publications: Boolean(publication),
      unassigned: Boolean(correction?.unassigned), recurrent: (errors[id] || []).length > 1, late: Boolean(correction?.band)
    };
    const severity = conflict || publication ? 'CRÍTICO' : Object.values(tags).some(Boolean) ? 'ATENÇÃO'
      : audit.lastDataConfirmation || audit.publicationState === STATUS.PUBLISHED ? 'NORMAL' : 'SEM CONFIRMAÇÃO';
    if (filters.severity && severity !== filters.severity) return;
    Object.keys(counts).forEach(function (key) { if (tags[key]) counts[key] += 1; });
    items.push(Object.assign(info, { tags: tags, severity: severity, correction: correction, lastError: lastError }));
  });
  const offset = Math.max(0, Math.min(Number(filters.offset) || 0, 50000));
  items.sort(function (a, b) {
    return lateOnly ? b.correction.elapsedHours - a.correction.elapsedHours : String(b.updatedAt || b.registeredAt).localeCompare(String(a.updatedAt || a.registeredAt));
  });
  const latest = recent.items.map(function (item) { return item.event; })
    .filter(function (event) { return event.kind === 'ERRO' && bqInPeriod_(event.at, range); }).slice(0, 8);
  return { items: items.slice(offset, offset + 60), total: items.length, counts: counts, latest: latest,
    nextOffset: offset + 60 < items.length ? offset + 60 : null, errorsAvailable: recent.available };
}

function bqRecordHistory_(ss, id) {
  return publicationRowsForId_(sheet_(APP.historySheet, ss), id, HISTORY_HEADERS.length);
}

function bqRecordMonitorEvents_(id) {
  const ledger = bqMonitorSheet_();
  return !ledger ? [] : publicationRowsForId_(ledger, bqUuid_(id), 2)
    .map(function (item) { return safeJson_(item.values[1], null); }).filter(Boolean);
}

function bqDiagnosis_(id) {
  const found = bqReadRecord_(id), row = found.row, audit = found.audit;
  const status = operationalStatusFromValues_(row), photos = bqPhotoState_(row, audit);
  const errors = bqErrorIndex_(bqRecentEvents_(800))[bqUuid_(id)] || [];
  const history = bqRecordHistory_(found.ss, id), receipt = audit.lastCorrectionSubmission;
  const correction = bqFormalCorrection_(row, audit, fiscalAccounts_(), status);
  const count = function (name, width) {
    return publicationRowsForId_(sheet_(name, found.ss), id, width).length;
  };
  const stagedPublication = Boolean(found.official.length || status === STATUS.APPROVED || audit.publicationState);
  const services = stagedPublication ? count(APP.servicesSheet, SERVICE_HEADERS.length) : Array.isArray(audit.pendingServices) ? audit.pendingServices.length : null;
  const materials = stagedPublication ? count(APP.materialsSheet, MATERIAL_HEADERS.length) : Array.isArray(audit.pendingMaterials) ? audit.pendingMaterials.length : null;
  const expectedServices = Array.isArray(audit.finalServices) ? audit.finalServices.length : Array.isArray(audit.pendingServices) ? audit.pendingServices.length : null;
  const expectedMaterials = Array.isArray(audit.finalMaterials) ? audit.finalMaterials.length : Array.isArray(audit.pendingMaterials) ? audit.pendingMaterials.length : null;
  const finalEvents = history.filter(function (item) { return item.values[3] === 'APROVADA_E_PUBLICADA'; }).length;
  const evidenceMismatch = stagedPublication && (expectedServices != null && expectedServices !== services || expectedMaterials != null && expectedMaterials !== materials);
  let publicationConflict = found.official.length > 1 || finalEvents > 1 || Boolean(found.pending.length && found.official.length);
  let publication = stagedPublication ? 'PUBLICAÇÃO SEM COMPROVAÇÃO INTEGRAL' : 'SEM PUBLICAÇÃO CONHECIDA';
  if (status === STATUS.APPROVED || audit.publicationState === 'RECONCILIACAO_NECESSARIA' || publicationConflict || evidenceMismatch) {
    publication = 'PUBLICAÇÃO NECESSITA RECONCILIAÇÃO';
  } else if (found.official.length === 1 && status === STATUS.PUBLISHED && finalEvents === 1 && finalPublicationEvent_(audit)
    && expectedServices != null && expectedMaterials != null) {
    try {
      // The existing verifier compares content and cardinality of the same
      // UUID. This path uses a published snapshot and never requests repair.
      const proof = verifyPublishedIntegrity_(id, { repair: false });
      if (proof.ok === true && proof.pendingCopies === 0) publication = 'PUBLICAÇÃO CONFIRMADA';
    } catch (error) {
      if (['PUBLISHED_RECONCILIATION_CONFLICT', 'INTEGRITY_REVIEW_REQUIRED'].includes(error.code)) {
        publication = 'PUBLICAÇÃO NECESSITA RECONCILIAÇÃO'; publicationConflict = true;
      }
    }
  }
  const confirmed = Boolean(audit.lastDataConfirmation || receipt?.dataVerifiedAt);
  const currentError = errors[0] || null;
  const conflict = found.pending.length > 1 || publicationConflict || photos.discrepancy.length > 0 || Boolean(currentError &&
    /CONFLICT|MISMATCH|RECONCILIATION/.test(currentError.code) && Date.parse(currentError.at) >= Math.max(0, Date.parse(audit.lastDataConfirmation) || 0, Date.parse(audit.lastPhotoConfirmation) || 0, Date.parse(audit.publishedAt) || 0));
  const conclusions = [];
  if (publication === 'PUBLICAÇÃO NECESSITA RECONCILIAÇÃO') conclusions.push(publication);
  if (currentError?.code === 'DATA_COMMIT_CONFLICT') conclusions.push('CONFLITO DE SINCRONIZAÇÃO REGISTRADO');
  if (photos.discrepancy.length) conclusions.push('DIVERGÊNCIA ENTRE SLOT E RECIBO');
  if (receipt && receipt.requestedAt === correctionRequestedAt_(audit) && receipt.phase !== 'COMPLETE') conclusions.push('CORREÇÃO REENVIADA, AGUARDANDO CONFIRMAÇÃO');
  if (confirmed && (photos.pending.length || photos.generalMissing || photos.inConfirmation.length)) conclusions.push('DADOS CONFIRMADOS — FOTOS PENDENTES');
  if (!conclusions.length) conclusions.push(confirmed ? 'DADOS CONFIRMADOS PELO SERVIDOR' : 'SEM DADOS SUFICIENTES PARA CONFIRMAR');
  const next = publication === 'PUBLICAÇÃO NECESSITA RECONCILIAÇÃO' ? 'Confira a integridade pelo fluxo de aprovação existente.'
    : conflict ? 'Compare o erro com os recibos e confira o registro no aparelho de origem.'
      : photos.pending.length || photos.generalMissing || photos.inConfirmation.length ? 'Confirme a fila e as fotos no aparelho de origem.'
        : correction ? 'Confira o destinatário e o andamento da correção formal.' : 'Confira os eventos registrados abaixo.';
  const attempts = [currentError?.at, receipt?.receivedAt, audit.lastPhotoConfirmation, audit.lastDataConfirmation]
    .filter(function (at) { return Number.isFinite(Date.parse(at)); }).sort(function (a, b) { return Date.parse(b) - Date.parse(a); });
  return { occurrence: bqRecordSummary_(row, status), persistence: { found: true, confirmed: confirmed, services: services,
    materials: materials, expectedServices: expectedServices, expectedMaterials: expectedMaterials, publication: publication,
    conflict: conflict, officialCopies: found.official.length, pendingCopies: found.pending.length, finalEvents: finalEvents },
    photos: photos, synchronization: { lastAttempt: attempts[0] || '', phase: receipt?.phase || (confirmed ? 'DADOS_CONFIRMADOS' : ''),
      lastError: currentError, next: next }, conclusions: conclusions, correction: correction,
    requests: (Array.isArray(audit.correctionRequests) ? audit.correctionRequests : []).slice(-10).map(function (request) {
      return { requestedAt: request.requestedAt, supervisor: request.supervisor, reason: request.reason };
    }),
    history: history.slice(-20).reverse().map(function (item) { return bqHistoryEvent_(item.values); }),
    errors: errors.slice(0, 12) };
}

function bqCorrectionCycle_(values, receipt) {
  if (!receipt || receipt.phase !== 'COMPLETE' || !bqUuid_(receipt.requestId)) return null;
  const before = receipt.beforePatch || {}, after = receipt.expectedPatch || {};
  const clean = function (data) {
    const value = Object.assign({}, data);
    // Amounts come from the receipt, never from the current catalog.
    delete value.totalServices;
    return value;
  };
  const changes = supervisorChanges_(clean(before), clean(after));
  const amount = function (value) {
    return value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const beforeTotal = amount(before.totalServices ?? receipt.beforeTotal);
  const afterTotal = amount(after.totalServices ?? (beforeTotal == null ? null : beforeTotal));
  if (beforeTotal != null && afterTotal != null && beforeTotal !== afterTotal) {
    changes.push({ field: 'Total da ocorrência', previousValue: beforeTotal, newValue: afterTotal });
  }
  const photos = [];
  const audit = safeJson_(values[COL.AUDIT - 1], {});
  const previous = Object.assign({}, receipt.beforePhotoPatch || {}, receipt.beforeEvidencePatch || {});
  const replacements = Object.assign({}, receipt.photoPatch || {}, receipt.evidencePatch || {});
  // Historical photo-only requests could complete through the upload route,
  // before an explicit patch existed. Only use the receipts of that request.
  if (!Object.keys(replacements).length && receipt.requestedAt && receipt.receivedAt) {
    Object.keys(audit.photoSubmissions || {}).forEach(function (slot) {
      const saved = audit.photoSubmissions[slot];
      if (saved?.phase !== 'COMPLETE' || saved.originalFieldSync || saved.requestedAt !== receipt.requestedAt
        || saved.receivedAt < receipt.receivedAt || saved.receivedAt > receipt.completedAt) return;
      replacements[slot] = { uploadKey: saved.uploadKey };
      previous[slot] = { serverUrl: saved.previousUrl };
    });
  }
  Object.keys(replacements).forEach(function (slot) {
    const index = Number(slot), saved = (audit.photoSubmissions || {})[index], key = replacements[slot].uploadKey;
    if (!Number.isInteger(index) || index < 1 || index > 7) return;
    photos.push({ slot: index,
      before: { fileId: extractDriveFileId_(previous[slot]?.serverUrl || ''), key: bqUuid_(previous[slot]?.uploadKey) },
      after: { fileId: saved?.phase === 'COMPLETE' && saved.uploadKey === key ? extractDriveFileId_(saved.expectedUrl) : '', key: bqUuid_(key) } });
  });
  return { cycleId: receipt.requestId, actor: receipt.actor, role: receipt.actorRole === 'fiscal' ? 'fiscal' : 'field',
    requestedAt: receipt.requestedAt, at: receipt.completedAt, changes: changes, photos: photos, beforeTotal: beforeTotal, afterTotal: afterTotal };
}

function bqComparisons_(id, found) {
  const cycles = new Map();
  const rows = bqRecordHistory_(found.ss, id);
  const supervisorEvents = rows.filter(function (item) { return item.values[3] === 'CORRIGIDA_PELO_SUPERVISOR'; });
  const direct = supervisorEvents.map(function (item) { return { supervisor: item.values[2], correctedAt: isoValue_(item.values[1]), changes: safeJson_(item.values[7], null) }; });
  (Array.isArray(found.audit.supervisorCorrections) ? found.audit.supervisorCorrections : []).forEach(function (event) {
    if (!direct.some(function (known) { return known.supervisor === event.supervisor && known.correctedAt === event.correctedAt && JSON.stringify(known.changes) === JSON.stringify(event.changes); })) direct.push(event);
  });
  direct.forEach(function (event, index) {
    if (!Array.isArray(event.changes) || !event.changes.length) return;
    const total = event.changes.find(function (change) { return change.field === 'Total da ocorrência'; });
    const monetary = function (value) { return value != null && String(value).trim() && Number.isFinite(Number(value)) ? Number(value) : null; };
    const cycleId = 'supervisor-' + index;
    cycles.set(cycleId, { cycleId: cycleId, actor: event.supervisor, role: 'supervisor', at: event.correctedAt,
      changes: event.changes, photos: [], beforeTotal: monetary(total?.previousValue), afterTotal: monetary(total?.newValue) });
  });
  bqRecordMonitorEvents_(id).forEach(function (item) {
    const cycle = item.cycle;
    if (cycle && bqUuid_(cycle.cycleId) && Array.isArray(cycle.changes) && Array.isArray(cycle.photos)) cycles.set(cycle.cycleId, cycle);
  });
  const current = bqCorrectionCycle_(found.row, found.audit.lastCorrectionSubmission);
  if (current && !cycles.has(current.cycleId) && (current.changes.length || current.photos.length)) cycles.set(current.cycleId, current);
  // Some historical requests have only an independently verified financial delta.
  (Array.isArray(found.audit.fiscalCorrections) ? found.audit.fiscalCorrections : []).forEach(function (event) {
    if (!bqUuid_(event.requestId) || cycles.has(event.requestId) || !Array.isArray(event.changes)) return;
    const total = event.changes.find(function (change) { return change.field === 'Total da ocorrência'; });
    if (total && Number.isFinite(total.previousValue) && Number.isFinite(total.newValue)) cycles.set(event.requestId, {
      cycleId: event.requestId, actor: event.fiscal, role: 'fiscal', at: event.correctedAt, changes: [total],
      photos: [], beforeTotal: total.previousValue, afterTotal: total.newValue
    });
  });
  const requests = Array.isArray(found.audit.correctionRequests) ? found.audit.correctionRequests : [];
  return [...cycles.values()].sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).map(function (cycle) {
    const request = cycle.requestedAt && requests.find(function (item) {
      return item.requestedAt === cycle.requestedAt || item.lastRequestedAt === cycle.requestedAt;
    });
    return request ? Object.assign(cycle, { reason: request.reason, supervisor: request.supervisor }) : cycle;
  });
}

function bqCompare_(id, photoRequest) {
  const found = bqReadRecord_(id);
  const cycles = bqComparisons_(id, found);
  if (!photoRequest) {
    return { recordId: id, status: operationalStatusFromValues_(found.row),
      cycles: cycles.map(function (cycle) {
        return Object.assign({}, cycle, { photos: cycle.photos.map(function (photo) { return {
          slot: photo.slot, before: Boolean(photo.before?.fileId), after: Boolean(photo.after?.fileId)
        }; }) });
      }) };
  }
  const cycle = cycles.find(function (item) { return item.cycleId === photoRequest.cycleId; });
  const index = Number(photoRequest.photoIndex);
  const photo = cycle?.photos.find(function (item) { return item.slot === index; });
  if (!photo || !['before', 'after'].includes(photoRequest.side)) throw apiError_('INVALID_PHOTO_INDEX', 'Versão da foto indisponível.');
  const reference = photo[photoRequest.side];
  return { recordId: id, cycleId: cycle.cycleId, photoIndex: index, side: photoRequest.side,
    dataUrl: bqComparisonImage_(id, index, reference) };
}

function bqComparisonImage_(id, index, reference) {
  if (!reference?.fileId || !Number.isInteger(index) || index < 1 || index > 7) return '';
  try {
    const file = DriveApp.getFileById(reference.fileId);
    if (file.isTrashed()) return '';
    const label = index === 6 ? 'TRAFO_RETIRADO' : index === 7 ? 'TRAFO_INSTALADO' : 'FOTO_' + index;
    const identity = String(file.getDescription() || '').split(' | ');
    if (identity[0] === APP.name && identity.length >= 3) {
      if (identity[1] !== id || identity[2] !== label || reference.key && identity[3] !== reference.key) return '';
    } else {
      const prefix = id + '_' + label;
      const name = String(file.getName() || '');
      if (reference.key ? !name.startsWith(prefix + '_' + reference.key + '.') : !name.startsWith(prefix + '.')) return '';
    }
    const blob = file.getBlob(), mime = blob.getContentType(), bytes = blob.getBytes();
    return /^image\/(?:jpeg|png|webp|gif)$/.test(mime) && bytes.length && bytes.length <= APP.maxPhotoBytes
      ? 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes) : '';
  } catch (error) { return ''; }
}
