import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { APP_VERSION } from '../core.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const backend = await readFile(process.argv[2], 'utf8');
const suite = await readFile(new URL('./publication-reconciliation.mjs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const id = number => `${String(number).padStart(8, '0')}-4141-4141-8141-111111111111`;
const actor = 'Supervisor Fixture';
const source = suite.slice(suite.indexOf('function sharedStore('), suite.indexOf('function assertComplete('));
const make = vm.runInNewContext(source + '\nharness', { vm, assert, plain, backend, createHash, UUID: id(1) });
const token = Buffer.from(JSON.stringify({ role: 'supervisor', user: actor, exp: Date.now() + 600_000 })).toString('base64url') + '.fixture';
const assets = new URL('../', import.meta.url);
const contentTypes = { js: 'text/javascript', css: 'text/css', html: 'text/html', json: 'application/json', png: 'image/png', webmanifest: 'application/manifest+json' };

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.replace(/^\//, '') || 'index.html';
  if (!/^(?:assets\/|vendor\/)?[a-zA-Z0-9_][.\w-]*$/.test(path)) { response.writeHead(404).end(); return; }
  try { response.writeHead(200, { 'Content-Type': contentTypes[path.split('.').at(-1)] }).end(await readFile(new URL(path, assets))); }
  catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const placeholder = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
let browser;
const results = [];
try {
  browser = await chromium.launch({ executablePath: process.env.OCCBQ_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
  for (const scenario of ['individual', 'batch']) {
    const individual = scenario === 'individual';
    const context = await browser.newContext({
      viewport: individual ? { width: 1366, height: 900 } : { width: 390, height: 844 },
      timezoneId: 'America/Fortaleza'
    });
    try {
      const h = make({ actor });
      const { APP, COL } = h.meta;
      const services = [0, 1].map(n => ({ lineId: id(n + 101), code: 'S00' + (n + 1), catalogKey: 'Emergência:' + (n + 3),
        catalogText: 'Serviço Fixture ' + n, unit: 'UD', group: 'Grupo Fixture', contract: '4600080938', origin: 'Emergência',
        quantity: 1.005, referenceValue: 9, totalValue: 9.05 }));
      const record = { recordId: id(1), occurrenceNumber: 'FIXTURE-01', user: 'Campo Fixture', base: 'CAICÓ', team: 'LM FIXTURE',
        crewLeader: 'Chefe Fixture', contract: '4600080938', occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE'],
        pgPostRemoved: '000000', pgPostInstalled: '001122', transformer: {}, observation: 'Fixture',
        totalServices: 18.10, services, materials: [{ code: '000123', description: 'Material Fixture', unit: 'UD', quantity: 1 }],
        registeredAt: new Date().toISOString() };
      h.seed(record);
      if (!individual) {
        h.seed({ ...record, recordId: id(2), occurrenceNumber: 'FIXTURE-02' });
        const pending = h.rows(APP.pendingSheet).find(row => row[0] === record.recordId);
        const audit = JSON.parse(pending[COL.AUDIT - 1]);
        audit.lastCorrectionSubmission = { phase: 'COMPLETE', dataVerifiedAt: record.registeredAt,
          expectedFingerprint: h.c.correctionFingerprint_(h.c.correctionDataFromValues_(pending)) };
        pending[COL.AUDIT - 1] = JSON.stringify(audit);
        const { expected } = h.plan(record.recordId);
        expected.main[COL.PG_POST_REMOVED - 1] = 0;
        h.add(APP.officialSheet, [expected.main]);
        h.add(APP.servicesSheet, expected.services);
        h.add(APP.materialsSheet, expected.materials);
      }
      h.parseLeadingZeros = true;
      await context.addInitScript(({ token, actor, version }) => {
        localStorage.setItem('ocorrencias-bq-session-v1', JSON.stringify({ role: 'supervisor', user: actor, token }));
        localStorage.setItem(`ocorrencias-bq-update-notice-seen-${version}`, '1');
      }, { token, actor, version: APP_VERSION });
      const requests = [];
      let responseLost = false;
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin) return route.continue();
        if (url.hostname === 'example.test') return route.fulfill({ contentType: 'image/gif', body: placeholder });
        if (url.hostname !== 'script.google.com') return route.abort();
        const params = request.postDataJSON() || {};
        requests.push(params.action || 'health');
        const handlers = { getRecordState: h.c.getRecordState_, listPending: h.c.listPending_,
          listPublishedRecords: h.c.listPublishedRecords_, supervisorAction: h.c.supervisorAction_ };
        let response;
        try {
          response = request.method() === 'GET' ? h.c.health_() : handlers[params.action]
            ? handlers[params.action](params)
            : { ok: true, entries: [{ base: record.base, team: record.team, crewLeader: record.crewLeader }] };
          if (individual && params.action === 'supervisorAction' && !responseLost) {
            responseLost = true;
            return route.abort('failed');
          }
        } catch (error) { response = { ok: false, error: error.code || 'SERVER_ERROR', message: error.message, details: error.details }; }
        return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, json: response });
      });
      const page = await context.newPage();
      await page.goto(origin);
      const card = page.locator('.supervisor-card').filter({ hasText: record.occurrenceNumber });
      const occurrenceValue = card.locator('.record-meta').filter({ hasText: 'Valor desta ocorrência' });
      await occurrenceValue.getByText('R$ 18,10', { exact: true }).waitFor();
      if (individual) {
        await card.getByRole('button', { name: 'Conferir ocorrência' }).click();
        await page.locator('#approveButton').click();
        await page.locator('#confirmActionButton').click();
      } else {
        await card.getByRole('checkbox').check();
        await page.locator('.supervisor-card').filter({ hasText: 'FIXTURE-02' }).getByRole('checkbox').check();
        await page.locator('#approveSelectedButton').click();
        await page.locator('#confirmActionButton').click();
        await page.locator('#supervisorBatchResult').getByText('2 sucesso(s) · 0 falha(s)').waitFor();
      }
      await card.waitFor({ state: 'detached' });
      const expectedCount = individual ? 1 : 2;
      assert.equal(h.rows(APP.officialSheet).length, expectedCount);
      assert.equal(h.rows(APP.pendingSheet).length, 0);
      assert.equal(h.rows(APP.servicesSheet).length, expectedCount * services.length);
      assert.equal(h.rows(APP.materialsSheet).length, expectedCount);
      assert.equal(h.rows(APP.historySheet).filter(row => row[3] === 'APROVADA_E_PUBLICADA').length, expectedCount);
      const state = h.c.getRecordState_({ token, recordId: record.recordId });
      assert.equal(state.integrity.state, 'INTEGRITY_OK');
      assert.equal(state.integrity.pendingCopies, 0);
      assert.equal(state.record.pgPostRemoved, '000000');
      assert.equal(state.record.totalServices, 18.1);
      if (individual) assert.ok(responseLost && requests.includes('getRecordState'));
      else assert.ok(state.record.audit.publicationIdentifierRecovery.confirmedAt);
      results.push({ scenario, width: individual ? 1366 : 390, published: expectedCount, responseLost, integrity: state.integrity.state });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ chromium: browser.version(), productionWrites: 0, results }));
} finally {
  await browser?.close();
  server.close();
}
