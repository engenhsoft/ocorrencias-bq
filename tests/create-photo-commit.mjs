import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

if (!process.argv[2] || !process.argv[3]) throw Error('Informe backend corrigido e baseline 2026.10.07.1.');
const [fixed, baseline, appSource, coreSource, apiSource, correctionTests, stabilityTests, oldApp] = await Promise.all([
  readFile(process.argv[2], 'utf8'), readFile(process.argv[3], 'utf8'),
  ...['app.js','core.js','api.js','tests/correction-persistence.mjs','tests/stability-audit.mjs'].map(name => readFile(new URL('../' + name, import.meta.url), 'utf8')),
  process.argv[4] ? readFile(process.argv[4] + '/app.js', 'utf8') : readFile(new URL('../app.js', import.meta.url), 'utf8')
]);
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSource).toString('base64'));
const extract = (s, name) => { const m = s.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(m, name); return m[0]; };
const plain = v => JSON.parse(JSON.stringify(v));
const test = (name, run) => tests.push({ name, run }); const tests = []; const traces = [];
const UUID = '11111111-1111-4111-8111-111111111111';
const key = n => `${String(n).padStart(8,'0')}-2222-4222-8222-222222222222`;
const factory = vm.runInNewContext(correctionTests.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(correctionTests,'harness') + '\nharness', { vm, backend: fixed, createHash, assert, core });
const fakeDrive = vm.runInNewContext(extract(correctionTests,'fakePhotoDrive') + '\nfakePhotoDrive', { Buffer });
function record() {
  return { recordId: UUID, updatedAt:'2026-10-07T12:00:00Z', user:'Campo FICTÍCIO', status:core.RECORD_STATUS.PENDING,
    base:'ASSÚ', contract:'4600080939', team:'LM TESTE', crewLeader:'Chefe TESTE', occurrenceNumber:'Teste', occurrenceTypes:['OUTRO'], otherOccurrenceType:'Teste',
    pgPostRemoved:'',pgPostInstalled:'',pgConductorStart:'',pgConductorEnd:'',transformer:{}, observation:'', totalServices:96.96,
    services:[{ lineId:'fixture-service', catalogKey:'Emergência:3', code:'SDMMU4201II', catalogText:'AVISO DE DESLIGAMENTO POR TRAFO', unit:'UD', group:'REDES EMERGÊNCIA', contract:'4600080939', referenceValue:96.96, quantity:1, totalValue:96.96, origin:'Emergência' }],
    materials:[{ lineId:'fixture-material',code:'3411405',description:'Material TESTE',unit:'UN',quantity:1 }],
    photoStates:Array.from({length:7},(_,i)=>({photoIndex:i+1,localReady:i<5,confirmed:false,serverUrl:'',uploadKey:i<5?key(i+1):'',replacePending:false})) };
}
function backendHarness(source = fixed) {
  const h = factory([['SDMMU4201II','AVISO DE DESLIGAMENTO POR TRAFO','UD','REDES EMERGÊNCIA','','','','96,96','96,96']],source);
  h.c.requireSession_ = () => ({role:'field',user:'Campo FICTÍCIO'});
  h.c.assertTeamDirectorySelection_ = () => {};
  h.c.CacheService = {getScriptCache:()=>({get:()=> '1',put(){},remove(){}})};
  const pending=h.sheet(h.c.meta.APP.pendingSheet), column=h.c.meta.COL.CONTRACT-1;
  // Model the exact coercion observed in the live UNFORMATTED_VALUE read.
  const append=pending.appendRow.bind(pending);pending.appendRow=row=>{const next=Array.from(row);next[column]=Number(next[column]);append(next);};
  const range=pending.getRange.bind(pending);pending.getRange=(...args)=>{const r=range(...args),set=r.setValues;r.setValues=values=>{const result=set(values);for(let i=0;i<values.length;i++){const row=pending.rows[args[0]-1+i];if(row && row[column]!=='' && row[column]!=null)row[column]=Number(row[column]);}return result;};return r;};
  h.submit=payload=>h.c.submitRecord_({token:'fixture',record:payload,clientVersion:core.APP_VERSION});
  h.state=()=>h.c.getRecordState_({token:'fixture',recordId:UUID});
  h.drive=fakeDrive(h);return h;
}
function client(h, source=appSource, existing, existingPhotos) {
  const saved=existing||new Map([[UUID,record()]]), photos=existingPhotos||new Map();
  if(!existingPhotos)for(let i=1;i<=5;i++)photos.set(UUID+':'+i,{recordId:UUID,photoIndex:i,uploadKey:key(i),blob:new Blob(['photo'+i],{type:'image/jpeg'})});
  const events=[], uploads=[], submitted=[],deleted=[],errors=[];let loseResponse=false, failSlot=0;
  const c=vm.createContext({...core, Blob, Map, Set, JSON, Date, structuredClone, session:{role:'field',user:'Campo FICTÍCIO',token:'fixture'}, sessionRevision:1,navigator:{onLine:true},
    dailyProduction:{totalExcludingRecord:0}, TYPE_TRAFO:'SUBSTITUIÇÃO DE TRAFO',recordSyncPromises:new Map(),syncRunning:false,elements:{syncNowButton:{}},SYNCABLE_STATUSES:new Set([core.RECORD_STATUS.PENDING,core.RECORD_STATUS.ERROR]),
    getRecord:async id=>structuredClone(saved.get(id)),getAllRecords:async()=>Array.from(saved.values()).map(r=>structuredClone(r)),
    putRecord:async(r,opts={})=>{if(opts.expectedUpdatedAt!==undefined && opts.expectedUpdatedAt!==String(saved.get(r.recordId)?.updatedAt||''))throw new c.ApiError('Local mudou','LOCAL_RECORD_CHANGED');const next={...r,updatedAt:new Date(Math.max(Date.now(),Date.parse(saved.get(r.recordId)?.updatedAt||'')+1||0)).toISOString()};saved.set(r.recordId,structuredClone(next));return next;},
    getPhoto:async(id,i)=>photos.get(id+':'+i),deletePhoto:async(id,i,k)=>{if(photos.get(id+':'+i)?.uploadKey!==k)return false;deleted.push(i);photos.delete(id+':'+i);return true;},
    setMeta:async()=>{},cacheDailySummary:async()=>{},LAST_SYNC_META:'fixture',updateQueueUi:async()=>{},currentView:'sync',mineRecords:[],photoSyncAllRunning:false,refreshMine(){},logout(){},toast(){},setBusy(){},console:{warn(){},error(){}},friendlyError:e=>e.message,
    onSyncError:e=>errors.push({code:e.code,message:e.message}), blobToDataUrl:async()=> 'data:image/jpeg;base64,aGVsbG8=',URL,AbortController,setTimeout,clearTimeout,FileReader:class { readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result='data:image/jpeg;base64,'+Buffer.from(buffer).toString('base64');this.onload();}).catch(error=>{this.error=error;this.onerror();});} },
    fetch:async(_,options)=>{const p=JSON.parse(options.body);events.push(p.action);
      if(p.action==='submitRecord')submitted.push(p.record.recordId);
      if(p.action==='uploadPhoto'){uploads.push(p.photoIndex);if(failSlot===p.photoIndex)throw Error('network');}
      let data;try{data=p.action==='submitRecord'?h.c.submitRecord_(p):p.action==='uploadPhoto'?h.c.uploadPhoto_(p):h.c.getRecordState_(p);}catch(e){data={ok:false,error:e.code||'SERVER_ERROR',message:e.message};}
      if(p.action==='uploadPhoto' && loseResponse){loseResponse=false;throw Error('response lost');}
      return {ok:true,status:200,text:async()=>JSON.stringify(data)};
    }});
  vm.runInContext("const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec';const MATERIAL_CATALOG_SOURCE={};\n"+apiSource.replace(/^import .*?;\n/gm,'').replace(/^export /gm,'')+'\nthis.api=api;this.ApiError=ApiError;',c);
  vm.runInContext(['syncSingleRecord','performSyncSingleRecord','syncAll'].map(n=>extract(source,n).replaceAll("if (error?.code === 'LOCAL_RECORD_CHANGED')", "onSyncError(error); if (error?.code === 'LOCAL_RECORD_CHANGED')")).join('\n'),c);
  return {c,saved,photos,events,uploads,submitted,deleted,errors,fail(n){failSlot=n;},lose(){loseResponse=true;}};
}
function assertNoPublication(h) {
  for(const name of [h.c.meta.APP.officialSheet,h.c.meta.APP.servicesSheet,h.c.meta.APP.materialsSheet])assert.equal(h.sheet(name).getLastRow(),1);
}
function assertOne(h) {const {APP,COL}=h.c.meta;assert.equal(h.sheet(APP.pendingSheet).getLastRow(),2);assert.equal(h.sheet(APP.pendingSheet).rows[1][COL.ID-1],UUID);assertNoPublication(h);}

test('baseline reproduz contrato número x texto, erro de correção em CREATE, zero uploads e cinco blobs preservados',async()=>{
  const h=backendHarness(baseline),ui=client(h,oldApp);await ui.c.syncSingleRecord(UUID,false);
  assert.match(ui.saved.get(UUID).lastError,/A correção permanece pendente/);assert.equal(ui.uploads.length,0);assert.equal(ui.photos.size,5);assertOne(h);
  const row=h.sheet(h.c.meta.APP.pendingSheet).rows[1],audit=JSON.parse(row[h.c.meta.COL.AUDIT-1]);assert.deepEqual(plain(audit.photoFileIds),{});assert.deepEqual(plain(audit.expectedPhotoIndexes),[1,2,3,4,5]);assert.equal(row[h.c.meta.COL.CONTRACT-1],4600080939);
  traces.push({scenario:'before',requests:ui.events,uploads:ui.uploads,localBlobs:ui.photos.size,error:ui.saved.get(UUID).lastError});
});
test('CREATE data commit aceita 0/5 fotos, confirma todos os dados e conserva estado intermediário',()=>{
  const h=backendHarness(),r=h.submit({...record(),expectedPhotoIndexes:[1,2,3,4,5]});assert.equal(r.status,'FOTOS_SENDO_SINCRONIZADAS');assert.equal(r.photoStates.filter(p=>p.confirmed).length,0);
  assert.equal(r.record.contract,'4600080939');assert.equal(r.record.totalServices,96.96);assert.equal(r.record.services[0].quantity,1);assert.equal(r.record.materials[0].code,'3411405');assertOne(h);
});
test('CREATE com cinco blobs executa cinco uploads/confirmations e chega apenas a AGUARDANDO_SUPERVISOR',async()=>{
  const h=backendHarness(),ui=client(h),r=await ui.c.syncSingleRecord(UUID,false);assert.equal(r.status,'AGUARDANDO_SUPERVISOR', JSON.stringify({error:r.lastError,events:ui.events,uploads:ui.uploads,errors:ui.errors}));assert.deepEqual(ui.uploads,[1,2,3,4,5]);assert.equal(ui.photos.size,0);assert.equal(h.drive.created(),5);assertOne(h);
  traces.push({scenario:'after',requests:ui.events,uploads:ui.uploads,localBlobs:ui.photos.size,status:r.status});
});
test('data OK, foto 1 falha: retry mantém UUID, snapshots, registrado em e só retoma fotos',async()=>{
  const h=backendHarness(),ui=client(h);ui.fail(1);const first=await ui.c.syncSingleRecord(UUID,false);assert.equal(first.status,'ERRO_SINCRONIZACAO');assert.match(first.lastError,/sincronização das fotos/);assert.doesNotMatch(first.lastError,/correção/i);assert.equal(ui.photos.size,5);
  const state=h.state(),history=h.sheet(h.c.meta.APP.historySheet).getLastRow();ui.fail(0);const r=await ui.c.syncSingleRecord(UUID,false);assert.equal(r.status,'AGUARDANDO_SUPERVISOR');assert.equal(ui.submitted.length,1);assert.equal(r.registeredAt,state.record.registeredAt);assert.equal(h.sheet(h.c.meta.APP.historySheet).getLastRow(),history);
  assert.deepEqual(plain(r.services),plain(state.record.services));assert.deepEqual(plain(h.state().record.materials),plain(state.record.materials));assertOne(h);
});
test('releitura inicialmente incompleta se confirma uma vez, sem reescrever dados nem interromper uploads',async()=>{
  const h=backendHarness(),original=h.c.uniqueCorrectionRow_;let reads=0,miss=false;
  h.c.uniqueCorrectionRow_=function(sheet,id){const found=original(sheet,id);if(found && sheet===h.sheet(h.c.meta.APP.pendingSheet) && !miss){miss=true;reads++;const row=found.values.slice();row[h.c.meta.COL.CONTRACT-1]='';return {...found,values:row};}return found;};
  const ui=client(h),r=await ui.c.syncSingleRecord(UUID,false);assert.equal(reads,1);assert.equal(r.status,'AGUARDANDO_SUPERVISOR');assert.equal(ui.submitted.length,1);assert.equal(ui.uploads.length,5);
});
test('3/5 confirmadas: retry envia apenas 4/5 sem regravar dados, snapshots ou timeline',async()=>{
  const h=backendHarness(),ui=client(h);ui.fail(4);await ui.c.syncSingleRecord(UUID,false);assert.equal(h.state().photoStates.filter(p=>p.confirmed).length,3);assert.equal(ui.photos.size,2);
  const baselineState=h.state();ui.uploads.length=0;ui.fail(0);await ui.c.syncSingleRecord(UUID,false);assert.deepEqual(ui.uploads,[4,5]);assert.equal(ui.submitted.length,1);assert.equal(h.state().record.registeredAt,baselineState.record.registeredAt);assertOne(h);
});
test('resposta de upload perdida: mesma uploadKey reconciliada, sem duplicar foto no Drive',async()=>{
  const h=backendHarness(),ui=client(h);ui.lose();await ui.c.syncSingleRecord(UUID,false);assert.equal(ui.photos.size,5);assert.equal(h.drive.created(),1);
  ui.uploads.length=0;await ui.c.syncSingleRecord(UUID,false);assert.deepEqual(ui.uploads,[2,3,4,5]);assert.equal(ui.submitted.length,1);assert.equal(h.drive.created(),5);assert.equal(ui.photos.size,0);assertOne(h);
});
test('retry backend do mesmo slot e uploadKey retorna a foto existente',()=>{
  const h=backendHarness();h.submit({...record(),expectedPhotoIndexes:[1,2,3,4,5]});const p={token:'fixture',recordId:UUID,photoIndex:1,uploadKey:key(1),dataUrl:'data:image/jpeg;base64,aGVsbG8='};const a=h.c.uploadPhoto_(p),b=h.c.uploadPhoto_(p);assert.equal(a.photoStates[0].serverUrl,b.photoStates[0].serverUrl);assert.equal(h.drive.created(),1);
});
test('reload conserva blobs e UUID e Sincronizar Tudo continua dos slots faltantes',async()=>{
  const h=backendHarness(),ui=client(h);ui.fail(4);await ui.c.syncSingleRecord(UUID,false);
  const reopened=client(h,appSource,ui.saved,ui.photos);await reopened.c.syncAll(false);assert.deepEqual(reopened.uploads,[4,5]);assert.equal(reopened.submitted.length,0);assert.equal(reopened.saved.get(UUID).status,'AGUARDANDO_SUPERVISOR');assertOne(h);
});
test('blob ausente informa slot, preserva demais blobs e impede falso sucesso',async()=>{
  const h=backendHarness(),ui=client(h);ui.photos.delete(UUID+':4');await ui.c.syncSingleRecord(UUID,false);assert.match(ui.saved.get(UUID).lastError,/Foto 4 não está mais disponível neste aparelho/);assert.equal(ui.saved.get(UUID).status,'ERRO_SINCRONIZACAO');assert.equal(h.state().status,'FOTOS_SENDO_SINCRONIZADAS');assert.equal(ui.photos.has(UUID+':5'),true);assertOne(h);
});
for(const column of ['BASE','TEAM','CREW_LEADER','OCCURRENCE_NUMBER','CONTRACT','TOTAL','OBSERVATION','AUDIT'])test('perda real de '+column+' continua rejeitada, com mensagem CREATE e releitura limitada',()=>{
  const h=backendHarness(),pending=h.sheet(h.c.meta.APP.pendingSheet),append=pending.appendRow.bind(pending);
  pending.appendRow=row=>{const next=Array.from(row);next[h.c.meta.COL[column]-1]=column==='OBSERVATION'?'lost':'';append(next);};
  assert.throws(()=>h.submit({...record(),expectedPhotoIndexes:[1,2,3,4,5]}),e=>e.code==='DATA_COMMIT_UNCONFIRMED'&&!e.message.includes('correção'));
});
test('PHOTO_COMMIT falho não vira mensagem de correção nem remove o blob local',async()=>{
  const h=backendHarness(),pending=h.sheet(h.c.meta.APP.pendingSheet),original=pending.getRange.bind(pending);let drop=false;
  pending.getRange=(...args)=>{const r=original(...args),set=r.setValues;r.setValues=rows=>{const result=set(rows);if(drop && args[1]===1)pending.rows[args[0]-1][h.c.meta.COL.PHOTO_1-1]='';return result;};return r;};
  const ui=client(h);const fetch=ui.c.fetch;ui.c.fetch=async(...args)=>{if(JSON.parse(args[1].body).action==='uploadPhoto')drop=true;return fetch(...args);};await ui.c.syncSingleRecord(UUID,false);assert.equal(ui.photos.size,5);assert.match(ui.saved.get(UUID).lastError,/sincronização das fotos/);assert.equal(h.state().status,'FOTOS_SENDO_SINCRONIZADAS');
});
test('contrato divergente não é normalizado para o contrato esperado; zeros em outros campos permanecem protegidos',()=>{
  const h=backendHarness(),row=Array(h.c.meta.COL.WIDTH).fill('');row[0]=UUID;row[h.c.meta.COL.CONTRACT-1]='4600080939';const actual=row.slice();actual[h.c.meta.COL.CONTRACT-1]=4600080938;assert.notEqual(h.c.pendingPersistenceSnapshot_(actual),h.c.pendingPersistenceSnapshot_(row));actual[h.c.meta.COL.CONTRACT-1]=4600080939;row[h.c.meta.COL.OCCURRENCE_NUMBER-1]='00001';actual[h.c.meta.COL.OCCURRENCE_NUMBER-1]=1;assert.notEqual(h.c.pendingPersistenceSnapshot_(actual),h.c.pendingPersistenceSnapshot_(row));
});
test('UI distingue 5/5 locais de 0/5 servidor e 2/5 locais de 3/5 servidor',()=>{
  const c=vm.createContext({...core,occurrenceTypesText:()=> 'OUTRO',correctionRequestMarkup:()=>''});vm.runInContext(extract(appSource,'recordCard'),c);const local=record();assert.match(c.recordCard(local),/5\/5 fotos salvas neste aparelho · 0\/5 confirmadas no servidor · Sincronização pendente/);
  for(let i=0;i<3;i++)local.photoStates[i]={...local.photoStates[i],confirmed:true,localReady:false,serverUrl:'https://fixture/'+i};assert.match(c.recordCard(local),/2\/5 fotos salvas neste aparelho · 3\/5 confirmadas no servidor/);
});
test('retry confirma metadados de slots antes de dispensar o data commit',async()=>{
  const h=backendHarness(),ui=client(h);ui.fail(1);await ui.c.syncSingleRecord(UUID,false);
  const row=h.sheet(h.c.meta.APP.pendingSheet).rows[1],audit=JSON.parse(row[h.c.meta.COL.AUDIT-1]);audit.expectedPhotoIndexes=[1,2,3];row[h.c.meta.COL.AUDIT-1]=JSON.stringify(audit);
  ui.fail(0);const result=await ui.c.syncSingleRecord(UUID,false);assert.equal(result.status,'AGUARDANDO_SUPERVISOR');assert.equal(ui.submitted.length,2);assert.deepEqual(plain(h.state().record.audit.expectedPhotoIndexes),[1,2,3,4,5]);
});
test('correcao com contrato numerico mantem releitura, fingerprint e receipt COMPLETE',()=>{
  const h=backendHarness(),before=record();h.seed(before,{status:h.c.meta.STATUS.CORRECTION_REQUESTED});
  const payload={...before,observation:'corrigida',correctionRequestId:key(9),correctionRequestedAt:'',expectedPhotoIndexes:[1,2,3]};
  const result=h.submit(payload);assert.equal(result.status,'AGUARDANDO_SUPERVISOR');assert.equal(result.record.observation,'corrigida');assert.equal(result.record.audit.lastCorrectionSubmission.phase,'COMPLETE');assert.ok(result.record.audit.lastCorrectionSubmission.dataVerifiedAt);
});
test('protecoes de correcao, publicacao e batching anterior permanecem byte a byte',()=>{
  for(const name of ['finishCorrection_','prepareCorrectionReceipt_','correctionFingerprint_','photoSlotConfirmed_','recordReadyForSupervisorValues_','readPublicPhotoReferencesBatch_','publicPhotoReferencesFromBatch_','cachedPublicPhotosForRows_','supervisorCorrectRecord_','supervisorAction_'])assert.equal(extract(fixed,name),extract(baseline,name),name);
});
let passed=0;const failures=[];for(const {name,run} of tests){try{await run();passed++;}catch(e){failures.push({name,error:e.stack});}}
const result={total:tests.length,passed,failed:failures.length,productionWrites:0,traces,failures};console.log(JSON.stringify(result,null,2));
if(process.argv[5])await writeFile(process.argv[5],JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
