// Cached-session renewal must not alter IndexedDB records, Blobs or upload keys.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as core from '../core.js';

const { IDBFactory, IDBKeyRange } = createRequire(import.meta.url)('fake-indexeddb');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const dbSource = await readFile(new URL('../db.js', import.meta.url), 'utf8');
const readSession = appSource.match(/function readSession\([^]*?\n\}/)[0];
const token = (user, role = 'field', exp = Date.now() + 60000) => Buffer.from(JSON.stringify({ user, role, exp }), 'utf8').toString('base64url') + '.fixture-signature';
const session = (user = 'José Simião', role = 'field') => ({ user, role, token: token(user, role) });
function runtime(value) {
  const values = new Map([['session', JSON.stringify(value)], ['last-user', value.user]]), calls = [];
  const c = vm.createContext({ ...core, indexedDB: new IDBFactory(), IDBKeyRange, Date, Blob, structuredClone, setTimeout, clearTimeout,
    SESSION_KEY: 'session', elements: { loginMessage: { textContent: '' } },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, item) => { calls.push('set'); values.set(key, item); }, removeItem: key => { calls.push('remove'); values.delete(key); } }
  });
  vm.runInContext(dbSource.replace(/^import[^;]*;\n/gm, '').replace(/^export (?:\{ DB_NAME \};|)/gm, '') + '\n' + readSession, c);
  return { c, values, calls };
}
const tests = [], test = (name, run) => tests.push({ name, run });
for (const role of ['field', 'supervisor', 'fiscal']) test(`${role}: sessão UTF-8 e sessão ASCII válida continuam utilizáveis`, () => {
  for (const user of ['José Simião', 'Pessoa ASCII', 'Joa\u0303o']) {
    const saved = session(user, role), h = runtime(saved);
    assert.equal(core.sessionIdentityMatches(saved), true);
    assert.equal(JSON.stringify(h.c.readSession()), JSON.stringify(saved));
    assert.deepEqual(h.calls, []);
  }
});
test('token legado corrompido pede novo login sem substituir ou apagar o cache pessoal', () => {
  const saved = { ...session(), token: token('Jos? Simi?o') }, h = runtime(saved), before = JSON.stringify([...h.values]);
  assert.equal(h.c.readSession(), null);
  assert.match(h.c.elements.loginMessage.textContent, /Entre novamente.*rascunhos e fotos continuam/);
  assert.deepEqual(h.calls, []); assert.equal(JSON.stringify([...h.values]), before);
});
test('perfil ou usuário divergente nunca vira uma sessão válida por normalização permissiva', () => {
  assert.equal(core.sessionIdentityMatches({ ...session(), role: 'supervisor' }), false);
  assert.equal(core.sessionIdentityMatches({ ...session(), user: 'Outra pessoa' }), false);
  assert.equal(core.sessionIdentityMatches({ ...session(), user: 'Jos? Simi?o' }), false);
});
test('payload ilegível, bytes UTF-8 inválidos e assinatura vazia não são aceitos pelo cache', () => {
  for (const value of ['', 'malformed', 'e30.', 'e30.fixture', Buffer.from([0xff, 0xfe]).toString('base64url') + '.fixture']) assert.equal(core.sessionIdentityMatches({ ...session(), token: value }), false);
});
test('sessão expirada conserva o comportamento de solicitar login', () => {
  const h = runtime({ ...session(), token: token('José Simião', 'field', Date.now() - 1000) });
  assert.equal(h.c.readSession(), null); assert.deepEqual(h.calls, []);
});
test('novo login pode substituir apenas a sessão após a renovação necessária', () => {
  const h = runtime({ ...session(), token: token('Jos? Simi?o') });
  assert.equal(h.c.readSession(), null);
  const renewed = session(); h.values.set('session', JSON.stringify(renewed));
  assert.equal(JSON.stringify(h.c.readSession()), JSON.stringify(renewed));
});
test('cinco Blobs, UUID, serviços, materiais e uploadKeys permanecem após rejeitar a sessão antiga', async () => {
  const h = runtime({ ...session(), token: token('Jos? Simi?o') });
  const id = '11111111-2222-4333-8444-555555555555';
  let record = await h.c.putRecord({ recordId: id, user: 'José Simião', status: core.RECORD_STATUS.SYNCING_PHOTOS,
    services: [{ code: 'S1', quantity: 1, totalValue: 123.45 }], materials: [{ code: '0001', quantity: 2 }], photoStates: core.normalizePhotoStates([]) });
  for (let index = 1; index <= 5; index++) {
    const result = await h.c.putPhotoAndRecord(record, index, new Blob([`fixture-photo-${index}`], { type: 'image/jpeg' }), `fixture-key-${index}`);
    record = result.record;
  }
  const before = JSON.stringify(await h.c.getRecord(id));
  assert.equal(h.c.readSession(), null);
  assert.equal(JSON.stringify(await h.c.getRecord(id)), before);
  const photos = await h.c.getPhotosForRecord(id);
  assert.equal(photos.length, 5);
  for (const photo of photos) {
    assert.equal(photo.uploadKey, `fixture-key-${photo.photoIndex}`);
    assert.equal(await photo.blob.text(), `fixture-photo-${photo.photoIndex}`);
  }
  assert.deepEqual(h.calls, []);
});
const failures = [];
for (const { name, run } of tests) try { await run(); } catch (error) { failures.push({ name, error: error.stack }); }
console.log(JSON.stringify({ total: tests.length, passed: tests.length - failures.length, failed: failures.length, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
