// Real Chromium lifecycle/offline regression; fresh profile, synthetic local data.
// Optional QA dependency: npm install --no-save --package-lock=false playwright
// node tests/audit-pwa-browser-20261018.mjs [baseline-ref-or-directory] [evidence.json]
// Env: OCCBQ_PWA_BASELINE (default 1ec0f68), OCCBQ_FRONTEND_SOURCE,
// OCCBQ_CHROMIUM_EXECUTABLE, OCCBQ_PWA_EVIDENCE. No production login or API calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { throw new Error('QA opcional requer Playwright: npm install --no-save --package-lock=false playwright'); }
const runFile = promisify(execFile);
const root = path.resolve(process.env.OCCBQ_FRONTEND_SOURCE || fileURLToPath(new URL('../', import.meta.url)));
const baseline = process.argv[2] || process.env.OCCBQ_PWA_BASELINE || '1ec0f68';
const output = path.resolve(process.argv[3] || process.env.OCCBQ_PWA_EVIDENCE || path.join(root, 'verification/audit-pwa-browser-20261018.json'));
let baselineDirectory;
try { if ((await stat(baseline)).isDirectory()) baselineDirectory = path.resolve(baseline); } catch { /* A Git revision is also accepted. */ }
const baselineCommit = baselineDirectory ? null : (await runFile('git', ['rev-parse', '--verify', `${baseline}^{commit}`], { cwd: root })).stdout.trim();
assert.ok(baselineDirectory || /^[a-f0-9]{40}$/.test(baselineCommit), 'Valid baseline Git commit');
const baselineFile = name => baselineDirectory ? readFile(path.join(baselineDirectory, name)) : runFile('git', ['cat-file', 'blob', `${baselineCommit}:${name}`], { cwd: root, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }).then(result => result.stdout);
const candidateFile = name => readFile(path.join(root, name));
async function snapshot(read) {
  const worker = (await read('service-worker.js')).toString('utf8');
  const shell = worker.match(/const APP_SHELL = \[([^]*?)\n\];/)?.[1];
  assert.ok(shell, 'Service Worker declares its app shell');
  const names = new Set(['service-worker.js', ...[...shell.matchAll(/(?:versioned\()?['"](\.\/[^'"]*)/g)].map(match => match[1] === './' ? 'index.html' : match[1].slice(2))]);
  const files = Object.fromEntries(await Promise.all([...names].map(async name => [name, await read(name)])));
  const version = worker.match(/WORKER_VERSION = '([^']+)'/)?.[1];
  assert.ok(version, 'Service Worker release');
  const hashes = Object.fromEntries(['index.html', 'service-worker.js', 'core.js', 'db.js'].map(name => [name, createHash('sha256').update(files[name]).digest('hex')]));
  return { files, version, hashes, assetCount: names.size };
}
// Every served byte is frozen before launch so parallel repository edits cannot
// change the running fixture or its recorded source hashes.
const snapshots = { before: await snapshot(baselineFile), after: await snapshot(candidateFile) };
assert.notEqual(snapshots.before.version, snapshots.after.version, 'Lifecycle test requires two different releases');
const mime = name => name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : name.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
let phase = 'before';
const requests = { before: 0, after: 0 };
let refuseSourceNetwork = false, refusedOfflineRequests = 0;
const server = createServer((request, response) => {
  // Chromium's network emulation and this independent server gate ensure that
  // an offline assertion cannot accidentally succeed by downloading source.
  if (refuseSourceNetwork) { refusedOfflineRequests++; response.writeHead(503); response.end(); return; }
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/ocorrencias-bq/')) { response.writeHead(404); response.end(); return; }
  const name = pathname.slice('/ocorrencias-bq/'.length) || 'index.html';
  const bytes = snapshots[phase].files[name];
  if (!bytes) { response.writeHead(404); response.end(); return; }
  requests[phase]++;
  response.writeHead(200, { 'Content-Type': mime(name), 'Cache-Control': 'no-store', ...(name === 'service-worker.js' ? { 'Service-Worker-Allowed': '/ocorrencias-bq/' } : {}) });
  response.end(bytes);
});
const evidence = { suite: 'audit-pwa-browser-20261018', executedAt: new Date().toISOString(),
  scope: 'Chromium lifecycle and offline only; localhost; synthetic UUID/slot/uploadKey/Blob; no Safari/iPhone physical validation',
  productionWrites: 0, baselineCommit, baselineVersion: snapshots.before.version, candidateVersion: snapshots.after.version,
  sources: { before: snapshots.before.hashes, after: snapshots.after.hashes }, tests: [] };
let executablePath = process.env.OCCBQ_CHROMIUM_EXECUTABLE;
if (!executablePath) { try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch { /* Use Playwright's configured browser. */ } }
let browser, context;
const external = [];
async function check(name, run) {
  const started = performance.now();
  try { await run(); evidence.tests.push({ name, passed: true, elapsedMs: +(performance.now() - started).toFixed(3) }); }
  catch (error) { evidence.tests.push({ name, passed: false, error: error.message, elapsedMs: +(performance.now() - started).toFixed(3) }); throw error; }
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, appUrl = origin + '/ocorrencias-bq/';
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox'] });
  evidence.browser = browser.version(); context = await browser.newContext();
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(new URL(route.request().url()).origin); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const oldVersion = snapshots.before.version, newVersion = snapshots.after.version;
  const fixtureId = '11111111-2222-4333-8444-555555555555', fixtureKey = '22222222-2222-4222-8222-222222222222';
  await check('Initial release installs its real Service Worker and controls the page', async () => {
    await page.goto(appUrl);
    await page.waitForFunction(version => document.querySelector('#loginAppVersion')?.textContent === `v${version}`, oldVersion);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const cachesBefore = await page.evaluate(() => caches.keys());
    assert.ok(cachesBefore.includes(`ocorrencias-bq-${oldVersion}`));
  });
  let fixtureStamp;
  await check('Baseline persists a synthetic UUID, exact slot/key and readable Blob', async () => {
    fixtureStamp = await page.evaluate(async ({ version, id, key }) => {
      const db = await import(`./db.js?v=${version}`);
      const record = await db.putRecord({ recordId: id, user: 'Campo FIXTURE', status: 'RASCUNHO', observation: 'offline update fixture',
        photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: false, localReady: index === 0, uploadKey: index === 0 ? key : '' })) });
      const saved = await db.putPhotoAndRecord(record, 1, new Blob(['SYNTHETIC_PWA_PHOTO'], { type: 'image/jpeg' }), key);
      const photo = await db.getPhoto(id, 1);
      if (photo.recordId !== id || photo.photoIndex !== 1 || photo.uploadKey !== key || await photo.blob.text() !== 'SYNTHETIC_PWA_PHOTO') throw Error('Synthetic Blob identity not persisted');
      await (await caches.open('qa-unrelated-fixture')).put('./qa-sentinel', new Response('preserve-unrelated-cache'));
      return saved.record.updatedAt;
    }, { version: oldVersion, id: fixtureId, key: fixtureKey });
  });
  phase = 'after';
  await check('Normal update installs a waiting worker while the current page stays on its initial release', async () => {
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
    await page.locator('#updateDialog[open]').waitFor();
    assert.equal(await page.locator('#loginAppVersion').textContent(), `v${oldVersion}`);
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
  });
  await check('Waiting update keeps old HTML and old core together across navigation', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(version => document.querySelector('#loginAppVersion')?.textContent === `v${version}`, oldVersion);
    const src = await page.locator('script[type="module"][src*="app.js"]').getAttribute('src');
    assert.ok(src.includes(`?v=${oldVersion}`));
    await page.locator('#updateDialog[open]').waitFor();
  });
  await check('The existing update button sends SKIP_WAITING, activates and reloads the new HTML/core', async () => {
    await page.locator('#updateNowButton').click();
    await page.waitForFunction(version => document.querySelector('#loginAppVersion')?.textContent === `v${version}`, newVersion);
    const loaded = await page.evaluate(async version => ({
      script: document.querySelector('script[type="module"][src*="app.js"]').getAttribute('src'),
      core: (await import(`./core.js?v=${version}`)).APP_VERSION,
      controlled: Boolean(navigator.serviceWorker.controller)
    }), newVersion);
    assert.ok(loaded.script.includes(`?v=${newVersion}`)); assert.equal(loaded.core, newVersion); assert.equal(loaded.controlled, true);
  });
  const readFixture = async version => page.evaluate(async ({ version, id, key, stamp }) => {
    const db = await import(`./db.js?v=${version}`), record = await db.getRecord(id), photo = await db.getPhoto(id, 1);
    return Boolean(record?.recordId === id && record.updatedAt === stamp && record.photoStates?.[0]?.uploadKey === key
      && photo?.recordId === id && photo.photoIndex === 1 && photo.uploadKey === key && await photo.blob.text() === 'SYNTHETIC_PWA_PHOTO');
  }, { version, id: fixtureId, key: fixtureKey, stamp: fixtureStamp });
  await check('Activating the new release preserves the IndexedDB UUID/slot/key/Blob byte for byte', async () => {
    assert.equal(await readFixture(newVersion), true);
  });
  await check('Activation retains the new release cache and preserves unrelated caches', async () => {
    const state = await page.evaluate(async ({ oldVersion, newVersion }) => ({
      keys: await caches.keys(), html: await (await (await caches.open(`ocorrencias-bq-${newVersion}`)).match('./index.html')).text(),
      sentinel: await (await (await caches.open('qa-unrelated-fixture')).match('./qa-sentinel')).text()
    }), { oldVersion, newVersion });
    assert.ok(state.keys.includes(`ocorrencias-bq-${newVersion}`)); assert.ok(!state.keys.includes(`ocorrencias-bq-${oldVersion}`));
    assert.ok(state.html.includes(`app.js?v=${newVersion}`)); assert.equal(state.sentinel, 'preserve-unrelated-cache');
  });
  await check('Offline reload serves the new release shell and matching core from its Service Worker', async () => {
    refuseSourceNetwork = true;
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(version => document.querySelector('#loginAppVersion')?.textContent === `v${version}`, newVersion);
    assert.equal(await page.evaluate(async version => (await import(`./core.js?v=${version}`)).APP_VERSION, newVersion), newVersion);
    assert.equal(await page.evaluate(() => navigator.onLine), false);
  });
  await check('The preserved UUID and Blob remain readable after the offline reload', async () => {
    assert.equal(await readFixture(newVersion), true);
  });
} catch (error) { evidence.failure = error.message; }
finally {
  await context?.close(); await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
evidence.localRequests = requests; evidence.externalRequestsBlocked = external.length;
evidence.offline = { serverRefusedSource: refuseSourceNetwork, sourceResponsesServed: 0, requestsRefused: refusedOfflineRequests };
evidence.total = evidence.tests.length; evidence.passed = evidence.tests.filter(test => test.passed).length; evidence.failed = evidence.tests.filter(test => !test.passed).length;
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ suite: evidence.suite, browser: evidence.browser, initial: evidence.baselineVersion, candidate: evidence.candidateVersion,
  total: evidence.total, passed: evidence.passed, failed: evidence.failed, failure: evidence.failure, externalRequestsBlocked: external.length, evidence: output }, null, 2));
if (evidence.failure || evidence.failed || external.length) process.exitCode = 1;
