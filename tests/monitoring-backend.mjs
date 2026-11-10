import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixtureFactory, id, mountPrivateMonitor } from './chaves-fixtures.mjs';

const make = await fixtureFactory(await readFile(process.argv[2], 'utf8'));

function fixture(options) {
  const h = make(), { c } = h;
  h.grant();
  h.grant('Fiscal B', ['MOSSORÓ']);
  const cache = new Map();
  c.CacheService = { getScriptCache: () => ({
    get: key => cache.get(key) || null,
    getAll: keys => Object.fromEntries(keys.filter(key => cache.has(key)).map(key => [key, cache.get(key)])),
    put: (key, value) => cache.set(key, value),
    remove: key => cache.delete(key)
  }) };
  c.LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) };
  c.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: content => ({ content, setMimeType() { return this; } }) };
  const ledger = mountPrivateMonitor(h, options);
  const post = payload => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(payload) } }).content);
  const superToken = h.token('supervisor');
  return { ...h, ledger, post, superToken, events: () => ledger.rows.slice(1).map(row => JSON.parse(row[1])),
    monitor: (section, payload = {}) => post({ action: 'supervisorMonitor', token: superToken, section, ...payload }) };
}

test('instalação aditiva e idempotente, sem escritas em abas históricas', () => {
  const h = fixture();
  h.add(1);
  const before = JSON.stringify(h.row(1));
  assert.equal(h.c.instalarMonitoramentoBQ().historicalRecordWrites, 0);
  assert.equal(h.ledger.writes, 1);
  h.c.instalarMonitoramentoBQ();
  assert.equal(h.ledger.writes, 1);
  assert.equal(JSON.stringify(h.row(1)), before);
  assert.equal(h.sheets.has('MONITORAMENTO_OCORRENCIAS'), false);
});

test('armazenamento com acesso por link ou na planilha oficial é rejeitado', () => {
  const h = fixture({ shared: true });
  assert.throws(() => h.c.instalarMonitoramentoBQ(), /acesso restrito/);
  assert.equal(h.props.has('BQ_MONITOR_LEDGER_V1'), false);
  assert.equal(h.ledger.writes, 0);
  h.props.set('BQ_MONITOR_LEDGER_V1', h.c.meta.APP.spreadsheetId);
  assert.throws(() => h.c.instalarMonitoramentoBQ(), /separado/);
  assert.equal(h.c.bqAppendEvent_({ kind: 'ERRO' }), false);
});

test('saúde e detalhes são exclusivos do Supervisor, inclusive fotos históricas', () => {
  const h = fixture();
  for (const token of [h.token('field'), h.login(), h.master(), 'inválido']) {
    for (const section of ['health', 'late', 'online', 'access', 'history', 'errors', 'diagnosis', 'compare', 'comparisonPhoto']) {
      assert.equal(h.monitor(section, { token, recordId: id(1) }).error, 'AUTH_REQUIRED', section);
    }
  }
  assert.equal(h.monitor('diagnosis', { recordId: id(1) }).error, 'RECORD_NOT_FOUND');
  assert.equal(h.post({ action: 'constructor' }).error, 'UNKNOWN_ACTION');
});

test('login confirmado gera um acesso; refresh/heartbeat não gera eventos adicionais', () => {
  const h = fixture();
  h.c.instalarMonitoramentoBQ();
  const logged = h.post({ action: 'login', user: 'Fiscal A', role: 'fiscal', password: 'fixture-password', clientVersion: '2026.11.09.1' });
  assert.ok(logged.ok);
  for (let i = 0; i < 5; i++) assert.equal(h.post({ action: 'presenceHeartbeat', token: logged.token, base: 'MOSSORÓ' }).ok, true);
  assert.equal(h.events().length, 1);
  const access = h.monitor('access', { filters: { user: 'Fiscal A', base: 'CAICÓ' } }).items[0];
  assert.equal(access.type, 'LOGIN_CONFIRMADO');
  assert.equal(access.state, 'SESSÃO EMITIDA');
  assert.deepEqual(access.bases, ['CAICÓ']);
  assert.equal(access.sessionId.length, 32);
  assert.doesNotMatch(JSON.stringify(h.events()), /fixture-password|passwordHash|fixture-only-signing-secret/);
  assert.equal(h.monitor('online').items[0].base, '');
  assert.equal(h.monitor('online').items[0].state, 'ONLINE');
  assert.equal(h.post({ action: 'presenceEnd', token: logged.token }).available, true);
  assert.equal(h.post({ action: 'presenceEnd', token: logged.token }).available, true);
  assert.equal(h.events().length, 2);
  assert.equal(h.monitor('online').items[0].state, 'DESCONECTADO');
});

test('Campo é uma identidade declarada; Fiscal revogado deixa de ser online', () => {
  const h = fixture();
  h.c.instalarMonitoramentoBQ();
  const fiscal = h.post({ action: 'login', user: 'Fiscal A', role: 'fiscal', password: 'fixture-password' });
  h.post({ action: 'presenceHeartbeat', token: fiscal.token });
  h.post({ action: 'presenceHeartbeat', token: h.token('field'), base: 'CAICÓ', team: 'LM A' });
  const accounts = h.c.fiscalAccounts_(), account = accounts[h.c.fiscalAccountKey_('Fiscal A')];
  account.revision = randomUUID();
  h.c.writeFiscalAccounts_(accounts);
  const online = h.monitor('online').items;
  assert.equal(online.find(row => row.role === 'field').identity, 'DECLARADA');
  assert.equal(online.find(row => row.role === 'field').team, 'LM A');
  assert.equal(online.find(row => row.role === 'fiscal').state, 'DESCONECTADO');
  assert.equal(h.monitor('access').items[0].state, 'AUTORIZAÇÃO_REVOGADA');
  assert.equal(h.post({ action: 'presenceHeartbeat', token: fiscal.token }).error, 'AUTH_REQUIRED');
});

test('erros aceitam códigos previstos, limitam duplicatas e descartam conteúdo e UUID fora da Base', () => {
  const h = fixture();
  h.c.instalarMonitoramentoBQ();
  h.add(1); h.add(2, { base: 'MOSSORÓ' });
  const token = h.login();
  const event = { action: 'localSync', code: 'LOCAL_PHOTO_READ_ERROR', recordId: id(1),
    stage: 'read_photo', message: 'SEGREDO fixture', dataUrl: 'data:image/jpeg;base64,PRIVATE', correlationId: randomUUID() };
  const outside = { ...event, recordId: id(2) };
  h.post({ action: 'reportClientErrors', token, events: [outside, outside, event, event] });
  const logged = h.monitor('errors').items;
  assert.equal(logged.length, 1);
  assert.equal(logged[0].recordId, id(1));
  assert.equal(logged[0].stage, 'read_photo');
  assert.equal(logged[0].correlationId, event.correlationId);
  assert.doesNotMatch(JSON.stringify(logged), /SEGREDO|data:image|PRIVATE/);
  assert.equal(h.monitor('errors', { token }).error, 'AUTH_REQUIRED');
});

test('alertas distinguem atrasos formais, destinatários legados, concluídas e fotos', () => {
  const h = fixture();
  const { COL } = h.c.meta;
  const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();
  for (const [n, hours] of [[1, 25], [2, 49], [3, 73], [4, 20], [5, 85]]) {
    h.add(n);
    const row = h.row(n);
    row[COL.STATUS - 1] = 'CORRECAO_SOLICITADA';
    h.setAudit(n, { ...h.audit(n), lastCorrectionRequest: { requestedAt: hoursAgo(hours), reason: 'Revisar dados', supervisor: 'Supervisão' } });
  }
  h.setAudit(5, { ...h.audit(5), lastCorrectionSubmission: { requestedAt: h.audit(5).lastCorrectionRequest.requestedAt, phase: 'COMPLETE' } });
  h.add(6, { status: 'FOTOS_SENDO_SINCRONIZADAS' });
  const list = h.monitor('late');
  assert.deepEqual(list.items.map(item => [item.recordId, item.correction.band, item.correction.responsible]),
    [[id(3), 72, 'Campo A'], [id(2), 48, 'Campo A'], [id(1), 24, 'Campo A']]);
});

test('diagnóstico distingue dados, fotos, conflitos e publicação parcial sem escrita', () => {
  const h = fixture();
  const { APP, COL } = h.c.meta;
  h.c.instalarMonitoramentoBQ();
  h.add(1, { status: 'FOTOS_SENDO_SINCRONIZADAS' });
  h.setAudit(1, { ...h.audit(1), lastDataConfirmation: '2026-10-10T12:00:00-03:00' });
  h.c.bqTechnicalError_('localSync', 'DATA_COMMIT_CONFLICT', { role: 'field' }, id(1), randomUUID(), '2026.11.09.1', 'APLICATIVO');
  const copy = h.row(1).slice();
  copy[COL.STATUS - 1] = 'PUBLICADA';
  h.sheet(APP.officialSheet).appendRow(copy);
  const before = JSON.stringify([...h.sheets.values()].map(sheet => sheet.rows));
  const diagnosis = h.monitor('diagnosis', { recordId: id(1) });
  assert.equal(diagnosis.persistence.confirmed, true);
  assert.equal(diagnosis.persistence.conflict, true);
  assert.equal(diagnosis.persistence.publication, 'PUBLICAÇÃO NECESSITA RECONCILIAÇÃO');
  assert.deepEqual(diagnosis.photos.pending, [1, 2, 3]);
  assert.ok(diagnosis.conclusions.includes('DADOS CONFIRMADOS — FOTOS PENDENTES'));
  assert.match(diagnosis.photos.localState, /NÃO VERIFICÁVEL/);
  assert.equal(JSON.stringify([...h.sheets.values()].map(sheet => sheet.rows)), before);
});

test('comparador conserva dois ciclos e recusa foto de outro UUID ou slot', () => {
  const h = fixture();
  h.c.instalarMonitoramentoBQ();
  h.add(1);
  const { COL, APP } = h.c.meta;
  const key = randomUUID(), photoId = 'FixtureDriveIdentity_0123456789', previous = 'FixturePreviousImage_0123456789';
  const at = '2026-10-10T12:00:00-03:00', photoUrl = file => 'https://drive.google.com/uc?id=' + file;
  const textReceipt = { requestId: randomUUID(), actor: 'Campo A', phase: 'COMPLETE', completedAt: at, requestedAt: at,
    beforePatch: { pgPostRemoved: '01', totalServices: 100 }, expectedPatch: { pgPostRemoved: '02', totalServices: 125 } };
  const cycle = h.c.bqCorrectionCycle_(h.row(1), textReceipt);
  assert.equal(h.c.bqAppendEvent_({ kind: 'OPERACAO', recordId: id(1), cycle }), true);
  assert.equal(h.monitor('history').items[0].cycle, undefined);
  const photoReceipt = { requestId: randomUUID(), actor: 'Fiscal A', actorRole: 'fiscal', phase: 'COMPLETE', completedAt: '2026-10-11T12:00:00-03:00',
    beforePhotoPatch: { 2: { serverUrl: photoUrl(previous) } }, photoPatch: { 2: { uploadKey: key } } };
  const row = h.row(1);
  row[COL.PHOTO_1] = photoUrl(photoId);
  h.setAudit(1, { ...h.audit(1), lastCorrectionSubmission: photoReceipt,
    photoSubmissions: { 2: { phase: 'COMPLETE', uploadKey: key, expectedUrl: photoUrl(photoId) } } });
  const comparison = h.monitor('compare', { recordId: id(1) });
  assert.equal(comparison.cycles.length, 2);
  assert.equal(comparison.cycles[1].beforeTotal, 100);
  assert.equal(comparison.cycles[1].afterTotal, 125);
  assert.ok(comparison.cycles[1].changes.some(change => change.field.includes('PG')));
  assert.doesNotMatch(JSON.stringify(comparison), /FixtureDriveIdentity|FixturePreviousImage/);
  let identity = id(2);
  h.c.DriveApp = { getFileById: file => ({ isTrashed: () => file === previous,
    getDescription: () => [APP.name, identity, 'FOTO_2', key].join(' | '),
    getBlob: () => ({ getContentType: () => 'image/jpeg', getBytes: () => [1, 2, 3] }) }) };
  const photo = { recordId: id(1), cycleId: photoReceipt.requestId, photoIndex: 2, side: 'after' };
  assert.equal(h.monitor('comparisonPhoto', photo).dataUrl, '');
  identity = id(1);
  assert.match(h.monitor('comparisonPhoto', photo).dataUrl, /^data:image\/jpeg/);
  assert.equal(h.monitor('comparisonPhoto', { ...photo, side: 'before' }).dataUrl, '');
  assert.equal(h.monitor('comparisonPhoto', { ...photo, photoIndex: 3 }).error, 'INVALID_PHOTO_INDEX');
});

test('compatibilidade bloqueia a mutação específica; mantém clientes v12 anteriores e leituras', () => {
  const h = fixture();
  const health = h.c.health_();
  assert.equal(health.version, '2026.11.09.1');
  assert.equal(health.compatibility.monitoring, 1);
  assert.doesNotThrow(() => h.c.bqCheckContract_('submitRecord', {}));
  const policy = { ...health.compatibility, operationContracts: { submitRecord: ['future'] } };
  assert.throws(() => h.c.bqCheckContract_('submitRecord', {}, policy), error => error.code === 'CLIENT_UPDATE_REQUIRED');
  assert.doesNotThrow(() => h.c.bqCheckContract_('getRecordState', {}, policy));
  assert.doesNotThrow(() => h.c.bqCheckContract_('uploadPhoto', {}, policy));
  assert.equal(h.post({ action: 'uploadPhoto', clientContract: 'future' }).error, 'CLIENT_UPDATE_REQUIRED');
});

test('consultas sob demanda medem volume sem escrever na presença', () => {
  const h = fixture(), { APP } = h.c.meta;
  h.c.instalarMonitoramentoBQ();
  for (let n = 1; n <= 600; n++) h.add(n);
  const pending = h.sheet(APP.pendingSheet), official = h.sheet(APP.officialSheet);
  const writes = h.ledger.writes;
  const token = h.token('field');
  for (let i = 0; i < 20; i++) h.post({ action: 'presenceHeartbeat', token });
  assert.equal(h.ledger.writes, writes);
  const before = pending.reads + official.reads, start = performance.now();
  const result = h.monitor('health');
  assert.equal(result.total, 600);
  assert.equal(result.items.length, 60);
  assert.equal(pending.reads + official.reads - before, 1);
  console.log('Saúde em memória (600 UUIDs, 60 retornados) ' + (performance.now() - start).toFixed(1) + ' ms');
});
