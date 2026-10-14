import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const [backend, persistenceTests, coreSource, featureSource] = await Promise.all([
  readFile(process.argv[2], 'utf8'), ...['tests/correction-persistence.mjs', 'core.js', 'operational-features.js'].map(name => readFile(new URL('../' + name, import.meta.url), 'utf8'))
]);
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const extract = (s, name) => { const m = s.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(m, name); return m[0]; };
const factory = vm.runInNewContext(persistenceTests.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(persistenceTests, 'harness') + '\nharness', { vm, backend, createHash, assert, core });
const plain = value => JSON.parse(JSON.stringify(value));
const tests = []; const test = (name, run) => tests.push({ name, run });
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
function harness() {
  const h = factory([]); const props = new Map([['SESSION_SIGNING_SECRET', 'fixture-only-signing-secret']]);
  h.c.PropertiesService = { getScriptProperties: () => ({ getProperty: key => props.get(key) || null, setProperty: (key, value) => props.set(key, value) }) };
  Object.assign(h.c.Utilities, {
    getUuid: randomUUID, base64EncodeWebSafe: value => Buffer.from(typeof value === 'string' ? value : value).toString('base64url'),
    base64DecodeWebSafe: value => Array.from(Buffer.from(value, 'base64url')), base64Encode: value => Buffer.from(value).toString('base64'),
    newBlob: value => ({ getDataAsString: () => Buffer.from(value).toString('utf8') }),
    computeHmacSha256Signature: (value, key) => Array.from(createHmac('sha256', String(key)).update(String(value)).digest()),
    formatDate: (value, zone, format) => { const date = new Date(new Date(value).getTime() - 3 * 3600000).toISOString(); return format === 'yyyy-MM-dd' ? date.slice(0, 10) : date.slice(0, 19) + '-03:00'; }
  });
  vm.runInContext(extract(backend, 'requireSession_'), h.c);
  h.c.todayOperational_ = () => '2026-10-14';
  h.c.CacheService = { getScriptCache: () => ({ get() { return '1'; }, put() {}, remove() {} }) };
  h.props = props;
  h.add = (n, { base = 'CAICÓ', leader = 'Chefe A', date = '2026-10-10T12:00:00-03:00', status = 'AGUARDANDO_SUPERVISOR', total = 100 } = {}) => {
    const row = h.seed({ recordId: id(n), registeredAt: date, user: 'Campo A', base, contract: base === 'MOSSORÓ' ? '4600080939' : '4600080938', team: 'LM A', crewLeader: leader, occurrenceNumber: 'O-' + n, occurrenceTypes: ['PODA'], transformer: {}, services: [{ code: 'S', catalogText: 'Serviço histórico', unit: 'UN', quantity: 1, referenceValue: total, totalValue: total, contract: '4600080938' }], materials: [{ code: '000123', description: 'Material', unit: 'UN', quantity: 2 }], totalServices: total, observation: 'Observação' }, { status });
    if (status === 'FOTOS_SENDO_SINCRONIZADAS') for (let i = h.c.meta.COL.PHOTO_1 - 1; i < h.c.meta.COL.PHOTO_5; i++) h.sheet(h.c.meta.APP.pendingSheet).rows.at(-1)[i] = '';
    return row;
  };
  h.event = (n, action, at = '2026-10-12T12:00:00-03:00', leader = 'Chefe A', base = 'CAICÓ') => {
    const event = Array(19).fill(''); Object.assign(event, { 0: id(n), 1: at, 2: 'Supervisor A', 3: action, 9: 'LM A', 11: base, 12: leader }); h.sheet(h.c.meta.APP.historySheet).appendRow(event);
  };
  h.grant = (user = 'Fiscal A', bases = ['CAICÓ']) => h.c.configureFiscalAccount_({ user, bases, salt: 'a'.repeat(32), passwordHash: createHash('sha256').update('a'.repeat(32) + '\nfixture-password').digest('hex') });
  h.fiscal = () => h.c.login_({ user: 'Fiscal A', role: 'fiscal', password: 'fixture-password' });
  h.token = role => h.c.createToken_(role === 'field' ? 'Campo A' : 'Supervisor A', role, Date.now() + 3600000);
  h.summary = supervisor => h.c.getOperationalSummary_({ token: h.token(supervisor ? 'supervisor' : 'field') });
  return h;
}
test('TOP 3 deduplica UUID, exclui pendências/correção/reprovação e usa data original', () => {
  const h = harness(); h.add(1); h.add(2, { leader: 'Chefe B', status: 'PUBLICADA' }); h.add(3, { leader: 'Chefe B' });
  h.add(4, { status: 'CORRECAO_SOLICITADA' }); h.add(5, { status: 'REPROVADA' }); h.add(6, { status: 'FOTOS_SENDO_SINCRONIZADAS' }); h.add(7, { date: '2026-09-30T23:00:00-03:00' });
  const copy = h.sheet(h.c.meta.APP.pendingSheet).rows[1].slice(); h.sheet(h.c.meta.APP.officialSheet).appendRow(copy);
  const result = h.summary(true); assert.deepEqual(plain(result.top3).map(x => [x.crewLeader, x.count]), [['Chefe B', 2], ['Chefe A', 1]]);
  assert.equal(result.bases.month.find(x => x.label === 'CAICÓ').count, 3); assert.equal(result.bases.all.find(x => x.label === 'CAICÓ').count, 4);
});
test('TOP 3 Campo e Supervisor recebem regra idêntica sem dados pessoais de outras ocorrências', () => {
  const h = harness(); h.add(1); h.add(2, { leader: 'Chefe B' });
  assert.deepEqual(plain(h.summary(false).top3), plain(h.summary(true).top3));
  const field = h.summary(false); assert.equal(field.records, undefined); assert.equal(field.nonconformity, undefined); assert.equal(field.bases, undefined);
});
test('virada mensal e anual usa America/Bahia mesmo em timestamps UTC', () => {
  const h = harness(); assert.equal(h.c.featureDate_('2026-11-01T01:00:00Z'), '2026-10-31'); assert.equal(h.c.featureDate_('2027-01-01T02:00:00Z'), '2026-12-31');
  h.add(1, { date: '2026-11-01T01:00:00Z' }); h.add(2, { date: '2026-10-01T02:00:00Z' }); assert.equal(h.summary(true).top3[0].count, 1);
});
test('empate determinístico; menos de três; Base normalizada e Bases vazias visíveis', () => {
  const h = harness(); h.add(1, { leader: 'Zé', base: ' caico ' }); h.add(2, { leader: 'Ana' });
  const result = h.summary(true); assert.deepEqual(plain(result.top3).map(x => x.crewLeader), ['Ana', 'Zé']); assert.equal(result.bases.month.length, 6); assert.equal(result.bases.month.find(x => x.label === 'MOSSORÓ').count, 0);
});
test('chefia histórica não muda quando cadastro ou linha posterior muda', () => {
  const h = harness(); h.add(1, { leader: 'Chefe atual' }); h.event(1, 'CRIADA', '2026-10-10T12:00:00-03:00', 'Chefe original');
  assert.equal(h.summary(true).top3[0].crewLeader, 'Chefe original'); h.event(1, 'CORRECAO_SOLICITADA'); assert.equal(h.summary(true).nonconformity.month.crewLeader[0].label, 'Chefe original');
});
test('não conformidade conta UUID uma vez, mantém correção após aprovação e ignora não conferidas', () => {
  const h = harness(); h.add(1); h.add(2); h.add(3); h.add(4);
  h.event(1, 'CORRECAO_SOLICITADA'); h.event(1, 'CORRECAO_SOLICITADA'); h.event(1, 'APROVADA_E_PUBLICADA'); h.event(2, 'REPROVADA'); h.event(3, 'PUBLICADA');
  const item = h.summary(true).nonconformity.month.base.find(x => x.label === 'CAICÓ'); assert.equal(item.analysed, 3); assert.equal(item.nonconforming, 2); assert.equal(item.percentage, 2 / 3 * 100);
  assert.equal(h.summary(true).nonconformity.month.base.find(x => x.label === 'MOSSORÓ').percentage, null);
});
test('decisões do histórico usam data da conferência e filtro completo independente', () => {
  const h = harness(); h.add(1, { date: '2026-09-20T12:00:00-03:00' }); h.add(2);
  h.event(1, 'CORRECAO_SOLICITADA'); h.event(2, 'PUBLICADA', '2026-09-29T12:00:00-03:00');
  assert.equal(h.summary(true).nonconformity.month.base.find(x => x.label === 'CAICÓ').percentage, 100); assert.equal(h.summary(true).nonconformity.all.base.find(x => x.label === 'CAICÓ').percentage, 50);
});
test('fixtures marcadas não participam de indicadores', () => {
  const h = harness(); const row = h.add(1), { COL } = h.c.meta; const audit = JSON.parse(row[COL.AUDIT - 1]); audit.testOnly = true; h.sheet(h.c.meta.APP.pendingSheet).rows[1][COL.AUDIT - 1] = JSON.stringify(audit); h.event(1, 'REPROVADA');
  assert.equal(h.summary(true).top3.length, 0); assert.equal(h.summary(true).nonconformity.month.base.find(x => x.label === 'CAICÓ').analysed, 0);
});
test('Fiscal autentica com senha própria e retorna somente Bases autorizadas', () => {
  const h = harness(); h.grant(); h.add(1); h.add(2, { base: 'MOSSORÓ' }); const login = h.fiscal();
  const result = h.c.listFiscalRecords_({ token: login.token, filters: {} }); assert.equal(result.records.length, 1); assert.equal(result.summary.total, 1); assert.deepEqual(plain(result.bases), ['CAICÓ']);
  assert.equal(JSON.stringify(result).includes('MOSSORÓ'), false); assert.equal(JSON.stringify(login).includes('passwordHash'), false); assert.equal(JSON.stringify(login).includes('salt'), false);
});
test('Fiscal com nome acentuado preserva a identidade em UTF-8 na sessão assinada', () => {
  const h = harness(); h.grant('José Ângelo Fiscal', ['CAICÓ']);
  h.c.Utilities.base64EncodeWebSafe = (value, charset) => Buffer.from(typeof value === 'string' ? charset === 'utf8' ? value : value.replace(/[^\x00-\x7f]/g, '?') : value).toString('base64url');
  const login = h.c.login_({ user: 'José Ângelo Fiscal', role: 'fiscal', password: 'fixture-password' });
  assert.equal(h.c.requireSession_(login.token, ['fiscal']).user, 'José Ângelo Fiscal');
});
test('tokens Campo/Supervisor conservam o formato e assinatura anteriores', () => {
  const h = harness(), nonce = 'nonce-fixture', expires = Date.now() + 10000;
  h.c.Utilities.getUuid = () => nonce;
  for (const role of ['field', 'supervisor']) {
    const body = Buffer.from(JSON.stringify({ user: 'Usuario ASCII', role, exp: expires, nonce })).toString('base64url');
    const expected = body + '.' + createHmac('sha256', 'fixture-only-signing-secret').update(body).digest('base64url');
    assert.equal(h.c.createToken_('Usuario ASCII', role, expires), expected);
  }
});
test('Fiscal com várias Bases mantém UUID distinto e valores sem duplicação', () => {
  const h = harness(); h.grant('Fiscal A', ['CAICÓ', 'MOSSORÓ']); h.add(1); h.add(2, { base: 'MOSSORÓ', status: 'PUBLICADA' });
  h.sheet(h.c.meta.APP.officialSheet).appendRow(h.sheet(h.c.meta.APP.pendingSheet).rows[1].slice());
  const r = h.c.listFiscalRecords_({ token: h.fiscal().token }); assert.equal(r.summary.total, 2); assert.equal(r.summary.eligibleValue, 200);
});
for (const action of ['submitRecord_', 'uploadPhoto_', 'supervisorAction_', 'supervisorCorrectRecord_', 'approveBatch_', 'requestPhotoSyncBatch_', 'listPending_', 'listMine_', 'getTeamDirectory_', 'getDailyTeamProduction_', 'getRecordState_', 'listPublishedRecords_', 'verifyPublishedIntegrityRoute_', 'searchCatalog_', 'getOperationalSummary_']) test('Fiscal bloqueado no endpoint ' + action, () => {
  const h = harness(); h.grant(); const token = h.fiscal().token;
  assert.throws(() => h.c[action]({ token, recordId: id(1), record: { recordId: id(1) } }), error => error.code === 'AUTH_REQUIRED');
  assert.equal(h.sheet(h.c.meta.APP.pendingSheet).getLastRow(), 1);
});
for (const method of ['getOccurrenceDocument_', 'getDocumentPhoto_']) test('UUID de outra Base bloqueado em ' + method, () => {
  const h = harness(); h.grant(); h.add(1, { base: 'MOSSORÓ' }); assert.throws(() => h.c[method]({ token: h.fiscal().token, recordId: id(1), photoIndex: 1 }), e => e.code === 'FORBIDDEN');
});
test('filtro adulterado de Base não amplia contadores nem resultados', () => {
  const h = harness(); h.grant(); assert.throws(() => h.c.listFiscalRecords_({ token: h.fiscal().token, filters: { base: 'MOSSORÓ' } }), e => e.code === 'FORBIDDEN');
});
test('Fiscal recebe a mesma negativa para UUID inexistente e UUID de outra Base', () => {
  const h = harness(); h.grant(); h.add(1, { base: 'MOSSORÓ' }); const token = h.fiscal().token;
  for (const method of ['getOccurrenceDocument_', 'getDocumentPhoto_']) {
    let outside, missing;
    try { h.c[method]({ token, recordId: id(1), photoIndex: 1 }); } catch (error) { outside = error; }
    try { h.c[method]({ token, recordId: id(2), photoIndex: 1 }); } catch (error) { missing = error; }
    assert.equal(outside.code, 'FORBIDDEN'); assert.equal(missing.code, outside.code); assert.equal(missing.message, outside.message);
  }
});
test('Fiscal sem Bases, senha inválida e conta desconhecida são recusados', () => {
  const h = harness(); h.grant(); assert.throws(() => h.c.login_({ user: 'Fiscal A', role: 'fiscal', password: 'invalid' }), e => e.code === 'INVALID_CREDENTIALS');
  assert.throws(() => h.c.login_({ user: 'Outro Fiscal', role: 'fiscal', password: 'fixture-password' }), e => e.code === 'INVALID_CREDENTIALS');
  const accounts = JSON.parse(h.props.get('FISCAL_ACCOUNTS_V1')); accounts[h.c.fiscalAccountKey_('Fiscal A')].bases = []; h.props.set('FISCAL_ACCOUNTS_V1', JSON.stringify(accounts)); assert.throws(() => h.fiscal(), e => e.code === 'INVALID_CREDENTIALS');
});
test('sessão expirada, token adulterado e autorização revogada bloqueiam consultas', () => {
  const h = harness(); h.grant(); const token = h.fiscal().token;
  assert.throws(() => h.c.listFiscalRecords_({ token: token + 'x' }), e => e.code === 'AUTH_REQUIRED');
  const expired = h.c.createToken_('Fiscal A', 'fiscal', Date.now() - 1, 'old'); assert.throws(() => h.c.listFiscalRecords_({ token: expired }), e => e.code === 'AUTH_REQUIRED');
  h.grant('Fiscal A', ['MOSSORÓ']); assert.throws(() => h.c.listFiscalRecords_({ token }), e => e.code === 'AUTH_REQUIRED');
});
test('documento usa dados históricos e remove URLs, recibos, hashes e credenciais', () => {
  const h = harness(); h.grant(); h.add(1); const r = h.c.getOccurrenceDocument_({ token: h.fiscal().token, recordId: id(1) }).record;
  assert.equal(r.materials[0].code, '000123'); assert.equal(r.services[0].referenceValue, 100); assert.equal(r.totalServices, 100); assert.equal(r.photoSlots.length, 5);
  const json = JSON.stringify(r); for (const secret of ['https://', 'uploadKey', 'expectedFingerprint', 'SESSION_SIGNING_SECRET', 'passwordHash']) assert.equal(json.includes(secret), false, secret);
});
test('leitura de foto só utiliza arquivo do UUID+slot autorizado e revalida revogação', () => {
  const h = harness(); h.grant(); const row = h.add(1), { COL } = h.c.meta, fileId = 'a'.repeat(30);
  h.sheet(h.c.meta.APP.pendingSheet).rows[1][COL.PHOTO_1 - 1] = 'https://drive.google.com/thumbnail?id=' + fileId;
  let requested = '';
  h.c.DriveApp = { getFileById: value => { requested = value; return { isTrashed: () => false, getDescription: () => h.c.meta.APP.name + ' | ' + id(1) + ' | FOTO_1', getBlob: () => ({ getBytes: () => [1, 2, 3], getContentType: () => 'image/jpeg' }) }; } };
  const token = h.fiscal().token, photo = h.c.getDocumentPhoto_({ token, recordId: id(1), photoIndex: 1, url: 'https://evil.test/other-file' }); assert.equal(photo.available, true); assert.equal(requested, fileId);
  h.c.DriveApp.getFileById = () => ({ isTrashed: () => false, getDescription: () => h.c.meta.APP.name + ' | ' + id(1) + ' | FOTO_1', getBlob: () => { h.grant('Fiscal A', ['MOSSORÓ']); return { getBytes: () => [1], getContentType: () => 'image/jpeg' }; } });
  assert.throws(() => h.c.getDocumentPhoto_({ token, recordId: id(1), photoIndex: 1 }), e => e.code === 'AUTH_REQUIRED');
});
test('foto com identidade de outro UUID ou slot é recusada antes de obter bytes', () => {
  const h = harness(); h.grant(); h.add(1); const { COL } = h.c.meta;
  h.sheet(h.c.meta.APP.pendingSheet).rows[1][COL.PHOTO_1 - 1] = 'https://drive.google.com/thumbnail?id=' + 'a'.repeat(30);
  let readBytes = false; const token = h.fiscal().token;
  for (const identity of [id(2) + ' | FOTO_1', id(1) + ' | FOTO_2']) {
    h.c.DriveApp = { getFileById: () => ({ isTrashed: () => false, getDescription: () => h.c.meta.APP.name + ' | ' + identity, getBlob: () => { readBytes = true; } }) };
    assert.equal(h.c.getDocumentPhoto_({ token, recordId: id(1), photoIndex: 1 }).available, false);
  }
  assert.equal(readBytes, false);
});
test('filtros, datas inválidas, status e número funcionam no escopo autorizado', () => {
  const h = harness(); h.grant(); h.add(1); h.add(2, { status: 'REPROVADA' }); const token = h.fiscal().token;
  assert.equal(h.c.listFiscalRecords_({ token, filters: { status: 'REPROVADA', search: 'O-2' } }).records.length, 1);
  assert.throws(() => h.c.listFiscalRecords_({ token, filters: { from: '2026-02-30' } }), e => e.code === 'INVALID_DATE');
});
test('provisionamento fiscal não é uma rota pública', () => { assert.equal(extract(backend, 'doPost').includes('configureFiscalAccount'), false); });
const fc = vm.createContext({ ...core, ApiError: class extends Error {} });
vm.runInContext(featureSource.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '') + '\nthis.pending = entryPendingRecords; this.top = topThreeMarkup; this.bars = barsMarkup;', fc);
test('notificação não mistura usuários e deduplica UUID', () => {
  const records = [{ recordId: id(1), user: 'Campo A', status: 'FOTOS_SENDO_SINCRONIZADAS' }, { recordId: id(1), user: 'Campo A', status: 'FOTOS_SENDO_SINCRONIZADAS' }, { recordId: id(2), user: 'Campo B', status: 'CORRECAO_SOLICITADA' }, { recordId: id(3), user: 'Campo A', status: 'CORRECAO_SOLICITADA' }];
  const r = fc.pending(records, 'Campo A'); assert.equal(r.photos.length, 1); assert.equal(r.corrections.length, 1);
});
test('nenhuma pendência e fotos confirmadas não geram aviso', () => {
  assert.equal(fc.pending([], 'Campo A').photos.length, 0); assert.equal(fc.pending([{ recordId: id(1), user: 'Campo A', status: 'AGUARDANDO_SUPERVISOR', photoStates: [{ photoIndex: 1, confirmed: true, serverUrl: 'fixture' }] }], 'Campo A').photos.length, 0);
});
test('correção resolvida não reabre aviso por um serverStatus local antigo', () => {
  const result = fc.pending([{ recordId: id(1), user: 'Campo A', status: 'AGUARDANDO_SUPERVISOR', serverStatus: 'CORRECAO_SOLICITADA' }], 'Campo A');
  assert.equal(result.corrections.length, 0);
});
test('TOP 3 e gráficos escapam texto e mostram SEM DADOS', () => {
  const html = fc.top({ month: '2026-10', top3: [{ crewLeader: '<script>Chefe</script>', team: 'LM', base: 'CAICÓ', count: 2, totalServices: 100 }] }); assert.equal(html.includes('<script>'), false);
  assert.match(fc.bars([{ label: 'CAICÓ', percentage: null, analysed: 0, nonconforming: 0 }], true), /SEM DADOS/);
});
const failures = []; let passed = 0;
for (const { name, run } of tests) { try { await run(); passed++; } catch (error) { failures.push({ name, error: error.stack }); } }
const result = { total: tests.length, passed, failed: failures.length, productionWrites: 0, failures };
console.log(JSON.stringify(result, null, 2)); if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2)); if (failures.length) process.exitCode = 1;
