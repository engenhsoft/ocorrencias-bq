// Controlled measurements only. No Google API calls or production writes.
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const source = await readFile(new URL('publication-reconciliation.mjs', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'))[0];
const MemorySheet = source.match(/class MemorySheet \{[^]*?\n\}/)[0];
const plain = value => JSON.parse(JSON.stringify(value));
const make = vm.runInNewContext(MemorySheet + '\n' + extract('harness') + '\nharness', { vm, assert, plain });
const UUID = '00000001-1111-4111-8111-111111111111';
const record = { recordId: UUID, registeredAt: '2026-10-15T12:00:00-03:00', user: 'Campo FICTÍCIO', base: 'CAICÓ', contract: '4600080938', team: 'LM FICTÍCIA', crewLeader: 'Chefe FICTÍCIO', occurrenceNumber: 'Fixture', occurrenceTypes: ['PODA'], transformer: {},
  services: [1, 2, 3].map(n => ({ lineId: String(n), code: 'H' + n, catalogKey: 'removed:' + n, catalogText: 'Histórico ' + n, unit: 'M', group: 'Histórico', contract: '4600080938', origin: 'Histórico', quantity: 1.25, referenceValue: 20, totalValue: 25 })),
  materials: [1, 2].map(n => ({ code: '0000' + n, description: 'Material ' + n, unit: 'UN', quantity: 1 })), totalServices: 75, observation: '' };
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summarize = values => ({ median: percentile(values, .5), p95: percentile(values, .95) });
const report = { environment: 'Node VM; Sheets/Drive in RAM; no network latency; not production SLA', samplesPerVersion: 30, versions: [] };
for (const file of process.argv.slice(2, 4)) {
  const backend = await readFile(file, 'utf8'), samples = [];
  for (let n = 0; n < 35; n++) {
    const h = make({ source: backend }); h.seed(record); h.reads = []; h.writes = []; h.finders = [];
    const start = performance.now(), result = h.approve(UUID), wallMs = performance.now() - start;
    assert.equal(result.integrity.state, 'INTEGRITY_OK'); assert.equal(result.integrity.pendingCopies, 0);
    if (n >= 5) samples.push({ wallMs, reads: h.reads.length, searches: h.finders.length, writes: h.writes.length, stages: result.timings || null });
  }
  report.versions.push({ release: backend.match(/version: '([^']+)'/)[1], wallMs: summarize(samples.map(s => s.wallMs)), reads: summarize(samples.map(s => s.reads)), searches: summarize(samples.map(s => s.searches)), writes: summarize(samples.map(s => s.writes)), stageSample: samples.at(-1).stages });
}
console.log(JSON.stringify(report, null, 2));
if (process.argv[4]) await writeFile(process.argv[4], JSON.stringify(report, null, 2));
