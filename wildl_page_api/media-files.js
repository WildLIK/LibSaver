// Video bytes live in OPFS files. IndexedDB contains only small file descriptors.
// File snapshots are opened afresh; large composite Blobs never enter IndexedDB.
let mediaRootPromise;
const mediaReferences=new WeakMap();
function mediaReference(value){return !!value&&value.wildlFile===1&&typeof value.job==='string'&&/^[a-f0-9-]+\.bin$/.test(value.name)&&Number.isSafeInteger(value.size)&&value.size>=0;}
async function mediaDirectory(job,create=false){
  if(!navigator.storage?.getDirectory)throw new Error('Браузер не поддерживает файловое хранилище видео. Обновите браузер.');
  mediaRootPromise ||= navigator.storage.getDirectory().then(root=>root.getDirectoryHandle('wildl-media-v1',{create:true}));
  return (await mediaRootPromise).getDirectoryHandle(encodeURIComponent(String(job)),{create});
}
async function mediaFile(value){
  if(!mediaReference(value))return value;
  try{
    const directory=await mediaDirectory(value.job),handle=await directory.getFileHandle(value.name),file=await handle.getFile();
    if(file.size!==value.size)throw new Error('Размер файла изменился.');
    mediaReferences.set(file,value);return file;
  }catch(error){throw Object.assign(new Error('Файл серии недоступен в хранилище браузера. Нажмите «Продолжить загрузку» для восстановления только недостающих серий. '+error.message),{mediaCorrupt:true});}
}
async function mediaOutput(job,type='application/octet-stream'){
  const directory=await mediaDirectory(job,true),name=crypto.randomUUID()+'.bin',handle=await directory.getFileHandle(name,{create:true}),writer=await handle.createWritable();
  let closed=false;
  return {
    write:data=>writer.write(data),seek:offset=>writer.seek(offset),
    async finish(){await writer.close();closed=true;const file=await handle.getFile(),reference={wildlFile:1,job:String(job),name,size:file.size,type};mediaReferences.set(file,reference);return file;},
    async abort(){if(!closed)await writer.abort().catch(()=>{});await directory.removeEntry(name).catch(()=>{});}
  };
}
async function mediaPersist(job,data,type='application/octet-stream'){
  if(mediaReference(data)){await mediaFile(data);return data;}
  const known=data&&typeof data==='object'?mediaReferences.get(data):null;if(known)return known;
  const output=await mediaOutput(job,type);
  try{
    const size=data?.size??data?.byteLength??0;
    for(let start=0;start<size;start+=4*1048576){
      const end=Math.min(size,start+4*1048576),bytes=data instanceof Blob?new Uint8Array(await data.slice(start,end).arrayBuffer()):
        data instanceof ArrayBuffer?new Uint8Array(data,start,end-start):data.subarray(start,end);
      await output.write(bytes);
    }
    const file=await output.finish();return mediaReferences.get(file);
  }catch(error){await output.abort();throw error;}
}
async function mediaConcat(job,chunks,type){
  const output=await mediaOutput(job,type);
  try{for(const chunk of chunks){const data=await mediaFile(chunk),size=data.size??data.byteLength;
    for(let start=0;start<size;start+=4*1048576)await output.write(data instanceof Blob?new Uint8Array(await data.slice(start,start+4*1048576).arrayBuffer()):data.subarray(start,start+4*1048576));}
    return await output.finish();
  }catch(error){await output.abort();throw error;}
}
async function mediaDeleteFile(reference){if(mediaReference(reference))try{await (await mediaDirectory(reference.job)).removeEntry(reference.name);}catch(error){if(error.name!=='NotFoundError')throw error;}}
async function mediaDeleteJob(job){try{await (await mediaRootPromise||await navigator.storage.getDirectory().then(root=>root.getDirectoryHandle('wildl-media-v1'))).removeEntry(encodeURIComponent(String(job)),{recursive:true});}catch(error){if(error.name!=='NotFoundError')throw error;}}
