// Completed chapters are acknowledged only after their bytes reach IndexedDB.
let checkpointDatabase;
function checkpointDb() {
  return checkpointDatabase ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('wildl-checkpoints',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('chapters',{keyPath:['jobId','index']});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function checkpointWrite(jobId,index,chapter) {
  if(chapter.kind==='anime'&&typeof mediaPersist==='function'){
    const files=[];for(const file of chapter.files||[])files.push({...file,data:await mediaPersist(jobId,file.data,file.name.endsWith('.mp4')?'video/mp4':'video/mp2t')});
    chapter={...chapter,files};
  }
  const db=await checkpointDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('chapters','readwrite');
    tx.objectStore('chapters').put({jobId,index,chapter});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  return chapter;
}
async function checkpointRead(jobId) {
  const db=await checkpointDb();
  const rows=await new Promise((resolve,reject)=>{
    const request=db.transaction('chapters').objectStore('chapters').getAll(IDBKeyRange.bound([jobId,0],[jobId,Number.MAX_SAFE_INTEGER]));
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  if(typeof mediaFile==='function')for(const row of rows)if(row.chapter.kind==='anime')for(const file of row.chapter.files||[])file.data=await mediaFile(file.data);
  return rows;
}
// Read old video checkpoints one row at a time instead of cloning the entire
// season's Uint8Arrays into memory. New downloads already store their Blob data.
async function checkpointReadMedia(jobId){
  const db=await checkpointDb();
  const keys=await new Promise((resolve,reject)=>{const r=db.transaction('chapters').objectStore('chapters').getAllKeys(IDBKeyRange.bound([jobId,0],[jobId,Number.MAX_SAFE_INTEGER]));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}),rows=[];
  for(const key of keys){const row=await new Promise((resolve,reject)=>{const r=db.transaction('chapters').objectStore('chapters').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(!row)continue;
    if(row.chapter?.kind==='anime'&&typeof mediaPersist==='function')try{
      const legacy=(row.chapter.files||[]).some(file=>!mediaReference(file.data));
      if(legacy)row.chapter=await checkpointWrite(jobId,row.index,row.chapter);
      for(const file of row.chapter.files||[]){const data=await mediaFile(file.data);await data.slice(0,1).arrayBuffer();if(data.size>1)await data.slice(-1).arrayBuffer();}
    }catch(error){row.chapter.mediaError=error.message;}
    rows.push(row);
  }return rows;
}
async function checkpointDelete(jobId) {
  const db=await checkpointDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('chapters','readwrite');
    tx.objectStore('chapters').delete(IDBKeyRange.bound([jobId,0],[jobId,Number.MAX_SAFE_INTEGER]));
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  if(typeof mediaDeleteJob==='function')await mediaDeleteJob(jobId);
}
