const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const store={};const chrome={storage:{local:{get:async key=>Array.isArray(key)?Object.fromEntries(key.map(name=>[name,store[name]])):{[key]:store[key]},set:async data=>Object.assign(store,structuredClone(data))}},runtime:{sendMessage:async()=>{}}};
const context=vm.createContext({chrome,Date});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../wildl_page_api/library.js'),'utf8'),context);
(async()=>{
 assert.equal((await vm.runInContext('getLibrary()',context)).settings.ask,false);
 assert.equal((await vm.runInContext('getLibrary()',context)).settings.folder,'LibSaver');
 for(const folder of ['../x','C:\\x','/root','folder/../x','bad?name'])assert.throws(()=>vm.runInContext('normalizeSaveSettings('+JSON.stringify({folder})+')',context));
 await vm.runInContext("saveLibrarySettings({folder:'LibSaver/Anime',ask:true})",context);assert.equal(store.wildlSaveSettings.folder,'LibSaver/Anime');
 await Promise.all(Array.from({length:105},(_,id)=>vm.runInContext('addHistory('+JSON.stringify({id,title:'Тайтл '+id,bytes:100})+')',context)));
 assert.equal(store.wildlHistory.length,100);assert.equal(new Set(store.wildlHistory.map(item=>item.id)).size,100);
 await vm.runInContext("finishHistory(104,'complete',{bytes:1000,filename:'saved.mobi'})",context);assert.equal(store.wildlHistory[0].status,'complete');assert.equal(store.wildlHistory[0].bytes,1000);
 await vm.runInContext("finishHistory(103,'interrupted')",context);assert.equal(store.wildlHistory[1].status,'interrupted');
 const restarted=vm.createContext({chrome,Date});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../wildl_page_api/library.js'),'utf8'),restarted);
 assert.equal((await vm.runInContext('getLibrary()',restarted)).history[0].filename,'saved.mobi');
 await vm.runInContext('changeHistory(()=>[])',restarted);assert.equal(store.wildlHistory.length,0);
 console.log('PASS saved-folder validation, concurrent history updates, completed/interrupted file records, persistence and clear-history.');
})().catch(error=>{console.error(error);process.exitCode=1;});
