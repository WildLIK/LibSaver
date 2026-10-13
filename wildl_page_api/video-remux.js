async function videoRemuxTs(chunks,message,job){
 if(typeof Worker==='undefined')throw videoLocalError('В браузере недоступна сборка MP4. Выберите «Исходный контейнер».');
 const url=typeof chrome!=='undefined'&&chrome.runtime?.getURL?chrome.runtime.getURL('video-remux-worker.js'):new URL('video-remux-worker.js',location.href).href;
 const output=typeof mediaOutput==='function'?await mediaOutput(message.jobId||'remux-'+crypto.randomUUID(),'video/mp4'):null;
 const worker=new Worker(url),controller=new AbortController(),data=[];let pending,serial=0,writes=Promise.resolve(),finished=false;
 job.controllers.add(controller);
 const reject=error=>{if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}};
 worker.onmessage=event=>{const response=event.data;
  if(response.type==='data'||response.type==='init'){
   if(output){writes=writes.then(()=>output.write(response.bytes));writes.catch(()=>{});}else if(response.type==='data')data.push(new Blob([response.bytes]));return;
  }
  if(!pending||response.id!==pending.id)return;
  const waiter=pending;pending=null;clearTimeout(waiter.timer);
  if(response.type==='error')waiter.reject(new Error(response.error));else writes.then(()=>waiter.resolve(response),waiter.reject);
 };
 worker.onerror=event=>{event.preventDefault();reject(new Error('Не удалось собрать MP4: '+event.message));};
 controller.signal.addEventListener('abort',()=>{worker.terminate();reject(new Error('Остановлено'));});
 const send=type=>new Promise((resolve,reject)=>{const id=++serial;pending={id,resolve,reject,timer:setTimeout(()=>{worker.terminate();reject(new Error('Сборка MP4 не отвечает. Можно повторить.'));pending=null;},60000)};worker.postMessage({id,...type});});
 try{
  videoLog(message,'перепаковываю TS → MP4 без перекодирования.');await send({type:'start'});
  for(let i=0;i<chunks.length;i++){
   await imageCheckpoint(job);videoReport(message,job,`Серия ${message.chapter.number} · Собираю MP4: ${i+1}/${chunks.length}`);
   await send({type:'part',blob:chunks[i] instanceof Blob?chunks[i]:new Blob([chunks[i]])});
  }
  await imageCheckpoint(job);const result=await send({type:'finish'});
  videoLog(message,`MP4 собран; длительность ${Math.ceil(result.duration)} сек.; ${result.tracks.map(track=>track.type==='video'?'видео H.264':track.type==='audio'?'аудио AAC':track.type).join(', ')}.`);
  if(output){await output.seek(0);await output.write(result.init);const file=await output.finish();finished=true;return file;}
  return new Blob([result.init,...data],{type:'video/mp4'});
 }catch(error){error.noFallback=true;throw error;}finally{if(pending)clearTimeout(pending.timer);worker.terminate();if(output&&!finished)await output.abort();job.controllers.delete(controller);}
}
