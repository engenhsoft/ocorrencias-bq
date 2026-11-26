import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixtureFactory, id, plain } from './chaves-fixtures.mjs';

const [candidate, baseline] = await Promise.all(process.argv.slice(2, 4).map(file => readFile(file, 'utf8')));
assert.ok(candidate && baseline, 'Informe a fonte candidata e a versão 48.');
const [make, makeBaseline] = await Promise.all([fixtureFactory(candidate), fixtureFactory(baseline)]);
const pg = '000007';
const changes = { occurrenceTypes: ['SUBSTITUIÇÃO DE POSTE', 'LINHA VIVA'], pgPostRemoved: pg, pgPostInstalled: 'PG-FIXTURE' };

function simulateSheetNumberParsing(sheet, { ignoreTextFormat = false } = {}) {
  const formatted = new Set();
  const writes = [];
  const getRange = sheet.getRange.bind(sheet);
  const write = (row, column, value) => {
    writes.push(column);
    return typeof value === 'string' && /^0\d+$/.test(value) && (ignoreTextFormat || !formatted.has(row + ':' + column)) ? Number(value) : value;
  };
  sheet.getRange = (row, column, height = 1, width = 1) => {
    const range = getRange(row, column, height, width);
    const set = range.setValues;
    range.setValues = values => set(values.map((line, y) => line.map((value, x) => write(row + y, column + x, value))));
    range.setNumberFormat = format => {
      assert.equal(format, '@');
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) formatted.add((row + y) + ':' + (column + x));
      return range;
    };
    return range;
  };
  const columnNumber = label => [...label].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
  sheet.getMaxRows = () => 100;
  sheet.getRangeList = addresses => ({
    setNumberFormat(format) {
      for (const address of addresses) {
        const [, start, top, end, bottom] = address.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
        const column = columnNumber(start), height = Number(bottom) - Number(top) + 1;
        sheet.getRange(Number(top), column, height, columnNumber(end) - column + 1).setNumberFormat(format);
      }
    }
  });
  const append = sheet.appendRow.bind(sheet);
  sheet.appendRow = values => append(values.map((value, index) => write(sheet.getLastRow() + 1, index + 1, value)));
  return writes;
}

function fixture(factory = make, formatOptions) {
  const h = factory();
  h.grant(); h.add(1); h.request(1);
  const { APP, COL } = h.c.meta;
  const pending = h.sheet(APP.pendingSheet);
  const writes = simulateSheetNumberParsing(pending, formatOptions);
  const payload = h.payload(h.open(1), changes);
  return { h, pending, COL, payload, writes };
}

function reproduce() {
  const old = fixture(makeBaseline);
  assert.throws(() => old.h.submit(old.payload), error => error.code === 'CORRECTION_PERSISTENCE_MISMATCH');
  assert.equal(old.h.row(1)[old.COL.PG_POST_REMOVED - 1], 7);
  assert.equal(old.h.row(1)[old.COL.PG_POST_INSTALLED - 1], changes.pgPostInstalled);
  assert.equal(old.h.audit(1).lastCorrectionSubmission.phase, 'STAGED');
  return old;
}

function resumeFixture() {
  const old = reproduce();
  const current = fixture();
  current.pending.rows = plain(old.pending.rows);
  current.payload = old.payload;
  return current;
}

function resendCount(h) {
  return h.sheet(h.c.meta.APP.historySheet).rows.filter(row => row[0] === id(1) && row[3] === 'CORRECAO_REENVIADA').length;
}

const cases = [
  ['versão 48 reproduz a perda de zeros e conserva a intenção', () => {
    const { h } = reproduce();
    assert.equal(h.audit(1).lastCorrectionSubmission.expectedPatch.pgPostRemoved, pg);
    assert.equal(resendCount(h), 0);
  }],
  ['Fiscal grava PG literalmente, relê e Supervisor publica os mesmos zeros', () => {
    const { h, COL, payload } = fixture();
    const result = h.submit(payload);
    assert.equal(result.status, 'AGUARDANDO_SUPERVISOR');
    assert.equal(result.record.pgPostRemoved, pg);
    assert.equal(h.row(1)[COL.PG_POST_REMOVED - 1], pg);
    assert.equal(resendCount(h), 1);
    const official = h.sheet(h.c.meta.APP.officialSheet);
    simulateSheetNumberParsing(official);
    const published = h.c.supervisorAction_({ token: h.token('supervisor'), recordId: id(1), decision: 'approve' });
    assert.equal(published.status, 'PUBLICADA');
    assert.equal(official.rows[1][COL.PG_POST_REMOVED - 1], pg);
  }],
  ['retry legado repara só as células pendentes e usa o mesmo recibo', () => {
    const { h, COL, payload, writes } = resumeFixture();
    const before = plain(h.row(1));
    const previousReceipt = h.audit(1).lastCorrectionSubmission;
    const first = h.submit(payload);
    assert.equal(first.status, 'AGUARDANDO_SUPERVISOR');
    assert.equal(first.record.pgPostRemoved, pg);
    assert.equal(first.record.audit.lastCorrectionSubmission.requestId, previousReceipt.requestId);
    assert.equal(first.record.audit.lastCorrectionSubmission.receivedAt, previousReceipt.receivedAt);
    assert.deepEqual([...new Set(writes.filter(column => column !== COL.UPDATED_AT))].sort((a, b) => a - b), [COL.PG_POST_REMOVED, COL.STATUS, COL.AUDIT]);
    for (const column of [COL.TYPES, COL.PG_POST_INSTALLED, COL.PHOTO_1, COL.UPLOAD_KEY_1, COL.MATERIALS_SUMMARY, COL.SERVICES_SUMMARY, COL.TOTAL]) {
      assert.equal(h.row(1)[column - 1], before[column - 1]);
    }
    const writeCount = writes.length;
    h.submit(payload);
    assert.equal(writes.length, writeCount);
    assert.equal(resendCount(h), 1);
  }],
  ['divergência no PG e alteração externa provocam conflito sem sobrescrita', () => {
    for (const changed of ['PG_POST_REMOVED', 'OBSERVATION']) {
      const { h, COL, payload, writes } = resumeFixture();
      h.row(1)[COL[changed] - 1] = 'ALTERAÇÃO EXTERNA';
      const before = plain(h.row(1));
      assert.throws(() => h.submit(payload), error => error.code === 'CORRECTION_UPDATE_CONFLICT');
      assert.deepEqual(plain(h.row(1)), before);
      assert.equal(writes.length, 0);
      assert.equal(resendCount(h), 0);
    }
  }],
  ['releitura continua recusando zeros perdidos e expõe só o nome da coluna', () => {
    const { h, payload } = fixture(make, { ignoreTextFormat: true });
    assert.throws(() => h.submit(payload), error => {
      assert.equal(error.code, 'CORRECTION_PERSISTENCE_MISMATCH');
      assert.deepEqual(plain(error.details.columns), ['PG POSTE RETIRADO']);
      assert.ok(!JSON.stringify(error.details).includes(pg));
      return true;
    });
    assert.equal(resendCount(h), 0);
  }],
  ['recibo STAGED anterior às 72 horas não autoriza gravar depois do prazo', () => {
    const { h, payload, writes } = resumeFixture();
    const due = Date.parse(h.audit(1).lastCorrectionRequest.dueAt);
    h.c.Date = class extends Date { static now() { return due; } };
    assert.throws(() => h.submit(payload), error => error.code === 'CORRECTION_DEADLINE_EXPIRED');
    assert.equal(writes.length, 0);
    assert.equal(resendCount(h), 0);
  }]
];

for (const [name, check] of cases) { check(); console.log('PASS ' + name); }
console.log(JSON.stringify({ passed: cases.length, failed: 0, productionWrites: 0 }));
