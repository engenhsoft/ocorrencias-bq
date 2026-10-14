import { escapeHtml, formatCurrency, formatNumber, formatDateTime, normalizePhotoStates, sameUser, statusLabel, RECORD_STATUS } from './core.js?v=2026.10.14.3';
import { api, ApiError } from './api.js?v=2026.10.14.3';

const text = value => escapeHtml(String(value ?? ''));
const percent = value => value == null ? 'SEM DADOS' : `${formatNumber(value)}%`;
export function entryPendingRecords(records, user) {
  const byId = new Map();
  for (const record of records || []) if (record?.recordId && sameUser(record.user, user)) byId.set(record.recordId, record);
  const owned = [...byId.values()];
  return {
    photos: owned.filter(record => record.status !== RECORD_STATUS.DRAFT && (record.status === RECORD_STATUS.SYNCING_PHOTOS || normalizePhotoStates(record.photoStates).some(photo => photo.localReady && (!photo.confirmed || photo.replacePending)))),
    corrections: owned.filter(record => record.status === RECORD_STATUS.CORRECTION_REQUESTED || (record.status === RECORD_STATUS.DRAFT && record.correctionMode && record.serverStatus === RECORD_STATUS.CORRECTION_REQUESTED))
  };
}

export function topThreeMarkup(summary) {
  const leaders = summary?.top3 || [];
  return `<section class="insight-card"><header class="insight-heading"><div><p class="eyebrow">Produção do mês · ${text(summary?.month || '')}</p><h3>TOP 3 mensal</h3></div><span class="insight-tag">Chefes de turma</span></header><div class="top-three">${leaders.length ? leaders.map((leader, index) => `<article class="ranking-place ranking-place--${index + 1}"><span class="ranking-avatar" aria-hidden="true">${text(leader.crewLeader.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join(''))}</span><span class="ranking-position">${index + 1}º lugar</span><h4>${text(leader.crewLeader)}</h4><p>${text(leader.team)}<br>${text(leader.base)}</p><strong>${text(formatNumber(leader.count))} ${leader.count === 1 ? 'ocorrência' : 'ocorrências'}</strong>${leader.totalServices == null ? '' : `<small>${text(formatCurrency(leader.totalServices))}</small>`}</article>`).join('') : '<p class="insight-empty">Ainda não há ocorrências elegíveis neste mês.</p>'}</div><p class="insight-note">Aguardando conferência e aprovadas/publicadas, pela data original de registro no fuso Bahia. Quantidade por UUID, com desempate pelo nome.</p><small class="insight-updated">Atualizado em ${text(formatDateTime(summary?.calculatedAt))}</small></section>`;
}

export function barsMarkup(items, nonconformity = false) {
  if (!items?.length) return `<p class="insight-empty">${nonconformity ? 'SEM DADOS · Nenhuma decisão de conferência neste período.' : 'Nenhuma ocorrência elegível neste período.'}</p>`;
  const max = Math.max(1, ...(items || []).map(item => nonconformity ? item.percentage || 0 : item.count));
  return `<div class="bar-chart ${nonconformity ? 'bar-chart--rates' : ''}" role="img" aria-label="${nonconformity ? 'Taxa de não conformidade' : 'Quantidade de ocorrências por Base'}"><div class="bar-chart__plot">${(items || []).map(item => {
    const value = nonconformity ? item.percentage : item.count;
    return `<div class="bar-chart__column"><strong>${text(nonconformity ? percent(value) : formatNumber(value))}</strong><div class="bar-chart__track"><span style="height:${value == null ? 0 : Math.max(value > 0 ? 2 : 0, Number(value) / max * 100)}%"></span></div><span class="bar-chart__label">${text(item.label)}</span><small>${text(nonconformity ? `${item.nonconforming}/${item.analysed} analisadas` : percent(item.percentage))}</small></div>`;
  }).join('')}</div></div><details class="chart-data"><summary>Ver dados do gráfico</summary><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Base / chefe</th><th>${nonconformity ? 'Analisadas' : 'Ocorrências'}</th>${nonconformity ? '<th>Não conformes</th>' : ''}<th>Percentual</th></tr></thead><tbody>${(items || []).map(item => `<tr><td data-label="Base / chefe">${text(item.label)}</td><td data-label="${nonconformity ? 'Analisadas' : 'Ocorrências'}">${text(nonconformity ? item.analysed : item.count)}</td>${nonconformity ? `<td data-label="Não conformes">${text(item.nonconforming)}</td>` : ''}<td data-label="Percentual">${text(percent(item.percentage))}</td></tr>`).join('')}</tbody></table></div></details>`;
}

export function createOperationalFeatures({ getSession, getRevision, onNavigate, onCorrection, onSynchronize, onOpenRecord, onLogout }) {
  const $ = selector => document.querySelector(selector);
  let summary = null, summaryTask = null, fiscalTask = null, summaryRevision = -1, fiscalRevision = -1;
  let entryRevision = -1, noticeConsumed = false, pendingNotice = null, fiscalOffset = 0, fiscalNextOffset = null, fiscalSequence = 0;
  const current = (revision, token) => getRevision() === revision && getSession()?.token === token;
  function message(host, error) { if (host) host.innerHTML = `<p class="insight-empty" role="status">${text(error?.message || 'Dados indisponíveis. Atualize para tentar novamente.')}</p>`; }
  function renderSummary() {
    if (!summary) return;
    if (getSession()?.role === 'field') for (const selector of ['#fieldInsights', '#mineInsights']) { const host = $(selector); if (host) host.innerHTML = topThreeMarkup(summary); }
    if (getSession()?.role !== 'supervisor') return;
    $('#supervisorRanking').innerHTML = topThreeMarkup(summary);
    renderCharts();
  }
  function renderCharts() {
    if (!summary?.bases || getSession()?.role !== 'supervisor') return;
    const basePeriod = $('#baseChartPeriod')?.value || 'month', ratePeriod = $('#rateChartPeriod')?.value || 'month', dimension = $('#rateChartDimension')?.value || 'base';
    $('#baseChart').innerHTML = barsMarkup(summary.bases[basePeriod] || []);
    if ($('#nonconformitySection')?.hidden === false) $('#rateChart').innerHTML = barsMarkup(summary.nonconformity?.[ratePeriod]?.[dimension] || [], true);
  }
  function setView(view) {
    const section = $('#nonconformitySection');
    if (!section) return;
    section.hidden = getSession()?.role !== 'supervisor' || view !== 'supervisor';
    if (section.hidden) $('#rateChart').innerHTML = '';
    else renderCharts();
  }
  async function refreshSummary(force = false) {
    const session = getSession(), revision = getRevision();
    if (!session || !['field', 'supervisor'].includes(session.role) || !navigator.onLine) return;
    if (summaryTask && summaryRevision === revision) return summaryTask;
    if (!force && summary && summaryRevision === revision) return summary;
    summaryRevision = revision;
    const task = (async () => {
      try {
        const result = await api.getOperationalSummary(session.token);
        if (!current(revision, session.token)) return;
        if (!Array.isArray(result.top3) || !/^\d{4}-\d{2}$/.test(result.month) || (session.role === 'supervisor' && (!result.bases || !result.nonconformity))) throw new ApiError('O resumo retornou dados incompletos. Tente novamente.', 'INVALID_SUMMARY');
        summary = result; renderSummary(); return result;
      } catch (error) {
        if (!current(revision, session.token)) return;
        for (const selector of session.role === 'supervisor' ? ['#supervisorRanking', '#baseChart', '#rateChart'] : ['#fieldInsights', '#mineInsights']) message($(selector), error);
        if (error.code === 'AUTH_REQUIRED') onLogout();
      }
    })();
    summaryTask = task; try { return await task; } finally { if (summaryTask === task) summaryTask = null; }
  }
  function maybeShowNotice() {
    const dialog = $('#entryPendingDialog');
    if (!pendingNotice || noticeConsumed || entryRevision !== getRevision() || getSession()?.role !== 'field' || !dialog) return;
    if ([...document.querySelectorAll('dialog')].some(item => item.open)) return;
    const { photos, corrections } = pendingNotice;
    $('#entryPendingContent').innerHTML = `${photos.length ? `<section><h3>Fotografias aguardando sincronização</h3><p>Existem ${photos.length} ${photos.length === 1 ? 'ocorrência com fotos pendentes' : 'ocorrências com fotos pendentes'}.</p><button class="button button--primary" type="button" data-entry-sync>Sincronizar agora</button></section>` : ''}${corrections.length ? `<section><h3>Correções solicitadas</h3><p>${corrections.length === 1 ? 'Existe 1 ocorrência aguardando sua correção.' : `Existem ${corrections.length} ocorrências aguardando sua correção.`}</p><div class="entry-correction-list">${corrections.map(record => `<button class="button button--warning" type="button" data-entry-correction="${text(record.recordId)}">Ir para correção · ${text(record.occurrenceNumber || record.recordId)}</button>`).join('')}</div></section>` : ''}`;
    noticeConsumed = true; dialog.showModal();
  }
  function acceptMine(records) {
    if (noticeConsumed || entryRevision !== getRevision() || getSession()?.role !== 'field') return;
    const result = entryPendingRecords(records, getSession().user);
    if (!result.photos.length && !result.corrections.length) { pendingNotice = null; return; }
    pendingNotice = result; maybeShowNotice();
  }
  function fiscalFilters() {
    return Object.fromEntries(['base', 'team', 'crewLeader', 'status', 'period', 'from', 'to', 'search'].map(key => [key, $(`#fiscal-${key}`)?.value || '']));
  }
  async function refreshFiscal(offset = 0) {
    const session = getSession(), revision = getRevision();
    if (session?.role !== 'fiscal') return;
    const sequence = ++fiscalSequence; fiscalOffset = offset; fiscalRevision = revision;
    const host = $('#fiscalList'); host.setAttribute('aria-busy', 'true');
    const request = (async () => {
      try {
        const result = await api.listFiscalRecords(session.token, fiscalFilters(), offset);
        if (!current(revision, session.token) || sequence !== fiscalSequence) return;
        if (!Array.isArray(result.records) || !Array.isArray(result.bases) || !result.summary) throw new ApiError('A consulta fiscal retornou dados incompletos.', 'INVALID_FISCAL_LIST');
        $('#fiscalAuthorizedBases').textContent = `Bases autorizadas: ${result.bases.join(' · ')}`;
        const select = $('#fiscal-base'), selectedBase = select.value;
        select.innerHTML = `<option value="">Todas as autorizadas</option>${result.bases.map(base => `<option value="${text(base)}">${text(base)}</option>`).join('')}`; select.value = selectedBase;
        const labels = [['total', 'Total de ocorrências'], ['waiting', 'Aguardando conferência'], ['published', 'Publicadas / aprovadas'], ['correction', 'Aguardando correção'], ['rejected', 'Reprovadas'], ['photoPending', 'Fotos pendentes']];
        $('#fiscalKpis').innerHTML = labels.map(([key, label]) => `<article class="supervisor-kpi"><span>${text(label)}</span><strong>${text(formatNumber(result.summary[key]))}</strong></article>`).join('') + `<article class="supervisor-kpi fiscal-value"><span>Valor das aguardando e aprovadas/publicadas elegíveis</span><strong>${text(formatCurrency(result.summary.eligibleValue))}</strong></article>`;
        host.innerHTML = result.records.length ? result.records.map(record => `<article class="record-card"><header class="record-card__header"><div><h3>Ocorrência ${text(record.occurrenceNumber)}</h3><small>${text(record.recordId)}</small></div><span class="status-chip">${text(statusLabel(record.status))}</span></header><p>${text(record.base)} · ${text(record.team)} · ${text(record.crewLeader)}</p><p>${text(formatDateTime(record.registeredAt))} · ${text(formatCurrency(record.totalServices))}</p><footer class="record-card__footer"><button class="button button--ghost" type="button" data-fiscal-detail="${text(record.recordId)}">Visualizar</button><button class="button button--primary" type="button" data-export-record="${text(record.recordId)}">Gerar PDF</button></footer></article>`).join('') : '<p class="insight-empty">Nenhuma ocorrência neste filtro.</p>';
        fiscalNextOffset = result.nextOffset;
        $('#fiscalPrevious').disabled = !offset; $('#fiscalNext').disabled = fiscalNextOffset == null;
        $('#fiscalResultCount').textContent = `${result.summary.total} ocorrências · atualizado em ${formatDateTime(result.calculatedAt)}`;
      } catch (error) { if (current(revision, session.token) && sequence === fiscalSequence) { message(host, error); $('#fiscalKpis').innerHTML = ''; if (error.code === 'AUTH_REQUIRED') onLogout(); } }
      finally { if (current(revision, session.token) && sequence === fiscalSequence) host.setAttribute('aria-busy', 'false'); }
    })();
    fiscalTask = request; try { await request; } finally { if (fiscalTask === request) fiscalTask = null; }
  }
  async function openFiscalDetail(recordId, button) {
    const session = getSession(), revision = getRevision(); if (session?.role !== 'fiscal') return;
    const original = button.textContent; button.disabled = true; button.textContent = 'Carregando…';
    try {
      const result = await api.getOccurrenceDocument(session.token, recordId, true);
      if (!current(revision, session.token)) return;
      const record = result.record; if (record?.recordId !== recordId) throw new ApiError('Detalhe de outra ocorrência foi recusado.', 'INVALID_RECORD_STATE');
      record.fiscalView = true;
      record.photos = Array(5).fill(''); record.transformerPhotos = { removed: '', installed: '' };
      for (const slot of record.photoSlots || []) {
        if (!slot.confirmed) continue;
        const photo = await api.getDocumentPhoto(session.token, recordId, slot.photoIndex);
        if (!current(revision, session.token)) return;
        if (!photo.available || photo.recordId !== recordId || photo.photoIndex !== slot.photoIndex || !/^data:image\//.test(photo.dataUrl || '')) continue;
        if (slot.photoIndex <= 5) record.photos[slot.photoIndex - 1] = photo.dataUrl;
        else record.transformerPhotos[slot.photoIndex === 6 ? 'removed' : 'installed'] = photo.dataUrl;
      }
      record.photoStates = (record.photoSlots || []).map(slot => ({ photoIndex: slot.photoIndex, confirmed: slot.confirmed, serverUrl: slot.photoIndex <= 5 ? record.photos[slot.photoIndex - 1] : record.transformerPhotos[slot.photoIndex === 6 ? 'removed' : 'installed'] }));
      onOpenRecord(record);
    } catch (error) { if (current(revision, session.token)) { $('#fiscalResultCount').textContent = error.message; if (error.code === 'AUTH_REQUIRED') onLogout(); } }
    finally { if (current(revision, session.token)) { button.disabled = false; button.textContent = original; } }
  }
  async function exportDocument(recordId, button) {
    const session = getSession(), revision = getRevision(); if (!session) return;
    const original = button.textContent; button.disabled = true; button.textContent = 'Gerando PDF…';
    try {
      const result = await api.getOccurrenceDocument(session.token, recordId);
      if (!current(revision, session.token)) return;
      if (result.record?.recordId !== recordId) throw new ApiError('A exportação de outra ocorrência foi recusada.', 'INVALID_RECORD_STATE');
      const { createOccurrencePdf, downloadOccurrencePdf } = await import('./occurrence-pdf.js?v=2026.10.14.3');
      const output = await createOccurrencePdf(result.record, { getPhoto: async index => {
        if (!current(revision, session.token)) throw new ApiError('A sessão mudou durante a exportação.', 'AUTH_REQUIRED');
        const photo = await api.getDocumentPhoto(session.token, recordId, index);
        if (!current(revision, session.token)) throw new ApiError('A sessão mudou durante a exportação.', 'AUTH_REQUIRED');
        return photo;
      } });
      if (current(revision, session.token)) downloadOccurrencePdf(output);
    } catch (error) { if (current(revision, session.token)) { button.textContent = error.message || 'Falha ao gerar PDF'; if (error.code === 'AUTH_REQUIRED') onLogout(); return; } }
    finally { if (current(revision, session.token)) { button.disabled = false; if (button.textContent === 'Gerando PDF…') button.textContent = original; } }
  }
  function reset() {
    if ($('#nonconformitySection')) $('#nonconformitySection').hidden = true;
    entryRevision = -1; noticeConsumed = false; pendingNotice = null; summary = null; summaryTask = null; fiscalTask = null; summaryRevision = -1; fiscalRevision = -1; fiscalSequence++;
    if ($('#entryPendingDialog')?.open) $('#entryPendingDialog').close();
    for (const selector of ['#fieldInsights', '#mineInsights', '#supervisorRanking', '#baseChart', '#rateChart', '#fiscalList', '#fiscalKpis', '#mineDetailContent', '#reviewDialogContent']) if ($(selector)) $(selector).innerHTML = '';
    $('#photoDialogImage')?.removeAttribute('src');
    if ($('#fiscalAuthorizedBases')) $('#fiscalAuthorizedBases').textContent = '';
    if ($('#fiscalResultCount')) $('#fiscalResultCount').textContent = '';
    for (const selector of ['#baseChartPeriod', '#rateChartPeriod']) if ($(selector)) $(selector).value = 'month';
    if ($('#rateChartDimension')) $('#rateChartDimension').value = 'base';
    for (const key of ['base', 'team', 'crewLeader', 'status', 'from', 'to', 'search']) if ($(`#fiscal-${key}`)) $(`#fiscal-${key}`).value = '';
    if ($('#fiscal-period')) $('#fiscal-period').value = 'month';
  }
  function enter() { reset(); entryRevision = getRevision(); if (getSession()?.role === 'fiscal') void refreshFiscal(); }
  document.addEventListener('close', maybeShowNotice, true);
  document.addEventListener('change', event => {
    if (['baseChartPeriod', 'rateChartPeriod', 'rateChartDimension'].includes(event.target.id)) renderCharts();
    if (event.target.closest('#fiscalFilters') && event.target.type !== 'search' && getSession()?.role === 'fiscal') void refreshFiscal();
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.hasAttribute('data-entry-sync')) { $('#entryPendingDialog').close(); onNavigate('sync'); onSynchronize(); }
    if (target.dataset.entryCorrection) { const id = target.dataset.entryCorrection; if (pendingNotice?.corrections.some(record => record.recordId === id)) { $('#entryPendingDialog').close(); onCorrection(id); } }
    if (target.dataset.exportRecord) void exportDocument(target.dataset.exportRecord, target);
    if (target.dataset.fiscalDetail) void openFiscalDetail(target.dataset.fiscalDetail, target);
    if (target.id === 'fiscalRefresh' || target.id === 'fiscalApplyFilters') void refreshFiscal();
    if (target.id === 'fiscalPrevious') void refreshFiscal(Math.max(0, fiscalOffset - 60));
    if (target.id === 'fiscalNext' && fiscalNextOffset != null) void refreshFiscal(fiscalNextOffset);
    if (target.hasAttribute('data-refresh-insights')) void refreshSummary(true);
  });
  return { enter, reset, setView, refreshSummary, acceptMine, refreshFiscal };
}
