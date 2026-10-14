// Local harness only. All external requests are intercepted; no operational login or writes.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = path.resolve(new URL('../', import.meta.url).pathname), evidence = path.resolve(root, '../evidence/ui'); await mkdir(evidence, { recursive: true });
const [backend, persistenceTests, featureTests, coreSource] = await Promise.all([readFile(process.argv[2], 'utf8'), ...['tests/correction-persistence.mjs', 'tests/operational-features.mjs', 'core.js'].map(name => readFile(path.join(root, name), 'utf8'))]);
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const extract = (s, name) => { const m = s.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(m, name); return m[0]; };
const factory = vm.runInNewContext(persistenceTests.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(persistenceTests, 'harness') + '\nharness', { vm, backend, createHash, assert, core });
const uuid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const harness = vm.runInNewContext(extract(featureTests, 'harness') + '\nharness', { factory, vm, extract, backend, createHash, createHmac, randomUUID, Buffer, Map, Date, id: uuid });
const h = harness(); h.grant();
h.c.credentialHash_ = () => createHash('sha256').update('fixture-password').digest('hex');
h.c.readTeamDirectory_ = () => [{ base: 'CAICÓ', team: 'LM A', crewLeader: 'Chefe A' }];
h.add(1); h.add(2, { status: 'CORRECAO_SOLICITADA' }); h.add(3, { status: 'FOTOS_SENDO_SINCRONIZADAS' }); h.add(4, { base: 'MOSSORÓ', leader: 'Chefe B' });
const correctionRow = h.sheet(h.c.meta.APP.pendingSheet).rows[2], { COL } = h.c.meta;
correctionRow[COL.REASON - 1] = 'Conferir a observação'; correctionRow[COL.SUPERVISOR_NOTE - 1] = 'Conferir a observação';
const audit = JSON.parse(correctionRow[COL.AUDIT - 1]); audit.lastCorrectionRequest = { requestedAt: '2026-10-12T12:00:00-03:00', reason: 'Conferir a observação', supervisor: 'Supervisor FICTÍCIO' }; correctionRow[COL.AUDIT - 1] = JSON.stringify(audit);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://fixture').pathname), relative = pathname === '/' ? 'index.html' : pathname.slice(1), file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw Error('Forbidden');
    const bytes = await readFile(file); response.setHeader('Content-Type', /\.js$/.test(file) ? 'application/javascript' : /\.css$/.test(file) ? 'text/css' : /\.png$/.test(file) ? 'image/png' : /\.webmanifest$/.test(file) ? 'application/manifest+json' : 'text/html'); response.end(bytes);
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser; const results = [], allErrors = [], calls = [];
try {
  const packed = process.env.OCCBQ_CHROMIUM_PACKAGE ? require(process.env.OCCBQ_CHROMIUM_PACKAGE) : null;
  if (packed) packed.setGraphicsMode = false;
  browser = await chromium.launch(process.env.OCCBQ_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OCCBQ_CHROMIUM_EXECUTABLE, args: ['--disable-gpu'], headless: true } : packed ? { executablePath: await packed.executablePath(), args: ['--disable-gpu'], headless: true } : { headless: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Bahia' });
    await context.route('**/*', async route => {
      const request = route.request(), url = request.url();
      if (url.startsWith(origin)) return route.continue();
      if (!url.startsWith('https://script.google.com/macros/')) return route.abort();
      let payload = {}; try { payload = request.method() === 'GET' ? { action: new URL(url).searchParams.get('action') || 'health' } : JSON.parse(request.postData() || '{}'); } catch { }
      calls.push({ viewport: name, action: payload.action, recordId: payload.recordId });
      let result;
      try {
        const routes = { health: 'health_', login: 'login_', getTeamDirectory: 'getTeamDirectory_', listMine: 'listMine_', listPending: 'listPending_', getRecordState: 'getRecordState_', getOperationalSummary: 'getOperationalSummary_', listFiscalRecords: 'listFiscalRecords_', getOccurrenceDocument: 'getOccurrenceDocument_', getDocumentPhoto: 'getDocumentPhoto_', getDailyTeamProduction: 'getDailyTeamProduction_', listPublishedRecords: 'listPublishedRecords_' };
        if (!routes[payload.action]) throw Error('Unmocked action: ' + payload.action);
        result = h.c[routes[payload.action]](payload);
      } catch (error) { result = { ok: false, success: false, error: error.code || 'FIXTURE_ERROR', message: error.message }; }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result) });
    });
    const page = await context.newPage(); page.on('pageerror', error => allErrors.push({ viewport: name, message: error.message }));
    await page.goto(origin);
    const login = async role => {
      await page.locator(`input[name="role"][value="${role}"]`).check(); await page.locator('#loginUser').fill(role === 'fiscal' ? 'Fiscal A' : role === 'field' ? 'Campo A' : 'Supervisor A'); await page.locator('#loginPassword').fill('fixture-password'); await page.locator('#loginButton').click();
      await page.locator('#appShell').waitFor({ state: 'visible' });
    };
    await login('field');
    assert.equal(await page.locator('#nonconformitySection').isVisible(), false);
    await page.evaluate(() => document.querySelector('#supervisorNav').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await page.locator('#view-supervisor').isVisible(), false);
    if (await page.locator('#releaseNoticeDialog').isVisible()) await page.locator('#releaseNoticeAcknowledge').click();
    await page.locator('#entryPendingDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#entryPendingContent').innerText(), /1 ocorrência com fotos pendentes/); assert.match(await page.locator('#entryPendingContent').innerText(), /1 ocorrência aguardando sua correção/);
    await page.locator('#entryPendingDialog button[value="dismiss"]').click();
    await page.locator('[data-nav="mine"]').click(); await page.locator('#mineInsights .ranking-place').first().waitFor();
    await page.locator('[data-nav="sync"]').click(); await page.locator('[data-nav="mine"]').click(); assert.equal(await page.locator('#entryPendingDialog').isVisible(), false);
    await page.locator('#logoutButton').click(); await login('field'); await page.locator('#entryPendingDialog').waitFor({ state: 'visible' });
    await page.locator(`[data-entry-correction="${uuid(2)}"]`).click(); await page.locator('#occurrenceNumber').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#occurrenceNumber').value === 'O-2'); assert.equal(await page.locator('#occurrenceNumber').inputValue(), 'O-2');
    await page.locator('#logoutButton').click(); await login('supervisor');
    await page.locator('#supervisorRanking .ranking-place').first().waitFor(); await page.locator('#baseChartPeriod').selectOption('all'); await page.locator('#rateChartDimension').selectOption('crewLeader');
    assert.equal(await page.locator('#nonconformitySection').isVisible(), true);
    assert.match(await page.locator('#rateChart').innerText(), /SEM DADOS/);
    await page.reload(); await page.locator('#supervisorRanking .ranking-place').first().waitFor();
    assert.equal(await page.locator('#nonconformitySection').isVisible(), true);
    assert.equal(await page.locator('#rateChartPeriod').inputValue(), 'month');
    await page.locator('#supervisorList [data-export-record]').first().waitFor();
    if (name === 'mobile') { await page.screenshot({ path: path.join(evidence, name + '-overflow.png'), fullPage: true }); await writeFile(path.join(evidence, 'overflow.json'), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).display !== 'none').map(el => ({ tag: el.tagName, id: el.id, className: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right, text: (el.textContent || '').slice(0, 60) }))), null, 2)); }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); assert.equal(overflow, false, name + ' horizontal page overflow');
    await page.screenshot({ path: path.join(evidence, name + '-supervisor.png'), fullPage: true });
    await page.locator('#logoutButton').click(); await login('fiscal'); await page.locator('#fiscalList [data-fiscal-detail]').first().waitFor();
    assert.equal(await page.locator('#nonconformitySection').isVisible(), false);
    assert.equal(await page.locator('#rateChart').innerText(), '');
    assert.equal(await page.locator('#mainNav [data-nav="sync"]').isVisible(), false); assert.equal(await page.locator('#mainNav [data-nav="new"]').isVisible(), false);
    assert.equal((await page.locator('#fiscalList').innerText()).includes('MOSSORÓ'), false);
    const directoryCalls = calls.filter(call => call.viewport === name && call.action === 'getTeamDirectory').length;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.querySelector('#fiscalList').getAttribute('aria-busy') === 'false');
    assert.equal(calls.filter(call => call.viewport === name && call.action === 'getTeamDirectory').length, directoryCalls);
    await page.locator('#fiscalList [data-fiscal-detail]').first().click(); await page.locator('#mineDetailDialog').waitFor({ state: 'visible' });
    assert.equal((await page.locator('#mineDetailContent').innerText()).includes('Produção da equipe no dia'), false); await page.locator('#mineDetailDialog button[value="cancel"]').first().click();
    const downloadPromise = page.waitForEvent('download'); await page.locator('#fiscalList [data-export-record]').first().click(); const download = await downloadPromise;
    await download.saveAs(path.join(evidence, name + '-download.pdf')); assert.match(download.suggestedFilename(), /^OCORRENCIA_.*\.pdf$/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ' fiscal horizontal overflow');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(evidence, name + '-fiscal.png'), fullPage: true });
    await page.locator('#logoutButton').click(); assert.equal(await page.locator('#fiscalList').innerText(), ''); assert.equal(await page.locator('#mineDetailContent').innerText(), '');
    assert.equal(await page.locator('#nonconformitySection').isVisible(), false);
    assert.equal(await page.locator('#rateChart').innerText(), '');
    results.push({ viewport: name, pendingEntry: true, noRerenderRepeat: true, newLoginNotice: true, correctUuid: true, supervisorCharts: true, fiscalScope: true, pdfDownloaded: true, logoutCleared: true });
    await context.close();
  }
  assert.deepEqual(allErrors, []);
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ passed: results.length * 8, failed: 0, results, calls, allErrors, productionRequests: 0 }, null, 2));
console.log(JSON.stringify({ passed: results.length * 8, failed: 0, results, allErrors, productionRequests: 0 }, null, 2));
