import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

// Actual HTML, application functions and bindEvents; in-memory DOM/storage only.
// No login, network, production records or browser credentials are used.
const root = new URL('../', import.meta.url);
const baselineHead = '5968b6eae8440c1efdfacf479770a9cc4a213889';
const sourceRef = process.argv.find(arg => arg.startsWith('--source-ref='))?.split('=')[1];
const read = name => sourceRef
  ? execFileSync('git', ['show', sourceRef + ':' + name], { cwd: root, encoding: 'utf8' })
  : readFile(new URL(name, root), 'utf8');
const [appSource, coreSource, html, css] = await Promise.all(['app.js', 'core.js', 'index.html', 'styles.css'].map(read));
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const plain = value => JSON.parse(JSON.stringify(value));
const TRAFO = 'SUBSTITUIÇÃO DE TRAFO', POSTE = 'SUBSTITUIÇÃO DE POSTE', CONDUTOR = 'SUBSTITUIÇÃO DE CONDUTOR';
const tests = [];
const test = (name, run) => tests.push({ name, run });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Small DOM fixture with attributes, ancestors, HTML replacement and bubbling.
// It does not implement layout or native camera/file-selection behavior.
class Control {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.parentNode = null;
    this.value = attrs.value || ''; this.checked = Object.hasOwn(attrs, 'checked');
    this.disabled = Object.hasOwn(attrs, 'disabled'); this.hidden = Object.hasOwn(attrs, 'hidden');
    this.listeners = new Map(); this.dataset = {}; this.textContent = ''; this.style = {}; this.clicked = 0;
    for (const [name, value] of Object.entries(attrs)) if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    this.className = attrs.class || '';
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const classes = new Set(this.className.split(/\s+/).filter(Boolean)); const show = force ?? !classes.has(name); if (show) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); return show; },
      add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false)
    };
  }
  get id() { return this.attrs.id || ''; }
  get options() { return this.querySelectorAll('option'); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  removeAttribute(name) { delete this.attrs[name]; }
  append(child) { child.parentNode = this; this.children.push(child); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  matches(selector) {
    if (selector.includes(':checked') && !this.checked) return false;
    const tag = selector.match(/^[a-z]+/i)?.[0]; if (tag && this.tagName !== tag.toUpperCase()) return false;
    const id = selector.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
    for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(match[1])) return false;
    for (const match of selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) if (!Object.hasOwn(this.attrs, match[1]) || (match[2] != null && this.attrs[match[1]] !== match[2])) return false;
    return true;
  }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+(?![^\[]*\])/); const found = [];
    const visit = node => { for (const child of node.children) { if (child.matches(parts.at(-1)) && (parts.length === 1 || child.parentNode?.closest(parts[0]))) found.push(child); visit(child); } };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler) { const handlers = this.listeners.get(type) || []; handlers.push(handler); this.listeners.set(type, handlers); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
  fire(type) {
    const pending = [];
    const event = { type, target: this, preventDefault() {}, stopPropagation() { this.stopped = true; } };
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const handler of node.listeners.get(type) || []) { const result = handler.call(node, event); if (result?.then) pending.push(result); }
      if (event.stopped) break;
    }
    return Promise.all(pending);
  }
  click() { this.clicked++; if (!this.disabled) return this.fire('click'); }
  scrollIntoView() {} focus() {} showModal() { this.open = true; } close() { this.open = false; }
  insertAdjacentHTML(position, source) { const holder = new Control(); holder.innerHTML = source; for (const child of holder.children) this.append(child); }
  get innerHTML() { return this._html || ''; }
  set innerHTML(source) {
    this._html = String(source); this.children = []; const stack = [this];
    for (const match of this._html.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)\b([^>]*?)>/gi)) {
      if (!match[1]) continue;
      const tag = match[1].toLowerCase();
      if (match[0].startsWith('</')) { const index = stack.findLastIndex(node => node.tagName === tag.toUpperCase()); if (index > 0) stack.length = index; continue; }
      const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)].map(attr => [attr[1], (attr[2] ?? attr[3] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')]));
      const child = new Control(tag, attrs); stack.at(-1).append(child);
      if (!['input', 'img', 'link', 'meta', 'br', 'hr', 'source'].includes(tag)) stack.push(child);
    }
  }
}

const fixture = (changes = {}) => ({
  recordId: '11111111-2222-4333-8444-555555555555', user: 'Equipe FIXTURE', status: core.RECORD_STATUS.DRAFT,
  base: 'CAICÓ', contract: '4600080938', team: 'LM FIXTURE', crewLeader: 'Chefe FIXTURE', occurrenceNumber: 'OCORRENCIA_FIXTURE',
  occurrenceTypes: [TRAFO], otherOccurrenceType: '', pgPostRemoved: 'PG-R', pgPostInstalled: 'PG-I', pgConductorStart: 'PG-A', pgConductorEnd: 'PG-B',
  transformer: { removedCode: '123456', removedCia: 'CIA-R', removedBto: 'BTO-R', newCode: '654321', newCia: 'CIA-I', newBto: 'BTO-I' },
  services: [{ lineId: 'historical-service', catalogKey: 'Emergência:FIXTURE', code: 'SERVICE', catalogText: 'Serviço fictício', unit: 'M', group: 'FIXTURE', origin: 'Emergência', contract: '4600080938', referenceValue: 20, quantity: 15.5, totalValue: 310 }],
  materials: [{ lineId: 'fixture-material', code: '000123', description: 'Material fictício', unit: 'M', quantity: 0.75, origin: 'Caderno de Obras' }],
  observation: 'Observação preservada', totalServices: 310, photos: Array(5).fill(''), transformerPhotos: { removed: '', installed: '' },
  photoStates: core.normalizePhotoStates([]), step: 1, ...changes
});
const withPhotos = record => ({ ...record, photoStates: record.photoStates.map(state => ({ ...state, confirmed: true, serverUrl: `https://example.test/${record.recordId}/${state.photoIndex}.jpg`, uploadKey: `original-${state.photoIndex}` })) });
const correction = index => {
  const record = withPhotos(fixture());
  return { ...record, correctionMode: true, serverConfirmed: true, registeredAt: '2026-10-01T10:00:00-03:00',
    status: core.RECORD_STATUS.CORRECTION_REQUESTED, serverStatus: core.RECORD_STATUS.CORRECTION_REQUESTED,
    correctionRequestedAt: '2026-10-10T10:00:00-03:00', correctionOriginalRequestedAt: '2026-10-10T10:00:00-03:00',
    correctionRequestId: '22222222-2222-4222-8222-222222222222', requestedPhotoIndexes: [index], correctionOriginal: core.correctionOriginalSnapshot(record),
    audit: { lastCorrectionRequest: { requestedAt: '2026-10-10T10:00:00-03:00', reason: 'Substituir evidência solicitada', supervisor: 'Supervisor FIXTURE', photoIndexes: [index] }, timeline: [{ action: 'CORRECAO_SOLICITADA', at: '2026-10-10T10:00:00-03:00' }] }
  };
};

function harness(storage = { records: new Map(), photos: new Map(), meta: new Map() }) {
  const document = new Control('document'); document.innerHTML = html;
  document.body = document.querySelector('body'); document.documentElement = document.querySelector('html');
  // Enter only the synthetic fixture UI; authentication itself is never invoked.
  document.querySelector('#appShell').hidden = false; document.querySelector('#loginView').hidden = true;
  const fileInputs = [], tasks = [], writes = [], messages = [], photoWrites = [], deletions = [], network = [], syncIds = [], revocations = [];
  document.createElement = tag => { const node = new Control(tag); if (tag === 'input') fileInputs.push(node); return node; };
  let writeGate = null, photoReadGate = null, objectId = 0, gridUpdates = 0;
  const c = vm.createContext({
    ...core, console, Blob, File, structuredClone, Date, JSON, Math, Map, Set, Number, String, document,
    navigator: { onLine: false }, window: { addEventListener() {}, scrollTo() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, crypto: { randomUUID },
    setTimeout: () => 0, clearTimeout() {}, clearInterval() {}, requestAnimationFrame: fn => fn(), CSS: { escape: value => value },
    URL: class extends URL { static createObjectURL() { return 'blob:fixture-' + (++objectId); } static revokeObjectURL(url) { revocations.push(url); } },
    ApiError: class extends Error { constructor(message, code) { super(message); this.code = code; } },
    api: new Proxy({}, { get: (_, name) => async (...args) => { network.push({ name, args }); throw Error('Unexpected network call: ' + name); } }),
    getRecord: async id => storage.records.has(id) ? structuredClone(storage.records.get(id)) : null,
    getAllRecords: async () => [...storage.records.values()].map(record => structuredClone(record)),
    putRecord: async record => { const snapshot = structuredClone(record); if (writeGate) { const gate = writeGate; writeGate = null; await gate.promise; } storage.records.set(record.recordId, snapshot); writes.push(snapshot); return snapshot; },
    setMeta: async (key, value) => storage.meta.set(key, value), getMeta: async key => storage.meta.get(key),
    clearMetaIfValue: async (key, value) => { if (storage.meta.get(key) === value) storage.meta.delete(key); },
    getPhoto: async (id, index) => storage.photos.get(id + ':' + index),
    getPhotosForRecord: async id => { if (photoReadGate) await photoReadGate.promise; return [...storage.photos.values()].filter(photo => photo.recordId === id); },
    putPhotoAndRecord: async (record, index, blob, uploadKey) => { const snapshot = structuredClone(record); storage.records.set(record.recordId, snapshot); const photo = { recordId: record.recordId, photoIndex: index, blob, uploadKey }; storage.photos.set(record.recordId + ':' + index, photo); photoWrites.push(photo); return { record: snapshot }; },
    deletePhoto: async (id, index, key) => { const slot = id + ':' + index; const photo = storage.photos.get(slot); if (!photo || photo.uploadKey !== key) return false; deletions.push(slot); return storage.photos.delete(slot); },
    __tasks: tasks, __messages: messages, __syncIds: syncIds, __countGrid: () => gridUpdates++
  });
  const stripped = appSource.replace(/^import [^]*?;\n/gm, '').replace(/\ninitialize\(\)\.catch[^]*$/, '');
  vm.runInContext(stripped + `
    this.hooks = { bindEvents, renderPhotoGrid, resetForm, loadRecordIntoForm, saveActiveDraft, resumeDraft, goToStep, updatePhotoGrid, submitOccurrence, selectCatalogItem,
      active:()=>activeRecord, photos:()=>activePhotos, previews:()=>previewUrls, step:()=>currentStep, pendingSave:()=>activeDraftSavePromise,
      setActive:record=>{activeRecord=record}, setSession:value=>{session=value;sessionRevision++},
      directory:items=>{teamDirectory=items;renderAssignmentControls();validateStepOne(false)} };
    toast=message=>__messages.push(message); confirmAction=async()=>true; optimizePhoto=async file=>file;
    loadDailyProduction=async()=>{}; navigate=view=>{currentView=view}; renderReview=()=>{};
    syncSingleRecord=async id=>{__syncIds.push(id);return {status:RECORD_STATUS.PENDING}};
    const originalAction=runLocalAction; runLocalAction=(...args)=>{const task=originalAction(...args);__tasks.push(task);return task};
    const originalGrid=updatePhotoGrid; updatePhotoGrid=(...args)=>{__countGrid();return originalGrid(...args)};
  `, c);
  c.hooks.setSession({ role: 'field', user: 'Equipe FIXTURE', token: 'fixture-only' });
  c.hooks.directory([{ base: 'CAICÓ', team: 'LM FIXTURE', crewLeader: 'Chefe FIXTURE' }]);
  c.hooks.bindEvents(); c.hooks.renderPhotoGrid();
  const $ = selector => document.querySelector(selector);
  const drain = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); await c.hooks.pendingSave(); };
  return {
    c, $, storage, fileInputs, writes, messages, photoWrites, deletions, network, syncIds, revocations, drain,
    gridUpdates: () => gridUpdates,
    async open(record) { await c.hooks.loadRecordIntoForm(plain(record)); await drain(); },
    fireType(value, checked) { const input = document.querySelectorAll('#occurrenceTypes input[type="checkbox"]').find(node => node.value === value); assert.ok(input, value); input.checked = checked; input.fire('change'); },
    async type(value, checked = true) { this.fireType(value, checked); await drain(); },
    async input(id, value, event = 'input') { $('#' + id).value = value; $('#' + id).fire(event); await drain(); },
    async click(selector) { const control = $(selector); assert.ok(control, selector); await control.click(); await drain(); },
    async choose(index, action, file = new File(['fixture-' + index], 'fixture-' + index + '.jpg', { type: 'image/jpeg' })) { await this.click(`[data-photo-${action}="${index}"]`); const input = fileInputs.at(-1); input.files = [file]; await input.fire('change'); await drain(); return input; },
    holdWrite() { writeGate = deferred(); return writeGate; }, holdPhotos() { photoReadGate = deferred(); return photoReadGate; }
  };
}

function assertTrafoVisible(h) {
  assert.equal(h.$('#transformerSection').hidden, false, 'transformerSection.hidden');
  for (const index of [6, 7]) {
    assert.equal(h.$(`[data-photo-card="${index}"]`).hidden, false, `photoCard${index}.hidden`);
    for (const action of ['take', 'attach']) {
      const button = h.$(`[data-photo-${action}="${index}"]`); assert.ok(button); assert.equal(button.disabled, false);
      for (let node = button; node && node.id !== 'transformerSection'; node = node.parentNode) assert.equal(node.hidden, false, `${action} ${index} ancestor hidden`);
    }
  }
}
const photoSnapshot = h => ({ states: plain(h.c.hooks.active().photoStates), blobs: [...h.storage.photos.values()].map(photo => [photo.recordId, photo.photoIndex, photo.blob, photo.uploadKey]), previews: [...h.c.hooks.previews()], local: [...h.c.hooks.photos()] });

test('regressão principal: render inicial sem ocorrência → change real de Trafo mostra seção, slots 6/7 e botões', async () => {
  const h = harness(); assert.equal(h.c.hooks.active(), null);
  for (const index of [6, 7]) assert.equal(h.$(`[data-photo-card="${index}"]`).hidden, true);
  await h.type(TRAFO); assertTrafoVisible(h); assert.equal(h.network.length, 0); assert.equal(h.photoWrites.length, 0);
});

test('desmarcar e remarcar Trafo atualiza todos os cartões na própria mudança', async () => {
  const h = harness(); await h.type(TRAFO); assertTrafoVisible(h);
  await h.type(TRAFO, false); assert.equal(h.$('#transformerSection').hidden, true);
  for (const index of [6, 7]) assert.equal(h.$(`[data-photo-card="${index}"]`).hidden, true);
  await h.type(TRAFO); assertTrafoVisible(h);
});
test('alternância rápida sem esperar entre eventos termina com Trafo e ambos os cartões visíveis', async () => {
  const h = harness(); h.fireType(TRAFO, true); h.fireType(TRAFO, false); h.fireType(TRAFO, true); await h.drain(); assertTrafoVisible(h);
});
test('atualização dos cartões antecede o término do autosave, sem rede', async () => {
  const h = harness(); await h.open(fixture({ occurrenceTypes: [] })); const gate = h.holdWrite(); h.fireType(TRAFO, true);
  await new Promise(setImmediate); assertTrafoVisible(h); assert.equal(h.network.length, 0); gate.resolve(); await h.drain();
});
test('digitar com Trafo selecionado não redesenha a grade nem faz upload', async () => {
  const h = harness(); await h.type(TRAFO); const updates = h.gridUpdates(), writes = h.writes.length;
  await h.input('observation', 'Uma tecla'); assert.equal(h.gridUpdates(), updates); assert.equal(h.writes.length - writes, 1); assert.equal(h.photoWrites.length, 0);
});
for (const [name, prepare] of [
  ['Sub-base preenchida', async h => h.input('operationBase', 'CAICÓ', 'change')],
  ['diretório carregado depois da abertura', async h => h.c.hooks.directory([{ base: 'CAICÓ', team: 'LM FIXTURE', crewLeader: 'Chefe FIXTURE' }])],
  ['serviço adicionado', async h => { await h.input('operationBase', 'CAICÓ', 'change'); await h.c.hooks.selectCatalogItem({ catalogKey: 'fixture:service', code: 'S-FIXTURE', catalogText: 'Serviço fictício', unit: 'M', contractValues: { '4600080938': 20, '4600080939': 30 } }); assert.equal(h.c.hooks.active().services.length, 1); }],
  ['navegar e voltar à etapa', async h => { await h.open(fixture({ occurrenceTypes: [] })); h.c.hooks.goToStep(2); h.$('[data-back-step="1"]').click(); }]
]) test('intermitência: seleção após ' + name, async () => { const h = harness(); await prepare(h); await h.type(TRAFO); assertTrafoVisible(h); });

const permutations = values => values.length < 2 ? [values] : values.flatMap((value, index) => permutations(values.filter((_, offset) => offset !== index)).map(rest => [value, ...rest]));
for (const types of [[TRAFO, POSTE], [TRAFO, CONDUTOR], [TRAFO, 'LINHA VIVA'], [TRAFO, 'OUTRO'], [TRAFO, POSTE, CONDUTOR]]) {
  for (const order of permutations(types)) test('tipos combinados, ordem: ' + order.join(' → '), async () => {
    const h = harness(); for (const type of order) { await h.type(type); if (h.c.hooks.active().occurrenceTypes.includes(TRAFO)) assertTrafoVisible(h); }
    await h.type(order.find(type => type !== TRAFO), false); assertTrafoVisible(h);
  });
}
for (const type of core.OCCURRENCE_TYPES.filter(value => value !== TRAFO)) test('sem Trafo: ' + type + ' mantém evidências específicas ocultas', async () => {
  const h = harness(); await h.type(type); assert.equal(h.$('#transformerSection').hidden, true);
  for (const index of [6, 7]) assert.equal(h.$(`[data-photo-card="${index}"]`).hidden, true);
});

for (const index of [6, 7]) {
  for (const action of ['take', 'attach', 'replace']) test(`botão real ${action} do slot ${index} preserva índice e configuração de arquivo/câmera`, async () => {
    const h = harness(); await h.open(withPhotos(fixture())); const before = plain(h.c.hooks.active().photoStates);
    const input = await h.choose(index, action); const saved = h.c.hooks.active();
    assert.equal(input.type, 'file'); assert.ok(input.accept.includes('image/heic')); assert.ok(input.accept.includes('image/heif'));
    assert.equal(input.getAttribute('capture'), action === 'take' ? 'environment' : null); assert.equal(input.clicked, 1);
    assert.equal(h.photoWrites.length, 1); assert.equal(h.photoWrites[0].recordId, saved.recordId); assert.equal(h.photoWrites[0].photoIndex, index);
    assert.equal(saved.photoStates[index - 1].localReady, true); assert.equal(saved.photoStates[index - 1].replacePending, true);
    for (const other of before.filter(state => state.photoIndex !== index)) assert.deepEqual(plain(saved.photoStates[other.photoIndex - 1]), other);
    assert.equal(h.network.length, 0);
  });
  test(`Excluir slot ${index} bloqueia evidência confirmada e preserva fotos 1–5 e o outro Trafo`, async () => {
    const h = harness(); await h.open(withPhotos(fixture())); const before = photoSnapshot(h);
    await h.click(`[data-photo-delete="${index}"]`); assert.deepEqual(photoSnapshot(h), before); assert.equal(h.deletions.length, 0);
    assert.ok(h.messages.at(-1).includes('não removida isoladamente'));
  });
  test(`Excluir substituição local do slot ${index} preserva URL anterior e demais slots`, async () => {
    const h = harness(); await h.open(withPhotos(fixture())); await h.choose(index, 'replace');
    const before = plain(h.c.hooks.active().photoStates); await h.click(`[data-photo-delete="${index}"]`);
    const after = h.c.hooks.active().photoStates; assert.equal(after[index - 1].serverUrl, before[index - 1].serverUrl); assert.equal(after[index - 1].confirmed, true); assert.equal(after[index - 1].localReady, false);
    assert.deepEqual(h.deletions, [h.c.hooks.active().recordId + ':' + index]);
    for (const other of before.filter(state => state.photoIndex !== index)) assert.deepEqual(plain(after[other.photoIndex - 1]), other);
  });
}

test('sete blobs mantêm UUID, slot, identidade, preview e uploadKey ao desmarcar/remarcar, sem upload', async () => {
  const h = harness(); const record = fixture();
  for (let index = 1; index <= 7; index++) h.storage.photos.set(record.recordId + ':' + index, { recordId: record.recordId, photoIndex: index, blob: new Blob(['slot-' + index]), uploadKey: 'local-' + index });
  await h.open(record); const before = photoSnapshot(h);
  await h.type(TRAFO, false); assert.deepEqual(photoSnapshot(h), before); await h.type(TRAFO); assertTrafoVisible(h); assert.deepEqual(photoSnapshot(h), before);
  assert.equal(h.photoWrites.length, 0); assert.equal(h.deletions.length, 0); assert.equal(h.network.length, 0); assert.equal(h.revocations.length, 0);
});
test('troca acidental conserva Série/CIA/BTO nos controles e recupera dados ao remarcar, conforme fluxo atual', async () => {
  const h = harness(); const record = fixture(); await h.open(record); await h.type(TRAFO, false);
  assert.equal(h.$('#removedTransformerCode').value, record.transformer.removedCode); assert.equal(h.$('#newTransformerCode').value, record.transformer.newCode);
  await h.type(TRAFO); assert.deepEqual(plain(h.c.hooks.active().transformer), record.transformer);
});
test('rascunho salvo → reset → resumeDraft mantém mesmo UUID, campos e sete blobs', async () => {
  const h = harness(); const record = fixture();
  for (let index = 1; index <= 7; index++) h.storage.photos.set(record.recordId + ':' + index, { recordId: record.recordId, photoIndex: index, blob: new Blob(['draft-' + index]), uploadKey: 'draft-' + index });
  await h.open(record); await h.c.hooks.saveActiveDraft(); h.c.hooks.resetForm();
  await h.click('#resumeDraftButton'); assertTrafoVisible(h); assert.equal(h.c.hooks.active().recordId, record.recordId);
  assert.deepEqual(plain(h.c.hooks.active().transformer), record.transformer); assert.equal(h.c.hooks.photos().size, 7); assert.equal(h.storage.photos.size, 7);
});
test('reload simulado com armazenamento compartilhado reidrata Trafo e os mesmos sete slots', async () => {
  const h = harness(); const record = fixture();
  for (let index = 1; index <= 7; index++) h.storage.photos.set(record.recordId + ':' + index, { recordId: record.recordId, photoIndex: index, blob: new Blob(['reload-' + index]), uploadKey: 'reload-' + index });
  await h.open(record); await h.c.hooks.saveActiveDraft(); const reloaded = harness(h.storage); await reloaded.click('#resumeDraftButton');
  assertTrafoVisible(reloaded); assert.equal(reloaded.c.hooks.active().recordId, record.recordId); assert.equal(reloaded.c.hooks.photos().size, 7);
  for (const [slot, photo] of h.storage.photos) assert.equal(reloaded.storage.photos.get(slot).blob, photo.blob);
});
test('reidratação mostra cartões antes do carregamento assíncrono dos blobs', async () => {
  const h = harness(); const gate = h.holdPhotos(); const loading = h.c.hooks.loadRecordIntoForm(fixture());
  await new Promise(setImmediate); assertTrafoVisible(h); gate.resolve(); await loading; assertTrafoVisible(h);
});
test('UUID diferente não herda blobs nem previews dos slots da ocorrência anterior', async () => {
  const h = harness(); await h.open(fixture()); await h.choose(6, 'attach'); const firstId = h.c.hooks.active().recordId;
  await h.open(fixture({ recordId: '33333333-3333-4333-8333-333333333333' })); assertTrafoVisible(h);
  assert.equal(h.c.hooks.photos().size, 0); assert.equal(h.c.hooks.previews().size, 0); assert.ok(h.storage.photos.has(firstId + ':6'));
  assert.equal(Boolean(h.c.hooks.active().photoStates[5].localReady), false);
});

for (const index of [6, 7]) test(`Correção Solicitada: substituir somente ${index}, navegar e enfileirar evidencePatch sem falso CORRIGIDO`, async () => {
  const h = harness(), record = correction(index); await h.open(record); assertTrafoVisible(h);
  assert.equal(h.$('#fieldCorrectionBanner').hidden, false); assert.equal(h.$('#fieldCorrectionObservation').textContent, 'Substituir evidência solicitada');
  assert.equal(h.$('#removedTransformerCia').value, record.transformer.removedCia); assert.equal(h.$('#newTransformerBto').value, record.transformer.newBto);
  const before = plain(h.c.hooks.active()); await h.choose(index, 'replace');
  const active = h.c.hooks.active(); const delta = core.correctionDelta(active.correctionOriginal, active);
  assert.deepEqual(delta.expectedPatch, {}); assert.deepEqual(delta.beforePatch, {}); assert.deepEqual(delta.photoPatch, {});
  assert.deepEqual(delta.evidencePatch, { [index]: { uploadKey: active.photoStates[index - 1].uploadKey } });
  for (const field of ['recordId', 'services', 'materials', 'observation', 'transformer', 'correctionRequestId', 'correctionOriginal', 'audit']) assert.deepEqual(plain(active[field]), plain(before[field]), field);
  for (const slot of before.photoStates.filter(state => state.photoIndex !== index)) assert.deepEqual(plain(active.photoStates[slot.photoIndex - 1]), slot);
  await h.click('#continueToPhotosButton'); assert.equal(h.c.hooks.step(), 2); await h.click('[data-back-step="1"]'); assertTrafoVisible(h);
  await h.click('#continueToPhotosButton'); await h.click('#continueToReviewButton'); assert.equal(h.c.hooks.step(), 3);
  await h.c.hooks.submitOccurrence(); const queued = h.writes.findLast(write => write.status === core.RECORD_STATUS.PENDING);
  assert.ok(queued); assert.equal(queued.recordId, record.recordId); assert.deepEqual(queued.expectedPatch, {}); assert.deepEqual(queued.beforePatch, {});
  assert.deepEqual(Object.keys(queued.evidencePatch), [String(index)]); assert.deepEqual(queued.services, record.services); assert.deepEqual(queued.materials, record.materials);
  assert.equal(core.correctedAfterResend(queued), false); assert.equal(queued.serverStatus, core.RECORD_STATUS.CORRECTION_REQUESTED);
  assert.equal(h.network.length, 0); assert.equal(h.photoWrites.length, 1);
});
test('Correção Solicitada: somente atualizar visibilidade não gera delta, envio ou evento de reenvio', async () => {
  const h = harness(), record = correction(7); await h.open(record); const before = plain(h.c.hooks.active());
  h.c.hooks.updatePhotoGrid(); assertTrafoVisible(h); await h.c.hooks.submitOccurrence();
  assert.equal(h.writes.some(write => write.status === core.RECORD_STATUS.PENDING), false); assert.equal(h.syncIds.length, 0);
  assert.ok(h.messages.at(-1).includes('Nenhuma alteração')); assert.deepEqual(plain(h.c.hooks.active().audit), before.audit);
});
test('Correção Solicitada reaberta mantém cartões visíveis, substituição pendente do slot 7 e original independente', async () => {
  const h = harness(), record = correction(7); await h.open(record); await h.choose(7, 'replace');
  const before = plain(h.c.hooks.active()); await h.c.hooks.saveActiveDraft(); h.c.hooks.resetForm(); await h.click('#resumeDraftButton');
  assertTrafoVisible(h); const active = h.c.hooks.active();
  assert.equal(active.recordId, record.recordId); assert.deepEqual(plain(active.correctionOriginal), before.correctionOriginal);
  assert.equal(active.photoStates[6].uploadKey, before.photoStates[6].uploadKey); assert.equal(active.photoStates[6].localReady, true);
  for (const index of [1, 2, 3, 4, 5, 6]) assert.deepEqual(plain(active.photoStates[index - 1]), before.photoStates[index - 1]);
  const delta = core.correctionDelta(active.correctionOriginal, active); assert.deepEqual(delta.expectedPatch, {}); assert.deepEqual(Object.keys(delta.evidencePatch), ['7']);
  assert.equal(core.correctedAfterResend(active), false); assert.equal(h.network.length, 0);
});
test('Correção Solicitada sem Trafo preserva seção de dados disponível e evidências específicas ocultas', async () => {
  const h = harness(), record = correction(7); record.occurrenceTypes = [POSTE]; record.requestedPhotoIndexes = [];
  await h.open(record); assert.equal(h.$('#transformerSection').hidden, false);
  for (const index of [6, 7]) assert.equal(h.$(`[data-photo-card="${index}"]`).hidden, true);
});
test('validação por etapas: zero fotos não bloqueia continuar; final exige 3 gerais e evidências 6/7', async () => {
  const h = harness(); await h.open(fixture()); await h.click('#continueToPhotosButton'); assert.equal(h.c.hooks.step(), 2);
  assert.deepEqual(core.validateOccurrence(h.c.hooks.active(), { validationStage: 'final' }), ['Adicione pelo menos 3 fotos da ocorrência.', 'Adicione a evidência do transformador retirado.', 'Adicione a evidência do transformador instalado.']);
  for (const index of [1, 2, 3, 6, 7]) await h.choose(index, 'attach');
  assert.deepEqual(core.validateOccurrence(h.c.hooks.active(), { validationStage: 'final' }), []); await h.click('#continueToReviewButton'); assert.equal(h.c.hooks.step(), 3);
});
test('HTML/CSS: slots 6/7 continuam incorporados à etapa de dados, botões presentes e regras responsivas preservadas', () => {
  const h = harness();
  for (const index of [6, 7]) { const card = h.$(`[data-photo-card="${index}"]`); assert.equal(card.closest('#transformerSection').id, 'transformerSection'); assert.equal(card.closest('[data-step-panel]').dataset.stepPanel, '1'); }
  assert.equal(h.$('#photoGrid').querySelectorAll('[data-photo-card]').length, 5);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/); assert.match(css, /@media \(max-width: 360px\)[^]*?\.photo-card__actions \{ grid-template-columns: 1fr; \}/);
});
test('isolamento: única mudança funcional em app.js é sincronizar a grade na mudança da presença de Trafo', () => {
  const extensionHead = process.argv.find(arg => arg.startsWith('--extension-baseline='))?.split('=')[1];
  if (extensionHead) {
    const baseline = execFileSync('git', ['show', extensionHead + ':app.js'], { cwd: root, encoding: 'utf8' });
    const extract = (source, name) => source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'))?.[0];
    for (const name of ['storeSelectedPhoto', 'removePhoto', 'updatePhotoGrid', 'syncFormToRecord', 'submitOccurrence', 'performSyncSingleRecord', 'loadRecordIntoForm']) {
      assert.ok(extract(appSource, name), name); assert.equal(extract(appSource, name), extract(baseline, name), name);
    }
    return;
  }
  const baseline = execFileSync('git', ['show', baselineHead + ':app.js'], { cwd: root, encoding: 'utf8' });
  const clean = source => source.replace(/\d{4}\.\d{2}\.\d{2}\.\d+/g, 'RELEASE')
    .replace('  const previousHasTransformer = activeRecord.occurrenceTypes.includes(TYPE_TRAFO);\n', '')
    .replace('  if (activeRecord.occurrenceTypes.includes(TYPE_TRAFO) !== previousHasTransformer) updatePhotoGrid();\n', '');
  assert.equal(clean(appSource), clean(baseline));
});

const selected = process.argv.includes('--regression-only') ? tests.slice(0, 1) : tests;
const results = [];
for (const { name, run } of selected) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); }
}
console.log(JSON.stringify({ suite: 'trafo-photo-visibility', sourceRef: sourceRef || 'working-tree', passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, physicalDevices: 'NÃO VALIDADO FISICAMENTE', productionQa: false, results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
