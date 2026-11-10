import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixtureFactory, id, plain } from './chaves-fixtures.mjs';

const backend = await readFile(process.argv[2], 'utf8');
const make = await fixtureFactory(backend);

test('consulta de UUID alheio ou Base não autorizada não prepara compartilhamento de foto', () => {
  const h = make(), { COL } = h.c.meta;
  h.add(1, { base: 'MOSSORÓ' });
  h.grant('Fiscal A', ['CAICÓ']);
  h.row(1)[COL.PHOTO_1 - 1] = 'https://drive.google.com/thumbnail?id=FixturePhotoDrive_0123456789';
  let touched = 0;
  h.c.cachedPublicPhotosForRows_ = () => ({});
  h.c.ensurePhotoPublic_ = () => { touched += 1; return true; };
  const other = h.c.createToken_('Outro Campo', 'field', Date.now() + 600000);
  for (const token of [other, h.login()]) {
    assert.throws(() => h.c.getRecordState_({ token, recordId: id(1) }), error => error.code === 'FORBIDDEN');
  }
  assert.equal(touched, 0);
  const own = h.c.getRecordState_({ token: h.token('field'), recordId: id(1) });
  assert.equal(own.recordId, id(1));
  assert.equal(touched, 1);
});

test('retry sobre publicação alheia valida o proprietário antes de preparar as evidências', () => {
  const h = make(), { COL, APP } = h.c.meta;
  h.add(1);
  const row = h.row(1).slice();
  row[COL.PHOTO_1 - 1] = 'https://drive.google.com/thumbnail?id=FixturePhotoDrive_0123456789';
  row[COL.STATUS - 1] = 'PUBLICADA';
  h.sheet(APP.officialSheet).appendRow(row);
  h.sheet(APP.pendingSheet).rows.pop();
  let touched = 0;
  h.c.ensurePhotoPublic_ = () => { touched += 1; return true; };
  const token = h.c.createToken_('Outro Campo', 'field', Date.now() + 600000);
  assert.throws(() => h.c.submitRecord_({ token, record: { recordId: id(1) } }), error => error.code === 'FORBIDDEN');
  assert.equal(touched, 0);
});

test('diagnóstico usa a assinatura do serviço publicado além da contagem, sem reparar', () => {
  const h = make(), { APP } = h.c.meta;
  h.add(1);
  const token = h.token('supervisor');
  h.c.supervisorAction_({ token, recordId: id(1), decision: 'approve' });
  const intact = h.c.bqMonitor_({ token, recordId: id(1), section: 'diagnosis' });
  assert.equal(intact.persistence.publication, 'PUBLICAÇÃO CONFIRMADA');
  h.sheet(APP.servicesSheet).rows.find(row => row[0] === id(1))[6] = 999.01;
  const snapshot = JSON.stringify([...h.sheets.values()].map(sheet => sheet.rows));
  const conflict = h.c.bqMonitor_({ token, recordId: id(1), section: 'diagnosis' });
  assert.equal(conflict.persistence.publication, 'PUBLICAÇÃO NECESSITA RECONCILIAÇÃO');
  assert.equal(conflict.persistence.conflict, true);
  assert.equal(JSON.stringify([...h.sheets.values()].map(sheet => sheet.rows)), snapshot);
});

test('apenas reparo explicitamente booleano entra no contrato de mutações', () => {
  const h = make(), token = h.token('supervisor');
  const policy = { ...h.c.health_().compatibility, operationContracts: { verifyPublishedIntegrity: ['future'] } };
  assert.throws(() => h.c.bqCheckContract_('verifyPublishedIntegrity', { repair: true }, policy), error => error.code === 'CLIENT_UPDATE_REQUIRED');
  assert.doesNotThrow(() => h.c.bqCheckContract_('verifyPublishedIntegrity', { repair: false }, policy));
  assert.throws(() => h.c.verifyPublishedIntegrityRoute_({ token, recordId: id(1), repair: 'false' }), error => error.code === 'INVALID_INTEGRITY_OPTION');
});

test('gravação escapa entrada de fórmula sem converter valores numéricos ou rótulos comuns', () => {
  const h = make();
  assert.deepEqual(plain(h.c.bqLiteralRow_(['=1+1', "'=2+2", '0003', 4, null])), ["'=1+1", "''=2+2", '0003', 4, null]);
});
