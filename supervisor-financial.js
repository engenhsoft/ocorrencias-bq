import { escapeHtml, formatCurrency, formatNumber, isUuid, normalizeText, operationalDate } from './core.js?v=2026.10.18.1';

const list = value => Array.isArray(value) ? value : [];
const text = value => escapeHtml(String(value ?? ''));
const totalField = field => normalizeText(field) === 'TOTAL DA OCORRENCIA';

// Missing values are never zero. Keep the saved precision until the aggregate.
export function financialNumber(value) {
  if (typeof value === 'string') {
    value = value.trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
    if (value.includes(',')) value = value.replace(/\./g, '').replace(',', '.');
    if (!/^[+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
  } else if (typeof value !== 'number') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// Equal timestamps can be the same intervention recorded in both audit arrays.
// A unique connected value chain proves its start; ambiguous chains stay pending.
function simultaneousInitial(events) {
  if (events.some(event => event.previous == null)) return null;
  const previous = [...new Set(events.map(event => event.previous))];
  if (previous.length === 1) return previous[0];
  if (events.some(event => event.next == null)) return null;
  const edges = [...new Map(events.map(event => [`${event.previous}|${event.next}`, event])).values()];
  const changes = edges.filter(event => event.previous !== event.next);
  const starts = [...new Set(changes.map(event => event.previous))].filter(value => !changes.some(event => event.next === value));
  if (starts.length !== 1) return null;
  let value = starts[0]; const remaining = [...edges];
  while (remaining.length) {
    for (let i = remaining.length - 1; i >= 0; i--) if (remaining[i].previous === value && remaining[i].next === value) remaining.splice(i, 1);
    if (!remaining.length) return starts[0];
    const choices = remaining.filter(event => event.previous === value);
    if (choices.length !== 1) return null;
    const event = choices[0]; remaining.splice(remaining.indexOf(event), 1); value = event.next;
  }
  return starts[0];
}

export function initialFinancialValue(record) {
  const audit = record?.audit;
  const pending = reason => ({ sent: null, source: '', firstAt: '', pending: reason });
  if (!audit || typeof audit !== 'object' || Array.isArray(audit) || audit.financialHistoryInvalid) return pending('Histórico financeiro ausente ou inválido.');
  const events = [];
  const add = (at, previous, next, source) => events.push({ at: String(at || ''), time: Date.parse(at), previous: financialNumber(previous), next: financialNumber(next), source });
  for (const key of ['contractRecalculations', 'supervisorCorrections', 'fiscalCorrections']) if (audit[key] != null && !Array.isArray(audit[key])) return pending('Formato do histórico financeiro inválido.');
  const contracts = list(audit.contractRecalculations), corrections = list(audit.supervisorCorrections), fiscalCorrections = list(audit.fiscalCorrections);
  if (audit.financialHistoryTruncated || contracts.length >= 30 || corrections.length >= 30 || fiscalCorrections.length >= 30) return pending('Histórico no limite de retenção; a primeira intervenção precisa ser comprovada.');
  for (const event of [...contracts, audit.lastContractRecalculation].filter(Boolean)) add(event.recalculatedAt, event.previousTotal, event.newTotal, 'contractRecalculations.previousTotal');
  for (const event of [...corrections, audit.lastSupervisorCorrection].filter(Boolean)) {
    if (!Array.isArray(event.changes)) return pending('Correção sem detalhamento que permita verificar o valor anterior.');
    const changes = event.changes.filter(change => change && totalField(change.field));
    if (changes.length) for (const change of changes) add(event.correctedAt, change.previousValue, change.newValue, 'supervisorCorrections.Total da ocorrência.previousValue');
  }
  for (const event of [...fiscalCorrections, audit.firstFiscalFinancialIntervention].filter(Boolean)) {
    if (!Array.isArray(event.changes)) return pending('Correção fiscal sem detalhamento financeiro.');
    for (const change of event.changes.filter(change => change && totalField(change.field))) add(event.correctedAt, change.previousValue, change.newValue, 'fiscalCorrections.Total da ocorrência.previousValue');
  }
  if (!events.length) return { sent: financialNumber(record.totalServices), source: 'TOTAL DOS SERVIÇOS (sem intervenção financeira)', firstAt: '', pending: '' };
  if (events.some(event => !Number.isFinite(event.time))) return pending('Intervenção financeira sem data válida; ordem cronológica não comprovada.');
  events.sort((a, b) => a.time - b.time);
  const first = events.filter(event => event.time === events[0].time), sent = simultaneousInitial(first);
  if (sent == null) return pending('Valor anterior à primeira intervenção ausente ou ordem ambígua no mesmo horário.');
  return { sent, source: first.find(event => event.previous === sent).source, firstAt: events[0].at, pending: '' };
}

// Compensated addition avoids rounding each occurrence before summing.
function sum(values) {
  let total = 0, compensation = 0;
  for (const value of values) { const adjusted = value - compensation, next = total + adjusted; compensation = (next - total) - adjusted; total = next; }
  return total;
}

export function publishedFinancialRecords(records) {
  return list(records).filter(record => isUuid(record?.recordId) && record.status === 'PUBLICADA'
    && !record.audit?.testOnly && !record.audit?.harness && !record.audit?.syntheticFixture
    && record.audit?.publicationState !== 'RECONCILIACAO_NECESSARIA');
}

export function buildFinancialComparison(records, { period = 'month', month = operationalDate().slice(0, 7), base = '', crewLeader = '', team = '' } = {}) {
  const byId = new Map(), conflicts = new Set();
  for (const record of publishedFinancialRecords(records)) {
    const key = record.recordId.toLowerCase(), previous = byId.get(key);
    if (previous && JSON.stringify([previous.registeredAt, previous.base, previous.crewLeader, previous.totalServices, initialFinancialValue(previous)]) !== JSON.stringify([record.registeredAt, record.base, record.crewLeader, record.totalServices, initialFinancialValue(record)])) conflicts.add(key);
    byId.set(key, record);
  }
  const items = [], pending = [];
  let count = 0;
  for (const [recordId, record] of byId) {
    if ((team && normalizeText(record.team) !== normalizeText(team)) || (base && normalizeText(record.base) !== normalizeText(base)) || (crewLeader && normalizeText(record.crewLeader) !== normalizeText(crewLeader))) continue;
    const date = record.registeredAt ? operationalDate(record.registeredAt) : '';
    if (period !== 'all' && date && date.slice(0, 7) !== month) continue;
    count++;
    const initial = initialFinancialValue(record), corrected = financialNumber(record.totalServices);
    let reason = conflicts.has(recordId) ? 'UUID duplicado com valores ou identidades divergentes.' : period !== 'all' && !date ? 'Data de registro ausente ou inválida; período não comprovado.' : corrected == null ? 'TOTAL DOS SERVIÇOS ausente ou inválido.' : initial.pending;
    if (reason) pending.push({ recordId, reason });
    items.push({ recordId, sent: reason ? null : initial.sent, corrected: conflicts.has(recordId) || (period !== 'all' && !date) ? null : corrected, source: initial.source, firstAt: initial.firstAt });
  }
  const corrected = items.some(item => item.corrected == null) ? null : sum(items.map(item => item.corrected));
  const sent = items.some(item => item.sent == null) ? null : sum(items.map(item => item.sent));
  const difference = sent == null || corrected == null ? null : corrected - sent;
  return { count, comparable: items.filter(item => item.sent != null && item.corrected != null).length, sent, corrected, difference, reduction: difference == null ? null : -difference, percentage: sent > 0 && difference != null ? difference / sent * 100 : null, pending, items };
}

export function financialMarkup(result, view = 'current') {
  const compare = view === 'comparison', currency = value => value == null ? 'Não comprovado' : formatCurrency(value);
  const count = `<p class="financial-count">${formatNumber(result.count)} ${result.count === 1 ? 'ocorrência publicada' : 'ocorrências publicadas'}</p>`;
  const issues = result.pending.length ? `<details class="financial-pending"><summary>${formatNumber(result.pending.length)} ${result.pending.length === 1 ? 'pendência de dados' : 'pendências de dados'}</summary><ul>${result.pending.map(item => `<li><code>${text(item.recordId)}</code> · ${text(item.reason)}</li>`).join('')}</ul><p>O comparativo completo aguarda comprovação. Valor final conhecido: ${text(currency(result.corrected))}.</p></details>` : '';
  if (!result.count) return `${count}<p class="insight-empty">Nenhuma ocorrência publicada neste filtro.</p>`;
  if (result.corrected == null || (compare && result.sent == null)) return `${count}<p class="insight-empty" role="status">Dados insuficientes para comprovar o total deste filtro.</p>${issues}`;
  const bars = compare ? [['Valor enviado pela equipe', result.sent, 'sent'], ['Valor corrigido/final', result.corrected, 'corrected']] : [['Valor atual', result.corrected, 'corrected']];
  const max = Math.max(1, ...bars.map(item => item[1]));
  const delta = compare ? `<div class="financial-delta"><span>Diferença (final − enviado)<strong>${text(currency(result.difference))}</strong></span><span>Variação<strong>${result.percentage == null ? 'Não aplicável (enviado zero)' : `${result.percentage > 0 ? '+' : ''}${text(formatNumber(result.percentage))}%`}</strong></span></div>` : '<p class="insight-note">Total final confirmado dos serviços das ocorrências publicadas do filtro.</p>';
  return `${count}<div class="financial-bars" role="img" aria-label="${text(bars.map(item => `${item[0]}: ${currency(item[1])}`).join('; '))}">${bars.map(([label, value, key]) => `<div class="financial-bar"><div><span>${text(label)}</span><strong>${text(currency(value))}</strong></div><div class="financial-track" aria-hidden="true"><span class="financial-fill--${key}" style="width:${value / max * 100}%"></span></div></div>`).join('')}</div>${delta}${issues}`;
}
