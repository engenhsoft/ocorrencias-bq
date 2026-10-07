import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';

if (!process.argv[2] || !process.argv[3]) throw Error('Informe backend candidato, baseline e opcionalmente o fixture read-only.');
const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
const [backend, baseline, appSource, coreSource, apiSource, html, previousTests] = await Promise.all([
  readFile(process.argv[2], 'utf8'), readFile(process.argv[3], 'utf8'),
  ...['app.js', 'core.js', 'api.js', 'index.html', 'tests/correction-persistence.mjs'].map(read)
]);
if (!process.argv[5]) throw Error('Informe também a pasta do frontend inicial (git archive 1603921).');
const previousApp = await readFile(process.argv[5] + '/app.js', 'utf8');
const previousCore = await readFile(process.argv[5] + '/core.js', 'utf8');
const previousApi = await readFile(process.argv[5] + '/api.js', 'utf8');
const loadCore = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const core = await loadCore(coreSource), oldCore = await loadCore(previousCore);
const extract = (source, name) => {
  const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(match, name); return match[0];
};
const plain = value => JSON.parse(JSON.stringify(value));
const factory = vm.runInNewContext(previousTests.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(previousTests, 'harness') + '\nharness', { vm, backend, createHash, assert, core });
const photoDrive = vm.runInNewContext(extract(previousTests, 'fakePhotoDrive') + '\nfakePhotoDrive', { Buffer });
const sourceCase = process.argv[4] ? JSON.parse(await readFile(process.argv[4], 'utf8')).real.values[0] : null;
const currentCase = process.argv[6] ? JSON.parse(await readFile(process.argv[6], 'utf8')).values[0] : null;
const CASE = sourceCase?.[0] || currentCase?.[0] || '11111111-2222-4333-8444-555555555555';
const fixtureUser = sourceCase?.[2] || currentCase?.[2] || 'Equipe FIXTURE';
const tests = [], traces = [];
const test = (name, run) => tests.push({ name, run });
const noChanges = 'Nenhuma alteração foi detectada. Faça a correção solicitada antes de reenviar.';

function harness(source = backend, real = false) {
  const h = factory([['NOVO', 'Serviço novo', 'UD', 'Grupo', '', '', '', '40,00', '60,00']], source);
  h.c.requireSession_ = () => ({ role: 'field', user: fixtureUser });
  h.c.assertTeamDirectorySelection_ = () => {};
  h.c.CacheService = { getScriptCache: () => ({ get: () => '1', put() {}, remove() {} }) };
  h.drive = photoDrive(h);
  if (real && sourceCase) {
    const row = sourceCase.slice(), audit = JSON.parse(row[h.c.meta.COL.AUDIT - 1]);
    row[h.c.meta.COL.STATUS - 1] = h.c.meta.STATUS.CORRECTION_REQUESTED;
    delete audit.lastCorrectionSubmission;
    row[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit);
    h.sheet(h.c.meta.APP.pendingSheet).rows.push(row);
  } else {
    h.seed({
      recordId: CASE, registeredAt: '2026-09-24T17:11:31-03:00', user: fixtureUser,
      base: 'CAICÓ', contract: '4600080938', team: 'LM FIXTURE', crewLeader: 'Chefe FIXTURE',
      occurrenceNumber: 'OCORRENCIA_FIXTURE', occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE', 'LINHA VIVA'],
      pgPostRemoved: 'PG_ORIGINAL_FIXTURE', pgPostInstalled: 'PG_ORIGINAL_FIXTURE', pgConductorStart: '', pgConductorEnd: '',
      transformer: {}, services: [{ lineId: 'hist-1', catalogKey: 'Emergência:1032', code: 'HIST',
        catalogText: 'Serviço histórico preservado', unit: 'UD', group: 'REDES EMERGÊNCIA',
        contract: '4600080938', referenceValue: 20, quantity: 10, totalValue: 200, origin: 'Emergência' }],
      materials: [{ lineId: 'mat-1', code: '000123', description: 'Material TESTE', unit: 'M', quantity: 1 }],
      totalServices: 200, observation: ''
    }, { status: h.c.meta.STATUS.CORRECTION_REQUESTED });
    const row = h.sheet(h.c.meta.APP.pendingSheet).rows[1], audit = JSON.parse(row[h.c.meta.COL.AUDIT - 1]);
    audit.lastCorrectionRequest = { requestedAt: '2026-10-06T10:25:02-03:00', photoIndexes: [], reason: 'Conforme alinhado, enviar com PG corretado para fechamento', supervisor: 'Supervisor FIXTURE' };
    audit.timeline.push({ action: 'CORRECAO_SOLICITADA', at: audit.lastCorrectionRequest.requestedAt, actor: 'Supervisor FIXTURE' });
    row[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit);
  }
  h.row = () => h.sheet(h.c.meta.APP.pendingSheet).rows[1];
  h.state = () => plain(h.c.getRecordState_({ token: 'fixture', recordId: CASE }));
  h.submit = payload => h.c.submitRecord_({ token: 'fixture', clientVersion: core.APP_VERSION, record: payload });
  h.resends = () => h.sheet(h.c.meta.APP.historySheet).rows.filter(r => r[3] === 'CORRECAO_REENVIADA').length;
  return h;
}

// A DOM/event harness: controls come from the real HTML; the real bindEvents registers
// input, textarea and button handlers. No browser, service or production storage is used.
class Control {
  constructor(id = '', attrs = {}) {
    Object.assign(this, { id, value: '', checked: false, hidden: false, disabled: false, textContent: '', dataset: {}, open: false, listeners: new Map(), children: [], attrs });
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(f => f !== fn)); }
  async fire(type, target = this) {
    const event = { type, target, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    await Promise.all((this.listeners.get(type) || []).map(fn => fn(event)));
    await Promise.resolve(); await Promise.resolve();
  }
  closest(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1) ? this : null;
    const attr = selector.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    return attr && Object.hasOwn(this.attrs, attr[1]) && (attr[2] == null || this.attrs[attr[1]] === attr[2]) ? this : null;
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  removeAttribute(name) { delete this.attrs[name]; }
  querySelectorAll(selector) {
    if (selector.startsWith('input[type="checkbox"]')) return this.children.filter(c => c.attrs.type === 'checkbox' && (!selector.includes(':checked') || c.checked));
    const attr = selector.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    return attr ? this.children.filter(c => c.closest(selector)) : [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || new Control(); }
  insertAdjacentHTML() {}
  scrollIntoView() {}
  showModal() { this.open = true; }
  close(value) { this.open = false; this.returnValue = value; void this.fire('close'); }
  focus() {}
  set innerHTML(value) {
    this._html = value; this.children = [];
    for (const match of value.matchAll(/<(input|select|span)\b([^>]+)>/g)) {
      const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
      const c = new Control(attrs.id || '', attrs); c.value = attrs.value || '';
      for (const [name, text] of Object.entries(attrs)) if (name.startsWith('data-')) c.dataset[name.slice(5).replace(/-([a-z])/g, (_, s) => s.toUpperCase())] = text;
      this.children.push(c);
    }
  }
  get innerHTML() { return this._html || ''; }
}

function client(h, old = false) {
  const namespace = old ? oldCore : core, source = old ? previousApp : appSource, apiText = old ? previousApi : apiSource;
  const controls = new Map();
  for (const m of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) controls.set(m[2], new Control(m[2], { tagName: m[1] }));
  for (const value of namespace.OCCURRENCE_TYPES) {
    const c = new Control('', { type: 'checkbox' }); c.value = value; controls.get('occurrenceTypes').children.push(c);
  }
  const document = new Control('document');
  document.querySelector = selector => selector.startsWith('#') ? controls.get(selector.slice(1)) || new Control() : new Control();
  document.querySelectorAll = () => [];
  document.body = new Control('body'); document.documentElement = new Control('html'); document.createElement = () => new Control();
  const saved = new Map(), photos = new Map(), requests = [], payloads = [], messages = [], tasks = [];
  const kv = new Map(); let deferredWrite = null, afterQueue = null, loseData = false, losePhoto = false;
  const c = vm.createContext({
    ...namespace, messages, __messages: messages, tasks, console: { warn() {}, error() {}, log() {} }, JSON, Date, Math, Map, Set, Number, String, Blob, structuredClone,
    document, navigator: { onLine: true }, localStorage: { getItem: k => kv.get(k) || null, setItem: (k, v) => kv.set(k, v), removeItem: k => kv.delete(k) },
    window: { scrollTo() {}, addEventListener() {} }, requestAnimationFrame: fn => fn(), CSS: { escape: v => v },
    URL, AbortController, setTimeout, clearTimeout, crypto: { randomUUID },
    FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(b => { this.result = 'data:image/jpeg;base64,' + Buffer.from(b).toString('base64'); this.onload(); }); } },
    getRecord: async id => saved.has(id) ? structuredClone(saved.get(id)) : null, getAllRecords: async () => [...saved.values()].map(r => structuredClone(r)),
    putRecord: async (record, options = {}) => {
      const snapshot = structuredClone(record);
      if (deferredWrite) { const gate = deferredWrite; deferredWrite = null; await gate.promise; }
      const oldRecord = saved.get(record.recordId);
      if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== String(oldRecord?.updatedAt || '')) { const e = Error('Local changed'); e.code = 'LOCAL_RECORD_CHANGED'; throw e; }
      snapshot.updatedAt = new Date(Math.max(Date.now(), (Date.parse(oldRecord?.updatedAt || '') || 0) + 1)).toISOString();
      saved.set(record.recordId, snapshot);
      if (snapshot.status === namespace.RECORD_STATUS.PENDING && afterQueue) { const run = afterQueue; afterQueue = null; await run(); }
      return structuredClone(snapshot);
    },
    putPhotoAndRecord: async (record, index, blob, uploadKey) => {
      const r = { ...structuredClone(record), updatedAt: new Date().toISOString() };
      saved.set(record.recordId, r); photos.set(record.recordId + ':' + index, { recordId: record.recordId, photoIndex: index, blob, uploadKey });
      return { record: r };
    },
    getPhoto: async (id, index) => photos.get(id + ':' + index), getPhotosForRecord: async id => [...photos.values()].filter(p => p.recordId === id),
    deletePhoto: async (id, index, key) => { if (photos.get(id + ':' + index)?.uploadKey === key) photos.delete(id + ':' + index); },
    setMeta: async () => {}, getMeta: async () => null, clearMetaIfValue: async () => {}, openDatabase: async () => {},
    cacheCatalogResults: async () => {}, getCachedMaterialCatalog: async () => null, cacheMaterialCatalog: async () => {}, searchCachedCatalog: async () => [],
    fetch: async (_, options) => {
      const p = JSON.parse(options.body); requests.push(p.action);
      if (p.action === 'submitRecord') payloads.push(plain(p.record));
      let data; try { data = p.action === 'submitRecord' ? h.c.submitRecord_(p) : p.action === 'uploadPhoto' ? h.c.uploadPhoto_(p) : h.c.getRecordState_(p); }
      catch (error) { data = { ok: false, error: error.code || 'SERVER_ERROR', message: error.message }; }
      if (loseData && p.action === 'submitRecord' && data.ok) { loseData = false; throw Error('Response lost'); }
      if (losePhoto && p.action === 'uploadPhoto' && data.ok) { losePhoto = false; throw Error('Response lost'); }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    }
  });
  vm.runInContext("const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec'; const MATERIAL_CATALOG_SOURCE={};\n" + apiText.replace(/^import .*?;\n/gm, '').replace(/^export /gm, ''), c);
  const stripped = source.replace(/^import [^]*?;\n/gm, '').replace(/\ninitialize\(\)\.catch[^]*$/, '');
  vm.runInContext(stripped + '\nthis.hooks={api,bindEvents,loadRecordIntoForm,submitOccurrence,syncSingleRecord,syncAll,saveActiveDraft,syncFormToRecord,handleFormInput,handleMineAction,occurrenceDetails,active:()=>activeRecord,setActive:r=>{activeRecord=r},setSession:s=>{session=s;sessionRevision=1},setMine:r=>{mineRecords=r}};\n' +
    'toast=(message)=>{__messages.push(message)};confirmAction=async()=>true;renderServices=()=>{};renderMaterials=()=>{};renderAssignmentControls=(edit,record)=>{if(!edit&&record){elements.team.value=record.team;elements.crewLeader.value=record.crewLeader}};updatePhotoGrid=()=>{};updateGoal=()=>{};showDraftId=()=>{};goToStep=()=>{};navigate=()=>{};loadDailyProduction=async()=>{};updateQueueUi=async()=>{};cacheDailySummary=async()=>{};refreshMine=()=>{};assignmentError=()=>"";setBusy=()=>{};resetForm=()=>{};\n', c);
  // Expose only fixture state. The ordinary application handlers remain registered.
  c.messages = messages;
  c.hooks.setSession({ role: 'field', user: fixtureUser, token: 'fixture' });
  c.hooks.bindEvents();
  const run = c.hooks.syncSingleRecord;
  c.hooks.syncSingleRecord = (...args) => { const task = run(...args); tasks.push(task); return task; };
  vm.runInContext('const originalSync=syncSingleRecord;syncSingleRecord=(...args)=>{const task=originalSync(...args);this.tasks.push(task);return task};', c);
  c.tasks = tasks;
  return {
    c, controls, saved, photos, requests, payloads, messages,
    async open() {
      const record = h.state().record; record.correctionMode = true; record.serverConfirmed = true; record.serverStatus = 'CORRECAO_SOLICITADA';
      record.correctionRequestedAt = record.audit.lastCorrectionRequest.requestedAt;
      await c.hooks.loadRecordIntoForm(record);
      saved.set(CASE, structuredClone(c.hooks.active())); return record;
    },
    async input(id, value, fire = true) { const control = controls.get(id); assert.ok(control, id); control.value = value; if (fire) await control.fire('input'); },
    async click() { await controls.get('submitOccurrenceButton').fire('click'); await Promise.all(tasks); },
    holdNextWrite() { let release; const promise = new Promise(r => { release = r; }); deferredWrite = { promise }; return release; },
    afterQueue(run) { afterQueue = run; },
    loseData() { loseData = true; }, losePhoto() { losePhoto = true; }
  };
}

test('baseline: backend aceita no-change com COMPLETE e evento final', () => {
  const h = harness(baseline), record = h.state().record;
  const result = h.submit({ ...record, correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt });
  assert.equal(result.record.audit.lastCorrectionSubmission.phase, 'COMPLETE');
  assert.deepEqual(plain(result.record.audit.lastCorrectionSubmission.expectedPatch), {});
  assert.equal(h.resends(), 1);
  traces.push({ scenario: 'baseline-empty', phase: 'COMPLETE', expectedPatch: {}, resends: 1 });
});
test('baseline DOM: bindings normais de PG + observação capturam ambos no payload', async () => {
  const h = harness(baseline), ui = client(h, true); await ui.open();
  await ui.input('pgPostInstalled', 'NOVO_PG'); await ui.input('observation', 'POSTE ALTERADO PARA FECHAMENTO'); await ui.click();
  assert.equal(ui.payloads[0].pgPostInstalled, 'NOVO_PG');
  assert.equal(ui.payloads[0].observation, 'POSTE ALTERADO PARA FECHAMENTO');
  assert.equal(h.state().record.pgPostInstalled, 'NOVO_PG');
  traces.push({ scenario: 'baseline-normal-dom', payloadCapturedBoth: true });
});
test('baseline DOM: autosave antigo que termina depois do enqueue elimina o delta e recebe COMPLETE', async () => {
  const h = harness(baseline), ui = client(h, true); await ui.open();
  const release = ui.holdNextWrite(), oldSave = ui.c.hooks.saveActiveDraft();
  await ui.input('pgPostInstalled', 'NOVO_PG', false);
  await ui.input('observation', 'POSTE ALTERADO PARA FECHAMENTO', false);
  ui.afterQueue(async () => { release(); await oldSave; });
  await ui.click();
  assert.equal(ui.controls.get('pgPostInstalled').value, 'NOVO_PG');
  assert.equal(ui.payloads[0].pgPostInstalled, 'PG_ORIGINAL_FIXTURE');
  assert.equal(ui.payloads[0].observation, '');
  assert.deepEqual(h.state().record.audit.lastCorrectionSubmission.expectedPatch, {});
  assert.equal(h.state().record.audit.lastCorrectionSubmission.phase, 'COMPLETE');
  traces.push({ scenario: 'baseline-late-autosave', domPg: 'NOVO_PG', payloadPg: ui.payloads[0].pgPostInstalled, expectedPatch: {}, phase: 'COMPLETE' });
});

for (const [id, field, value] of [['pgPostRemoved', 'pgPostRemoved', 'R99998'], ['pgPostInstalled', 'pgPostInstalled', 'R99999'], ['observation', 'observation', 'POSTE ALTERADO PARA FECHAMENTO']]) {
  test('DOM → backend: somente ' + field, async () => {
    const h = harness(), ui = client(h); await ui.open();
    const original = plain(ui.c.hooks.active().correctionOriginal);
    await ui.input(id, value); await ui.click();
    const payload = ui.payloads[0], receipt = h.state().record.audit.lastCorrectionSubmission;
    assert.deepEqual(Object.keys(payload.expectedPatch), [field]);
    assert.equal(payload.expectedPatch[field], value);
    assert.deepEqual(Object.keys(receipt.expectedPatch), [field]);
    assert.equal(receipt.beforePatch[field], original.data[field]);
    assert.equal(h.state().record[field], value);
    assert.equal(h.state().status, 'AGUARDANDO_SUPERVISOR');
    assert.equal(receipt.phase, 'COMPLETE'); assert.equal(h.resends(), 1);
    assert.deepEqual(plain(ui.c.hooks.active().correctionOriginal), original);
  });
}
test('fixture de referência: DOM atual, PG + observação, payload não vazio, releitura e Supervisor', async () => {
  const h = harness(backend, true), ui = client(h); await ui.open();
  await ui.input('pgPostInstalled', 'NOVO_PG', false); await ui.input('observation', 'POSTE ALTERADO PARA FECHAMENTO', false);
  await ui.click();
  assert.ok(ui.payloads[0], ui.messages.join(' / '));
  assert.equal(ui.payloads[0].expectedPatch.pgPostInstalled, 'NOVO_PG');
  assert.equal(ui.payloads[0].expectedPatch.observation, 'POSTE ALTERADO PARA FECHAMENTO');
  assert.deepEqual(Object.keys(ui.payloads[0].expectedPatch).sort(), ['observation', 'pgPostInstalled']);
  const state = h.state(); assert.equal(state.record.pgPostInstalled, 'NOVO_PG'); assert.equal(state.record.observation, 'POSTE ALTERADO PARA FECHAMENTO');
  assert.equal(state.record.recordId, CASE); assert.equal(h.resends(), 1);
  h.c.requireSession_ = () => ({ role: 'supervisor', user: 'Supervisor FIXTURE' });
  const supervisor = h.c.getRecordState_({ token: 'fixture', recordId: CASE });
  assert.equal(supervisor.record.pgPostInstalled, 'NOVO_PG'); assert.equal(supervisor.record.observation, 'POSTE ALTERADO PARA FECHAMENTO');
  assert.equal(core.correctedAfterResend(supervisor.record), true);
  traces.push({ scenario: 'fixed-realistic-dom', beforePatch: state.record.audit.lastCorrectionSubmission.beforePatch, expectedPatch: state.record.audit.lastCorrectionSubmission.expectedPatch, phase: state.record.audit.lastCorrectionSubmission.phase, uuid: CASE });
});
test('DOM: commit espera autosave antigo, depois preserva candidato capturado no clique', async () => {
  const h = harness(), ui = client(h); await ui.open();
  const release = ui.holdNextWrite(), oldSave = ui.c.hooks.saveActiveDraft();
  await ui.input('pgPostInstalled', 'NOVO_PG', false); await ui.input('observation', 'POSTE ALTERADO PARA FECHAMENTO', false);
  const click = ui.click();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(ui.payloads.length, 0); release(); await oldSave; await click;
  assert.equal(ui.payloads[0].pgPostInstalled, 'NOVO_PG'); assert.equal(ui.payloads[0].observation, 'POSTE ALTERADO PARA FECHAMENTO');
  assert.equal(h.state().record.audit.lastCorrectionSubmission.phase, 'COMPLETE');
});
test('DOM: nenhuma alteração bloqueia antes da fila e mantém pedido', async () => {
  const h = harness(), ui = client(h); await ui.open(); await ui.click();
  assert.equal(ui.payloads.length, 0); assert.ok(ui.messages.includes(noChanges)); assert.equal(h.resends(), 0);
  assert.equal(h.state().status, 'CORRECAO_SOLICITADA');
});
test('backend: no-change real é NO_CORRECTION_CHANGES sem staging ou evento', () => {
  const h = harness(), state = h.state(), row = h.row().slice();
  assert.throws(() => h.submit({ ...state.record, correctionRequestId: randomUUID(), correctionRequestedAt: state.record.audit.lastCorrectionRequest.requestedAt }), e => e.code === 'NO_CORRECTION_CHANGES');
  assert.deepEqual(h.row(), row); assert.equal(h.resends(), 0);
});
test('backend: metadata de UI não representa alteração', () => {
  const h = harness(), record = h.state().record; record.services[0].searchLabel = 'metadata local'; record.materials[0].lineId = randomUUID();
  assert.throws(() => h.submit({ ...record, correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt }), e => e.code === 'NO_CORRECTION_CHANGES');
  assert.equal(h.resends(), 0);
});
test('backend: fake COMPLETE vazio não é retry idempotente nem badge corrigido', () => {
  const h = harness(), record = h.state().record, requestId = randomUUID();
  const audit = JSON.parse(h.row()[h.c.meta.COL.AUDIT - 1]);
  audit.lastCorrectionSubmission = { requestId, requestedAt: audit.lastCorrectionRequest.requestedAt, receivedAt: h.c.nowIso_(), completedAt: h.c.nowIso_(), dataVerifiedAt: h.c.nowIso_(), phase: 'COMPLETE', expectedPatch: {}, beforePatch: {}, expectedFingerprint: h.c.correctionFingerprint_(h.c.correctionDataFromValues_(h.row())) };
  h.row()[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit); h.row()[h.c.meta.COL.STATUS - 1] = 'AGUARDANDO_SUPERVISOR';
  assert.equal(h.state().status, 'CORRECAO_SOLICITADA');
  assert.equal(core.correctedAfterResend({ ...h.state().record, status: 'AGUARDANDO_SUPERVISOR' }), false);
  assert.throws(() => h.submit({ ...record, correctionRequestId: requestId, correctionRequestedAt: audit.lastCorrectionRequest.requestedAt }), e => e.code === 'NO_CORRECTION_CHANGES');
  const result = h.submit({ ...record, pgPostInstalled: 'REENVIO_REAL', correctionRequestId: randomUUID(), correctionRequestedAt: audit.lastCorrectionRequest.requestedAt });
  assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(h.resends(), 1);
});
test('DOM: resposta de dados perdida, retry mantém requestId e um evento', async () => {
  const h = harness(), ui = client(h); await ui.open(); await ui.input('pgPostInstalled', 'NOVO_PG'); ui.loseData(); await ui.click();
  assert.equal(h.state().record.pgPostInstalled, 'NOVO_PG'); const requestId = ui.payloads[0].correctionRequestId;
  await ui.c.hooks.syncSingleRecord(CASE, false);
  assert.equal(ui.payloads[1].correctionRequestId, requestId); assert.equal(h.resends(), 1);
  assert.equal(ui.saved.get(CASE).status, 'AGUARDANDO_SUPERVISOR');
});
for (const id of ['removedTransformerCode', 'removedTransformerCia', 'removedTransformerBto', 'newTransformerCode', 'newTransformerCia', 'newTransformerBto']) {
  const key = { removedTransformerCode: 'removedCode', removedTransformerCia: 'removedCia', removedTransformerBto: 'removedBto', newTransformerCode: 'newCode', newTransformerCia: 'newCia', newTransformerBto: 'newBto' }[id];
  test('DOM → backend: trafo ' + key + ' editável em correção', async () => {
    const h = harness(), ui = client(h); await ui.open(); await ui.input(id, 'VALOR_' + key); await ui.click();
    assert.equal(ui.payloads[0].expectedPatch.transformer[key], 'VALOR_' + key);
    assert.equal(h.state().record.transformer[key], 'VALOR_' + key); assert.equal(h.resends(), 1);
  });
}
for (const key of ['pgConductorStart', 'pgConductorEnd']) test('DOM → backend: ' + key, async () => {
  const h = harness(), ui = client(h); await ui.open(); await ui.input(key, 'PG_CONDUTOR'); await ui.click();
  assert.deepEqual(Object.keys(ui.payloads[0].expectedPatch), [key]); assert.equal(h.state().record[key], 'PG_CONDUTOR');
});

function replacePhoto(ui, index) {
  const record = ui.c.hooks.active(), uploadKey = randomUUID();
  record.photoStates[index - 1] = { ...record.photoStates[index - 1], confirmed: false, localReady: true, replacePending: true, uploadKey };
  ui.photos.set(CASE + ':' + index, { recordId: CASE, photoIndex: index, uploadKey, blob: new Blob(['replacement-' + index], { type: 'image/jpeg' }) });
  return uploadKey;
}
test('DOM → backend: foto-only contém photoPatch e só conclui após slot confirmado', async () => {
  const h = harness(), ui = client(h); await ui.open(); const key = replacePhoto(ui, 1); await ui.click();
  assert.deepEqual(ui.payloads[0].expectedPatch, {}); assert.deepEqual(ui.payloads[0].photoPatch, { 1: { uploadKey: key } });
  const record = h.state().record; assert.equal(record.audit.lastCorrectionSubmission.phase, 'COMPLETE');
  assert.equal(record.photoStates[0].uploadKey, key); assert.equal(h.resends(), 1); assert.equal(h.drive.created(), 1);
  assert.equal(core.correctedAfterResend(record), true);
});
test('backend: intenção foto-only aguarda upload; foto antiga não conta como delta', () => {
  const h = harness(), record = h.state().record, key = randomUUID();
  const result = h.submit({ ...record, correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt, photoPatch: { 1: { uploadKey: key } } });
  assert.equal(result.status, 'CORRECAO_SOLICITADA'); assert.equal(result.record.audit.lastCorrectionSubmission.phase, 'DATA_VERIFIED');
  assert.equal(h.resends(), 0); assert.equal(h.drive.created(), 0);
  assert.equal(core.correctionConfirmationMatches({ ...record, correctionRequestId: result.record.audit.lastCorrectionSubmission.requestId, correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt }, result), true);
  assert.equal(core.correctionReceiptHasChanges(result.record, true), false);
});
test('DOM: resposta de foto perdida, reload e retry não duplicam arquivo/histórico', async () => {
  const h = harness(), ui = client(h); await ui.open(); const key = replacePhoto(ui, 1); ui.losePhoto(); await ui.click();
  assert.equal(h.state().record.photoStates[0].uploadKey, key); assert.equal(h.drive.created(), 1); assert.equal(h.resends(), 1);
  const reopened = client(h); reopened.saved.set(CASE, structuredClone(ui.saved.get(CASE))); for (const [id, photo] of ui.photos) reopened.photos.set(id, photo);
  await reopened.c.hooks.syncAll(false);
  assert.equal(reopened.saved.get(CASE).status, 'AGUARDANDO_SUPERVISOR'); assert.equal(h.drive.created(), 1); assert.equal(h.resends(), 1);
  assert.equal(reopened.requests.includes('uploadPhoto'), false); assert.equal(reopened.photos.size, 0);
});
test('DOM → backend: limpar observação explícita é valor vazio, diferente de ausente', async () => {
  const h = harness(); h.row()[h.c.meta.COL.OBSERVATION - 1] = 'texto antigo'; const ui = client(h); await ui.open(); await ui.input('observation', ''); await ui.click();
  const receipt = h.state().record.audit.lastCorrectionSubmission;
  assert.equal(ui.payloads[0].expectedPatch.observation, ''); assert.equal(receipt.beforePatch.observation, 'texto antigo'); assert.equal(h.state().record.observation, '');
});
test('DOM: trafo combinado mantém seis campos no patch', async () => {
  const h = harness(), ui = client(h); await ui.open();
  const mapping = { removedTransformerCode: 'removedCode', removedTransformerCia: 'removedCia', removedTransformerBto: 'removedBto', newTransformerCode: 'newCode', newTransformerCia: 'newCia', newTransformerBto: 'newBto' };
  for (const [id, key] of Object.entries(mapping)) await ui.input(id, 'TRAFO_' + key);
  await ui.click(); for (const key of Object.values(mapping)) assert.equal(h.state().record.transformer[key], 'TRAFO_' + key);
});
test('DOM: PG apenas preserva histórico sem leitura do catálogo', async () => {
  const h = harness(), before = h.state().record, ui = client(h); await ui.open(); await ui.input('pgPostInstalled', 'PG_HIST'); await ui.click();
  assert.deepEqual(core.correctionDataSnapshot(h.state().record).services, core.correctionDataSnapshot(before).services); assert.equal(h.catalog.reads, 0);
  assert.equal(h.sheet(h.c.meta.APP.servicesSheet).writes, 0); assert.equal(h.sheet(h.c.meta.APP.materialsSheet).writes, 0);
});
test('backend: QTD 15,50 serializada vira 15.5 com preço histórico 20', () => {
  const h = harness(), record = h.state().record;
  const candidate = { ...record, services: core.serializeServicesForBackend(record.services.map(s => ({ ...s, quantity: '15,50', totalValue: 310 }))) };
  const result = h.submit({ ...candidate, correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt });
  assert.equal(result.record.services[0].quantity, 15.5); assert.equal(result.record.services[0].referenceValue, 20); assert.equal(result.record.totalServices, 310);
  assert.ok(result.record.audit.lastCorrectionSubmission.expectedPatch.services); assert.equal(h.catalog.reads, 0);
});
test('DOM: material apenas entra no delta e preserva código STRING com zero inicial', async () => {
  const h = harness(), ui = client(h); await ui.open(); ui.c.hooks.active().materials[0].quantity = 2.5; await ui.click();
  assert.deepEqual(Object.keys(ui.payloads[0].expectedPatch), ['materials']); assert.equal(h.state().record.materials[0].code, '000123'); assert.equal(h.state().record.materials[0].quantity, 2.5);
});
test('backend: catálogo atual vale para serviço novo e entra no delta', () => {
  const h = harness(), record = h.state().record;
  const candidate = { ...record, services: [{ lineId: randomUUID(), catalogKey: 'Emergência:3', code: 'NOVO', catalogText: 'Serviço novo', unit: 'UD', group: 'Grupo', contract: '4600080938', referenceValue: 40, quantity: 1.5, totalValue: 60, origin: 'Emergência' }] };
  const result = h.submit({ ...candidate, correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt });
  assert.equal(result.record.services[0].code, 'NOVO'); assert.ok(result.record.audit.lastCorrectionSubmission.expectedPatch.services); assert.equal(h.catalog.reads, 1);
});
test('backend: delta do cliente inconsistente não é aceito', () => {
  const h = harness(), record = h.state().record;
  assert.throws(() => h.submit({ ...record, pgPostInstalled: 'PG_REAL', correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt, expectedPatch: {}, beforePatch: {} }), e => e.code === 'CORRECTION_DELTA_MISMATCH'); assert.equal(h.resends(), 0);
});
test('backend: PG não persistido bloqueia COMPLETE e evento final', () => {
  const h = harness(), record = h.state().record, pending = h.sheet(h.c.meta.APP.pendingSheet), range = pending.getRange.bind(pending), column = h.c.meta.COL.PG_POST_INSTALLED;
  pending.getRange = (...args) => { const r = range(...args), set = r.setValues; r.setValues = values => { const v = values.map(row => row.slice()); if (args[1] === 1 && args[3] === h.c.meta.COL.WIDTH) v[0][column - 1] = 'PG_ORIGINAL_FIXTURE'; return set(v); }; return r; };
  assert.throws(() => h.submit({ ...record, pgPostInstalled: 'PG_REAL', correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt }), e => e.code === 'CORRECTION_PERSISTENCE_MISMATCH');
  assert.equal(h.state().status, 'CORRECAO_SOLICITADA'); assert.notEqual(h.state().record.audit.lastCorrectionSubmission.phase, 'COMPLETE'); assert.equal(h.resends(), 0);
});
test('snapshot original é independente e imutável; current não o modifica', async () => {
  const h = harness(), ui = client(h); await ui.open(); const before = ui.c.hooks.active().correctionOriginal;
  assert.equal(Object.isFrozen(before), true); assert.equal(Object.isFrozen(before.data.transformer), true);
  await ui.input('pgPostInstalled', 'PG_NOVO'); assert.equal(before.data.pgPostInstalled, 'PG_ORIGINAL_FIXTURE');
  ui.c.hooks.active().services[0].quantity = 99; assert.equal(before.data.services[0].quantity, 10);
});
test('DOM: reload do rascunho conserva current editado e original separado', async () => {
  const h = harness(), ui = client(h); await ui.open(); await ui.input('pgPostInstalled', 'PG_DRAFT'); await ui.input('observation', 'DRAFT LOCAL');
  const saved = structuredClone(ui.saved.get(CASE)), reopened = client(h); await reopened.c.hooks.loadRecordIntoForm(saved);
  assert.equal(reopened.controls.get('pgPostInstalled').value, 'PG_DRAFT');
  assert.equal(reopened.c.hooks.active().correctionOriginal.data.pgPostInstalled, 'PG_ORIGINAL_FIXTURE'); assert.equal(Object.isFrozen(reopened.c.hooks.active().correctionOriginal.data), true);
  reopened.saved.set(CASE, structuredClone(reopened.c.hooks.active())); await reopened.click();
  assert.equal(reopened.payloads[0].expectedPatch.pgPostInstalled, 'PG_DRAFT'); assert.equal(reopened.payloads[0].expectedPatch.observation, 'DRAFT LOCAL');
});
test('DOM: offline mantém delta e UUID na fila; sincronizar tudo conclui online', async () => {
  const h = harness(), ui = client(h); await ui.open(); await ui.input('pgPostInstalled', 'PG_OFFLINE'); ui.c.navigator.onLine = false; await ui.click();
  assert.equal(ui.payloads.length, 0); assert.equal(ui.saved.get(CASE).recordId, CASE); assert.equal(ui.saved.get(CASE).expectedPatch.pgPostInstalled, 'PG_OFFLINE');
  const reopened = client(h); reopened.saved.set(CASE, structuredClone(ui.saved.get(CASE))); await reopened.c.hooks.syncAll(false);
  assert.equal(h.state().record.pgPostInstalled, 'PG_OFFLINE'); assert.equal(h.resends(), 1);
});
test('backend: pedido de foto sem alteração de foto no payload atual continua no-change', () => {
  const h = harness(), record = h.state().record, audit = JSON.parse(h.row()[h.c.meta.COL.AUDIT - 1]); audit.requestedPhotoIndexes = [1]; h.row()[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit);
  assert.throws(() => h.submit({ ...record, correctionRequestId: randomUUID(), correctionRequestedAt: audit.lastCorrectionRequest.requestedAt, photoPatch: {}, evidencePatch: {} }), e => e.code === 'NO_CORRECTION_CHANGES'); assert.equal(h.resends(), 0);
});
test('recuperação C do fixture de referência preserva UUID, pedido, Supervisor, histórico, serviços, materiais e fotos', () => {
  const h = harness(); const pending = h.sheet(h.c.meta.APP.pendingSheet);
  if (sourceCase) pending.rows[1] = sourceCase.slice();
  else { const old = harness(baseline), record = old.state().record; old.submit({ ...record, correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt }); pending.rows[1] = old.row().slice(); }
  const before = h.row().slice(), audit = JSON.parse(before[h.c.meta.COL.AUDIT - 1]);
  const item = { recordId: CASE, classification: 'C', recoveryId: 'fixture-delta-recovery', expectedStatus: 'AGUARDANDO_SUPERVISOR', requestedAt: audit.lastCorrectionRequest.lastRequestedAt || audit.lastCorrectionRequest.requestedAt,
    lastResendAt: audit.timeline.filter(e => e.action === 'CORRECAO_REENVIADA').at(-1).at, expectedRowFingerprint: h.c.sha256_(h.c.publicationJson_(before)) };
  const result = h.c.recoverCorrectionCases_([item])[0]; assert.equal(result.action, 'REOPENED_ORIGINAL_REQUEST'); assert.equal(result.newResendNeeded, true);
  before.forEach((value, i) => { if (![h.c.meta.COL.STATUS - 1, h.c.meta.COL.AUDIT - 1].includes(i)) assert.deepEqual(h.row()[i], value); });
  const after = JSON.parse(h.row()[h.c.meta.COL.AUDIT - 1]);
  for (const key of ['timeline', 'lastCorrectionRequest', 'pendingServices', 'pendingMaterials', 'photoFileIds', 'lastCorrectionSubmission']) assert.deepEqual(after[key], audit[key]);
  assert.equal(h.c.recoverCorrectionCases_([item])[0].action, 'ALREADY_APPLIED'); assert.equal(h.row()[h.c.meta.COL.STATUS - 1], 'CORRECAO_SOLICITADA');
  assert.equal(h.resends(), 0);
});
test('recuperação B rejeita expectedPatch vazio; nenhum valor pode ser inventado', () => {
  const old = harness(baseline), record = old.state().record; old.submit({ ...record, correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt });
  const h = harness(); h.sheet(h.c.meta.APP.pendingSheet).rows[1] = old.row().slice(); const before = h.row().slice(), audit = JSON.parse(before[h.c.meta.COL.AUDIT - 1]);
  const item = { recordId: CASE, classification: 'B', recoveryId: 'fixture-B', expectedStatus: 'AGUARDANDO_SUPERVISOR', requestedAt: audit.lastCorrectionRequest.requestedAt,
    lastResendAt: audit.timeline.filter(e => e.action === 'CORRECAO_REENVIADA').at(-1).at, expectedRowFingerprint: h.c.sha256_(h.c.publicationJson_(before)), patch: {}, sourceRequestId: audit.lastCorrectionSubmission.requestId };
  assert.equal(h.c.recoverCorrectionCases_([item])[0].error, 'CORRECTION_RECOVERY_NO_SOURCE'); assert.deepEqual(h.row(), before);
});
test('DOM: slots parciais de correção enviam somente a foto ainda faltante', async () => {
  const h = harness(), ui = client(h); await ui.open(); replacePhoto(ui, 1); replacePhoto(ui, 2); ui.losePhoto(); await ui.click();
  assert.equal(h.drive.created(), 1); assert.equal(h.resends(), 0); assert.equal(h.state().record.audit.lastCorrectionSubmission.phase, 'DATA_VERIFIED');
  const requestsBefore = ui.requests.filter(a => a === 'uploadPhoto').length; await ui.c.hooks.syncSingleRecord(CASE, false);
  assert.equal(ui.requests.filter(a => a === 'uploadPhoto').length - requestsBefore, 1); assert.equal(h.drive.created(), 2); assert.equal(h.resends(), 1);
  assert.equal(ui.saved.get(CASE).status, 'AGUARDANDO_SUPERVISOR');
});
test('DOM: evidência Trafo somente contém evidencePatch e confirmação segura', async () => {
  const h = harness(), row = h.row(), { COL, TYPES } = { ...h.c.meta, TYPES: core.OCCURRENCE_TYPES };
  row[COL.TYPES - 1] = TYPES[0];
  for (const key of ['REMOVED_CODE', 'REMOVED_CIA', 'REMOVED_BTO', 'NEW_CODE', 'NEW_CIA', 'NEW_BTO']) row[COL[key] - 1] = 'ORIGINAL_' + key;
  for (const index of [6, 7]) { row[h.c.photoUrlColumn_(index) - 1] = 'https://example.test/trafo-' + index + '.jpg'; row[h.c.photoUploadKeyColumn_(index) - 1] = randomUUID(); }
  const ui = client(h); await ui.open(); const key = replacePhoto(ui, 6); await ui.click();
  assert.ok(ui.payloads[0], ui.messages.join('/')); assert.deepEqual(ui.payloads[0].expectedPatch, {}); assert.deepEqual(ui.payloads[0].evidencePatch, { 6: { uploadKey: key } });
  assert.equal(h.state().record.photoStates[5].uploadKey, key); assert.equal(h.resends(), 1); assert.equal(h.drive.created(), 1);
});
test('DOM input QTD 15,50 → state → delta → payload → 15.5 persistido com preço histórico', async () => {
  const h = harness(), ui = client(h); await ui.open();
  const input = new Control('', { 'data-service-quantity': 'hist-1' }); input.value = '15,50'; input.dataset.serviceQuantity = 'hist-1';
  await ui.controls.get('servicesList').fire('input', input); await ui.click();
  assert.ok(ui.payloads[0], ui.messages.join('/')); assert.equal(ui.payloads[0].expectedPatch.services[0].quantity, 15.5);
  assert.equal(h.state().record.services[0].quantity, 15.5); assert.equal(h.state().record.services[0].referenceValue, 20); assert.equal(h.state().record.totalServices, 310); assert.equal(h.catalog.reads, 0);
});
test('DOM input material 2,50 → delta normalizado e código 000123 preservado', async () => {
  const h = harness(), ui = client(h); await ui.open();
  const input = new Control('', { 'data-material-quantity': 'mat-1' }); input.value = '2,50'; input.dataset.materialQuantity = 'mat-1';
  await ui.controls.get('materialsList').fire('input', input); await ui.click();
  assert.ok(ui.payloads[0], ui.messages.join('/')); assert.equal(ui.payloads[0].expectedPatch.materials[0].quantity, 2.5);
  assert.equal(h.state().record.materials[0].quantity, 2.5); assert.equal(h.state().record.materials[0].code, '000123');
});
test('DOM: reentrada por CORRIGIR conserva substituição local não solicitada explicitamente', async () => {
  const h = harness(), ui = client(h); await ui.open(); const key = replacePhoto(ui, 1); await ui.c.hooks.saveActiveDraft();
  ui.c.hooks.setMine([h.state().record]);
  const button = new Control('', { 'data-mine-action': 'correct' }); button.dataset = { mineAction: 'correct', recordId: CASE };
  await ui.c.hooks.handleMineAction({ target: button }); assert.equal(ui.c.hooks.active().photoStates[0].replacePending, true);
  assert.equal(ui.c.hooks.active().photoStates[0].uploadKey, key); await ui.click();
  assert.equal(h.state().record.photoStates[0].uploadKey, key); assert.equal(h.resends(), 1);
});
test('DOM: nova sessão invalida resposta atrasada ao carregar original', async () => {
  const h = harness(), ui = client(h); let resolve; const wait = new Promise(r => { resolve = r; }); const fetch = ui.c.fetch;
  ui.c.fetch = async (...args) => { await wait; return fetch(...args); };
  const opening = ui.open(); ui.c.hooks.setSession({ role: 'field', user: 'outro', token: 'outro-token' }); resolve(); await opening;
  assert.equal(ui.c.hooks.active(), null);
});
test('upgrade: retry decimal já aplicado conserva requestId da assinatura legada', async () => {
  const h = harness(), local = h.state().record, requestId = randomUUID();
  local.services[0].quantity = '15,50'; local.services[0].totalValue = 310; local.totalServices = 310;
  local.correctionMode = true; local.serverConfirmed = true; local.correctionRequestId = requestId; local.correctionRequestedAt = local.audit.lastCorrectionRequest.requestedAt;
  local.correctionPayloadSignature = JSON.stringify(oldCore.correctionDataSnapshot(local));
  h.submit({ ...local, services: core.serializeServicesForBackend(local.services) });
  local.status = 'ERRO_SINCRONIZACAO'; const ui = client(h); ui.saved.set(CASE, structuredClone(local)); await ui.c.hooks.syncSingleRecord(CASE, false);
  assert.equal(ui.payloads[0].correctionRequestId, requestId); assert.equal(ui.saved.get(CASE).status, 'AGUARDANDO_SUPERVISOR'); assert.equal(h.resends(), 1);
});
test('DOM: reabrir CORRIGIR com foto 1 confirmada sem blob exige apenas foto 2 faltante', async () => {
  const h = harness(), audit = JSON.parse(h.row()[h.c.meta.COL.AUDIT - 1]); audit.requestedPhotoIndexes = [1, 2]; audit.lastCorrectionRequest.photoIndexes = [1, 2]; h.row()[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit);
  const ui = client(h); await ui.open(); const key1 = replacePhoto(ui, 1), key2 = replacePhoto(ui, 2), fetch = ui.c.fetch; let failSecond = true;
  ui.c.fetch = async (...args) => { const p = JSON.parse(args[1].body); if (failSecond && p.action === 'uploadPhoto' && p.photoIndex === 2) throw Error('Slot 2 falhou'); return fetch(...args); };
  await ui.click(); assert.equal(ui.photos.has(CASE + ':1'), false); assert.equal(ui.saved.get(CASE).photoStates[0].confirmed, true);
  ui.c.hooks.setMine([h.state().record]); const button = new Control('', { 'data-mine-action': 'correct' }); button.dataset = { mineAction: 'correct', recordId: CASE };
  await ui.c.hooks.handleMineAction({ target: button }); assert.deepEqual(plain(ui.c.hooks.active().requestedPhotoIndexes), [2]);
  failSecond = false; await ui.click(); assert.equal(h.state().status, 'AGUARDANDO_SUPERVISOR'); assert.equal(h.drive.created(), 2); assert.equal(h.resends(), 1);
  assert.equal(h.state().record.photoStates[0].uploadKey, key1); assert.equal(h.state().record.photoStates[1].uploadKey, key2);
});

function supersededCase() {
  const h = harness();
  if (currentCase) h.sheet(h.c.meta.APP.pendingSheet).rows[1] = currentCase.slice();
  else {
    const old = harness(baseline), record = old.state().record;
    old.submit({ ...record, correctionRequestId: randomUUID(), correctionRequestedAt: record.audit.lastCorrectionRequest.requestedAt });
    old.c.requireSession_ = () => ({ role: 'supervisor', user: 'Supervisor FIXTURE' });
    old.c.supervisorCorrectRecord_({ token: 'fixture', record: { ...old.state().record, pgPostRemoved: 'PG_SUPERVISOR_FIXTURE', pgPostInstalled: 'PG_SUPERVISOR_FIXTURE' } });
    h.sheet(h.c.meta.APP.pendingSheet).rows[1] = old.row().slice();
  }
  return h;
}
test('fixture de edição posterior: correção direta do Supervisor preservada sem badge de reenvio vazio', () => {
  const h = supersededCase(), before = h.row().slice(), state = h.state();
  assert.equal(state.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(state.record.pgPostRemoved, before[h.c.meta.COL.PG_POST_REMOVED - 1]); assert.equal(state.record.pgPostInstalled, before[h.c.meta.COL.PG_POST_INSTALLED - 1]);
  assert.equal(state.record.observation, ''); assert.equal(core.correctedAfterResend(state.record), false);
  assert.deepEqual(h.row(), before); assert.equal(h.resends(), 0);
});
test('reenvio antigo após correção do Supervisor não sobrescreve nem reabre o UUID', () => {
  const h = supersededCase(), before = h.row().slice(), record = h.state().record, receipt = record.audit.lastCorrectionSubmission;
  const previous = field => record.audit.lastSupervisorCorrection.changes.find(change => change.field === field)?.previousValue || 'PG_ORIGINAL_FIXTURE';
  assert.throws(() => h.submit({ ...record, pgPostRemoved: previous('PG do poste retirado'), pgPostInstalled: previous('PG do poste instalado'), correctionRequestId: receipt.requestId, correctionRequestedAt: receipt.requestedAt }), e => e.code === 'CORRECTION_PAYLOAD_CHANGED');
  assert.deepEqual(h.row(), before); assert.equal(h.state().status, 'AGUARDANDO_SUPERVISOR'); assert.equal(h.resends(), 0);
});
test('recuperação C não reabre correção legítima do Supervisor; classificação A preserva tudo', () => {
  const h = supersededCase(), before = h.row().slice(), audit = JSON.parse(before[h.c.meta.COL.AUDIT - 1]);
  const item = { recordId: CASE, classification: 'C', recoveryId: 'fixture-supervisor-preservation', expectedStatus: 'AGUARDANDO_SUPERVISOR', requestedAt: audit.lastCorrectionRequest.requestedAt,
    lastResendAt: audit.timeline.filter(e => e.action === 'CORRECAO_REENVIADA').at(-1).at, expectedRowFingerprint: h.c.sha256_(h.c.publicationJson_(before)) };
  assert.equal(h.c.recoverCorrectionCases_([item])[0].error, 'CORRECTION_RECOVERY_PRESERVED'); assert.deepEqual(h.row(), before);
  assert.equal(h.c.recoverCorrectionCases_([{ ...item, classification: 'A' }])[0].action, 'PRESERVED'); assert.deepEqual(h.row(), before);
});
test('somente marcador superseded não confirma correção: timestamp, delta, timeline e fingerprint obrigatórios', () => {
  for (const invalid of ['timestamp', 'delta', 'timeline', 'fingerprint']) {
    const h = supersededCase(), row = h.row(), audit = JSON.parse(row[h.c.meta.COL.AUDIT - 1]);
    if (invalid === 'timestamp') {
      audit.lastCorrectionSubmission.supersededBySupervisorAt = 'inválido'; audit.lastSupervisorCorrection.correctedAt = 'inválido';
      audit.timeline.filter(e => e.action === 'CORRIGIDA_PELO_SUPERVISOR').forEach(e => { e.at = 'inválido'; });
    }
    if (invalid === 'delta') audit.lastSupervisorCorrection.changes = [];
    if (invalid === 'timeline') audit.timeline = audit.timeline.filter(e => e.action !== 'CORRIGIDA_PELO_SUPERVISOR');
    if (invalid === 'fingerprint') row[h.c.meta.COL.PG_POST_INSTALLED - 1] = 'DIVERGENTE';
    row[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit);
    assert.equal(h.state().status, 'CORRECAO_SOLICITADA', invalid); assert.equal(core.correctedAfterResend(h.state().record), false);
  }
});
test('Supervisor pode corrigir novamente o estado preservado sem novo evento de reenvio da equipe', () => {
  const h = supersededCase(); h.c.requireSession_ = () => ({ role: 'supervisor', user: 'Supervisor FIXTURE' });
  const corrected = h.c.supervisorCorrectRecord_({ token: 'fixture', record: { ...h.state().record, observation: 'OBSERVAÇÃO DA SUPERVISÃO' } });
  assert.equal(corrected.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(h.state().record.observation, 'OBSERVAÇÃO DA SUPERVISÃO');
  assert.equal(h.state().record.pgPostInstalled, currentCase ? currentCase[h.c.meta.COL.PG_POST_INSTALLED - 1] : 'PG_SUPERVISOR_FIXTURE'); assert.equal(h.resends(), 0); assert.equal(core.correctedAfterResend(h.state().record), false);
});

let failures = 0;
for (const item of tests) { try { await item.run(); console.log('PASS ' + item.name); } catch (error) { failures++; console.error('FAIL ' + item.name + ': ' + error.stack); } }
const result = { total: tests.length, passed: tests.length - failures, failed: failures, productionWrites: 0, traces };
console.log(JSON.stringify(result));
if (process.env.DELTA_TEST_RESULT) await writeFile(process.env.DELTA_TEST_RESULT, JSON.stringify(result, null, 2));
if (failures) process.exitCode = 1;
