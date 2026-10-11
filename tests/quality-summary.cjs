const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../wildl_page_api');
const rows=[1,2].map(n=>({episode:{season:'1',number:String(n)},player:{player:'Kodik',src:`https://kodikplayer.com/seria/${n}/hash/720p`,quality:[]}}));
rows.push({episode:{season:'1',number:'3'},player:{player:'Animelib',quality:[{quality:720,href:'/movie.mp4'}]}});
let store={wildl:{state:{title:'Test',slug:'test',kind:'anime',running:false,inspecting:false,selectedBranch:'1:2:Kodik',siteOrigin:'https://v5.animelib.org',
 branches:[{id:'1:2:Kodik'}],catalogue:{voiceAvailability:[{id:'1:2:Kodik'}],qualitySources:{'1:2:Kodik':rows}},log:[]},jobId:null,tabId:1,lastSeen:Date.now()}};
const requests=[];let onUpdated;
const chrome={storage:{session:{get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,structuredClone(data))}},
 runtime:{id:'test',sendMessage:async()=>({ok:true}),onMessage:{addListener:()=>{}}},declarativeNetRequest:{updateSessionRules:async()=>{}},
 downloads:{onChanged:{addListener:()=>{}}},tabs:{onUpdated:{addListener:fn=>onUpdated=fn},onRemoved:{addListener:()=>{}},sendMessage:async()=>({ok:true})}};
const context=vm.createContext({chrome,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,fetch:async(url,options={})=>{
 requests.push(String(url));let text;
 if(String(url).endsWith('/ftor')){const n=new URLSearchParams(options.body).get('id');const stream=[{src:'https://p14.solodcdn.com/public.mp4'}];text=JSON.stringify({links:n==='1'?{360:stream,720:stream,2160:stream,1080:[]}:{720:stream}});}
 else text=`var urlParams = '${JSON.stringify({d:'v5.animelib.org',d_sign:'public',pd:'kodikplayer.com',pd_sign:'public',ref:'https%3A%2F%2Fv5.animelib.org%2F',ref_sign:'public'})}';`;
 return {ok:true,text:async()=>text};
}});
context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context));
vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
(async()=>{
 await vm.runInContext('restored',context);await vm.runInContext('checkQuality()',context);
 const summary=vm.runInContext('state.branches[0].qualitySummary',context);
 assert.deepEqual(Array.from(summary.qualities),[360,720,2160]);assert.equal(summary.unknown,0);
 assert.deepEqual(Array.from(summary.uhdEpisodes,item=>item.number),['1']);assert.equal(requests.length,4);
 assert(requests.every(url=>/kodikplayer\.com\/(?:seria|ftor)/.test(url)),'Only player metadata, never media');
 assert.equal(vm.runInContext('state.qualityChecking',context),false);
 assert.equal(vm.runInContext('state.catalogue.voiceAvailability[0].qualitySummary.uhdEpisodes.length',context),1);
 assert.equal(store.wildlCatalogue.voiceAvailability[0].qualitySummary.uhdEpisodes.length,1);
 // A subframe load must not interrupt an active source document.
 vm.runInContext("jobId='active';tabId=1;state.running=true",context);
 onUpdated(1,{status:'loading'});await vm.runInContext('queue',context);assert(vm.runInContext('state.running',context));
 onUpdated(1,{status:'complete'});await vm.runInContext('queue',context);assert(vm.runInContext('state.running',context));
 vm.runInContext("state.running=false;state.branches[0].qualitySummary=null",context);
 context.fetch=async()=>{throw Error('HTTP 429');};await vm.runInContext('checkQuality(true)',context);
 assert.equal(vm.runInContext('state.branches[0].qualitySummary.unknown',context),2);
 assert.equal(vm.runInContext('state.branches[0].qualitySummary.uhdEpisodes.length',context),0);
 chrome.offscreen={hasDocument:async()=>true};chrome.runtime.sendMessage=async()=>({ok:true,indices:[]});chrome.tabs.sendMessage=async()=>({ok:false});
 vm.runInContext("state.running=true;state.cfg={};state.plan=[];state.total=3;state.done=0;jobId='active'",context);
 onUpdated(1,{status:'complete'});await vm.runInContext('queue',context);
 assert.equal(vm.runInContext('state.running',context),false);assert.match(vm.runInContext('state.recovery.error',context),/Связь/);
 console.log('PASS quality scan: Kodik metadata + direct qualities, exact 4K episodes, no media downloads, unknown on failure; loading/complete with live bridge does not interrupt.');
})().catch(error=>{console.error(error);process.exitCode=1;});
