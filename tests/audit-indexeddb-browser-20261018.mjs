// Native browser IndexedDB regression. No Google/backend calls or operational data.
// Optional QA dependency: npm install --no-save --package-lock=false playwright
// Use an installed Chromium via OCCBQ_CHROMIUM_EXECUTABLE, or Playwright Chromium.
// node tests/audit-indexeddb-browser-20261018.mjs [baseline-directory] [evidence.json]
// Env alternatives: OCCBQ_BASELINE_SOURCE, OCCBQ_FRONTEND_SOURCE, OCCBQ_BROWSER_EVIDENCE.
import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { throw new Error('QA opcional requer Playwright: npm install --no-save --package-lock=false playwright'); }

const candidateRoot = path.resolve(process.env.OCCBQ_FRONTEND_SOURCE || fileURLToPath(new URL('../', import.meta.url)));
const baselineRoot = process.argv[2] || process.env.OCCBQ_BASELINE_SOURCE;
const evidencePath = path.resolve(process.argv[3] || process.env.OCCBQ_BROWSER_EVIDENCE || path.join(candidateRoot, 'verification/audit-indexeddb-browser-20261018.json'));
const roots = { ...(baselineRoot ? { before: path.resolve(baselineRoot) } : {}), after: candidateRoot };
const moduleNames = ['db.js', 'fiscal-drafts.js', 'core.js'];
// Freeze the exact modules at startup so concurrent checkout edits cannot make
// the evidence hashes differ from the bytes actually loaded by the browser.
const moduleSources = Object.fromEntries(await Promise.all(Object.entries(roots).map(async ([phase, directory]) => [phase,
  Object.fromEntries(await Promise.all(moduleNames.map(async name => [name, await readFile(path.join(directory, name), 'utf8')])))])));
const sources = Object.fromEntries(Object.entries(moduleSources).map(([phase, modules]) => [phase,
  Object.fromEntries(Object.entries(modules).map(([name, source]) => [name, createHash('sha256').update(source).digest('hex')]))]));

let executablePath = process.env.OCCBQ_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; }
  catch { /* Playwright's configured browser is the portable fallback. */ }
}
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end('Isolated native IndexedDB fixture'); return; }
  const [, phase, name, extra] = pathname.split('/');
  if (!roots[phase] || !moduleNames.includes(name) || extra) { response.writeHead(404); response.end(); return; }
  try {
    const source = moduleSources[phase][name];
    response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' }); response.end(source);
  } catch { response.writeHead(404); response.end(); }
});

const results = { suite: 'audit-indexeddb-browser-20261018', executedAt: new Date().toISOString(),
  isolation: 'Native Chromium IndexedDB; fresh browser context per phase; localhost modules; synthetic records and Blobs only',
  productionWrites: 0, sources, phases: [] };
const externalRequests = [];
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox'] });
  results.browser = browser.version();
  for (const phase of Object.keys(roots)) {
    const context = await browser.newContext();
    try {
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        externalRequests.push(new URL(route.request().url()).origin); return route.abort();
      });
      const page = await context.newPage(); await page.goto(origin);
      const tests = await page.evaluate(async phase => {
        const draftSource = await (await fetch(`/${phase}/fiscal-drafts.js`)).text();
        const dbModule = draftSource.match(/from '\.\/(db\.js[^']*)'/)?.[1];
        if (!dbModule) throw Error('Fiscal adapter does not identify its IndexedDB module');
        // Import the exact URL used by the adapter: versioned ES modules have
        // separate connectionPromise instances from an unversioned import.
        const db = await import(`/${phase}/${dbModule}`);
        const { fiscalDraftKey, fiscalDraftStorage } = await import(`/${phase}/fiscal-drafts.js`);
        const route = { routingVersion: 'FISCAL_ASSIGNED', routingRequestId: 'request-fixture', assignmentRevision: 'assignment-fixture', assignedFiscal: 'Fiscal FIXTURE' };
        const fixture = id => ({ recordId: id, user: 'Campo FIXTURE', observation: 'original', pgPostRemoved: 'PG original',
          services: [{ code: 'S01', quantity: 1 }], materials: [{ code: '00001', quantity: 1.5 }], fiscalCorrection: { ...route }, fiscalAclRevision: 'acl-fixture', status: 'RASCUNHO',
          photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, confirmed: false, localReady: false, uploadKey: '' })) });
        const fiscal = id => fiscalDraftStorage(fiscalDraftKey(route.assignedFiscal, id, route, 'acl-fixture'));
        const selected = (record, index, uploadKey) => ({ ...record, photoStates: record.photoStates.map(state => state.photoIndex === index ? { ...state, localReady: true, uploadKey } : state) });
        const results = [];
        async function test(name, run) {
          const start = performance.now();
          try { await run(); results.push({ name, passed: true, elapsedMs: +(performance.now() - start).toFixed(3) }); }
          catch (error) { results.push({ name, passed: false, error: error.message, elapsedMs: +(performance.now() - start).toFixed(3) }); }
        }
        const assert = (condition, message) => { if (!condition) throw Error(message); };

        await test('Fiscal stale photo preserves newer data/receipt and other slots', async () => {
          const id = crypto.randomUUID(), storage = fiscal(id);
          const original = await storage.putRecord(fixture(id));
          const newer = await storage.putRecord({ ...original, pgPostRemoved: 'PG newer', observation: 'newer', services: [{ code: 'S02', quantity: 12.5 }], materials: [{ code: '00002', quantity: 2.75 }], correctionRequestId: 'newer-request', correctionPayloadSignature: 'newer-signature', photoStates: original.photoStates.map(state => state.photoIndex === 2 ? { ...state, uploadKey: 'other-key' } : state) });
          await storage.putPhotoAndRecord(selected(original, 1, 'selected-key'), 1, new Blob(['photo-fixture'], { type: 'image/jpeg' }), 'selected-key');
          const saved = await storage.getRecord(), photo = await storage.getPhoto(id, 1);
          assert(['pgPostRemoved', 'observation', 'services', 'materials', 'correctionRequestId', 'correctionPayloadSignature'].every(field => JSON.stringify(saved[field]) === JSON.stringify(newer[field])), 'Newer correction fields overwritten by stale photo');
          assert(saved.photoStates[0].uploadKey === 'selected-key' && saved.photoStates[1].uploadKey === 'other-key', 'Slot identity changed');
          assert(photo.recordId === id && photo.photoIndex === 1 && photo.uploadKey === 'selected-key' && await photo.blob.text() === 'photo-fixture', 'Blob identity mismatch');
          assert(await db.getRecord(id) === undefined, 'Campo queue polluted');
        });
        await test('Fiscal closed connection reopens and preserves existing Blob', async () => {
          const id = crypto.randomUUID(), storage = fiscal(id);
          const original = await storage.putRecord(fixture(id));
          await storage.putPhotoAndRecord(selected(original, 1, 'existing-key'), 1, new Blob(['preserved-photo']), 'existing-key');
          const current = await storage.getRecord(); (await db.openDatabase()).close();
          await storage.putRecord({ ...current, observation: 'saved after reconnect' });
          assert((await storage.getRecord()).observation === 'saved after reconnect', 'Draft not saved');
          assert(await (await storage.getPhoto(id, 1)).blob.text() === 'preserved-photo', 'Existing Blob lost');
        });
        await test('Stale deletion preserves record and photo atomically', async () => {
          const id = crypto.randomUUID(), original = await db.putRecord(fixture(id));
          const current = await db.putPhotoAndRecord(selected(original, 1, 'key-1'), 1, new Blob(['preserve-photo']), 'key-1');
          let code; try { await db.deleteRecord(id, { expectedUpdatedAt: original.updatedAt, expectedStatus: original.status }); } catch (error) { code = error.code; }
          const saved = await db.getRecord(id), photo = await db.getPhoto(id, 1);
          assert(code === 'LOCAL_RECORD_CHANGED' && saved?.updatedAt === current.record.updatedAt && photo?.uploadKey === 'key-1', `Stale deletion was not blocked: recordExists=${Boolean(saved)} photoExists=${Boolean(photo)}`);
        });
        await test('Status guard prevents deletion of synchronized queue', async () => {
          const id = crypto.randomUUID(), current = await db.putRecord({ ...fixture(id), status: 'PENDENTE_SINCRONIZACAO' });
          let code; try { await db.deleteRecord(id, { expectedUpdatedAt: current.updatedAt, expectedStatus: 'RASCUNHO' }); } catch (error) { code = error.code; }
          assert(code === 'LOCAL_RECORD_CHANGED' && (await db.getRecord(id))?.status === current.status, 'Status guard did not preserve queue');
        });
        await test('Guarded deletion removes only exact UUID with all seven photo slots', async () => {
          const id = crypto.randomUUID(), otherId = crypto.randomUUID(); let record = await db.putRecord(fixture(id));
          const other = await db.putRecord({ ...fixture(otherId), occurrenceNumber: 'SAME-NUMBER' });
          await db.putPhotoAndRecord(selected(other, 1, 'other-key'), 1, new Blob(['keep-other']), 'other-key');
          for (let index = 1; index <= 7; index++) record = (await db.putPhotoAndRecord(selected(record, index, `slot-${index}`), index, new Blob([`slot-${index}`]), `slot-${index}`)).record;
          await db.deleteRecord(id, { expectedUpdatedAt: record.updatedAt, expectedStatus: record.status });
          assert(await db.getRecord(id) === undefined && (await db.getPhotosForRecord(id)).length === 0, 'Deletion left orphan data');
          assert((await db.getRecord(otherId)).recordId === otherId && await (await db.getPhoto(otherId, 1)).blob.text() === 'keep-other', 'Other UUID affected');
        });
        await test('Campo delayed photo cannot resurrect a deleted draft or Blob', async () => {
          const id = crypto.randomUUID(), original = await db.putRecord(fixture(id));
          await db.deleteRecord(id, { expectedUpdatedAt: original.updatedAt, expectedStatus: original.status });
          let code;
          try { await db.putPhotoAndRecord(selected(original, 1, 'late-key'), 1, new Blob(['late-photo']), 'late-key', { expectedUploadKey: '', expectedRecordStatus: original.status }); }
          catch (error) { code = error.code; }
          assert(code === 'LOCAL_RECORD_CHANGED', 'Deleted draft accepted a delayed photo');
          assert(await db.getRecord(id) === undefined && (await db.getPhotosForRecord(id)).length === 0, 'Deleted record or Blob was recreated');
        });
        for (const profile of ['Campo', 'Fiscal']) {
          const storageFor = id => profile === 'Campo' ? db : fiscal(id);
          await test(`${profile} delayed photo preserves a newer replacement in the same slot`, async () => {
            const id = crypto.randomUUID(), storage = storageFor(id);
            const original = await storage.putRecord(fixture(id));
            const first = (await storage.putPhotoAndRecord(selected(original, 1, 'original-key'), 1, new Blob(['original-photo']), 'original-key')).record;
            const latest = (await storage.putPhotoAndRecord(selected(first, 1, 'latest-key'), 1, new Blob(['latest-photo']), 'latest-key', { expectedUploadKey: 'original-key', expectedRecordStatus: first.status })).record;
            let code;
            try { await storage.putPhotoAndRecord(selected(first, 1, 'late-key'), 1, new Blob(['late-photo']), 'late-key', { expectedUploadKey: 'original-key', expectedRecordStatus: first.status }); }
            catch (error) { code = error.code; }
            const saved = await storage.getRecord(id), photo = await storage.getPhoto(id, 1);
            assert(code === 'LOCAL_RECORD_CHANGED' && saved.updatedAt === latest.updatedAt, 'Delayed replacement changed the current revision');
            assert(saved.photoStates[0].uploadKey === 'latest-key' && photo.uploadKey === 'latest-key' && await photo.blob.text() === 'latest-photo', 'Newer replacement Blob/key overwritten');
          });
          await test(`${profile} photo cannot modify a concurrently submitted draft`, async () => {
            const id = crypto.randomUUID(), storage = storageFor(id);
            const original = await storage.putRecord(fixture(id));
            const current = await storage.putRecord({ ...original, status: 'PENDENTE_SINCRONIZACAO', correctionRequestId: 'pending-request' });
            let code;
            try { await storage.putPhotoAndRecord(selected(original, 1, 'late-key'), 1, new Blob(['late-photo']), 'late-key', { expectedUploadKey: '', expectedRecordStatus: original.status }); }
            catch (error) { code = error.code; }
            const saved = await storage.getRecord(id);
            assert(code === 'LOCAL_RECORD_CHANGED' && saved.updatedAt === current.updatedAt && saved.status === current.status && saved.correctionRequestId === 'pending-request', 'Photo changed the submitted snapshot');
            assert(!(await storage.getPhoto(id, 1)), 'Photo Blob was written after submission');
          });
          await test(`${profile} simultaneous replacements commit one Blob with one matching slot key`, async () => {
            const id = crypto.randomUUID(), storage = storageFor(id), original = await storage.putRecord(fixture(id));
            const guard = { expectedUploadKey: '', expectedRecordStatus: original.status };
            const outcomes = await Promise.allSettled(['A', 'B'].map(key => storage.putPhotoAndRecord(selected(original, 1, key), 1, new Blob([`photo-${key}`]), key, guard)));
            const success = outcomes.filter(outcome => outcome.status === 'fulfilled'), failed = outcomes.filter(outcome => outcome.status === 'rejected');
            assert(success.length === 1 && failed.length === 1 && failed[0].reason.code === 'LOCAL_RECORD_CHANGED', 'Concurrent same-slot writes both committed or both failed');
            const saved = await storage.getRecord(id), photo = await storage.getPhoto(id, 1), winningKey = success[0].value.photo.uploadKey;
            assert(saved.photoStates[0].uploadKey === winningKey && photo.uploadKey === winningKey && await photo.blob.text() === `photo-${winningKey}`, 'Winning record and Blob identities differ');
          });
          await test(`${profile} simultaneous distinct slots preserve both Blobs and keys`, async () => {
            const id = crypto.randomUUID(), storage = storageFor(id), original = await storage.putRecord(fixture(id));
            await Promise.all([1, 2].map(index => storage.putPhotoAndRecord(selected(original, index, `slot-${index}`), index, new Blob([`photo-${index}`]), `slot-${index}`, { expectedUploadKey: '', expectedRecordStatus: original.status })));
            const saved = await storage.getRecord(id);
            for (const index of [1, 2]) {
              const photo = await storage.getPhoto(id, index);
              assert(saved.photoStates[index - 1].uploadKey === `slot-${index}` && photo.uploadKey === `slot-${index}` && await photo.blob.text() === `photo-${index}`, 'Concurrent independent slot was lost');
            }
          });
        }
        return results;
      }, phase);
      results.phases.push({ phase, total: tests.length, passed: tests.filter(test => test.passed).length, failed: tests.filter(test => !test.passed).length, tests });
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
results.externalRequestsBlocked = externalRequests.length;
const candidate = results.phases.find(phase => phase.phase === 'after');
results.total = candidate.total; results.passed = candidate.passed; results.failed = candidate.failed;
await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ suite: results.suite, browser: results.browser, total: results.total, passed: results.passed, failed: results.failed, baseline: results.phases.find(phase => phase.phase === 'before')?.failed, externalRequestsBlocked: results.externalRequestsBlocked, evidence: evidencePath }, null, 2));
if (results.failed || externalRequests.length) process.exitCode = 1;
