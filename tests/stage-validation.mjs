import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

// Synthetic fixtures only. No browser, credentials, network or production storage.
const root = new URL('../', import.meta.url);
const initialHead = '7c7ea0deec3dbf2fd8d33f27fbca81c1234be507';
const read = name => readFile(new URL(name, root), 'utf8');
const baseline = name => execFileSync('git', ['show', initialHead + ':' + name], { cwd: root, encoding: 'utf8' });
const [appSource, coreSource] = await Promise.all(['app.js', 'core.js'].map(read));
const loadCore = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const core = await loadCore(coreSource), oldCore = await loadCore(baseline('core.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const extract = (source, name) => {
  const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(match, name); return match[0];
};
const tests = [];
const test = (name, run) => tests.push({ name, run });
const TRAFO = 'SUBSTITUIÇÃO DE TRAFO', POSTE = 'SUBSTITUIÇÃO DE POSTE', CONDUTOR = 'SUBSTITUIÇÃO DE CONDUTOR';
const removedError = 'Adicione a evidência do transformador retirado.';
const installedError = 'Adicione a evidência do transformador instalado.';
const generalError = 'Adicione pelo menos 3 fotos da ocorrência.';
const fixture = (changes = {}) => ({
  recordId: '11111111-2222-4333-8444-555555555555', user: 'Equipe FIXTURE',
  base: 'CAICÓ', contract: '4600080938', team: 'LM FIXTURE', crewLeader: 'Chefe FIXTURE',
  occurrenceNumber: 'OCORRENCIA_FIXTURE', occurrenceTypes: [TRAFO], otherOccurrenceType: '',
  pgPostRemoved: 'PG-RETIRADO', pgPostInstalled: 'PG-INSTALADO', pgConductorStart: 'PG-INICIAL', pgConductorEnd: 'PG-FINAL',
  transformer: { removedCode: '123456', removedCia: 'CIA-R', removedBto: 'BTO-R', newCode: '654321', newCia: 'CIA-I', newBto: 'BTO-I' },
  services: [{ lineId: 'service-1', catalogKey: 'Emergência:FIXTURE', code: 'S-FIXTURE', catalogText: 'Serviço fictício', unit: 'M', group: 'FIXTURE', origin: 'Emergência', contract: '4600080938', referenceValue: 20, quantity: 1, totalValue: 20 }],
  materials: [{ lineId: 'material-1', code: '0500109', description: 'Material fictício', unit: 'M', quantity: '0,75', origin: 'Caderno de Obras' }],
  observation: '', photos: ['', '', '', '', ''], transformerPhotos: { removed: '', installed: '' },
  photoStates: core.normalizePhotoStates([]), totalServices: 20, status: core.RECORD_STATUS.DRAFT, ...changes
});
const withPhotos = (record, general = 3, removed = true, installed = true) => {
  const next = plain(record);
  next.photos = Array.from({ length: 5 }, (_, index) => index < general ? 'https://example.test/general-' + (index + 1) : '');
  next.transformerPhotos = { removed: removed ? 'https://example.test/removed' : '', installed: installed ? 'https://example.test/installed' : '' };
  next.photoStates = core.normalizePhotoStates([]).map(state => {
    const url = state.photoIndex <= 5 ? next.photos[state.photoIndex - 1] : state.photoIndex === 6 ? next.transformerPhotos.removed : next.transformerPhotos.installed;
    return { ...state, serverUrl: url || '', confirmed: Boolean(url) };
  });
  return next;
};
const errorsAt = (record, stage, options = {}) => core.validateOccurrence(record, { ...options, validationStage: stage });

function formHarness() {
  const inputs = core.OCCURRENCE_TYPES.map(value => ({ value, checked: false }));
  const controls = new Proxy({}, { get(target, key) {
    return target[key] ||= { value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', scrollIntoView() {},
      addEventListener(type, listener) { this[type] = listener; } };
  } });
  const messages = [], queued = [], syncIds = [], drafts = [];
  const panels = [1, 2, 3].map(step => ({ hidden: false, dataset: { stepPanel: String(step) } }));
  const c = vm.createContext({
    ...core, console, elements: controls, activeRecord: null, fieldServiceSnapshot: [], fieldAssignmentSnapshot: null,
    session: { token: 'fixture-only', user: 'Equipe FIXTURE' }, sessionRevision: 1, currentStep: 1, currentView: 'new',
    occurrenceSubmissionRunning: false, activeDraftSavePromise: null, photoSelectionRequests: new Map(),
    dailyProduction: { totalExcludingRecord: 0 }, navigator: { onLine: false }, window: { scrollTo() {} },
    previewUrls: new Map(), activePhotos: new Map(), ACTIVE_DRAFT_META: 'fixture-draft', LAST_TEAM_KEY: 'fixture-team',
    TYPE_TRAFO: TRAFO, TYPE_POST: POSTE, TYPE_CONDUCTOR: CONDUTOR, TYPE_OTHER: 'OUTRO',
    blankRecord: () => ({ transformer: {}, transformerPhotos: {}, photoStates: [] }),
    $$: selector => selector === '[data-step-panel]' ? panels : selector.includes('checkbox') ? inputs : [],
    $: () => null, selectedTypes: () => inputs.filter(input => input.checked).map(input => input.value),
    clearPreviewUrls() {}, renderServices() {}, renderMaterials() {}, renderFieldCorrectionBanner() {}, updateContractOutput() {},
    renderAssignmentControls(edit, record) { controls.team.value = record.team || ''; controls.crewLeader.value = record.crewLeader || ''; },
    showDraftId() {}, navigate() {}, assignmentError: () => '', localStorage: { setItem() {} },
    getPhotosForRecord: async () => [], loadDailyProduction: async () => {}, updateGoal() {},
    saveActiveDraft: async () => { c.activeRecord.step = c.currentStep; drafts.push(plain(c.activeRecord)); },
    toast: message => messages.push(message), photoIndexLabel: index => 'Foto ' + index,
    renderReview() {}, setBusy() {}, confirmAction: async () => true,
    putRecord: async record => queued.push(plain(record)), clearMetaIfValue: async () => {},
    syncSingleRecord: async id => { syncIds.push(id); return { status: core.RECORD_STATUS.WAITING_SUPERVISOR }; },
    resetForm() {}
  });
  for (const name of ['syncFormToRecord', 'validateStepOne', 'validatePhotoStep', 'updatePhotoGrid', 'goToStep', 'loadRecordIntoForm', 'submitOccurrence']) {
    vm.runInContext(extract(appSource, name), c);
  }
  for (const name of ['continueToPhotosButton', 'continueToReviewButton']) {
    const handler = appSource.match(new RegExp('elements\\.' + name + "\\.addEventListener\\('click', [^]*?\\n  \\}\\);"));
    assert.ok(handler, name + ' handler'); vm.runInContext(handler[0], c);
  }
  return { c, controls, messages, queued, syncIds, drafts, panels, async open(record) { await c.loadRecordIntoForm(plain(record)); } };
}

test('baseline reproduz o bloqueio: dados Trafo válidos sem fotos geram as duas evidências', () => {
  assert.deepEqual(oldCore.validateOccurrence(fixture()), [removedError, installedError]);
  assert.ok(extract(baseline('app.js'), 'validateStepOne').includes('validateOccurrence(activeRecord, { originalServices: fieldServiceSnapshot })'));
});
test('Trafo: etapa data aceita zero fotos gerais e específicas', () => assert.deepEqual(errorsAt(fixture(), 'data'), []));
for (const [field, message] of [
  ['removedCode', 'Informe a série do transformador retirado ou 999999.'],
  ['removedCia', 'Informe a CIA do trafo retirado.'], ['removedBto', 'Informe o BTO do transformador retirado.'],
  ['newCode', 'Informe uma série válida para o transformador instalado.'],
  ['newCia', 'Informe a CIA do trafo novo.'], ['newBto', 'Informe o BTO do transformador instalado.']
]) test('Trafo: etapa data bloqueia ' + field + ' ausente', () => {
  const record = fixture(); record.transformer[field] = '';
  assert.deepEqual(errorsAt(record, 'data'), [message]);
});
test('Trafo instalado 999999 permanece inválido', () => {
  const record = fixture(); record.transformer.newCode = '999999';
  assert.deepEqual(errorsAt(record, 'data'), ['Informe uma série válida para o transformador instalado.']);
});
test('Trafo retirado 999999 continua permitido', () => {
  const record = fixture(); record.transformer.removedCode = '999999'; assert.deepEqual(errorsAt(record, 'data'), []);
});
test('DOM offline: botão habilita com 0/5 e clique real navega para fotos no mesmo UUID', async () => {
  const h = formHarness(); await h.open(fixture());
  assert.equal(h.c.validateStepOne(true), true); assert.equal(h.controls.continueToPhotosButton.disabled, false);
  h.controls.continueToPhotosButton.click();
  assert.equal(h.c.currentStep, 2); assert.equal(h.panels[1].hidden, false);
  assert.equal(h.c.activeRecord.recordId, fixture().recordId); assert.equal(h.queued.length, 0);
});
test('DOM: dados Trafo incompletos desabilitam botão e exibem mensagem correta', async () => {
  const h = formHarness(); await h.open(fixture()); h.controls.removedTransformerCia.value = '';
  assert.equal(h.c.validateStepOne(true), false); assert.equal(h.controls.continueToPhotosButton.disabled, true);
  assert.match(h.controls.stepOneErrors.innerHTML, /Informe a CIA do trafo retirado/);
  h.controls.continueToPhotosButton.click(); assert.equal(h.c.currentStep, 1);
});
test('fotos e final sem nenhuma foto exigem 3 gerais e ambas as evidências', () => {
  for (const stage of ['photos', 'final']) assert.deepEqual(errorsAt(fixture(), stage), [generalError, removedError, installedError]);
});
test('3/5 gerais sem evidências Trafo bloqueiam fotos/revisão e final com ambas as mensagens', async () => {
  const record = withPhotos(fixture(), 3, false, false);
  for (const stage of ['photos', 'final']) assert.deepEqual(errorsAt(record, stage), [removedError, installedError]);
  const h = formHarness(); await h.open(record); h.c.currentStep = 2; h.c.updatePhotoGrid();
  assert.equal(h.controls.continueToReviewButton.disabled, true); h.controls.continueToReviewButton.click();
  assert.equal(h.c.currentStep, 2); assert.ok(h.messages.at(-1).includes(removedError)); assert.ok(h.messages.at(-1).includes(installedError));
  await h.c.submitOccurrence(); assert.equal(h.queued.length, 0); assert.equal(h.syncIds.length, 0);
});
for (const [removed, installed, expected] of [[false, true, removedError], [true, false, installedError]]) {
  test('final exige individualmente ' + expected, () => assert.deepEqual(errorsAt(withPhotos(fixture(), 3, removed, installed), 'final'), [expected]));
}
test('2/5 gerais com ambas as evidências não liberam revisão nem final', () => {
  for (const stage of ['photos', 'final']) assert.deepEqual(errorsAt(withPhotos(fixture(), 2), stage), [generalError]);
});
for (const count of [3, 4, 5]) test('Trafo completo com ' + count + '/5 libera revisão e envio final', async () => {
  const record = withPhotos(fixture(), count);
  assert.deepEqual(errorsAt(record, 'photos'), []); assert.deepEqual(errorsAt(record, 'final'), []);
  const h = formHarness(); await h.open(record); h.c.updatePhotoGrid();
  assert.equal(h.controls.continueToReviewButton.disabled, false); h.controls.continueToReviewButton.click();
  assert.equal(h.c.currentStep, 3); await h.c.submitOccurrence();
  assert.equal(h.queued.length, 1); assert.deepEqual(h.syncIds, [record.recordId]); assert.equal(h.queued[0].recordId, record.recordId);
});
test('evidências locais/offline contam antes da sincronização', () => {
  const record = fixture();
  for (const index of [1, 2, 3, 6, 7]) record.photoStates[index - 1].localReady = true;
  assert.deepEqual(errorsAt(record, 'final'), []);
});
for (const types of [[POSTE], [CONDUTOR], [POSTE, CONDUTOR], ['OUTRO'], ['PODA'], [POSTE, CONDUTOR, TRAFO]]) {
  test('anti-regressão validateStepOne: ' + types.join(' + ') + ' não exige nenhum dado da etapa de fotos', async () => {
    const record = fixture({ occurrenceTypes: types, otherOccurrenceType: types.includes('OUTRO') ? 'TIPO FIXTURE' : '' });
    const h = formHarness(); await h.open(record);
    assert.equal(h.c.validateStepOne(true), true); assert.equal(h.controls.continueToPhotosButton.disabled, false);
    h.controls.continueToPhotosButton.click(); assert.equal(h.c.currentStep, 2);
    assert.ok(errorsAt(record, 'final').includes(generalError));
    if (!types.includes(TRAFO)) assert.deepEqual(errorsAt(withPhotos(record, 3, false, false), 'final'), []);
  });
}
test('anti-regressão: validação data não lê nenhum campo de foto presente ou futuro', () => {
  const record = fixture();
  for (const key of ['photos', 'photoStates', 'transformerPhotos', 'futureEvidence']) {
    Object.defineProperty(record, key, { get() { throw Error('Etapa data acessou ' + key); } });
  }
  assert.deepEqual(errorsAt(record, 'data'), []);
  assert.match(extract(appSource, 'validateStepOne'), /validationStage: 'data'/);
});
for (const [field, message] of [
  ['base', 'Selecione a Sub-base.'], ['contract', 'O contrato da Sub-base está inválido. Selecione novamente a Sub-base.'],
  ['team', 'Informe a equipe.'], ['crewLeader', 'Informe o chefe de turma.'], ['occurrenceNumber', 'Informe o Nº da ocorrência.']
]) test('dados continuam exigindo ' + field, () => assert.ok(errorsAt(fixture({ [field]: '' }), 'data').includes(message)));
test('OUTRO continua exigindo texto complementar na etapa data', () => {
  assert.ok(errorsAt(fixture({ occurrenceTypes: ['OUTRO'] }), 'data').includes('Informe o tipo da ocorrência.'));
});
for (const [types, field] of [[[POSTE], 'pgPostRemoved'], [[POSTE], 'pgPostInstalled'], [[CONDUTOR], 'pgConductorStart'], [[CONDUTOR], 'pgConductorEnd']]) {
  test('etapa data continua exigindo ' + field, () => assert.ok(errorsAt(fixture({ occurrenceTypes: types, [field]: '' }), 'data').some(error => error.includes('PG'))));
}
test('photos valida somente fotos; final revalida todos os dados', () => {
  const record = withPhotos(fixture({ team: '' }));
  assert.deepEqual(errorsAt(record, 'photos'), []); assert.ok(errorsAt(record, 'final').includes('Informe a equipe.'));
});
test('validar qualquer etapa não muta UUID, campos, materiais ou snapshot', () => {
  const record = fixture(), before = plain(record);
  for (const stage of ['data', 'photos', 'final']) errorsAt(record, stage);
  assert.deepEqual(record, before);
});
const correction = record => ({
  ...record, correctionMode: true, serverConfirmed: true, registeredAt: '2026-09-24T10:00:00-03:00',
  serverStatus: core.RECORD_STATUS.CORRECTION_REQUESTED, correctionRequestedAt: '2026-10-07T10:00:00-03:00',
  correctionOriginalRequestedAt: '2026-10-07T10:00:00-03:00', correctionOriginal: core.correctionOriginalSnapshot(record)
});
for (const [control, field, value, transformer] of [
  ['pgPostInstalled', 'pgPostInstalled', 'PG-CORRIGIDO', false], ['observation', 'observation', 'OBSERVAÇÃO CORRIGIDA', false],
  ['removedTransformerCode', 'removedCode', '333333', true], ['removedTransformerCia', 'removedCia', 'CIA-CORRIGIDA', true],
  ['newTransformerBto', 'newBto', 'BTO-CORRIGIDO', true]
]) test('correção solicitada: navegação preserva delta de ' + field + ', beforePatch e mesmo UUID', async () => {
  const record = correction(fixture({ occurrenceTypes: [TRAFO, POSTE, CONDUTOR] })), before = core.correctionDataSnapshot(record);
  const h = formHarness(); await h.open(record); h.controls[control].value = value;
  assert.equal(h.c.validateStepOne(true), true); h.controls.continueToPhotosButton.click();
  const after = core.correctionDataSnapshot(h.c.activeRecord), delta = core.correctionDelta(h.c.activeRecord.correctionOriginal, h.c.activeRecord);
  const key = transformer ? 'transformer' : field;
  assert.deepEqual(Object.keys(delta.expectedPatch), [key]); assert.deepEqual(delta.beforePatch[key], before[key]);
  assert.equal(transformer ? delta.expectedPatch.transformer[field] : delta.expectedPatch[field], value);
  for (const name of Object.keys(before).filter(name => name !== key)) assert.deepEqual(after[name], before[name], name);
  assert.equal(h.c.activeRecord.recordId, record.recordId); assert.equal(h.c.currentStep, 2);
  assert.deepEqual(plain(h.c.activeRecord.correctionOriginal), plain(record.correctionOriginal));
});
test('correção de foto ausente alcança fotos; nova evidência gera apenas evidencePatch', async () => {
  const record = correction(withPhotos(fixture(), 3, false, true)); record.requestedPhotoIndexes = [6];
  const h = formHarness(); await h.open(record); h.controls.continueToPhotosButton.click(); assert.equal(h.c.currentStep, 2);
  await h.c.submitOccurrence(); assert.equal(h.queued.length, 0); assert.ok(h.messages.at(-1).includes(removedError));
  Object.assign(h.c.activeRecord.photoStates[5], { localReady: true, replacePending: true, uploadKey: 'fixture-new-evidence' });
  h.c.updatePhotoGrid(); assert.equal(h.controls.continueToReviewButton.disabled, false);
  assert.deepEqual(errorsAt(h.c.activeRecord, 'final'), []);
  await h.c.submitOccurrence(); assert.equal(h.queued.length, 1);
  assert.deepEqual(h.queued[0].expectedPatch, {}); assert.deepEqual(h.queued[0].beforePatch, {});
  assert.deepEqual(h.queued[0].evidencePatch, { 6: { uploadKey: 'fixture-new-evidence' } });
  assert.equal(h.queued[0].recordId, record.recordId);
});
test('correção de foto antiga exige substituição e preserva o arquivo anterior', async () => {
  const record = correction(withPhotos(fixture())); record.requestedPhotoIndexes = [6];
  const h = formHarness(); await h.open(record); h.controls.continueToPhotosButton.click();
  h.controls.observation.value = 'Campo corrigido, falta a foto solicitada';
  await h.c.submitOccurrence(); assert.equal(h.queued.length, 0); assert.match(h.messages.at(-1), /Adicione novamente/);
  const previousUrl = h.c.activeRecord.photoStates[5].serverUrl;
  Object.assign(h.c.activeRecord.photoStates[5], { localReady: true, replacePending: true, uploadKey: 'fixture-replacement' });
  await h.c.submitOccurrence(); assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0].photoStates[5].serverUrl, previousUrl); assert.equal(h.queued[0].recordId, record.recordId);
});
test('correção sem alteração não enfileira nem produz falso corrigido', async () => {
  const h = formHarness(); await h.open(correction(withPhotos(fixture())));
  h.controls.continueToPhotosButton.click(); h.controls.continueToReviewButton.click(); await h.c.submitOccurrence();
  assert.equal(h.queued.length, 0); assert.equal(h.syncIds.length, 0); assert.match(h.messages.at(-1), /Nenhuma alteração foi detectada/);
  const delta = core.correctionDelta(h.c.activeRecord.correctionOriginal, h.c.activeRecord);
  assert.deepEqual(delta, { expectedPatch: {}, beforePatch: {}, photoPatch: {}, evidencePatch: {} });
});
test('serviço histórico intocado preserva snapshot divergente do catálogo atual ao navegar e enviar', async () => {
  const record = withPhotos(fixture({ occurrenceTypes: [POSTE] }));
  Object.assign(record.services[0], { catalogKey: 'CATÁLOGO-REMOVIDO:9', contract: '4600080939', referenceValue: 12.5, quantity: 2.5, totalValue: 31.25 });
  record.totalServices = 31.25;
  const h = formHarness(); await h.open(correction(record)); h.controls.pgPostInstalled.value = 'PG-CORRIGIDO';
  assert.equal(h.c.validateStepOne(true), true); h.controls.continueToPhotosButton.click(); h.controls.continueToReviewButton.click();
  await h.c.submitOccurrence(); assert.equal(h.queued.length, 1); assert.deepEqual(h.queued[0].services, record.services);
  assert.equal(Object.hasOwn(h.queued[0].expectedPatch, 'services'), false);
});
for (const [value, expected] of [['15,50', 15.5], ['15.50', 15.5], ['0,75', 0.75], ['0.75', 0.75], ['2,5', 2.5], ['2.5', 2.5], ['125,567', 125.567], ['125.567', 125.567], ['1.', 1]]) {
  test('QTD decimal ' + value + ' permanece íntegra nas etapas', async () => {
    const record = fixture(); record.services[0].quantity = value;
    const h = formHarness(); await h.open(record); h.controls.continueToPhotosButton.click();
    assert.equal(core.parseServiceQuantity(h.c.activeRecord.services[0].quantity), expected);
    assert.equal(h.c.activeRecord.services[0].quantity, value); assert.equal(h.c.currentStep, 2);
  });
}
test('material STRING 0500109 e quantidade decimal permanecem intactos no payload', async () => {
  const record = correction(withPhotos(fixture())), h = formHarness(); await h.open(record);
  h.controls.observation.value = 'Correção mínima'; h.controls.continueToPhotosButton.click();
  h.controls.continueToReviewButton.click(); await h.c.submitOccurrence();
  assert.deepEqual(h.queued[0].materials, record.materials); assert.equal(typeof h.queued[0].materials[0].code, 'string');
  assert.equal(h.queued[0].materials[0].code, '0500109'); assert.equal(Object.hasOwn(h.queued[0].expectedPatch, 'materials'), false);
});
test('isolamento core: serializer, delta, estados, serviços e materiais permanecem byte a byte', () => {
  const clean = source => source.replace(extract(source, 'validateOccurrence'), 'VALIDATOR')
    .replace(/^export const APP_(VERSION|BUILD) = .*;$/gm, 'RELEASE');
  assert.equal(clean(coreSource), clean(baseline('core.js')));
  const oldData = extract(baseline('core.js'), 'validateOccurrence').split('  const services =')[1]
    .replace(/    if \(!transformerPhotoReady\(record, '(?:removed|installed)'\)\) errors\.push\('[^']+'\);\n/g, '');
  const newData = extract(coreSource, 'validateOccurrence').split('  const services =')[1]
    .replace("  if (validationStage !== 'data') errors.push(...photoErrors());\n", '');
  assert.equal(newData, oldData, 'regras de dados, serviços históricos e materiais não podem mudar');
});
test('isolamento app: toda lógica fora dos gates de etapa permanece byte a byte', () => {
  const clean = source => {
    let result = source.replace(/2026\.10\.07\.[23]/g, 'RELEASE');
    result = result.replace(/, validationStage: 'data'/g, '');
    const handler = result.match(/  elements\.continueToReviewButton\.addEventListener\('click', [^]*?\);\n  \$\$\('\[data-back-step\]'/)[0];
    result = result.replace(handler, 'REVIEW_GATE');
    if (result.includes('function validatePhotoStep(')) result = result.replace(extract(result, 'validatePhotoStep') + '\n\n', '');
    result = result.replace('  validatePhotoStep(false);', '  elements.continueToReviewButton.disabled = ready < 3;');
    result = result.replace("  const errors = validateOccurrence(activeRecord, { originalServices: fieldServiceSnapshot, validationStage: 'final' });\n  if (errors.length) { toast(errors.join(' '), 'error'); return; }\n", '');
    return result;
  };
  assert.equal(clean(appSource), clean(baseline('app.js')));
  const pipeline = source => extract(source, 'submitOccurrence').split('  if (photoSelectionRequests.size)')[1];
  assert.equal(pipeline(appSource), pipeline(baseline('app.js')), 'delta/persistência/retry do envio não podem mudar');
});
for (const name of ['api.js', 'db.js', 'index.html', 'service-worker.js']) test('isolamento ' + name + ': somente identificadores de release mudaram', async () => {
  const clean = source => source.replace(/2026\.10\.07\.[23]/g, 'RELEASE');
  assert.equal(clean(await read(name)), clean(baseline(name)));
});
for (const name of ['config.js', 'styles.css', 'manifest.webmanifest', '.github/workflows/pages.yml']) {
  test('isolamento: ' + name + ' está inalterado', async () => assert.equal(await read(name), baseline(name)));
}
test('sem etapa explícita: contrato anterior do Supervisor permanece idêntico', () => {
  for (const record of [fixture(), withPhotos(fixture()), fixture({ occurrenceTypes: [POSTE] }), fixture({ team: '' })]) {
    assert.deepEqual(core.validateOccurrence(record), oldCore.validateOccurrence(record));
    assert.deepEqual(core.validateOccurrence(record, { historicalServices: true }), oldCore.validateOccurrence(record, { historicalServices: true }));
  }
});

const failures = []; let passed = 0;
for (const item of tests) {
  try { await item.run(); passed++; }
  catch (error) { failures.push({ test: item.name, error: String(error.stack || error) }); }
}
console.log(JSON.stringify({ total: tests.length, passed, failed: failures.length, skipped: 0, productionWrites: 0, officialAppLogins: 0, initialHead, failures }, null, 2));
if (failures.length) process.exitCode = 1;
