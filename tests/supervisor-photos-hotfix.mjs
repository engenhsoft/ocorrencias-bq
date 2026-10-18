import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as conformity from '../supervisor-conformity.js';
import * as financial from '../supervisor-financial.js';

const root = new URL('../', import.meta.url);
const [app, coreSource, features, html, beforeApp, beforeFeatures] = await Promise.all([
  ...['app.js', 'core.js', 'operational-features.js', 'index.html'].map(p => readFile(new URL(p, root), 'utf8')),
  readFile(process.argv[2], 'utf8'), readFile(process.argv[3], 'utf8')
]);
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const extract = (s, n) => { const m = s.match(new RegExp('(?:async )?function ' + n + '\\([^]*?\\n\\}')); assert.ok(m, n); return m[0]; };
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const tests = []; const test = (name, run) => tests.push({ name, run });
const plain = v => JSON.parse(JSON.stringify(v));
const photo = (index, id = A) => ({ recordId: id, photoIndex: index, uploadKey: 'key-' + index, blob: {} });
const slot = (index, confirmed = true) => ({ photoIndex: index, confirmed, serverUrl: confirmed ? 'data:image/jpeg;base64,aA==' : '', uploadKey: 'key-' + index });

function previews(source = app, role = 'field') {
  const c = vm.createContext({ ...core, photoFallbackUrl: () => '', TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO', session: { role }, activeRecord: { recordId: A }, activePhotos: new Map([[1, photo(1)], [6, photo(6)]]), previewUrls: new Map([[1, 'blob:fixture-A-1'], [6, 'blob:fixture-A-6']]) });
  vm.runInContext((source.includes('function recordPhotoUrl(') ? extract(source, 'recordPhotoUrl') + '\n' : '') + extract(source, 'photoUrlsForRecord') + '\n' + extract(source, 'transformerPhotoMarkup'), c);
  return c;
}
function requested(source = app, { local = true, confirmed = 2, status = core.RECORD_STATUS.SYNCING_PHOTOS, expected = [1,2,3,4,5], transformer = false, serverId = A, network = false } = {}) {
  const events = [], request = { status: 'OPEN', reason: 'FOTOS_PENDENTES', recipient: 'Campo A', supervisor: 'Supervisor A' };
  const remote = { recordId: A, user: 'Campo A', status: core.RECORD_STATUS.SYNCING_PHOTOS, audit: { photoSyncRequest: request } };
  const record = { ...remote, recordId: serverId, occurrenceTypes: transformer ? ['SUBSTITUIÇÃO DE TRAFO'] : ['PODA'], audit: { expectedPhotoIndexes: expected } };
  const c = vm.createContext({ ...core, Map, Set, session: { role: 'field', user: 'Campo A', token: 'fixture' }, sessionRevision: 1, mineRecords: [remote], photoSyncAttempts: new Set(), photoSyncFeedback: new Map(),
    renderPhotoSyncRequests() {}, getRecord: async () => { events.push('local'); return local ? { recordId: A, user: 'Campo A' } : null; },
    getPhotosForRecord: async () => [1,2,3,4,5,6,7].map(i => photo(i)),
    api: { getRecordState: async () => { events.push('server'); if (network) throw new c.ApiError('Rede interrompida', 'NETWORK_ERROR'); return { recordId: serverId, record, status, photoStates: [1,2,3,4,5,6,7].map(i => slot(i, i <= confirmed)) }; } },
    syncSingleRecord: async () => { events.push('sync'); return { recordId: A, status: core.RECORD_STATUS.WAITING_SUPERVISOR, audit: { photoSyncRequest: { ...request, status: 'RESOLVED' } } }; },
    refreshMine: async () => events.push('refresh'), friendlyError: e => e.message, toast: (_, tone) => events.push(tone), ApiError: class extends Error { constructor(message, code) { super(message); this.code = code; } }
  });
  vm.runInContext(extract(source, 'syncRequestedPhotos'), c);
  return { c, events };
}
function navigation(source = app, role = 'field') {
  const views = ['new', 'supervisor', 'fiscal'].map(id => ({ id: 'view-' + id, hidden: id !== 'new', classList: { toggle() {} } }));
  const c = vm.createContext({ session: { role }, currentView: 'new', $$: selector => selector === '.view' ? views : [], saveSupervisorFilters() {}, restoreSupervisorFilters() {}, refreshSupervisor() {}, loadDailyProduction() {}, refreshMine() {}, updateQueueUi() {}, window: { scrollTo() {} } });
  vm.runInContext(extract(source, 'navigate'), c); return { c, views };
}
function charts(role = 'supervisor') {
  const hosts = new Map(), events = [], state = { role, revision: 1 };
  const host = selector => { if (!hosts.has(selector)) hosts.set(selector, { hidden: false, innerHTML: '', checked: false, value: selector === '#rateChartDimension' ? 'base' : selector.endsWith('Period') ? 'month' : '', removeAttribute() {}, setAttribute() {} }); return hosts.get(selector); };
  const summary = { top3: [], month: '2026-10', bases: { month: [{ label: 'CAICÓ', count: 4, percentage: 100 }], all: [] }, nonconformity: { month: { base: [{ label: 'CAICÓ', analysed: 4, nonconforming: 1, percentage: 25 }], crewLeader: [] }, all: { base: [], crewLeader: [] } } };
  summary.conformityRecords = [{ recordId: A, base: 'CAICÓ', crewLeader: 'Chefe A', audit: { timeline: [{ action: 'PUBLICADA', actor: 'Supervisor A', at: '2026-10-14T12:00:00-03:00' }] } }];
  const api = { getOperationalSummary: async () => { events.push('summary'); return state.role === 'field' ? { top3: [], month: '2026-10' } : summary; }, listFiscalRecords: async () => { events.push('fiscal'); return { records: [], bases: ['CAICÓ'], summary: { total: 0 }, nextOffset: null }; } };
  // Admin/correction controllers are unrelated to these summary/chart checks.
  const createFiscalAdmin = () => ({ reset() {}, enter() {} });
  const createFiscalWorkspace = () => ({ reset() {}, enter() {}, syncChanged() {}, confirmed() {}, setPanel() {} });
  const c = vm.createContext({ ...core, ...conformity, ...financial, createFiscalAdmin, createFiscalWorkspace, api, navigator: { onLine: true }, document: { querySelector: host, addEventListener() {}, querySelectorAll: () => [] }, ApiError: class extends Error {} });
  vm.runInContext(features.replace(/^import .*?;\n/gm, '').replace(/^export /gm, ''), c);
  const controller = c.createOperationalFeatures({ getSession: () => state.role ? { role: state.role, user: 'Fixture', token: 't' + state.revision } : null, getRevision: () => state.revision, onNavigate() {}, onCorrection() {}, onSynchronize() {}, onOpenRecord() {}, onLogout() {} });
  return { controller, state, host, events };
}

test('baseline comprova preview geral e Trafo de outro UUID', () => {
  const c = previews(beforeApp); assert.equal(c.photoUrlsForRecord({ recordId: B })[0], 'blob:fixture-A-1'); assert.match(c.transformerPhotoMarkup({ recordId: B, occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'] }, 'removed'), /blob:fixture-A-6/);
});
test('consulta de outro UUID não usa preview, inclusive slots 6/7', () => {
  const c = previews(); assert.deepEqual(plain(c.photoUrlsForRecord({ recordId: B })), Array(5).fill('')); assert.doesNotMatch(c.transformerPhotoMarkup({ recordId: B, occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'] }, 'removed'), /blob:/);
});
test('rascunho próprio mantém preview por UUID, slot e uploadKey', () => {
  const c = previews(), r = { recordId: A, photoStates: [{ ...slot(1, false), localReady: true }] }; assert.equal(c.photoUrlsForRecord(r)[0], 'blob:fixture-A-1');
});
test('correção mostra nova Foto 1 local e preserva Foto 2 remota', () => {
  const c = previews(), r = { recordId: A, photos: ['https://example.test/old1', 'https://example.test/2'], photoStates: [{ ...slot(1, false), localReady: true, replacePending: true }] }; assert.equal(c.photoUrlsForRecord(r)[0], 'blob:fixture-A-1'); assert.equal(c.photoUrlsForRecord(r)[1], 'https://example.test/2');
});
test('chave/UUID/slot divergentes não reutilizam preview', () => {
  const c = previews(), r = { recordId: A, photoStates: [{ ...slot(1, false), localReady: true, uploadKey: 'new-key' }] }; assert.equal(c.photoUrlsForRecord(r)[0], ''); c.activePhotos.set(1, photo(1, B)); r.photoStates[0].uploadKey = 'key-1'; assert.equal(c.photoUrlsForRecord(r)[0], ''); c.activePhotos.set(1, photo(2)); assert.equal(c.photoUrlsForRecord(r)[0], '');
});
test('Supervisor e Fiscal nunca recebem previews locais', () => {
  for (const role of ['supervisor', 'fiscal']) { const c = previews(app, role); assert.equal(c.photoUrlsForRecord({ recordId: A, photoStates: [{ ...slot(1, false), localReady: true }] })[0], ''); }
});
test('URL confirmada do estado atual vence array remoto antigo', () => {
  const c = previews(app, 'supervisor'); assert.equal(c.photoUrlsForRecord({ recordId: A, photos: ['https://example.test/old'], photoStates: [{ ...slot(1), serverUrl: 'https://example.test/new' }] })[0], 'https://example.test/new');
});
test('baseline recusa fotos já confirmadas se não existir registro local', async () => {
  const h = requested(beforeApp, { local: false, confirmed: 5, status: core.RECORD_STATUS.WAITING_SUPERVISOR }); const r = await h.c.syncRequestedPhotos(A); assert.equal(r.ok, false); assert.equal(h.events.includes('server'), false);
});
test('5/5 confirmadas concluem aviso sem registro local ou novo upload', async () => {
  const h = requested(app, { local: false, confirmed: 5, status: core.RECORD_STATUS.WAITING_SUPERVISOR }); const r = await h.c.syncRequestedPhotos(A); assert.equal(r.ok, true); assert.equal(h.events.includes('local'), false); assert.equal(h.events.includes('sync'), false); assert.equal(h.events.includes('refresh'), true);
});
test('5 locais / 0 ou 3 confirmadas usam sincronismo original uma vez', async () => {
  for (const confirmed of [0, 3]) { const h = requested(app, { confirmed }); const r = await h.c.syncRequestedPhotos(A); assert.equal(r.ok, true); assert.equal(h.events.filter(x => x === 'sync').length, 1); assert.equal(h.events[0], 'server'); }
});
test('arquivo local ausente e servidor incompleto mantêm pedido', async () => {
  const h = requested(app, { local: false }); const r = await h.c.syncRequestedPhotos(A); assert.equal(r.ok, false); assert.equal(h.events.includes('sync'), false); assert.equal(h.c.photoSyncFeedback.has(A), true);
});
test('status pronto com slots esperados faltantes não produz falso sucesso', async () => {
  const h = requested(app, { confirmed: 3, status: core.RECORD_STATUS.WAITING_SUPERVISOR }); assert.equal((await h.c.syncRequestedPhotos(A)).ok, false);
});
test('Trafo só confirma pronto com as evidências 6 e 7', async () => {
  const missing = requested(app, { confirmed: 5, expected: [1,2,3,4,5,6,7], transformer: true, status: core.RECORD_STATUS.WAITING_SUPERVISOR }); assert.equal((await missing.c.syncRequestedPhotos(A)).ok, false);
  const ready = requested(app, { local: false, confirmed: 7, expected: [1,2,3,4,5,6,7], transformer: true, status: core.RECORD_STATUS.WAITING_SUPERVISOR }); assert.equal((await ready.c.syncRequestedPhotos(A)).ok, true);
});
test('resposta de outro UUID e falha de rede mantêm pendência', async () => {
  for (const options of [{ serverId: B, confirmed: 5, status: core.RECORD_STATUS.WAITING_SUPERVISOR }, { network: true }]) { const h = requested(app, options); assert.equal((await h.c.syncRequestedPhotos(A)).ok, false); assert.equal(h.events.includes('sync'), false); }
});
test('tentativa concorrente para o mesmo UUID não dispara request', async () => {
  const h = requested(); h.c.photoSyncAttempts.add(A); await h.c.syncRequestedPhotos(A); assert.equal(h.events.length, 0);
});
test('baseline navegação Campo pode ativar seção do Supervisor', () => { const h = navigation(beforeApp); h.c.navigate('supervisor'); assert.equal(h.views[1].hidden, false); });
test('Campo, Fiscal e login não ativam seção do Supervisor', () => { for (const role of ['field', 'fiscal', null]) { const h = navigation(app, role); h.c.navigate('supervisor'); assert.equal(h.views[1].hidden, true); } });
test('HTML inicia seção de não conformidade fechada', () => assert.match(html, /<section id="nonconformitySection"[^>]* hidden>/));
test('Supervisor mostra indicador e preserva valor e filtro', async () => {
  const h = charts(); h.controller.enter(); h.controller.setView('supervisor'); await h.controller.refreshSummary(); assert.equal(h.host('#nonconformitySection').hidden, false); assert.match(h.host('#rateChart').innerHTML, /Aprovadas sem edição direta/); h.host('#rateChartPeriod').value = 'all'; h.controller.setView('supervisor'); assert.match(h.host('#rateChart').innerHTML, /Aprovadas sem edição direta/); assert.equal(h.host('#rateChartPeriod').value, 'all');
});
test('Campo mantém TOP3 sem renderizar taxa; Fiscal não consulta resumo global', async () => {
  for (const role of ['field', 'fiscal']) { const h = charts(role); h.controller.enter(); h.controller.setView(role === 'field' ? 'new' : 'fiscal'); await h.controller.refreshSummary(); assert.equal(h.host('#nonconformitySection').hidden, true); assert.equal(h.host('#rateChart').innerHTML, ''); if (role === 'field') assert.match(h.host('#fieldInsights').innerHTML, /TOP 3/); else assert.equal(h.events.includes('summary'), false); }
});
test('troca de perfil, outras áreas e logout removem taxa e espaço', async () => {
  const h = charts(); h.controller.enter(); h.controller.setView('supervisor'); await h.controller.refreshSummary(); h.controller.setView('new'); assert.equal(h.host('#nonconformitySection').hidden, true); assert.equal(h.host('#rateChart').innerHTML, ''); h.state.role = 'field'; h.state.revision++; h.controller.enter(); h.controller.setView('supervisor'); assert.equal(h.host('#nonconformitySection').hidden, true); h.state.role = null; h.controller.reset(); assert.equal(h.host('#rateChart').innerHTML, '');
});
test('Sincronizar Tudo distingue êxito, falha parcial e não confirmado', async () => {
  const messages = [], processed = []; const c = vm.createContext({ ...core, session: { role: 'field', user: 'Campo A', token: 'fixture' }, syncRunning: false, elements: { syncNowButton: {} }, SYNCABLE_STATUSES: new Set([core.RECORD_STATUS.PENDING, core.RECORD_STATUS.ERROR]), setBusy() {}, updateQueueUi: async () => {}, console: { error() {} }, getAllRecords: async () => [A,B,'33333333-3333-4333-8333-333333333333'].map(recordId => ({ recordId, user: 'Campo A', status: core.RECORD_STATUS.PENDING })), syncSingleRecord: async id => { processed.push(id); return { status: id === A ? core.RECORD_STATUS.WAITING_SUPERVISOR : id === B ? core.RECORD_STATUS.ERROR : core.RECORD_STATUS.DRAFT, lastError: id === B ? 'Foto ausente' : '' }; }, toast: (message, tone) => messages.push({ message, tone }) }); vm.runInContext(extract(app, 'syncAll'), c); await c.syncAll(true); assert.equal(processed.length, 3); assert.match(messages[0].message, /1 ocorrência sincronizada; 2 continuam pendentes/); assert.equal(messages[0].tone, 'error');
});
test('funções adjacentes e cálculos permanecem idênticos', () => {
  for (const name of ['performSyncSingleRecord','storeSelectedPhoto','removePhoto','handlePhotoLoadError','refreshSupervisor','syncAllRequestedPhotos','decideSupervisor','loadRecordIntoForm']) assert.equal(extract(app,name), extract(beforeApp,name), name);
  assert.equal(extract(features,'barsMarkup'), extract(beforeFeatures,'barsMarkup'));
});

let passed = 0; const failures = [];
for (const { name, run } of tests) { try { await run(); passed++; } catch (error) { failures.push({ name, error: error.message }); } }
const result = { total: tests.length, passed, failed: failures.length, qaProductionWrites: 0, qaOperationalLogins: 0, failures };
if (process.argv[4]) await writeFile(process.argv[4], JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2)); if (failures.length) process.exitCode = 1;
