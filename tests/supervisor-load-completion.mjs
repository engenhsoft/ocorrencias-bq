import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const [appSource, apiSource, coreSource, previousHarness] = await Promise.all([
  read('app.js'), read('api.js'), read('core.js'), read('tests/login-initial-load.mjs')
]);
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const core = await import(dataUrl(coreSource));
const { ApiError } = await import(dataUrl(apiSource.replace(/^import .*?;\n/, "const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec'; const MATERIAL_CATALOG_SOURCE={};\n")));
const extract = (source, name) => {
  const result = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(result, name); return result[0];
};
const waits = [];
const loadOccurrenceDataset = vm.runInNewContext(extract(apiSource, 'loadOccurrenceDataset') + '\nloadOccurrenceDataset', {
  ApiError, setTimeout: (done, delay) => { waits.push(delay); queueMicrotask(done); }
});
const element = () => ({ hidden: false, innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, attributes: {},
  classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; } });
const emptyPayload = () => ({ records: [], pendingRecords: [], metricRecords: [] });
const appHarness = vm.runInNewContext(extract(previousHarness, 'appHarness') + '\nappHarness', {
  core, ApiError, appSource, loadOccurrenceDataset, element, emptyPayload, extract, vm, Date, Map, Set
});
const record = (index = 1, status = core.RECORD_STATUS.WAITING_SUPERVISOR) => ({
  recordId: `uuid-${index}`, occurrenceNumber: '00001', status, base: 'CAICÓ', team: 'LM TESTE', crewLeader: 'Chefe TESTE',
  user: 'Campo TESTE', registeredAt: new Date().toISOString(), occurrenceTypes: ['PODA'], services: [], materials: [], photos: []
});
const payload = records => ({ ok: true, success: true, records, pendingRecords: [], metricRecords: records.map(({ recordId, status }) => ({ recordId, status })) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const numericUi = ['supervisorKpiTotal', 'supervisorKpiWaiting', 'supervisorKpiCorrection', 'supervisorKpiRejected', 'supervisorKpiSync',
  'supervisorOccurrencesBadge', 'supervisorPendingBadge', 'supervisorPublishedBadge', 'supervisorPhotosBadge', 'supervisorCorrectionBadge'];

function harness(source = appSource) {
  const h = appHarness('supervisor', source), c = h.c;
  c.supervisorLoadState = 'idle';
  c.supervisorLastLoadedAt = '';
  c.supervisorFiltersByTab = Object.fromEntries(['occurrences', 'pending', 'published'].map(tab => [tab, { search: '', base: '', team: '', type: '', from: '', to: '', mode: 'period' }]));
  c.publishedDetailCache = new Map(); c.publishedVisibleLimit = 60; c.previewUrls = new Map();
  c.TYPE_TRAFO = 'SUBSTITUIÇÃO DE TRAFO'; c.TYPE_POST = 'SUBSTITUIÇÃO DE POSTE'; c.TYPE_CONDUCTOR = 'SUBSTITUIÇÃO DE CONDUTOR'; c.TYPE_OTHER = 'OUTRO';
  c.console = { error: (...args) => h.events.push({ level: 'error', args }), warn: (...args) => h.events.push({ level: 'warn', args }) };
  // Executar os helpers reais de filtros, KPIs, badges, cards e seleção; somente o DOM é simulado.
  const names = ['populateSupervisorFilters', 'supervisorPublishedRecords', 'dateForSupervisorRecord', 'supervisorFilterRange',
    'filteredSupervisorRecords', 'renderSupervisorNavigation', 'pendingCountLabel', 'setSupervisorSummary', 'supervisorActiveRecords',
    'supervisorActiveCountLabel', 'photoUrlsForRecord', 'photoFallbackUrl', 'occurrenceTypesText', 'correctionRequest',
    'correctionRequestMarkup', 'photoIndexLabel', 'pendingSupervisorCard', 'publishedSupervisorCard', 'supervisorPricingIssues',
    'selectableSupervisorRecords', 'updateSupervisorSelectionUi'];
  vm.runInContext(names.map(name => extract(source, name)).join('\n'), c);
  return h;
}

function transport(source = apiSource, handler = () => new Promise(() => {})) {
  const timers = [], signals = [];
  let now = 0;
  const c = { URL, AbortController, navigator: { onLine: true },
    setTimeout: (fn, ms) => { const timer = { fn, ms, due: now + ms, cleared: false, fired: false }; timers.push(timer); return timer; },
    clearTimeout: timer => { timer.cleared = true; },
    fetch: (url, options) => { signals.push(options.signal); return handler(url, options); }
  };
  vm.createContext(c);
  vm.runInContext(source.replace(/^import .*?;\n/, "const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec'; const MATERIAL_CATALOG_SOURCE={};\n").replace(/^export /gm, '') + '\nthis.client=api; this.WireApiError=ApiError;', c);
  const advance = async ms => { now += ms; for (const timer of timers) if (!timer.cleared && !timer.fired && timer.due <= now) { timer.fired = true; timer.fn(); } await tick(); };
  return { c, timers, signals, advance };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
if (process.argv[2] && process.argv[3]) {
  const [oldApp, oldApi] = await Promise.all([readFile(process.argv[2], 'utf8'), readFile(process.argv[3], 'utf8')]);
  test('baseline: exceção antes do try deixa loading ativo e nenhuma request', async () => {
    const h = harness(oldApp); let calls = 0;
    h.c.renderSupervisorNavigation = () => { throw Error('render fixture'); };
    h.c.api.listPending = async () => { calls++; return payload([record()]); };
    await assert.rejects(h.c.refreshSupervisor());
    assert.equal(calls, 0); assert.equal(h.c.supervisorLoading, true); assert.equal(h.elements.refreshSupervisorButton.disabled, true);
    assert.equal(h.c.supervisorRefreshPromise, null);
  });
  test('baseline: transporte que ignora abort permanece pendente depois de 60s', async () => {
    const h = transport(oldApi); let settled = false;
    h.c.client.listPending('fixture').then(() => { settled = true; }, () => { settled = true; });
    h.timers[0].fn(); await tick(); assert.equal(h.signals[0].aborted, true); assert.equal(settled, false);
  });
  test('baseline: 29 registros válidos + um inválido rejeitam o painel inteiro', async () => {
    const h = harness(oldApp); h.c.api.listPending = async () => ({ ...payload(Array.from({ length: 29 }, (_, i) => record(i))), records: [...Array.from({ length: 29 }, (_, i) => record(i)), null] });
    await h.c.refreshSupervisor(); assert.equal(h.c.supervisorDataLoaded, false); assert.match(h.elements.supervisorList.innerHTML, /data-supervisor-retry/);
  });
}

test('login dispara uma autenticação e uma lista; UI real aplica KPIs, badges e cards', async () => {
  const h = harness(); let auth = 0, lists = 0;
  h.c.api.login = async () => { auth++; return { token: 'fixture', user: 'Supervisor TESTE', role: 'supervisor' }; };
  h.c.api.listPending = async () => { lists++; return payload([record()]); };
  await h.c.handleLogin({ preventDefault() {} }); await h.c.supervisorRefreshPromise;
  assert.equal(auth, 1); assert.equal(lists, 1); assert.equal(h.c.supervisorLoadState, 'success');
  assert.equal(h.c.supervisorLoading, false); assert.equal(h.c.supervisorRefreshPromise, null);
  assert.match(h.elements.supervisorList.innerHTML, /uuid-1/); assert.doesNotMatch(h.elements.supervisorList.innerHTML, /Não foi possível exibir/); assert.equal(h.elements.supervisorKpiWaiting.textContent, 1);
  for (const key of numericUi) assert.ok(Number.isFinite(Number(h.elements[key].textContent)), key);
  assert.equal(h.elements.supervisorList.attributes['aria-busy'], 'false');
  assert.ok(h.c.supervisorLastLoadedAt); assert.equal(h.elements.supervisorFilterSummary.dataset.updatedAt, h.c.supervisorLastLoadedAt);
});
test('mount + ativação + filtros compartilham a mesma Promise e uma lista', async () => {
  const h = harness(), data = deferred(); let calls = 0;
  h.c.api.listPending = () => { calls++; return data.promise; };
  const first = h.c.refreshSupervisor(), second = h.c.refreshSupervisor(); assert.equal(first, second);
  h.c.supervisorFiltersByTab.occurrences.mode = 'today'; h.c.renderSupervisorList();
  const third = h.c.navigate('supervisor'); assert.equal(first, third);
  await tick(); assert.equal(calls, 1); data.resolve(payload([record()])); await first;
  assert.equal(h.c.supervisorLoadState, 'success'); assert.equal(h.elements.supervisorKpiWaiting.textContent, 1);
});
test('15 segundos simulados não abortam resposta nem bloqueiam filtros locais', async () => {
  const data = deferred(), wire = transport(apiSource, () => data.promise), h = harness();
  h.c.api.listPending = token => wire.c.client.listPending(token);
  const request = h.c.refreshSupervisor(); await tick();
  assert.equal(wire.timers[0].ms, 60000); assert.equal(wire.signals[0].aborted, false);
  h.c.supervisorFiltersByTab.occurrences.mode = 'today'; h.c.renderSupervisorList();
  assert.equal(h.c.supervisorLoading, true); assert.match(h.elements.supervisorFilterSummary.textContent, /Carregando/);
  wire.c.setTimeout(() => data.resolve({ ok: true, status: 200, text: async () => JSON.stringify(payload([record()])) }), 15000);
  await wire.advance(14999); assert.equal(h.c.supervisorLoading, true); assert.equal(wire.signals[0].aborted, false);
  await wire.advance(1); await request;
  assert.equal(h.c.supervisorLoading, false); assert.equal(wire.signals[0].aborted, false); assert.equal(wire.timers[0].cleared, true);
  assert.match(h.elements.supervisorList.innerHTML, /uuid-1/);
});
for (const code of ['TIMEOUT', 'NETWORK_ERROR', 'HTTP_SERVER_ERROR', 'SERVICE_UNAVAILABLE']) {
  test(`${code}: somente um retry, depois SUCCESS numérico`, async () => {
    const h = harness(); let calls = 0;
    h.c.api.listPending = async () => { if (++calls === 1) throw new ApiError('transitório', code); return payload([record()]); };
    await h.c.refreshSupervisor(); assert.equal(calls, 2); assert.equal(h.c.supervisorLoadState, 'success'); assert.equal(h.c.supervisorLoading, false);
  });
}
test('duas falhas terminam em ERROR; tentativa manual cria Promise e request novas', async () => {
  const h = harness(); let calls = 0;
  h.c.api.listPending = async () => { calls++; throw new ApiError('sem resposta', 'TIMEOUT'); };
  const first = h.c.refreshSupervisor(); await first;
  assert.equal(calls, 2); assert.equal(h.c.supervisorLoadState, 'error'); assert.equal(h.c.supervisorLoading, false);
  assert.equal(h.c.supervisorRefreshPromise, null); assert.equal(h.elements.refreshSupervisorButton.disabled, false);
  assert.match(h.elements.supervisorList.innerHTML, /Não foi possível carregar as ocorrências/);
  assert.match(h.elements.supervisorList.innerHTML, /data-supervisor-retry/);
  for (const key of numericUi) assert.equal(h.elements[key].textContent, 'Erro');
  h.c.api.listPending = async () => { calls++; return payload([record()]); };
  const next = h.c.refreshSupervisor(true); assert.notEqual(next, first); await next;
  assert.equal(calls, 3); assert.equal(h.c.supervisorLoadState, 'success'); assert.equal(h.elements.supervisorKpiWaiting.textContent, 1);
});
test('deadline real encerra fetch que ignora abort e permite retry até ERROR', async () => {
  const h = harness(), wire = transport(); h.c.api.listPending = token => wire.c.client.listPending(token);
  h.c.ApiError = wire.c.WireApiError;
  h.c.loadOccurrenceDataset = vm.runInNewContext(extract(apiSource, 'loadOccurrenceDataset') + '\nloadOccurrenceDataset', { ApiError: wire.c.WireApiError, setTimeout: done => queueMicrotask(done) });
  const request = h.c.refreshSupervisor(); await tick(); wire.timers[0].fn(); await tick();
  assert.equal(wire.signals.length, 2); wire.timers[1].fn(); await request;
  assert.equal(h.c.supervisorLoadState, 'error'); assert.equal(h.c.supervisorRefreshPromise, null);
  assert.equal(h.c.supervisorLoading, false); assert.ok(wire.timers.every(timer => timer.cleared));
});
test('deadline também cobre corpo HTTP parado após headers e ignora resposta tardia', async () => {
  const body = deferred(), wire = transport(apiSource, async () => ({ ok: true, status: 200, text: () => body.promise }));
  const request = wire.c.client.listPending('fixture'); await tick(); wire.timers[0].fn();
  await assert.rejects(request, error => error.code === 'TIMEOUT'); body.resolve(JSON.stringify(payload([record()]))); await tick();
  assert.equal(wire.timers[0].cleared, true);
});
test('ZERO válido termina em EMPTY, com todos os KPIs e badges iguais a zero', async () => {
  const h = harness(); await h.c.refreshSupervisor(); assert.equal(h.c.supervisorLoadState, 'empty');
  for (const key of numericUi) assert.equal(h.elements[key].textContent, 0, key);
  assert.match(h.elements.supervisorList.innerHTML, /Nenhuma ocorrência/); assert.doesNotMatch(h.elements.supervisorList.innerHTML, /Tentar novamente/);
});
test('um registro inválido é registrado sem interromper os 29 válidos', async () => {
  const h = harness(), records = Array.from({ length: 29 }, (_, i) => record(i));
  h.c.api.listPending = async () => ({ ...payload(records), records: [...records, null] }); await h.c.refreshSupervisor();
  assert.equal(h.c.supervisorRecords.length, 29); assert.equal(h.elements.supervisorKpiWaiting.textContent, 29);
  assert.equal((h.elements.supervisorList.innerHTML.match(/class="record-card supervisor-card"/g) || []).length, 29);
  assert.ok(h.events.some(event => event.level === 'warn')); assert.equal(h.c.supervisorLoadState, 'success');
});
test('um card com erro não derruba a lista nem impede os KPIs', async () => {
  const h = harness(); h.c.api.listPending = async () => payload([record(1), record(2), record(3)]);
  const original = h.c.photoUrlsForRecord;
  h.c.photoUrlsForRecord = item => { if (item.recordId === 'uuid-2') throw Error('card fixture'); return original(item); };
  await h.c.refreshSupervisor(); assert.equal(h.c.supervisorLoadState, 'success'); assert.equal(h.elements.supervisorKpiWaiting.textContent, 3);
  assert.match(h.elements.supervisorList.innerHTML, /uuid-1/); assert.match(h.elements.supervisorList.innerHTML, /uuid-3/);
  assert.match(h.elements.supervisorList.innerHTML, /Não foi possível exibir esta ocorrência/);
});
test('payload de resumo dispensa serviços, materiais, histórico e fotos', async () => {
  const h = harness(); h.c.api.listPending = async () => payload([{ recordId: 'summary-only', status: core.RECORD_STATUS.WAITING_SUPERVISOR }]);
  await h.c.refreshSupervisor(); assert.equal(h.c.supervisorLoadState, 'success'); assert.match(h.elements.supervisorList.innerHTML, /summary-only/);
});
test('valores legados em Base e Equipe não quebram a ordenação dos filtros', async () => {
  const h = harness(); h.c.api.listPending = async () => payload([{ ...record(1), base: 123, team: 456 }, record(2)]);
  await h.c.refreshSupervisor(); assert.equal(h.c.supervisorLoadState, 'success'); assert.match(h.elements.supervisorBaseFilter.innerHTML, /123/);
});
for (const data of [null, {}, { records: [] }, { records: [], pendingRecords: [], metricRecords: {} }, { records: [null], pendingRecords: [], metricRecords: [] }]) {
  test(`payload incompleto/inválido ${JSON.stringify(data)} vira ERROR sem falso vazio`, async () => {
    const h = harness(); let calls = 0; h.c.api.listPending = async () => { calls++; return data; };
    await h.c.refreshSupervisor(); assert.equal(calls, 1); assert.equal(h.c.supervisorLoadState, 'error');
    assert.equal(h.c.supervisorLoading, false); assert.doesNotMatch(h.elements.supervisorList.innerHTML, /Nenhuma ocorrência/);
  });
}
test('exceção na renderização inicial não impede a request nem o sucesso', async () => {
  const h = harness(); let renderCalls = 0; const original = h.c.renderSupervisorNavigation;
  h.c.renderSupervisorNavigation = () => { if (++renderCalls === 1) throw Error('render fixture'); original(); };
  h.c.api.listPending = async () => payload([record()]);
  await h.c.refreshSupervisor(); assert.equal(h.c.supervisorLoadState, 'success'); assert.equal(h.c.supervisorLoading, false);
  assert.equal(h.c.supervisorRefreshPromise, null); assert.equal(h.elements.refreshSupervisorButton.disabled, false);
  h.c.api.listPending = async () => payload([record()]); await h.c.refreshSupervisor(); assert.equal(h.c.supervisorLoadState, 'success');
});
test('render quebrado até no erro ainda libera request e oferece Tentar novamente', async () => {
  const h = harness(); h.c.renderSupervisorNavigation = () => { throw Error('render fixture'); };
  await h.c.refreshSupervisor(); assert.equal(h.c.supervisorLoading, false); assert.equal(h.c.supervisorRefreshPromise, null);
  assert.match(h.elements.supervisorList.innerHTML, /data-supervisor-retry/); assert.equal(h.elements.supervisorList.attributes['aria-busy'], 'false');
});
test('troca de sessão impede resposta e finally antigos de encerrar carga nova', async () => {
  const h = harness(), old = deferred(), current = deferred(); h.c.api.listPending = () => old.promise;
  const first = h.c.refreshSupervisor(); await tick(); h.c.sessionRevision++; h.c.api.listPending = () => current.promise;
  const second = h.c.refreshSupervisor(); await tick(); old.resolve(payload([record(99)])); await first;
  assert.equal(h.c.supervisorLoading, true); assert.equal(h.c.supervisorRefreshPromise, second);
  current.resolve(payload([record(1)])); await second; assert.equal(h.c.supervisorRecords[0].recordId, 'uuid-1');
});
test('filtro HOJE durante a primeira carga não descarta a resposta da sessão', async () => {
  const h = harness(), data = deferred(); h.c.api.listPending = () => data.promise; const request = h.c.refreshSupervisor();
  await tick(); h.c.supervisorFiltersByTab.occurrences.mode = 'today'; h.c.renderSupervisorList();
  data.resolve(payload([record()])); await request; assert.equal(h.elements.supervisorKpiWaiting.textContent, 1);
  assert.match(h.elements.supervisorList.innerHTML, /uuid-1/); assert.equal(h.c.supervisorLoadState, 'success');
});
test('offline termina em ERROR sem request nem loading infinito', async () => {
  const h = harness(); h.c.navigator.onLine = false; let calls = 0;
  h.c.api.listPending = async () => { calls++; return emptyPayload(); }; await h.c.refreshSupervisor();
  assert.equal(calls, 0); assert.equal(h.c.supervisorLoadState, 'error'); assert.equal(h.c.supervisorRefreshPromise, null);
  assert.equal(h.elements.refreshSupervisorButton.disabled, false);
});
test('falha posterior preserva números do último snapshot sem apresentá-los como atuais', async () => {
  const h = harness(); h.c.api.listPending = async () => payload([record()]); await h.c.refreshSupervisor();
  h.c.api.listPending = async () => { throw new ApiError('erro', 'NETWORK_ERROR'); }; await h.c.refreshSupervisor();
  assert.equal(h.c.supervisorRecords.length, 1); assert.equal(h.elements.supervisorKpiWaiting.textContent, 1);
  assert.match(h.elements.supervisorFilterSummary.textContent, /última carga/); assert.equal(h.c.supervisorLoadState, 'error');
});

let passed = 0, failed = 0; const failures = [];
for (const { name, run } of tests) {
  try { await run(); passed++; }
  catch (error) { failed++; failures.push({ name, error: error.stack }); }
}
console.log(JSON.stringify({ passed, failed, tests: tests.map(test => test.name), failures, environment: 'Node VM: código real de autenticação mockada, transporte, filtros, KPIs, badges, cards e seleção; DOM simulado; nenhum login real.' }, null, 2));
if (failed) process.exitCode = 1;
