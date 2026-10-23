// Reuse the official-backend in-memory harnesses; no operational network calls.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import * as core from '../core.js';

export const plain = value => JSON.parse(JSON.stringify(value));
export const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const keyValues = { pgKeyRemoved: '00012-A/7', btoKeyRemoved: '000034', pgKeyInstalled: '00056-C', btoKeyInstalled: '000078-D/9' };
export const extract = (source, name) => {
  const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(match, name); return match[0];
};
export async function fixtureFactory(backend) {
  const [persistence, features, fiscal] = await Promise.all(['correction-persistence.mjs', 'operational-features.mjs', 'fiscal-corrections.mjs'].map(name => readFile(new URL(name, import.meta.url), 'utf8')));
  const shared = { vm, backend, createHash, createHmac, randomUUID, Buffer, Map, Date, assert, core, id, extract, persistence };
  const factory = vm.runInNewContext(persistence.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(persistence, 'harness') + '\nharness', shared);
  const baseHarness = vm.runInNewContext(extract(features, 'harness') + '\nharness', { ...shared, factory });
  return vm.runInNewContext(extract(fiscal, 'harness') + '\nharness', { ...shared, baseHarness });
}
export function seedKeys(h, n = 1, changes = {}) {
  h.add(n);
  const row = h.row(n), { COL } = h.c.meta;
  row[COL.TYPES - 1] = 'CHAVES'; row[COL.FORM_VERSION - 1] = 1;
  for (const [key, column] of Object.entries({ pgKeyRemoved: 'PG_KEY_REMOVED', btoKeyRemoved: 'BTO_KEY_REMOVED', pgKeyInstalled: 'PG_KEY_INSTALLED', btoKeyInstalled: 'BTO_KEY_INSTALLED' })) row[COL[column] - 1] = changes[key] ?? keyValues[key];
  return row;
}
