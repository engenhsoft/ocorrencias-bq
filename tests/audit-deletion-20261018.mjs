import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('async function discardDraft()'), source.indexOf('\nfunction goToStep(', source.indexOf('async function discardDraft()')));
const id = '11111111-1111-4111-8111-111111111111';
function harness() {
  const h = { record: { recordId: id, status: 'RASCUNHO', user: 'fixture', updatedAt: 'v1' }, meta: id, deletes: 0, confirmations: 0, messages: [], reset: 0, onConfirm: null, fail: false };
  const button = { disabled: false, textContent: 'Descartar' };
  const context = vm.createContext({
    session: { user: 'fixture' }, sessionRevision: 1, activeRecord: { recordId: id },
    RECORD_STATUS: { DRAFT: 'RASCUNHO' }, ACTIVE_DRAFT_META: 'activeDraft',
    elements: { discardDraftButton: button, resumeBanner: { hidden: false } },
    getMeta: async () => h.meta, getRecord: async () => structuredClone(h.record),
    setMeta: async (_key, value) => { h.meta = value; },
    clearMetaIfValue: async (_key, value) => { if (h.meta === value) h.meta = null; },
    confirmAction: async () => { h.confirmations++; return h.onConfirm ? h.onConfirm() : true; },
    deleteRecord: async (_id, options = {}) => {
      if (h.fail) throw new Error('fixture storage failure');
      if ((options.expectedUpdatedAt !== undefined && h.record.updatedAt !== options.expectedUpdatedAt) || (options.expectedStatus !== undefined && h.record.status !== options.expectedStatus)) throw Object.assign(new Error('changed'), { code: 'LOCAL_RECORD_CHANGED' });
      h.deletes++; h.record = null;
    },
    setBusy: (target, busy, label) => { target.disabled = busy; target.textContent = busy ? label : 'Descartar'; },
    resetForm: () => { h.reset++; }, toast: message => { h.messages.push(message); }
  });
  vm.runInContext(fn, context);
  return { h, context, button, run: () => context.discardDraft() };
}
const cases = [];
const test = (name, run) => cases.push({ name, run });
test('exclusão confirmada usa UUID e encerra loading', async () => {
  const { h, button, run } = harness(); await run(); assert.equal(h.deletes, 1); assert.equal(h.meta, null); assert.equal(h.reset, 1); assert.equal(button.disabled, false);
});
test('cancelamento preserva registro e referência', async () => {
  const { h, button, run } = harness(); h.onConfirm = () => false; await run(); assert.equal(h.deletes, 0); assert.equal(h.meta, id); assert.equal(button.disabled, false);
});
test('status já enviado nunca é descartado como rascunho', async () => {
  const { h, run } = harness(); h.record.status = 'PENDENTE_ENVIO'; await run(); assert.equal(h.deletes, 0); assert.equal(h.confirmations, 0);
});
test('alteração em outra aba durante confirmação preserva registro', async () => {
  const { h, button, run } = harness(); h.onConfirm = () => { h.record.updatedAt = 'v2'; return true; }; await assert.rejects(run, error => error.code === 'LOCAL_RECORD_CHANGED'); assert.equal(h.deletes, 0); assert.equal(h.record.updatedAt, 'v2'); assert.equal(button.disabled, false);
});
test('envio durante confirmação preserva fila', async () => {
  const { h, run } = harness(); h.onConfirm = () => { h.record.status = 'SINCRONIZANDO_DADOS'; return true; }; await assert.rejects(run, error => error.code === 'LOCAL_RECORD_CHANGED'); assert.equal(h.deletes, 0);
});
test('troca de sessão durante confirmação não exclui', async () => {
  const { h, context, run } = harness(); h.onConfirm = () => { context.sessionRevision++; context.session = { user: 'other' }; return true; }; await run(); assert.equal(h.deletes, 0);
});
test('clique duplicado compartilha uma única exclusão', async () => {
  const { h, button, run } = harness(); const releases = []; h.onConfirm = () => new Promise(resolve => { releases.push(resolve); }); const first = run(); await new Promise(resolve => setImmediate(resolve)); const second = run(); await new Promise(resolve => setImmediate(resolve)); releases.forEach(resolve => resolve(true)); await Promise.allSettled([first, second]); assert.equal(h.confirmations, 1); assert.equal(h.deletes, 1); assert.equal(button.disabled, false);
});
test('falha local encerra loading e preserva rascunho', async () => {
  const { h, button, run } = harness(); h.fail = true; await assert.rejects(run); assert.equal(button.disabled, false); assert.equal(h.meta, id); assert.equal(h.reset, 0);
});
test('outro rascunho ativo criado durante exclusão conserva sua referência', async () => {
  const { h, run } = harness(); h.onConfirm = () => { h.meta = 'other-uuid'; return true; }; await run(); assert.equal(h.meta, 'other-uuid');
});
const results = [];
for (const item of cases) { try { await item.run(); results.push({ name: item.name, passed: true }); } catch (error) { results.push({ name: item.name, passed: false, error: error.message }); } }
console.log(JSON.stringify({ kind: 'isolated-frontend-deletion-fixtures', productionWrites: 0, total: results.length, passed: results.filter(x => x.passed).length, failed: results.filter(x => !x.passed).length, results }, null, 2));
if (results.some(x => !x.passed)) process.exitCode = 1;
