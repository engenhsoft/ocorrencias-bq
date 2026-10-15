// Offline fixtures only. Reuse the current backend harness; no operational access.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as core from '../core.js';
import * as cards from '../occurrence-card.js';
const root = new URL('../', import.meta.url), read = name => readFile(new URL(name, root), 'utf8');
const [backend, persistence, featureTests, features, app, beforeApp] = await Promise.all([readFile(process.argv[2], 'utf8'), read('tests/correction-persistence.mjs'), read('tests/operational-features.mjs'), read('operational-features.js'), read('app.js'), readFile(process.argv[3], 'utf8')]);
const extract = (source, name) => { const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}')); assert.ok(match, name); return match[0]; };
const factory = vm.runInNewContext(persistence.match(/class MemorySheet \{[^]*?\n\}/)[0] + '\n' + extract(persistence, 'harness') + '\nharness', { vm, backend, createHash, assert, core });
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const harness = vm.runInNewContext(extract(featureTests, 'harness') + '\nharness', { factory, vm, extract, backend, createHash, createHmac, randomUUID, Buffer, Map, Date, id });
const plain = value => JSON.parse(JSON.stringify(value)), tests = [];
const test = (name, run) => tests.push({ name, run });
const imageId = index => 'fixture_drive_photo_' + String(index).padStart(15, '0');
function fixture() {
 const h = harness(); h.grant(); h.add(1); h.add(2, { base: 'MOSSORÓ' });
 const row = h.sheet(h.c.meta.APP.pendingSheet).rows[1], { COL } = h.c.meta;
 for (let i=1;i<=5;i++) row[h.c.photoUrlColumn_(i)-1] = `https://drive.google.com/thumbnail?id=${imageId(i)}&sz=w1600`;
 return { h, row, COL, token: h.fiscal().token };
}
test('listagem traz contrato, fotos confirmadas e miniaturas w320, sem originais/serviços', () => {
 const {h, token} = fixture(); h.c.DriveApp = new Proxy({}, {get() { throw Error('Drive I/O in list'); }});
 const record = h.c.listFiscalRecords_({ token }).records[0]; assert.equal(record.contract, '4600080938'); assert.equal(record.photoSlots.length, 5);
 for (const slot of record.photoSlots) { assert.equal(slot.recordId, id(1)); assert.equal(slot.confirmed, true); assert.match(slot.previewUrl, /&sz=w320$/); }
 assert.equal(record.services, undefined); assert.doesNotMatch(JSON.stringify(record), /data:image|w1600|uploadKey|password|token/);
});
test('Trafo oferece 5 gerais e 2 evidências; pendência não fornece URL', () => {
 const {h, row, COL, token} = fixture(); row[COL.TYPES-1] = 'SUBSTITUIÇÃO DE TRAFO'; row[h.c.photoUrlColumn_(6)-1] = `https://drive.google.com/thumbnail?id=${imageId(6)}`;
 const record = h.c.listFiscalRecords_({ token }).records[0]; assert.equal(record.photoSlots.length, 7); assert.equal(record.photoSlots[5].confirmed, true); assert.equal(record.photoSlots[6].previewUrl, '');
});
test('recibo de outra chave ou URL não confirma thumbnail', () => {
 const {h, row, COL, token} = fixture(); const audit=JSON.parse(row[COL.AUDIT-1]); audit.photoSubmissions={1:{phase:'COMPLETE',expectedUrl:'https://wrong.test',uploadKey:'other'}}; row[COL.AUDIT-1]=JSON.stringify(audit);
 const slot=h.c.listFiscalRecords_({token}).records[0].photoSlots[0]; assert.equal(slot.confirmed,false);assert.equal(slot.previewUrl,'');
});
test('uma Base não recebe UUID nem miniaturas de outra; pesquisa e rotas protegidas', () => {
 const {h, token}=fixture(); assert.deepEqual(plain(h.c.listFiscalRecords_({token}).records.map(r=>r.recordId)),[id(1)]);
 assert.equal(h.c.listFiscalRecords_({token, filters:{search:id(2)}}).records.length,0);
 assert.throws(()=>h.c.listFiscalRecords_({token,filters:{base:'MOSSORÓ'}}),e=>e.code==='FORBIDDEN');
 for(const method of ['getOccurrenceDocument_','getDocumentPhoto_']) assert.throws(()=>h.c[method]({token,recordId:id(2),photoIndex:1,detail:true}),e=>e.code==='FORBIDDEN');
 for(const method of ['supervisorAction_','approveBatch_','requestPhotoSyncBatch_','supervisorCorrectRecord_']) assert.throws(()=>h.c[method]({token,recordId:id(1)}),e=>e.code==='AUTH_REQUIRED');
});
test('várias Bases mantêm as vinculações e retornam somente as autorizadas', () => {
 const {h}=fixture();h.grant('Fiscal B',['CAICÓ','MOSSORÓ']);h.add(3,{base:'ASSÚ'});const token=h.c.loginFiscal_({user:'Fiscal B',password:'fixture-password'}).token;
 assert.deepEqual(plain(h.c.listFiscalRecords_({token}).records.map(r=>r.base)).sort(),['CAICÓ','MOSSORÓ']);
});
test('cartão mostra identificação, operação, status, fotos e somente três ações', () => {
 const {h,token}=fixture(), record=h.c.listFiscalRecords_({token}).records[0], html=cards.fiscalCardMarkup(record);
 for(const word of ['Sub-base','Contrato','Equipe','Chefe de turma','Valor desta ocorrência','Registrado em',record.recordId,record.occurrenceNumber])assert.ok(html.includes(word),word);
 const footer=html.match(/<footer[^]*?<\/footer>/)[0];assert.equal((footer.match(/<button/g)||[]).length,3);assert.match(footer,/VISUALIZAR[^]*GERAR PDF[^]*GERAR EXCEL/);
 assert.doesNotMatch(html,/data-supervisor|data-review-record|checkbox|data-request-photo-sync|data-mine-action/);assert.match(html,/loading="lazy" decoding="async"/);
});
test('ausências explícitas e fotos de outro UUID/URL local são recusadas', () => {
 const record={recordId:id(1),photoSlots:[{recordId:id(2),photoIndex:1,confirmed:true,previewUrl:`https://drive.google.com/thumbnail?id=${imageId(1)}&sz=w320`},{recordId:id(1),photoIndex:2,confirmed:true,previewUrl:'blob:field'}]};
 assert.ok(cards.fiscalPreviewSlots(record).every(s=>!s.url));const safe=cards.fiscalReadOnlyRecord({...record,photos:['blob:field'],photoStates:[{serverUrl:'blob:other'}]});assert.ok(safe.photos.every(x=>!x));assert.match(cards.fiscalCardMarkup(record),/Foto 1 indisponível/);
});
test('HTML original do Supervisor permanece idêntico após extração dos componentes', () => {
 const {h,token}=fixture(), r={...h.c.getOccurrenceDocument_({token,recordId:id(1),detail:true}).record, photos:['https://drive.google.com/thumbnail?id='+imageId(1)+'&sz=w1600','','https://example.test/p3.jpg','',''],photoStates:[],dailyProduction:{totalSent:123,goal:6000}};
 function render(source){const elements=new Proxy({}, {get:(o,k)=>o[k] ||= {dataset:{},setAttribute(){}}});const c=vm.createContext({...core,...cards,elements, console,session:{role:'supervisor'},supervisorLoadError:null,supervisorTab:'occurrences',supervisorPendingFilter:'photos',supervisorLoading:false,supervisorDataLoaded:true,supervisorLoadState:'ready',supervisorLastLoadedAt:'',supervisorMutationRunning:false,selectedSupervisorIds:new Set(),supervisorPhotoFailures:new Map(),renderSupervisorNavigation(){},setSupervisorSummary(){},updateSupervisorSelectionUi(){},filteredSupervisorRecords:()=>[r],supervisorActiveRecords:()=>[r],supervisorFilterRange:()=>({from:'',to:''}),validDateRange:()=>true,supervisorActiveCountLabel:()=>'',photoIssueIndexes:()=>[],supervisorPricingIssues:()=>[],correctedAfterResend:()=>false,occurrenceTypesText:()=>r.occurrenceTypes.join(' · '),photoUrlsForRecord:()=>r.photos,photoFallbackUrl:url=>{const id=core.driveFileId(url);return id?`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`:'';}}); vm.runInContext(extract(source,'renderSupervisorCards')+'\n'+extract(source,'renderSupervisorList')+'\nrenderSupervisorList();',c);return elements.supervisorList.innerHTML;}
 assert.equal(render(app),render(beforeApp));
});
function controller() {
 const hosts=new Map(),events={},calls=[],opened=[],photos=[]; let revision=1,session={role:'fiscal',user:'Fiscal A',token:'fixture-a',bases:['CAICÓ']},delay=null;
 const {h,token}=fixture();let records=plain(h.c.listFiscalRecords_({token}).records),document=plain(h.c.getOccurrenceDocument_({token,recordId:id(1),detail:true}));
 const host=selector=>{if(!hosts.has(selector))hosts.set(selector,{innerHTML:'',value:'',textContent:'',hidden:true,setAttribute(){},removeAttribute(){}});return hosts.get(selector);};
 const api={listFiscalRecords:async()=>{calls.push('list');if(delay)await delay;return{records,bases:session.bases,summary:{total:records.length},nextOffset:null};},getOccurrenceDocument:async()=>{calls.push('detail');if(delay)await delay;return document;},getDocumentPhoto:async(t,recordId,photoIndex)=>{calls.push('photo');if(delay)await delay;return{recordId,photoIndex,available:true,dataUrl:'data:image/png;base64,aA=='};}};
 const c=vm.createContext({...core,...cards,api,createFiscalWorkspace:()=>({reset(){},enter(){}}),createFiscalAdmin:()=>({reset(){},enter(){}}),ApiError:class extends Error{constructor(message,code){super(message);this.code=code;}},document:{querySelector:host,querySelectorAll:()=>[],addEventListener:(type,fn)=>{events[type]=fn;}},navigator:{onLine:true},console});
 vm.runInContext(features.replace(/^import .*?;\n/gm,'').replace(/^export /gm,''),c);
 const ctl=c.createOperationalFeatures({getSession:()=>session,getRevision:()=>revision,onOpenRecord:(r,options)=>opened.push({r,options}),onOpenPhoto:(...args)=>photos.push(args),onLogout(){session=null;revision++;},onNavigate(){}});
 const button={textContent:'VISUALIZAR',dataset:{fiscalDetail:id(1)},hasAttribute:()=>false,setAttribute(){},removeAttribute(){}};
 return{ctl,host,calls,opened,photos,button,click:()=>events.click({target:{closest:()=>button}}),close:()=>events.close({target:{id:'mineDetailDialog'}}),setDelay:value=>delay=value,switchSession:()=>{session={...session,user:'Fiscal B',token:'fixture-b',bases:['MOSSORÓ']};revision++;ctl.reset();},setRecords:value=>records=value,setDocument:value=>document=value};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('liste uma vez, detalhe abre sem aguardar fotos e reabertura usa cache por UUID',async()=>{const f=controller();await f.ctl.refreshFiscal();f.click();await tick();assert.equal(f.opened[0].options.loading,true);assert.equal(f.opened[1].r.fiscalView,true);assert.deepEqual(f.calls,['list','detail']);f.click();await tick();assert.deepEqual(f.calls,['list','detail']);});
test('refresh concorrente deduplica request e dados iguais não reconstroem cartões',async()=>{const f=controller();let resolve;f.setDelay(new Promise(r=>resolve=r));const a=f.ctl.refreshFiscal(),b=f.ctl.refreshFiscal();resolve();await Promise.all([a,b]);assert.equal(f.calls.length,1);let writes=0,html=f.host('#fiscalList').innerHTML;Object.defineProperty(f.host('#fiscalList'),'innerHTML',{get:()=>html,set:value=>{writes++;html=value;}});f.setDelay(null);await f.ctl.refreshFiscal();assert.equal(writes,0);});
test('troca de sessão/Base descarta cache e resposta em voo',async()=>{const f=controller();await f.ctl.refreshFiscal();let resolve;f.setDelay(new Promise(r=>resolve=r));f.click();f.switchSession();resolve();await tick();assert.equal(f.opened.length,1);assert.equal(f.host('#mineDetailContent').innerHTML,'');assert.equal(f.host('#fiscalList').innerHTML,'');});
test('fechar detalhe durante carga não reabre o modal',async()=>{const f=controller();await f.ctl.refreshFiscal();let resolve;f.setDelay(new Promise(r=>resolve=r));f.click();f.close();resolve();await tick();assert.equal(f.opened.length,1);});
test('documento de UUID ou Base divergente é recusado e termina loading',async()=>{for(const patch of [{recordId:id(2)},{base:'MOSSORÓ'}]){const f=controller();await f.ctl.refreshFiscal();f.setDocument({record:{recordId:id(1),base:'CAICÓ',...patch}});f.click();await tick();assert.equal(f.opened.length,1);assert.match(f.host('#mineDetailContent').innerHTML,/fora da ocorrência/);assert.equal(f.button.disabled,false);}});
test('listagem adulterada de outra Base não chega ao DOM',async()=>{const f=controller();f.setRecords([{recordId:id(2),base:'MOSSORÓ'}]);await f.ctl.refreshFiscal();assert.doesNotMatch(f.host('#fiscalList').innerHTML,/data-fiscal-card/);});
test('ampliar só busca a foto solicitada e valida UUID+slot',async()=>{const f=controller();await f.ctl.refreshFiscal();await f.ctl.openFiscalPhoto(id(1),1);assert.deepEqual(f.calls,['list','photo']);assert.equal(f.photos.length,1);await f.ctl.openFiscalPhoto(id(2),1);assert.equal(f.photos.length,1);});
let passed=0;const failures=[];for(const {name,run}of tests){try{await run();passed++;}catch(e){failures.push({name,error:e.stack});}}
const result={total:tests.length,passed,failed:failures.length,failures,operationalLogins:0,productionWrites:0};console.log(JSON.stringify(result,null,2));if(process.argv[4])await writeFile(process.argv[4],JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
