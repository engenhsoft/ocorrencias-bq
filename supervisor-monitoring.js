import { api, confirmedCompatibility } from './api.js?v=2026.11.09.2';
import { escapeHtml, formatCurrency, formatDateTime, formatNumber, operationalDate, RECORD_STATUS, statusLabel, validDateRange } from './core.js?v=2026.11.09.2';

const text = value => escapeHtml(String(value ?? ''));
const date = value => value ? formatDateTime(value) : 'Sem confirmação';
const role = value => ({ field: 'Campo', fiscal: 'Fiscal', supervisor: 'Supervisor', 'fiscal-admin': 'Fiscal Administrador' }[value] || 'Sem confirmação');
const labels = {
  health: 'Saúde das Ocorrências', late: 'Correções Atrasadas', online: 'Usuários Online', access: 'Acessos dos Fiscais',
  history: 'Histórico e Auditoria', errors: 'Log de Erros', diagnosis: 'Diagnóstico da ocorrência', compare: 'Comparar correção'
};
const counters = { sync: 'Sincronizações pendentes', photos: 'Fotos pendentes', errors: 'Ocorrências com erro',
  corrections: 'Correções pendentes', publications: 'Publicações incompletas', unassigned: 'Sem Fiscal atribuído', recurrent: 'Problemas recorrentes' };
const severities = ['NORMAL', 'ATENÇÃO', 'CRÍTICO', 'SEM CONFIRMAÇÃO'];
const areas = ['health', 'late', 'online', 'access', 'history', 'errors'];
const placeholder = (message, type = 'status') => '<p class="insight-empty" role="' + type + '">' + text(message) + '</p>';
const facts = pairs => '<dl class="monitor-facts">' + pairs.map(([name, value]) => '<div><dt>' + text(name) + '</dt><dd>' + text(value ?? 'Sem confirmação') + '</dd></div>').join('') + '</dl>';
const select = (name, label, options) => '<label class="field"><span>' + text(label) + '</span><select name="' + name + '"><option value="">Todos</option>'
  + options.map(([value, label]) => '<option value="' + text(value) + '">' + text(label) + '</option>').join('') + '</select></label>';
const field = (name, label, type = 'text') => '<label class="field"><span>' + text(label) + '</span><input name="' + name + '" type="' + type + '"' + (type === 'text' ? ' maxlength="120"' : '') + ' /></label>';
const detailButton = id => '<button class="button button--ghost button--small" type="button" data-monitor-detail="' + text(id) + '">Abrir ocorrência</button>';
const diagnosisButton = id => '<button class="button button--ghost button--small" type="button" data-monitor-diagnosis="' + text(id) + '">Diagnosticar ocorrência</button>';

function formatDifference(value) {
  if (value == null) return 'Sem comprovação';
  if (typeof value === 'string' && /^[{[]/.test(value.trim())) {
    try { value = JSON.parse(value); } catch { return value; }
  }
  if (Array.isArray(value)) return value.map(formatDifference).join(' · ') || '—';
  if (value && typeof value === 'object') {
    if (value.code) return [value.code, value.description || value.catalogText, value.quantity == null ? '' : formatNumber(value.quantity) + ' ' + (value.unit || ''),
      value.total == null ? '' : formatCurrency(value.total)].filter(Boolean).join(' · ');
    return JSON.stringify(value);
  }
  return String(value) || '—';
}

function changesTable(changes) {
  return !Array.isArray(changes) || !changes.length ? '' : '<div class="monitor-table"><table><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>'
    + changes.map(change => {
      const amount = /^total|^valor/i.test(change.field);
      const show = value => amount && value != null && String(value).trim() && Number.isFinite(Number(value)) ? formatCurrency(Number(value)) : formatDifference(value);
      return '<tr><th scope="row">' + text(change.field) + '</th><td>' + text(show(change.previousValue)) + '</td><td>' + text(show(change.newValue)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function eventCard(event) {
  const changes = Array.isArray(event.changes) ? changesTable(event.changes) : event.changes
    ? facts(Object.entries(event.changes).map(([key, value]) => [
      ({ before: 'Permissões anteriores', after: 'Permissões confirmadas', slot: 'Slot', passwordChanged: 'Senha atualizada' })[key] || key,
      typeof value === 'boolean' ? value ? 'Sim' : 'Não' : formatDifference(value)
    ])) : '';
  return '<article class="record-card"><h4>' + text((event.type || 'Operação').replaceAll('_', ' ')) + '</h4>'
    + facts([['Data e hora', date(event.at)], ['Responsável', event.actor], ['Perfil', role(event.role)],
      ['UUID', event.recordId || 'Não aplicável'], ['Resultado', event.result], ...(event.subject ? [['Conta', event.subject]] : []),
      ...(event.previousStatus || event.status ? [['Estado anterior', event.previousStatus || '—'], ['Estado confirmado', event.status || '—']] : [])])
    + (event.reason || event.detail ? '<p>' + text([event.reason, event.detail].filter(Boolean).join(' · ')) + '</p>' : '') + changes + '</article>';
}

function errorCard(event) {
  return '<article class="record-card"><h4>' + text(event.code) + '</h4><p>' + text(event.message) + '</p>'
    + facts([['Data e hora', date(event.at)], ['Módulo', event.module], ['Etapa', event.stage || event.action],
      ['UUID', event.recordId || 'Não associado'], ['Perfil', role(event.role)], ['Gravidade', event.severity],
      ['Origem', event.origin], ['Correlação', event.correlationId], ['Aplicativo', event.frontendVersion || 'Sem confirmação'],
      ['Servidor', event.backendVersion || 'Sem confirmação'], ['Resolução', (event.resolution || '').replaceAll('_', ' ')]]) + '</article>';
}

function correctionFacts(correction) {
  return facts([['Responsável', correction.responsible || 'Aguardando atribuição'], ['Perfil', role(correction.role)],
    ['Solicitante', correction.supervisor], ['Motivo', correction.reason], ['Solicitação', date(correction.requestedAt)],
    ['Espera', correction.elapsedHours == null ? 'Sem confirmação' : formatNumber(Math.floor(correction.elapsedHours)) + ' h'],
    ...(correction.band ? [['Prazo', 'Mais de ' + correction.band + ' horas']] : [])]);
}

function healthCard(item) {
  const problems = Object.keys(counters).filter(key => item.tags[key]).map(key => counters[key]);
  return '<article class="record-card"><header class="record-card__header"><div><h4>Ocorrência ' + text(item.occurrenceNumber || 'sem número')
    + '</h4><small>' + text(item.recordId) + '</small></div><span class="status-chip status-chip--' + (item.severity === 'CRÍTICO' ? 'danger' : 'warning')
    + '">' + text(item.severity) + '</span></header><p>' + text([item.base, item.team, statusLabel(item.status)].filter(Boolean).join(' · ')) + '</p>'
    + (problems.length ? '<p>' + text(problems.join(' · ')) + '</p>' : '') + (item.correction ? correctionFacts(item.correction) : '')
    + (item.lastError ? '<p>Última falha · ' + text(item.lastError.code) + ' · ' + text(date(item.lastError.at)) + '</p>' : '')
    + '<footer class="record-card__footer">' + detailButton(item.recordId) + diagnosisButton(item.recordId) + '</footer></article>';
}

function diagnosisMarkup(result) {
  const item = result.occurrence, proof = result.persistence, photos = result.photos, sync = result.synchronization;
  const slots = list => list.length ? list.join(', ') : '—';
  return '<div class="monitor-conclusions">' + result.conclusions.map(value => '<strong>' + text(value) + '</strong>').join('') + '</div>'
    + '<section><h4>Identificação</h4>' + facts([['UUID', item.recordId], ['Número', item.occurrenceNumber], ['Base', item.base],
      ['Responsável original', item.user], ['Status', statusLabel(item.status)], ['Registro', date(item.registeredAt)], ['Última atualização', date(item.updatedAt)]]) + '</section>'
    + '<section><h4>Persistência</h4>' + facts([['Registro no servidor', proof.found ? 'Encontrado' : 'Sem confirmação'], ['Dados principais', proof.confirmed ? 'Confirmados por recibo' : 'Sem recibo'],
      ['Serviços persistidos', proof.services], ['Materiais persistidos', proof.materials], ['Publicação', proof.publication],
      ['Conflito', proof.conflict ? 'Há evidência registrada' : 'Sem conflito registrado']]) + '</section>'
    + '<section><h4>Fotografias</h4>' + facts([['Slots declarados ou obrigatórios', slots(photos.expected)], ['Slots confirmados', slots(photos.confirmed)],
      ['Slots pendentes', slots(photos.pending)], ['Gerais faltantes para o mínimo de três', photos.generalMissing],
      ['Divergência de slot ou versão', slots(photos.discrepancy)], ['Em confirmação', slots(photos.inConfirmation)],
      ['Última confirmação', date(photos.lastConfirmedAt)]]) + '<p class="insight-note">' + text(photos.localState) + '</p></section>'
    + '<section><h4>Sincronização</h4>' + facts([['Última tentativa conhecida', date(sync.lastAttempt)], ['Etapa registrada', sync.phase || 'Sem confirmação'],
      ['Último erro', sync.lastError?.code || 'Sem erro registrado'], ['Próximo passo', sync.next]]) + '</section>'
    + (result.correction ? '<section><h4>Correção formal aberta</h4>' + correctionFacts(result.correction) + '</section>' : '')
    + '<details><summary>Solicitações registradas (' + result.requests.length + ')</summary>' + result.requests.map(request => facts([['Solicitação', date(request.requestedAt)], ['Supervisor', request.supervisor], ['Motivo', request.reason]])).join('') + '</details>'
    + '<details><summary>Eventos operacionais (' + result.history.length + ')</summary>' + result.history.map(eventCard).join('') + '</details>'
    + '<details><summary>Erros correlacionados (' + result.errors.length + ')</summary>' + result.errors.map(errorCard).join('') + '</details>';
}

function comparisonMarkup(cycle) {
  const known = cycle.beforeTotal != null && cycle.afterTotal != null;
  const difference = known ? cycle.afterTotal - cycle.beforeTotal : null;
  const money = value => value == null ? 'Sem comprovação' : formatCurrency(value);
  const photos = cycle.photos.map(photo => '<article class="record-card"><h4>Slot ' + photo.slot + '</h4><div class="comparison-photos">'
    + ['before', 'after'].map(side => '<div><strong>' + (side === 'before' ? 'Foto anterior' : 'Foto corrigida') + '</strong>'
      + (photo[side] ? '<div><button class="button button--ghost button--small" type="button" data-monitor-photo="' + photo.slot + '" data-side="' + side + '">Carregar foto</button></div>'
        : '<p>' + (side === 'before' ? 'VERSÃO ANTERIOR NÃO DISPONÍVEL' : 'Versão corrigida sem comprovação') + '</p>') + '</div>').join('')
    + '</div></article>').join('');
  return facts([['Alterado por', cycle.actor], ['Perfil', role(cycle.role)], ['Solicitação original', date(cycle.requestedAt)],
    ...(cycle.supervisor || cycle.reason ? [['Solicitante', cycle.supervisor], ['Motivo da solicitação', cycle.reason]] : []),
    ['Confirmação', date(cycle.at)], ['Valor antes', money(cycle.beforeTotal)], ['Valor depois', money(cycle.afterTotal)],
    ['Diferença', money(difference)], ['Variação', !known || cycle.beforeTotal === 0 ? 'Não aplicável' : formatNumber(difference / cycle.beforeTotal * 100) + '%']])
    + changesTable(cycle.changes) + photos;
}

const github = 'https://github.com/engenhsoft/ocorrencias-bq';
const previousBackends = [
  ['2026.11.09.1', '45', 'ee4abbe905a0fb99d0f2e3e83ca0b484c6c6d590'],
  ['2026.11.06.1', '44', '584d8018b9474bad1acdabb32e023fccfa52e461'],
  ['2026.10.30.1', '43', 'af3a78a4d0fc088eaa52cff14efa83e44c762a28'],
  ['2026.10.23.3', '42', '946294a46b96329bab50f3723da40599d1829913']
];

async function versionHistory(host, current) {
  const backend = confirmedCompatibility();
  host.innerHTML = '<p>Servidor consultado · ' + text(backend?.version || 'Versão não confirmada') + '</p><ul>'
    + previousBackends.map(([version, deployment, sha]) => '<li><a target="_blank" rel="noopener" href="' + github + '/commit/' + sha
      + '">' + text(version) + ' · Apps Script ' + deployment + '</a></li>').join('') + '</ul>'
    + '<p role="status">Consultando publicações bem-sucedidas do GitHub Pages…</p>';
  try {
    const response = await fetch('https://api.github.com/repos/engenhsoft/ocorrencias-bq/actions/workflows/pages.yml/runs?branch=main&status=success&per_page=12',
      { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error();
    const result = await response.json();
    if (!current()) return;
    const runs = (result.workflow_runs || []).filter(run => run.conclusion === 'success' && run.head_branch === 'main'
      && /^[a-f0-9]{40}$/.test(run.head_sha) && Number.isSafeInteger(run.id));
    host.lastElementChild.outerHTML = runs.length ? '<ul>' + runs.map(run => '<li><a target="_blank" rel="noopener" href="' + github + '/actions/runs/' + run.id
      + '">' + text(run.display_title || run.head_sha.slice(0, 7)) + '</a> · <a target="_blank" rel="noopener" href="' + github + '/commit/' + run.head_sha
      + '">' + text(run.head_sha.slice(0, 7)) + '</a> · ' + text(date(run.updated_at)) + '</li>').join('') + '</ul>' : placeholder('Nenhuma publicação retornada pelo GitHub.');
  } catch { if (current()) host.lastElementChild.textContent = 'Histórico do GitHub temporariamente indisponível.'; }
}

export function createSupervisorMonitoring({ getSession, getRevision, onDetail, onAuthFailure }) {
  const dialog = document.querySelector('#monitorDialog'), title = dialog.querySelector('h2');
  const tabs = dialog.querySelector('#monitorTabs'), form = dialog.querySelector('#monitorFilters');
  const host = dialog.querySelector('#monitorResults'), page = dialog.querySelector('#monitorMore');
  let section, recordId, cursor, nextOffset, cycles = [], sequence = 0, lateCount = null;
  const current = (request, revision) => dialog.open && request === sequence && revision === getRevision() && getSession()?.role === 'supervisor';

  function setup(view) {
    const health = ['health', 'late'].includes(view), access = view === 'access', errors = view === 'errors';
    const periods = select('period', 'Período', [['today', 'Hoje'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['custom', 'Intervalo personalizado']]);
    const statusOptions = Object.values(RECORD_STATUS).map(status => [status, statusLabel(status)]);
    const severityOptions = severities.map(value => [value, value]);
    const filters = (health || access ? field('base', 'Base') : '') + (health ? field('team', 'Equipe') + field('responsible', 'Responsável')
      + select('status', 'Status', statusOptions) : '') + (access ? field('user', 'Nome do Fiscal') : '') + (errors ? field('recordId', 'UUID') : '')
      + (health || errors ? select('severity', 'Gravidade', severityOptions) : '');
    const daterange = '<div id="monitorDates" class="monitor-dates" hidden>' + field('from', 'Data inicial', 'date') + field('to', 'Data final', 'date') + '</div>';
    form.innerHTML = view === 'online' ? '<button class="button button--ghost" type="submit">Atualizar</button>'
      : filters + periods + daterange + '<button class="button button--primary" type="submit">Aplicar filtros</button>';
    if (form.elements.period) form.elements.period.value = health && view !== 'late' ? '30' : access || errors ? '7' : '';
    form.hidden = !areas.includes(view);
  }
  function getFilters() {
    const { period, ...filters } = Object.fromEntries(new FormData(form));
    if (period === 'custom') {
      if (!filters.from || !filters.to || !validDateRange(filters.from, filters.to)) throw Error('Selecione um intervalo válido.');
    } else {
      filters.from = period ? operationalDate(Date.now() - (Math.max(0, (Number(period) || 1) - 1) * 86400000)) : '';
      filters.to = period ? operationalDate() : '';
    }
    return filters;
  }
  function renderTabs() {
    tabs.innerHTML = areas.map(name => '<button type="button" class="button button--ghost' + (name === section ? ' is-active' : '')
      + '" data-monitor-section="' + name + '" aria-pressed="' + (name === section) + '">' + labels[name]
      + (name === 'late' && lateCount != null ? ' (' + lateCount + ')' : '') + '</button>').join('');
  }
  function render(result, append) {
    if (section === 'diagnosis') return diagnosisMarkup(result);
    if (section === 'compare') {
      cycles = result.cycles;
      if (!cycles.length) return placeholder('SEM DADOS SUFICIENTES PARA COMPARAR. O histórico desta ocorrência não preservou as duas versões.');
      return '<label class="field"><span>Ciclo de correção</span><select id="monitorCycle">'
        + cycles.map((cycle, index) => '<option value="' + index + '">' + text(date(cycle.at) + ' · ' + role(cycle.role) + ' · ' + (cycle.actor || '')) + '</option>').join('')
        + '</select></label><p>Estado atual · ' + text(statusLabel(result.status)) + '</p><div id="monitorComparison">' + comparisonMarkup(cycles[0]) + '</div>';
    }
    if (section === 'health' || section === 'late') {
      if (!append && !Object.values(getFilters()).some(Boolean)) {
        lateCount = result.counts.late;
        renderTabs();
      }
      const summary = append ? '' : '<p><strong>' + formatNumber(result.total) + '</strong> ' + (section === 'late' ? 'correções acima de 24 horas' : 'ocorrências no filtro') + '.</p>'
        + (section === 'health' ? facts(Object.entries(counters).map(([key, label]) => [label, result.counts[key]]))
          + '<p class="insight-note">Indicadores baseados nos registros do servidor. Falhas e recorrências usam a janela de eventos recentes.</p>'
          + (result.latest.length ? '<details><summary>Últimas falhas registradas</summary>' + result.latest.map(errorCard).join('') + '</details>' : '')
          + (!result.errorsAvailable ? placeholder('Log técnico indisponível no servidor.') : '') : '');
      return summary + (result.items.length ? result.items.map(healthCard).join('') : placeholder('Nenhuma ocorrência neste filtro.'));
    }
    if (section === 'online') return '<p class="insight-note">Presença estimada pelos sinais recentes da sessão. Inativo após 5 minutos. Sessões sem sinal por 15 minutos aparecem como desconectadas enquanto o cache estiver disponível.</p>'
      + (result.items.length ? result.items.map(item => '<article class="record-card"><h4>' + text(item.user) + '</h4>'
        + facts([['Perfil', role(item.role)], ['Identidade', item.identity === 'DECLARADA' ? 'Declarada no modo Campo' : 'Conta Fiscal autenticada'],
          ['Base', item.base || item.bases.join(', ') || 'Sem confirmação'], ['Equipe', item.team || 'Sem confirmação'],
          ['Última atividade', date(item.at)], ['Presença estimada', item.state]]) + '</article>').join('') : placeholder('Nenhum sinal recente de presença.'));
    if (section === 'access') return (result.available ? '' : placeholder('Registro de acessos indisponível no servidor.'))
      + (result.items.length ? result.items.map(item => '<article class="record-card"><h4>' + text(item.user) + '</h4>'
        + facts([['Evento', item.type.replaceAll('_', ' ')], ['Data e hora', date(item.at)], ['Conta', item.accountId], ['Bases autorizadas', item.bases.join(', ')],
          ['Sessão', item.sessionId], ['Estado', item.state.replaceAll('_', ' ')], ['Expiração da sessão', date(item.expiresAt)],
          ['Aplicativo', item.frontendVersion || 'Sem confirmação']]) + '</article>').join('') : placeholder('Nenhum acesso encontrado nesta página.'));
    if (section === 'errors') return (result.available ? '' : placeholder('Log técnico indisponível no servidor.'))
      + (result.items.length ? result.items.map(errorCard).join('') : placeholder('Nenhum erro encontrado nesta página.'));
    const versions = append ? '' : '<details id="monitorVersions"><summary>Histórico de versões publicadas</summary><div></div></details>';
    return versions + (result.items.length ? result.items.map(eventCard).join('') : placeholder('Nenhum evento encontrado nesta página.'));
  }

  async function load(append = false) {
    const session = getSession();
    if (session?.role !== 'supervisor') return;
    const revision = getRevision(), request = ++sequence;
    if (!append) { cursor = null; nextOffset = null; host.innerHTML = placeholder('Consultando evidências…'); }
    page.hidden = true;
    try {
      const filters = getFilters();
      const result = await api.supervisorMonitor(session.token, section, { filters: { ...filters, offset: nextOffset }, recordId, cursor });
      if (!current(request, revision)) return;
      const content = render(result, append);
      if (append) host.insertAdjacentHTML('beforeend', content);
      else host.innerHTML = content;
      cursor = result.cursor;
      nextOffset = result.nextOffset;
      page.hidden = !cursor && nextOffset == null;
      const versions = host.querySelector('#monitorVersions');
      if (!append && versions) versions.addEventListener('toggle', () => {
        if (versions.open && !versions.dataset.loaded) {
          versions.dataset.loaded = '1';
          void versionHistory(versions.lastElementChild, () => dialog.open && host.contains(versions) && revision === getRevision());
        }
      });
    } catch (error) {
      if (!current(request, revision)) return;
      host.innerHTML = placeholder(error.message || 'A consulta não foi confirmada.', 'alert');
      if (error.code === 'AUTH_REQUIRED') onAuthFailure();
    }
  }

  function open(view = 'health', id = '') {
    if (getSession()?.role !== 'supervisor' || !Object.hasOwn(labels, view)) return;
    section = view; recordId = id; cycles = [];
    title.textContent = labels[view];
    tabs.hidden = !areas.includes(view);
    renderTabs(); setup(view);
    if (!dialog.open) dialog.showModal();
    void load();
  }
  form.addEventListener('submit', event => { event.preventDefault(); void load(); });
  form.addEventListener('change', event => {
    if (event.target.name === 'period') form.querySelector('#monitorDates').hidden = event.target.value !== 'custom';
  });
  page.addEventListener('click', () => void load(true));
  host.addEventListener('change', event => {
    if (event.target.id === 'monitorCycle') host.querySelector('#monitorComparison').innerHTML = comparisonMarkup(cycles[Number(event.target.value)]);
  });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || getSession()?.role !== 'supervisor') return;
    if (button.dataset.monitorSection) open(button.dataset.monitorSection);
    if (button.dataset.monitorDiagnosis) open('diagnosis', button.dataset.monitorDiagnosis);
    if (button.dataset.monitorDetail) { dialog.close(); onDetail(button.dataset.monitorDetail); }
    if (!button.dataset.monitorPhoto) return;
    const request = sequence, revision = getRevision(), id = recordId;
    const cycle = cycles[Number(host.querySelector('#monitorCycle').value)];
    const index = Number(button.dataset.monitorPhoto), side = button.dataset.side;
    button.disabled = true;
    try {
      const result = await api.supervisorMonitor(getSession().token, 'comparisonPhoto', { recordId: id, cycleId: cycle.cycleId, photoIndex: index, side });
      if (!current(request, revision) || !button.isConnected) return;
      if (result.recordId !== id || result.cycleId !== cycle.cycleId || result.photoIndex !== index || result.side !== side
        || !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(result.dataUrl)) {
        button.replaceWith(document.createTextNode(side === 'before' ? 'VERSÃO ANTERIOR NÃO DISPONÍVEL' : 'Versão corrigida indisponível'));
        return;
      }
      const image = new Image();
      image.alt = (side === 'before' ? 'Foto anterior' : 'Foto corrigida') + ' do slot ' + index;
      image.src = result.dataUrl;
      button.replaceWith(image);
    } catch (error) {
      if (current(request, revision) && button.isConnected) {
        button.disabled = false; button.textContent = 'Tentar carregar novamente';
        if (error.code === 'AUTH_REQUIRED') onAuthFailure();
      }
    }
  });
  const reset = () => { sequence++; lateCount = null; cycles = []; if (dialog.open) dialog.close(); host.innerHTML = ''; };
  return { open, reset };
}
