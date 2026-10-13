// Partial media data has a separate store so complete-chapter checkpoints stay compatible.
let videoCacheDatabase;
function videoCacheDb(){return videoCacheDatabase ||=new Promise((resolve,reject)=>{
  const request=indexedDB.open('wildl-video-parts',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('parts',{keyPath:['jobId','index','part']});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function videoCacheRead(jobId,index,signature){const db=await videoCacheDb();
  const rows=await new Promise((resolve,reject)=>{const request=db.transaction('parts').objectStore('parts').getAll(IDBKeyRange.bound([jobId,index,0],[jobId,index,Number.MAX_SAFE_INTEGER]));
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  if(rows.some(row=>row.signature!==signature)){await videoCacheDelete(jobId,index);return [];}
  const usable=[];
  for(const row of rows)try{if(typeof mediaFile==='function'){row.data=await mediaFile(row.data);await row.data.slice(0,1).arrayBuffer();}usable.push(row);}
  catch{await new Promise((resolve,reject)=>{const tx=db.transaction('parts','readwrite');tx.objectStore('parts').delete([jobId,index,row.part]);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  return usable;
}
async function videoCacheWrite(jobId,index,signature,part,data){const db=await videoCacheDb();
  if(typeof mediaPersist==='function')data=await mediaPersist('parts-'+jobId,data,'application/octet-stream');
  await new Promise((resolve,reject)=>{const tx=db.transaction('parts','readwrite');tx.objectStore('parts').put({jobId,index,signature,part,data});
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(Object.assign(new Error('Не удалось сохранить фрагмент видео: '+(tx.error?.message||'недостаточно места в хранилище браузера')),{noFallback:true}));});
}
async function videoCacheDelete(jobId,index){const db=await videoCacheDb();
  const files=typeof mediaDeleteFile==='function'?await new Promise((resolve,reject)=>{const r=db.transaction('parts').objectStore('parts').getAll(index==null?IDBKeyRange.bound([jobId,0,0],[jobId,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]):IDBKeyRange.bound([jobId,index,0],[jobId,index,Number.MAX_SAFE_INTEGER]));r.onsuccess=()=>resolve(r.result.map(row=>row.data));r.onerror=()=>reject(r.error);}):[];
  await new Promise((resolve,reject)=>{const tx=db.transaction('parts','readwrite');
    tx.objectStore('parts').delete(index==null?IDBKeyRange.bound([jobId,0,0],[jobId,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]):IDBKeyRange.bound([jobId,index,0],[jobId,index,Number.MAX_SAFE_INTEGER]));
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});
  if(typeof mediaDeleteFile==='function')for(const file of files)await mediaDeleteFile(file);
}
