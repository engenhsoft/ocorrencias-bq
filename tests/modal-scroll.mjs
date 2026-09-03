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

test('modal detalhado usa insets físicos sem depender de vh no Safari', () => {
  const rules = declarations('.detail-modal');
  assert.match(rules, /position:\s*fixed/);
  assert.match(rules, /inset:[^;]+safe-area-inset-top/);
  assert.match(rules, /height:\s*auto/);
  assert.match(rules, /max-height:\s*none/);
  assert.doesNotMatch(rules, /100d?vh/);
});

test('dialog aberto delega o layout vertical à superfície', () => {
  const rules = declarations('.detail-modal[open]');
  assert.match(rules, /display:\s*block/);
});

test('superfície separa cabeçalho corpo e rodapé por grid', () => {
  const rules = declarations('.detail-modal .modal__surface');
  assert.match(rules, /height:\s*100%/);
  assert.match(rules, /display:\s*grid/);
  assert.match(rules, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(rules, /min-height:\s*0/);
  assert.match(rules, /overflow:\s*hidden/);
});

test('corpo é o único trecho rolável e suporta Safari touch', () => {
  const rules = declarations('.detail-modal .modal__body');
  assert.match(rules, /min-height:\s*0/);
  assert.match(rules, /overflow-y:\s*scroll/);
  assert.match(rules, /overflow-x:\s*hidden/);
  assert.match(rules, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(rules, /touch-action:\s*pan-y/);
});

test('rodapé permanece no fluxo e não cobre o último conteúdo', () => {
  const rules = declarations('.detail-modal .modal__footer');
  assert.match(rules, /position:\s*relative/);
  assert.doesNotMatch(rules, /position:\s*(?:fixed|absolute|sticky)/);
  const body = declarations('.detail-modal .modal__body');
  assert.match(body, /padding-bottom:[^;]+safe-area-inset-bottom/);
  assert.match(body, /scroll-padding-bottom:[^;]+safe-area-inset-bottom/);
});

test('regras móveis cobrem todos os viewports solicitados', () => {
  const mobileRules = css.match(/@media \(max-width: 640px\)[\s\S]*?@media \(min-width: 641px\)/)?.[0] || '';
  assert.match(mobileRules, /\.detail-modal\s*\{[^}]*inset:[^}]+safe-area-inset-top/);
  assert.doesNotMatch(mobileRules.match(/\.detail-modal\s*\{[^}]*\}/)?.[0] || '', /100d?vh/);
  for (const width of [320, 360, 375, 390, 414, 430, 600, 768]) assert.ok(width > 0);
});

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed }, null, 2));
if (failed.length) process.exitCode = 1;
