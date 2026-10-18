// Real Chromium DOM and IndexedDB; application bootstrap removed and every
// external request intercepted. Does not execute the private Apps Script source.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = path.resolve(new URL('../', import.meta.url).pathname), evidence = path.resolve(root, '../evidence/audit-fiscal-ui-20261018');
await mkdir(evidence, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(root, decodeURIComponent(new URL(request.url, 'http://fixture').pathname).slice(1) || 'index.html');
    if (!file.startsWith(root + path.sep)) throw Error('Forbidden');
    response.setHeader('Content-Type', /\.js$/.test(file) ? 'application/javascript' : /\.css$/.test(file) ? 'text/css' : /\.png$/.test(file) ? 'image/png' : 'text/html');
    const content = await readFile(file); response.end(file.endsWith('index.html') ? content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') : content);
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
const ID = '11111111-2222-4333-8444-555555555555', USER = 'Fiscal Fixture';
const route = revision => ({ routingVersion: 'FISCAL_ASSIGNED', routingRequestId: 'request-' + revision, assignmentRevision: revision, assignedFiscal: USER, base: 'CAICÓ', assignmentStatus: 'ASSIGNED' });
const record = { recordId: ID, occurrenceNumber: '<img src=x onerror="globalThis.auditXss=1">', base: 'CAICÓ', fiscalCorrection: route('new'), canCorrect: true };
const draft = (revision, syncPhase = 'error') => ({ ...record, fiscalCorrection: route(revision), correctionMode: true, fiscalDraftKey: 'fiscalCorrection:' + revision, fiscalAclRevision: 'acl-fixture', syncPhase, lastError: revision + '-fixture-error', updatedAt: revision === 'old' ? '2026-10-18T11:00:00Z' : '2026-10-18T10:00:00Z' });
const checks = [], errors = [], actions = []; let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.OCCBQ_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, locale: 'pt-BR', serviceWorkers: 'block' });
    let passwordRelease, passwordResponse;
    await context.route('**/*', async intercepted => {
      const request = intercepted.request(), url = request.url(); if (url.startsWith(origin)) return intercepted.continue();
      if (!url.startsWith('https://script.google.com/macros/')) return intercepted.abort();
      const payload = JSON.parse(request.postData() || '{}'); actions.push({ viewport: name, action: payload.action });
      let result;
      if (payload.action === 'listFiscalCorrections') result = { records: [record] };
      else if (payload.action === 'listFiscalAccounts') result = { masterUser: USER, bases: ['CAICÓ'], accounts: [{ user: 'Fiscal Other Fixture', bases: ['CAICÓ'], correctionBases: [], active: true }] };
      else if (payload.action === 'changeFiscalMasterPassword') { await new Promise(resolve => { passwordRelease = resolve; }); result = { ok: false, error: 'INVALID_CREDENTIALS', message: 'Fixture recoverable failure' }; }
      else throw Error('Unexpected fixture action: ' + payload.action);
      await intercepted.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, ...result }) });
      if (payload.action === 'changeFiscalMasterPassword') passwordResponse?.();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push({ viewport: name, message: error.message })); await page.goto(origin);
    await page.evaluate(async ({ drafts, USER }) => {
      const [{ createFiscalWorkspace }, { createFiscalAdmin }, db] = await Promise.all([import('./fiscal-workspace.js'), import('./fiscal-admin.js'), import('./db.js')]);
      for (const record of drafts) await db.setMeta(record.fiscalDraftKey, { record, photos: {} });
      window.auditSession = { role: 'fiscal', user: USER, token: 'fixture-token', bases: ['CAICÓ'], aclRevision: 'acl-fixture', canManageFiscals: true }; window.auditRevision = 1; window.auditRetries = [];
      const options = { getSession: () => window.auditSession, getRevision: () => window.auditRevision, onLogout: () => { window.auditSession = null; window.auditRevision++; } };
      window.auditWorkspace = createFiscalWorkspace({ ...options, onRetry: async (...args) => window.auditRetries.push(args), onCorrection() {}, topThreeMarkup: () => '', barsMarkup: () => '' });
      window.auditAdmin = createFiscalAdmin(options); window.auditAdmin.enter();
      document.querySelector('#loginView').hidden = true; document.querySelector('#appShell').hidden = false;
      for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== 'view-fiscal';
      window.auditWorkspace.reset(); window.auditWorkspace.setPanel('corrections'); await window.auditWorkspace.refreshCorrections();
    }, { drafts: [draft('new'), draft('old')], USER });
    assert.equal(await page.locator('#fiscalCorrectionsList img').count(), 0); assert.equal(await page.evaluate(() => window.auditXss), undefined);
    assert.match(await page.locator('#fiscalCorrectionsList').innerText(), /new-fixture-error/); assert.doesNotMatch(await page.locator('#fiscalCorrectionsList').innerText(), /old-fixture-error/);
    await page.locator('[data-fiscal-retry]').click(); assert.deepEqual(await page.evaluate(() => window.auditRetries), [[ID, 'fiscalCorrection:new']]);
    await page.evaluate(value => window.auditWorkspace.syncChanged(value), draft('old', 'confirmed')); assert.equal(await page.locator('[data-fiscal-correct]').count(), 1); assert.equal(await page.locator('#fiscalCorrectionCount').innerText(), '1');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(evidence, name + '-corrections.png'), fullPage: true });
    assert.equal(await page.evaluate(async () => (await (await import('./db.js')).getFiscalCorrectionDrafts('Fiscal Fixture', 'acl-fixture')).length), 2);
    await page.locator('#fiscalAdminToggle').click(); await page.locator('[data-fiscal-edit]').waitFor(); await page.locator('.fiscal-master-password summary').click();
    await page.locator('#fiscalMasterCurrentPassword').fill('fixture-current-password'); await page.locator('#fiscalMasterNewPassword').fill('fixture-next-password'); await page.locator('#fiscalMasterPasswordConfirm').fill('fixture-next-password');
    const returned = new Promise(resolve => { passwordResponse = resolve; }); await page.locator('#fiscalMasterPasswordForm button[type="submit"]').click();
    await page.locator('#fiscalAdminStatus').filter({ hasText: 'Alterando senha' }).waitFor(); assert.equal(await page.locator('#fiscalMasterNewPassword').isDisabled(), true);
    assert.equal(await page.locator('#fiscalMasterCurrentPassword').inputValue(), ''); passwordRelease(); await returned;
    await page.locator('#fiscalAdminStatus').filter({ hasText: 'Fixture recoverable failure' }).waitFor(); assert.equal(await page.locator('#fiscalMasterNewPassword').isDisabled(), false);
    await page.evaluate(() => { window.auditSession = null; window.auditRevision++; window.auditWorkspace.reset(); window.auditAdmin.reset(); });
    assert.equal(await page.locator('#fiscalCorrectionsList').innerText(), ''); assert.equal(await page.locator('#fiscalAccountsList').innerText(), '');
    checks.push({ viewport: name, actualDom: true, actualIndexedDB: true, isolatedDraftRoutes: true, oldConfirmationPreservesCurrent: true, safeHtml: true, draftsPreserved: 2, passwordLoadingAndError: true, logoutClearsPanels: true, overflow: false });
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
const result = { total: checks.length, passed: checks.length, failed: 0, checks, errors, actions, privateAppsScriptExecuted: false, operationalLogins: 0, productionRequests: 0, productionWrites: 0, physicalSafariTested: false };
await writeFile(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
