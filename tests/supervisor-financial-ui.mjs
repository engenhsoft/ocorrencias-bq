// Local app + synthetic sessions. Every external request is intercepted or denied.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = path.resolve(new URL('../', import.meta.url).pathname), evidence = path.resolve(root, '../evidence/finance-ui');
await mkdir(evidence, { recursive: true });
const at = '2026-10-14T12:00:00-03:00', id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const record = (n, totalServices, extras = {}) => ({ recordId: id(n), status: 'PUBLICADA', registeredAt: at, base: 'CAICÓ', crewLeader: 'Chefe FICTÍCIO A', totalServices, audit: {}, ...extras });
const financialRecords = [record(1, 80, { audit: { contractRecalculations: [{ recalculatedAt: '2026-10-10T12:00:00-03:00', previousTotal: 120, newTotal: 100 }], supervisorCorrections: [{ correctedAt: at, changes: [{ field: 'Total da ocorrência', previousValue: '100', newValue: '80' }] }] } }), record(2, 50), record(3, 200, { base: 'MOSSORÓ', crewLeader: 'Chefe FICTÍCIO B', registeredAt: '2026-09-10T12:00:00-03:00' }), record(4, 999, { status: 'REPROVADA' }), record(5, 100, { base: 'MOSSORÓ', crewLeader: 'Chefe FICTÍCIO B' })];
const summary = { month: '2026-10', calculatedAt: at, top3: [], bases: { month: [], all: [] }, nonconformity: { month: {}, all: {} }, conformityRecords: [], financialRecords };
const server = createServer(async (request, response) => { try { const file = path.resolve(root, decodeURIComponent(new URL(request.url, 'http://fixture').pathname).slice(1) || 'index.html'); if (!file.startsWith(root + path.sep)) throw Error('Forbidden'); response.setHeader('Content-Type', /\.js$/.test(file) ? 'application/javascript' : /\.css$/.test(file) ? 'text/css' : /\.png$/.test(file) ? 'image/png' : /\.webmanifest$/.test(file) ? 'application/manifest+json' : 'text/html'); response.end(await readFile(file)); } catch { response.statusCode = 404; response.end('Not found'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, calls = [], pageErrors = [], checks = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.OCCBQ_CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage', '--disable-webgl'], headless: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    let omitFinancial = false, delayedSummary = null;
    const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Bahia', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request(); if (request.url().startsWith(origin)) return route.continue();
      if (!request.url().startsWith('https://script.google.com/macros/')) return route.abort();
      const payload = request.method() === 'GET' ? { action: 'health' } : JSON.parse(request.postData() || '{}'); calls.push(payload.action);
      let result;
      if (payload.action === 'health') result = { service: 'OCORRÊNCIAS B&Q', version: 'fixture' };
      else if (payload.action === 'login') result = { user: 'Perfil FICTÍCIO', role: payload.role, token: 'fixture-' + payload.role, bases: ['CAICÓ'], expiresAt: new Date(Date.now() + 3600000).toISOString() };
      else if (payload.action === 'getTeamDirectory') result = { entries: [{ base: 'CAICÓ', team: 'LM FICTÍCIA', crewLeader: 'Chefe FICTÍCIO A' }], revision: 'fixture', fetchedAt: at };
      else if (payload.action === 'listPending') result = { records: [], pendingRecords: [], metricRecords: [] };
      else if (payload.action === 'listMine') result = { records: [] };
      else if (payload.action === 'getDailyTeamProduction') result = { totalSent: 0, goal: 6000, count: 0 };
      else if (payload.action === 'getOperationalSummary') { result = structuredClone(summary); if (payload.token !== 'fixture-supervisor' || omitFinancial) delete result.financialRecords; if (delayedSummary) await delayedSummary; }
      else if (payload.action === 'listFiscalCorrections') result = { records: [], bases: ['CAICÓ'] };
      else if (payload.action === 'listFiscalRecords') result = { records: [], bases: ['CAICÓ'], nextOffset: null, summary: { total: 0, waiting: 0, published: 0, correction: 0, rejected: 0, photoPending: 0, eligibleValue: 0 }, calculatedAt: at };
      else throw Error('Unmocked action: ' + payload.action);
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, success: true, ...result }) });
    });
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin);
    const login = async role => { await page.locator(`input[name="role"][value="${role}"]`).check(); await page.locator('#loginUser').fill('Perfil FICTÍCIO'); await page.locator('#loginPassword').fill('fixture-only'); await page.locator('#loginButton').click(); await page.locator('#appShell').waitFor({ state: 'visible' }); if (await page.locator('#releaseNoticeDialog').isVisible()) await page.locator('#releaseNoticeAcknowledge').click(); };
    const chartText = async () => (await page.locator('#financialChart').innerText()).replace(/\s/g, ' ');
    await login('supervisor'); await page.locator('#financialChart .financial-bar').waitFor();
    assert.equal(await page.locator('#financialSection').count(), 1); assert.equal(await page.locator('#financialChart').count(), 1);
    assert.equal(await page.locator('#financialPeriod').inputValue(), 'month'); assert.match(await chartText(), /3 ocorrências publicadas/); assert.match(await chartText(), /230,00/);
    const currentHeight = (await page.locator('#financialChart').evaluate(element => element.getBoundingClientRect().height));
    await page.locator('[data-financial-view="comparison"]').click(); assert.equal(await page.locator('#financialChart .financial-bar').count(), 2); assert.match(await chartText(), /270,00/); assert.match(await chartText(), /230,00/); assert.match(await chartText(), /-R\$ 40,00/);
    assert.equal(await page.locator('[data-financial-view="comparison"]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#financialChart').evaluate(element => element.getBoundingClientRect().height), currentHeight);
    await page.locator('#financialPeriod').selectOption('all'); assert.match(await chartText(), /4 ocorrências publicadas/); assert.match(await chartText(), /470,00/); assert.match(await chartText(), /430,00/);
    await page.locator('#financialBase').selectOption('CAICÓ'); await page.locator('#financialLeader').selectOption('Chefe FICTÍCIO A'); assert.match(await chartText(), /2 ocorrências publicadas/); assert.match(await chartText(), /170,00/); assert.match(await chartText(), /130,00/);
    await page.locator('[data-financial-view="current"]').click(); assert.equal(await page.locator('#financialChart .financial-bar').count(), 1); assert.match(await chartText(), /130,00/); assert.equal(await page.locator('#financialPeriod').inputValue(), 'all'); assert.equal(await page.locator('#financialBase').inputValue(), 'CAICÓ'); assert.equal(await page.locator('#financialLeader').inputValue(), 'Chefe FICTÍCIO A');
    await page.locator('[data-financial-view="comparison"]').click(); await page.locator('[data-refresh-insights]').click(); await page.locator('#financialChart .financial-bar').first().waitFor(); assert.equal(await page.locator('#financialPeriod').inputValue(), 'all'); assert.equal(await page.locator('#financialBase').inputValue(), 'CAICÓ');
    await page.locator('#financialBase').selectOption(''); await page.locator('#financialLeader').selectOption(''); await page.locator('#financialPeriod').selectOption('2026-09'); assert.match(await chartText(), /1 ocorrência publicada/); assert.match(await chartText(), /200,00/);
    await page.locator('#financialPeriod').selectOption('all');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.locator('#financialSection').screenshot({ path: path.join(evidence, `${name}-comparison.png`) });
    omitFinancial = true; await page.locator('[data-refresh-insights]').click(); await page.locator('#financialChart').filter({ hasText: 'Histórico financeiro confirmado indisponível' }).waitFor(); assert.equal(await page.locator('#financialChart .financial-bar').count(), 0);
    await page.locator('#logoutButton').click(); assert.equal(await page.locator('#financialSection').isVisible(), false); assert.equal(await page.locator('#financialChart').innerText(), '');
    await login('fiscal'); await page.locator('#fiscalList').waitFor(); assert.equal(await page.locator('#financialSection').isVisible(), false);
    await page.locator('#logoutButton').click(); await login('field'); assert.equal(await page.locator('#financialSection').isVisible(), false); assert.equal(await page.locator('#financialChart').innerText(), '');
    await page.locator('#logoutButton').click(); omitFinancial = false;
    let releaseSummary; delayedSummary = new Promise(resolve => { releaseSummary = resolve; }); await login('supervisor'); await page.locator('#logoutButton').click(); releaseSummary(); delayedSummary = null; await page.locator('#loginView').waitFor({ state: 'visible' }); assert.equal(await page.locator('#financialChart').innerText(), ''); assert.equal(await page.locator('#financialSection').isVisible(), false);
    checks.push({ viewport: name, filters: true, sharedChart: true, stableChartHeight: true, togglePreservesFilters: true, refreshPreservesFilters: true, emptyHistoryDoesNotInventTotals: true, profilesIsolated: true, staleResponseIgnored: true, overflow: false }); await context.close();
  }
  assert.deepEqual(pageErrors, []);
  assert.equal(calls.some(action => ['submitRecord', 'uploadPhoto', 'supervisorAction', 'supervisorCorrectRecord', 'approveBatch'].includes(action)), false);
  const output = { checks, pageErrors, operationalLogins: 0, productionWrites: 0, calls: calls.length }; await writeFile(path.join(evidence, 'results.json'), JSON.stringify(output, null, 2)); console.log(JSON.stringify(output, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
