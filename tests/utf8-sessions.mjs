import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import vm from 'node:vm';
import { sameUser } from '../core.js';

const source = await readFile(process.argv[2] || new URL('../backend/Utf8Session20261106.gs', import.meta.url), 'utf8');
const extract = name => {
  const found = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(found, name);
  return found[0];
};
const UTF8 = Object.freeze({ toString: () => 'UTF_8' });
const secret = 'fixture-only-session-secret', nonce = 'fixture-nonce';
const hmac = body => createHmac('sha256', secret).update(body).digest('base64url');
const signed = data => { const body = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url'); return `${body}.${hmac(body)}`; };
function harness() {
  const encodings = [], decodings = [];
  const c = vm.createContext({ Date, JSON, Object, Number, String,
    signingSecret_: () => secret,
    constantTimeEquals_: (a, b) => {
      const left = Buffer.from(a), right = Buffer.from(b);
      return left.length === right.length && timingSafeEqual(left, right);
    },
    Utilities: {
      Charset: { UTF_8: UTF8 }, getUuid: () => nonce,
      base64EncodeWebSafe(value, charset) {
        if (typeof value === 'string') {
          encodings.push(charset);
          if (charset !== UTF8) value = value.replace(/[^\x00-\x7f]/g, '?');
        }
        return Buffer.from(value).toString('base64url');
      },
      base64DecodeWebSafe: value => [...Buffer.from(value, 'base64url')],
      computeHmacSha256Signature: (body, key) => [...createHmac('sha256', key).update(body).digest()],
      newBlob: value => ({ getDataAsString(charset) {
        assert.ok(charset === undefined || charset === 'UTF-8', 'Blob uses a charset string, not the Base64 enum');
        decodings.push(charset);
        return Buffer.from(value).toString('utf8');
      } })
    }
  });
  vm.runInContext(extract('createToken_') + '\n' + extract('verifyToken_'), c);
  return { c, encodings, decodings };
}
const tests = [], test = (name, run) => tests.push({ name, run });
for (const role of ['field', 'supervisor', 'fiscal']) {
  test(`${role}: identidade acentuada faz round-trip assinado UTF-8`, () => {
    const { c, encodings, decodings } = harness();
    for (const user of ['José Simião', 'João Marcelo', 'José Ângelo', 'Joa\u0303o', '李 José']) {
      const exp = Date.now() + 60000, token = c.createToken_(user, role, exp, 'acl-1'), data = c.verifyToken_(token);
      assert.equal(data?.user, user); assert.equal(data.role, role); assert.equal(data.exp, exp);
      assert.equal(data.nonce, nonce); assert.equal(data.aclRevision, role === 'fiscal' ? 'acl-1' : undefined);
    }
    assert.ok(encodings.every(charset => charset === UTF8));
    assert.ok(decodings.every(charset => charset === 'UTF-8'));
  });
  test(`${role}: formato e assinatura de nomes ASCII continuam idênticos`, () => {
    const { c } = harness(), exp = Date.now() + 60000;
    const payload = { user: 'Pessoa ASCII', role, exp, nonce, ...(role === 'fiscal' ? { aclRevision: 'acl-1' } : {}) };
    assert.equal(c.createToken_(payload.user, role, exp, 'acl-1'), signed(payload));
  });
}
test('tokens válidos preexistentes preservam identidade, ACL e expiração', () => {
  const { c } = harness();
  for (const [user, role] of [['Pessoa ASCII', 'field'], ['Supervisor ASCII', 'supervisor'], ['José Ângelo', 'fiscal'], ['Jos? Simi?o', 'field']]) {
    const data = { user, role, exp: Date.now() + 60000, nonce: 'old-nonce', ...(role === 'fiscal' ? { aclRevision: 'existing-acl' } : {}) };
    assert.equal(JSON.stringify(c.verifyToken_(signed(data))), JSON.stringify(data));
  }
});
test('assinatura adulterada, expiração e payload inválido permanecem bloqueados', () => {
  const { c } = harness(), exp = Date.now() + 60000, token = c.createToken_('José Simião', 'field', exp);
  const [, signature] = token.split('.');
  const changed = Buffer.from(JSON.stringify({ user: 'Outro usuário', role: 'supervisor', exp })).toString('base64url');
  assert.equal(c.verifyToken_(`${changed}.${signature}`), null);
  assert.equal(c.verifyToken_(token + '.extra'), null);
  assert.equal(c.verifyToken_(c.createToken_('José Simião', 'field', Date.now() - 1)), null);
  assert.equal(c.verifyToken_(signed({ role: 'field', exp })), null);
});
test('interrogação nunca vira curinga nem autoriza outra identidade', () => {
  assert.equal(sameUser('José Simião', 'Jos? Simi?o'), false);
  assert.equal(sameUser('José Simião', 'Outro usuário'), false);
  assert.equal(sameUser('José Simião', ' José Simião '), true);
});
const failures = [];
for (const { name, run } of tests) try { await run(); } catch (error) { failures.push({ name, error: error.stack }); }
console.log(JSON.stringify({ total: tests.length, passed: tests.length - failures.length, failed: failures.length, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
