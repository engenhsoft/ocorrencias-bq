// Additive functions for the existing official Apps Script. No new project or data source.
function featureBase_(value) {
  const bases = ['ASSÚ', 'CAICÓ', 'CARAÚBAS', 'CURRAIS NOVOS', 'MOSSORÓ', 'PAU DOS FERROS'];
  return bases.filter(function (base) { return normalize_(base) === normalize_(value); })[0] || '';
}

function featureDate_(value) {
  const text = String(value == null ? '' : value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = value instanceof Date ? value : new Date(text);
  return Number.isNaN(date.getTime()) ? '' : Utilities.formatDate(date, APP.timeZone, 'yyyy-MM-dd');
}
function featureDateInput_(value) {
  const text = String(value || '');
  const date = new Date(text + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw apiError_('INVALID_DATE', 'Data inválida.');
  return text;
}
function featureRows_(spreadsheet) {
  const byId = {};
  // Pending overrides an incomplete published copy, as in the operational queues.
  [APP.officialSheet, APP.pendingSheet].forEach(function (name) {
    dataRows_(sheet_(name, spreadsheet), COL.WIDTH).forEach(function (row) {
      const id = String(row[COL.ID - 1] || '');
      if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) byId[id] = row;
    });
  });
  return Object.keys(byId).map(function (id) { return byId[id]; });
}

function featureEligible_(row) {
  const audit = safeJson_(row[COL.AUDIT - 1], {});
  if (audit.testOnly || audit.harness || audit.syntheticFixture || audit.publicationState === 'RECONCILIACAO_NECESSARIA') return false;
  const status = operationalStatusFromValues_(row);
  return [STATUS.WAITING_SUPERVISOR, STATUS.PUBLISHED, STATUS.APPROVED].indexOf(status) >= 0 && recordReadyForSupervisorValues_(row);
}

function featureIdentity_(row, original) {
  const audit = safeJson_(row[COL.AUDIT - 1], {}), saved = audit.registrationIdentity || original || {};
  return { base: featureBase_(saved.base || row[COL.BASE - 1]), team: String(saved.team || row[COL.TEAM - 1] || '').trim(), crewLeader: String(saved.crewLeader || row[COL.CREW_LEADER - 1] || '').trim() };
}

function buildOperationalSummary_(rows, history, month, supervisor) {
  const originals = {}, byId = {}, ranking = {}, bases = ['ASSÚ', 'CAICÓ', 'CARAÚBAS', 'CURRAIS NOVOS', 'MOSSORÓ', 'PAU DOS FERROS'];
  history.forEach(function (event) {
    if (String(event[3]) === 'CRIADA' && !originals[String(event[0])]) originals[String(event[0])] = { base: event[11], team: event[9], crewLeader: event[12] };
  });
  rows.forEach(function (row) { byId[String(row[COL.ID - 1])] = row; });
  const distribution = { month: {}, all: {} };
  ['month', 'all'].forEach(function (period) { bases.forEach(function (base) { distribution[period][base] = 0; }); });
  Object.keys(byId).forEach(function (id) {
    const row = byId[id]; if (!featureEligible_(row)) return;
    const date = featureDate_(row[COL.REGISTERED_AT - 1]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const identity = featureIdentity_(row, originals[id]);
    if (identity.base) distribution.all[identity.base]++;
    if (date.slice(0, 7) !== month) return;
    if (identity.base) distribution.month[identity.base]++;
    if (!identity.crewLeader) return;
    const key = normalize_(identity.crewLeader);
    const leader = ranking[key] || (ranking[key] = { crewLeader: identity.crewLeader, teams: {}, bases: {}, count: 0, totalServices: 0, valueAvailable: true });
    leader.teams[identity.team] = true; leader.bases[identity.base] = true; leader.count++;
    const total = Number(row[COL.TOTAL - 1]);
    if (Number.isFinite(total) && total >= 0) leader.totalServices = roundMoney_(leader.totalServices + total); else leader.valueAvailable = false;
  });
  const leaders = Object.keys(ranking).map(function (key) {
    const item = ranking[key]; return { crewLeader: item.crewLeader, team: Object.keys(item.teams).filter(Boolean).sort().join(' / '), base: Object.keys(item.bases).filter(Boolean).sort().join(' / '), count: item.count, totalServices: item.valueAvailable ? item.totalServices : null };
  }).sort(function (a, b) { return b.count - a.count || (normalize_(a.crewLeader) < normalize_(b.crewLeader) ? -1 : normalize_(a.crewLeader) > normalize_(b.crewLeader) ? 1 : 0); }).slice(0, 3);
  const result = { month: month, timeZone: APP.timeZone, top3: leaders, calculatedAt: nowIso_() };
  if (!supervisor) return result;
  result.conformityRecords = buildConformityRecords_(rows, history);
  result.bases = {};
  ['month', 'all'].forEach(function (period) {
    const total = bases.reduce(function (sum, base) { return sum + distribution[period][base]; }, 0);
    result.bases[period] = bases.map(function (base) { return { label: base, count: distribution[period][base], percentage: total ? distribution[period][base] / total * 100 : 0 }; });
  });
  const decisions = ['APROVADA', 'PUBLICADA', 'APROVADA_E_PUBLICADA', 'CORRECAO_SOLICITADA', 'CORRECAO_FOTOS_SOLICITADA', 'REPROVADA'];
  const negative = ['CORRECAO_SOLICITADA', 'CORRECAO_FOTOS_SOLICITADA', 'REPROVADA'];
  result.nonconformity = {};
  ['month', 'all'].forEach(function (period) {
    const analysed = {}, bad = {};
    history.forEach(function (event) {
      const id = String(event[0] || ''), action = String(event[3] || ''), row = byId[id];
      if (!row || decisions.indexOf(action) < 0 || !event[2]) return;
      const audit = safeJson_(row[COL.AUDIT - 1], {}); if (audit.testOnly || audit.harness || audit.syntheticFixture) return;
      const date = featureDate_(event[1]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (period === 'month' && date.slice(0, 7) !== month)) return;
      analysed[id] = featureIdentity_(row, originals[id]); if (negative.indexOf(action) >= 0) bad[id] = true;
    });
    result.nonconformity[period] = {};
    ['base', 'crewLeader'].forEach(function (dimension) {
      const groups = {};
      if (dimension === 'base') bases.forEach(function (base) { groups[normalize_(base)] = { label: base, analysed: 0, nonconforming: 0 }; });
      Object.keys(analysed).forEach(function (id) {
        const label = analysed[id][dimension] || 'Não informado', key = normalize_(label);
        const group = groups[key] || (groups[key] = { label: label, analysed: 0, nonconforming: 0 });
        group.analysed++; if (bad[id]) group.nonconforming++;
      });
      result.nonconformity[period][dimension] = Object.keys(groups).map(function (key) {
        const item = groups[key]; return { label: item.label, analysed: item.analysed, nonconforming: item.nonconforming, percentage: item.analysed ? item.nonconforming / item.analysed * 100 : null };
      }).sort(function (a, b) { return (b.percentage == null ? -1 : b.percentage) - (a.percentage == null ? -1 : a.percentage) || (normalize_(a.label) < normalize_(b.label) ? -1 : 1); });
    });
  });
  return result;
}

// Read projection only: retain confirmed decisions from the complete history,
// plus persisted audit events when an old history entry is unavailable.
function buildConformityRecords_(rows, history) {
  const byId = {}, originals = {}, events = {};
  const actions = ['APROVADA', 'PUBLICADA', 'APROVADA_E_PUBLICADA', 'CORRIGIDA_PELO_SUPERVISOR', 'REPROVADA', 'CORRECAO_SOLICITADA', 'CORRECAO_FOTOS_SOLICITADA'];
  rows.forEach(function (row) {
    const id = String(row[COL.ID - 1] || ''), audit = safeJson_(row[COL.AUDIT - 1], {});
    if (!id || audit.testOnly || audit.harness || audit.syntheticFixture || audit.publicationState === 'RECONCILIACAO_NECESSARIA') return;
    byId[id] = row;
  });
  function add(id, action, actor, at) {
    if (!byId[id] || actions.indexOf(action) < 0 || !actor || !featureDate_(at)) return;
    const key = action + '|' + isoValue_(at) + '|' + String(actor);
    const saved = events[id] || (events[id] = {});
    saved[key] = { action: action, actor: String(actor), at: isoValue_(at) };
  }
  history.forEach(function (event) {
    const id = String(event[0] || ''), action = String(event[3] || '');
    if (action === 'CRIADA' && !originals[id]) originals[id] = { base: event[11], team: event[9], crewLeader: event[12] };
    add(id, action, event[2], event[1]);
  });
  return Object.keys(byId).map(function (id) {
    const row = byId[id], audit = safeJson_(row[COL.AUDIT - 1], {});
    (Array.isArray(audit.timeline) ? audit.timeline : []).forEach(function (event) {
      if (event) add(id, String(event.action || ''), event.actor, event.at || event.timestamp);
    });
    (Array.isArray(audit.supervisorCorrections) ? audit.supervisorCorrections : []).concat([audit.lastSupervisorCorrection]).forEach(function (correction) {
      if (!correction || !Array.isArray(correction.changes) || !correction.changes.some(function (change) { return change && String(change.previousValue == null ? '' : change.previousValue) !== String(change.newValue == null ? '' : change.newValue); })) return;
      add(id, 'CORRIGIDA_PELO_SUPERVISOR', correction.supervisor, correction.correctedAt);
    });
    [audit.lastCorrectionRequest, audit.lastPhotoCorrectionRequest].forEach(function (request) {
      if (request) { add(id, 'CORRECAO_SOLICITADA', request.supervisor, request.requestedAt); add(id, 'CORRECAO_SOLICITADA', request.supervisor, request.lastRequestedAt); }
    });
    const identity = featureIdentity_(row, originals[id]);
    return { recordId: id, status: operationalStatusFromValues_(row), base: identity.base, crewLeader: identity.crewLeader,
      supervisor: String(row[COL.SUPERVISOR - 1] || ''), reviewedAt: isoValue_(row[COL.REVIEWED_AT - 1]), publishedAt: String(audit.publishedAt || ''),
      audit: { registrationIdentity: identity, timeline: Object.keys(events[id] || {}).map(function (key) { return events[id][key]; }) } };
  });
}

function getOperationalSummary_(payload) {
  const auth = requireSession_(payload.token, ['field', 'supervisor']);
  const spreadsheet = spreadsheet_();
  const result = Object.assign({ ok: true, success: true }, buildOperationalSummary_(featureRows_(spreadsheet), dataRows_(sheet_(APP.historySheet, spreadsheet), HISTORY_HEADERS.length), todayOperational_().slice(0, 7), auth.role === 'supervisor'));
  if (auth.role === 'supervisor') result.financialRecords = buildFinancialRecords_(dataRows_(sheet_(APP.officialSheet, spreadsheet), COL.WIDTH));
  return result;
}

// Read only, from OCORRENCIAS exclusively. No catalog, photos or write helpers.
function buildFinancialRecords_(rows) {
  function financeField(field) { return normalize_(field) === 'TOTAL DA OCORRENCIA'; }
  return rows.filter(function (row) {
    const audit = safeJson_(row[COL.AUDIT - 1], {}) || {};
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(row[COL.ID - 1] || ''))
      && String(row[COL.STATUS - 1]) === STATUS.PUBLISHED && operationalStatusFromValues_(row) === STATUS.PUBLISHED
      && !audit.testOnly && !audit.harness && !audit.syntheticFixture && audit.publicationState !== 'RECONCILIACAO_NECESSARIA';
  }).map(function (row) {
    const audit = safeJson_(row[COL.AUDIT - 1], null);
    let invalid = !audit || typeof audit !== 'object' || Array.isArray(audit);
    const saved = invalid ? {} : audit;
    function list(key) { if (saved[key] != null && !Array.isArray(saved[key])) invalid = true; return Array.isArray(saved[key]) ? saved[key] : []; }
    function contract(event) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) { invalid = true; return {}; }
      return { recalculatedAt: event.recalculatedAt, previousTotal: event.previousTotal, newTotal: event.newTotal };
    }
    function correction(event) {
      if (!event || !Array.isArray(event.changes)) { invalid = true; return null; }
      const changes = event.changes.filter(function (change) { return change && financeField(change.field); }).map(function (change) {
        return { field: 'Total da ocorrência', previousValue: change.previousValue, newValue: change.newValue };
      });
      return changes.length ? { correctedAt: event.correctedAt, changes: changes } : null;
    }
    const contracts = list('contractRecalculations'), corrections = list('supervisorCorrections');
    const financialAudit = { contractRecalculations: contracts.map(contract), supervisorCorrections: corrections.map(correction).filter(Boolean) };
    if (saved.lastContractRecalculation) financialAudit.lastContractRecalculation = contract(saved.lastContractRecalculation);
    if (saved.lastSupervisorCorrection) financialAudit.lastSupervisorCorrection = correction(saved.lastSupervisorCorrection);
    if (contracts.length >= 30 || corrections.length >= 30) financialAudit.financialHistoryTruncated = true;
    if (invalid) financialAudit.financialHistoryInvalid = true;
    return { recordId: String(row[COL.ID - 1]), status: STATUS.PUBLISHED, registeredAt: isoValue_(row[COL.REGISTERED_AT - 1]),
      base: String(row[COL.BASE - 1] || ''), crewLeader: String(row[COL.CREW_LEADER - 1] || ''),
      totalServices: row[COL.TOTAL - 1] == null || row[COL.TOTAL - 1] === '' ? null : row[COL.TOTAL - 1], audit: financialAudit };
  });
}

function fiscalAccountKey_(user) { return sha256_(normalize_(cleanText_(user, 120))); }
function fiscalAccounts_() {
  const values = safeJson_(PropertiesService.getScriptProperties().getProperty('FISCAL_ACCOUNTS_V1') || '{}', {});
  return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
}
function fiscalAccount_(user) {
  const account = fiscalAccounts_()[fiscalAccountKey_(user)];
  if (!account || account.active !== true || normalize_(account.user) !== normalize_(user) || !account.revision || !account.salt || !/^[a-f0-9]{64}$/i.test(account.passwordHash || '')) throw apiError_('AUTH_REQUIRED', 'Credencial fiscal inválida ou revogada.');
  const bases = (Array.isArray(account.bases) ? account.bases : []).map(featureBase_).filter(Boolean).filter(function (base, index, all) { return all.indexOf(base) === index; });
  if (!bases.length) throw apiError_('AUTH_REQUIRED', 'Este fiscal não possui Bases autorizadas.');
  return Object.assign({}, account, { bases: bases });
}
function fiscalSession_(auth) {
  const account = fiscalAccount_(auth.user);
  if (auth.aclRevision !== account.revision) throw apiError_('AUTH_REQUIRED', 'A autorização fiscal mudou. Entre novamente.');
  return Object.assign({}, auth, { user: account.user, bases: account.bases });
}
function loginFiscal_(payload) {
  let account;
  try { account = fiscalAccount_(payload.user); } catch (error) { throw apiError_('INVALID_CREDENTIALS', 'Nome, perfil ou senha inválidos.'); }
  if (!payload.password || !constantTimeEquals_(sha256_(account.salt + '\n' + String(payload.password)), account.passwordHash)) throw apiError_('INVALID_CREDENTIALS', 'Nome, perfil ou senha inválidos.');
  const expiresAt = Date.now() + APP.sessionHours * 60 * 60 * 1000;
  return { ok: true, success: true, user: account.user, role: 'fiscal', bases: account.bases, token: createToken_(account.user, 'fiscal', expiresAt, account.revision), expiresAt: new Date(expiresAt).toISOString() };
}

// Owner-only provisioning: not present in doPost routes and never reachable by an app session.
// The operator supplies a precomputed salted hash, never a plaintext password.
function configureFiscalAccount_(configuration) {
  const user = cleanText_(configuration && configuration.user, 120), salt = String(configuration && configuration.salt || '');
  const hash = String(configuration && configuration.passwordHash || '');
  const bases = (configuration && Array.isArray(configuration.bases) ? configuration.bases : []).map(featureBase_);
  if (!user || salt.length < 32 || !/^[a-f0-9]{64}$/i.test(hash) || !bases.length || bases.some(function (base) { return !base; })) throw apiError_('INVALID_FISCAL_CONFIG', 'Informe identidade, hash com salt e Bases oficiais.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const accounts = fiscalAccounts_();
    accounts[fiscalAccountKey_(user)] = { user: user, salt: salt, passwordHash: hash, bases: bases.filter(function (base, index, all) { return all.indexOf(base) === index; }), active: configuration.active !== false, revision: Utilities.getUuid() };
    PropertiesService.getScriptProperties().setProperty('FISCAL_ACCOUNTS_V1', JSON.stringify(accounts));
    return { user: user, bases: bases, active: configuration.active !== false };
  } finally { lock.releaseLock(); }
}

function authorizeDocumentRow_(auth, row) {
  if (auth.role === 'fiscal') {
    const current = fiscalSession_(auth);
    if (current.bases.indexOf(featureBase_(row[COL.BASE - 1])) < 0) throw apiError_('FORBIDDEN', 'Ocorrência não disponível nas Bases autorizadas.');
  } else if (auth.role !== 'supervisor') assertOwner_(auth, row[COL.USER - 1]);
}

function fiscalRecordSummary_(row) {
  return { recordId: String(row[COL.ID - 1]), occurrenceNumber: String(row[COL.OCCURRENCE_NUMBER - 1] || ''), registeredAt: isoValue_(row[COL.REGISTERED_AT - 1]), updatedAt: isoValue_(row[COL.UPDATED_AT - 1]), base: featureBase_(row[COL.BASE - 1]), team: String(row[COL.TEAM - 1] || ''), crewLeader: String(row[COL.CREW_LEADER - 1] || ''), user: String(row[COL.USER - 1] || ''), status: operationalStatusFromValues_(row), totalServices: Number(row[COL.TOTAL - 1]) || 0, occurrenceTypes: String(row[COL.TYPES - 1] || '').split(' | ').filter(Boolean) };
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
  return { ok: true, success: true, bases: bases, summary: summary, records: records.slice(offset, offset + limit).map(fiscalRecordSummary_), offset: offset, nextOffset: offset + limit < records.length ? offset + limit : null, calculatedAt: nowIso_() };
}

function occurrenceDocumentData_(row, spreadsheet) {
  const id = String(row[COL.ID - 1]), audit = safeJson_(row[COL.AUDIT - 1], {}), published = String(row[COL.STATUS - 1]) === STATUS.PUBLISHED;
  const model = correctionDataFromValues_(row);
  if (published) {
    model.services = Array.isArray(audit.finalServices) ? audit.finalServices : (loadServicesMap_(spreadsheet)[id] || []);
    model.materials = loadMaterialsMap_(spreadsheet)[id] || [];
  }
  model.services = model.services.map(function (item) { return { code: String(item.code || ''), catalogText: String(item.catalogText || item.description || ''), unit: String(item.unit || ''), contract: String(item.contract || model.contract), quantity: Number(item.quantity), referenceValue: Number(item.referenceValue), totalValue: Number(item.totalValue) }; });
  model.materials = model.materials.map(function (item) { return { code: String(item.code || ''), description: String(item.description || ''), unit: String(item.unit || ''), quantity: Number(item.quantity) }; });
  const transformer = model.occurrenceTypes.indexOf(TYPES[0]) >= 0;
  return Object.assign({}, model, { user: String(row[COL.USER - 1] || ''), registeredAt: isoValue_(row[COL.REGISTERED_AT - 1]), updatedAt: isoValue_(row[COL.UPDATED_AT - 1]), reviewedAt: isoValue_(row[COL.REVIEWED_AT - 1]), publishedAt: published ? String(audit.publishedAt || row[COL.REVIEWED_AT - 1] || '') : '', status: operationalStatusFromValues_(row), reason: String(row[COL.REASON - 1] || ''), supervisorNote: String(row[COL.SUPERVISOR_NOTE - 1] || ''), supervisor: String(row[COL.SUPERVISOR - 1] || ''),
    audit: { lastCorrectionRequest: { reason: String(row[COL.REASON - 1] || ''), note: String(row[COL.SUPERVISOR_NOTE - 1] || ''), supervisor: String(row[COL.SUPERVISOR - 1] || ''), requestedAt: isoValue_(row[COL.REVIEWED_AT - 1]) }, timeline: (Array.isArray(audit.timeline) ? audit.timeline : []).map(function (event) { return { action: String(event.action || ''), actor: String(event.actor || ''), at: String(event.at || ''), detail: String(event.detail || '') }; }) },
    photoSlots: Array.from({ length: transformer ? 7 : 5 }, function (_, index) { const slot = index + 1; return { photoIndex: slot, confirmed: photoSlotConfirmed_(row, audit, slot) }; }) });
}
function getOccurrenceDocument_(payload) {
  const auth = requireSession_(payload.token, ['field', 'supervisor', 'fiscal']), id = requireUuid_(payload.recordId);
  const found = findAcrossMainSheets_(id); if (!found) throw apiError_(auth.role === 'fiscal' ? 'FORBIDDEN' : 'RECORD_NOT_FOUND', auth.role === 'fiscal' ? 'Ocorrência não disponível nas Bases autorizadas.' : 'Ocorrência não encontrada.');
  authorizeDocumentRow_(auth, found.values);
  const status = operationalStatusFromValues_(found.values);
  if (auth.role !== 'fiscal' && !payload.detail && [STATUS.WAITING_SUPERVISOR, STATUS.PUBLISHED, STATUS.APPROVED].indexOf(status) < 0) throw apiError_('RECORD_NOT_READY', 'PDF disponível nas ocorrências aguardando conferência ou publicadas.');
  return { ok: true, success: true, record: occurrenceDocumentData_(found.values, spreadsheet_()) };
}
function getDocumentPhoto_(payload) {
  const auth = requireSession_(payload.token, ['field', 'supervisor', 'fiscal']), id = requireUuid_(payload.recordId), index = Number(payload.photoIndex);
  if (!Number.isInteger(index) || index < 1 || index > 7) throw apiError_('INVALID_PHOTO_INDEX', 'Foto inválida.');
  const found = findAcrossMainSheets_(id); if (!found) throw apiError_(auth.role === 'fiscal' ? 'FORBIDDEN' : 'RECORD_NOT_FOUND', auth.role === 'fiscal' ? 'Ocorrência não disponível nas Bases autorizadas.' : 'Ocorrência não encontrada.');
  authorizeDocumentRow_(auth, found.values);
  const row = found.values, audit = safeJson_(row[COL.AUDIT - 1], {});
  if (index > 5 && String(row[COL.TYPES - 1]).split(' | ').indexOf(TYPES[0]) < 0) throw apiError_('INVALID_PHOTO_INDEX', 'Evidência não aplicável.');
  const missing = { ok: true, success: true, recordId: id, photoIndex: index, available: false, message: 'Foto indisponível / sincronização pendente.' };
  if (!photoSlotConfirmed_(row, audit, index)) return missing;
  const fileId = extractDriveFileId_(row[photoUrlColumn_(index) - 1]); if (!fileId) return missing;
  try {
    const file = DriveApp.getFileById(fileId); if (file.isTrashed()) return missing;
    const label = index === 6 ? 'TRAFO_RETIRADO' : index === 7 ? 'TRAFO_INSTALADO' : 'FOTO_' + index;
    const identity = String(file.getDescription() || '').split(' | '), uploadKey = String(row[photoUploadKeyColumn_(index) - 1] || '');
    if (identity[0] === APP.name && identity.length >= 3) {
      if (identity[1] !== id || identity[2] !== label || (identity[3] && uploadKey && identity[3] !== uploadKey)) return missing;
    } else {
      const name = String(file.getName() || '');
      if (name.indexOf(id + '_' + label + '.') !== 0 && name.indexOf(id + '_' + label + '_') !== 0) return missing;
    }
    const blob = file.getBlob(), bytes = blob.getBytes(), mime = blob.getContentType();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime) || !bytes.length || bytes.length > APP.maxPhotoBytes) return missing;
    // Recheck ACL and UUID+slot after Drive I/O, including revocation during the read.
    const currentAuth = requireSession_(payload.token, ['field', 'supervisor', 'fiscal']), current = findAcrossMainSheets_(id);
    if (!current) return missing; authorizeDocumentRow_(currentAuth, current.values);
    if (extractDriveFileId_(current.values[photoUrlColumn_(index) - 1]) !== fileId || !photoSlotConfirmed_(current.values, safeJson_(current.values[COL.AUDIT - 1], {}), index)) return missing;
    return { ok: true, success: true, recordId: id, photoIndex: index, available: true, dataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes) };
  } catch (error) { if (['AUTH_REQUIRED', 'FORBIDDEN'].indexOf(error.code) >= 0) throw error; return missing; }
}
