// Real frontend/API and official Apps Script functions; Sheets/Drive only in RAM.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID, createHash } from 'node:crypto';
import { harness } from './fiscal-corrections.mjs';
import * as core from '../core.js';

const root = new URL('../', import.meta.url);
const app = await readFile(new URL('app.js', root), 'utf8');
const apiSource = await readFile(new URL('api.js', root), 'utf8');
const extract = name => { const match = app.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(match, name); return match[0]; };
const plain = value => JSON.parse(JSON.stringify(value));
const tests = [], results = [], test = (name, run) => tests.push({ name, run });
const UUID = '00000001-1111-4111-8111-111111111111';
function fixture() { const h = harness(); h.grant(); h.add(1); return h; }
function runtime(h, { fiscal = true, changes = { observation: 'Correção sintética confirmada' }, slots = [], drop = '', fail = '' } = {}) {
  if (fiscal) h.request(1);
  const original = fiscal ? h.open(1) : h.c.recordFromValuesAt_(h.row(1));
  const route = original.fiscalCorrection, key = 'fiscalCorrection:fixture';
  let record = { ...plain(original), ...changes, fiscalDraftKey: fiscal ? key : '', fiscalAclRevision: '',
    correctionMode: fiscal, correctionOriginal: core.correctionOriginalSnapshot(original),
    correctionRequestedAt: fiscal ? route.requestedAt : '', status: core.RECORD_STATUS.PENDING };
  const photos = new Map(), events = [], notices = []; h.drive();
  for (const slot of slots) {
    const uploadKey = randomUUID();
    record.photoStates[slot - 1] = { photoIndex: slot, uploadKey, localReady: true, confirmed: false, replacePending: true };
    photos.set(slot, { recordId: UUID, photoIndex: slot, uploadKey, blob: new Blob(['synthetic'], { type: 'image/jpeg' }) });
  }
  let lose = drop, failure = fail, clock = 0;
  const storage = {
    getRecord: async () => structuredClone(record),
    putRecord: async (next, options = {}) => {
      if (options.expectedUpdatedAt != null && String(record.updatedAt || '') !== options.expectedUpdatedAt) throw Object.assign(Error('CAS'), { code: 'LOCAL_RECORD_CHANGED' });
      record = structuredClone({ ...next, updatedAt: String(++clock) }); return record;
    },
    getPhoto: async (_id, slot) => photos.get(slot),
    deletePhoto: async (_id, slot, uploadKey) => { if (photos.get(slot)?.uploadKey === uploadKey) photos.delete(slot); }
  };
  const token = fiscal ? h.login() : h.token('field');
  const c = vm.createContext({ ...core, Map, Set, Object, JSON, Date, Blob, URL, AbortController, setTimeout, clearTimeout, structuredClone,
    crypto: { randomUUID }, navigator: { onLine: true, userAgent: 'iPhone Safari simulated fixture' }, console: { warn() {}, error() {} },
    TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO', session: { token, role: fiscal ? 'fiscal' : 'field', user: fiscal ? 'Fiscal A' : 'Campo A' }, sessionRevision: 1, recordSyncPromises: new Map(),
    fiscalDraftStorage: () => storage, ...storage, dailyProduction: { totalExcludingRecord: 0 }, LAST_SYNC_META: 'fixture', setMeta: async () => {},
    cacheDailySummary: async () => {}, updateQueueUi: async () => {}, currentView: 'fixture', mineRecords: [], photoSyncAllRunning: false,
    refreshMine() {}, logout() {}, toast() {}, friendlyError: error => error.message,
    featuresController: () => ({ fiscalSyncChanged: value => notices.push(value.syncPhase) }),
    blobToDataUrl: async () => 'data:image/jpeg;base64,aGVsbG8=',
    FileReader: class { readAsDataURL() { this.result = 'data:image/jpeg;base64,aGVsbG8='; this.onload(); } },
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body); events.push(payload.action);
      if (failure === payload.action) throw Error('synthetic network failure');
      let result;
      try { result = h.c[payload.action + '_'](payload); }
      catch (error) { result = { ok: false, error: error.code || 'FIXTURE_ERROR', message: error.message }; }
      if (lose === payload.action) { lose = ''; throw Error('synthetic response lost AFTER persistence'); }
      return { ok: true, status: 200, text: async () => JSON.stringify(result) };
    }
  });
  vm.runInContext("const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec';const MATERIAL_CATALOG_SOURCE={};\n" + apiSource.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '') + '\nthis.api=api;this.ApiError=ApiError;', c);
  vm.runInContext(extract('syncSingleRecord') + '\n' + extract('performSyncSingleRecord'), c);
  return { c, events, notices, photos, storage, record: () => record, run: () => c.syncSingleRecord(UUID, false, fiscal ? key : ''),
    fail: action => { failure = action; }, drop: action => { lose = action; } };
}

test('Fiscal: resposta textual perdida é reconciliada sem segundo submit e chega ao Supervisor', async () => {
  const h = fixture(), ui = runtime(h, { drop: 'submitRecord' }); const result = await ui.run();
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR', result.lastError); assert.equal(result.syncPhase, 'confirmed');
  assert.equal(ui.events.filter(action => action === 'submitRecord').length, 1);
  assert.equal(h.row(1)[h.c.meta.COL.OBSERVATION - 1], 'Correção sintética confirmada');
  assert.equal(h.audit(1).lastCorrectionSubmission.phase, 'COMPLETE');
  assert.equal(h.sheet(h.c.meta.APP.historySheet).rows.filter(row => row[3] === 'CORRECAO_REENVIADA').length, 1);
});
test('Fiscal: foto com resposta perdida continua pela mesma chave e um só arquivo', async () => {
  const h = fixture(), ui = runtime(h, { changes: {}, slots: [1], drop: 'uploadPhoto' }); const result = await ui.run();
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR', result.lastError); assert.equal(ui.photos.size, 0);
  assert.equal(ui.events.filter(action => action === 'uploadPhoto').length, 1);
  assert.equal(h.audit(1).photoSubmissions[1].phase, 'COMPLETE');
});
test('Fiscal: upload parcial, erro, retry e slots 6/7 preservam UUID e recibo', async () => {
  const h = fixture(), ui = runtime(h, { slots: [1, 6, 7], changes: { observation: 'Mista', occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '00021', removedCia: '00031', removedBto: '00041', newCode: '00022', newCia: '00032', newBto: '00042' } }, fail: 'uploadPhoto' });
  const first = await ui.run(); assert.equal(first.syncPhase, 'error'); assert.equal(ui.photos.size, 3);
  const requestId = h.audit(1).lastCorrectionSubmission.requestId; ui.fail(''); const result = await ui.run();
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR', result.lastError); assert.equal(result.recordId, UUID);
  assert.equal(h.audit(1).lastCorrectionSubmission.requestId, requestId); assert.equal(ui.photos.size, 0);
  assert.equal(ui.events.filter(action => action === 'submitRecord').length, 1, 'data receipt must suppress another submission');
  assert.deepEqual([6, 7].map(slot => h.audit(1).photoSubmissions[slot].phase), ['COMPLETE', 'COMPLETE']);
});
test('Fiscal: final readback lost, request absent from server list, direct retry recovers original draft', async () => {
  const h = fixture(), ui = runtime(h); ui.fail('getRecordState'); const first = await ui.run();
  assert.equal(first.syncPhase, 'error'); assert.equal(h.c.listFiscalCorrections_({ token: h.login() }).records.length, 0);
  ui.fail(''); const final = await ui.run(); assert.equal(final.syncPhase, 'confirmed', final.lastError);
  assert.equal(ui.events.filter(action => action === 'submitRecord').length, 1);
});
test('Fiscal: Supervisor publica antes da confirmação local; retry só lê e encerra o rascunho', async () => {
  const h = fixture(), ui = runtime(h); ui.fail('getRecordState'); await ui.run();
  h.c.supervisorAction_({ token: h.token('supervisor'), decision: 'approve', recordId: UUID });
  ui.fail(''); const result = await ui.run(); assert.equal(result.syncPhase, 'confirmed', result.lastError); assert.equal(result.status, 'PUBLICADA');
  assert.equal(ui.events.filter(action => action === 'submitRecord').length, 1);
  assert.equal(h.sheet(h.c.meta.APP.historySheet).rows.filter(row => row[3] === 'CORRECAO_REENVIADA').length, 1);
});
test('Fiscal: all six local phases reflect progress and never erase an error draft', async () => {
  const h = fixture(), ui = runtime(h, { slots: [1], fail: 'uploadPhoto' }); const result = await ui.run();
  assert.equal(result.syncPhase, 'error'); assert.equal(ui.photos.size, 1);
  for (const phase of ['sending', 'photos', 'confirming', 'error']) assert.ok(ui.notices.includes(phase), phase);
  for (const phase of ['saved', 'sending', 'photos', 'confirming', 'confirmed', 'error']) assert.ok(core.synchronizationFeedback({ syncPhase: phase }).label);
});
test('Fiscal: edição adicional após dados confirmados e foto pendente preserva snapshot e nova intenção', async () => {
  const h = fixture(), ui = runtime(h, { slots: [1], fail: 'uploadPhoto' });
  await ui.run(); const previous = h.audit(1).lastCorrectionSubmission.requestId;
  await ui.storage.putRecord({ ...ui.record(), observation: 'Segunda edição recuperável' }); ui.fail('');
  const result = await ui.run(); assert.equal(result.status, 'AGUARDANDO_SUPERVISOR', result.lastError);
  assert.equal(h.row(1)[h.c.meta.COL.OBSERVATION - 1], 'Segunda edição recuperável');
  assert.notEqual(h.audit(1).lastCorrectionSubmission.requestId, previous);
  assert.equal(h.audit(1).supersededCorrectionSubmissions[0].requestId, previous);
});
test('Campo: confirmed metadata for another UUID cannot change local evidence', () => {
  const record = { recordId: UUID, photoStates: [{ photoIndex: 1, confirmed: true, serverUrl: 'old', uploadKey: 'old' }] };
  assert.throws(() => core.reconcilePhotoStates(record, { recordId: randomUUID(), photoStates: [] }), error => error.code === 'INVALID_RECORD_STATE');
  assert.equal(record.photoStates[0].serverUrl, 'old');
});
test('Campo: stale confirmed slot becomes unconfirmed when server has no receipt', () => {
  const local = { recordId: UUID, photoStates: [{ photoIndex: 1, confirmed: true, serverUrl: 'stale', uploadKey: 'stale' }] };
  assert.equal(core.reconcilePhotoStates(local, { recordId: UUID, photoStates: [] }).photoStates[0].confirmed, false);
});
test('Campo: 5 local files and 0 confirmed never satisfy server evidence', () => {
  const record = { photoStates: Array.from({ length: 5 }, (_, i) => ({ photoIndex: i + 1, localReady: true, confirmed: false, serverUrl: 'stale' })) };
  assert.equal(core.confirmedEvidenceReady(record), false);
});
function approvalClient(h, { drop = false, falseSuccess = false, timeoutAfterCommit = false } = {}) {
  let decisions = 0, reads = 0;
  const c = vm.createContext({ ...core, URL, AbortController, setTimeout: (callback, ms) => setTimeout(callback, ms === 60000 && timeoutAfterCommit ? 5 : ms), clearTimeout, navigator: { onLine: true },
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body); let result;
      try {
        if (payload.action === 'supervisorAction') { decisions++; result = falseSuccess ? { ok: true, recordId: UUID } : h.c.supervisorAction_(payload); if (timeoutAfterCommit) return new Promise(() => {}); if (drop) { drop = false; throw Object.assign(Error('lost'), { lost: true }); } }
        else { reads++; result = h.c.getRecordState_(payload); }
      } catch (error) { if (error.lost) throw error; result = { ok: false, error: error.code, message: error.message }; }
      return { ok: true, status: 200, text: async () => JSON.stringify(result) };
    }
  });
  vm.runInContext("const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec';const MATERIAL_CATALOG_SOURCE={};\n" + apiSource.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '') + '\nthis.api=api;', c);
  return { run: () => c.api.supervisorAction(h.token('supervisor'), 'approve', UUID), counts: () => ({ decisions, reads }) };
}
test('Supervisor: lost response acknowledges persisted main/services/materials/history only once', async () => {
  const h = fixture(), ui = approvalClient(h, { drop: true }); const result = await ui.run();
  assert.equal(result.reconciledResponse, true); assert.equal(result.integrity.state, 'INTEGRITY_OK');
  assert.deepEqual(ui.counts(), { decisions: 1, reads: 1 }); assert.equal(h.row(1), undefined);
  assert.equal(h.sheet(h.c.meta.APP.officialSheet).rows.filter(row => row[0] === UUID).length, 1);
  assert.equal(h.sheet(h.c.meta.APP.historySheet).rows.filter(row => row[3] === 'APROVADA_E_PUBLICADA').length, 1);
});
test('Supervisor: incomplete successful JSON cannot produce approval success', async () => {
  const h = fixture(), ui = approvalClient(h, { falseSuccess: true });
  await assert.rejects(ui.run(), error => error.code === 'PUBLICATION_UNCONFIRMED'); assert.ok(h.row(1));
});
test('Supervisor: deadline encerra a requisição e releitura confirma a publicação persistida', async () => {
  const h = fixture(), ui = approvalClient(h, { timeoutAfterCommit: true }); const result = await ui.run();
  assert.equal(result.reconciledResponse, true); assert.deepEqual(ui.counts(), { decisions: 1, reads: 1 });
  assert.equal(h.sheet(h.c.meta.APP.historySheet).rows.filter(row => row[3] === 'APROVADA_E_PUBLICADA').length, 1);
});
test('Supervisor: publicação entre a leitura da fila e a prova retorna o estado final confirmado', () => {
  const h = fixture(), find = h.c.findAcrossMainSheets_; let raced = false;
  h.c.findAcrossMainSheets_ = id => {
    const found = find(id);
    if (!raced) { raced = true; h.c.supervisorAction_({ token: h.token('supervisor'), decision: 'approve', recordId: UUID }); }
    return found;
  };
  const result = h.c.getRecordState_({ token: h.token('supervisor'), recordId: UUID });
  assert.equal(result.integrity.pendingCopies, 0); assert.equal(result.status, 'PUBLICADA'); assert.equal(result.record.status, 'PUBLICADA');
  assert.equal(result.record.audit.publicationState, 'PUBLICADA');
});
test('Supervisor: localized update changes just the UUID and KPIs, preserves others and filters', () => {
  const other = { recordId: randomUUID(), status: 'AGUARDANDO_SUPERVISOR' };
  const c = vm.createContext({ ...core, supervisorMutationVersion: 0, supervisorRecords: [{ recordId: UUID }, other], supervisorPendingRecords: [],
    supervisorMetricRecords: [{ recordId: UUID }, other], supervisorPhotoFailures: new Map(), selectedSupervisorIds: new Set([UUID, other.recordId]),
    renderSupervisorList() {}, featuresController: () => ({ refreshSummary() {} }) });
  vm.runInContext(extract('applyConfirmedSupervisorResult'), c);
  c.applyConfirmedSupervisorResult({ recordId: UUID, record: { recordId: UUID, status: 'PUBLICADA' } });
  assert.equal(c.supervisorRecords.length, 1); assert.equal(c.supervisorRecords[0].recordId, other.recordId);
  assert.equal(c.supervisorMetricRecords.length, 2); assert.ok(c.selectedSupervisorIds.has(other.recordId));
  assert.equal(core.supervisorKpis(c.supervisorMetricRecords).published, 1);
});
test('Fiscal local storage and list support drafts absent from the open server queue', async () => {
  const source = await readFile(new URL('fiscal-workspace.js', root), 'utf8');
  assert.match(source, /getFiscalCorrectionDrafts\(session.user, session.aclRevision/);
  assert.match(source, /retryLocal: true/); assert.match(source, /data-fiscal-retry/);
  const draftSource = await readFile(new URL('fiscal-drafts.js', root), 'utf8');
  const c = vm.createContext({ normalizeText: core.normalizeText }); vm.runInContext(draftSource.replace(/^import .*?;\n/gm, '').replace(/^export /gm, ''), c);
  const route = { routingVersion: 'FISCAL_ASSIGNED', routingRequestId: randomUUID(), assignmentRevision: randomUUID() };
  const a = c.fiscalDraftKey('Fiscal A', UUID, route, 'account-1');
  assert.notEqual(a, c.fiscalDraftKey('Fiscal B', UUID, route, 'account-1'));
  assert.notEqual(a, c.fiscalDraftKey('Fiscal A', UUID, route, 'account-2'));
  assert.notEqual(a, c.fiscalDraftKey('Fiscal A', randomUUID(), route, 'account-1'));
});

for (const item of tests) { try { await item.run(); results.push({ name: item.name, ok: true }); } catch (error) { results.push({ name: item.name, ok: false, error: error.stack }); } }
const report = { total: results.length, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length, productionWrites: 0, results };
console.log(JSON.stringify(report, null, 2)); if (process.env.OCCBQ_HOTFIX_RESULT) await writeFile(process.env.OCCBQ_HOTFIX_RESULT, JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
