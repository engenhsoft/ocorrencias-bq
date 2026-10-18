// Mandatory regression block (fake-indexeddb is a test-only dependency) for the 18 October stability patches.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const suites = ['audit-sync', 'audit-offline', 'audit-deletion', 'audit-session', 'audit-mine-session', 'audit-fiscal-ui', 'audit-merge', 'audit-exports', 'audit-backend'].map(name => name + '-20261018.mjs');
const results = [];
for (const suite of suites) {
  const started = performance.now();
  const run = spawnSync(process.execPath, [fileURLToPath(new URL(suite, import.meta.url))], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  const output = (run.stdout || '').trim();
  let report;
  for (let position = output.lastIndexOf('{'); position >= 0; position = output.lastIndexOf('{', position - 1)) {
    try { const parsed = JSON.parse(output.slice(position)); if (Number.isInteger(parsed.total)) { report = parsed; break; } } catch {}
    if (position === 0) break;
  }
  const passed = run.status === 0 && report?.failed === 0 && report.passed === report.total;
  results.push({ suite, passed, total: report?.total ?? null, approved: report?.passed ?? null, failed: report?.failed ?? null, durationMs: Math.round(performance.now() - started) });
  if (!passed) process.stderr.write(`${suite}\n${run.error?.message || ''}\n${run.stdout || ''}\n${run.stderr || ''}\n`);
}
const report = { scope: 'isolated fixtures; public backend modules; no production record mutations', total: results.reduce((sum, result) => sum + (result.total || 0), 0), passed: results.reduce((sum, result) => sum + (result.approved || 0), 0), failed: results.reduce((sum, result) => sum + (result.failed || 0), 0), suites: results.length, failedSuites: results.filter(result => !result.passed).length, results };
console.log(JSON.stringify(report, null, 2));
if (report.failedSuites) process.exitCode = 1;
