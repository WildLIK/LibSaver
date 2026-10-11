const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../wildl_page_api/content.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const events=new Map(),controls=new Set(),posts=[],calls=[];
  const window={addEventListener:(type,fn)=>{if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},
    removeEventListener:(type,fn)=>events.get(type)?.delete(fn),postMessage:data=>posts.push(data)};
  const runtime={id:'extension',onMessage:{addListener:fn=>controls.add(fn),removeListener:fn=>controls.delete(fn)},sendMessage:msg=>{calls.push(msg);return Promise.resolve({ok:true});}};
  const context=vm.createContext({window,chrome:{runtime},location:{origin:'https://v5.animelib.org'}});
  const emit=(type,data)=>{for(const fn of [...events.get(type)||[]])fn({source:window,data});};
  const prepare=id=>{for(const fn of controls)fn({type:'WILDL_PREPARE',jobId:id},{},()=>{});};
  const run=()=>vm.runInContext(source,context);run();
  return {events,controls,posts,calls,runtime,emit,prepare,run};
}
(async()=>{
  for(const event of ['message','pagehide']){
    const h=harness();h.prepare('old');
    h.runtime.sendMessage=()=>{throw Error('Extension context invalidated.');};
    h.emit(event,{source:'wildl-page',jobId:'old',type:'chapter',index:3});await tick();
    assert.equal(h.controls.size,0);assert.equal(h.events.get('message').size,0);assert.equal(h.events.get('pagehide').size,0);
    assert(h.posts.some(m=>m.type==='stop'&&m.jobId==='old'));
    if(event==='message')assert(h.posts.some(m=>m.type==='chapter-ack'&&!m.ok));
  }
  const h=harness();h.prepare('old');h.runtime.id=undefined;
  h.emit('message',{source:'wildl-page',jobId:'old',type:'heartbeat'});await tick();assert.equal(h.calls.length,0);
  h.runtime.id='extension';h.run();h.prepare('new');
  h.emit('message',{source:'wildl-page',jobId:'old',type:'chapter'});await tick();assert.equal(h.calls.length,0);
  h.emit('message',{source:'wildl-page',jobId:'new',type:'chapter',index:0});await tick();
  assert(h.posts.some(m=>m.type==='chapter-ack'&&m.ok&&m.jobId==='new'));
  h.run();assert.equal(h.controls.size,1);assert.equal(h.events.get('message').size,1);
  h.prepare('preview');h.emit('message',{source:'wildl-page',jobId:'preview',type:'preview'});await tick();
  const count=h.calls.length;h.emit('pagehide');h.emit('message',{source:'wildl-page',jobId:'preview',type:'heartbeat'});await tick();assert.equal(h.calls.length,count);
  console.log('PASS bridge lifecycle: synchronous invalidation during chapter/pagehide, missing runtime.id, orphan stop, failed ack, reinjection and finished-job silence.');
})().catch(error=>{console.error(error);process.exitCode=1;});
