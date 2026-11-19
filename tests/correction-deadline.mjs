import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { correctionTiming, buildCorrectionOverview, correctionDeadlineMarkup, correctionOverviewMarkup, RECORD_STATUS, correctionDate } from '../core.js';
const require = createRequire(import.meta.url);
const fake = require('fake-indexeddb');
globalThis.indexedDB = fake.indexedDB; globalThis.IDBKeyRange = fake.IDBKeyRange;
const db = await import('../db.js');
const origin=Date.UTC(2026,10,19,13), id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const record=(n,hours=0,fiscal='JOÃO')=>({recordId:id(n),occurrenceNumber:'OC-'+n,status:RECORD_STATUS.CORRECTION_REQUESTED,user:'Campo',base:'MOSSORÓ',team:'LV 02',audit:{lastCorrectionRequest:{requestedAt:new Date(origin-hours*3600000).toISOString(),reason:'Revisar',supervisor:'Supervisor',routingVersion:'FISCAL_ASSIGNED',assignedFiscal:fiscal}}});
test('cores e contagem corretas em 24/48/72 h e no milissegundo anterior',()=>{
 for(const [hours,tone]of [[24,'success'],[48,'warning'],[72-1/3600000,'warning'],[72,'danger'],[96,'danger']])assert.equal(correctionTiming(record(1,hours),origin).tone,tone);
 assert.match(correctionDate(origin),/19\/11\/2026.*10:00/);
});
test('gráfico deduplica, ordena fiscais, soma categorias e calcula média real',()=>{
 const rows=[record(1,18,'JOÃO'),record(2,51,'JOÃO'),record(3,84,'ANA'),record(4,3,'JOÃO')];
 const data=buildCorrectionOverview([...rows,rows[1]],origin);assert.equal(data.total,4);assert.equal(data.within,3);assert.equal(data.expired,1);assert.equal(data.meanMs,39*3600000);assert.equal(data.groups[0].label,'JOÃO');
 for(const group of data.groups)assert.equal(group.total,group.within+group.expired+group.unknown);
});
test('corrigidas, novas sem pedido e substituídas não são pendências do gráfico',()=>{
 const fixed=record(1,96);fixed.audit.lastCorrectionSubmission={phase:'COMPLETE',requestedAt:fixed.audit.lastCorrectionRequest.requestedAt};
 const replaced=record(2,90);replaced.audit.lastCorrectionRequest.replacementRecordId=id(3);
 const newRecord={...record(3),audit:{},status:'FOTOS_SENDO_SINCRONIZADAS'};
 assert.equal(buildCorrectionOverview([fixed,replaced,newRecord],origin).total,0);
});
test('data desconhecida é cinza, sem vencimento inventado e fora da média',()=>{
 const unknown=record(1);delete unknown.audit.lastCorrectionRequest.requestedAt;
 const data=buildCorrectionOverview([unknown],origin);assert.equal(data.unknown,1);assert.equal(data.expired,0);assert.equal(data.meanMs,null);
 assert.match(correctionOverviewMarkup([unknown],origin),/sem data comprovada/);
});
test('detalhamento contém número, equipe, base, datas, espera, atraso e acesso',()=>{
 const html=correctionOverviewMarkup([record(1,84)],origin);
 for(const text of ['OC-1','LV 02','MOSSORÓ','Tempo de atraso','Fiscal responsável','Prazo final','Abrir ocorrência','Iniciar novo lançamento'])assert.ok(html.includes(text),text);
 assert.ok(correctionDeadlineMarkup(record(1,84),{now:origin}).includes('Prazo de correção encerrado. Esta ocorrência ultrapassou o limite de 3 dias. Será necessário realizar um novo lançamento.'));
});
test('gráfico reflete correção e exclusão usando os mesmos registros da lista',()=>{
 const a=record(1),b=record(2,90);assert.equal(buildCorrectionOverview([a,b],origin).total,2);
 a.status='AGUARDANDO_SUPERVISOR';assert.equal(buildCorrectionOverview([a,b],origin).expired,1);
 assert.equal(buildCorrectionOverview([a],origin).total,0);
});
test('limpeza IndexedDB elimina dez filas e fotos, preserva a protegida, resiste a cache antigo',async()=>{
 const keep='e11b519b-9f26-4854-8de0-b7c5d835bb7c', ids=Array.from({length:10},(_,i)=>id(i+1));
 for(const uuid of [...ids,keep,id(12)]){
  await db.putRecord({recordId:uuid,status:'PENDENTE_ENVIO',user:'Campo',photoStates:[]});
  await db.putPhoto(uuid,1,new Blob(['foto original '+uuid]),'key-'+uuid);
  await db.setMeta('fiscalCorrection:'+JSON.stringify(['Fiscal',uuid,'request','revision']),{record:{recordId:uuid},photos:{1:{blob:new Blob(['rascunho fiscal'])}}});
 }
 const protectedPhoto=await db.getPhoto(keep,1), before=await protectedPhoto.blob.text();
 await db.purgeRemovedRecords(ids);assert.equal((await db.getAllRecords()).length,2);assert.equal((await db.getPhoto(keep,1)).blob.size,protectedPhoto.blob.size);assert.equal(await (await db.getPhoto(keep,1)).blob.text(),before);
 for(const uuid of ids){assert.equal(await db.getRecord(uuid),null);assert.equal(await db.getPhoto(uuid,1),undefined);assert.equal(await db.getMeta('fiscalCorrection:'+JSON.stringify(['Fiscal',uuid,'request','revision'])),null);await assert.rejects(db.putRecord({recordId:uuid}),e=>e.code==='RECORD_REMOVED');}
 // Simulate an old open tab writing directly to its old object-store protocol.
 const database=await db.openDatabase();await new Promise((resolve,reject)=>{const tx=database.transaction(['records'],'readwrite');tx.objectStore('records').put({recordId:ids[0],status:'PENDENTE_ENVIO'});tx.oncomplete=resolve;tx.onerror=reject;});
 await db.purgeRemovedRecords(ids);const raw=await new Promise((resolve,reject)=>{const req=database.transaction(['records']).objectStore('records').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=reject;});
 assert.equal(raw.some(row=>ids.includes(row.recordId)),false);assert.ok(await db.getRecord(keep));assert.ok(await db.getRecord(id(12)));
 await assert.rejects(db.purgeRemovedRecords([keep]),/protegida/);assert.ok(await db.getRecord(keep));
});

test('abrir ocorrência pelo gráfico muda para correções e remove filtros incompatíveis',async()=>{
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8'), fn=app.match(/function openCorrectionFromChart\([^]*?\n\}/)[0];
 const item={recordId:id(5)}, c={session:{role:'supervisor'},supervisorPendingRecords:[item],supervisorTab:'occurrences',supervisorPendingFilter:'photos',supervisorFiltersByTab:{pending:{search:'outra OC'}},emptySupervisorFilters:()=>({search:''}),saveSupervisorFilters(){},restoreSupervisorFilters(){},renderSupervisorList(){c.rendered=true;},filteredSupervisorRecords:()=>c.supervisorTab==='pending'&&c.supervisorPendingFilter==='correction'&&!c.supervisorFiltersByTab.pending.search?[item]:[],openSupervisorReview:uuid=>{assert.ok(c.filteredSupervisorRecords().some(row=>row.recordId===uuid));c.opened=uuid;}};
 vm.createContext(c);vm.runInContext(fn,c);c.openCorrectionFromChart(item.recordId);assert.equal(c.opened,item.recordId);assert.equal(c.rendered,true);assert.equal(c.supervisorPendingFilter,'correction');assert.equal(c.supervisorTab,'pending');
 c.opened=null;c.openCorrectionFromChart(id(6));assert.equal(c.opened,null);c.session.role='fiscal';c.openCorrectionFromChart(item.recordId);assert.equal(c.opened,null);
});
