const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../wildl_page_api'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function harness(deferRestore=false){
 const session={},local={},messages=[],items=new Map();let receiver,changed,nextId=0,commits=0,stored=true;
 const storage=store=>({get:async key=>Array.isArray(key)?Object.fromEntries(key.map(k=>[k,store[k]])):{[key]:store[key]},set:async value=>Object.assign(store,structuredClone(value))});
 const chrome={storage:{session:storage(session),local:storage(local)},offscreen:{hasDocument:async()=>true},tabs:{sendMessage:async()=>({ok:true})},
  runtime:{getURL:file=>'chrome-extension://test/'+file,onMessage:{addListener:fn=>receiver=fn},sendMessage:async message=>{
   messages.push(structuredClone(message));if(message.type==='EXPORT')return {url:'blob:test/'+(nextId+1),filename:'Series.zip',bytes:12*1048576};
   if(message.type==='COMMIT'){commits++;stored=false;}if(message.type==='CANCEL_KEEP')return {ok:true,indices:stored?Array.from({length:12},(_,i)=>i):[]};return {ok:true};}},
  downloads:{download:async()=>{const id=++nextId;items.set(id,{id,state:'in_progress',filename:'Downloads/Series.zip',fileSize:-1});return id;},
   search:async({id})=>items.has(id)?[structuredClone(items.get(id))]:[],onChanged:{addListener:fn=>changed=fn}}};
 let releaseRestore;const originalGet=chrome.storage.session.get;
 if(deferRestore){const gate=new Promise(resolve=>releaseRestore=resolve);chrome.storage.session.get=async key=>{if(key==='wildl')await gate;return originalGet(key);};}
 const context=vm.createContext({chrome,Date,console,clearImageRequestHeaders:async()=>{},setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,5)),clearTimeout});
 for(const file of ['library.js','background.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
 const evaluate=code=>vm.runInContext(code,context),request=message=>new Promise(resolve=>receiver(message,{tab:{id:7}},resolve));
 return {session,local,messages,items,evaluate,request,releaseRestore,changed:delta=>changed(delta),get commits(){return commits;},get stored(){return stored;}};
}
async function until(condition){for(let i=0;i<200;i++){if(condition())return;await sleep(5);}throw Error('Timed out waiting for save state');}
const setup="Object.assign(state,{kind:'anime',title:'Series',format:'zip',running:true,archiveId:'archive',cfg:{format:'zip'},total:12,done:12,plan:Array.from({length:12},(_,index)=>({index,volume:'1',number:String(index+1)}))});jobId='run';tabId=7;";
(async()=>{
 const migrating=harness(true);assert.equal((await migrating.request({type:'GET_STATE'})).restoreChecking,true,'A slow restore must return live status instead of timing out the popup');migrating.releaseRestore();await migrating.evaluate('restored');assert(!(await migrating.request({type:'GET_STATE'})).restoreChecking);
 const h=harness();await h.evaluate('restored');h.evaluate(setup);
 const saving=h.request({source:'wildl-page',type:'done',jobId:'run',title:'Series',kind:'anime',format:'zip',done:12,total:12});
 await until(()=>h.items.has(1));assert.equal(h.commits,0,'Download creation must not delete the twelve episode checkpoints');
 const during=await h.request({type:'GET_STATE'});assert.equal(during.saving,true,'Popup must remain responsive during disk saving');
 assert.notEqual(during.status,'Файл сохранён.');
 await h.request({type:'INTERRUPTED',jobId:'run'});assert.equal((await h.request({type:'GET_STATE'})).saving,true,'Closing the source page must not cancel saving an already assembled archive');
 h.items.get(1).state='interrupted';h.items.get(1).error='FILE_NO_SPACE';await saving;
 const failed=await h.request({type:'GET_STATE'});assert.equal(h.commits,0);assert(h.stored);assert.equal(failed.recovery.done,12);assert.equal(failed.recovery.partial,false);
 assert.match(failed.log.join('\n'),/FILE_NO_SPACE/);assert.equal(h.local.wildlHistory[0].error,'FILE_NO_SPACE');
 const retry=h.request({type:'SAVE_PARTIAL',format:'zip'});await until(()=>h.items.has(2));assert.equal(h.commits,0);
 const exported=h.messages.filter(message=>message.type==='EXPORT').at(-1);assert.equal(exported.data.partial,false,'A full archive retry must not be labelled partial');
 h.items.get(2).state='complete';h.items.get(2).fileSize=12*1048576;await retry;
 assert.equal(h.commits,1);assert.equal(h.stored,false);assert.equal((await h.request({type:'GET_STATE'})).recovery,null);
 assert.equal(h.local.wildlHistory[0].status,'complete');assert.equal(h.messages.filter(message=>message.type==='RELEASE').length,2);
 assert.deepEqual(h.session.wildlDownloads,{});
 // If the service worker restarts while the browser is writing, onChanged completes recovery.
 for(const outcome of ['complete','interrupted']){
  const r=harness();await r.evaluate('restored');r.evaluate(setup+"state.saving=true;");
  r.session.wildlDownloads={9:{url:'blob:old',jobId:'archive',awaitCompletion:true,keepCheckpoint:false,summary:{kind:'anime',done:12,total:12}}};
  r.items.set(9,{id:9,state:outcome,error:outcome==='interrupted'?'FILE_ACCESS_DENIED':undefined,filename:'Series.zip',fileSize:12*1048576});
  r.changed({id:9,state:{current:outcome}});await r.evaluate('queue');
  const final=await r.request({type:'GET_STATE'});assert.equal(final.saving,false);
  assert.equal(r.commits,outcome==='complete'?1:0);assert.equal(!!final.recovery,outcome==='interrupted');
 }
 console.log('PASS archive saving: no premature success/checkpoint deletion, responsive popup, exact browser error, twelve-series retry without refetch, cleanup only after complete, worker restart completion/interruption.');
})().catch(error=>{console.error(error);process.exitCode=1;});
