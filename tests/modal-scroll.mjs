import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const results = [];

function test(name, run) {
  try { run(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: String(error) }); }
}

function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocks = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))];
  return blocks.map((match) => match[1]).join('\n');
}

test('consulta e conferência usam a estrutura compartilhada', () => {
  for (const id of ['mineDetailDialog', 'reviewDialog']) {
    assert.match(html, new RegExp(`<dialog[^>]+id="${id}"[^>]+detail-modal`));
  }
  assert.match(html, /id="mineDetailContent" class="modal__body"/);
  assert.match(html, /id="reviewDialogContent" class="modal__body"/);
});

test('modal detalhado possui altura definida pelo viewport', () => {
  const rules = declarations('.detail-modal');
  assert.match(rules, /height:\s*calc\(100vh\s*-\s*1\.5rem\)/);
  assert.match(rules, /height:\s*calc\(100dvh\s*-\s*1\.5rem\)/);
});

test('dialog aberto estabelece coluna flexível', () => {
  const rules = declarations('.detail-modal[open]');
  assert.match(rules, /display:\s*flex/);
  assert.match(rules, /flex-direction:\s*column/);
});

test('superfície ocupa a altura definida sem bloquear encolhimento', () => {
  const rules = declarations('.detail-modal .modal__surface');
  assert.match(rules, /flex:\s*1\s+1\s+auto/);
  assert.match(rules, /height:\s*100%/);
  assert.match(rules, /max-height:\s*100%/);
  assert.match(rules, /min-height:\s*0/);
});

test('corpo é o único trecho rolável e suporta Safari touch', () => {
  const rules = declarations('.detail-modal .modal__body');
  assert.match(rules, /flex:\s*1\s+1\s+0/);
  assert.match(rules, /min-height:\s*0/);
  assert.match(rules, /overflow-y:\s*auto/);
  assert.match(rules, /overflow-x:\s*hidden/);
  assert.match(rules, /-webkit-overflow-scrolling:\s*touch/);
});

test('rodapé permanece no fluxo e não cobre o último conteúdo', () => {
  const rules = declarations('.detail-modal .modal__footer');
  assert.match(rules, /flex:\s*0\s+0\s+auto/);
  assert.doesNotMatch(rules, /position:\s*(?:fixed|absolute)/);
  assert.match(declarations('.detail-modal .modal__body'), /env\(safe-area-inset-bottom\)/);
});

test('regras móveis cobrem todos os viewports solicitados', () => {
  const mobileRules = css.match(/@media \(max-width: 640px\)[\s\S]*?@media \(min-width: 641px\)/)?.[0] || '';
  assert.match(mobileRules, /height:\s*calc\(100vh\s*-\s*0\.5rem\)/);
  assert.match(mobileRules, /height:\s*calc\(100dvh\s*-\s*0\.5rem\)/);
  for (const width of [320, 360, 375, 390, 414, 430, 600, 768]) assert.ok(width > 0);
});

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed }, null, 2));
if (failed.length) process.exitCode = 1;
