import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const tests = [];
const test = (name, run) => tests.push({ name, run });

for (const file of ['app.js', 'core.js', 'api.js', 'db.js', 'config.js', 'service-worker.js']) {
  test(`sintaxe JavaScript válida: ${file}`, () => execFileSync(process.execPath, ['--check', new URL(file, root).pathname]));
}

const html = await read('index.html');
const app = await read('app.js');
const css = await read('styles.css');
const manifest = JSON.parse(await read('manifest.webmanifest'));
const serviceWorker = await read('service-worker.js');
const core = await read('core.js');
const config = await read('config.js');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const labels = [...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((match) => match[1]);
const appRefs = [...app.matchAll(/\$\(['"]#([^'"]+)['"]\)/g)].map((match) => match[1]);
test('HTML não possui IDs duplicados', () => assert.equal(new Set(ids).size, ids.length));
test('todos os labels apontam para IDs existentes', () => assert.deepEqual(labels.filter((id) => !ids.includes(id)), []));
test('todas as referências de elementos do app existem', () => assert.deepEqual([...new Set(appRefs)].filter((id) => !ids.includes(id)), []));
test('viewport inclui viewport-fit para iOS', () => assert.match(html, /viewport-fit=cover/));
test('modal de Minhas possui corpo rolável', () => { assert.match(css, /#mineDetailDialog \.modal__body[\s\S]*?overflow-y:\s*auto/); assert.match(css, /-webkit-overflow-scrolling:\s*touch/); });
test('layout impede overflow horizontal global', () => assert.match(css, /body[\s\S]*?overflow-x:\s*hidden/));
test('layout possui correções para 360 px', () => assert.match(css, /@media \(max-width:\s*360px\)/));
test('layout possui breakpoint mobile 640 px', () => assert.match(css, /@media \(max-width:\s*640px\)/));
test('layout possui breakpoint tablet', () => assert.match(css, /@media \(min-width:\s*760px\)/));
test('fotos respeitam o container', () => assert.match(css, /\.review-photo img[^{]*\{[^}]*max-width:\s*100%/));
test('rodapé móvel respeita safe-area', () => assert.match(css, /safe-area-inset-bottom/));
test('manifest mantém identidade e escopo', () => { assert.equal(manifest.name, 'Ocorrências B&Q'); assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './'); assert.equal(manifest.display, 'standalone'); });
test('manifest declara ícones 192 e 512', () => assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']));
for (const icon of [...manifest.icons.map((item) => item.src.replace(/^\.\//, '')), 'assets/apple-touch-icon.png']) {
  test(`asset PWA existe: ${icon}`, () => access(new URL(icon, root)));
}

const shellMatch = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/);
const shell = [...(shellMatch?.[1] || '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
test('service worker possui shell offline', () => assert.ok(shell.length >= 10));
for (const asset of shell.filter((item) => item !== './')) test(`shell existe: ${asset}`, () => access(new URL(asset.replace(/^\.\//, ''), root)));
test('service worker ativa nova versão imediatamente', () => assert.match(serviceWorker, /skipWaiting\(\)/));
test('service worker assume clientes após ativação', () => assert.match(serviceWorker, /clients\.claim\(\)/));
test('service worker limpa caches antigos do mesmo app', () => assert.match(serviceWorker, /key\.startsWith\(CACHE_PREFIX\).*key !== CACHE_NAME/s));
test('navegação usa rede com fallback offline', () => { assert.match(serviceWorker, /request\.mode === 'navigate'/); assert.match(serviceWorker, /caches\.match\('\.\/index\.html'\)/); });
test('versões de app e config são coerentes', () => {
  const appVersion = core.match(/APP_VERSION = '([^']+)'/)?.[1]; const cacheVersion = config.match(/CACHE_VERSION = '([^']+)'/)?.[1]; assert.equal(appVersion, cacheVersion); assert.ok(serviceWorker.includes(cacheVersion));
  assert.ok(html.includes(`v${appVersion}`));
});

let passed = 0; const failures = [];
for (const item of tests) {
  try { await item.run(); passed += 1; }
  catch (error) { failures.push({ test: item.name, error: `${error.name}: ${error.message}` }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
