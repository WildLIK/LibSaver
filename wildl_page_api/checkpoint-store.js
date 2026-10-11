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
  const db=await checkpointDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('chapters','readwrite');
    tx.objectStore('chapters').put({jobId,index,chapter});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function checkpointRead(jobId) {
  const db=await checkpointDb();
  return new Promise((resolve,reject)=>{
    const request=db.transaction('chapters').objectStore('chapters').getAll(IDBKeyRange.bound([jobId,0],[jobId,Number.MAX_SAFE_INTEGER]));
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function checkpointDelete(jobId) {
  const db=await checkpointDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('chapters','readwrite');
    tx.objectStore('chapters').delete(IDBKeyRange.bound([jobId,0],[jobId,Number.MAX_SAFE_INTEGER]));
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
