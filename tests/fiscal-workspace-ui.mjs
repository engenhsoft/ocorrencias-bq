// Local app and in-memory Apps Script. Every external request is intercepted.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { harness } from './fiscal-corrections.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright'), sharp = require('sharp');
const root = path.resolve(new URL('../', import.meta.url).pathname), evidence = path.resolve(root, '../evidence/fiscal-workspace'); await mkdir(evidence, { recursive: true });
const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#218e81' } }).png().toBuffer();
const server = createServer(async (request, response) => {
  try { const file = path.resolve(root, decodeURIComponent(new URL(request.url, 'http://fixture').pathname).slice(1) || 'index.html'); if (!file.startsWith(root + path.sep)) throw Error('Forbidden'); response.setHeader('Content-Type', /\.js$/.test(file) ? 'application/javascript' : /\.css$/.test(file) ? 'text/css' : /\.png$/.test(file) ? 'image/png' : 'text/html'); response.end(await readFile(file)); }
  catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`, errors = [], checks = [], calls = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.OCCBQ_CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const h = harness(); h.grant(); h.add(1); h.request(1); h.add(2, { base: 'MOSSORÓ', leader: 'CHEFE FORA DA ACL' }); h.request(2); h.add(3, { status: 'PUBLICADA', total: 70 }); h.sheet(h.c.meta.APP.officialSheet).appendRow(h.row(3).slice()); h.sheet(h.c.meta.APP.pendingSheet).deleteRow(4); h.drive();
    h.c.credentialHash_ = () => createHash('sha256').update('fixture-password').digest('hex'); h.c.readTeamDirectory_ = () => [{ base: 'CAICÓ', team: 'LM A', crewLeader: 'Chefe A' }];
    const masterToken = h.master(); let dropSubmitResponse = true, loseFinalReadback = false, dropApprovalResponse = false, delaySummary = null;
    const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Bahia', serviceWorkers: 'block', ...(name === 'mobile' ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } : {}) });
    await context.route('**/*', async route => {
      const request = route.request(), url = request.url(); if (url.startsWith(origin)) return route.continue();
      if (url.startsWith('https://example.test/') || url.startsWith('https://drive.google.com/thumbnail?')) return route.fulfill({ contentType: 'image/png', body: png });
      if (!url.startsWith('https://script.google.com/macros/')) return route.abort();
      const payload = request.method() === 'GET' ? { action: 'health' } : JSON.parse(request.postData() || '{}'); calls.push({ viewport: name, action: payload.action });
      let result;
      try { const fn = h.c[payload.action + '_']; if (!fn) throw Error('Unmocked action ' + payload.action); result = fn(payload); }
      catch (failure) { result = { ok: false, success: false, error: failure.code || 'FIXTURE_ERROR', message: failure.message }; }
      if (payload.action === 'getOperationalSummary' && delaySummary) await delaySummary;
      if (payload.action === 'submitRecord' && dropSubmitResponse) { dropSubmitResponse = false; return route.abort('failed'); }
      if (payload.action === 'uploadPhoto' && result.ok) loseFinalReadback = true;
      if (payload.action === 'getRecordState' && loseFinalReadback) { loseFinalReadback = false; return route.abort('failed'); }
      if (payload.action === 'supervisorAction' && payload.decision === 'approve' && dropApprovalResponse) { dropApprovalResponse = false; return route.abort('failed'); }
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result) });
    });
    const page = await context.newPage(); page.on('pageerror', failure => errors.push({ viewport: name, message: failure.message })); page.setDefaultTimeout(15000); await page.goto(origin);
    async function login(user = 'Fiscal A', role = 'fiscal') {
      await page.locator(`input[name="role"][value="${role}"]`).check(); await page.locator('#loginUser').fill(user); await page.locator('#loginPassword').fill('fixture-password'); await page.locator('#loginButton').click(); await page.locator('#appShell').waitFor({ state: 'visible' });
      if (await page.locator('#releaseNoticeDialog').isVisible()) await page.locator('#releaseNoticeAcknowledge').click();
    }
    await login(); await page.locator('#fiscalList [data-fiscal-detail]').first().waitFor();
    await page.locator('[data-fiscal-panel="indicators"]').click(); await page.locator('#fiscalFinancialChart .financial-bar').waitFor(); assert.doesNotMatch(await page.locator('#fiscalIndicatorsPanel').innerText(), /MOSSORÓ|CHEFE FORA DA ACL/);
    const summaryCalls = () => calls.filter(call => call.viewport === name && call.action === 'getOperationalSummary').length;
    const count = summaryCalls(); await page.locator('#fiscalIndicatorPeriod').selectOption('all'); await page.locator('#fiscalFinancialPeriod').selectOption('all'); await page.locator('[data-fiscal-financial-view="comparison"]').click(); await page.locator('#fiscalFinancialBase').selectOption('CAICÓ'); assert.equal(summaryCalls(), count); assert.equal(await page.locator('#fiscalFinancialChart .financial-bar').count(), 2); assert.match(await page.locator('#fiscalFinancialChart').innerText(), /70,00/);
    await page.screenshot({ path: path.join(evidence, name + '-indicators.png'), fullPage: true });
    await page.locator('[data-fiscal-panel="corrections"]').click(); await page.locator('[data-fiscal-correct]').waitFor(); assert.equal(await page.locator('#fiscalCorrectionCount').innerText(), '1'); assert.equal(await page.locator('#fiscalCorrectionsList .record-card').count(), 1);
    await page.evaluate(async recordId => { const db = await import('./db.js'); await db.putRecord({ recordId, user: 'Campo A', status: 'CORRECAO_SOLICITADA', marker: 'CAMPO_ORIGINAL_PRESERVAR' }); }, id(1));
    await page.locator('[data-fiscal-correct]').click(); await page.locator('#view-new').waitFor({ state: 'visible' }); await page.locator('#observation').fill('Rascunho exclusivo do Fiscal'); await page.locator('#fiscalCorrectionBack').click();
    await page.reload(); await page.locator('[data-fiscal-panel="corrections"]').click(); await page.locator('[data-fiscal-correct]').click(); await page.locator('#view-new').waitFor({ state: 'visible' }); assert.equal(await page.locator('#observation').inputValue(), 'Rascunho exclusivo do Fiscal'); assert.equal(await page.locator('#operationBase').evaluate(select => [...select.options].filter(option => option.value && !option.disabled).every(option => option.value === 'CAICÓ')), true);
    await page.locator('#continueToPhotosButton').click(); await page.locator('[data-photo-card="1"]').waitFor({ state: 'visible' });
    const chooser = page.waitForEvent('filechooser'); await page.locator('[data-photo-replace="1"]').click(); await (await chooser).setFiles({ name: 'foto-sintetica.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => document.querySelector('[data-photo-status="1"]').textContent.includes('Salva') || document.querySelector('[data-photo-preview="1"] img')?.src.startsWith('blob:'));
    await page.locator('#continueToReviewButton').click(); assert.match(await page.locator('#reviewSummary [data-photo-index="1"] img').getAttribute('src'), /^blob:/); await page.locator('#submitOccurrenceButton').click(); await page.locator('#confirmActionButton').click(); await page.locator('#view-fiscal').waitFor({ state: 'visible' });
    await page.locator('#fiscalCorrectionsList .sync-feedback').filter({ hasText: 'ERRO — TENTAR NOVAMENTE' }).waitFor({ state: 'visible' });
    const localProgress = await page.evaluate(async () => { const db = await import('./db.js'); const connection = await db.openDatabase(); return new Promise(resolve => { const r = connection.transaction('meta').objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result.filter(x => x.key.startsWith('fiscalCorrection:')).map(x => ({ status: x.value.record?.status, phase: x.value.record?.syncPhase, error: x.value.record?.lastError }))); }); });
    assert.equal(h.c.operationalStatusFromValues_(h.row(1)), 'AGUARDANDO_SUPERVISOR', JSON.stringify({ localProgress, calls: calls.filter(call => call.viewport === name).slice(-12), receiptPhase: h.audit(1).lastCorrectionSubmission?.phase }));
    await page.locator('#fiscalCorrectionsRefresh').click(); await page.locator('[data-fiscal-retry]:not([disabled])').waitFor();
    assert.equal(await page.locator('#fiscalCorrectionCount').innerText(), '1'); assert.match(await page.locator('#fiscalCorrectionsList').innerText(), /ERRO — TENTAR NOVAMENTE/);
    await page.screenshot({ path: path.join(evidence, name + '-retry-confirmation.png'), fullPage: true });
    await page.locator('[data-fiscal-retry]').click(); await page.waitForFunction(() => document.querySelector('#fiscalCorrectionCount').textContent === '0');
    assert.match(await page.locator('#fiscalCorrectionsStatus').innerText(), /CORREÇÃO REENVIADA/);
    assert.equal(h.c.operationalStatusFromValues_(h.row(1)), 'AGUARDANDO_SUPERVISOR'); assert.equal(h.row(1)[h.c.meta.COL.USER - 1], 'Campo A'); assert.equal(h.row(1)[h.c.meta.COL.OBSERVATION - 1], 'Rascunho exclusivo do Fiscal');
    const original = await page.evaluate(async recordId => (await (await import('./db.js')).getRecord(recordId)), id(1)); assert.equal(original.marker, 'CAMPO_ORIGINAL_PRESERVAR'); assert.equal(original.user, 'Campo A');
    await page.locator('[data-fiscal-panel="indicators"]').click(); assert.equal(await page.locator('#fiscalRanking .ranking-place').count(), 1); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    let release; delaySummary = new Promise(resolve => { release = resolve; }); await page.locator('#fiscalIndicatorsRefresh').click(); await page.locator('#logoutButton').click(); release(); delaySummary = null; await page.locator('#loginView').waitFor({ state: 'visible' }); assert.equal(await page.locator('#fiscalRanking').innerText(), ''); assert.equal(await page.locator('#fiscalFinancialChart').innerText(), '');
    await login('Fiscal Mestre'); await page.locator('[data-fiscal-panel="corrections"]').click(); await page.locator('[data-fiscal-assign]').waitFor(); assert.match(await page.locator('#fiscalCorrectionsList').innerText(), /Aguardando atribuição/);
    await page.locator('#fiscalAdminToggle').click(); await page.locator('[data-fiscal-edit="Fiscal A"]').click(); await page.locator('#fiscalCorrectionBases input[value="CAICÓ"]').check(); await page.locator('#fiscalAccountSave').click(); await page.locator('#fiscalAdminStatus').filter({ hasText: 'Cadastro salvo' }).waitFor(); assert.deepEqual(Array.from(h.c.fiscalAccounts_()[h.c.fiscalAccountKey_('Fiscal A')].correctionBases), ['CAICÓ']);
    await page.screenshot({ path: path.join(evidence, name + '-master.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.locator('#logoutButton').click(); await page.locator('#loginView').waitFor({ state: 'visible' }); h.add(4);
    await login('Supervisor FICTÍCIO', 'supervisor'); await page.locator(`[data-review-record="${id(4)}"]`).waitFor();
    const listCalls = () => calls.filter(call => call.viewport === name && call.action === 'listPending').length, listsBefore = listCalls();
    const publishedBefore = Number(await page.locator('#supervisorKpiTotal').innerText()); dropApprovalResponse = true;
    await page.locator(`[data-review-record="${id(4)}"]`).click(); await page.locator('#approveButton').click({ clickCount: 2 }); await page.locator('#confirmActionButton').click();
    await page.locator(`[data-review-record="${id(4)}"]`).waitFor({ state: 'detached' });
    assert.equal(listCalls(), listsBefore); assert.equal(Number(await page.locator('#supervisorKpiTotal').innerText()), publishedBefore + 1);
    assert.equal(h.row(4), undefined); assert.equal(h.sheet(h.c.meta.APP.officialSheet).rows.filter(row => row[0] === id(4)).length, 1);
    assert.equal(h.sheet(h.c.meta.APP.historySheet).rows.filter(row => row[0] === id(4) && row[3] === 'APROVADA_E_PUBLICADA').length, 1);
    assert.equal(calls.filter(call => call.viewport === name && call.action === 'supervisorAction').length, 1);
    if (await page.locator('#reviewDialog').isVisible()) await page.locator('#reviewDialog button[value="cancel"]').first().click();
    await page.screenshot({ path: path.join(evidence, name + '-supervisor-confirmed.png'), fullPage: true });
    checks.push({ viewport: name, iphoneSafariProfile: name === 'mobile', engine: 'Chromium', independentList: true, sharedIndicators: true, filterWithoutReload: true, isolatedDraftAndOriginalOwner: true, reloadResume: true, lostResponseRetry: true, photoConfirmedByReadback: true, assignmentAdmin: true, staleSessionDiscarded: true, supervisorLostResponseAndDoubleClick: true, supervisorLocalizedKpis: true, overflow: false }); await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
const result = { checks, errors, calls: calls.length, operationalLogins: 0, productionRequests: 0, physicalSafariTested: false }; await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
