import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

if (!process.argv[2] || !process.argv[3]) throw Error('Informe backend corrigido e baseline 2026.10.06.3.');
const [fixed, baseline, loginTest, profileTest] = await Promise.all([
  readFile(process.argv[2], 'utf8'), readFile(process.argv[3], 'utf8'),
  readFile(new URL('./login-initial-load.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./initial-load-profile.mjs', import.meta.url), 'utf8')
]);
const extract = (s, name) => { const m = s.match(new RegExp('function ' + name + '\\([^]*?\\n\\}')); assert.ok(m, name); return m[0]; };
const backendHarness = vm.runInNewContext(loginTest.match(/class Sheet \{[^]*?\n\}/)[0] + '\n' + extract(loginTest, 'backendHarness') + '\nbackendHarness', { vm, Date, Map, console });
const harness = vm.runInNewContext(extract(profileTest, 'harness') + '\nharness', { backendHarness, Map });
const plain = v => JSON.parse(JSON.stringify(v));
const tests = []; const test = (name, run) => tests.push({ name, run });

function response(parts, outerCode = 200, type = 'multipart/mixed; boundary="fixture_boundary"') {
  return { getResponseCode: () => outerCode, getHeaders: () => ({ 'cOnTeNt-TyPe': type }), getContentText: () => parts.map(p =>
    '--fixture_boundary\r\nContent-Type: application/http\r\nContent-ID: <response-bq-' + p.index + '>\r\n\r\nHTTP/1.1 ' + (p.status || 200) + ' OK\r\nContent-Type: application/json\r\n\r\n' + (p.raw || JSON.stringify(p.body)) + '\r\n'
  ).join('') + '--fixture_boundary--\r\n' };
}
function installApi(h, fault) {
  const calls = { waves: [], ids: [], cacheWrites: [], tokens: 0 };
  h.c.ScriptApp = { getOAuthToken() { calls.tokens++; return 'fixture-token'; } };
  const originalCache = h.c.CacheService.getScriptCache;
  h.c.CacheService.getScriptCache = () => ({ ...originalCache(), putAll(values, ttl) {
    calls.cacheWrites.push({ keys: Object.keys(values), ttl });
    if (fault === 'cache-write') throw Error('cache unavailable');
    for (const [key, value] of Object.entries(values)) h.cache.set(key, value);
  } });
  h.c.UrlFetchApp = { fetchAll(requests) {
    calls.waves.push(requests.length);
    if (fault === 'network') throw Error('timeout');
    return requests.map(req => {
      assert.equal(req.url, 'https://www.googleapis.com/batch/drive/v3');
      assert.equal(req.method, 'post'); assert.equal(req.followRedirects, false); assert.equal(req.timeoutSeconds, 10);
      assert.equal(req.headers.Authorization, 'Bearer fixture-token');
      const ids = [...req.payload.matchAll(/GET \/drive\/v3\/files\/([^?]+)\?fields=([^ ]+) HTTP\/1\.1/g)].map(m => {
        assert.equal(decodeURIComponent(m[2]), 'id,permissions(type,allowFileDiscovery)&supportsAllDrives=true');
        return decodeURIComponent(m[1]);
      });
      assert.ok(ids.length <= 100); assert.ok(ids.length > 0); calls.ids.push(...ids);
      assert.equal((req.payload.match(/GET /g) || []).length, ids.length);
      const parts = ids.map((id, index) => {
        const permission = h.permissions.get(id) === 'PRIVATE' ? { type: 'user' } : { type: 'anyone', allowFileDiscovery: false };
        const body = { id, permissions: [permission] }; let status = 200;
        if (fault === 'private-result') body.permissions = [{ type: 'user' }];
        if (fault === 'discoverable') permission.allowFileDiscovery = true;
        if (fault === 'missing-discovery') delete permission.allowFileDiscovery;
        if (fault === 'missing-permissions') delete body.permissions;
        if (fault === 'wrong-id') body.id = 'unrequested_abcdefghijklmnopqrstuvwxyz';
        if (fault === 'partial' && index % 2) status = 403;
        if (fault === 'broken') status = 404;
        return { index, body, status, ...(fault === 'invalid-json' ? { raw: '{malformed' } : {}) };
      }).reverse(); // Correlate Content-ID; never depend on response order.
      return response(parts, fault === 'outer-error' ? 503 : 200, fault === 'boundary' ? 'application/json' : undefined);
    });
  } };
  return calls;
}
function compare(mode, fault) {
  const before = harness(baseline, mode), after = harness(fixed, mode);
  const calls = installApi(after, fault);
  const oldPayload = before.c.listPending_({ token: 'fixture' }), payload = after.c.listPending_({ token: 'fixture' });
  assert.equal(JSON.stringify(payload), JSON.stringify(oldPayload));
  assert.equal(after.counts().writes, 0); assert.equal(after.counts().opens, 1); assert.equal(after.counts().dataReads, 2);
  return { before, after, calls, payload };
}

test('cache vazio: 235 consultas Drive sequenciais substituídas por três lotes numa onda, payload idêntico', () => {
  const { before, after, calls } = compare('cold');
  assert.equal(before.calls.drive, 235); assert.equal(after.calls.drive, 0); assert.equal(after.calls.individualCache, 0);
  assert.deepEqual(calls.waves, [3]); assert.equal(calls.ids.length, 235); assert.equal(new Set(calls.ids).size, 235);
  assert.equal(after.calls.sharing, 0); assert.equal(calls.cacheWrites.length, 1); assert.equal(calls.cacheWrites[0].ttl, 21600);
  assert.ok(calls.cacheWrites[0].keys.every(k => k.startsWith('photo-public-')));
  after.c.listPending_({ token: 'fixture' }); assert.deepEqual(calls.waves, [3]);
});
test('cache cheio não chama API, token ou gravação de cache', () => {
  const { after, calls } = compare('warm'); assert.deepEqual(calls.waves, []); assert.equal(calls.tokens, 0);
  assert.equal(after.calls.drive, 0); assert.equal(calls.cacheWrites.length, 0);
});
test('cache misto consulta apenas referências faltantes, sem repetir UUID ou foto', () => {
  const { after, calls } = compare('partial'); assert.ok(calls.ids.length > 0 && calls.ids.length < 235);
  assert.equal(new Set(calls.ids).size, calls.ids.length); assert.equal(after.calls.drive, 0);
});
test('cache getAll indisponível ainda pode confirmar metadados com segurança', () => {
  const { after } = compare('batch-error'); assert.equal(after.calls.drive, 0);
});
test('cache putAll indisponível conserva confirmações na resposta corrente', () => {
  const { after } = compare('cold', 'cache-write'); assert.equal(after.calls.drive, 0); assert.equal(after.calls.sharing, 0);
});
test('arquivos privados seguem exatamente a regra de compartilhamento preexistente', () => {
  const { before, after } = compare('private'); assert.equal(after.calls.drive, 235); assert.equal(after.calls.sharing, before.calls.sharing);
});
test('fotos inexistentes permanecem indisponíveis sem fabricar URL confirmada', () => {
  const { after, payload } = compare('broken', 'broken'); assert.equal(after.calls.drive, 235); assert.equal(after.calls.sharing, 0);
  assert.ok(payload.records.every(r => r.photoCount === 0));
});
for (const fault of ['network', 'outer-error', 'boundary', 'invalid-json', 'wrong-id', 'private-result', 'discoverable', 'missing-discovery', 'missing-permissions']) {
  test(`${fault}: resultado incerto preserva fallback e payload`, () => {
    const { after, calls } = compare('cold', fault); assert.equal(after.calls.drive, 235); assert.equal(calls.cacheWrites.length, 0);
  });
}
test('resposta parcialmente negada reaproveita somente os IDs confirmados', () => {
  const { after, calls } = compare('cold', 'partial'); assert.ok(after.calls.drive > 0 && after.calls.drive < 235);
  assert.equal(calls.cacheWrites[0].keys.length + after.calls.drive, 235);
});
test('401 IDs únicos limitam paralelismo a quatro lotes; entrada duplicada é eliminada', () => {
  const h = harness(fixed, 'cold'), calls = installApi(h);
  const ids = Array.from({ length: 401 }, (_, i) => `fixture_${i}_abcdefghijklmnopqrstuvwxyz`);
  const found = h.c.readPublicPhotoReferencesBatch_([...ids, ids[0], '', 'invalid']);
  assert.equal(Object.keys(found).length, 401); assert.deepEqual(calls.waves, [4, 1]); assert.equal(calls.ids.length, 401);
});
test('parser rejeita índice inexistente e ID divergente; duplicata não cria chave extra', () => {
  const h = harness(fixed), id = 'fixture_abcdefghijklmnopqrstuvwxyz';
  const part = { index: 0, body: { id, permissions: [{ type: 'anyone', allowFileDiscovery: false }] } };
  const found = h.c.publicPhotoReferencesFromBatch_(response([part, part, { ...part, index: 1 }]), [id]);
  assert.deepEqual(plain(found), { ['photo-public-' + id]: '1' });
});
test('lista vazia mantém métricas e não solicita token nem API', () => {
  const h = harness(fixed), calls = installApi(h); h.pendingRows.splice(1);
  const payload = h.c.listPending_({ token: 'fixture' }); assert.equal(payload.records.length, 0); assert.equal(payload.pendingRecords.length, 0);
  assert.equal(calls.tokens, 0); assert.equal(calls.waves.length, 0);
});
test('autorização é validada antes de abrir planilha ou consultar fotos', () => {
  const h = harness(fixed, 'cold'), calls = installApi(h); h.c.requireSession_ = () => { throw Error('AUTH_REQUIRED'); };
  assert.throws(() => h.c.listPending_({ token: 'invalid' }), /AUTH_REQUIRED/); assert.equal(h.opens(), 0); assert.equal(calls.tokens, 0);
});
test('Campo não usa a nova consulta em lote e mantém payload byte a byte', () => {
  const a = harness(baseline, 'cold'), b = harness(fixed, 'cold'), calls = installApi(b);
  assert.equal(JSON.stringify(b.c.listMine_({ token: 'fixture' })), JSON.stringify(a.c.listMine_({ token: 'fixture' })));
  assert.equal(calls.tokens, 0); assert.equal(b.calls.drive, a.calls.drive);
});
test('todas as funções preexistentes permanecem idênticas salvo lista/preload e funções de persistência dos hotfixes CREATE/PHOTO e delta de correção', () => {
  for (const match of baseline.matchAll(/^function (\w+)\(/gm)) {
    if (!['listPending_', 'cachedPublicPhotosForRows_', 'submitRecord_', 'uploadPhoto_', 'assertCorrectionRow_', 'writeAndReadCorrection_', 'writeCorrectionAudit_', 'quarantineCorrectionStatus_', 'prepareCorrectionReceipt_', 'finishCorrection_', 'ensureCorrectionHistory_', 'recoverCorrectionCases_', 'operationalStatusFromValues_'].includes(match[1])) assert.equal(extract(fixed, match[1]), extract(baseline, match[1]), match[1]);
  }
});
let passed = 0; const failures = [];
for (const { name, run } of tests) { try { run(); passed++; } catch (error) { failures.push({ name, error: error.message }); } }
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, productionWrites: 0, failures }, null, 2));
if (failures.length) process.exitCode = 1;
