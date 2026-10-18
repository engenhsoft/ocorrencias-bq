// Delayed authentication responses; isolated UI/session fixtures, no network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const extract = name => app.match(new RegExp('async function ' + name + '\\([^]*?\\n\\}'))[0];
function harness(name) {
  let resolve, reject;
  const response = new Promise((a, b) => { resolve = a; reject = b; });
  const stats = { persisted: [], entered: 0, toasts: [], clears: 0 };
  const element = () => ({ textContent: '', value: 'fixture-only', disabled: false });
  const elements = Object.fromEntries(['loginForm','loginMessage','loginButton','loginPassword','profileSwitchUser','profileSwitchPassword','profileSwitchMessage','profileSwitchSubmit'].map(key => [key, element()]));
  const c = vm.createContext({ sessionRevision: 1, session: { token: 'old-fixture', user: 'Fixture', role: 'field' }, loginRunning: false, profileSwitchRunning: false,
    profileSwitchTarget: 'supervisor', supervisorRefreshTimer: 0, navigator: { onLine: true }, elements,
    FormData: class FormData { get(key) { return { user: 'Fixture', password: 'fixture-only', role: 'field' }[key]; } },
    api: { login: () => response }, setBusy: (button, busy) => { button.disabled = busy; },
    clearSessionUiState: () => { stats.clears++; }, persistSession: value => { c.sessionRevision++; c.session = value; stats.persisted.push(value); },
    tokenExpiry: () => Date.now() + 1000, localStorage: { setItem() {} }, LAST_USER_KEY: 'fixture-user',
    enterApplication: async () => { stats.entered++; }, clearInterval() {}, toast: message => stats.toasts.push(message), friendlyError: error => error.message
  });
  vm.runInContext(extract(name), c);
  return { c, elements, stats, resolve: () => resolve({ token: 'new-fixture', user: 'Fixture', role: name === 'handleLogin' ? 'field' : 'supervisor' }), reject, run: () => c[name]({ preventDefault() {} }), logout: () => { c.sessionRevision++; c.session = null; } };
}
const cases = [];
for (const name of ['handleLogin', 'handleProfileSwitch']) {
  cases.push({ name: `${name}: autenticação atual entra e encerra loading`, run: async () => { const h = harness(name), task = h.run(); h.resolve(); await task; assert.equal(h.stats.persisted.length, 1); assert.equal(h.stats.entered, 1); assert.equal(h.elements.loginButton.disabled || h.elements.profileSwitchSubmit.disabled, false); } });
  cases.push({ name: `${name}: resposta tardia após logout não restaura sessão`, run: async () => { const h = harness(name), task = h.run(); h.logout(); h.resolve(); await task; assert.equal(h.stats.persisted.length, 0); assert.equal(h.stats.entered, 0); assert.equal(h.c.session, null); } });
  cases.push({ name: `${name}: erro tardio não escreve na nova tela de login`, run: async () => { const h = harness(name), task = h.run(); h.logout(); h.reject(new Error('obsolete fixture error')); await task; assert.equal(h.elements.loginMessage.textContent, ''); assert.equal(h.elements.profileSwitchMessage.textContent, ''); } });
}
function correctionHarness({ duringRead = false, duringForm = false } = {}) {
  const stats = { writes: 0, directory: 0, toasts: 0 };
  const server = { recordId: '11111111-1111-4111-8111-111111111111', fiscalCorrection: { assignedFiscal: 'Fiscal fixture' }, audit: {}, photoStates: [] };
  const c = vm.createContext({ sessionRevision: 1, session: { role: 'fiscal', token: 'fixture', user: 'Fiscal fixture', bases: ['CAICÓ'], aclRevision: '' },
    ApiError: class ApiError extends Error {}, sameUser: (a, b) => a === b, fiscalDraftKey: () => 'fiscalCorrection:fixture',
    fiscalDraftStorage: () => ({ getRecord: async () => { if (duringRead) { c.sessionRevision++; c.session = null; } return null; }, putRecord: async record => { stats.writes++; return record; } }),
    correctionRequest: () => ({ requestedAt: 'fixture-request' }), normalizeArray: value => value, normalizePhotoStates: value => value,
    correctionOriginalSnapshot: record => record, RECORD_STATUS: { CORRECTION_REQUESTED: 'CORRECAO_SOLICITADA', DRAFT: 'RASCUNHO' },
    loadRecordIntoForm: async () => { if (duringForm) { c.sessionRevision++; c.session = null; } },
    loadTeamDirectory: () => { stats.directory++; }, toast: () => { stats.toasts++; }, elements: { operationBase: { options: [{ value: 'CAICÓ' }, { value: 'MOSSORÓ' }] } }
  });
  vm.runInContext(extract('openAssignedFiscalCorrection'), c);
  return { c, stats, run: () => c.openAssignedFiscalCorrection(server) };
}
cases.push({ name: 'abertura Fiscal: logout durante leitura local não grava nem acessa sessão encerrada', run: async () => { const h = correctionHarness({ duringRead: true }); await h.run(); assert.equal(h.stats.writes, 0); assert.equal(h.stats.toasts, 0); } });
cases.push({ name: 'abertura Fiscal: logout ao carregar formulário não atualiza Bases ou mensagem', run: async () => { const h = correctionHarness({ duringForm: true }); await h.run(); assert.equal(h.stats.directory, 0); assert.equal(h.stats.toasts, 0); } });
cases.push({ name: 'abertura Fiscal: sessão atual mantém fluxo e restringe Bases', run: async () => { const h = correctionHarness(); await h.run(); assert.equal(h.stats.writes, 1); assert.equal(h.stats.directory, 1); assert.equal(h.stats.toasts, 1); assert.equal(h.c.elements.operationBase.options[0].hidden, false); assert.equal(h.c.elements.operationBase.options[1].hidden, true); } });
const results = [];
for (const item of cases) { try { await item.run(); results.push({ name: item.name, passed: true }); } catch (error) { results.push({ name: item.name, passed: false, error: error.message }); } }
console.log(JSON.stringify({ kind: 'isolated-authentication-response-fixtures', productionWrites: 0, total: results.length, passed: results.filter(x => x.passed).length, failed: results.filter(x => !x.passed).length, results }, null, 2));
if (results.some(x => !x.passed)) process.exitCode = 1;
