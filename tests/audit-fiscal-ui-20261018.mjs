// Isolated controller tests. No browser/network, production accounts or Sheets writes.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import * as core from '../core.js';

const root = process.env.OCCBQ_FRONTEND_SOURCE || path.resolve(new URL('../', import.meta.url).pathname);
const body = source => source.replace(/^import[^;]*;\n/gm, '').replace(/^export /gm, '');
const [workspaceSource, adminSource] = await Promise.all(['fiscal-workspace.js', 'fiscal-admin.js'].map(name => readFile(path.join(root, name), 'utf8')));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const ID = '11111111-2222-4333-8444-555555555555';
const route = revision => ({ routingVersion: 'FISCAL_ASSIGNED', routingRequestId: 'request-' + revision, assignmentRevision: revision, assignedFiscal: 'Fiscal Fixture', base: 'CAICÓ', assignmentStatus: 'ASSIGNED' });
const record = (revision = 'new') => ({ recordId: ID, occurrenceNumber: 'FIXTURE', base: 'CAICÓ', fiscalCorrection: route(revision), canCorrect: true });
const draft = (revision, updatedAt, syncPhase = 'error') => ({ ...record(revision), correctionMode: true, fiscalDraftKey: 'fiscalCorrection:' + revision, fiscalAclRevision: 'acl-fixture', updatedAt, syncPhase, lastError: revision + '-fixture-error' });
class Element {
  constructor() { this.listeners = new Map(); this.dataset = {}; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.disabled = false; this.hidden = false; this.options = []; this.elements = []; this.classList = { toggle() {} }; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute() {}
  querySelectorAll() { return []; }
  reset() {}
  scrollIntoView() {}
}
function environment({ master = false } = {}) {
  const elements = new Map(), $ = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  let session = { role: 'fiscal', token: 'token-fixture', user: 'Fiscal Fixture', bases: ['CAICÓ'], aclRevision: 'acl-fixture', canManageFiscals: master }, revision = 1, loggedOut = 0;
  const document = { querySelector: $, querySelectorAll: () => [] };
  const options = { getSession: () => session, getRevision: () => revision, onLogout: () => { loggedOut++; session = null; revision++; } };
  return { $, document, options, get loggedOut() { return loggedOut; }, logout() { session = null; revision++; }, login() { session = { role: 'fiscal', token: 'second-token', user: 'Other Fixture', bases: ['MOSSORÓ'] }; revision++; } };
}
function workspace({ drafts = [], records = [record()], master = false, api: supplied = {} } = {}) {
  const env = environment({ master }), calls = { retry: [], correction: [], list: 0 };
  const api = { listFiscalCorrections: async () => { calls.list++; return { records }; }, listFiscalAccounts: async () => ({ accounts: [{ user: 'Fiscal Fixture', bases: ['CAICÓ'], active: true }] }), ...supplied };
  const factory = vm.runInNewContext(body(workspaceSource) + '\ncreateFiscalWorkspace', { ...core, document: env.document, api, ApiError: class ApiError extends Error { constructor(message, code) { super(message); this.code = code; } }, getFiscalCorrectionDrafts: async () => drafts });
  const controller = factory({ ...env.options, onRetry: async (...args) => calls.retry.push(args), onCorrection: async value => calls.correction.push(value), barsMarkup: () => '', topThreeMarkup: () => '' });
  const click = async dataset => { const button = new Element(); button.dataset = dataset; env.$('#view-fiscal').listeners.get('click')({ target: { closest: () => button } }); await flush(); return button; };
  return { ...env, controller, calls, click };
}
const tests = [], test = (name, run) => tests.push({ name, run });
test('retry seleciona o draft da rota atual mesmo se o draft antigo vier por último', async () => {
  const h = workspace({ drafts: [draft('new', '2026-10-18T10:00:00Z'), draft('old', '2026-10-18T11:00:00Z')] });
  await h.controller.refreshCorrections(); await h.click({ fiscalRetry: ID });
  assert.deepEqual(h.calls.retry, [[ID, 'fiscalCorrection:new']]);
  assert.doesNotMatch(h.$('#fiscalCorrectionsList').innerHTML, /old-fixture-error/);
});
test('draft antigo não empresta erro/retry à solicitação atual de outro roteamento', async () => {
  const h = workspace({ drafts: [draft('old', '2026-10-18T11:00:00Z')] }); await h.controller.refreshCorrections();
  assert.doesNotMatch(h.$('#fiscalCorrectionsList').innerHTML, /data-fiscal-retry|old-fixture-error/);
  assert.match(h.$('#fiscalCorrectionsList').innerHTML, /data-fiscal-correct/);
});
test('confirmação atrasada da rota antiga preserva a solicitação atual e seu draft', async () => {
  const h = workspace({ drafts: [draft('new', '2026-10-18T10:00:00Z')] }); await h.controller.refreshCorrections();
  h.controller.syncChanged(draft('old', '2026-10-18T11:00:00Z', 'confirmed'));
  assert.match(h.$('#fiscalCorrectionsList').innerHTML, /data-fiscal-correct/);
  assert.equal(h.$('#fiscalCorrectionCount').textContent, '1');
  await h.click({ fiscalRetry: ID }); assert.deepEqual(h.calls.retry, [[ID, 'fiscalCorrection:new']]);
});
test('progresso atrasado da rota antiga não substitui retry da rota atual', async () => {
  const h = workspace({ drafts: [draft('new', '2026-10-18T10:00:00Z')] }); await h.controller.refreshCorrections();
  h.controller.syncChanged(draft('old', '2026-10-18T11:00:00Z'));
  await h.click({ fiscalRetry: ID }); assert.deepEqual(h.calls.retry, [[ID, 'fiscalCorrection:new']]);
});
test('draft confirmado da rota atual impede reaparecer solicitação ainda obsoleta na lista', async () => {
  const h = workspace({ drafts: [draft('new', '2026-10-18T12:00:00Z', 'confirmed'), draft('old', '2026-10-18T11:00:00Z')] });
  await h.controller.refreshCorrections(); assert.equal(h.$('#fiscalCorrectionCount').textContent, '0');
  assert.doesNotMatch(h.$('#fiscalCorrectionsList').innerHTML, /data-fiscal-retry|data-fiscal-correct/);
});
test('confirmação atual prevalece sobre draft antigo atualizado depois, sem apagar nenhum draft', async () => {
  const h = workspace({ drafts: [draft('new', '2026-10-18T10:00:00Z', 'confirmed'), draft('old', '2026-10-18T11:00:00Z')] });
  await h.controller.refreshCorrections(); assert.equal(h.$('#fiscalCorrectionCount').textContent, '0');
  assert.doesNotMatch(h.$('#fiscalCorrectionsList').innerHTML, /data-fiscal-retry|data-fiscal-correct/);
});
test('evento antigo da mesma rota não regride confirmação recente para erro', async () => {
  const h = workspace({ drafts: [draft('new', '2026-10-18T12:00:00Z', 'confirmed')] }); await h.controller.refreshCorrections();
  h.controller.syncChanged(draft('new', '2026-10-18T11:00:00Z'));
  assert.equal(h.$('#fiscalCorrectionCount').textContent, '0'); assert.doesNotMatch(h.$('#fiscalCorrectionsList').innerHTML, /data-fiscal-retry/);
});
test('atribuição não escreve status depois de logout durante a releitura', async () => {
  const reread = deferred(); let calls = 0;
  const h = workspace({ master: true, api: { listFiscalCorrections: async () => ++calls === 1 ? { records: [record()] } : reread.promise, reassignFiscalCorrection: async () => ({ recordId: ID, fiscalCorrection: route('new') }) } });
  await h.controller.refreshCorrections(); h.$(`[data-assignment-for="${ID}"]`).value = 'Fiscal Fixture';
  const clicking = h.click({ fiscalAssign: ID }); await flush(); assert.equal(calls, 2);
  h.logout(); h.controller.reset(); h.$('#fiscalCorrectionsStatus').textContent = 'SECOND SESSION'; reread.resolve({ records: [record()] }); await clicking; await flush();
  assert.equal(h.$('#fiscalCorrectionsStatus').textContent, 'SECOND SESSION');
});
test('lista e erro de autenticação antigos não alteram UI nem deslogam nova sessão', async () => {
  const pending = deferred(), h = workspace({ api: { listFiscalCorrections: () => pending.promise } });
  const loading = h.controller.refreshCorrections(); h.logout(); h.controller.reset(); h.login();
  h.$('#fiscalCorrectionsStatus').textContent = 'SECOND SESSION'; pending.reject(Object.assign(new Error('Old token'), { code: 'AUTH_REQUIRED' })); await loading;
  assert.equal(h.$('#fiscalCorrectionsStatus').textContent, 'SECOND SESSION'); assert.equal(h.loggedOut, 0); assert.equal(h.$('#fiscalCorrectionsList').innerHTML, '');
});
test('textos e atributos da correção escapam HTML recebido', async () => {
  const hostile = '<img src=x onerror="globalThis.xss=1">', h = workspace({ records: [{ ...record(), occurrenceNumber: hostile, supervisorNote: hostile, team: hostile }] });
  await h.controller.refreshCorrections(); assert.doesNotMatch(h.$('#fiscalCorrectionsList').innerHTML, /<img/); assert.match(h.$('#fiscalCorrectionsList').innerHTML, /&lt;img/);
});
test('troca de senha mestra mostra processamento imediatamente e encerra estado após erro', async () => {
  const env = environment({ master: true }), pending = deferred();
  const factory = vm.runInNewContext(body(adminSource) + '\ncreateFiscalAdmin', { ...core, document: env.document, api: { changeFiscalMasterPassword: () => pending.promise } });
  const controller = factory(env.options); controller.enter();
  const form = env.$('#fiscalMasterPasswordForm'), control = new Element(); form.elements = [control];
  env.$('#fiscalMasterCurrentPassword').value = 'fixture-current-password'; env.$('#fiscalMasterNewPassword').value = env.$('#fiscalMasterPasswordConfirm').value = 'fixture-next-password';
  const saving = form.listeners.get('submit')({ preventDefault() {} }); await flush();
  assert.match(env.$('#fiscalAdminStatus').textContent, /Alterando senha/); assert.equal(control.disabled, true);
  pending.reject(new Error('Fixture recoverable failure')); await saving; assert.equal(control.disabled, false); assert.match(env.$('#fiscalAdminStatus').textContent, /Fixture recoverable failure/);
});
const failures = []; let passed = 0;
for (const { name, run } of tests) { try { await run(); passed++; } catch (error) { failures.push({ name, error: error.stack }); } }
const result = { total: tests.length, passed, failed: failures.length, productionRequests: 0, productionWrites: 0, failures };
console.log(JSON.stringify(result, null, 2)); if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2)); if (failures.length) process.exitCode = 1;
