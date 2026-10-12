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
  return rows;
}
async function videoCacheWrite(jobId,index,signature,part,data){const db=await videoCacheDb();
  await new Promise((resolve,reject)=>{const tx=db.transaction('parts','readwrite');tx.objectStore('parts').put({jobId,index,signature,part,data});
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(Object.assign(new Error('Не удалось сохранить фрагмент видео: '+(tx.error?.message||'недостаточно места в хранилище браузера')),{noFallback:true}));});
}
async function videoCacheDelete(jobId,index){const db=await videoCacheDb();
  await new Promise((resolve,reject)=>{const tx=db.transaction('parts','readwrite');
    tx.objectStore('parts').delete(index==null?IDBKeyRange.bound([jobId,0,0],[jobId,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]):IDBKeyRange.bound([jobId,index,0],[jobId,index,Number.MAX_SAFE_INTEGER]));
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});
}
