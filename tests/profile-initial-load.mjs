import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
const root=process.argv[2], output=process.argv[3];
if(!root||!output) throw Error('Informe checkout e arquivo de medições.');
const [appSource,coreSource,apiSource,testSource]=await Promise.all([
  readFile(root+'/app.js','utf8'),readFile(root+'/core.js','utf8'),readFile(root+'/api.js','utf8'),
  readFile(new URL('./login-initial-load.mjs',import.meta.url),'utf8')
]);
const dataUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const core=await import(dataUrl(coreSource));
const {ApiError}=await import(dataUrl(apiSource.replace(/^import .*?;\n/,"const API_ENDPOINT='https://script.google.com/macros/s/fixture/exec'; const MATERIAL_CATALOG_SOURCE={};\n")));
const extract=(source,name)=>{const match=source.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'));assert.ok(match,name);return match[0];};
const harness=extract(testSource,'appHarness');
const loadOccurrenceDataset=vm.runInNewContext(extract(apiSource,'loadOccurrenceDataset')+'\nloadOccurrenceDataset',{ApiError,setTimeout});
const element=()=>({hidden:false,innerHTML:'',textContent:'',value:'',disabled:false,dataset:{},attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v;}});
const retryWaits=[];
const appHarness=vm.runInNewContext('('+harness.trim()+')',{core,ApiError,loadOccurrenceDataset,element,appSource,extract,vm,Date,Map,Set,Promise,console,retryWaits});
const pause=ms=>ms?new Promise(resolve=>setTimeout(resolve,ms)):Promise.resolve();
const record=i=>({recordId:`${String(i+1).padStart(8,'0')}-1111-4111-8111-111111111111`,occurrenceNumber:String(i+1),user:'Campo TESTE',team:'LM TESTE',base:'CAICÓ',crewLeader:'Chefe TESTE',contract:'4600080938',registeredAt:'2026-10-01T09:00:00-03:00',status:core.RECORD_STATUS.WAITING_SUPERVISOR,occurrenceTypes:['PODA'],services:Array.from({length:6},(_,j)=>({code:'S'+j,quantity:.75,referenceValue:2,totalValue:1.5,catalogText:'Descrição histórica',contract:'4600080938'})),materials:[{code:'000123',quantity:.5,description:'Material'}],photos:['https://example.test/1.jpg','https://example.test/2.jpg','https://example.test/3.jpg'],audit:{timeline:Array.from({length:12},()=>({action:'CRIADA',actor:'FIXTURE',at:'2026-10-01T09:00:00-03:00'}))}});
const cases=[{name:'rápido',auth:0,backend:0,count:50},{name:'atraso controlado',auth:40,backend:120,count:50},{name:'primeira chamada fria simulada',auth:100,backend:500,count:50},{name:'resposta grande',auth:0,backend:0,count:2000},{name:'vazio válido',auth:0,backend:0,count:0},{name:'transitório',auth:0,backend:5,count:50,failFirst:true}];
// Contar avisos sem medir o custo artificial de milhares de linhas no terminal.
const nativeWarn=console.warn;let warningCount=0;console.warn=()=>{warningCount++;};
const results=[];
for(const scenario of cases){
 const serialized=JSON.stringify({records:Array.from({length:scenario.count},(_,i)=>record(i)),pendingRecords:[],metricRecords:Array.from({length:scenario.count},(_,i)=>({recordId:record(i).recordId,status:core.RECORD_STATUS.WAITING_SUPERVISOR}))});
 const samples=[];
 for(let sample=0;sample<3;sample++){
  const h=appHarness(),c=h.c,points={};let requests=0,normalizationMs=0,parseMs=0,renderMs=0;
  const mark=key=>points[key]=performance.now();
  c.api.login=async()=>{mark('T1');await pause(scenario.auth);mark('T2');return{token:'fixture',user:'Campo TESTE',role:'supervisor'};};
  const persist=c.persistSession;c.persistSession=value=>{persist(value);mark('T3');};
  let hidden=true;Object.defineProperty(h.elements.appShell,'hidden',{get:()=>hidden,set:value=>{hidden=value;if(!value)mark('T4');}});
  c.api.listPending=async()=>{requests++;if(!points.T5)mark('T5');await pause(scenario.backend);if(scenario.failFirst&&requests===1)throw new ApiError('rede simulada','NETWORK_ERROR');mark('T6');const start=performance.now();const payload=JSON.parse(serialized);parseMs+=performance.now()-start;return payload;};
  const normalize=c.normalizeOccurrenceRecords;c.normalizeOccurrenceRecords=(...args)=>{const start=performance.now();const result=normalize(...args);normalizationMs+=performance.now()-start;mark('T7');return result;};
  const render=c.renderSupervisorList;c.renderSupervisorList=(...args)=>{const start=performance.now();render(...args);renderMs+=performance.now()-start;if(c.supervisorDataLoaded&&!c.supervisorLoading)mark('T8');};
  mark('T0');await c.handleLogin({preventDefault(){}});await c.supervisorRefreshPromise;
  assert.equal(c.supervisorDataLoaded,true);assert.equal(requests,scenario.failFirst?2:1);
  const loginMs=points.T4-points.T0,afterLoginMs=points.T8-points.T4;
  samples.push({points:Object.fromEntries(Object.entries(points).map(([key,time])=>[key,+(time-points.T0).toFixed(3)])),loginMs:+loginMs.toFixed(3),authMs:+(points.T2-points.T1).toFixed(3),bootstrapMs:+(points.T4-points.T2).toFixed(3),backendWaitMs:+(points.T6-points.T5).toFixed(3),parseMs:+parseMs.toFixed(3),normalizationMs:+normalizationMs.toFixed(3),renderHtmlMs:+renderMs.toFixed(3),afterLoginMs:+afterLoginMs.toFixed(3),firstContentMs:+(points.T8-points.T0).toFixed(3),requests,htmlBytes:Buffer.byteLength(h.elements.supervisorList.innerHTML)});
 }
 const keys=['loginMs','authMs','bootstrapMs','backendWaitMs','parseMs','normalizationMs','renderHtmlMs','afterLoginMs','firstContentMs'];
 const median=Object.fromEntries(keys.map(key=>[key,samples.map(s=>s[key]).sort((a,b)=>a-b)[1]]));
 results.push({scenario:scenario.name,fixture:{authDelayMs:scenario.auth,backendDelayMs:scenario.backend,records:scenario.count,payloadBytes:Buffer.byteLength(serialized)},median,samples});
}
console.warn=nativeWarn;
const report={version:core.APP_VERSION,environment:'Node VM, código real de normalização/renderização HTML; DOM e transporte simulados; não mede pintura no Safari.',realApplicationLogin:false,warningCount,results};
await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({version:report.version,environment:report.environment,results:results.map(({scenario,fixture,median})=>({scenario,fixture,median}))},null,2));
