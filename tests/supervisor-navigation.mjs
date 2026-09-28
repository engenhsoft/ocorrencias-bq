import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const [app, coreSource, html] = await Promise.all(['app.js', 'core.js', 'index.html'].map((name) => readFile(new URL(name, root), 'utf8')));
const core = await import(`data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`);

const oldOrder = ['uuid-a', 'uuid-b', 'uuid-c', 'uuid-d'];
assert.equal(core.nextVisibleRecordId(oldOrder, 'uuid-a', ['uuid-c', 'uuid-d']), 'uuid-c', 'avança para o próximo UUID ainda visível');
assert.equal(core.nextVisibleRecordId(oldOrder, 'uuid-c', ['uuid-a', 'uuid-b']), '', 'não volta ao começo nem reutiliza Nº ocorrência');
assert.equal(core.nextVisibleRecordId(oldOrder, 'uuid-a', ['uuid-a', 'uuid-b', 'uuid-c']), 'uuid-b', 'correção direta não reabre a mesma ocorrência');
assert.equal(core.nextVisibleRecordId(oldOrder, 'uuid-d', []), '', 'última ocorrência encerra navegação');

const statuses = core.RECORD_STATUS;
assert.equal(core.mineNeedsAttention({ status: statuses.CORRECTION_REQUESTED }), true);
assert.equal(core.mineNeedsAttention({ status: statuses.SYNCING_PHOTOS }), true);
assert.equal(core.mineNeedsAttention({ status: statuses.ERROR, serverConfirmed: true, photoStates: [{ photoIndex: 1, localReady: true, confirmed: false }] }), true);
for (const status of [statuses.DRAFT, statuses.PUBLISHED, statuses.REJECTED, statuses.WAITING_SUPERVISOR]) assert.equal(core.mineNeedsAttention({ status }), false);

assert.deepEqual(core.supervisorDateWindow('today', '2026-09-28'), { from: '2026-09-28', to: '2026-09-28' });
assert.deepEqual(core.supervisorDateWindow('month', '2026-09-28'), { from: '2026-09-01', to: '2026-09-28' });
assert.deepEqual(core.supervisorDateWindow('period', '2026-09-28'), { from: '', to: '' });
assert.equal(core.validDateRange('2026-09-01', '2026-09-28'), true);
assert.equal(core.validDateRange('2026-09-28', '2026-09-01'), false);
assert.equal(core.validDateRange('2026-02-30', ''), false);

const decisionSource = app.match(/async function decideSupervisor\(decision\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(decisionSource, 'encontra o fluxo real de decisão');
const runDecision = async (failure = false) => {
  const events = [];
  const context = {
    activeSupervisorRecord: { recordId: 'uuid-a', occurrenceNumber: '123' }, supervisorMutationRunning: false,
    reviewTab: 'occurrences', reviewOrder: [...oldOrder], supervisorRefreshPromise: null, session: { token: 'test-token' }, elements: {
      approveButton: {}, rejectButton: {}, requestCorrectionButton: {}, reviewDialog: { close: () => events.push('close') }
    },
    confirmAction: async () => true, collectDecision: async () => ({ reason: 'teste', note: '' }),
    api: { supervisorAction: async () => { events.push('server'); if (failure) throw Error('Falha do servidor'); } },
    refreshSupervisor: async () => { events.push('refresh'); return []; },
    advanceSupervisorAfterAction: (before, id) => events.push(`advance:${before.join(',')}:${id}`),
    setBusy: () => {}, toast: () => {}, friendlyError: (error) => error.message, updateSupervisorReviewActions: () => {},
    console
  };
  const decide = vm.runInNewContext(`${decisionSource}\ndecideSupervisor`, context);
  await decide('approve');
  return events;
};
assert.deepEqual(await runDecision(), ['server', 'refresh', `advance:${oldOrder.join(',')}:uuid-a`]);
assert.deepEqual(await runDecision(true), ['server'], 'falha não avança e não fecha a conferência');

for (const id of ['previousReviewButton', 'nextReviewButton', 'supervisorClearFilters', 'supervisorPublishedBadge']) assert.ok(html.includes(`id="${id}"`));
for (const period of ['today', 'month', 'period']) assert.ok(html.includes(`data-supervisor-date="${period}"`));
assert.match(app, /reviewTab === 'published'/);
assert.match(app, /listPublishedRecords\(session\.token, batchIds\)/, 'detalhes publicados são solicitados em lote');
assert.match(app, /publishedVisibleLimit = 60/, 'histórico grande não gera todos os cards de uma vez');

console.log('Navegação, datas, pendências e decisão do Supervisor: OK');
