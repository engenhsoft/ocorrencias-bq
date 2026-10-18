// Delayed local reads/writes only. No operational data or network calls.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';

const source = await readFile(process.env.OCCBQ_AUDIT_APP_SOURCE || new URL('../app.js', import.meta.url), 'utf8');
const fn = source.match(/async function handleMineAction\([^]*?\n\}/)[0];
const id = 'aaaaaaaa-1111-4111-8111-111111111111';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
function harness(action = 'view') {
  const stats = { view: [], forms: [], saves: [], meta: [], messages: [] };
  const record = { recordId: id, user: 'Campo A', status: action === 'correct' ? 'CORRECAO_SOLICITADA' : 'RASCUNHO', updatedAt: 'version-a', observation: 'PRIVATE-FIXTURE-A', services: [], materials: [], photoStates: [], audit: {} };
  const gates = { read: null, write: null, meta: null };
  const c = vm.createContext({ ...core, session: { role: 'field', user: 'Campo A', token: 'token-a' }, sessionRevision: 1, mineRecords: [],
    elements: { mineDetailTitle: {}, mineDetailContent: {}, mineDetailDialog: {} },
    getRecord: async () => { if (gates.read) await gates.read.promise; return structuredClone(record); },
    putRecord: async value => { stats.saves.push(value); if (gates.write) await gates.write.promise; return { ...value, updatedAt: 'version-b' }; },
    setMeta: async (_key, value) => { stats.meta.push(value); if (gates.meta) await gates.meta.promise; }, ACTIVE_DRAFT_META: 'active',
    occurrenceDetails: value => value.observation,
    openScrollableDialog: () => stats.view.push(c.session?.user),
    loadRecordIntoForm: async value => stats.forms.push({ viewer: c.session?.user, record: value }),
    toast: message => stats.messages.push(message), correctionPhotoIndexes: () => [], correctionRequest: () => ({ requestedAt: 'fixture-request' }) });
  vm.runInContext(fn, c);
  const button = { dataset: { recordId: id, mineAction: action } };
  return { c, gates, stats, run: () => c.handleMineAction({ target: { closest: selector => selector === '[data-mine-action]' ? button : null } }), switchSession: () => { c.session = { role: 'field', user: 'Campo B', token: 'token-b' }; c.sessionRevision++; }, logout: () => { c.session = null; c.sessionRevision++; } };
}
const tests = [], test = (name, run) => tests.push({ name, run });
test('visualização atual abre somente os dados solicitados', async () => {
  const h = harness(); await h.run(); assert.deepEqual(h.stats.view, ['Campo A']); assert.equal(h.c.elements.mineDetailContent.innerHTML, 'PRIVATE-FIXTURE-A');
});
for (const action of ['view', 'correct', 'resume']) test(`${action}: leitura tardia não abre dados após troca de sessão`, async () => {
  const h = harness(action), read = deferred(); h.gates.read = read;
  const task = h.run(); h.switchSession(); read.resolve(); await task;
  assert.deepEqual(h.stats.view, []); assert.deepEqual(h.stats.forms, []); assert.deepEqual(h.stats.saves, []); assert.deepEqual(h.stats.meta, []);
});
test('correção atual mantém o fluxo e a revisão retornada pelo armazenamento', async () => {
  const h = harness('correct'); await h.run(); assert.equal(h.stats.forms.length, 1); assert.equal(h.stats.forms[0].viewer, 'Campo A'); assert.equal(h.stats.forms[0].record.updatedAt, 'version-b'); assert.equal(h.stats.saves.length, 1); assert.equal(h.stats.meta.length, 1);
});
test('gravação tardia da correção não troca meta nem abre formulário após logout', async () => {
  const h = harness('correct'), write = deferred(); h.gates.write = write;
  const task = h.run(); await tick(); assert.equal(h.stats.saves.length, 1); h.logout(); write.resolve(); await task;
  assert.deepEqual(h.stats.forms, []); assert.deepEqual(h.stats.meta, []); assert.deepEqual(h.stats.messages, []);
});
for (const action of ['correct', 'resume']) test(`${action}: meta tardia não abre formulário na nova sessão`, async () => {
  const h = harness(action), meta = deferred(); h.gates.meta = meta;
  const task = h.run(); await tick(); assert.equal(h.stats.meta.length, 1); h.switchSession(); meta.resolve(); await task;
  assert.deepEqual(h.stats.forms, []); assert.deepEqual(h.stats.messages, []);
});
test('erro local da sessão atual continua reportado ao tratamento existente', async () => {
  const h = harness(), read = deferred(); h.gates.read = read; const task = h.run(); read.reject(new Error('fixture current read failure'));
  await assert.rejects(task, /fixture current read failure/);
});

const results = [];
for (const { name, run } of tests) { try { await run(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.stack }); } }
const output = { kind: 'isolated-mine-session-fixtures', productionWrites: 0, total: results.length, passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length, results };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2)); if (output.failed) process.exitCode = 1;
