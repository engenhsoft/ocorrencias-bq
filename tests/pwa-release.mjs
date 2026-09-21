import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const [core, html, app, api, db, worker] = await Promise.all([
  read('core.js'), read('index.html'), read('app.js'), read('api.js'), read('db.js'), read('service-worker.js')
]);

const version = core.match(/APP_VERSION = '([^']+)'/)?.[1];
assert.equal(version, '2026.09.20.3');
assert.match(core, /APP_BUILD = '2026-09-20-pwa-cache-coherence'/);
assert.match(worker, /WORKER_VERSION = '2026\.09\.20\.3'/);
assert.match(worker, /CACHE_NAME = `\$\{CACHE_PREFIX\}\$\{WORKER_VERSION\}`/);
assert.match(worker, /new Request\(asset, \{ cache: 'reload' \}\)/);
assert.match(worker, /key\.startsWith\(CACHE_PREFIX\).*key !== CACHE_NAME/s);

for (const asset of ['styles.css', 'manifest.webmanifest', 'app.js']) {
  assert.ok(html.includes(`./${asset}?v=${version}`), `${asset} sem versão no HTML`);
}
for (const asset of ['core.js', 'db.js', 'api.js']) {
  assert.ok(app.includes(`./${asset}?v=${version}`), `${asset} sem versão no app.js`);
}
assert.ok(api.includes(`./config.js?v=${version}`));
assert.ok(db.includes(`./core.js?v=${version}`));
for (const asset of ['styles.css', 'config.js', 'core.js', 'db.js', 'api.js', 'app.js', 'manifest.webmanifest']) {
  assert.ok(worker.includes(`versioned('./${asset}')`), `${asset} ausente do cache versionado`);
}

assert.match(app, /waitingServiceWorker\.postMessage\(\{ type: 'SKIP_WAITING' \}\)/);
assert.match(app, /navigator\.serviceWorker\.addEventListener\('controllerchange'/);
assert.match(app, /if \(!updateReloadRequested\) return/);
assert.match(app, /sessionStorage\.setItem\(key, '1'\);\s*location\.reload\(\)/);
assert.equal((html.match(/value="cancel" formnovalidate/g) || []).length >= 2, true);
assert.match(html, /id="decisionReason"[^>]*required/);

console.log(JSON.stringify({ passed: true, version, cache: `ocorrencias-bq-${version}` }, null, 2));
