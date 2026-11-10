import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { APP_VERSION, RECORD_STATUS } from '../core.js';
import { API_CONTRACT, classifyCompatibility } from '../release-compatibility.js';
import { canQueueRetry, prioritizeQueue, synchronizationQueueState } from '../sync-queue.js';
import { buildFinancialComparison, financialPeriodOptions } from '../supervisor-financial.js';

const ids = [1, 2, 3, 4].map(n => '0000000' + n + '-1111-4111-8111-111111111111');
const client = { version: APP_VERSION, contract: API_CONTRACT, schema: 1 };
const policy = { schema: 1, acceptedContracts: [API_CONTRACT], localSchemas: [1], operationContracts: {} };
const confirmed = { version: '2026.11.06.1', contract: API_CONTRACT, compatibility: policy };
const current = details => classifyCompatibility({ client, backend: confirmed, assets: [APP_VERSION], ...details });

test('contratos compatíveis permitem versão de servidor anterior', () => {
  assert.equal(current().state, 'ATUALIZADO');
  assert.equal(current({ worker: '2026.11.06.1' }).state, 'ATUALIZADO');
});

test('release disponível, servidor ausente e asset divergente são estados distintos', () => {
  assert.equal(current({ published: { version: '2026.11.10.1' } }).state, 'ATUALIZAÇÃO DISPONÍVEL');
  assert.equal(current({ waiting: '2026.11.10.1' }).state, 'ATUALIZAÇÃO DISPONÍVEL');
  assert.equal(current({ backend: null }).state, 'VERSÃO NÃO CONFIRMADA');
  assert.equal(current({ localSchema: 2 }).state, 'ATUALIZAÇÃO NECESSÁRIA');
  assert.equal(current({ assets: [APP_VERSION, '2026.11.06.1'] }).state, 'ATUALIZAÇÃO NECESSÁRIA');
  assert.deepEqual(current({ assets: ['2026.11.06.1'] }).blocked, []);
});

test('incompatibilidade é específica à operação declarada', () => {
  const backend = { ...confirmed, compatibility: { ...policy, operationContracts: { uploadPhoto: ['futuro'] } } };
  assert.deepEqual(current({ backend }).blocked, ['uploadPhoto']);
  assert.equal(current({ backend }).state, 'ATUALIZAÇÃO NECESSÁRIA');
});

test('metadados publicados correspondem ao contrato e à versão local', async () => {
  const manifest = JSON.parse(await readFile(new URL('../release-info.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest, { version: APP_VERSION, contract: API_CONTRACT });
});

const records = [
  { recordId: ids[0], status: RECORD_STATUS.PUBLISHED, registeredAt: '2026-11-01T02:59:59Z', base: 'CAICÓ', team: 'A', crewLeader: 'João', totalServices: 200,
    audit: { supervisorCorrections: [{ correctedAt: '2026-11-02T12:00:00Z', changes: [{ field: 'Total da ocorrência', previousValue: 100, newValue: 200 }] }] } },
  { recordId: ids[1], status: RECORD_STATUS.PUBLISHED, registeredAt: '2026-11-01T03:00:00Z', base: 'CAICÓ', team: 'A', crewLeader: 'João', totalServices: 100 },
  { recordId: ids[2], status: RECORD_STATUS.PUBLISHED, registeredAt: '2026-10-31', base: 'MOSSORÓ', team: 'B', crewLeader: 'Maria', totalServices: 99 }
];

test('intervalo inclusivo usa registro original em Bahia e combina Base, chefe e equipe', () => {
  const filtered = buildFinancialComparison([...records, records[0]], { period: 'custom', from: '2026-10-31', to: '2026-10-31', base: 'caico', crewLeader: 'Joao', team: 'A' });
  assert.equal(filtered.count, 1);
  assert.equal(filtered.sent, 100);
  assert.equal(filtered.corrected, 200);
  assert.equal(filtered.difference, 100);
  assert.equal(filtered.percentage, 100);
  assert.match(financialPeriodOptions(records, '2026-11'), /value="2026-10">10\/2026/);
  assert.doesNotMatch(financialPeriodOptions(records, '2026-11'), /value="2026-11"/);
});

test('intervalos inválidos e datas ausentes não criam totais aparentes', () => {
  assert.equal(buildFinancialComparison(records, { period: 'custom', from: '2026-11-31', to: '2026-12-01' }).invalidRange, true);
  const unknown = buildFinancialComparison([...records, { ...records[0], recordId: ids[3], registeredAt: '' }],
    { period: 'custom', from: '2026-10-31', to: '2026-10-31' });
  assert.equal(unknown.sent, null);
  assert.equal(unknown.corrected, null);
  assert.match(unknown.pending.find(item => item.recordId === ids[3]).reason, /Data de registro/);
});

test('UUID com duas Bases divergentes aparece como pendência em ambas', () => {
  const first = records[0], duplicate = { ...first, base: 'MOSSORÓ', team: 'Outra', totalServices: 500 };
  for (const input of [[first, duplicate], [duplicate, first]]) {
    for (const base of ['CAICÓ', 'MOSSORÓ']) {
      const result = buildFinancialComparison(input, { base, period: 'custom', from: '2026-10-31', to: '2026-10-31' });
      assert.equal(result.count, 1);
      assert.equal(result.corrected, null);
      assert.match(result.pending[0].reason, /UUID duplicado/);
    }
  }
});

const partial = { recordId: ids[0], status: RECORD_STATUS.SYNCING_PHOTOS, occurrenceTypes: ['PODA'], registeredAt: '2026-11-02',
  audit: { expectedPhotoIndexes: [1, 2, 3] }, syncProgress: { dataConfirmed: true }, syncPhase: 'photos',
  photoStates: [{ photoIndex: 1, confirmed: true, serverUrl: 'https://example.test/1' },
    { photoIndex: 2, localReady: true }, { photoIndex: 3, localReady: true }] };

test('fila prioriza confirmação parcial, preserva UUID e limita retentativas automáticas', () => {
  const old = { ...partial, recordId: ids[1], syncProgress: {}, registeredAt: '2026-10-01' };
  assert.deepEqual(prioritizeQueue([old, partial]).map(record => record.recordId), [ids[0], ids[1]]);
  assert.equal(canQueueRetry({ ...partial, attempts: 3 }, true), false);
  assert.equal(canQueueRetry({ ...partial, attempts: 3 }), true);
  assert.equal(canQueueRetry({ ...partial, lastSyncError: { code: 'DATA_COMMIT_CONFLICT' } }), false);
});

test('fila mostra contagens de slots, atividade real, offline e confirmação final', () => {
  assert.deepEqual(synchronizationQueueState(partial, { online: true, busy: true, localSlots: [2] }),
    { phase: 'SINCRONIZANDO FOTOS', action: 'Foto 2', complete: false, data: true, local: 1, confirmed: 1, total: 3 });
  assert.equal(synchronizationQueueState(partial, { online: false }).phase, 'AGUARDANDO CONEXÃO');
  assert.equal(synchronizationQueueState(partial, { online: true }).phase, 'DADOS CONFIRMADOS');
  assert.equal(synchronizationQueueState({ ...partial, syncPhase: 'confirmed' }, { online: false }).phase, 'CONCLUÍDO');
});
