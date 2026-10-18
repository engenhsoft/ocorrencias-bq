import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';
import { resolve } from 'node:path';
// node verification/audit-baseline-20261018.paired.mjs <before-checkout> <after-checkout> <output.json>
assert.ok(process.argv[2] && process.argv[3] && process.argv[4], 'Informe checkouts anterior/atual e saída JSON.');
const beforeRoot=resolve(process.argv[2]);
const afterRoot=resolve(process.argv[3]);
const output=resolve(process.argv[4]);
const n=40,warmup=5;
const dataUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const extract=(source,name)=>{const match=source.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'));assert.ok(match,name);return match[0];};
const element=()=>({hidden:false,innerHTML:'',textContent:'',value:'',disabled:false,dataset:{},attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v;}});
async function fixture(root){
 const [appSource,coreSource,apiSource,testSource,completionSource]=await Promise.all(['app.js','core.js','api.js','tests/login-initial-load.mjs','tests/supervisor-load-completion.mjs'].map(name=>readFile(root+'/'+name,'utf8')));
 const core=await import(dataUrl(coreSource));
 const fixtureApi=apiSource.replace(/^import \{ API_ENDPOINT, MATERIAL_CATALOG_SOURCE \} from .*?;$/m,"const API_ENDPOINT='https://fixture.invalid/exec'; const MATERIAL_CATALOG_SOURCE={};").replace(/from '\.\/core\.js\?v=[^']+'/, 'from '+JSON.stringify(dataUrl(coreSource)));
 const {ApiError}=await import(dataUrl(fixtureApi));
 const loadOccurrenceDataset=vm.runInNewContext(extract(apiSource,'loadOccurrenceDataset')+'\nloadOccurrenceDataset',{ApiError,setTimeout});
 const baseAppHarness=vm.runInNewContext('('+extract(testSource,'appHarness')+')',{core,ApiError,loadOccurrenceDataset,element,appSource,extract,vm,Date,Map,Set,Promise,console,retryWaits:[]});
 const {cardMetadataMarkup,cardThumbnailsMarkup}=await import(new URL(root+'/occurrence-card.js','file:'));
 const appHarness=vm.runInNewContext('('+extract(completionSource,'harness')+')',{appHarness:baseAppHarness,cardMetadataMarkup,cardThumbnailsMarkup,appSource,extract,vm});
 return{core,appHarness};
}
const fixtures={before:await fixture(beforeRoot),after:await fixture(afterRoot)};
function record(i,core){return{recordId:`${String(i+1).padStart(8,'0')}-1111-4111-8111-111111111111`,occurrenceNumber:String(i+1),user:'Campo TESTE',team:'LM TESTE',base:'CAICÓ',crewLeader:'Chefe TESTE',contract:'4600080938',registeredAt:'2026-10-01T09:00:00-03:00',status:core.RECORD_STATUS.WAITING_SUPERVISOR,occurrenceTypes:['PODA'],services:Array.from({length:6},(_,j)=>({code:'S'+j,quantity:.75,referenceValue:2,totalValue:1.5,catalogText:'Descrição histórica',contract:'4600080938'})),materials:[{code:'000123',quantity:.5,description:'Material'}],photos:['https://example.test/1.jpg','https://example.test/2.jpg','https://example.test/3.jpg'],audit:{timeline:Array.from({length:12},()=>({action:'CRIADA',actor:'FIXTURE',at:'2026-10-01T09:00:00-03:00'}))}};}
const payloads={};for(const count of [50,2000]){const rows=Array.from({length:count},(_,i)=>record(i,fixtures.before.core));payloads[count]=JSON.stringify({records:rows,pendingRecords:[],metricRecords:rows.map(({recordId,status})=>({recordId,status}))});}
async function run(phase,count){
 const {appHarness}=fixtures[phase],h=appHarness(),c=h.c;c.supervisorMutationVersion=0;
 let requests=0,parseMs=0,normalizationMs=0,renderHtmlMs=0;
 c.api.login=async()=>({token:'fixture',user:'Campo TESTE',role:'supervisor'});
 c.api.listPending=async()=>{requests++;const start=performance.now();const value=JSON.parse(payloads[count]);parseMs+=performance.now()-start;return value;};
 const normalize=c.normalizeSupervisorRecordList;c.normalizeSupervisorRecordList=(...args)=>{const start=performance.now();const value=normalize(...args);normalizationMs+=performance.now()-start;return value;};
 const render=c.renderSupervisorList;c.renderSupervisorList=(...args)=>{const start=performance.now();render(...args);renderHtmlMs+=performance.now()-start;};
 const start=performance.now();await c.handleLogin({preventDefault(){}});await c.supervisorRefreshPromise;const firstContentMs=performance.now()-start;
 assert.equal(c.supervisorDataLoaded,true);assert.equal(requests,1);assert.equal(c.supervisorRecords.length,count);assert.doesNotMatch(h.elements.supervisorList.innerHTML,/Não foi possível exibir esta ocorrência/);assert.equal([...h.elements.supervisorList.innerHTML.matchAll(/data-review-record=/g)].length,count);
 return{firstContentMs,parseMs,normalizationMs,renderHtmlMs,requests,htmlBytes:Buffer.byteLength(h.elements.supervisorList.innerHTML)};
}
const nativeWarn=console.warn;let diagnosticWarningCount=0;console.warn=()=>{diagnosticWarningCount++;};
const samples=[];for(const count of [50,2000]){
 for(let i=0;i<warmup;i++)for(const phase of i%2?['after','before']:['before','after'])await run(phase,count);
 for(let i=0;i<n;i++){const order=i%2?['after','before']:['before','after'];for(const phase of order)samples.push({phase,count,pair:i,order:order.join(','),...await run(phase,count)});}
 console.log('completed fixture',count,'samples per phase',n);
}
const percentile=(v,p)=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*p)-1];
const metrics=['firstContentMs','parseMs','normalizationMs','renderHtmlMs'];
const summarize=rows=>Object.fromEntries(metrics.map(metric=>[metric,{median:percentile(rows.map(r=>r[metric]),.5),p95:percentile(rows.map(r=>r[metric]),.95)}]));
const comparisons=[50,2000].map(count=>({count,payloadBytes:Buffer.byteLength(payloads[count]),nPerPhase:n,warmupPerPhase:warmup,before:summarize(samples.filter(r=>r.count===count&&r.phase==='before')),after:summarize(samples.filter(r=>r.count===count&&r.phase==='after')),pairedDifferenceMs:summarize(Array.from({length:n},(_,i)=>Object.fromEntries(metrics.map(metric=>[metric,samples.find(r=>r.count===count&&r.pair===i&&r.phase==='after')[metric]-samples.find(r=>r.count===count&&r.pair===i&&r.phase==='before')[metric]]))))}));
console.warn=nativeWarn;
const result={diagnosticWarningCount,environment:'Single Node VM process; actual filters/KPIs/cards; DOM mocked; JSON transport in RAM; zero artificial network waits; CPU shared with other agents',node:process.version,beforeVersion:fixtures.before.core.APP_VERSION,afterVersion:fixtures.after.core.APP_VERSION,order:'before/after on even pairs; after/before on odd pairs',warmupPerPhase:warmup,samplesPerPhase:n,realLogin:false,productionWrites:0,productionRequests:0,comparisons,samples};await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({comparisons},null,2));
