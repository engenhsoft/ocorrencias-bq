// Offline integration fixtures. No network, credentials, or production writes.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as core from '../core.js';
import { initialFinancialValue, buildFinancialComparison } from '../supervisor-financial.js';
import { buildConformityComparison } from '../supervisor-conformity.js';

const backend = await readFile(process.argv[2], 'utf8');
const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const [persistence, features] = await Promise.all([read('correction-persistence.mjs'), read('operational-features.mjs')]);
const extract = (s, name) => { const match = s.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(match, name); return match[0]; };
const factory = vm.runInNewContext(persistence.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(persistence, 'harness') + '\nharness', { vm, backend, createHash, assert, core });
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const baseHarness = vm.runInNewContext(extract(features, 'harness') + '\nharness', { factory, vm, extract, backend, createHash, createHmac, randomUUID, Buffer, Map, Date, id });
const plain = value => JSON.parse(JSON.stringify(value));
export function harness() {
  const h = baseHarness();
  h.c.Utilities.newBlob = value => ({ getBytes: () => [...Buffer.from(value)], getDataAsString: () => Buffer.from(value).toString('utf8') });
  h.c.assertTeamDirectorySelection_ = () => {};
  h.row = n => h.sheet(h.c.meta.APP.pendingSheet).rows.find(row => row[0] === id(n));
  h.audit = n => JSON.parse(h.row(n)[h.c.meta.COL.AUDIT - 1]);
  h.setAudit = (n, audit) => { h.row(n)[h.c.meta.COL.AUDIT - 1] = JSON.stringify(audit); };
  h.login = (user = 'Fiscal A') => h.c.loginFiscal_({ user, password: 'fixture-password' }).token;
  h.request = n => h.c.supervisorAction_({ token: h.token('supervisor'), recordId: id(n), decision: 'request_correction', reason: 'Corrigir conforme serviço executado', note: 'Conferir os dados' });
  h.open = (n, token = h.login()) => h.c.openFiscalCorrection_({ token, recordId: id(n) }).record;
  h.payload = (record, changes = {}) => {
    const candidate = { ...record, ...changes }, delta = core.correctionDelta(core.correctionOriginalSnapshot(record), candidate);
    return { ...core.correctionFields(candidate), ...delta, recordId: record.recordId, correctionRequestId: randomUUID(), correctionRequestedAt: record.fiscalCorrection.requestedAt, fiscalCorrection: record.fiscalCorrection,
      expectedPhotoIndexes: record.photoStates.filter(photo => photo.confirmed).map(photo => photo.photoIndex) };
  };
  h.submit = (record, token = h.login()) => h.c.submitRecord_({ token, record, clientVersion: core.APP_VERSION });
  h.master = () => {
    const salt = 'b'.repeat(64); h.c.configureFiscalMaster_({ user: 'Fiscal Mestre', salt, passwordHash: createHash('sha256').update(salt + '\nfixture-password').digest('hex') });
    return h.login('Fiscal Mestre');
  };
  h.assign = (n, token, user) => {
    const route = h.audit(n).lastCorrectionRequest;
    return h.c.reassignFiscalCorrection_({ token, recordId: id(n), assignedFiscal: user, routingRequestId: route.routingRequestId, expectedRevision: route.assignmentRevision });
  };
  h.principal = (user, bases) => { const accounts = JSON.parse(h.props.get('FISCAL_ACCOUNTS_V1')); accounts[h.c.fiscalAccountKey_(user)].correctionBases = bases; h.props.set('FISCAL_ACCOUNTS_V1', JSON.stringify(accounts)); };
  h.drive = () => { const drive = vm.runInNewContext(extract(persistence, 'fakePhotoDrive') + '\nfakePhotoDrive', { Buffer })(h); h.c.Utilities.newBlob = (value, mime, name) => ({ bytes: value, mime, name, getBytes: () => [...Buffer.from(value)], getDataAsString: () => Buffer.from(value).toString('utf8') }); return drive; };
  h.upload = (n, index, key, context, token = h.login()) => h.c.uploadPhoto_({ token, recordId: id(n), photoIndex: index, uploadKey: key, fiscalCorrection: context, replace: true, dataUrl: 'data:image/jpeg;base64,aGVsbG8=' });
  return h;
}
const tests = [], test = (name, run) => tests.push({ name, run });
function requested(options = {}) { const h = harness(); h.grant('Fiscal A', options.bases || ['CAICÓ']); h.add(1, options); h.request(1); return h; }
const unchanged = (h, callback) => { const before = JSON.stringify([...h.sheets.values()].map(sheet => sheet.rows)); callback(); assert.equal(JSON.stringify([...h.sheets.values()].map(sheet => sheet.rows)), before); };

test('01 nova solicitação registra Fiscal, versão, UUID de pedido e revisão; usuário original permanece', () => {
  const h = requested(), record = h.open(1); assert.equal(record.fiscalCorrection.routingVersion, 'FISCAL_ASSIGNED'); assert.equal(record.fiscalCorrection.assignedFiscal, 'Fiscal A'); assert.ok(core.isUuid(record.fiscalCorrection.routingRequestId)); assert.ok(core.isUuid(record.fiscalCorrection.assignmentRevision)); assert.equal(record.user, 'Campo A');
});
test('02 Fiscal de uma Base recebe somente correções atribuídas e não altera pelo UUID de outra Base', () => {
  const h = requested(); h.add(2, { base: 'MOSSORÓ' }); h.request(2); const token = h.login(); assert.equal(h.c.listFiscalCorrections_({ token }).records.length, 1);
  unchanged(h, () => assert.throws(() => h.open(2, token), error => error.code === 'FORBIDDEN'));
});
test('03 Fiscal de várias Bases pode corrigir solicitações das duas Bases', () => {
  const h = requested({ bases: ['CAICÓ', 'MOSSORÓ'] }); h.add(2, { base: 'MOSSORÓ' }); h.request(2); assert.equal(h.c.listFiscalCorrections_({ token: h.login() }).records.filter(record => record.canCorrect).length, 2); assert.equal(h.open(2).fiscalCorrection.assignedFiscal, 'Fiscal A');
});
test('04 dois fiscais sem principal aguardam atribuição; com principal há um só destinatário', () => {
  const h = harness(); h.grant(); h.grant('Fiscal B'); h.add(1); h.request(1); assert.equal(h.audit(1).lastCorrectionRequest.assignmentStatus, 'WAITING_ASSIGNMENT'); h.principal('Fiscal B', ['CAICÓ']); h.add(2); h.request(2); assert.equal(h.audit(2).lastCorrectionRequest.assignedFiscal, 'Fiscal B'); assert.throws(() => h.open(2), error => error.code === 'FORBIDDEN');
});
test('05 sem Fiscal ativo fica aguardando, nunca volta ao Campo; conta mestra atribui com histórico', () => {
  const h = harness(); h.add(1); h.request(1); assert.equal(h.audit(1).lastCorrectionRequest.assignmentReason, 'NO_ACTIVE_FISCAL'); const token = h.master(); h.grant(); h.assign(1, token, 'Fiscal A'); assert.equal(h.open(1).fiscalCorrection.assignedFiscal, 'Fiscal A'); assert.equal(h.audit(1).timeline.at(-1).actor, 'Fiscal Mestre');
});
test('06 Fiscal desativado ou com ACL alterada perde imediatamente a edição e não modifica a planilha', () => {
  const h = requested(), token = h.login(), payload = h.payload(h.open(1), { observation: 'Corrigido' }); h.grant('Fiscal A', ['MOSSORÓ']); unchanged(h, () => assert.throws(() => h.submit(payload, token), error => error.code === 'AUTH_REQUIRED'));
});
test('07 outra Base e Base final adulterada são bloqueadas antes da gravação', () => {
  const h = requested(), record = h.open(1); unchanged(h, () => assert.throws(() => h.submit(h.payload(record, { base: 'MOSSORÓ' })), error => error.code === 'FORBIDDEN'));
});
test('08 Fiscal não cria, não edita sem solicitação, não aprova nem publica', () => {
  const h = requested(); h.add(2); const token = h.login();
  for (const n of [2, 999]) unchanged(h, () => assert.throws(() => h.submit({ recordId: id(n) }, token), error => error.code === 'FORBIDDEN'));
  for (const action of ['supervisorAction_', 'supervisorCorrectRecord_', 'approveBatch_']) unchanged(h, () => assert.throws(() => h.c[action]({ token, recordId: id(1), decision: 'approve' }), error => error.code === 'AUTH_REQUIRED'));
});
test('09 serviços históricos e materiais corrigidos preservam códigos e total comprovado', () => {
  const h = requested(), original = h.open(1), services = original.services.map(service => ({ ...service, quantity: 2, totalValue: 200 }));
  const result = h.submit(h.payload(original, { services, materials: [{ ...original.materials[0], quantity: 3 }], totalServices: 200 })); assert.equal(result.record.materials[0].code, '000123'); assert.equal(result.record.materials[0].quantity, 3); assert.equal(result.record.totalServices, 200); assert.equal(result.record.user, original.user); assert.equal(result.record.audit.fiscalCorrections.length, 1); assert.equal(result.record.audit.supervisorCorrections, undefined);
});
test('10 PG, Série, CIA e BTO são preservados no mesmo UUID', () => {
  const h = requested(), record = h.open(1), transformer = { ...record.transformer, removedCode: '000021', removedCia: '000098', removedBto: '000077', newCode: '000022', newCia: '000099', newBto: '000078' };
  const result = h.submit(h.payload(record, { pgPostRemoved: 'PG-1', pgPostInstalled: 'PG-2', pgConductorStart: 'PG-3', pgConductorEnd: 'PG-4', transformer })); assert.equal(result.recordId, id(1)); assert.equal(result.record.transformer.newCia, '000099'); assert.equal(result.record.transformer.removedBto, '000077'); assert.equal(result.record.pgConductorEnd, 'PG-4');
});
test('11 correção somente textual retorna ao Supervisor após releitura', () => {
  const h = requested(), result = h.submit(h.payload(h.open(1), { observation: 'Texto corrigido pelo Fiscal' })); assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(result.record.observation, 'Texto corrigido pelo Fiscal'); assert.equal(result.record.audit.lastCorrectionRequest.assignmentStatus, 'COMPLETE');
});
test('12 foto isolada exige declaração, mantém pendência até upload e não sobrescreve outro slot', () => {
  const h = requested(), record = h.open(1), key = randomUUID(), candidate = plain(record); candidate.photoStates[2] = { ...candidate.photoStates[2], uploadKey: key, localReady: true, replacePending: true, confirmed: false };
  const payload = h.payload(record, { photoStates: candidate.photoStates }), drive = h.drive(), result = h.submit(payload); assert.equal(result.status, 'CORRECAO_SOLICITADA');
  assert.throws(() => h.upload(1, 2, key, record.fiscalCorrection), error => error.code === 'CORRECTION_DATA_UNCONFIRMED');
  const completed = h.upload(1, 3, key, record.fiscalCorrection); assert.equal(completed.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(completed.record.photos[0], record.photos[0]); assert.equal(drive.created(), 1);
});
test('13 correção mista mantém dados confirmados e slots 6/7 independentes até ambas as evidências', () => {
  const h = requested(), record = h.open(1), keys = [randomUUID(), randomUUID()]; h.drive();
  const states = plain(record.photoStates); for (let i = 5; i < 7; i++) states[i] = { photoIndex: i + 1, localReady: true, uploadKey: keys[i - 5], replacePending: true };
  const result = h.submit(h.payload(record, { observation: 'Mista', occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '21', removedCia: '22', removedBto: '23', newCode: '24', newCia: '25', newBto: '26' }, photoStates: states })); assert.equal(result.status, 'CORRECAO_SOLICITADA');
  assert.equal(h.upload(1, 6, keys[0], record.fiscalCorrection).status, 'CORRECAO_SOLICITADA'); const complete = h.upload(1, 7, keys[1], record.fiscalCorrection); assert.equal(complete.status, 'AGUARDANDO_SUPERVISOR'); assert.notEqual(complete.record.transformerPhotos.removed, complete.record.transformerPhotos.installed); assert.equal(complete.record.observation, 'Mista');
});
test('14 retry idempotente não duplica histórico nem intervenção financeira', () => {
  const h = requested(), record = h.open(1), payload = h.payload(record, { services: record.services.map(service => ({ ...service, quantity: 2, totalValue: 200 })), totalServices: 200 });
  h.submit(payload); const before = h.sheet(h.c.meta.APP.historySheet).rows.length; const repeated = h.submit(payload); assert.equal(repeated.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(h.sheet(h.c.meta.APP.historySheet).rows.length, before); assert.equal(repeated.record.audit.fiscalCorrections.length, 1);
});
test('15 resposta perdida após gravação e após upload recupera prova sem novo arquivo', () => {
  const h = requested(), record = h.open(1), key = randomUUID(), states = plain(record.photoStates); states[0] = { ...states[0], localReady: true, uploadKey: key, replacePending: true, confirmed: false }; const payload = h.payload(record, { photoStates: states }), drive = h.drive();
  h.submit(payload); assert.equal(h.submit(payload).status, 'CORRECAO_SOLICITADA'); h.upload(1, 1, key, record.fiscalCorrection); assert.equal(h.upload(1, 1, key, record.fiscalCorrection).status, 'AGUARDANDO_SUPERVISOR'); assert.equal(drive.created(), 1);
});
test('16 reenvio fica visível ao Supervisor, com mesmo UUID, data e proprietário', () => {
  const h = requested(), record = h.open(1), result = h.submit(h.payload(record, { observation: 'Conferir novamente' })); const row = h.row(1); assert.equal(row[h.c.meta.COL.REGISTERED_AT - 1], record.registeredAt); assert.equal(result.record.user, 'Campo A'); assert.equal(h.c.operationalStatusFromValues_(row), 'AGUARDANDO_SUPERVISOR'); assert.equal(result.recordId, record.recordId);
});
test('17 histórico identifica Fiscal e nunca classifica correção como edição direta do Supervisor', () => {
  const h = requested(); h.submit(h.payload(h.open(1), { observation: 'Corrigido' })); const events = h.sheet(h.c.meta.APP.historySheet).rows.slice(1); assert.equal(events.filter(event => event[3] === 'CORRECAO_REENVIADA').at(-1)[2], 'Fiscal A'); const conformity = h.c.buildConformityRecords_([h.row(1)], events); assert.equal(conformity[0].audit.timeline.some(event => event.action === 'CORRIGIDA_PELO_SUPERVISOR'), false);
});
test('18 concorrência e transferência invalidam o antigo destinatário, preservando dados confirmados', () => {
  const h = requested(); h.grant('Fiscal B'); const master = h.master(), record = h.open(1), key = randomUUID(), states = plain(record.photoStates); states[0] = { ...states[0], localReady: true, uploadKey: key, replacePending: true, confirmed: false }; h.submit(h.payload(record, { observation: 'Confirmado antes da transferência', photoStates: states }));
  h.assign(1, master, 'Fiscal B'); assert.equal(h.row(1)[h.c.meta.COL.OBSERVATION - 1], 'Confirmado antes da transferência'); unchanged(h, () => assert.throws(() => h.upload(1, 1, key, record.fiscalCorrection), error => error.code === 'FORBIDDEN'));
  const next = h.open(1, h.login('Fiscal B')); assert.notEqual(next.fiscalCorrection.assignmentRevision, record.fiscalCorrection.assignmentRevision); assert.ok(next.audit.requestedPhotoIndexes.includes(1)); assert.equal(next.audit.transferredCorrectionSubmissions.length, 1);
});
test('mesmo Fiscal em duas abas não aplica delta obsoleto; atribuição obsoleta também falha', () => {
  const h = requested(), record = h.open(1), first = h.payload(record, { observation: 'Primeiro' }), stale = h.payload(record, { observation: 'Outro' }); h.submit(first); unchanged(h, () => assert.throws(() => h.submit(stale), error => ['CORRECTION_DELTA_MISMATCH', 'CORRECTION_ALREADY_CONFIRMED'].includes(error.code)));
});
test('alteração de cadastro durante espera do lock é revalidada', () => {
  const h = requested(), payload = h.payload(h.open(1), { observation: 'Não gravar' }), token = h.login(); h.c.LockService.getScriptLock = () => ({ waitLock() { h.grant('Fiscal A', ['MOSSORÓ']); }, releaseLock() {} });
  // Provisioning itself takes a lock; change the private fixture directly here.
  h.c.LockService.getScriptLock = () => ({ waitLock() { const accounts = JSON.parse(h.props.get('FISCAL_ACCOUNTS_V1')); accounts[h.c.fiscalAccountKey_('Fiscal A')].revision = randomUUID(); h.props.set('FISCAL_ACCOUNTS_V1', JSON.stringify(accounts)); }, releaseLock() {} });
  unchanged(h, () => assert.throws(() => h.submit(payload, token), error => error.code === 'AUTH_REQUIRED'));
});
test('Campo original não pode editar nova solicitação nem enviar fotos de correção', () => {
  const h = requested(), record = h.open(1), token = h.token('field'); unchanged(h, () => assert.throws(() => h.submit(h.payload(record, { observation: 'Proibido' }), token), error => error.code === 'FISCAL_CORRECTION_REQUIRED')); unchanged(h, () => assert.throws(() => h.upload(1, 1, randomUUID(), record.fiscalCorrection, token), error => error.code === 'FISCAL_CORRECTION_REQUIRED'));
});
for (let n = 1; n <= 4; n++) test(`compatibilidade LEGACY_FIELD ${n}: mesmo responsável, UUID e protocolo de reenvio`, () => {
  const h = harness(); h.grant(); h.add(n, { status: 'CORRECAO_SOLICITADA' }); const audit = h.audit(n); audit.lastCorrectionRequest = { requestedAt: '2026-09-11T14:18:48-03:00', reason: 'Solicitação anterior', supervisor: 'Supervisor A' }; h.setAudit(n, audit); const row = h.row(n), before = row.slice(), record = h.c.recordFromValuesAt_(row);
  assert.equal(h.c.fiscalCorrectionProjection_(audit).routingVersion, 'LEGACY_FIELD'); const candidate = { ...record, observation: 'Correção antiga', correctionRequestId: randomUUID(), correctionRequestedAt: audit.lastCorrectionRequest.requestedAt, ...core.correctionDelta(core.correctionOriginalSnapshot(record), { ...record, observation: 'Correção antiga' }) }; const result = h.submit(candidate, h.token('field')); assert.equal(result.status, 'AGUARDANDO_SUPERVISOR'); assert.equal(result.recordId, before[0]); assert.equal(result.record.user, before[2]); assert.equal(h.audit(n).lastCorrectionRequest.routingVersion, undefined);
});
test('indicadores de uma/várias Bases filtram histórico, ranking e financeiro por autorização no servidor', () => {
  const h = harness(); h.grant(); h.add(1); h.add(2, { base: 'MOSSORÓ', leader: 'CHEFE SECRETO' }); h.event(2, 'APROVADA_E_PUBLICADA', undefined, 'CHEFE SECRETO', 'MOSSORÓ');
  const summary = h.c.getOperationalSummary_({ token: h.login() }); assert.deepEqual(plain(summary.authorizedBases), ['CAICÓ']); assert.equal(summary.top3.length, 1); assert.equal(summary.bases.month.length, 1); assert.doesNotMatch(JSON.stringify(summary), /MOSSORÓ|CHEFE SECRETO/); h.grant('Fiscal A', ['CAICÓ', 'MOSSORÓ']); assert.equal(h.c.getOperationalSummary_({ token: h.login() }).bases.month.reduce((sum, item) => sum + item.count, 0), 2);
});
test('identidade original fora da ACL não vaza em ranking/histórico mesmo com Base atual autorizada', () => {
  const h = harness(); h.grant(); h.add(1); h.event(1, 'CRIADA', undefined, 'CHEFE SECRETO', 'MOSSORÓ'); assert.doesNotMatch(JSON.stringify(h.c.getOperationalSummary_({ token: h.login() })), /MOSSORÓ|CHEFE SECRETO/);
});
test('TOP3 e distribuição contam UUID uma vez, excluem rascunhos, correções e meses anteriores', () => {
  const h = harness(); h.grant(); h.add(1); h.add(2, { status: 'CORRECAO_SOLICITADA' }); h.add(3, { date: '2026-09-10T12:00:00-03:00' }); h.sheet(h.c.meta.APP.officialSheet).appendRow(h.row(1).slice()); const summary = h.c.getOperationalSummary_({ token: h.login() }); assert.equal(summary.top3[0].count, 1); assert.equal(summary.bases.month[0].count, 1); assert.equal(summary.bases.all[0].count, 2);
});
test('financeiro usa primeira intervenção Fiscal e total publicado final; sem edição enviado=final', () => {
  const h = requested(), record = h.open(1), changed = h.submit(h.payload(record, { services: record.services.map(service => ({ ...service, quantity: 2, totalValue: 200 })), totalServices: 200 })).record;
  const published = { ...changed, status: 'PUBLICADA' }; assert.equal(initialFinancialValue(published).sent, 100); const comparison = buildFinancialComparison([published, published], { period: 'all', base: 'CAICÓ', team: 'LM A' }); assert.equal(comparison.count, 1); assert.equal(comparison.corrected, 200); assert.equal(comparison.sent, 100); const raw = { ...published, audit: {}, totalServices: 70 }; assert.equal(initialFinancialValue(raw).sent, 70);
});
test('conformidade distingue aprovação sem edição direta e edição efetiva pelo Supervisor', () => {
  const h = requested(); h.submit(h.payload(h.open(1), { observation: 'Fiscal corrigiu' })); h.row(1)[h.c.meta.COL.STATUS - 1] = 'PUBLICADA'; h.event(1, 'APROVADA_E_PUBLICADA'); const projection = h.c.buildConformityRecords_([h.row(1)], h.sheet(h.c.meta.APP.historySheet).rows.slice(1)); const result = buildConformityComparison(plain(projection), { period: 'all' }); assert.equal(JSON.stringify(result).includes('NaN'), false); assert.equal(projection[0].audit.timeline.some(event => event.action === 'CORRIGIDA_PELO_SUPERVISOR'), false);
});
test('sincronismo original do Campo continua idempotente e não conclui correção Fiscal', () => {
  const h = requested(), audit = h.audit(1); audit.photoSyncRequest = { status: 'OPEN', recipient: 'Campo A', requestedAt: '2026-10-15T10:00:00-03:00' }; h.setAudit(1, audit); h.drive();
  const payload = { token: h.token('field'), recordId: id(1), photoIndex: 4, uploadKey: randomUUID(), dataUrl: 'data:image/jpeg;base64,aGVsbG8=', replace: false };
  const first = h.c.uploadPhoto_(payload), second = h.c.uploadPhoto_(payload); assert.equal(first.status, 'CORRECAO_SOLICITADA'); assert.equal(second.status, 'CORRECAO_SOLICITADA'); assert.equal(first.record.photos[3], second.record.photos[3]); assert.equal(h.audit(1).lastCorrectionSubmission, undefined); assert.equal(h.audit(1).lastCorrectionRequest.assignedFiscal, 'Fiscal A');
});
test('principal duplicado é recusado pela gestão existente e salvar o mesmo responsável preserva revisão', () => {
  const h = requested(), master = h.master(); h.grant('Fiscal B'); const route = h.audit(1).lastCorrectionRequest; h.assign(1, master, 'Fiscal A'); assert.equal(h.audit(1).lastCorrectionRequest.assignmentRevision, route.assignmentRevision);
  const accounts = h.c.listFiscalAccounts_({ token: master }).accounts;
  h.c.saveFiscalAccount_({ token: master, mode: 'update', user: 'Fiscal A', expectedRevision: accounts.find(account => account.user === 'Fiscal A').revision, bases: ['CAICÓ'], correctionBases: ['CAICÓ'], active: true });
  assert.throws(() => h.c.saveFiscalAccount_({ token: master, mode: 'update', user: 'Fiscal B', expectedRevision: accounts.find(account => account.user === 'Fiscal B').revision, bases: ['CAICÓ'], correctionBases: ['CAICÓ'], active: true }), error => error.code === 'FISCAL_PRINCIPAL_CONFLICT');
});
if (process.env.OCCBQ_LEGACY_SNAPSHOT) test('snapshot read-only das quatro antigas permanece byte a byte intacto ao listar/gerar indicadores', async () => {
  const snapshot = JSON.parse(await readFile(process.env.OCCBQ_LEGACY_SNAPSHOT, 'utf8')), h = harness(); h.grant('Fiscal A', h.c.fiscalOfficialBases_());
  for (const record of snapshot.records) h.sheet(h.c.meta.APP.pendingSheet).appendRow(record.values || record.row || record);
  const before = JSON.stringify(h.sheet(h.c.meta.APP.pendingSheet).rows); h.c.listFiscalCorrections_({ token: h.login() }); h.c.getOperationalSummary_({ token: h.login() }); assert.equal(JSON.stringify(h.sheet(h.c.meta.APP.pendingSheet).rows), before); assert.equal(snapshot.records.length, 4);
});

const failures = [];
for (const item of tests) { try { await item.run(); console.log('PASS ' + item.name); } catch (error) { failures.push({ name: item.name, error: error.stack }); console.error('FAIL ' + item.name + '\n' + error.stack); } }
const result = { total: tests.length, passed: tests.length - failures.length, failed: failures.length, productionWrites: 0, failures };
if (process.env.OCCBQ_TEST_REPORT) await writeFile(process.env.OCCBQ_TEST_REPORT, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2)); if (failures.length) process.exitCode = 1;
