// Public-module regression only. The official Apps Script router, signed-token
// verifier and publication engine are private and are not simulated as coverage.
// All accounts, rows, Drive files and mutations below are isolated fixtures.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const names = ['OperationalFeatures20261014', 'FiscalAdmin20261015', 'FiscalCorrections20261015'];
const moduleDirectory = process.argv.find(value => value.startsWith('--modules-dir='))?.slice(14);
let sources = await Promise.all(names.map(name => readFile(moduleDirectory
  ? moduleDirectory.replace(/\/$/, '') + '/' + name + '.gs' : new URL('backend/' + name + '.gs', root), 'utf8')));
const persistencePatch = await readFile(new URL('patches/backend-correction-persistence-20261006.patch', root), 'utf8');
const added = persistencePatch.split('\n').filter(line => (line.startsWith('+') && !line.startsWith('+++')) || line.startsWith(' ')).map(line => line.slice(1)).join('\n');
let confirmed = added.match(/function photoSlotConfirmed_\([^]*?\n\}/)?.[0];
assert.ok(confirmed, 'Use the existing receipt confirmation helper, not a replacement implementation.');
const officialPath = process.argv.find(value => value.startsWith('--official-source='))?.slice(18);
if (officialPath) {
  const official = await readFile(officialPath, 'utf8');
  const extract = name => {
    const start = official.indexOf('function ' + name + '('); assert.ok(start >= 0, 'Missing official function ' + name);
    const firstLine = official.slice(start).split('\n')[0];
    if (firstLine.trim().endsWith('}')) return firstLine;
    const end = official.indexOf('\n}', start); assert.ok(end > start, 'Missing official function boundary ' + name);
    return official.slice(start, end + 2);
  };
  sources = sources.map(source => [...source.matchAll(/^function (\w+)\(/gm)].map(match => extract(match[1])).join('\n'));
  confirmed = extract('photoSlotConfirmed_');
}
// Named columns are fixture-local. The test does not claim to validate the
// private production schema or any real sheet column order.
const columns = ['ID', 'USER', 'BASE', 'AUDIT', 'STATUS', 'REASON', 'SUPERVISOR_NOTE', 'TYPES', 'REGISTERED_AT', 'UPDATED_AT', 'OCCURRENCE_NUMBER', 'CONTRACT', 'TEAM', 'CREW_LEADER', 'TOTAL', 'SUPERVISOR', 'REVIEWED_AT', 'OTHER_TYPE'];
const COL = Object.fromEntries(columns.map((name, index) => [name, index + 1])); COL.WIDTH = 46;
const STATUS = { CORRECTION_REQUESTED: 'CORRECAO_SOLICITADA', WAITING_SUPERVISOR: 'AGUARDANDO_SUPERVISOR', PUBLISHED: 'PUBLICADA', REJECTED: 'REPROVADA', APPROVED: 'APROVADA', SYNCING_PHOTOS: 'FOTOS_SENDO_SINCRONIZADAS' };
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';
const plain = value => JSON.parse(JSON.stringify(value));
const password = 'fixture-password-only';
const tests = [], measurements = [], test = (name, run) => tests.push({ name, run });

function harness() {
  const props = new Map(), rows = [], history = [], stats = { propertyReads: 0, propertyWrites: 0, rowWrites: 0, locks: 0, sheetReads: 0 };
  const hash = value => createHash('sha256').update(String(value)).digest('hex');
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
  const c = vm.createContext({ Date, JSON, Math, Number, String, Array, Object,
    APP: { pendingSheet: 'fixture-pending', officialSheet: 'fixture-official', name: 'OCORRÊNCIAS B&Q', sessionHours: 8, maxPhotoBytes: 100000, timeZone: 'America/Bahia' }, COL, STATUS, TYPES: ['SUBSTITUIÇÃO DE TRAFO'],
    apiError_: (code, message) => Object.assign(new Error(message), { code }), normalize_: normalize,
    cleanText_: (value, max) => String(value ?? '').trim().slice(0, max), sha256_: hash,
    safeJson_: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
    nowIso_: () => '2026-10-18T12:00:00Z', todayOperational_: () => '2026-10-18',
    Utilities: { getUuid: randomUUID, newBlob: value => ({ getBytes: () => [...Buffer.from(value)] }), base64Encode: bytes => Buffer.from(bytes).toString('base64'), formatDate: date => new Date(date).toISOString().slice(0, 10) },
    constantTimeEquals_: (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)),
    PropertiesService: { getScriptProperties: () => ({ getProperty(key) { stats.propertyReads++; return props.get(key) ?? null; }, setProperty(key, value) { stats.propertyWrites++; props.set(key, value); } }) },
    LockService: { getScriptLock: () => ({ waitLock() { stats.locks++; }, releaseLock() { stats.locks--; } }) },
    requireUuid_: value => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) throw Object.assign(new Error('UUID inválido'), { code: 'INVALID_UUID' }); return value; },
    assertOwner_: (auth, owner) => { if (auth.role !== 'supervisor' && normalize(auth.user) !== normalize(owner)) throw Object.assign(new Error('Outro proprietário'), { code: 'FORBIDDEN' }); },
    photoUrlColumn_: index => 18 + Number(index), photoUploadKeyColumn_: index => 25 + Number(index),
    normalizePhotoIndexes_: values => [...new Set((values || []).map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= 7))].sort((a, b) => a - b),
    operationalStatusFromValues_: values => values[COL.STATUS - 1],
    correctionRequestedAt_: audit => audit.lastCorrectionRequest?.requestedAt,
    spreadsheet_: () => ({}), sheet_: () => rows, dataRows_: sheet => { stats.sheetReads++; return sheet.map(row => row.slice()); },
    uniqueCorrectionRow_: (sheet, recordId) => { const matches = sheet.map((values, index) => ({ values: values.slice(), row: index + 1 })).filter(item => item.values[0] === recordId); if (matches.length > 1) throw Object.assign(new Error('Duplicado'), { code: 'DUPLICATE_UUID' }); return matches[0] || null; },
    appendAuditTimeline_: (audit, action, actor, at, detail) => { (audit.timeline ||= []).push({ action, actor, at, detail }); },
    writeCorrectionAudit_: (sheet, found, audit) => { stats.rowWrites++; sheet[found.row - 1][COL.AUDIT - 1] = JSON.stringify(audit); return { row: found.row, values: sheet[found.row - 1].slice() }; },
    appendHistory_: (...args) => history.push(args),
    recordFromValuesAt_: values => ({ recordId: values[0], audit: JSON.parse(values[COL.AUDIT - 1]) }),
    isoValue_: value => String(value || ''), contractForBase_: () => 'fixture-contract',
    recordReadyForSupervisorValues_: () => true, roundMoney_: value => Math.round(value * 100) / 100
  });
  vm.runInContext(sources.join('\n') + '\n' + confirmed, c);
  // Tokens here are fixture handles. Real signature/expiry verification needs
  // the official source and is explicitly outside this harness's coverage.
  c.createToken_ = (user, role, exp, aclRevision) => ({ user, role, exp, aclRevision });
  c.requireSession_ = (token, roles) => {
    if (!token || !roles.includes(token.role) || token.exp < Date.now()) throw c.apiError_('AUTH_REQUIRED', 'Sessão inválida.');
    return token.role === 'fiscal' ? c.fiscalSession_(token) : token;
  };
  const h = { c, props, rows, history, stats };
  h.raw = () => JSON.parse(props.get('FISCAL_ACCOUNTS_V1') || '{}');
  h.grant = (user = 'Fiscal A', bases = ['CAICÓ'], extra = {}) => { const accounts = h.raw(); accounts[c.fiscalAccountKey_(user)] = { user, bases, kind: 'fiscal', active: true, salt: 'a'.repeat(64), passwordHash: hash('a'.repeat(64) + '\n' + password), revision: randomUUID(), ...extra }; props.set('FISCAL_ACCOUNTS_V1', JSON.stringify(accounts)); return accounts[c.fiscalAccountKey_(user)]; };
  h.login = (user = 'Fiscal A') => c.loginFiscal_({ user, password }).token;
  h.master = () => { h.grant('Fiscal Mestre', c.fiscalOfficialBases_(), { kind: 'master' }); return h.login('Fiscal Mestre'); };
  h.route = (extra = {}) => ({ routingVersion: 'FISCAL_ASSIGNED', routingRequestId: randomUUID(), assignmentRevision: randomUUID(), assignmentStatus: 'ASSIGNED', assignedFiscal: 'Fiscal A', base: 'CAICÓ', requestedAt: '2026-10-17T12:00:00Z', ...extra });
  h.add = (n = 1, extra = {}) => {
    const row = Array(46).fill(''), route = h.route(extra.route), audit = { lastCorrectionRequest: route, timeline: [], ...extra.audit };
    const values = { ID: id(n), USER: 'Campo A', BASE: extra.base || 'CAICÓ', AUDIT: JSON.stringify(audit), STATUS: extra.status || STATUS.CORRECTION_REQUESTED, TYPES: 'PODA', REGISTERED_AT: '2026-10-17T12:00:00Z', OCCURRENCE_NUMBER: '0001', TOTAL: 100 };
    Object.keys(values).forEach(key => row[COL[key] - 1] = values[key]); rows.push(row); return { row, route, audit };
  };
  h.assign = (fixture, token, user = 'Fiscal B') => c.reassignFiscalCorrection_({ token, recordId: fixture.row[0], assignedFiscal: user, routingRequestId: fixture.route.routingRequestId, expectedRevision: fixture.route.assignmentRevision });
  return h;
}

test('P1 staged upload remains requested after fiscal transfer', () => {
  const h = harness(); h.grant(); h.grant('Fiscal B'); const token = h.master(), f = h.add(), key = randomUUID();
  const receipt = { requestId: randomUUID(), requestedAt: f.route.requestedAt, phase: 'DATA_VERIFIED', dataVerifiedAt: '2026-10-17T13:00:00Z', photoPatch: { 1: { uploadKey: key } } };
  f.audit.lastCorrectionSubmission = receipt;
  f.audit.photoSubmissions = { 1: { phase: 'STAGED', uploadKey: key, expectedUrl: 'https://fixture.test/staged.jpg' } };
  f.row[h.c.photoUrlColumn_(1) - 1] = 'https://fixture.test/staged.jpg'; f.row[h.c.photoUploadKeyColumn_(1) - 1] = key; f.row[COL.AUDIT - 1] = JSON.stringify(f.audit);
  assert.equal(h.c.photoSlotConfirmed_(f.row, f.audit, 1), false);
  h.assign(f, token); const saved = JSON.parse(f.row[COL.AUDIT - 1]);
  assert.ok(saved.requestedPhotoIndexes.includes(1), 'URL and key alone cannot prove a STAGED upload is confirmed.');
  assert.deepEqual(plain(saved.transferredCorrectionSubmissions[0]), receipt); assert.equal(saved.lastCorrectionSubmission, undefined);
  assert.equal(f.row[h.c.photoUrlColumn_(1) - 1], 'https://fixture.test/staged.jpg');
  assert.throws(() => h.c.authorizeFiscalCorrection_(h.c.requireSession_(h.login(), ['fiscal']), f.row, f.route, false), error => error.code === 'FORBIDDEN');
  assert.equal(h.stats.locks, 0);
});
for (const index of [1, 5, 6, 7]) test(`transfer preserves confirmed slot ${index} and requests only unfinished evidence`, () => {
  const h = harness(); h.grant(); h.grant('Fiscal B'); const token = h.master(), f = h.add(), key = randomUUID(), url = 'https://fixture.test/confirmed-' + index;
  f.audit.lastCorrectionSubmission = { requestId: randomUUID(), requestedAt: f.route.requestedAt, phase: 'DATA_VERIFIED', photoPatch: index <= 5 ? { [index]: { uploadKey: key } } : {}, evidencePatch: index > 5 ? { [index]: { uploadKey: key } } : {} };
  f.audit.photoSubmissions = { [index]: { phase: 'COMPLETE', expectedUrl: url, uploadKey: key } }; f.row[h.c.photoUrlColumn_(index) - 1] = url; f.row[h.c.photoUploadKeyColumn_(index) - 1] = key; f.row[COL.AUDIT - 1] = JSON.stringify(f.audit);
  h.assign(f, token); const saved = JSON.parse(f.row[COL.AUDIT - 1]); assert.equal(saved.requestedPhotoIndexes.includes(index), false); assert.equal(f.row[h.c.photoUrlColumn_(index) - 1], url);
});
for (const condition of ['missing-url', 'wrong-key', 'wrong-url']) test('transfer preserves requested slot on ' + condition, () => {
  const h = harness(); h.grant(); h.grant('Fiscal B'); const token = h.master(), f = h.add(), key = randomUUID();
  f.audit.lastCorrectionSubmission = { requestedAt: f.route.requestedAt, phase: 'DATA_VERIFIED', photoPatch: { 2: { uploadKey: key } } };
  f.audit.photoSubmissions = { 2: { phase: 'COMPLETE', expectedUrl: 'expected', uploadKey: key } }; f.row[h.c.photoUrlColumn_(2) - 1] = condition === 'missing-url' ? '' : condition === 'wrong-url' ? 'different' : 'expected'; f.row[h.c.photoUploadKeyColumn_(2) - 1] = condition === 'wrong-key' ? randomUUID() : key; f.row[COL.AUDIT - 1] = JSON.stringify(f.audit);
  h.assign(f, token); assert.ok(JSON.parse(f.row[COL.AUDIT - 1]).requestedPhotoIndexes.includes(2));
});
test('P2 correction list uses one account snapshot for 25 projections', () => {
  const h = harness(); h.grant(); for (let i = 1; i <= 25; i++) h.add(i); const token = h.login(); h.stats.propertyReads = 0;
  const result = h.c.listFiscalCorrections_({ token }); assert.equal(result.records.length, 25); assert.ok(result.records.every(record => record.canCorrect));
  measurements.push({ scenario: '25 fiscal correction records', accountPropertyReads: h.stats.propertyReads, sheetReads: h.stats.sheetReads });
  assert.ok(h.stats.propertyReads <= 3, 'Account service reads must not scale as two per record: ' + h.stats.propertyReads);
});
for (const action of ['listFiscalCorrections_', 'listFiscalRecords_']) test('P1 revocation during sheet read blocks response in ' + action, () => {
  const h = harness(); h.grant(); h.add(); const token = h.login(), original = h.c.dataRows_; let changed = false;
  h.c.dataRows_ = sheet => { const result = original(sheet); if (!changed) { changed = true; h.grant('Fiscal A', ['MOSSORÓ']); } return result; };
  assert.throws(() => h.c[action]({ token, filters: { period: 'all' } }), error => error.code === 'AUTH_REQUIRED');
  assert.equal(h.stats.rowWrites, 0);
});
test('P1 revocation during document material read blocks export response', () => {
  const h = harness(); h.grant(); const f = h.add(), token = h.login();
  h.c.findAcrossMainSheets_ = () => ({ values: f.row.slice() });
  h.c.occurrenceDocumentData_ = () => { h.grant('Fiscal A', ['MOSSORÓ']); return { recordId: f.row[0], observation: 'restricted fixture' }; };
  assert.throws(() => h.c.getOccurrenceDocument_({ token, recordId: f.row[0] }), error => error.code === 'AUTH_REQUIRED');
});
test('legacy correction route remains legacy and complete route avoids account lookup', () => {
  const h = harness(); assert.deepEqual(plain(h.c.fiscalCorrectionProjection_({ lastCorrectionRequest: { requestedAt: 'old' } })), { routingVersion: 'LEGACY_FIELD' });
  h.stats.propertyReads = 0; assert.equal(h.c.fiscalCorrectionProjection_({ lastCorrectionRequest: h.route({ assignmentStatus: 'COMPLETE' }) }).assignmentStatus, 'COMPLETE'); assert.equal(h.stats.propertyReads, 0);
});
test('ambiguous or revoked recipient waits for explicit assignment', () => {
  const h = harness(); h.grant(); h.grant('Fiscal B'); const route = h.c.newFiscalCorrectionRoute_({}, 'CAICÓ'); assert.equal(route.assignmentStatus, 'WAITING_ASSIGNMENT');
  assert.equal(h.c.fiscalCorrectionProjection_({ lastCorrectionRequest: h.route({ assignedFiscal: 'Revogado' }) }).assignmentStatus, 'WAITING_ASSIGNMENT');
});
for (const role of ['field', 'supervisor', 'fiscal']) test(role + ' cannot manage fiscal accounts', () => {
  const h = harness(); h.grant(); const token = role === 'fiscal' ? h.login() : { role, user: 'Intruso', exp: Date.now() + 60000 }; const before = [...h.props];
  for (const action of ['listFiscalAccounts_', 'saveFiscalAccount_', 'changeFiscalMasterPassword_']) assert.throws(() => h.c[action]({ token, canManageFiscals: true, kind: 'master' }), error => ['FORBIDDEN', 'AUTH_REQUIRED'].includes(error.code));
  assert.deepEqual([...h.props], before);
});
test('base change, inactive account and revision change revoke old fiscal fixture sessions', () => {
  const h = harness(); h.grant(); const token = h.login(); h.grant('Fiscal A', ['MOSSORÓ']); assert.throws(() => h.c.requireSession_(token, ['fiscal']), error => error.code === 'AUTH_REQUIRED');
  h.grant('Fiscal A', ['CAICÓ'], { active: false }); assert.throws(() => h.login(), error => error.code === 'INVALID_CREDENTIALS');
});
test('master creation ignores client privilege fields and returns no credential material', () => {
  const h = harness(), token = h.master(); const response = h.c.saveFiscalAccount_({ token, mode: 'create', user: 'Fiscal Criado', active: true, bases: ['CAICÓ'], password, kind: 'master', canManageFiscals: true, salt: 'client', passwordHash: '0'.repeat(64) });
  assert.equal(h.raw()[h.c.fiscalAccountKey_('Fiscal Criado')].kind, 'fiscal'); assert.doesNotMatch(JSON.stringify(response), /passwordHash|salt|fixture-password/); assert.equal(h.login('Fiscal Criado').role, 'fiscal');
});
test('stale account revision cannot overwrite concurrent account update', () => {
  const h = harness(), token = h.master(), account = h.grant(); h.c.saveFiscalAccount_({ token, mode: 'update', user: account.user, active: true, bases: ['MOSSORÓ'], expectedRevision: account.revision }); const before = [...h.props];
  assert.throws(() => h.c.saveFiscalAccount_({ token, mode: 'update', user: account.user, active: true, bases: ['CAICÓ'], expectedRevision: account.revision }), error => error.code === 'FISCAL_CONFLICT'); assert.deepEqual([...h.props], before); assert.equal(h.stats.locks, 0);
});
test('authorization is rechecked after acquiring fiscal management lock', () => {
  const h = harness(), token = h.master(); h.c.LockService.getScriptLock = () => ({ waitLock() { h.grant('Fiscal Mestre', ['CAICÓ'], { kind: 'master' }); }, releaseLock() {} });
  assert.throws(() => h.c.saveFiscalAccount_({ token, mode: 'create', user: 'Forbidden', active: true, bases: ['CAICÓ'], password }), error => error.code === 'AUTH_REQUIRED'); assert.equal(h.raw()[h.c.fiscalAccountKey_('Forbidden')], undefined);
});
test('fiscal may open only current assigned correction in an authorized Base', () => {
  const h = harness(); h.grant(); const f = h.add(), auth = h.c.requireSession_(h.login(), ['fiscal']); assert.equal(h.c.authorizeFiscalCorrection_(auth, f.row, f.route, false).assignedFiscal, 'Fiscal A');
  assert.throws(() => h.c.authorizeFiscalCorrection_(auth, f.row, { ...f.route, assignmentRevision: randomUUID() }, false), error => error.code === 'FISCAL_ASSIGNMENT_CHANGED');
  f.row[COL.BASE - 1] = 'MOSSORÓ'; assert.throws(() => h.c.authorizeFiscalCorrection_(auth, f.row, f.route, false), error => error.code === 'FORBIDDEN');
});
test('original Campo cannot write newly assigned correction', () => {
  const h = harness(); h.grant(); const f = h.add(); assert.throws(() => h.c.authorizeCorrectionWrite_({ role: 'field', user: 'Campo A' }, f.row, f.route, true), error => error.code === 'FISCAL_CORRECTION_REQUIRED');
});
test('fiscal upload requires verified receipt plus exact UUID assignment, slot and uploadKey', () => {
  const h = harness(); h.grant(); const f = h.add(), key = randomUUID(), auth = h.c.requireSession_(h.login(), ['fiscal']);
  f.audit.lastCorrectionSubmission = { routingRequestId: f.route.routingRequestId, assignmentRevision: f.route.assignmentRevision, dataVerifiedAt: 'fixture-verified', photoPatch: { 3: { uploadKey: key } } }; f.row[COL.AUDIT - 1] = JSON.stringify(f.audit);
  h.c.authorizeCorrectionPhoto_(auth, f.row, { fiscalCorrection: f.route, photoIndex: 3, uploadKey: key });
  for (const changed of [{ photoIndex: 2, uploadKey: key }, { photoIndex: 3, uploadKey: randomUUID() }]) assert.throws(() => h.c.authorizeCorrectionPhoto_(auth, f.row, { fiscalCorrection: f.route, ...changed }), error => error.code === 'CORRECTION_DATA_UNCONFIRMED');
});
test('reassignment with stale revision or duplicate UUID performs zero writes', () => {
  const h = harness(); h.grant(); h.grant('Fiscal B'); const token = h.master(), f = h.add();
  assert.throws(() => h.assign({ ...f, route: { ...f.route, assignmentRevision: randomUUID() } }, token), error => error.code === 'FISCAL_ASSIGNMENT_CHANGED'); assert.equal(h.stats.rowWrites, 0);
  h.rows.push(f.row.slice()); assert.throws(() => h.assign(f, token), error => error.code === 'DUPLICATE_UUID'); assert.equal(h.stats.rowWrites, 0); assert.equal(h.stats.locks, 0);
});
test('repeated assignment is idempotent and never touches another UUID', () => {
  const h = harness(); h.grant(); h.grant('Fiscal B'); const token = h.master(), f = h.add(), other = h.add(2), before = other.row.slice();
  const first = h.assign(f, token), current = JSON.parse(f.row[COL.AUDIT - 1]).lastCorrectionRequest;
  const second = h.c.reassignFiscalCorrection_({ token, recordId: f.row[0], assignedFiscal: 'Fiscal B', routingRequestId: current.routingRequestId, expectedRevision: current.assignmentRevision });
  assert.equal(first.success, true); assert.equal(second.idempotent, true); assert.equal(h.stats.rowWrites, 1); assert.equal(h.history.length, 1); assert.deepEqual(other.row, before);
});

const failures = [];
for (const { name, run } of tests) { try { await run(); } catch (error) { failures.push({ name, error: error.stack }); } }
const result = { scope: 'public Apps Script modules with isolated service fixtures; no official router/token/publication coverage', total: tests.length, passed: tests.length - failures.length, failed: failures.length, productionWrites: 0, measurements, failures };
console.log(JSON.stringify(result, null, 2));
const output = process.argv.find(value => value.startsWith('--output=')); if (output) await writeFile(output.slice(9), JSON.stringify(result, null, 2) + '\n');
if (failures.length) process.exitCode = 1;
