import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import vm from 'node:vm';
import { fixtureFactory, id, plain } from './chaves-fixtures.mjs';
const source = await readFile(process.argv[2], 'utf8');
const make = await fixtureFactory(source);
function fixture() {
  const h = make(); let clock = Date.UTC(2026, 10, 19, 13);
  h.c.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
  h.clock = value => { clock = value; };
  h.token = role => h.c.createToken_(role === 'field' ? 'Campo A' : 'Supervisor A', role, clock + 3600000);
  h.grant(); h.add(1); h.request(1);
  h.sheet(h.c.meta.APP.catalogSheet).rows.push(['S','Serviço novo','UN','G','','','','100','100']);
  h.newService = {catalogKey: 'Emergência:3',code:'S',quantity:1};
  h.start = Date.parse(h.audit(1).lastCorrectionRequest.requestedAt);
  h.at = hours => h.clock(h.start + hours * 3600000);
  h.c.CacheService = { getScriptCache: () => ({ get: () => '1', put() {}, remove() {}, getAll: () => ({}) }) };
  return h;
}
test('solicitação calcula 72 h pelo relógio do servidor e registra a rodada', () => {
  const h=fixture(), r=h.audit(1).lastCorrectionRequest;
  assert.equal(Date.parse(r.dueAt)-Date.parse(r.requestedAt),72*3600000); assert.equal(r.round,1);
  assert.equal(h.c.bqDeadline_(h.row(1)).status,'AGUARDANDO_CORRECAO');
});
for(const [hour,status] of [[24,'AGUARDANDO_CORRECAO'],[47.99,'AGUARDANDO_CORRECAO'],[48,'PRAZO_PROXIMO_DO_VENCIMENTO'],[71.99,'PRAZO_PROXIMO_DO_VENCIMENTO'],[72,'FORA_DO_PRAZO_DE_CORRECAO'],[96,'FORA_DO_PRAZO_DE_CORRECAO']]) test(`limite ${hour} horas, inclusive fim de semana`,()=>{const h=fixture();h.at(hour);assert.equal(h.c.bqDeadline_(h.row(1)).status,status);});
test('retry do pedido não reinicia prazo, UUID, rodada nem histórico',()=>{
 const h=fixture(), before=JSON.stringify(h.audit(1)), history=h.sheet(h.c.meta.APP.historySheet).rows.length;
 h.at(48);h.request(1);assert.equal(JSON.stringify(h.audit(1)),before);assert.equal(h.sheet(h.c.meta.APP.historySheet).rows.length,history);
});
test('correção recebida antes do limite é aceita e não expira retroativamente',()=>{
 const h=fixture(), record=h.open(1), payload=h.payload(record,{observation:'Corrigido'});h.at(71.99);
 const r=h.submit(payload);assert.equal(r.status,'AGUARDANDO_SUPERVISOR');const before=JSON.stringify(h.row(1));h.at(96);
 h.c.bqRefreshDeadlines_();assert.equal(JSON.stringify(h.row(1)),before);assert.equal(h.c.bqDeadline_(h.row(1)).status,'CORRIGIDA_DENTRO_DO_PRAZO');
});
for(const hour of [72,72.001,120]) test(`backend rejeita correção em ${hour} h e horário offline forjado`,()=>{
 const h=fixture(), record=h.open(1), payload=h.payload(record,{observation:'Tardia',updatedAt:new Date(h.start).toISOString()});h.at(hour);
 assert.throws(()=>h.submit(payload),e=>e.code==='CORRECTION_DEADLINE_EXPIRED');assert.notEqual(h.row(1)[h.c.meta.COL.OBSERVATION-1],'Tardia');
 h.c.bqRefreshDeadlines_();assert.equal(h.row(1)[h.c.meta.COL.STATUS-1],'REPROVADA');
 assert.equal(h.audit(1).lastCorrectionRequest.deadlineStatus,'FORA_DO_PRAZO_DE_CORRECAO');
});
test('foto tardia não entra no Drive e dados parciais não concluem correção',()=>{
 const h=fixture(), record=h.open(1), key=randomUUID(), states=plain(record.photoStates);states[0]={...states[0],localReady:true,replacePending:true,confirmed:false,uploadKey:key};
 h.submit(h.payload(record,{observation:'Parcial',photoStates:states}));const drive=h.drive();h.at(72);
 assert.throws(()=>h.upload(1,1,key,record.fiscalCorrection),e=>e.code==='CORRECTION_DEADLINE_EXPIRED');assert.equal(drive.created(),0);h.c.bqRefreshDeadlines_();assert.equal(h.row(1)[h.c.meta.COL.STATUS-1],'REPROVADA');
});
test('resposta perdida de correção concluída antes do prazo reconcilia sem escrita tardia',()=>{
 const h=fixture(), payload=h.payload(h.open(1),{observation:'Concluída'});h.submit(payload);const snapshot=JSON.stringify(h.row(1));h.at(96);
 assert.equal(h.submit(payload).status,'AGUARDANDO_SUPERVISOR');assert.equal(JSON.stringify(h.row(1)),snapshot);
});
test('reabertura de rodada legítima mantém o prazo e os dados da rodada anterior',()=>{
 const h=fixture();h.submit(h.payload(h.open(1),{observation:'Primeira rodada'}));const first=plain(h.audit(1).lastCorrectionRequest);h.at(24);h.request(1);
 const audit=h.audit(1);assert.equal(audit.lastCorrectionRequest.round,2);assert.notEqual(audit.lastCorrectionRequest.routingRequestId,first.routingRequestId);assert.deepEqual(plain(audit.correctionRequests[0]),first);
});
test('data desconhecida não inventa vencimento e data local não o substitui',()=>{
 const h=fixture(), a=h.audit(1);delete a.lastCorrectionRequest.requestedAt;h.setAudit(1,a);h.at(1000);
 assert.equal(h.c.bqDeadline_(h.row(1)).status,'DATA_NAO_COMPROVADA');const before=JSON.stringify(h.row(1));h.c.bqRefreshDeadlines_();assert.equal(JSON.stringify(h.row(1)),before);
});
test('novo lançamento exige novo UUID e número, valida e vincula sem copiar fotos',()=>{
 const h=fixture(), original=h.open(1), data={...original,recordId:id(2),occurrenceNumber:'NEW 002',replacementOf:id(1),services:[h.newService]};delete data.fiscalCorrection;h.at(80);
 const photos=h.row(1).slice(18,23);const result=h.submit(data,h.token('field'));
 assert.equal(result.created,true);assert.equal(result.record.audit.replacementOf,id(1));assert.equal(result.record.photos.filter(Boolean).length,0);
 assert.equal(h.row(1)[h.c.meta.COL.STATUS-1],'SUBSTITUIDA_POR_NOVO_LANCAMENTO');assert.deepEqual(h.row(1).slice(18,23),photos);assert.equal(h.audit(1).lastCorrectionRequest.replacementRecordId,id(2));
 assert.equal(h.c.listPending_({token:h.token('supervisor')}).pendingRecords.some(r=>r.recordId===id(1)),false);
});
test('número antigo, terceiro destinatário e UUID removido são recusados',()=>{
 const h=fixture(), original=h.open(1);h.at(80);const data={...original,recordId:id(2),replacementOf:id(1),services:[h.newService]};delete data.fiscalCorrection;
 assert.throws(()=>h.submit(data,h.token('field')),e=>e.code==='REPLACEMENT_IDENTITY_REQUIRED');
 const other=h.c.createToken_('Outro','field',h.start+90*3600000);data.occurrenceNumber='NOVO';assert.throws(()=>h.submit(data,other),e=>e.code==='FORBIDDEN');
 h.props.set('BQ_REMOVED_RECORDS_20261119',JSON.stringify([id(2)]));vm.runInContext('BQ_REMOVED_CACHE_=null',h.c);
 assert.throws(()=>h.submit(data,h.token('field')),e=>e.code==='RECORD_REMOVED');
});
test('limpeza física de dez UUIDs é idempotente e protege o registro e seu histórico',()=>{
 const h=make(), keep='e11b519b-9f26-4854-8de0-b7c5d835bb7c', ids=Array.from({length:10},(_,i)=>id(i+1));
 for(let i=1;i<=12;i++)h.add(i,{status:i<=11?'FOTOS_SENDO_SINCRONIZADAS':'AGUARDANDO_SUPERVISOR'});
 const keepRow=h.row(11);Object.assign(keepRow,{0:keep,2:'JOSE SIMIAO',3:'LV - 02 - MSO',4:'2026 11 10408',39:'MOSSORÓ'});
 h.sheet(h.c.meta.APP.historySheet).appendRow([keep,'2026-11-19','JOSE SIMIAO','CRIADA']);
 h.sheet(h.c.meta.APP.historySheet).appendRow([id(1),'2026-11-19','Campo','CRIADA']);
 const before=JSON.stringify(keepRow), other=JSON.stringify(h.row(12)), keptHistory=JSON.stringify(h.sheet(h.c.meta.APP.historySheet).rows.filter(r=>r[0]===keep));
 const files=new Map();let seq=0;const folder={getId:()=> 'private-folder',getSharingAccess:()=> 'PRIVATE',getEditors:()=>[],getViewers:()=>[],createFile(name,text){const fid='backup-'+(++seq);const file={getId:()=> fid,getBlob:()=>({getDataAsString:()=>text}),getSharingAccess:()=> 'PRIVATE'};files.set(file.getId(),file);return file;}};
 h.c.DriveApp={Access:{PRIVATE:'PRIVATE'},Permission:{VIEW:'VIEW'},createFolder:()=>folder,getFileById:id=>files.get(id)};h.c.MimeType={PLAIN_TEXT:'text/plain'};
 h.c.photoFolder_=()=>({searchFiles:()=>({hasNext:()=>false})});h.c.bqMonitorSheet_=()=>null;
 const plan=h.c.bqPrepareRemoval_(ids,keep);assert.equal(plan.records.length,10);
 const result=h.c.bqExecuteRemoval_(ids,keep);assert.equal(result.removed.length,10);assert.equal(result.protected.recordId,keep);
 assert.equal(JSON.stringify(keepRow),before);assert.equal(JSON.stringify(h.row(12)),other);assert.equal(JSON.stringify(h.sheet(h.c.meta.APP.historySheet).rows.filter(r=>r[0]===keep)),keptHistory);
 for(const sheet of h.sheets.values()) assert.equal(sheet.rows.some(r=>ids.includes(r[0])),false);
 assert.equal(h.c.bqExecuteRemoval_(ids,keep).ok,true);assert.throws(()=>h.c.bqAssertNotRemoved_(id(1)),e=>e.code==='RECORD_REMOVED');
});

test('ao completar 72 h, consultas retiram a OC das pendências sem depender do agendamento',()=>{
 const h=fixture(), before=JSON.stringify(h.row(1));h.at(72);
 const r=h.c.listPending_({token:h.token('supervisor')});
 assert.equal(r.pendingRecords.some(r=>r.recordId===id(1)),false);
 assert.equal(r.metricRecords.find(r=>r.recordId===id(1)).status,'REPROVADA');
 assert.equal(h.c.listMine_({token:h.token('field')}).records.find(r=>r.recordId===id(1)).status,'REPROVADA');
 assert.equal(JSON.stringify(h.row(1)),before,'consulta continua sem escrita');
});
test('rotina autônoma reprova com histórico único, mantém fotos e bloqueia reenvios posteriores',()=>{
 const h=fixture(), record=h.open(1), payload=h.payload(record,{observation:'Tardia'}), photos=JSON.stringify(h.row(1).slice(18,23)), request=plain(h.audit(1).lastCorrectionRequest);h.at(72);
 assert.equal(h.c.bqRefreshDeadlines_().rejected,1);const after=JSON.stringify(h.row(1));
 assert.equal(h.row(1)[h.c.meta.COL.STATUS-1],'REPROVADA');assert.equal(JSON.stringify(h.row(1).slice(18,23)),photos);
 assert.equal(h.audit(1).lastCorrectionRequest.requestedAt,request.requestedAt);
 assert.equal(h.c.bqDeadline_(h.row(1)).status,'FORA_DO_PRAZO_DE_CORRECAO');
 assert.throws(()=>h.submit(payload),e=>e.code==='CORRECTION_DEADLINE_EXPIRED');
 assert.equal(h.c.bqRefreshDeadlines_().rejected,0);assert.equal(JSON.stringify(h.row(1)),after);
 const history=h.sheet(h.c.meta.APP.historySheet).rows.filter(r=>r[0]===id(1)&&r[3]==='REPROVADA_POR_PRAZO');assert.equal(history.length,1);assert.equal(history[0][5],'REPROVADA');
});
test('recibo integral verificado antes do prazo reconcilia e nunca é reprovado por atraso de finalização',()=>{
 const h=fixture();h.at(71);const record=h.open(1);h.submit(h.payload(record,{observation:'Tempestiva'}));
 const a=h.audit(1);a.lastCorrectionSubmission.phase='DATA_VERIFIED';delete a.lastCorrectionSubmission.completedAt;h.setAudit(1,a);h.row(1)[h.c.meta.COL.STATUS-1]='CORRECAO_SOLICITADA';h.at(80);
 assert.equal(h.c.bqDeadline_(h.row(1)).status,'RECONCILIACAO_TEMPESTIVA');
 const late=h.payload(record,{observation:'Nova alteração tardia',correctionRequestId:randomUUID()});
 assert.throws(()=>h.submit(late),e=>e.code==='CORRECTION_DEADLINE_EXPIRED');
 const drive=h.drive();assert.throws(()=>h.upload(1,1,randomUUID(),record.fiscalCorrection),e=>e.code==='CORRECTION_DATA_UNCONFIRMED');assert.equal(drive.created(),0);
 h.c.bqRefreshDeadlines_();
 assert.equal(h.row(1)[h.c.meta.COL.STATUS-1],'AGUARDANDO_SUPERVISOR');assert.equal(h.audit(1).lastCorrectionSubmission.phase,'COMPLETE');
});
test('instalação do agendamento mantém um único gatilho de cinco minutos e preserva os demais',()=>{
 const h=fixture(), triggers=[{getHandlerFunction:()=> 'outroHandler'}];let minutes=0;
 h.c.ScriptApp={getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased(){return this;},everyMinutes(n){minutes=n;return this;},create(){triggers.push({getHandlerFunction:()=>handler});}}),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1)};
 h.c.instalarPrazosCorrecaoBQ();h.c.instalarPrazosCorrecaoBQ();assert.equal(minutes,5);assert.equal(triggers.length,2);
});
