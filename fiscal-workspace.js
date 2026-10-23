import { getFiscalCorrectionDrafts } from './db.js?v=2026.10.23.3';
import { api, ApiError } from './api.js?v=2026.10.23.3';
import { synchronizationFeedback, escapeHtml, formatNumber, normalizeText, sameUser, isUuid, operationalDate } from './core.js?v=2026.10.23.3';
import { buildConformityComparison, conformityMarkup } from './supervisor-conformity.js?v=2026.10.23.3';
import { buildFinancialComparison, financialMarkup } from './supervisor-financial.js?v=2026.10.23.3';

const text = value => escapeHtml(String(value ?? ''));
export function createFiscalWorkspace({ getSession, getRevision, onLogout, onCorrection, onRetry, topThreeMarkup, barsMarkup }) {
  const $ = selector => document.querySelector(selector);
  let generation = 0, summary = null, summaryTask = null, correctionTask = null, records = [], accounts = [], panel = 'consult', financialView = 'current';
  let localDrafts = new Map(), confirmedMessage = '';
  const scope = () => JSON.stringify([generation, getRevision(), getSession()?.token, getSession()?.user, (getSession()?.bases || []).map(normalizeText).sort()]);
  const current = key => getSession()?.role === 'fiscal' && key === scope();
  const allowedBase = base => (getSession()?.bases || []).some(item => normalizeText(item) === normalizeText(base));
  // A UUID can have drafts from several correction requests/assignments. Keep
  // those separate, just as IndexedDB does, so an old retry cannot mask a new one.
  const draftIdentity = record => JSON.stringify([record.recordId, record.fiscalCorrection?.routingVersion,
    record.fiscalCorrection?.routingRequestId, record.fiscalCorrection?.assignmentRevision,
    normalizeText(record.fiscalCorrection?.assignedFiscal)]);
  const localDraftFor = record => localDrafts.get(draftIdentity(record));
  function latestDrafts() {
    const latest = new Map();
    for (const local of localDrafts.values()) {
      const previous = latest.get(local.recordId);
      if (!previous || String(local.updatedAt || '') >= String(previous.updatedAt || '')) latest.set(local.recordId, local);
    }
    return latest;
  }
  function error(host, failure) {
    host.textContent = failure.message || 'Não foi possível carregar. Atualize para tentar novamente.';
    if (failure.code === 'AUTH_REQUIRED') onLogout();
  }
  function setPanel(next) {
    panel = ['consult', 'corrections', 'indicators'].includes(next) ? next : 'consult';
    for (const name of ['consult', 'corrections', 'indicators']) {
      $(`#fiscal${name[0].toUpperCase() + name.slice(1)}Panel`).hidden = name !== panel;
      const button = $(`[data-fiscal-panel="${name}"]`); button.setAttribute('aria-selected', String(name === panel)); button.classList.toggle('is-active', name === panel);
    }
  }
  function renderCorrections() {
    const visible = records.filter(record => localDraftFor(record)?.syncPhase !== 'confirmed');
    for (const local of latestDrafts().values()) {
      if (!records.some(record => record.recordId === local.recordId) && local.correctionMode && local.syncPhase !== 'confirmed') {
        visible.push({ ...local, canCorrect: false, retryLocal: true });
      }
    }
    const count = visible.filter(record => record.canCorrect || record.retryLocal).length;
    $('#fiscalCorrectionCount').textContent = formatNumber(count);
    $('#fiscalCorrectionsStatus').textContent = confirmedMessage || `${count} ${count === 1 ? 'correção atribuída a você' : 'correções atribuídas a você'}.`;
    $('#fiscalCorrectionsList').innerHTML = visible.length ? visible.map(record => {
      const local = localDraftFor(record);
      const feedback = local ? synchronizationFeedback(local) : null;
      const busy = feedback && ['sending', 'photos', 'confirming'].includes(feedback.phase);
      const sync = feedback ? `<p class="sync-feedback" role="status" aria-live="polite"><strong>${text(feedback.label)}</strong><br>${text(feedback.detail)}</p>` : '';
      const retry = local && local.correctionMode && !['saved', 'confirmed'].includes(feedback?.phase) || record.retryLocal;
      const route = record.fiscalCorrection, legacy = route.routingVersion === 'LEGACY_FIELD', waiting = route.assignmentStatus === 'WAITING_ASSIGNMENT';
      const candidates = accounts.filter(account => account.active && account.bases.includes(route.base));
      const assignment = getSession()?.canManageFiscals && !legacy ? `<div class="fiscal-assignment"><label class="field"><span>Fiscal responsável · ${text(route.base)}</span><select data-assignment-for="${text(record.recordId)}"><option value="">Selecionar Fiscal ativo</option>${candidates.map(account => `<option value="${text(account.user)}"${account.user === route.assignedFiscal ? ' selected' : ''}>${text(account.user)}</option>`).join('')}</select></label><button class="button button--ghost" type="button" data-fiscal-assign="${text(record.recordId)}">Atribuir / transferir</button></div>` : '';
      return `<article class="record-card fiscal-correction-card"><header class="record-card__header"><div><h3>Ocorrência ${text(record.occurrenceNumber || 'sem número')}</h3><small>${text(record.recordId)}</small></div><span class="status-chip status-chip--warning">${legacy ? 'Solicitação anterior' : waiting ? 'Aguardando atribuição' : 'Correção solicitada'}</span></header><p>${text(record.base)} · ${text(record.team)} · ${text(record.crewLeader)}</p><div class="correction-request-callout"><strong>Solicitação do Supervisor</strong><p>${text(record.supervisorNote || record.reason)}</p></div><p>${legacy ? 'Esta solicitação anterior permanece com o usuário Campo original.' : waiting ? 'A conta mestra deve atribuir um Fiscal ativo desta Base.' : `Responsável: ${text(route.assignedFiscal)}`}</p>${sync}${retry ? `<button class="button button--primary" type="button" data-fiscal-retry="${text(record.recordId)}" ${busy ? 'disabled' : ''}>${busy ? 'Sincronizando…' : 'SINCRONIZAR AGORA / tentar novamente'}</button>` : ''}${record.canCorrect && !busy ? `<button class="button button--warning" type="button" data-fiscal-correct="${text(record.recordId)}">CORRIGIR / retomar rascunho</button>` : ''}${assignment}</article>`;
    }).join('') : '<p class="insight-empty">Nenhuma solicitação de correção nas suas Bases.</p>';
  }
  async function refreshCorrections() {
    if (getSession()?.role !== 'fiscal') return;
    if (correctionTask) return correctionTask;
    const key = scope(), session = getSession();
    $('#fiscalCorrectionsStatus').textContent = 'Consultando solicitações…';
    const task = (async () => {
      try {
        const [result, directory, drafts] = await Promise.all([api.listFiscalCorrections(session.token), session.canManageFiscals ? api.listFiscalAccounts(session.token) : Promise.resolve({ accounts: [] }), getFiscalCorrectionDrafts(session.user, session.aclRevision || '')]);
        if (!current(key)) return;
        if (!Array.isArray(result.records) || result.records.some(record => !isUuid(record?.recordId) || !allowedBase(record.base) || !record.fiscalCorrection || record.canCorrect && !sameUser(record.fiscalCorrection.assignedFiscal, session.user))) throw new ApiError('A consulta de correções retornou dados incompletos.', 'INVALID_FISCAL_LIST');
        const fetchedDrafts = new Map();
        for (const local of [...drafts.filter(record => allowedBase(record.base)), ...localDrafts.values()]) {
          const id = draftIdentity(local), previous = fetchedDrafts.get(id);
          if (!previous || String(local.updatedAt || '') >= String(previous.updatedAt || '')) fetchedDrafts.set(id, local);
        }
        localDrafts = fetchedDrafts;
        records = result.records;
        accounts = directory.accounts || []; renderCorrections();
      } catch (failure) { if (current(key)) error($('#fiscalCorrectionsStatus'), failure); }
    })();
    correctionTask = task; try { await task; } finally { if (correctionTask === task) correctionTask = null; }
  }
  function options(selector, values) {
    const select = $(selector), saved = select.value;
    select.innerHTML = '<option value="">Todos</option>' + [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(value => `<option>${text(value)}</option>`).join('');
    if ([...select.options].some(option => option.value === saved)) select.value = saved;
  }
  function renderIndicators() {
    if (!summary) return;
    const period = $('#fiscalIndicatorPeriod').value, base = $('#fiscalIndicatorBase').value;
    const items = (summary.bases[period] || []).filter(item => !base || item.label === base);
    $('#fiscalBaseChart').innerHTML = barsMarkup(items);
    $('#fiscalConformityChart').innerHTML = conformityMarkup(buildConformityComparison(summary.conformityRecords, { period, month: summary.month, base,
      crewLeader: $('#fiscalIndicatorLeader').value, dimension: $('#fiscalConformityDimension').value }), ['approved', 'corrected', ...($('#fiscalShowRejected').checked ? ['rejected'] : []), ...($('#fiscalShowRequested').checked ? ['requested'] : [])]);
    const financePeriod = $('#fiscalFinancialPeriod').value;
    $('#fiscalFinancialChart').innerHTML = financialMarkup(buildFinancialComparison(summary.financialRecords, { period: financePeriod === 'all' ? 'all' : 'month', month: /^\d{4}-\d{2}$/.test(financePeriod) ? financePeriod : summary.month,
      base: $('#fiscalFinancialBase').value, crewLeader: $('#fiscalFinancialLeader').value, team: $('#fiscalFinancialTeam').value }), financialView);
  }
  async function refreshSummary(force = false) {
    if (getSession()?.role !== 'fiscal') return;
    if (summaryTask) return summaryTask;
    if (summary && !force) return summary;
    const key = scope(), token = getSession().token;
    $('#fiscalIndicatorsStatus').textContent = 'Carregando indicadores confirmados…';
    const task = (async () => {
      try {
        const result = await api.getOperationalSummary(token);
        if (!current(key)) return;
        if (!Array.isArray(result.authorizedBases) || !result.aclRevision || result.authorizedBases.some(base => !allowedBase(base)) || !Array.isArray(result.top3) || !result.bases || !Array.isArray(result.conformityRecords) || !Array.isArray(result.financialRecords)
          || [...result.conformityRecords, ...result.financialRecords].some(record => !allowedBase(record.base))
          || ['month', 'all'].some(period => !Array.isArray(result.bases[period]) || result.bases[period].some(item => !allowedBase(item.label)))) throw new ApiError('Os indicadores não confirmaram as Bases autorizadas. Atualize para tentar novamente.', 'INVALID_SUMMARY');
        summary = result;
        $('#fiscalRanking').innerHTML = topThreeMarkup(summary);
        options('#fiscalIndicatorBase', result.authorizedBases); options('#fiscalIndicatorLeader', result.conformityRecords.map(record => record.crewLeader));
        options('#fiscalFinancialBase', result.authorizedBases); options('#fiscalFinancialLeader', result.financialRecords.map(record => record.crewLeader)); options('#fiscalFinancialTeam', result.financialRecords.map(record => record.team));
        const months = [...new Set(result.financialRecords.map(record => record.registeredAt ? operationalDate(record.registeredAt).slice(0, 7) : '').filter(value => /^\d{4}-\d{2}$/.test(value) && value !== result.month))].sort().reverse();
        $('#fiscalFinancialPeriod').innerHTML = '<option value="month">Mês atual</option><option value="all">Todo o histórico</option>' + months.map(month => `<option>${text(month)}</option>`).join('');
        renderIndicators(); $('#fiscalIndicatorsStatus').textContent = `Indicadores das Bases autorizadas · mês ${result.month} · fuso Bahia.`;
      } catch (failure) { if (current(key)) error($('#fiscalIndicatorsStatus'), failure); }
    })();
    summaryTask = task; try { return await task; } finally { if (summaryTask === task) summaryTask = null; }
  }
  async function correct(id, button) {
    const record = records.find(item => item.recordId === id && item.canCorrect); if (!record) return;
    const key = scope(); button.disabled = true;
    try {
      const result = await api.openFiscalCorrection(getSession().token, id, record.fiscalCorrection);
      if (!current(key)) return;
      if (result.record?.recordId !== id || !allowedBase(result.record.base) || result.record.fiscalCorrection?.assignmentRevision !== record.fiscalCorrection.assignmentRevision) throw new ApiError('A solicitação mudou. Atualize a lista.', 'FISCAL_ASSIGNMENT_CHANGED');
      await onCorrection(result.record);
    } catch (failure) { if (current(key)) error($('#fiscalCorrectionsStatus'), failure); }
    finally { if (current(key)) button.disabled = false; }
  }
  async function assign(id, button) {
    const record = records.find(item => item.recordId === id); if (!record || !getSession()?.canManageFiscals) return;
    const key = scope(), assignedFiscal = $(`[data-assignment-for="${id}"]`).value;
    if (!assignedFiscal) { $('#fiscalCorrectionsStatus').textContent = 'Selecione o Fiscal responsável.'; return; }
    button.disabled = true;
    try {
      await api.reassignFiscalCorrection(getSession().token, { recordId: id, assignedFiscal, routingRequestId: record.fiscalCorrection.routingRequestId, expectedRevision: record.fiscalCorrection.assignmentRevision });
      if (current(key)) {
        await refreshCorrections();
        if (current(key)) $('#fiscalCorrectionsStatus').textContent = 'Atribuição confirmada. Dados já gravados foram preservados; rascunhos anteriores continuam no aparelho de origem.';
      }
    } catch (failure) { if (current(key)) error($('#fiscalCorrectionsStatus'), failure); }
    finally { if (current(key)) button.disabled = false; }
  }
  $('#view-fiscal').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || getSession()?.role !== 'fiscal') return;
    if (button.dataset.fiscalPanel) setPanel(button.dataset.fiscalPanel);
    if (button.dataset.fiscalRetry) void retry(button.dataset.fiscalRetry, button);
    if (button.dataset.fiscalCorrect) void correct(button.dataset.fiscalCorrect, button);
    if (button.dataset.fiscalAssign) void assign(button.dataset.fiscalAssign, button);
    if (button.id === 'fiscalCorrectionsRefresh') void refreshCorrections();
    if (button.id === 'fiscalIndicatorsRefresh') void refreshSummary(true);
    if (button.dataset.fiscalFinancialView) {
      financialView = button.dataset.fiscalFinancialView;
      for (const tab of document.querySelectorAll('[data-fiscal-financial-view]')) { tab.classList.toggle('is-active', tab === button); tab.setAttribute('aria-selected', String(tab === button)); }
      renderIndicators();
    }
  });
  $('#fiscalIndicatorsPanel').addEventListener('change', renderIndicators);
  function syncChanged(record) {
    if (getSession()?.role !== 'fiscal' || !sameUser(record.fiscalCorrection?.assignedFiscal, getSession().user)
      || String(record.fiscalAclRevision || '') !== String(getSession().aclRevision || '') || !allowedBase(record.base)) return;
    const identity = draftIdentity(record), previous = localDrafts.get(identity);
    if (previous && String(previous.updatedAt || '') > String(record.updatedAt || '')) return;
    localDrafts.set(identity, record);
    if (record.syncPhase === 'confirmed') {
      if (!records.some(item => item.recordId === record.recordId && draftIdentity(item) !== identity)) {
        confirmedMessage = `CORREÇÃO REENVIADA · ocorrência ${record.occurrenceNumber || record.recordId}. Dados e fotos confirmados.`;
      }
      // Retain the current route until the next server list. Its confirmation
      // hides this card without allowing a draft from an older route to return.
    }
    renderCorrections();
  }
  async function retry(id, button) {
    const assigned = records.find(record => record.recordId === id);
    const record = assigned ? localDraftFor(assigned) : latestDrafts().get(id); if (!record || !onRetry) return;
    const key = scope(); button.disabled = true;
    try { await onRetry(id, record.fiscalDraftKey); }
    catch (failure) { if (current(key)) error($('#fiscalCorrectionsStatus'), failure); }
    finally { if (current(key)) { button.disabled = false; renderCorrections(); } }
  }
  function reset() { generation++; localDrafts = new Map(); confirmedMessage = '';  summary = null; summaryTask = null; correctionTask = null; records = []; accounts = []; financialView = 'current'; $('#fiscalCorrectionCount').textContent = '0';
    for (const id of ['fiscalCorrectionsList', 'fiscalRanking', 'fiscalBaseChart', 'fiscalConformityChart', 'fiscalFinancialChart']) $('#' + id).innerHTML = '';
    for (const id of ['fiscalIndicatorBase', 'fiscalIndicatorLeader', 'fiscalFinancialBase', 'fiscalFinancialLeader', 'fiscalFinancialTeam']) $('#' + id).innerHTML = '<option value="">Todos</option>';
    $('#fiscalConformityDimension').value = 'base'; $('#fiscalShowRejected').checked = false; $('#fiscalShowRequested').checked = false;
    for (const tab of document.querySelectorAll('[data-fiscal-financial-view]')) { const active = tab.dataset.fiscalFinancialView === 'current'; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)); }
    $('#fiscalIndicatorPeriod').value = 'month'; $('#fiscalFinancialPeriod').innerHTML = '<option value="month">Mês atual</option><option value="all">Todo o histórico</option>'; setPanel('consult');
  }
  function enter() { reset(); void refreshCorrections(); void refreshSummary(); }
  function confirmed() { summary = null; void refreshCorrections(); void refreshSummary(true); }
  return { enter, reset, confirmed, syncChanged, refreshCorrections, refreshSummary, setPanel };
}
