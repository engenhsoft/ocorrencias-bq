import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const backend = await readFile(process.argv[2], 'utf8');
const [persistenceTests, featureTests, coreSource] = await Promise.all(['tests/correction-persistence.mjs', 'tests/operational-features.mjs', 'core.js'].map(name => readFile(new URL('../' + name, import.meta.url), 'utf8')));
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const extract = (s, name) => { const m = s.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(m, name); return m[0]; };
const factory = vm.runInNewContext(persistenceTests.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(persistenceTests, 'harness') + '\nharness', { vm, backend, createHash, assert, core });
const baseHarness = vm.runInNewContext(extract(featureTests, 'harness') + '\nharness', { factory, vm, extract, backend, createHash, createHmac, randomUUID, Buffer, Map, Date, id: n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111` });
const plain = x => JSON.parse(JSON.stringify(x));
const secret = 'fixture-master-password';
function harness() {
  const h = baseHarness();
  h.c.Utilities.newBlob = value => ({ getBytes: () => [...Buffer.from(value)], getDataAsString: () => Buffer.from(value).toString('utf8') });
  h.masterConfig = { user: 'Fiscal Mestre', salt: 'b'.repeat(64), passwordHash: createHash('sha256').update('b'.repeat(64) + '\n' + secret).digest('hex') };
  h.c.configureFiscalMaster_(h.masterConfig);
  h.login = () => h.c.loginFiscal_({ user: 'Fiscal Mestre', password: secret });
  h.token = h.login().token;
  h.create = (values = {}) => h.c.saveFiscalAccount_({ token: h.token, mode: 'create', user: 'Fiscal Novo', password: 'fixture-new-password', bases: ['CAICÓ'], active: true, ...values });
  h.list = () => h.c.listFiscalAccounts_({ token: h.token });
  h.raw = () => JSON.parse(h.props.get('FISCAL_ACCOUNTS_V1'));
  return h;
}
const tests = [], test = (name, run) => tests.push({ name, run });
test('mestra entra pela aba Fiscal com seis Bases e gestão autorizada pelo servidor', () => {
  const h = harness(), login = h.login(); assert.equal(login.role, 'fiscal'); assert.equal(login.canManageFiscals, true); assert.equal(login.bases.length, 6);
  assert.equal(h.c.requireSession_(login.token, ['fiscal']).canManageFiscals, true); assert.equal(h.list().accounts.length, 0);
});
test('cadastro cria senha individual e não retorna salt/hash ou senha', () => {
  const h = harness(), saved = h.create(); assert.deepEqual(plain(saved.account.bases), ['CAICÓ']);
  const login = h.c.loginFiscal_({ user: 'Fiscal Novo', password: 'fixture-new-password' }); assert.equal(login.canManageFiscals, false);
  const json = JSON.stringify([saved, h.list(), login]); for (const value of ['passwordHash', 'salt', secret, 'fixture-new-password']) assert.equal(json.includes(value), false);
});
for (const role of ['field', 'supervisor', 'fiscal']) test(role + ' não pode listar, criar, editar ou alterar senha mestra', () => {
  const h = harness(); h.grant(); const token = role === 'fiscal' ? h.fiscal().token : h.c.createToken_('Outro', role, Date.now() + 60000);
  const before = h.props.get('FISCAL_ACCOUNTS_V1');
  for (const method of ['listFiscalAccounts_', 'saveFiscalAccount_', 'changeFiscalMasterPassword_']) assert.throws(() => h.c[method]({ token, canManageFiscals: true, role: 'master', user: 'Outro', active: true, bases: ['CAICÓ'], mode: 'create', password: 'fixture-password' }), e => ['AUTH_REQUIRED', 'FORBIDDEN'].includes(e.code));
  assert.equal(h.props.get('FISCAL_ACCOUNTS_V1'), before);
});
test('nome duplicado normalizado não sobrescreve senha ou Bases', () => {
  const h = harness(); h.create(); const before = h.props.get('FISCAL_ACCOUNTS_V1');
  assert.throws(() => h.create({ user: ' fiscal novo ' }), e => e.code === 'FISCAL_EXISTS'); assert.equal(h.props.get('FISCAL_ACCOUNTS_V1'), before);
});
test('edição conserva senha, muda Bases e revoga sessão anterior imediatamente', () => {
  const h = harness(), saved = h.create().account, login = h.c.loginFiscal_({ user: saved.user, password: 'fixture-new-password' });
  h.c.saveFiscalAccount_({ token: h.token, mode: 'update', user: saved.user, active: true, bases: ['MOSSORÓ', 'ASSÚ'], expectedRevision: saved.revision });
  assert.throws(() => h.c.listFiscalRecords_({ token: login.token }), e => e.code === 'AUTH_REQUIRED');
  const next = h.c.loginFiscal_({ user: saved.user, password: 'fixture-new-password' }); assert.deepEqual(plain(next.bases), ['MOSSORÓ', 'ASSÚ']);
});
test('revisão antiga impede sobrescrever uma edição concorrente', () => {
  const h = harness(), saved = h.create().account;
  h.c.saveFiscalAccount_({ token: h.token, mode: 'update', user: saved.user, active: true, bases: ['ASSÚ'], expectedRevision: saved.revision });
  const before = h.props.get('FISCAL_ACCOUNTS_V1');
  assert.throws(() => h.c.saveFiscalAccount_({ token: h.token, mode: 'update', user: saved.user, active: true, bases: ['MOSSORÓ'], expectedRevision: saved.revision }), e => e.code === 'FISCAL_CONFLICT');
  assert.equal(h.props.get('FISCAL_ACCOUNTS_V1'), before);
});
test('desativação e redefinição de senha revogam tokens e credenciais anteriores', () => {
  const h = harness(), saved = h.create().account, login = h.c.loginFiscal_({ user: saved.user, password: 'fixture-new-password' });
  const disabled = h.c.saveFiscalAccount_({ token: h.token, mode: 'update', user: saved.user, active: false, bases: saved.bases, expectedRevision: saved.revision }).account;
  assert.throws(() => h.c.loginFiscal_({ user: saved.user, password: 'fixture-new-password' }), e => e.code === 'INVALID_CREDENTIALS');
  assert.throws(() => h.c.listFiscalRecords_({ token: login.token }), e => e.code === 'AUTH_REQUIRED');
  h.c.saveFiscalAccount_({ token: h.token, mode: 'update', user: saved.user, password: 'fixture-reset-password', active: true, bases: saved.bases, expectedRevision: disabled.revision });
  assert.throws(() => h.c.loginFiscal_({ user: saved.user, password: 'fixture-new-password' }), e => e.code === 'INVALID_CREDENTIALS');
  assert.equal(h.c.loginFiscal_({ user: saved.user, password: 'fixture-reset-password' }).canManageFiscals, false);
});
test('payload não pode promover fiscal nem substituir credenciais por hash fornecido', () => {
  const h = harness(); h.create({ kind: 'master', canManageFiscals: true, salt: 'attacker', passwordHash: '0'.repeat(64) });
  const account = h.raw()[h.c.fiscalAccountKey_('Fiscal Novo')]; assert.equal(account.kind, 'fiscal'); assert.notEqual(account.salt, 'attacker');
});
test('conta mestra não pode ser sobrescrita, desativada ou duplicada pelo cadastro de fiscais', () => {
  const h = harness(), before = h.props.get('FISCAL_ACCOUNTS_V1');
  assert.throws(() => h.create({ user: 'Fiscal Mestre' }), e => e.code === 'FORBIDDEN');
  assert.throws(() => h.c.configureFiscalAccount_({ ...h.masterConfig, bases: ['CAICÓ'] }), e => e.code === 'FORBIDDEN');
  assert.throws(() => h.c.configureFiscalMaster_({ ...h.masterConfig, user: 'Segunda Mestra' }), e => e.code === 'FISCAL_MASTER_EXISTS');
  assert.equal(h.props.get('FISCAL_ACCOUNTS_V1'), before);
});
test('Bases inexistentes, sem Bases e senha fraca não gravam cadastros', () => {
  const h = harness(), before = h.props.get('FISCAL_ACCOUNTS_V1');
  for (const values of [{ bases: [] }, { bases: ['EXTERNA'] }, { password: '123' }, { password: {} }, { active: 'true' }]) assert.throws(() => h.create(values));
  assert.equal(h.props.get('FISCAL_ACCOUNTS_V1'), before);
});
test('autorização mestra é revalidada dentro do lock antes de escrever', () => {
  const h = harness(), before = h.raw();
  h.c.LockService.getScriptLock = () => ({ waitLock() { const accounts = h.raw(); accounts[h.c.fiscalAccountKey_('Fiscal Mestre')].revision = 'revoked'; h.props.set('FISCAL_ACCOUNTS_V1', JSON.stringify(accounts)); }, releaseLock() {} });
  assert.throws(() => h.create(), e => e.code === 'AUTH_REQUIRED'); assert.equal(Object.keys(h.raw()).length, Object.keys(before).length);
});
test('alteração de senha mestra exige senha atual e invalida as sessões', () => {
  const h = harness(), before = h.props.get('FISCAL_ACCOUNTS_V1');
  assert.throws(() => h.c.changeFiscalMasterPassword_({ token: h.token, currentPassword: 'errada', newPassword: 'fixture-replaced-password' }), e => e.code === 'INVALID_CREDENTIALS');
  assert.equal(h.props.get('FISCAL_ACCOUNTS_V1'), before);
  assert.equal(h.c.changeFiscalMasterPassword_({ token: h.token, currentPassword: secret, newPassword: 'fixture-replaced-password' }).loginRequired, true);
  assert.throws(() => h.list(), e => e.code === 'AUTH_REQUIRED'); assert.throws(() => h.login(), e => e.code === 'INVALID_CREDENTIALS');
  assert.equal(h.c.loginFiscal_({ user: 'Fiscal Mestre', password: 'fixture-replaced-password' }).canManageFiscals, true);
});
test('master continua sem acesso aos endpoints de modificação operacional', () => {
  const h = harness(); for (const method of ['submitRecord_', 'uploadPhoto_', 'supervisorAction_', 'approveBatch_', 'supervisorCorrectRecord_']) assert.throws(() => h.c[method]({ token: h.token }), e => ['AUTH_REQUIRED', 'FORBIDDEN'].includes(e.code));
});
test('limite das propriedades é verificado antes de qualquer alteração', () => {
  const h = harness(), accounts = h.raw(); accounts[h.c.fiscalAccountKey_('Fiscal Mestre')].legacyNote = 'x'.repeat(8100); h.props.set('FISCAL_ACCOUNTS_V1', JSON.stringify(accounts));
  const before = h.props.get('FISCAL_ACCOUNTS_V1'); assert.throws(() => h.create(), e => e.code === 'FISCAL_CAPACITY'); assert.equal(h.props.get('FISCAL_ACCOUNTS_V1'), before);
});
test('bootstrap privado não está em doPost e rotas administrativas exigem sessão', () => {
  const routes = extract(backend, 'doPost'); assert.equal(routes.includes('configureFiscalMaster'), false); assert.equal(routes.includes('configureFiscalAccount'), false);
  for (const name of ['listFiscalAccounts', 'saveFiscalAccount', 'changeFiscalMasterPassword']) assert.ok(routes.includes(name));
});
let passed = 0; const failures = [];
for (const { name, run } of tests) { try { await run(); passed++; } catch (error) { failures.push({ name, error: error.stack }); } }
const result = { total: tests.length, passed, failed: failures.length, productionWrites: 0, failures };
console.log(JSON.stringify(result, null, 2)); if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2)); if (failures.length) process.exitCode = 1;
