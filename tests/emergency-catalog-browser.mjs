import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { APP_VERSION } from '../core.js';
import { extract, fixtureFactory, id, plain } from './chaves-fixtures.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const make = await fixtureFactory(await readFile(process.argv[2], 'utf8'));
const sources = new URL('../', import.meta.url);
const persistence = await readFile(new URL('./correction-persistence.mjs', import.meta.url), 'utf8');
const fakePhotoDrive = vm.runInNewContext(extract(persistence, 'fakePhotoDrive') + '\nfakePhotoDrive', { Buffer });
const contract = '4600080938';
const user = 'Campo Fixture';
const token = Buffer.from(JSON.stringify({ role: 'field', user, exp: Date.now() + 600_000 })).toString('base64url') + '.fixture';
const types = { js: 'text/javascript', html: 'text/html', css: 'text/css', json: 'application/json', png: 'image/png', webmanifest: 'application/manifest+json' };
const server = createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.replace(/^\//, '') || 'index.html';
  if (!/^(?:assets\/|vendor\/)?[a-zA-Z0-9_][.\w-]*$/.test(name)) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(new URL(name, sources));
    response.writeHead(200, { 'Content-Type': types[name.split('.').at(-1)] || 'application/octet-stream' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
const checks = [];
try {
  browser = await chromium.launch({ executablePath: process.env.OCCBQ_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
  for (const mode of ['desktop', 'mobile']) {
    const context = await browser.newContext({ viewport: mode === 'mobile' ? { width: 390, height: 844 } : { width: 1366, height: 900 }, timezoneId: 'America/Fortaleza' });
    try {
      const h = make();
      const { APP } = h.c.meta;
      const catalog = h.sheet(APP.catalogSheet);
      const drive = fakePhotoDrive(h);
      catalog.rows.splice(2, catalog.rows.length, ['S001', 'Primeiro serviço', 'UD', 'Grupo', '', '', '', '17,35', '20,41'],
        ['S002', 'Segundo serviço', 'UD', 'Grupo', '', '', '', '12,50', '14,00']);
      h.c.requireSession_ = () => ({ role: 'field', user });
      h.c.assertTeamDirectorySelection_ = () => {};
      const picked = plain(h.c.searchCatalog_({ token, query: 'serviço', contract }).results);
      assert.equal(picked.length, 2);
      const data = {
        recordId: id(940), occurrenceNumber: 'FIXTURE-0001', user, base: 'CURRAIS NOVOS', team: 'Equipe Fixture',
        crewLeader: 'Chefe Fixture', contract, occurrenceTypes: ['PODA'], transformer: {}, observation: 'Observação preservada',
        status: 'ERRO_SINCRONIZACAO', syncPhase: 'error', attempts: 3, lastError: 'O serviço 2 diverge da aba Emergência. Pesquise novamente.',
        services: picked.map((service, index) => ({ ...service, lineId: id(index + 1), quantity: 2, totalValue: service.referenceValue * 2 })),
        totalServices: 59.7, materials: [{ code: '000002', description: 'Material Fixture', unit: 'UD', quantity: 1 }],
        photoStates: Array.from({ length: 7 }, (_, index) => ({ photoIndex: index + 1, localReady: index < 5, confirmed: false, uploadKey: index < 5 ? id(100 + index) : '' }))
      };
      catalog.rows.splice(3, 0, ['S003', 'Linha inserida', 'UD', 'Grupo', '', '', '', '4,00', '4,00']);
      if (mode === 'mobile') catalog.rows[4][7] = '15,00';
      const requests = [];
      await context.route('**/*', async route => {
        const request = route.request();
        if (new URL(request.url()).origin === origin) return route.continue();
        if (!request.url().startsWith('https://script.google.com/macros/')) return route.abort();
        const p = request.postDataJSON() || {};
        requests.push({ action: p.action || 'health', photoIndex: p.photoIndex });
        const secondary = { listMine: { records: [] }, getTeamDirectory: { entries: [{ base: data.base, team: data.team, crewLeader: data.crewLeader }] },
          getDailyTeamProduction: { goal: 6000, totalExcludingRecord: 0 }, presenceHeartbeat: {}, reportClientErrors: {} };
        const handlers = { searchCatalog: h.c.searchCatalog_, submitRecord: h.c.submitRecord_, getRecordState: h.c.getRecordState_, uploadPhoto: h.c.uploadPhoto_ };
        let response;
        try {
          response = request.method() === 'GET' ? h.c.health_()
            : handlers[p.action] ? handlers[p.action](p) : { ok: true, ...secondary[p.action] };
        } catch (error) { response = { ok: false, error: error.code || 'SERVER_ERROR', message: error.message, details: error.details }; }
        return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, json: response });
      });
      const page = await context.newPage();
      await page.goto(origin);
      await page.evaluate(async ({ version, data, token }) => {
        const store = await import(`/db.js?v=${version}`);
        await store.putRecord(data);
        for (const photo of data.photoStates.filter(photo => photo.localReady)) {
          await store.putPhotoAndRecord(data, photo.photoIndex, new Blob(['photo-' + photo.photoIndex], { type: 'image/jpeg' }), photo.uploadKey);
        }
        localStorage.setItem('ocorrencias-bq-session-v1', JSON.stringify({ role: 'field', user: data.user, token }));
        localStorage.setItem(`ocorrencias-bq-update-notice-seen-${version}`, '1');
      }, { version: APP_VERSION, data, token });
      await page.reload();
      await page.locator('#entryPendingDialog').getByRole('button', { name: 'Dispensar por enquanto' }).click();
      await page.locator('[data-nav="sync"]').click();
      const queue = page.locator('#syncQueueList');
      await queue.getByRole('button', { name: 'Verificar catálogo e sincronizar' }).waitFor();
      assert.equal(requests.filter(item => item.action === 'submitRecord').length, 0);
      await queue.getByRole('button', { name: 'Verificar catálogo e sincronizar' }).click();
      if (mode === 'mobile') {
        await queue.getByRole('button', { name: 'Revisar serviço 2' }).waitFor();
        assert.equal(drive.created(), 0);
        assert.equal(h.sheet(APP.pendingSheet).getLastRow(), 1);
        const blobs = await page.evaluate(async ({ version, recordId }) => {
          const store = await import(`/db.js?v=${version}`);
          return Promise.all((await store.getPhotosForRecord(recordId)).map(async photo => [photo.photoIndex, photo.uploadKey, await photo.blob.text()]));
        }, { version: APP_VERSION, recordId: data.recordId });
        assert.deepEqual(blobs, data.photoStates.slice(0, 5).map(photo => [photo.photoIndex, photo.uploadKey, 'photo-' + photo.photoIndex]));
        await page.locator('#syncNowButton').click();
        assert.equal(requests.filter(item => item.action === 'submitRecord').length, 1);
        await queue.getByRole('button', { name: 'Revisar serviço 2' }).click();
        const dialog = page.locator('#mineDetailDialog');
        await dialog.getByRole('option', { name: /S002.*15,00/ }).waitFor({ state: 'attached' });
        await dialog.getByLabel('Serviço no catálogo').selectOption({ label: await dialog.getByRole('option', { name: /S002.*15,00/ }).textContent() });
        await dialog.getByRole('button', { name: 'Salvar e sincronizar' }).click();
      }
      await queue.getByText('CONCLUÍDO', { exact: true }).waitFor();
      const state = h.c.getRecordState_({ token, recordId: data.recordId });
      assert.equal(state.recordId, data.recordId);
      assert.equal(state.record.observation, data.observation);
      assert.equal(state.record.totalServices, mode === 'mobile' ? 64.7 : 59.7);
      assert.deepEqual(plain(state.photoStates.slice(0, 5).map(photo => photo.uploadKey)), data.photoStates.slice(0, 5).map(photo => photo.uploadKey));
      assert.deepEqual(requests.filter(item => item.action === 'uploadPhoto').map(item => item.photoIndex), [1, 2, 3, 4, 5]);
      assert.equal(drive.created(), 5);
      assert.equal(h.sheet(APP.pendingSheet).getLastRow(), 2);
      checks.push({ mode, confirmedPhotos: 5, servers: 1, priceConfirmedByUser: mode === 'mobile' });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ chromium: browser.version(), cases: checks, productionWrites: 0 }));
} finally {
  await browser?.close();
  server.close();
}
