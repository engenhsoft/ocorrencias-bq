import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as core from '../core.js';
import * as queue from '../sync-queue.js';

const { IDBFactory, IDBKeyRange } = createRequire(import.meta.url)('fake-indexeddb');
const [appSource, apiSource, dbSource] = await Promise.all(['app.js', 'api.js', 'db.js'].map(name => readFile(new URL(`../${name}`, import.meta.url), 'utf8')));
const sourceBody = source => source.replace(/^import[^;]*;\n/gm, '').replace(/^export (?:\{ DB_NAME \};|)/gm, '');
const extract = name => {
  const found = appSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(found, name);
  return found[0];
};
const UUID = '11111111-2222-4333-8444-555555555555';
const slots = [1, 2, 3];
const key = index => `11111111-2222-4333-8444-${String(index).padStart(12, '0')}`;
const user = 'Pessoa de Campo Fictícia';
const clone = structuredClone;
const { PENDING, SYNCING_PHOTOS, WAITING_SUPERVISOR, ERROR } = core.RECORD_STATUS;
const test = (name, run) => tests.push({ name, run });
const tests = [];

function fixture() {
  const services = [
    { code: 'S01', quantity: 3, referenceValue: 350.05, totalValue: 1050.15 },
    { code: 'S02', quantity: 2.5, referenceValue: 20.2, totalValue: 50.5 },
    { code: 'S03', quantity: 2, referenceValue: 15.3, totalValue: 30.6 }
  ].map((item, index) => ({ ...item, lineId: `service-${index}`, catalogKey: `Emergência:${index + 3}`, catalogText: `Serviço fictício ${index}`, contract: '4600080938', group: 'Teste', origin: 'Emergência', unit: 'UN' }));
  return {
    recordId: UUID, user, base: 'CAICÓ', contract: '4600080938', team: 'EQUIPE TESTE', crewLeader: 'Pessoa Fictícia',
    occurrenceNumber: '781', occurrenceTypes: ['LINHA VIVA', 'PODA'], formVersion: 1, observation: '', services,
    materials: [{ lineId: 'material-1', code: '0012', description: 'Material de teste', unit: 'UN', quantity: 3 }, { lineId: 'material-2', code: '0008', description: 'Outro material', unit: 'M', quantity: 2.5 }],
    totalServices: 1131.25
  };
}

function mockServer(initial) {
  const rows = new Map(initial ? [[UUID, clone(initial)]] : []);
  const files = new Map(), actions = [], uploads = [];
  const server = { rows, files, actions, uploads, writeCount: 0, intercept: async () => {} };
  const failure = (error, message) => ({ ok: false, error, message });
  const snapshot = (recordId) => {
    const row = rows.get(recordId);
    if (!row) return failure('RECORD_NOT_FOUND', 'Ocorrência não encontrada.');
    const photoStates = Array.from({ length: 7 }, (_, offset) => {
      const photoIndex = offset + 1, stored = files.get(`${recordId}:${photoIndex}`);
      return { photoIndex, confirmed: Boolean(stored), uploadKey: stored?.uploadKey || '', url: stored?.url || '' };
    });
    const status = row.audit.expectedPhotoIndexes.every(index => photoStates[index - 1]?.confirmed) ? WAITING_SUPERVISOR : SYNCING_PHOTOS;
    return { ok: true, recordId, status, record: clone({ ...row, status }), photoStates };
  };
  server.state = snapshot;
  server.handle = (payload) => {
    const recordId = payload.recordId || payload.record?.recordId;
    actions.push(payload.action);
    assert.equal(recordId, UUID);
    if (payload.action === 'submitRecord') {
      assert.equal(rows.has(recordId), false, 'a linha gravada não pode ser reenviada');
      assert.deepEqual(payload.record.expectedPhotoIndexes, slots);
      assert.deepEqual(payload.record.services.map(service => service.quantity), fixture().services.map(service => service.quantity));
      server.writeCount += 1;
      rows.set(recordId, { ...fixture(), audit: { expectedPhotoIndexes: payload.record.expectedPhotoIndexes } });
    }
    if (payload.action === 'uploadPhoto') {
      const { photoIndex, uploadKey, replace } = payload;
      assert.equal(replace, false);
      assert.ok(rows.get(recordId)?.audit.expectedPhotoIndexes.includes(photoIndex));
      const slotKey = `${recordId}:${photoIndex}`;
      const previous = files.get(slotKey);
      if (previous && previous.uploadKey !== uploadKey) return failure('PHOTO_CONFIRMATION_PENDING', 'O slot já possui outra foto.');
      uploads.push({ recordId, photoIndex, uploadKey });
      files.set(slotKey, { uploadKey, url: `https://fixture.invalid/photo/${photoIndex}` });
    }
    return snapshot(recordId);
  };
  return server;
}

function appRuntime(server, indexedDB = new IDBFactory()) {
  const logs = [], timers = new Map();
  const c = vm.createContext({ ...core, ...queue, URL, AbortController, Date, structuredClone, indexedDB, IDBKeyRange,
    navigator: { onLine: true }, session: { token: 'token-ficticio', user, role: 'field' }, sessionRevision: 1,
    recordSyncPromises: new Map(), syncRunning: false, dailyProduction: { totalExcludingRecord: 0 }, TYPE_TRAFO: 'SUBSTITUIÇÃO DE TRAFO',
    SYNCABLE_STATUSES: new Set([PENDING, SYNCING_PHOTOS, ERROR]), LAST_SYNC_META: 'lastSyncAt',
    elements: { syncNowButton: {}, syncQueueList: {}, mineDetailTitle: {}, mineDetailContent: {}, mineDetailDialog: {} },
    currentView: 'sync', mineRecords: [], photoSyncAllRunning: false, refreshMine() {}, logout() {}, toast() {}, setBusy() {}, updateQueueUi: async () => {},
    cacheDailySummary: async () => {}, friendlyError: error => error.message, openScrollableDialog() {},
    occurrenceTypesText: () => 'TIPOS', correctionRequestMarkup: () => '', emptyState: () => '',
    console: { error: (_message, data) => logs.push(data), warn() {} },
    setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (_url, request) => {
      const payload = JSON.parse(request.body);
      const result = server.handle(payload);
      const timeout = () => {
        const timer = [...timers.values()].find(value => value.delay === 35000);
        assert.ok(timer);
        queueMicrotask(timer.callback);
        return new Promise(() => {});
      };
      await server.intercept(payload, result, timeout);
      return { ok: true, status: 200, text: async () => JSON.stringify(result) };
    }
  });
  vm.runInContext(`const API_ENDPOINT = 'https://script.google.com/macros/s/fixture/exec';\n${sourceBody(apiSource)}\n${sourceBody(dbSource)}`, c);
  vm.runInContext(['performSyncSingleRecord', 'syncSingleRecord', 'syncAll', 'recordCard', 'renderSyncQueue', 'reviewDataCommitConflict'].map(extract).join('\n'), c);
  vm.runInContext("this.blobToDataUrl = async blob => 'data:image/jpeg;base64,' + (await blob.text());", c);
  return { c, indexedDB, logs, photos: () => c.getPhotosForRecord(UUID), saved: () => c.getRecord(UUID), run: () => c.syncSingleRecord(UUID, false) };
}

async function seed(app, local = fixture()) {
  let record = await app.c.putRecord({ ...local, status: PENDING, photoStates: core.normalizePhotoStates(slots.map(photoIndex => ({ photoIndex, localReady: true, uploadKey: key(photoIndex) }))) });
  for (const index of slots) {
    const saved = await app.c.putPhotoAndRecord(record, index, new Blob([`fixture-${index}`], { type: 'image/jpeg' }), key(index));
    record = saved.record;
  }
  return record;
}
const persisted = (record = fixture()) => ({ ...record, audit: { expectedPhotoIndexes: slots } });
const fields = (local, remote) => core.dataCommitDifferences(local, remote).map(change => change.field);
async function assertComplete(app, server, uploads = slots) {
  assert.equal((await app.saved()).recordId, UUID);
  assert.equal((await app.saved()).status, WAITING_SUPERVISOR);
  assert.equal((await app.saved()).syncPhase, 'confirmed');
  assert.equal((await app.photos()).length, 0);
  assert.equal(server.rows.size, 1);
  const state = server.state(UUID);
  assert.equal(state.status, WAITING_SUPERVISOR);
  assert.equal(state.record.totalServices, fixture().totalServices);
  assert.deepEqual(fields(fixture(), state.record), []);
  assert.deepEqual(state.photoStates.filter(photo => photo.confirmed).map(photo => [photo.photoIndex, photo.uploadKey]), slots.map(index => [index, key(index)]));
  assert.deepEqual(server.uploads, uploads.map(photoIndex => ({ recordId: UUID, photoIndex, uploadKey: key(photoIndex) })));
  assert.equal(server.files.size, 3);
  assert.equal(server.actions.at(-1), 'getRecordState');
}

test('novo registro persiste uma vez e confirma as três fotos somente após releitura', async () => {
  const server = mockServer(), app = appRuntime(server);
  await seed(app);
  server.intercept = async (payload, result) => {
    if (payload.action === 'getRecordState' && result.status === WAITING_SUPERVISOR) assert.equal((await app.saved()).status, SYNCING_PHOTOS);
  };
  await app.run();
  assert.equal(server.writeCount, 1);
  await assertComplete(app, server);
});

test('snapshot equivalente já gravado retoma as três fotos sem POST de dados mesmo sem marcador local', async () => {
  const remote = persisted(), server = mockServer(remote), app = appRuntime(server);
  const local = fixture();
  local.formVersion = undefined;
  local.contract = 4600080938;
  local.occurrenceNumber = 781;
  local.occurrenceTypes.reverse();
  local.observation = null;
  local.services.reverse();
  local.services[1].quantity = '2,500';
  local.services[1].referenceValue = 'R$ 20,20';
  local.services[1].totalValue = '50,50';
  local.materials.reverse();
  local.materials[0] = { codigo: '0008', descricao: '[MATERIAL:0008] Outro material [UNIDADE:M]', quantidade: '2,50' };
  local.totalServices = 'R$ 1.131,25';
  assert.notDeepEqual(core.correctionDataSnapshot(local), core.correctionDataSnapshot(remote));
  await seed(app, local);
  server.intercept = async (payload) => {
    if (payload.action !== 'uploadPhoto' || payload.photoIndex !== 1) return;
    const saved = await app.saved();
    assert.equal(core.synchronizationFeedback(saved).label, 'DADOS CONFIRMADOS — 3 FOTOS PENDENTES');
    app.c.renderSyncQueue({ pendingRecords: [saved], records: [saved], photos: await app.photos() });
    assert.match(app.c.elements.syncQueueList.innerHTML, /Foto 1/);
    assert.equal((await app.photos()).length, 3);
  };
  await app.run();
  assert.equal(server.writeCount, 0);
  assert.deepEqual(server.rows.get(UUID), remote);
  await assertComplete(app, server);
});

test('timeout após a gravação recupera a resposta pela releitura sem reenvio', async () => {
  const server = mockServer(), app = appRuntime(server);
  await seed(app);
  server.intercept = (payload, _result, timeout) => payload.action === 'submitRecord' ? timeout() : undefined;
  await app.run();
  assert.equal(server.writeCount, 1);
  assert.deepEqual(server.actions.slice(0, 3), ['getRecordState', 'submitRecord', 'getRecordState']);
  await assertComplete(app, server);
});

test('resposta perdida e releitura indisponível deixam a fila e os blobs recuperáveis após reabrir offline', async () => {
  const server = mockServer(), first = appRuntime(server);
  await seed(first);
  server.intercept = (payload, result) => {
    if (payload.action === 'submitRecord' || result.ok) throw new TypeError('Resposta perdida');
  };
  await first.run();
  assert.equal((await first.saved()).status, ERROR);
  assert.equal((await first.photos()).length, 3);
  assert.equal(server.files.size, 0);
  const reopened = appRuntime(server, first.indexedDB);
  reopened.c.navigator.onLine = false;
  const networkCalls = server.actions.length;
  await reopened.run();
  assert.equal(server.actions.length, networkCalls);
  assert.equal((await reopened.photos()).length, 3);
  server.intercept = async () => {};
  reopened.c.navigator.onLine = true;
  await reopened.c.syncAll(false);
  assert.equal(server.writeCount, 1);
  await assertComplete(reopened, server);
});

for (const [name, alter, expected] of [
  ['quantidade de serviço', record => { record.services[1].quantity = 2.75; }, 'services[2].quantity'],
  ['preço unitário', record => { record.services[0].referenceValue += 0.01; }, 'services[1].referenceValue'],
  ['valor subcentavo', record => { record.services[0].referenceValue = 350.051; }, 'services[1].referenceValue'],
  ['observação', record => { record.observation = '<observação privada>'; }, 'observation'],
  ['código do material com zeros', record => { record.materials[0].code = '12'; }, 'materials[1].code'],
  ['número com zeros à esquerda', record => { record.occurrenceNumber = '0781'; }, 'occurrenceNumber'],
  ['valor do serviço ausente', record => { delete record.services[0].totalValue; }, 'services[1].totalValue']
]) test(`diferença em ${name} preserva ambos os snapshots e bloqueia todos os uploads`, async () => {
  const remote = persisted(), server = mockServer(remote), app = appRuntime(server), local = fixture();
  alter(local);
  await seed(app, local);
  await app.run();
  const saved = await app.saved();
  assert.equal(saved.lastSyncError.code, 'DATA_COMMIT_CONFLICT');
  assert.deepEqual(saved.lastSyncError.fields, [expected]);
  assert.deepEqual(saved.services, local.services);
  assert.deepEqual(saved.materials, local.materials);
  assert.equal(saved.observation, local.observation);
  assert.equal((await app.photos()).length, 3);
  assert.deepEqual(server.actions, ['getRecordState']);
  assert.deepEqual(server.rows.get(UUID), remote);
  assert.doesNotMatch(JSON.stringify(app.logs), /observação privada|token-ficticio|data:image/);
  assert.match(app.c.recordCard(saved), /DIVERGÊNCIA ENTRE RASCUNHO E SERVIDOR.*Revisar divergência/);
  if (expected === 'observation') {
    await app.c.reviewDataCommitConflict(UUID);
    assert.match(app.c.elements.mineDetailContent.innerHTML, /Observação.*&lt;observação privada&gt;.*Servidor · Em branco/);
    assert.doesNotMatch(app.c.elements.mineDetailContent.innerHTML, /<observação privada>/);
  }
});

test('ordem de itens é irrelevante, mas multiplicidade, PG, BTO e versão de CHAVES permanecem protegidos', () => {
  const local = fixture(), remote = fixture();
  local.services.push(clone(local.services[0]));
  assert.ok(fields(local, remote).includes('services.length'));
  local.services.pop();
  local.occurrenceTypes.push('CHAVES'); remote.occurrenceTypes.push('CHAVES');
  local.formVersion = 0;
  local.pgKeyRemoved = '001'; remote.pgKeyRemoved = 1;
  local.btoKeyInstalled = 'BTO-1'; remote.btoKeyInstalled = 'BTO-2';
  assert.deepEqual(fields(local, remote).sort(), ['btoKeyInstalled', 'formVersion', 'pgKeyRemoved']);
});

test('payload parcial sem materiais não é convertido em confirmação', async () => {
  const remote = persisted(); delete remote.materials;
  const server = mockServer(remote), app = appRuntime(server);
  await seed(app); await app.run();
  assert.deepEqual((await app.saved()).lastSyncError.fields, ['materials']);
  assert.equal(server.files.size, 0);
  assert.equal((await app.photos()).length, 3);
});

test('plano parcial de slots preserva as fotos e não tenta reescrever os dados', async () => {
  const remote = persisted(); remote.audit.expectedPhotoIndexes = [1, 2];
  const server = mockServer(remote), app = appRuntime(server);
  await seed(app); await app.run();
  assert.equal((await app.saved()).lastSyncError.code, 'PHOTO_PLAN_UNCONFIRMED');
  assert.deepEqual(server.actions, ['getRecordState']);
  assert.equal((await app.photos()).length, 3);
});

test('fotos confirmadas com outra chave preservam o arquivo local', async () => {
  const server = mockServer(persisted()), app = appRuntime(server);
  server.files.set(`${UUID}:1`, { uploadKey: 'chave-diferente', url: 'https://fixture.invalid/outra' });
  await seed(app); await app.run();
  assert.equal((await app.saved()).lastSyncError.code, 'PHOTO_CONFIRMATION_PENDING');
  assert.equal((await app.photos()).length, 3);
  assert.equal(server.files.size, 1);
});

test('resposta do último upload não conclui a fila se a releitura final falhar', async () => {
  const server = mockServer(persisted()), app = appRuntime(server);
  await seed(app);
  server.intercept = (payload, result) => {
    if (payload.action === 'getRecordState' && result.status === WAITING_SUPERVISOR) throw new TypeError('Sem resposta');
  };
  await app.run();
  assert.equal((await app.saved()).status, ERROR);
  assert.equal(server.files.size, 3);
  assert.equal((await app.photos()).length, 0);
  server.intercept = async () => {};
  await app.run();
  assert.equal(server.writeCount, 0);
  await assertComplete(app, server);
});

test('404 depois de dados confirmados nunca autoriza recriação', async () => {
  const server = mockServer(), app = appRuntime(server);
  await seed(app, { ...fixture(), serverConfirmed: true });
  await app.run();
  assert.equal((await app.saved()).lastSyncError.code, 'DATA_COMMIT_UNCONFIRMED');
  assert.deepEqual(server.actions, ['getRecordState']);
  assert.equal((await app.photos()).length, 3);
});

test('identidade legada bloqueia uploads; reconciliação autorizada do mesmo UUID retoma somente fotos', async () => {
  const remote = persisted(); remote.user = 'Pessoa de Campo Fict?cia';
  const server = mockServer(remote), app = appRuntime(server);
  await seed(app); await app.run();
  assert.equal((await app.saved()).lastSyncError.code, 'INVALID_RECORD_STATE');
  assert.equal((await app.photos()).length, 3);
  assert.equal(server.files.size, 0);
  assert.equal(server.writeCount, 0);
  // The mock represents the owner's separately authenticated, UUID-scoped repair.
  // The client cannot perform this repair or accept a wildcard identity.
  server.rows.get(UUID).user = user;
  server.rows.get(UUID).audit.identityReconciliation = { authorized: true, previousUser: remote.user };
  await app.run();
  assert.equal(server.writeCount, 0);
  await assertComplete(app, server);
});

test('sessão de outro usuário não lê nem envia o rascunho local e preserva os blobs', async () => {
  const server = mockServer(persisted()), app = appRuntime(server);
  await seed(app); app.c.session.user = 'Outra pessoa';
  assert.equal(await app.run(), null);
  assert.deepEqual(server.actions, []);
  assert.equal((await app.photos()).length, 3);
  assert.equal(server.files.size, 0);
});

test('execuções simultâneas do mesmo UUID reaproveitam o trabalho e não duplicam arquivos', async () => {
  const server = mockServer(), app = appRuntime(server);
  await seed(app);
  const results = await Promise.all([app.run(), app.run()]);
  assert.equal(results[0].status, WAITING_SUPERVISOR);
  assert.equal(results[1].status, WAITING_SUPERVISOR);
  assert.equal(server.writeCount, 1);
  await assertComplete(app, server);
});

test('duas abas compartilham o bloqueio do UUID e não repetem a gravação nem os uploads', async () => {
  const server = mockServer(), first = appRuntime(server), second = appRuntime(server, first.indexedDB);
  await seed(first);
  let lock = Promise.resolve();
  const locks = { request(name, options, work) {
    if (name === 'ocorrencias-bq-release') { assert.equal(options.mode, 'shared'); return work(); }
    assert.equal(name, `ocorrencias-bq-sync:${UUID}`);
    const operation = lock.then(options);
    lock = operation.catch(() => {});
    return operation;
  } };
  first.c.navigator.locks = locks;
  second.c.navigator.locks = locks;
  const results = await Promise.all([first.run(), second.run()]);
  assert.ok(results.every(result => result.status === WAITING_SUPERVISOR));
  assert.equal(server.writeCount, 1);
  await assertComplete(second, server);
});

test('o rascunho mais recente permanece quando outra aba edita durante a releitura', async () => {
  const server = mockServer(persisted()), app = appRuntime(server);
  await seed(app);
  server.intercept = async payload => {
    if (payload.action === 'getRecordState') await app.c.putRecord({ ...await app.saved(), observation: 'Edição mais recente' });
  };
  await app.run();
  assert.equal((await app.saved()).observation, 'Edição mais recente');
  assert.equal((await app.photos()).length, 3);
  assert.deepEqual(server.actions, ['getRecordState']);
});

const failures = [];
for (const { name, run } of tests) {
  try { await run(); }
  catch (error) { failures.push({ name, error: error.stack }); }
}
console.log(JSON.stringify({ total: tests.length, passed: tests.length - failures.length, failed: failures.length, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
