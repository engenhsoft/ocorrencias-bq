// Genuine browser/IndexedDB UI with the official backend running only in memory.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fixtureFactory, id, keyValues } from './chaves-fixtures.mjs';
import { assertReadable } from './readability-check.mjs';

const require = createRequire(import.meta.url), { chromium, webkit, devices } = require('playwright'), ExcelJS = require('../vendor/exceljs-4.4.0.min.js');
const browserName = process.env.OCCBQ_BROWSER || 'chromium';
const root = path.resolve(new URL('../', import.meta.url).pathname), evidence = path.resolve(root, '../evidence/chaves-' + browserName);
await mkdir(evidence, { recursive: true });
const backend = await readFile(process.argv[2], 'utf8'), make = await fixtureFactory(backend);
const version = (await readFile(path.join(root, 'core.js'), 'utf8')).match(/APP_VERSION = '([^']+)'/)[1];
const image = await readFile(path.join(root, 'assets/icon-192.png'));
const server = createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url, 'http://fixture').pathname).slice(1) || 'index.html';
    const file = path.resolve(root, relative); if (!file.startsWith(root + path.sep)) throw Error('Forbidden');
    response.setHeader('Content-Type', /\.js$/.test(file) ? 'application/javascript' : /\.css$/.test(file) ? 'text/css' : /\.png$/.test(file) ? 'image/png' : 'text/html');
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, calls = [], errors = [], checks = [];
let browser;
try {
  if (browserName !== 'webkit') browser = await chromium.launch({ headless: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }], ['narrow', { width: 320, height: 700 }]]) {
    const h = make(); h.grant(); h.add(2); h.drive();
    h.c.readTeamDirectory_ = () => [{ base: 'CAICÓ', team: 'LM A', crewLeader: 'Chefe A' }];
    h.catalog.rows[2] = ['D', 'Serviço fixture', 'UN', 'Fixture', '', '', '', '100', '100'];
    const contextOptions = { viewport, isMobile: name !== 'desktop', hasTouch: name !== 'desktop', acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Bahia', serviceWorkers: 'block', ...(name !== 'desktop' ? { userAgent: devices[browserName === 'webkit' ? 'iPhone 13' : 'Pixel 7'].userAgent, deviceScaleFactor: 2 } : {}) };
    // Linux WebKit ephemeral contexts reject IndexedDB Blobs in the isolated control.
    // A fresh persistent profile exercises the normal PWA storage contract.
    const context = browserName === 'webkit'
      ? await webkit.launchPersistentContext(await mkdtemp(path.join(evidence, 'profile-' + name + '-')), { ...contextOptions, headless: true })
      : await browser.newContext(contextOptions);
    let fiscalAclRevision = '';
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url().startsWith(origin) || request.url().startsWith('blob:' + origin)) return route.continue();
      if (!request.url().startsWith('https://script.google.com/macros/')) return route.abort();
      const payload = request.method() === 'GET' ? { action: 'health' } : JSON.parse(request.postData() || '{}');
      calls.push({ viewport: name, action: payload.action, recordId: payload.record?.recordId || payload.recordId });
      let result;
      try {
        if (payload.action === 'login') result = payload.role === 'fiscal' ? h.c.loginFiscal_(payload) : { user: payload.role === 'field' ? 'Campo A' : 'Supervisor A', role: payload.role, token: h.token(payload.role), expiresAt: new Date(Date.now() + 3600000).toISOString() };
        else if (payload.action === 'getDocumentPhoto') result = { recordId: payload.recordId, photoIndex: payload.photoIndex, available: false, message: 'Fixture sem download remoto.' };
        else {
          const fn = h.c[payload.action + '_']; if (!fn) throw Error('Unmocked action: ' + payload.action);
          result = fn(payload);
        }
      } catch (error) { result = { ok: false, success: false, error: error.code || 'FIXTURE_ERROR', message: error.message }; }
      if (payload.action === 'login' && payload.role === 'fiscal') fiscalAclRevision = result.aclRevision;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, success: true, ...result }) });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push({ name, error: error.message })); page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) console.error(name + ': ' + message.text()); });
    await page.addLocatorHandler(page.locator('#releaseNoticeDialog[open]'), async () => { await page.locator('#releaseNoticeAcknowledge').evaluate(el => el.click()); });
    await page.addLocatorHandler(page.locator('#entryPendingDialog[open]'), async () => { await page.locator('#entryPendingDialog [value="dismiss"]').evaluate(el => el.click()); });
    const logout = async () => { await page.locator('#logoutButton').click(); };
    const login = async role => {
      await page.locator(`input[name="role"][value="${role}"]`).check();
      await page.locator('#loginUser').fill(role === 'fiscal' ? 'Fiscal A' : role === 'field' ? 'Campo A' : 'Supervisor A');
      await page.locator('#loginPassword').fill('fixture-password'); await page.locator('#loginButton').click();
      await page.locator('#appShell').waitFor({ state: 'visible' });

    };
    const until = async check => { const started = Date.now(); while (Date.now() - started < 30000) { if (await check()) return; await page.waitForTimeout(100); } throw Error('Fixture condition did not complete: ' + String(check)); };
    const stored = async () => page.evaluate(async version => { const db = await import('./db.js?v=' + version); return (await db.getAllRecords()).find(record => record.status === 'RASCUNHO'); }, version);
    await page.goto(origin); await login('field'); console.error(name + ': field login');
    await page.locator('#operationBase').selectOption('CAICÓ'); await page.locator('#team').selectOption('LM A'); await page.locator('#occurrenceNumber').fill('00001-CHAVES-FIXTURE');
    const selected = page.locator('#occurrenceTypes input[value="CHAVES"]'); await selected.check();
    await page.locator('#keysSection').waitFor({ state: 'visible' });
    for (const [key, value] of Object.entries(keyValues)) { assert.equal(await page.locator('#' + key).getAttribute('type'), 'text'); assert.equal(await page.locator('#' + key).evaluate(el => el.required), true); await page.locator('#' + key).fill(value); }
    await until(() => page.evaluate(async version => { const db = await import('./db.js?v=' + version); return (await db.getAllRecords()).some(record => record.btoKeyInstalled === '000078-D/9'); }, version));
    const originalId = (await stored()).recordId; console.error(name + ': CHAVES data persisted');
    await selected.uncheck(); assert.equal(await page.locator('#keysSection').isVisible(), false);
    assert.equal(await page.locator('#pgKeyRemoved').isDisabled(), true);
    await until(() => page.evaluate(async version => { const db = await import('./db.js?v=' + version); return (await db.getAllRecords()).some(record => record.pgKeyRemoved === '' && record.chavesDraft?.pgKeyRemoved === '00012-A/7'); }, version));
    await selected.check(); assert.equal(await page.locator('#pgKeyRemoved').inputValue(), keyValues.pgKeyRemoved);
    await page.locator('#occurrenceTypes input[value="SUBSTITUIÇÃO DE POSTE"]').check(); assert.equal(await page.locator('#pgPostSection').isVisible(), true); assert.equal(await page.locator('#pgKeyRemoved').inputValue(), keyValues.pgKeyRemoved);
    await page.locator('#occurrenceTypes input[value="SUBSTITUIÇÃO DE POSTE"]').uncheck();
    await page.locator('#occurrenceTypes input[value="SUBSTITUIÇÃO DE TRAFO"]').check(); assert.equal(await page.locator('#transformerSection').isVisible(), true); await page.locator('#occurrenceTypes input[value="SUBSTITUIÇÃO DE TRAFO"]').uncheck();
    await context.setOffline(true); await page.locator('#btoKeyInstalled').fill('000078-OFFLINE');
    await until(() => page.evaluate(async version => { const db = await import('./db.js?v=' + version); return (await db.getAllRecords()).some(record => record.btoKeyInstalled === '000078-OFFLINE'); }, version));
    await context.setOffline(false);
    await page.evaluate(async version => { const db = await import('./db.js?v=' + version); const record = (await db.getAllRecords()).find(record => record.status === 'RASCUNHO'); await db.putRecord({ ...record, services: [{ lineId: 'fixture-service', code: 'D', catalogKey: 'Emergência:3', catalogText: 'Serviço fixture', unit: 'UN', group: 'Fixture', contract: '4600080938', referenceValue: 100, quantity: 1, totalValue: 100 }], materials: [{ lineId: 'fixture-material', code: '00001', description: 'Material fixture', unit: 'UN', quantity: 1 }], totalServices: 100 }); }, version);
    console.error(name + ': offline draft saved'); await page.reload(); await page.locator('#resumeDraftButton').click(); await page.locator('#keysSection').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#btoKeyInstalled').inputValue(), '000078-OFFLINE'); assert.equal((await stored()).recordId, originalId); assert.equal((await stored()).formVersion, 1);
    await page.waitForFunction(() => !document.querySelector('#continueToPhotosButton').disabled);
    await page.locator('#continueToPhotosButton').click(); assert.equal(await page.locator('[data-step-panel="2"]').isVisible(), true);
    for (const index of [1, 2, 3]) {
      const chooser = page.waitForEvent('filechooser'); await page.locator(`[data-photo-attach="${index}"]`).click(); await (await chooser).setFiles({ name: `fixture-${index}.png`, mimeType: 'image/png', buffer: image });
      try { await page.waitForFunction(index => document.querySelector(`[data-photo-card="${index}"]`).classList.contains('has-photo'), index); } catch (error) { console.error(await page.locator('body').innerText()); await page.screenshot({ path: path.join(evidence, name + '-photo-failure.png'), fullPage: true }); throw error; }
    }
    console.error(name + ': photos ready'); await page.locator('#continueToReviewButton').click(); assert.match(await page.locator('#reviewSummary').innerText(), /000078-OFFLINE/); await assertReadable(page);
    await page.screenshot({ path: path.join(evidence, name + '-review.png'), fullPage: true });
    await page.locator('#submitOccurrenceButton').click(); await page.locator('#confirmActionButton').click();
    await until(() => page.evaluate(async ({ version, recordId }) => { const db = await import('./db.js?v=' + version); const record = await db.getRecord(recordId); return record?.status === 'AGUARDANDO_SUPERVISOR'; }, { version, recordId: originalId }));
    console.error(name + ': new occurrence synced');  const row = h.sheet(h.c.meta.APP.pendingSheet).rows.find(row => row[0] === originalId); assert.ok(row); assert.equal(h.c.recordFromValuesAt_(row).btoKeyInstalled, '000078-OFFLINE');
    await logout(); await login('supervisor');
    await page.locator(`[data-review-record="${originalId}"]`).click(); await page.locator('#reviewDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#reviewDialogContent').innerText(), /000078-OFFLINE/); await assertReadable(page);
    await page.evaluate(() => document.querySelector('#reviewDialog').close());
    const pdfEvent = page.waitForEvent('download'); await page.locator(`[data-export-record="${originalId}"]`).click(); const pdf = await pdfEvent; const pdfPath = path.join(evidence, name + '.pdf'); await pdf.saveAs(pdfPath);
    const text = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' }); for (const code of [keyValues.pgKeyRemoved, keyValues.btoKeyRemoved, keyValues.pgKeyInstalled, '000078-OFFLINE']) assert.ok(text.includes(code), code + ' PDF');
    await page.locator(`[data-export-excel="${originalId}"]`).click(); await page.locator('#excelDialog').waitFor({ state: 'visible' });
    const excelEvent = page.waitForEvent('download'); await page.locator('#generateExcelButton').click(); const excel = await excelEvent; const excelPath = path.join(evidence, name + '.xlsx'); await excel.saveAs(excelPath);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await readFile(excelPath)); assert.ok(book.getWorksheet('OCORRÊNCIAS').getRow(2).values.includes('000078-OFFLINE'));
    await page.locator('[data-excel-close]').first().click();
    h.c.supervisorAction_({ token: h.token('supervisor'), recordId: originalId, decision: 'request_correction', reason: 'Conferir BTO da chave instalada', note: 'Corrigir somente o BTO' });
    console.error(name + ': supervisor exports verified'); await logout(); await login('fiscal'); await page.locator('[data-fiscal-panel="corrections"]').click();
    await page.locator(`[data-fiscal-correct="${originalId}"]`).click(); await page.locator('#keysSection').waitFor({ state: 'visible' });
    await page.locator('#btoKeyInstalled').fill('000099-FISCAL'); await page.locator('#continueToPhotosButton').click(); await page.locator('#continueToReviewButton').click(); await page.locator('#submitOccurrenceButton').click(); await page.locator('#confirmActionButton').click();
    await page.waitForFunction(() => document.querySelector('#view-fiscal')?.hidden === false);
    await until(async () => {
      const row = h.sheet(h.c.meta.APP.pendingSheet).rows.find(row => row[0] === originalId);
      const record = row && h.c.recordFromValuesAt_(row);
      return record?.btoKeyInstalled === '000099-FISCAL' && record.audit?.lastCorrectionSubmission?.phase === 'COMPLETE';
    });
    const confirmed = h.c.recordFromValuesAt_(h.sheet(h.c.meta.APP.pendingSheet).rows.find(row => row[0] === originalId));
    assert.equal(confirmed.recordId, originalId); assert.equal(confirmed.btoKeyInstalled, '000099-FISCAL'); assert.deepEqual(JSON.parse(JSON.stringify(confirmed.audit.lastCorrectionSubmission.expectedPatch)), { btoKeyInstalled: '000099-FISCAL' });
    assert.ok(fiscalAclRevision);
    await until(() => page.evaluate(async ({ version, recordId, aclRevision }) => {
      const db = await import('./db.js?v=' + version);
      const draft = (await db.getFiscalCorrectionDrafts('Fiscal A', aclRevision)).find(record => record.recordId === recordId);
      return draft?.syncPhase === 'confirmed' && draft.btoKeyInstalled === '000099-FISCAL';
    }, { version, recordId: originalId, aclRevision: fiscalAclRevision }));
    // New records of existing types also carry the immutable creation version.
    // Their correction acknowledgement must remain valid without CHAVES selected.
    h.add(3); h.row(3)[h.c.meta.COL.FORM_VERSION - 1] = 1; h.request(3);
    await page.locator('#fiscalCorrectionsRefresh').click();
    await page.locator(`[data-fiscal-correct="${id(3)}"]`).click();
    await page.locator('#observation').fill('PODA fixture revisada');
    await page.locator('#continueToPhotosButton').click(); await page.locator('#continueToReviewButton').click();
    await page.locator('#submitOccurrenceButton').click(); await page.locator('#confirmActionButton').click();
    await until(() => page.evaluate(async ({ version, recordId, aclRevision }) => {
      const db = await import('./db.js?v=' + version);
      const draft = (await db.getFiscalCorrectionDrafts('Fiscal A', aclRevision)).find(record => record.recordId === recordId);
      return draft?.syncPhase === 'confirmed' && draft.observation === 'PODA fixture revisada';
    }, { version, recordId: id(3), aclRevision: fiscalAclRevision }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    checks.push({ viewport: name, offlineDraft: true, sameUuid: true, dataThenPhotos: true, synchronization: true, supervisorDetail: true, fiscalCorrection: true, fiscalLocalConfirmation: true, existingTypeCorrection: true, pdfText: true, excelText: true, pageOverflow: false }); await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { browser: browserName, photoPreparation: 'file chooser UI and native IndexedDB Blobs', storage: browserName === 'webkit' ? 'fresh persistent profile' : 'fresh isolated context', checks, errors, calls, productionWrites: 0, operationalLogins: 0 }; await writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
