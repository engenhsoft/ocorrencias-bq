// Local fixture server, synthetic profiles and intercepted requests only.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url), { chromium } = require('playwright'), sharp = require('sharp'), ExcelJS = require('../vendor/exceljs-4.4.0.min.js');
const root = path.resolve(new URL('../', import.meta.url).pathname), evidence = path.resolve(root, '../evidence/evolution'); await mkdir(evidence, { recursive: true });
const uuid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const at = '2026-10-14T12:00:00-03:00';
const photoA = 'data:image/png;base64,' + (await sharp({ create: { width: 600, height: 300, channels: 3, background: '#237eb3' } }).png().toBuffer()).toString('base64');
const photoB = 'data:image/png;base64,' + (await sharp({ create: { width: 400, height: 800, channels: 3, background: '#cd962e' } }).png().toBuffer()).toString('base64');
const timeline = action => ({ action, actor: 'Supervisor FICTÍCIO', at });
function fixture(n, trafo = false, base = 'CAICÓ') {
  return { recordId: uuid(n), occurrenceNumber: 'FIXTURE-' + n, user: 'Campo FICTÍCIO', status: 'AGUARDANDO_SUPERVISOR', registeredAt: at, updatedAt: at, base, contract: '4600080938', team: 'LM FICTÍCIA', crewLeader: 'Chefe FICTÍCIO', occurrenceTypes: [trafo ? 'SUBSTITUIÇÃO DE TRAFO' : 'PODA'],
    transformer: trafo ? { removedCode: '000123', removedCia: '0012', removedBto: '0013', newCode: '000456', newCia: '0022', newBto: '0023' } : {},
    services: [{ code: '000123', lineId: 's-' + n, catalogText: 'Serviço histórico FICTÍCIO', unit: 'UN', quantity: 1.25, referenceValue: 10.5, totalValue: 13.125, contract: '4600080938' }], materials: [{ code: '000067', description: 'Material FICTÍCIO', unit: 'M', quantity: 2.75 }], totalServices: 13.125,
    photos: Array(5).fill(n === 2 ? photoB : photoA), photoCount: 5, transformerPhotos: trafo ? { removed: photoB, installed: photoB } : {},
    photoStates: Array.from({ length: 7 }, (_, i) => ({ photoIndex: i + 1, confirmed: i < 5 || trafo, url: i < 5 || trafo ? photoA : '', serverUrl: i < 5 || trafo ? photoA : '', uploadKey: 'fixture-' + i })),
    photoSlots: Array.from({ length: trafo ? 7 : 5 }, (_, i) => ({ photoIndex: i + 1, confirmed: true })), audit: { timeline: [] }, observation: 'Observação FICTÍCIA' };
}
const records = [fixture(1), fixture(2, true), fixture(3, false, 'MOSSORÓ')];
const fiscalRecords = [records[0], records[1], ...Array.from({ length: 59 }, (_, i) => fixture(i + 10))];
const conformityRecords = [{ ...records[0], audit: { timeline: [timeline('PUBLICADA')] } }, { ...records[1], audit: { timeline: [timeline('CORRIGIDA_PELO_SUPERVISOR'), timeline('PUBLICADA')] } }, { ...records[2], audit: { timeline: [timeline('REPROVADA'), timeline('CORRECAO_SOLICITADA')] } }];
const summary = { month: '2026-10', timeZone: 'America/Bahia', top3: [], calculatedAt: at, bases: { month: [{ label: 'CAICÓ', count: 2, percentage: 66.67 }, { label: 'MOSSORÓ', count: 1, percentage: 33.33 }], all: [{ label: 'CAICÓ', count: 2, percentage: 66.67 }] }, nonconformity: { month: { base: [], crewLeader: [] }, all: { base: [], crewLeader: [] } }, conformityRecords };
const server = createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url, 'http://fixture').pathname).slice(1) || 'index.html', file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw Error('Forbidden');
    response.setHeader('Content-Type', /\.js$/.test(file) ? 'application/javascript' : /\.css$/.test(file) ? 'text/css' : /\.png$/.test(file) ? 'image/png' : /\.webmanifest$/.test(file) ? 'application/manifest+json' : 'text/html'); response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
const calls = [], pageErrors = [], checks = []; let browser;
try {
  const packedModule = process.env.OCCBQ_CHROMIUM_PACKAGE ? require(process.env.OCCBQ_CHROMIUM_PACKAGE) : null;
  const packed = packedModule?.default || packedModule;
  if (packed) packed.setGraphicsMode = false;
  browser = await chromium.launch(packed ? { executablePath: process.env.OCCBQ_CHROMIUM_EXECUTABLE || await packed.executablePath(), args: packed.args.filter(arg => arg !== '--single-process'), headless: true } : process.env.OCCBQ_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OCCBQ_CHROMIUM_EXECUTABLE, headless: true } : { headless: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Bahia', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request(), url = request.url(); if (url.startsWith(origin)) return route.continue();
      if (!url.startsWith('https://script.google.com/macros/')) return route.abort();
      const payload = request.method() === 'GET' ? { action: 'health' } : JSON.parse(request.postData() || '{}'); calls.push({ viewport: name, ...payload, token: undefined });
      const role = (payload.token || '').replace('fixture-', ''); let result;
      if (payload.action === 'health') result = { service: 'OCORRÊNCIAS B&Q', version: '2026.10.14.3' };
      else if (payload.action === 'login') result = { user: payload.user, role: payload.role, token: 'fixture-' + payload.role, bases: payload.role === 'fiscal' ? ['CAICÓ'] : undefined, expiresAt: new Date(Date.now() + 3600000).toISOString() };
      else if (payload.action === 'getTeamDirectory') result = { entries: [{ base: 'CAICÓ', team: 'LM FICTÍCIA', crewLeader: 'Chefe FICTÍCIO' }], revision: 'fixture', fetchedAt: at };
      else if (payload.action === 'listPending') result = { records, pendingRecords: [], metricRecords: records.map(r => ({ recordId: r.recordId, status: r.status })) };
      else if (payload.action === 'listMine') result = { records: [records[0], records[1]] };
      else if (payload.action === 'getOperationalSummary') result = role === 'supervisor' ? summary : { month: summary.month, top3: [], calculatedAt: at };
      else if (payload.action === 'getDailyTeamProduction') result = { team: payload.team, date: payload.date, totalSent: 0, goal: 6000, count: 0 };
      else if (payload.action === 'listFiscalRecords') {
        const all = fiscalRecords.filter(r => (!payload.filters?.base || r.base === payload.filters.base) && (!payload.filters?.search || r.occurrenceNumber.includes(payload.filters.search)));
        const offset = payload.offset || 0;
        result = { records: all.slice(offset, offset + 60), bases: ['CAICÓ'], nextOffset: offset + 60 < all.length ? offset + 60 : null, summary: { total: all.length, waiting: all.length, published: 0, correction: 0, rejected: 0, photoPending: 0, eligibleValue: all.length * 13.125 }, calculatedAt: at };
      } else if (payload.action === 'getOccurrenceDocument' || payload.action === 'getDocumentPhoto') {
        const r = [...records, ...fiscalRecords].find(record => record.recordId === payload.recordId), allowed = r && (role !== 'fiscal' || r.base === 'CAICÓ') && (role !== 'field' || r.user === 'Campo FICTÍCIO');
        if (!allowed) result = { ok: false, error: 'FORBIDDEN', message: 'Base não autorizada.' };
        else if (payload.action === 'getOccurrenceDocument') result = { record: r };
        else result = { recordId: r.recordId, photoIndex: payload.photoIndex, available: true, dataUrl: r.recordId === uuid(2) ? photoB : photoA };
      } else result = { ok: false, error: 'UNMOCKED_ACTION', message: 'Ação não autorizada no harness: ' + payload.action };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, success: true, ...result }) });
    });
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push({ viewport: name, message: error.message })); await page.goto(origin);
    const login = async role => {
      await page.locator(`input[name="role"][value="${role}"]`).check(); await page.locator('#loginUser').fill(role === 'field' ? 'Campo FICTÍCIO' : 'Perfil FICTÍCIO'); await page.locator('#loginPassword').fill('fixture-only'); await page.locator('#loginButton').click(); await page.locator('#appShell').waitFor({ state: 'visible' });
      if (await page.locator('#releaseNoticeDialog').isVisible()) await page.locator('#releaseNoticeAcknowledge').click();
    };
    await login('supervisor');
    await page.locator('#rateChart .comparison-legend').waitFor(); await page.locator('#supervisorList [data-export-excel]').first().waitFor();
    assert.match(await page.locator('#rateChart').innerText(), /Aprovadas sem edição direta · 1/); assert.match(await page.locator('#rateChart').innerText(), /Corrigidas pelo Supervisor · 1/);
    const originalBaseChart = await page.locator('#baseChart').innerHTML();
    await page.locator('#rateShowRejected').check(); await page.locator('#rateShowRequested').check(); assert.match(await page.locator('#rateChart').innerText(), /Rejeitadas · 1/); assert.match(await page.locator('#rateChart').innerText(), /Correção solicitada à equipe · 1/);
    await page.locator('#rateChartBase').selectOption('CAICÓ'); await page.locator('#rateChartLeader').selectOption('Chefe FICTÍCIO'); await page.locator('#rateChartPeriod').selectOption('all'); await page.locator('#rateChartDimension').selectOption('crewLeader');
    assert.match(await page.locator('#rateChart').innerText(), /Rejeitadas · 0/); assert.equal(await page.locator('#rateChartPeriod').inputValue(), 'all'); assert.equal(await page.locator('#baseChart').innerHTML(), originalBaseChart);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ' page overflow'); await page.screenshot({ path: path.join(evidence, name + '-conformity.png'), fullPage: true });
    await page.locator(`#supervisorList [data-export-excel="${uuid(1)}"]`).click(); await page.locator('#excelDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#excelRecordList input:checked').count(), 1); await page.locator('#excelSearch').fill('FIXTURE-2'); assert.equal(await page.locator('#excelRecordList input').count(), 1); await page.locator('#excelSelectAll').check(); await page.locator('#excelSearch').fill('');
    assert.match(await page.locator('#excelSelectedCount').innerText(), /2 ocorrências/); await page.screenshot({ path: path.join(evidence, name + '-excel-selection.png') });
    const excelDownload = page.waitForEvent('download'); await page.locator('#generateExcelButton').click(); assert.equal(await page.locator('#generateExcelButton').isDisabled(), true);
    await page.locator('#generateExcelButton').dispatchEvent('click');
    const downloaded = await excelDownload, file = path.join(evidence, name + '-consolidado.xlsx'); await downloaded.saveAs(file); await page.locator('#excelStatus').filter({ hasText: 'Excel gerado' }).waitFor();
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(file)); assert.equal(workbook.getWorksheet('OCORRÊNCIAS').rowCount, 3); assert.equal(workbook.getWorksheet('FOTOGRAFIAS').getImages().length, 12);
    for (const image of workbook.getWorksheet('FOTOGRAFIAS').getImages()) { const uuidCell = workbook.getWorksheet('FOTOGRAFIAS').getCell(image.range.tl.nativeRow + 1, 2).value; assert.equal((image.range.br.nativeColOff - image.range.tl.nativeColOff) / (image.range.br.nativeRowOff - image.range.tl.nativeRowOff), uuidCell === uuid(2) ? .5 : 2); }
    assert.equal(calls.filter(call => call.viewport === name && call.action === 'getOccurrenceDocument' && call.detail === true).length, 2, 'duplicate clicks');
    await page.locator('[data-excel-close]').first().click();
    const pdfDownload = page.waitForEvent('download'); await page.locator(`#supervisorList [data-export-record="${uuid(1)}"]`).click(); const pdf = await pdfDownload; assert.match(pdf.suggestedFilename(), /\.pdf$/); assert.equal(await page.locator('#excelDialog').isVisible(), false); assert.equal(calls.filter(call => call.viewport === name && call.action === 'getOccurrenceDocument' && call.detail === false).length, 1);
    await page.locator('#logoutButton').click(); await login('fiscal'); await page.locator('#fiscalList [data-export-excel]').first().waitFor(); assert.equal(await page.locator('#nonconformitySection').isVisible(), false); assert.equal(await page.locator('#rateChart').innerText(), '');
    await page.locator('#fiscal-base').selectOption('CAICÓ'); await page.locator('#fiscalList [data-export-excel]').first().click(); await page.locator('#excelDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#excelFilterCount').innerText(), /61/); assert.equal((await page.locator('#excelRecordList').innerText()).includes('MOSSORÓ'), false); assert.ok(calls.some(call => call.viewport === name && call.action === 'listFiscalRecords' && call.offset === 60 && call.filters.base === 'CAICÓ'));
    await page.locator('#excelSearch').fill('FIXTURE-1'); await page.locator('#excelSelectAll').check(); assert.match(await page.locator('#excelSelectedCount').innerText(), /ocorrências selecionadas/); await page.locator('[data-excel-close]').first().click();
    await page.locator('#logoutButton').click(); await login('field'); await page.locator('[data-nav="mine"]').click(); await page.locator('#mineFilters [data-filter="all"]').click(); await page.locator('#mineList [data-export-excel]').first().waitFor(); assert.equal(await page.locator('#nonconformitySection').isVisible(), false);
    await page.locator('#mineList [data-export-excel]').first().click(); await page.locator('#excelDialog').waitFor({ state: 'visible' }); assert.match(await page.locator('#excelFilterCount').innerText(), /2/); assert.equal(await page.locator('#excelRecordList input').count(), 2);
    await page.locator('[data-excel-close]').first().click(); await page.locator('#logoutButton').click(); assert.equal(await page.locator('#excelRecordList').innerText(), '');
    checks.push({ viewport: name, passed: true, charts: true, consolidatedExcelPhotos: 12, pdfIndividual: true, fiscalPaginationAndAcl: true, fieldAcl: true, duplicateClicksBlocked: true, pageOverflow: false }); await context.close();
  }
  assert.equal(calls.some(call => ['submitRecord', 'uploadPhoto', 'supervisorAction', 'supervisorCorrectRecord', 'approveBatch'].includes(call.action)), false);
  assert.deepEqual(pageErrors, []); console.log(JSON.stringify({ checks, errors: pageErrors, calls: calls.length, operationalLogins: 0, productionWrites: 0 }, null, 2));
  await writeFile(path.join(evidence, 'ui-results.json'), JSON.stringify({ checks, pageErrors, calls, operationalLogins: 0, productionWrites: 0 }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
