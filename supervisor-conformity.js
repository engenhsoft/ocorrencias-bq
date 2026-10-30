import { escapeHtml, formatNumber, normalizeText, operationalDate, isUuid } from './core.js?v=2026.10.30.1';

export const CONFORMITY_CATEGORIES = Object.freeze({ approved: 'Aprovadas sem edição direta', corrected: 'Corrigidas pelo Supervisor', rejected: 'Rejeitadas', requested: 'Correção solicitada à equipe' });
const list = value => Array.isArray(value) ? value : [];
const validAudit = record => record?.audit && typeof record.audit === 'object' && !Array.isArray(record.audit) ? record.audit : null;
const different = change => change && String(change.previousValue ?? '') !== String(change.newValue ?? '');

export function conformityEvents(record) {
  const audit = validAudit(record) || {}, events = { approved: [], corrected: [], rejected: [], requested: [] };
  const add = (category, at) => { if (operationalDate(at)) events[category].push(at); };
  for (const event of list(audit.timeline)) {
    if (!event?.actor) continue;
    const action = event.action, at = event.at || event.timestamp;
    if (['APROVADA', 'PUBLICADA', 'APROVADA_E_PUBLICADA'].includes(action)) add('approved', at);
    if (action === 'CORRIGIDA_PELO_SUPERVISOR') add('corrected', at);
    if (action === 'REPROVADA') add('rejected', at);
    if (['CORRECAO_SOLICITADA', 'CORRECAO_FOTOS_SOLICITADA'].includes(action)) add('requested', at);
  }
  for (const correction of [...list(audit.supervisorCorrections), audit.lastSupervisorCorrection]) {
    if (correction?.supervisor && list(correction.changes).some(different)) add('corrected', correction.correctedAt);
  }
  for (const request of [...list(audit.correctionRequests), audit.lastCorrectionRequest, audit.lastPhotoCorrectionRequest]) {
    if (request?.supervisor) { add('requested', request.requestedAt); add('requested', request.lastRequestedAt); }
  }
  if (record.supervisor) {
    if (['APROVADA', 'PUBLICADA', 'APROVADA_E_PUBLICADA'].includes(record.status)) add('approved', record.publishedAt || record.approvedAt || record.reviewedAt || audit.publishedAt);
    if (record.status === 'REPROVADA') add('rejected', record.reviewedAt);
    if (record.status === 'CORRECAO_SOLICITADA') add('requested', record.reviewedAt);
  }
  return Object.fromEntries(Object.entries(events).map(([key, dates]) => [key, [...new Set(dates)]]));
}

export function conformityIdentity(record) {
  const saved = record.audit?.registrationIdentity || list(record.audit?.timeline).find(event => event.action === 'CRIADA') || {};
  return { base: saved.base || record.base || 'Não informada', crewLeader: saved.crewLeader || record.crewLeader || 'Não informado' };
}

export function buildConformityComparison(records, { period = 'month', month = operationalDate().slice(0, 7), base = '', crewLeader = '', dimension = 'base' } = {}) {
  const byId = new Map();
  for (const record of records || []) if (isUuid(record?.recordId)) byId.set(record.recordId.toLowerCase(), record);
  const groups = new Map(), totals = { approved: 0, corrected: 0, rejected: 0, requested: 0 };
  let insufficient = 0;
  for (const record of byId.values()) {
    const audit = validAudit(record);
    if (audit?.testOnly || audit?.harness || audit?.syntheticFixture || audit?.publicationState === 'RECONCILIACAO_NECESSARIA') continue;
    const identity = conformityIdentity(record);
    if ((base && normalizeText(identity.base) !== normalizeText(base)) || (crewLeader && normalizeText(identity.crewLeader) !== normalizeText(crewLeader))) continue;
    if (!audit) { insufficient++; continue; }
    const events = conformityEvents(record);
    const inPeriod = dates => dates.some(at => period === 'all' || operationalDate(at).slice(0, 7) === month);
    const counts = { approved: !events.corrected.length && inPeriod(events.approved) ? 1 : 0, corrected: inPeriod(events.corrected) ? 1 : 0, rejected: inPeriod(events.rejected) ? 1 : 0, requested: inPeriod(events.requested) ? 1 : 0 };
    if (!Object.values(counts).some(Boolean)) continue;
    const label = identity[dimension === 'crewLeader' ? 'crewLeader' : 'base'], key = normalizeText(label);
    const group = groups.get(key) || { label, approved: 0, corrected: 0, rejected: 0, requested: 0 };
    for (const category of Object.keys(totals)) { group[category] += counts[category]; totals[category] += counts[category]; }
    groups.set(key, group);
  }
  return { groups: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')), totals, insufficient };
}

export function conformityMarkup(result, categories = ['approved', 'corrected']) {
  const text = value => escapeHtml(String(value ?? ''));
  if (result.insufficient) return '<p class="insight-empty" role="status">SEM DADOS HISTÓRICOS SUFICIENTES. Atualize para consultar o histórico confirmado.</p>';
  const keys = categories.filter(key => CONFORMITY_CATEGORIES[key]);
  const groups = result.groups.filter(group => keys.some(key => group[key] > 0));
  if (!groups.length) return '<p class="insight-empty">SEM DADOS · Nenhum evento das categorias selecionadas neste filtro.</p>';
  const max = Math.max(1, ...groups.flatMap(group => keys.map(key => group[key])));
  return `<div class="comparison-legend">${keys.map(key => `<span class="comparison-key comparison-key--${key}">${text(CONFORMITY_CATEGORIES[key])} · ${formatNumber(result.totals[key])}</span>`).join('')}</div><div class="bar-chart conformity-chart" role="img" aria-label="Aprovadas sem edição direta e corrigidas pelo Supervisor, por ${groups.length} grupos"><div class="bar-chart__plot">${groups.map(group => `<div class="comparison-group"><div class="comparison-bars">${keys.map(key => `<div class="bar-chart__column" title="${text(CONFORMITY_CATEGORIES[key])}"><strong>${formatNumber(group[key])}</strong><div class="bar-chart__track"><span class="comparison-fill--${key}" style="height:${group[key] ? Math.max(2, group[key] / max * 100) : 0}%"></span></div></div>`).join('')}</div><span class="bar-chart__label">${text(group.label)}</span></div>`).join('')}</div></div><details class="chart-data"><summary>Ver dados do gráfico</summary><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Base / chefe</th>${keys.map(key => `<th>${text(CONFORMITY_CATEGORIES[key])}</th>`).join('')}</tr></thead><tbody>${groups.map(group => `<tr><td data-label="Base / chefe">${text(group.label)}</td>${keys.map(key => `<td data-label="${text(CONFORMITY_CATEGORIES[key])}">${formatNumber(group[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

