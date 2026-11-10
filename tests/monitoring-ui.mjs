import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureFactory, id, mountPrivateMonitor } from './chaves-fixtures.mjs';
import { APP_VERSION } from '../core.js';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = path.resolve(root, '../.bq-evidence');
await mkdir(evidence, { recursive: true });
const make = await fixtureFactory(await readFile(process.argv[2], 'utf8'));
const files = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const relative = new URL(request.url, 'http://fixture').pathname.slice(1) || 'index.html';
    const source = await readFile(new URL('../' + relative, import.meta.url));
    response.writeHead(200, { 'Content-Type': files[path.extname(relative)] || 'text/html' }).end(source);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], checks = [], timings = [];

try {
  for (const width of [1440, 390, 320]) {
    const h = make(), { c } = h, { APP, COL } = c.meta;
    const props = new Map();
    h.grant();
    mountPrivateMonitor(h);
    c.CacheService = { getScriptCache: () => ({ get: key => props.get(key) || null, put: (key, value) => props.set(key, value),
      getAll: keys => Object.fromEntries(keys.filter(key => props.has(key)).map(key => [key, props.get(key)])), remove: key => props.delete(key) }) };
    c.LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) };
    c.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: content => ({ content, setMimeType() { return this; } }) };
    c.instalarMonitoramentoBQ();
    c.credentialHash_ = () => createHash('sha256').update('fixture-password').digest('hex');
    c.readTeamDirectory_ = () => [{ base: 'CAICÓ', team: 'LM A', crewLeader: 'Chefe A' }];
    const post = payload => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(payload) } }).content);
    const now = new Date().toISOString();
    h.add(1, { date: now });
    h.add(2, { date: now, status: 'FOTOS_SENDO_SINCRONIZADAS' });
    h.setAudit(2, { ...h.audit(2), lastDataConfirmation: now });
    h.add(3, { date: now });
    h.request(3);
    const older = new Date(Date.now() - 73 * 3600000).toISOString();
    const audit = h.audit(3);
    audit.lastCorrectionRequest.requestedAt = older;
    h.setAudit(3, audit);
    h.add(4, { date: '2026-10-31T23:00:00-03:00', status: 'PUBLICADA', total: 990 });
    h.sheet(APP.officialSheet).appendRow(h.row(4).slice());
    h.sheet(APP.pendingSheet).rows.pop();
    h.setAudit(1, { ...h.audit(1), supervisorCorrections: [{ supervisor: 'Supervisor A', correctedAt: now,
      changes: [{ field: 'PG do poste retirado', previousValue: '0001', newValue: '0002' }, { field: 'Total da ocorrência', previousValue: '100', newValue: '125' }] }] });
    const logged = post({ action: 'login', user: 'Fiscal A', role: 'fiscal', password: 'fixture-password', clientVersion: APP_VERSION });
    post({ action: 'presenceHeartbeat', token: logged.token, base: 'CAICÓ' });
    c.bqTechnicalError_('localSync', 'LOCAL_PHOTO_READ_ERROR', { role: 'field' }, id(2), randomUUID(), APP_VERSION, 'APLICATIVO');
    const actions = [];
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Bahia', locale: 'pt-BR', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url().startsWith(origin)) return route.continue();
      let result;
      if (request.url().startsWith('https://script.google.com/macros/')) {
        const payload = request.method() === 'GET' ? { action: 'health' } : JSON.parse(request.postData() || '{}');
        actions.push(payload.action);
        result = post(payload);
      } else if (request.url().startsWith('https://api.github.com/repos/engenhsoft/ocorrencias-bq/actions/')) {
        result = { workflow_runs: [{ id: 42272445580, head_branch: 'main', conclusion: 'success', head_sha: '584d8018b9474bad1acdabb32e023fccfa52e461',
          display_title: 'Publicação de teste', updated_at: now }] };
      } else return route.abort();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(width + ' ' + error.message));
    for (const [id, selector] of [['releaseNoticeDialog', '#releaseNoticeAcknowledge'], ['entryPendingDialog', '[value="dismiss"]']]) {
      await page.addLocatorHandler(page.locator('#' + id + '[open]'), async () => {
        await page.locator('#' + id).locator(selector).evaluate(button => button.click());
      });
    }
    const started = performance.now();
    await page.goto(origin);
    await page.locator('#loginButton').waitFor();
    const login = async (role, user) => {
      await page.locator('input[name="role"][value="' + role + '"]').check();
      await page.locator('#loginUser').fill(user);
      await page.locator('#loginPassword').fill('fixture-password');
      await page.locator('#loginButton').click();
      await page.locator('#appShell').waitFor({ state: 'visible' });
      await page.evaluate(() => document.querySelector('#releaseNoticeDialog')?.open && document.querySelector('#releaseNoticeDialog').close());
    };
    await login('supervisor', 'Supervisor A');
    timings.push({ width, loadToSupervisorMs: Math.round(performance.now() - started) });
    assert.equal(actions.filter(action => action === 'supervisorMonitor').length, 0);
    await page.locator('#supervisorMonitorButton').click();
    const panel = page.locator('#monitorDialog');
    const expectText = (selector, value) => page.locator(selector).getByText(value, { exact: false }).first().waitFor();
    await expectText('#monitorResults', 'Fotos pendentes');
    await panel.locator('[data-monitor-section="late"]').click();
    await expectText('#monitorResults', 'Mais de 72 horas');
    await panel.locator('[data-monitor-section="online"]').click();
    await expectText('#monitorResults', 'Conta Fiscal autenticada');
    await panel.locator('[data-monitor-section="access"]').click();
    await expectText('#monitorResults', 'LOGIN CONFIRMADO');
    await panel.locator('[data-monitor-section="errors"]').click();
    await expectText('#monitorResults', 'LOCAL_PHOTO_READ_ERROR');
    await panel.locator('[data-monitor-section="history"]').click();
    await panel.getByText('Histórico de versões publicadas').click();
    await expectText('#monitorResults', 'Publicação de teste');
    await panel.locator('[data-monitor-section="health"]').click();
    await panel.locator('[data-monitor-diagnosis="' + id(2) + '"]').click();
    await expectText('#monitorResults', 'DADOS CONFIRMADOS — FOTOS PENDENTES');
    await expectText('#monitorResults', 'ESTADO LOCAL NÃO VERIFICÁVEL PELO SERVIDOR');
    await page.screenshot({ path: path.join(evidence, 'diagnostico-' + width + '.png') });
    await panel.getByRole('button', { name: 'Fechar monitoramento' }).click();
    await page.locator('#supervisorList [data-review-record="' + id(1) + '"]').click();
    await page.locator('#compareCorrectionButton').click();
    await expectText('#monitorResults', 'PG do poste retirado');
    await expectText('#monitorResults', '0001');
    await expectText('#monitorResults', '0002');
    await panel.getByRole('button', { name: 'Fechar monitoramento' }).click();
    await page.locator('#reviewDialog').getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.locator('#financialPeriod').selectOption('custom');
    await page.locator('#financialFrom').fill('2026-10-31');
    await page.locator('#financialTo').fill('2026-10-31');
    await expectText('#financialChart', '990,00');
    await page.locator('#appShell [data-compatibility]').click();
    await expectText('#compatibilityDialog', 'ATUALIZADO');
    await page.getByRole('button', { name: 'Fechar compatibilidade' }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 ? []
      : [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 15).map(node => node.id || node.className || node.tagName));
    assert.deepEqual(overflow, [], 'overflow em ' + width);
    checks.push(width + ' Supervisor: seis módulos, diagnóstico, comparação, datas e versões');

    await page.locator('#logoutButton').click();
    await login('field', 'Campo A');
    await page.evaluate(async ({ version, own, other }) => {
      const db = await import('./db.js?v=' + version);
      for (const [recordId, user] of [[own, 'Campo A'], [other, 'Outro Campo']]) {
        const record = await db.putRecord({ recordId, user, occurrenceNumber: 'FILA-' + recordId.slice(0, 8), base: 'CAICÓ', occurrenceTypes: ['PODA'],
          status: 'PENDENTE_ENVIO', syncPhase: 'saved', attempts: 3, registeredAt: new Date().toISOString() });
        await db.putPhotoAndRecord(record, 1, new Blob(['fixture'], { type: 'image/jpeg' }), crypto.randomUUID());
      }
    }, { version: APP_VERSION, own: id(51), other: id(52) });
    await context.setOffline(true);
    await page.locator('#mainNav [data-nav="sync"]').click();
    await expectText('#syncQueueList', 'AGUARDANDO CONEXÃO');
    assert.ok((await page.locator('#syncQueueList').innerText()).includes(id(51)));
    assert.ok(!(await page.locator('#syncQueueList').innerText()).includes(id(52)));
    await context.setOffline(false);
    await expectText('#syncQueueList', 'SALVO LOCALMENTE');
    await page.locator('#logoutButton').click();

    await login('fiscal', 'Fiscal A');
    await page.locator('[data-fiscal-panel="corrections"]').click();
    await page.locator('#fiscalSyncQueue').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#supervisorMonitorButton').isVisible(), false);
    await expectText('#fiscalSyncQueue', 'Nenhum envio de correção pendente');
    const account = c.fiscalAccount_('Fiscal A');
    const expiredToken = c.createToken_('Fiscal A', 'fiscal', Date.now() - 1000, account.revision);
    await page.evaluate(token => {
      const key = 'ocorrencias-bq-session-v1';
      const session = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...session, token }));
    }, expiredToken);
    await page.reload();
    await page.locator('#loginView').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#appShell').isVisible(), false);
    checks.push(width + ' Campo/Fiscal: visibilidade, fila local, foto, offline e reconexão');
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), checks, timings, errors }, null, 2));
} finally {
  await browser.close();
  server.close();
}
