import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const [source, coreSource, html, css] = await Promise.all(['app.js', 'core.js', 'index.html', 'styles.css'].map((name) => readFile(new URL(name, root), 'utf8')));
const core = await import(`data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`);
const extract = (name) => {
  const value = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`, 'm'))?.[0];
  assert.ok(value, name); return value;
};
let passed = 0;
function test(label, action) { action(); passed += 1; console.log(`OK ${label}`); }

const today = '2026-09-30';
const records = [
  { recordId: 'a', registeredAt: `${today}T08:00:00-03:00` },
  { recordId: 'b', registeredAt: '2026-09-29T10:00:00-03:00', updatedAt: `${today}T09:00:00-03:00` },
  { recordId: 'c', registeredAt: `${today}T00:30:00-03:00` },
  { recordId: 'd', registeredAt: `${today}T23:30:00-03:00`, reviewedAt: '2026-10-01T10:00:00-03:00', publishedAt: '2026-10-02T12:00:00-03:00' }
];
test('Hoje: data original e virada em Bahia', () => assert.deepEqual(records.filter((record) => core.dateInRange(core.occurrenceDate(record), core.supervisorDateWindow('today', today))).map((record) => record.recordId), ['a', 'c', 'd']));
test('UTC próximo da meia-noite mantém dia operacional anterior', () => assert.equal(core.operationalDate('2026-09-30T02:30:00Z'), '2026-09-29'));
test('Data sem hora não retrocede para ontem', () => assert.equal(core.operationalDate(today), today));
test('Hora sem offset usa Bahia, não timezone do dispositivo', () => assert.equal(core.operationalDate(`${today}T00:30:00`), today));
test('Data brasileira válida', () => assert.equal(core.operationalDate('30/09/2026 00:30:00'), today));
test('Datas impossíveis não são convertidas para outro dia', () => { assert.equal(core.operationalDate('30/02/2026 00:30:00'), ''); assert.equal(core.operationalDate('2026-02-30T00:30:00-03:00'), ''); });
test('Mês atual e período usam a mesma comparação', () => {
  assert.equal(core.dateInRange('2026-09-01', core.supervisorDateWindow('month', today)), true);
  assert.equal(core.dateInRange('2026-08-31', core.supervisorDateWindow('month', today)), false);
  assert.equal(core.dateInRange(today, { from: '2026-09-01', to: today }), true);
});
test('Atualização/revisão nunca substitui criação ausente', () => assert.equal(core.occurrenceDate({ updatedAt: today, reviewedAt: today }), ''));
test('Todas as abas e Minhas usam criação', () => {
  assert.equal(vm.runInNewContext(`${extract('dateForSupervisorRecord')}\ndateForSupervisorRecord`, { occurrenceDate: core.occurrenceDate })(records[3]), today);
  assert.ok(source.includes("mineFilter === 'today' && occurrenceDate(record) === today"));
});

const directory = core.normalizeTeamDirectory([
  { base: 'caico', team: 'LM-01', crewLeader: 'Chefe A' },
  { base: 'CURRAIS NOVOS', team: 'LM-02', crewLeader: 'Chefe B' },
  { base: 'ASSU', team: 'LM-03', crewLeader: 'Chefe C' }
]);
test('Base normalizada mantém acento oficial', () => assert.equal(directory[0].base, 'CAICÓ'));
test('Equipes restritas à Base', () => assert.deepEqual(core.teamsForBase(directory, 'CAICO').map((entry) => entry.team), ['LM-01']));
test('Chefe associado à equipe correta', () => assert.equal(core.teamDirectoryEntry(directory, 'ASSÚ', 'lm-03').crewLeader, 'Chefe C'));
test('Cadastro vazio/malformado não libera texto livre', () => { assert.throws(() => core.normalizeTeamDirectory([])); assert.throws(() => core.normalizeTeamDirectory([{ base: 'ASSÚ', team: 'LM', crewLeader: '' }])); });
test('Cadastro conflitante é rejeitado', () => assert.throws(() => core.normalizeTeamDirectory([{ base: 'ASSÚ', team: 'LM', crewLeader: 'A' }, { base: 'ASSU', team: 'LM', crewLeader: 'B' }])));
test('Base sem configuração não recebe equipe inventada', () => assert.equal(core.teamsForBase(directory, 'MOSSORÓ').length, 0));
const errorForAssignment = vm.runInNewContext(`${extract('assignmentError')}\nassignmentError`, { teamDirectory: directory, teamDirectoryEntry: core.teamDirectoryEntry, normalizeText: core.normalizeText });
test('Snapshot histórico intacto mesmo após trocar chefe no cadastro', () => {
  const record = { base: 'CAICÓ', team: 'LM-01', crewLeader: 'Chefe antigo', registeredAt: today };
  assert.equal(errorForAssignment(record, { ...record }), '');
});
test('Alteração de equipe exige chefe atual', () => assert.ok(errorForAssignment({ base: 'CAICÓ', team: 'LM-01', crewLeader: 'Chefe antigo' }, null)));
const controls = {
  operationBase: { value: 'CAICÓ' }, team: { value: 'LM-01', innerHTML: '', insertAdjacentHTML(position, value) { this.innerHTML += value; } },
  crewLeader: { value: '' }, teamDirectoryHint: {}, retryTeamDirectory: {}
};
const controlsContext = { elements: controls, teamDirectory: directory, fieldAssignmentSnapshot: null, supervisorAssignmentSnapshot: null, teamDirectoryMessage: '', teamDirectoryLoading: false, teamsForBase: core.teamsForBase, teamDirectoryEntry: core.teamDirectoryEntry, normalizeText: core.normalizeText, escapeHtml: core.escapeHtml };
const renderControls = vm.runInNewContext(`${extract('renderAssignmentControls')}\nrenderAssignmentControls`, controlsContext);
renderControls();
test('Formulário preenche chefe e opções da base', () => { assert.equal(controls.crewLeader.value, 'Chefe A'); assert.ok(controls.team.innerHTML.includes('LM-01')); assert.ok(!controls.team.innerHTML.includes('LM-02')); });
controlsContext.fieldAssignmentSnapshot = { base: 'CAICÓ', team: 'LM-01', crewLeader: 'Chefe antigo' };
renderControls();
test('Carregar ocorrência antiga não troca seu chefe', () => assert.equal(controls.crewLeader.value, 'Chefe antigo'));
controlsContext.fieldAssignmentSnapshot = null;
controls.operationBase.value = 'CURRAIS NOVOS'; controls.team.value = ''; controls.crewLeader.value = '';
renderControls();
test('Trocar Base limpa vínculo antigo e apresenta novas equipes', () => { assert.equal(controls.crewLeader.value, ''); assert.ok(controls.team.innerHTML.includes('LM-02')); assert.ok(!controls.team.innerHTML.includes('LM-01')); });
controls.team.value = 'LM-02'; renderControls();
test('Trocar Equipe atualiza chefe sem digitação', () => assert.equal(controls.crewLeader.value, 'Chefe B'));
test('Select único e chefe somente leitura', () => {
  assert.match(html, /<select id="team"(?![^>]*multiple)/);
  assert.match(html, /id="crewLeader"[^>]*readonly/);
  assert.match(source, /fieldAssignmentSnapshot = null; elements\.team\.value = ''; elements\.crewLeader\.value = ''/);
  assert.match(source, /supervisorAssignmentSnapshot = null; elements\.editTeam\.value = ''; elements\.editCrewLeader\.value = ''/);
});

const pending = core.RECORD_STATUS.SYNCING_PHOTOS;
const request = { status: 'OPEN', reason: 'FOTOS_PENDENTES', recipient: 'Pessoa A', requestCount: 2 };
const remote = { recordId: 'uuid-a', user: 'Pessoa A', team: 'mesma equipe', status: pending, audit: { photoSyncRequest: request } };
test('Destinatário normalizado é a pessoa A', () => assert.equal(core.openPhotoSyncRequest(remote, ' pessoa   a '), request));
test('Pessoa B da mesma equipe não recebe', () => assert.equal(core.openPhotoSyncRequest(remote, 'Pessoa B'), null));
test('Equipe não é destinatário', () => assert.equal(core.openPhotoSyncRequest(remote, 'mesma equipe'), null));
test('Pedido de outro responsável é rejeitado', () => assert.equal(core.openPhotoSyncRequest({ ...remote, user: 'Pessoa B' }, 'Pessoa A'), null));
test('Botões não ficam bloqueados pelo pedido aberto', () => {
  assert.match(source, /Solicitar novamente/);
  assert.doesNotMatch(extract('requestPhotoSync'), /\|\| openPhotoSyncRequest\(record\)/);
  assert.match(html, /id="requestAllPhotoSyncButton"/);
  assert.match(source, /api\.requestPhotoSyncBatch\(session\.token, ids\)/);
});

const events = []; const batchContext = {
  session: { role: 'field', user: 'Pessoa A' }, sessionRevision: 1, photoSyncAllRunning: false,
  mineRecords: [remote, { ...remote, recordId: 'uuid-b' }, { ...remote, recordId: 'uuid-c' }, remote],
  uniqueRecordsById: core.uniqueRecordsById, openPhotoSyncRequest: core.openPhotoSyncRequest,
  renderPhotoSyncRequests: () => {}, syncRequestedPhotos: async (id, options) => { events.push([id, options]); return { ok: id !== 'uuid-c' }; },
  refreshMine: async () => events.push('refresh'), toast: (message) => events.push(message)
};
await vm.runInNewContext(`${extract('syncAllRequestedPhotos')}\nsyncAllRequestedPhotos`, batchContext)();
test('Sincronizar tudo: UUIDs únicos, duas conclusões e uma pendência', () => {
  assert.deepEqual(events.filter(Array.isArray).map(([id]) => id), ['uuid-a', 'uuid-b', 'uuid-c']);
  assert.equal(events.filter((event) => event === 'refresh').length, 1);
  assert.match(events.at(-1), /2 ocorrências sincronizadas; 1 continua pendente/);
  assert.equal(batchContext.photoSyncAllRunning, false);
});

const badCache = { entries: [] }; let cachedWrites = 0;
const directoryContext = {
  session: { token: 'mock' }, sessionRevision: 1, teamDirectory: directory, teamDirectoryPromise: null, teamDirectoryLoading: false, teamDirectoryMessage: '',
  renderAssignmentControls: () => {}, validateStepOne: () => {}, normalizeTeamDirectory: core.normalizeTeamDirectory,
  navigator: { onLine: true }, getMeta: async () => badCache, setMeta: async () => { cachedWrites += 1; }, TEAM_DIRECTORY_META: 'directory',
  api: { getTeamDirectory: async () => { throw Error('rede'); } }, console: { warn() {} }
};
const loadDirectory = vm.runInNewContext(`${extract('loadTeamDirectory')}\nloadTeamDirectory`, directoryContext);
await loadDirectory();
test('Falha de rede preserva relação válida e não sobrescreve cache', () => { assert.equal(directoryContext.teamDirectory, directory); assert.equal(cachedWrites, 0); assert.equal(directoryContext.teamDirectoryLoading, false); });
directoryContext.navigator.onLine = false;
await loadDirectory();
test('Offline utiliza última relação válida', () => { assert.equal(directoryContext.teamDirectory, directory); assert.match(directoryContext.teamDirectoryMessage, /Offline/); });
directoryContext.teamDirectory = [];
await loadDirectory();
test('Sem cache/offline há erro recuperável, não loading infinito', () => { assert.match(directoryContext.teamDirectoryMessage, /Não foi possível/); assert.equal(directoryContext.teamDirectoryLoading, false); });

test('Série na UI mantém chaves internas e regras 999999', () => {
  assert.match(html, /Série do transformador retirado/); assert.match(html, /Série do transformador instalado/);
  assert.match(source, /removedCode: elements\.removedTransformerCode/);
  const validation = core.validateOccurrence({ occurrenceTypes: ['SUBSTITUIÇÃO DE TRAFO'], transformer: { removedCode: '999999', newCode: '999999' } });
  assert.equal(validation.some((message) => message.includes('série do transformador retirado')), false);
  assert.equal(validation.some((message) => message.includes('série válida')), true);
});
test('Decimais e códigos string preservados', () => { assert.equal(core.parseServiceQuantity('15,50'), 15.5); assert.equal(core.parseServiceQuantity('125.567'), 125.567); assert.equal(core.normalizeMaterials([{ code: '00123', description: 'teste', quantity: 1 }])[0].code, '00123'); });
test('UI mobile: botões quebram linha, status e cards sem largura fixa', () => { assert.match(css, /\.photo-sync-all \.button \{ max-width: 100%; white-space: normal;/); assert.match(css, /\.team-directory-status \{ min-width: 0;/); });

if (!process.argv[2]) throw Error('Informe a fonte oficial do backend como argumento para validar o pacote completo.');
const backend = await readFile(process.argv[2], 'utf8');
const context = { console };
vm.createContext(context);
vm.runInContext(`${backend}\nthis.COL_TEST = COL; this.STATUS_TEST = STATUS;`, context);
const COL = context.COL_TEST; const STATUS = context.STATUS_TEST;
const row = (id, status, general = 0, specific = 0, expected = []) => {
  const values = Array(COL.WIDTH).fill('');
  values[COL.ID - 1] = id; values[COL.STATUS - 1] = status; values[COL.USER - 1] = 'Pessoa A'; values[COL.TEAM - 1] = 'mesma equipe';
  values[COL.TYPES - 1] = specific ? 'SUBSTITUIÇÃO DE TRAFO' : 'PODA';
  for (let i = 0; i < general; i += 1) values[COL.PHOTO_1 - 1 + i] = `https://foto/${i}`;
  if (specific > 0) values[COL.TRAFO_REMOVED_PHOTO - 1] = 'https://foto/6';
  if (specific > 1) values[COL.TRAFO_INSTALLED_PHOTO - 1] = 'https://foto/7';
  values[COL.AUDIT - 1] = JSON.stringify({ expectedPhotoIndexes: expected });
  return values;
};
const scenarios = [
  ['mínimo incompleto', row('a', STATUS.WAITING_SUPERVISOR, 2), STATUS.SYNCING_PHOTOS],
  ['3 gerais válidas sem extras declarados', row('b', STATUS.SYNCING_PHOTOS, 3), STATUS.WAITING_SUPERVISOR],
  ['3/5 confirmadas com 5 declaradas', row('c', STATUS.WAITING_SUPERVISOR, 3, 0, [1,2,3,4,5]), STATUS.SYNCING_PHOTOS],
  ['4/5 confirmadas com 5 declaradas', row('d', STATUS.WAITING_SUPERVISOR, 4, 0, [1,2,3,4,5]), STATUS.SYNCING_PHOTOS],
  ['5/5 completas', row('e', STATUS.SYNCING_PHOTOS, 5, 0, [1,2,3,4,5]), STATUS.WAITING_SUPERVISOR],
  ['Trafo com evidência instalada ausente', row('f', STATUS.WAITING_SUPERVISOR, 5, 1), STATUS.SYNCING_PHOTOS],
  ['Trafo completo', row('g', STATUS.SYNCING_PHOTOS, 3, 2), STATUS.WAITING_SUPERVISOR],
  ['Reprovada excluída', row('h', STATUS.REJECTED, 0), STATUS.REJECTED],
  ['Publicada excluída', row('i', STATUS.PUBLISHED, 0), STATUS.PUBLISHED],
  ['Correção separada', row('j', STATUS.CORRECTION_REQUESTED, 0), STATUS.CORRECTION_REQUESTED],
  ['Rascunho excluído', row('k', 'RASCUNHO', 0), 'RASCUNHO']
];
for (const [label, values, expected] of scenarios) test(`Fotos pendentes: ${label}`, () => assert.equal(context.operationalStatusFromValues_(values), expected));

const relationRows = [['BASE CURRAIS NOVOS','CHEFE DE TURMA'], ['LM-01','Chefe 1'], [], ['BASE CAICO','EQUIPE'], ['LM-02','Chefe 2'], ['EQUIPE','CHEFE DE TURMA']];
let entries = context.parseTeamDirectoryRows_(relationRows);
test('Parser backend lê blocos e ignora títulos/vazios', () => { assert.equal(entries.length, 2); assert.equal(entries[1].base, 'CAICÓ'); });
entries = context.parseTeamDirectoryRows_([['BASE CAICO','EQUIPE'],['LM-02','Chefe 2'],['LM-01','Chefe novo']]);
test('Mudança dinâmica de bloco/chefe sem hardcode', () => { assert.equal(entries[1].base, 'CAICÓ'); assert.equal(entries[1].crewLeader, 'Chefe novo'); });
context.readTeamDirectory_ = () => entries;
test('Backend valida nova seleção e preserva snapshot antigo', () => {
  assert.throws(() => context.assertTeamDirectorySelection_({ base: 'CURRAIS NOVOS', team: 'LM-01', crewLeader: 'Chefe 1' }, null));
  const values = row('old', STATUS.WAITING_SUPERVISOR); values[COL.BASE - 1] = 'CURRAIS NOVOS'; values[COL.TEAM - 1] = 'LM-01'; values[COL.CREW_LEADER - 1] = 'Chefe antigo';
  context.assertTeamDirectorySelection_({ base: 'CURRAIS NOVOS', team: 'LM-01', crewLeader: 'Chefe antigo' }, values);
});

const ids = [1,2,3,4].map((i) => `0000000${i}-0000-4000-8000-000000000000`);
const byId = Object.fromEntries(ids.map((id,i) => [id, { row: i+2, values: row(id, i === 2 ? STATUS.CORRECTION_REQUESTED : STATUS.SYNCING_PHOTOS, i === 3 ? 3 : 2) }]));
const writes = [];
const syncContext = { byId, publishedIds: {}, pending: { getRange: (number, col, height, width) => ({ setValues: (values) => writes.push({ number, col, height, width, values }) }) } };
context.photoSyncContext_ = () => syncContext;
let now = 0;
context.nowIso_ = () => `2026-09-30T10:00:0${now++}-03:00`;
test('Solicitar novamente renova contador e mantém UUID/uma linha', () => {
  const first = context.requestPhotoSync_({ user: 'Supervisor' }, ids[0], syncContext, true);
  const second = context.requestPhotoSync_({ user: 'Supervisor' }, ids[0], syncContext, true);
  assert.equal(first.photoSyncRequest.requestCount, 1); assert.equal(second.photoSyncRequest.requestCount, 2);
  assert.notEqual(first.photoSyncRequest.requestedAt, second.photoSyncRequest.requestedAt);
  assert.equal(second.recordId, ids[0]); assert.equal(writes.length, 2); assert.equal(new Set(writes.map((write) => write.number)).size, 1);
});
context.requireSession_ = (token, roles) => { assert.ok(roles.includes('supervisor')); return { user: 'Supervisor', role: 'supervisor' }; };
context.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const batch = context.requestPhotoSyncBatch_({ token: 'mock', recordIds: [ids[0], ids[0], ids[1], ids[2], ids[3]] });
test('Lote: único por UUID, só pendentes elegíveis, falha parcial explícita', () => { assert.equal(batch.results.length, 4); assert.equal(batch.requested, 2); assert.equal(batch.failed, 2); });
test('Destinatário é COL.USER, nunca COL.TEAM', () => assert.equal(batch.results[0].photoSyncRequest.recipient, 'Pessoa A'));
test('Publicada com cópia pendente não recebe solicitação', () => { syncContext.publishedIds[ids[1]] = true; assert.throws(() => context.requestPhotoSync_({ user: 'Supervisor' }, ids[1], syncContext, true)); });
test('Backend ownership normalizado não libera outra pessoa', () => {
  context.assertOwner_({ role: 'field', user: ' pessoa a ' }, 'Pessoa A');
  assert.throws(() => context.assertOwner_({ role: 'field', user: 'Pessoa B' }, 'Pessoa A'));
});
test('Só confirmação completa resolve pedido, falha mantém aberto', () => {
  const audit = { photoSyncRequest: { status: 'OPEN' } };
  context.resolvePhotoSyncRequest_(audit, STATUS.SYNCING_PHOTOS, 'Pessoa A'); assert.equal(audit.photoSyncRequest.status, 'OPEN');
  context.resolvePhotoSyncRequest_(audit, STATUS.WAITING_SUPERVISOR, 'Pessoa A'); assert.equal(audit.photoSyncRequest.status, 'RESOLVED');
});
test('Nenhuma coluna/aba operacional foi adicionada', () => { assert.equal(COL.WIDTH, 46); assert.ok(backend.includes("teamDirectorySheet: 'Equipe X Base X Chefe de turma'")); });

console.log(JSON.stringify({ passed, photoPendingScenarios: scenarios.length, productionWrites: 0 }, null, 2));
