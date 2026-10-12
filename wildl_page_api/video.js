const VIDEO_DOMAINS=['kodikplayer.com','kodik.info','kodikvideo.com','kodik-cdn.com','kodikcdn.com','solodcdn.com','cdnlibs.org','imglib.info'];
function videoUrl(value,base) {
  const url=new URL(value,base);
  if(url.protocol!=='https:' || !VIDEO_DOMAINS.some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))
    throw new Error('Не поддерживается сервер видео: '+url.hostname);
  return url.href;
}
const VIDEO_PART_SIZE=8*1024*1024;
function videoQuality(value) {return value==null||value==='max'?Infinity:videoResolution(value)||Infinity;}
function videoLocalError(message){return Object.assign(new Error(message),{noFallback:true});}
function videoSize(data){return data?.size??data?.length??0;}
function videoEtaStart(job,mode,total=0,initial=0){
  job.videoEta={mode,total,initial,done:initial,initialReceived:job.videoReceived||0,started:Date.now(),excluded:0,held:null};
}
function videoEtaHold(job){if(job.videoEta&&job.videoEta.held===null)job.videoEta.held=Date.now();}
function videoEtaRelease(job){const eta=job.videoEta;if(eta&&eta.held!==null){eta.excluded+=Date.now()-eta.held;eta.held=null;}}
function videoEtaSnapshot(job){
  const eta=job.videoEta,at=Date.now(),series=String(job.videoMessage?.chapter.number||'');
  if(!eta)return null;
  const progress=eta.total>0?Math.max(0,Math.min(1,eta.done/eta.total)):null;
  const elapsed=Math.max(0,((eta.held??at)-eta.started-eta.excluded)/1000),fresh=eta.done-eta.initial;
  const received=eta.mode==='bytes'?fresh:Math.max(0,(job.videoReceived||0)-eta.initialReceived);
  const transfer={progress,totalBytes:eta.mode==='bytes'&&eta.total>0?eta.total:null,
    speedBps:elapsed>=2&&received>0?received/elapsed:null};
  if(eta.held!==null)return {series,at,phase:'waiting',seconds:null,...transfer};
  if(eta.total>0&&eta.done>=eta.total)return {series,at,phase:'finishing',seconds:null,...transfer};
  const threshold=eta.mode==='bytes'?Math.min(65536,(eta.total-eta.initial)*.1):Math.min(1,(eta.total-eta.initial)*.1);
  const seconds=eta.total>0&&elapsed>=2&&fresh>0&&fresh>=threshold?Math.ceil((eta.total-eta.done)*elapsed/fresh):null;
  return {series,at,phase:seconds===null?'calculating':'estimate',seconds,...transfer};
}
function videoReport(message,job,status){imageProgress(message,status,videoEtaSnapshot(job));}
function videoLog(message,text){
  try{if(typeof chrome!=='undefined'&&chrome.runtime?.sendMessage)Promise.resolve(chrome.runtime.sendMessage({type:'VIDEO_LOG',jobId:message.runId||message.jobId,
    text:`Серия ${message.chapter.number}: ${text}`})).catch(()=>{});}catch{}
}
function videoFinished(message,job,file){
  const seconds=Math.max(.001,(Date.now()-job.videoStartedAt)/1000),size=videoSize(file.data)/1048576,speed=(job.videoReceived||0)/1048576/seconds;
  videoLog(message,`файл ${size.toFixed(1)} МиБ; из сети ${((job.videoReceived||0)/1048576).toFixed(1)} МиБ за ${Math.ceil(seconds)} сек.; средняя скорость ${speed.toFixed(2)} МиБ/с. Готовлю сохранение.`);
  return file;
}
async function videoCooldown(job) {
  if(job.paused||job.videoCooldownUntil>Date.now())videoEtaHold(job);
  while(job.videoCooldownUntil>Date.now()) {
    if(!job.videoCooldownWait){const until=job.videoCooldownUntil;
      job.videoCooldownWait=imageSleep(job,until-Date.now()).then(()=>{if(job.videoCooldownUntil===until)job.videoCooldownUntil=0;}).finally(()=>{job.videoCooldownWait=null;});}
    await job.videoCooldownWait;
  }
  await imageCheckpoint(job);
  videoEtaRelease(job);
  if(job.videoFailed)throw job.videoFailed;
}
async function videoFetch(job,url,options={}) {
  url=videoUrl(url);
  const {text:wantText=false,range,probe=false,maxBytes=0,onBytes,...requestOptions}=options;
  for(let attempt=0;attempt<3;attempt++){
    await videoCooldown(job);
    onBytes?.(0,0);
    const controller=new AbortController();job.controllers.add(controller);
    let timer=setTimeout(()=>controller.abort(),45000);
    try {
      const response=await fetch(url,{...requestOptions,credentials:'omit',signal:controller.signal});
      if(response.url)videoUrl(response.url);
      if([429,503].includes(response.status)){clearTimeout(timer);await response.body?.cancel();
        const retry=response.headers.get('Retry-After');const seconds=Number(retry)||Math.max(0,(Date.parse(retry)-Date.now())/1000)||(response.status===429?(Number(job.videoMessage?.chapter.limitPause)||180):2);
        if(response.status===503&&attempt===2)throw new Error('Сервер видео временно недоступен: HTTP 503. Можно продолжить.');
        job.videoWorkers=Math.max(1,Math.floor((job.videoWorkers||4)/2));job.videoSafeWorkers=job.videoWorkers;
        videoEtaHold(job);
        job.videoCooldownUntil=Math.max(job.videoCooldownUntil||0,Date.now()+Math.max(1,seconds)*1000);
        if(job.videoMessage)videoReport(job.videoMessage,job,`Лимит видео. Общий перерыв ${Math.ceil(seconds)} сек.; потоков: ${job.videoWorkers}.`);
        if(job.videoMessage)videoLog(job.videoMessage,`HTTP ${response.status}; общий перерыв ${Math.ceil(seconds)} сек.; потоков теперь ${job.videoWorkers}.`);
        await videoCooldown(job);if(response.status===429)attempt--;continue;}
      // A server ignoring Range must never cause four full-file downloads.
      if(probe&&[200,400,401,403,405,416,501].includes(response.status)){await response.body?.cancel();return {rangeUnsupported:true};}
      if(!response.ok){const error=new Error('Видео: HTTP '+response.status+' ('+new URL(url).hostname+')');error.permanent=[401,403,404,410].includes(response.status);throw error;}
      const header=name=>response.headers?.get(name)||'';
      if(range){const expected=`bytes ${range.start}-${range.end}/${range.total??'[0-9]+'}`;
        if(response.status!==206||!(new RegExp('^'+expected+'$')).test(header('Content-Range'))||header('Content-Encoding')&&!/^identity$/i.test(header('Content-Encoding'))){
          await response.body?.cancel();const error=new Error('Сервер изменил ответ на диапазон видео. Повторите загрузку.');error.permanent=true;error.rangeFallback=response.status===200;throw error;}
        if(range.validator&&header(range.validatorHeader)!==range.validator){await response.body?.cancel();const error=new Error('Версия видео на сервере изменилась. Повторите загрузку.');error.permanent=true;throw error;}
      }
      const media=!probe&&!wantText&&/video|octet-stream/.test(header('Content-Type'));
      const contentLength=Number(header('Content-Length'))||0;
      if(media&&!range&&!onBytes){videoEtaStart(job,'bytes',contentLength);
        if(job.videoMessage)videoLog(job.videoMessage,`обычная загрузка видео: ${contentLength?(contentLength/1048576).toFixed(1)+' МиБ':'сервер не сообщил размер'}, один запрос.`);}
      const reportBytes=(length)=>{
        onBytes?.(length,contentLength);
        if(media&&!range&&!onBytes&&job.videoEta)job.videoEta.done=length;
      };
      let bytes;
      if(response.body?.getReader) {
        const reader=response.body.getReader(),chunks=[];let length=0,lastUpdate=0;
        try {
          while(true) {
            clearTimeout(timer);await videoCooldown(job);timer=setTimeout(()=>controller.abort(),45000);
            const {value,done}=await reader.read();if(done)break;
            length+=value.length;if(length>(maxBytes||0xf0000000))throw videoLocalError('Видео превышает допустимый размер.');
            chunks.push(value);job.videoReceived=(job.videoReceived||0)+value.length;reportBytes(length);
            if(!onBytes&&job.videoMessage&&Date.now()-lastUpdate>500&&/video|octet-stream/.test(header('Content-Type'))){
              lastUpdate=Date.now();videoReport(job.videoMessage,job,`Серия ${job.videoMessage.chapter.number} · Видео: ${(length/1048576).toFixed(1)} МБ`);
            }
          }
        }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
        bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      }else{bytes=new Uint8Array(await response.arrayBuffer());job.videoReceived=(job.videoReceived||0)+bytes.length;reportBytes(bytes.length);}
      if(bytes.length>(maxBytes||0xf0000000))throw videoLocalError('Видео превышает допустимый размер.');
      if(range&&bytes.length!==range.end-range.start+1){const error=new Error('Неполный диапазон видео.');throw error;}
      await videoCooldown(job);
      const isText=wantText||/json|text\/html|mpegurl/i.test(header('Content-Type'))||/\.m3u8(?:\?|$)/i.test(url)||bytes[0]===35&&bytes[1]===69;
      return {bytes,url:response.url||url,...(isText?{text:new TextDecoder().decode(bytes)}:{}),
        contentRange:header('Content-Range'),etag:header('ETag'),modified:header('Last-Modified')};
    } catch(error){controller.abort();if(job.stopped)throw new Error('Остановлено');if(job.videoFailed)throw job.videoFailed;if(error.permanent||error.noFallback||attempt===2)throw error;
      if(job.videoMessage)videoReport(job.videoMessage,job,`Серия ${job.videoMessage.chapter.number} · Повтор ${attempt+2}/3: ${error.message||error}`);
      onBytes?.(0,0);if(job.videoMessage)videoLog(job.videoMessage,`повтор запроса ${attempt+2}/3: ${error.message||error}`);
      await imageSleep(job,800*2**attempt);}
    finally{clearTimeout(timer);job.controllers.delete(controller);}
  }
}
function decodeKodikUrl(src) {
  if(!src.includes('//'))src=atob(src.replace(/[a-zA-Z]/g,char=>{
    const max=char<='Z'?90:122,code=char.charCodeAt(0)+18;return String.fromCharCode(code<=max?code:code-26);
  }));
  return videoUrl(src.startsWith('//')?'https:'+src:src);
}
async function resolveVideo(message,job) {
  const player=message.chapter.videoPlayer,quality=videoQuality(message.chapter.quality);
  if(!player)throw new Error('Для серии нет доступного плеера выбранной озвучки.');
  if(player.video?.quality?.length){
    const choices=[...player.video.quality].sort((a,b)=>videoResolution(b.quality)-videoResolution(a.quality));
    const choice=choices.find(item=>videoResolution(item.quality)<=quality)||choices.at(-1);
    const src=choice.src||choice.url;
    if(src){videoLog(message,`плеер ${player.player}, качество ${videoResolution(choice.quality)}p, сервер ${new URL(videoUrl(src)).hostname}.`);videoReport(message,job,'Серия '+message.chapter.number+' · '+player.player+' · '+videoResolution(choice.quality)+'p');return videoUrl(src);}
  }
  if(/\.(mp4|m3u8)(?:\?|$)/i.test(player.src||'')){const url=videoUrl(player.src,'https://v5.animelib.org');videoLog(message,`плеер ${player.player}, прямая ссылка, сервер ${new URL(url).hostname}.`);return url;}
  if(player.player!=='Kodik')throw new Error('Плеер '+player.player+' пока не поддерживается для скачивания.');
  const data=await kodikStreams(player,async(url,options)=>(await videoFetch(job,url,{...options,text:true})).text);
  const qualities=Object.keys(data.links||{}).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);
  const selected=qualities.find(item=>item<=quality)||qualities.at(-1);
  const src=data.links?.[selected]?.[0]?.src||data.link;
  if(!src)throw new Error('Kodik не вернул поток видео.');
  videoLog(message,`плеер Kodik, качество ${selected?selected+'p':'не указано'}.`);
  videoReport(message,job,'Серия '+message.chapter.number+' · '+(selected?selected+'p':'Качество не указано'));
  return decodeKodikUrl(src);
}
async function kodikStreams(player,fetchText) {
  const url=videoUrl(player.src,'https://v5.animelib.org');
  const html=await fetchText(url);
  const params=html.match(/var\s+urlParams\s*=\s*'([^']+)'/);
  const path=new URL(url).pathname.match(/\/(seria|video|episode)\/(\d+)\/([^/]+)/);
  if(!params||!path)throw new Error('Kodik не выдал сведения о видео. Проверьте воспроизведение серии на сайте.');
  const raw=JSON.parse(params[1]),body=new URLSearchParams();
  for(const key of ['d','d_sign','pd','pd_sign','ref','ref_sign'])if(raw[key]!=null)body.set(key,key==='ref'?decodeURIComponent(raw[key]):raw[key]);
  body.set('type',path[1]);body.set('id',path[2]);body.set('hash',path[3]);
  const text=await fetchText(new URL('/ftor',url).href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  try{return JSON.parse(text);}catch{throw new Error('Kodik не разрешил получить сведения о качестве.');}
}
function videoResolution(value) {
  if(/^(?:4k|uhd)$/i.test(String(value)))return 2160;
  return Number(String(value).replace(/p$/i,''))||0;
}
function parseHls(text,base,quality=Infinity) {
  if(typeof text!=='string'||!text.trimStart().startsWith('#EXTM3U'))throw new Error('Сервер не вернул HLS-плейлист.');
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(lines.some(line=>line.startsWith('#EXT-X-KEY:')&&!/METHOD=NONE(?:,|$)/.test(line)) || text.includes('#EXT-X-SESSION-KEY:'))
    throw new Error('Серия использует зашифрованный поток. Этот формат не поддерживается.');
  if(lines.some(line=>/^#EXT-X-(?:BYTERANGE|DISCONTINUITY)/.test(line)))throw new Error('Этот вариант HLS пока не поддерживается.');
  const variants=[];
  for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){
    if(/AUDIO=/.test(lines[i]))throw new Error('HLS с отдельной звуковой дорожкой пока не поддерживается.');
    const resolution=Number(lines[i].match(/RESOLUTION=\d+x(\d+)/)?.[1])||0;
    variants.push({url:videoUrl(lines[i+1],base),resolution});
  }
  if(variants.length){variants.sort((a,b)=>b.resolution-a.resolution);return {variant:(variants.find(v=>v.resolution<=quality)||variants.at(-1)).url};}
  if(!lines.includes('#EXT-X-ENDLIST'))throw new Error('Поток ещё не завершён. Скачивание прямых трансляций не поддерживается.');
  const map=lines.find(line=>line.startsWith('#EXT-X-MAP:'));
  const init=map?.match(/URI="([^"]+)"/)?.[1];
  const segments=lines.filter(line=>!line.startsWith('#')).map(line=>videoUrl(line,base));
  if(!segments.length)throw new Error('В HLS нет сегментов серии.');
  return {segments,init:init?videoUrl(init,base):null,extension:init?'mp4':'ts'};
}
async function videoParts(message,job,signature,urls,extension,rangeMeta=null) {
  const key=message.jobId||'volatile',index=message.index??0;
  const cache=typeof videoCacheRead==='function'?await videoCacheRead(key,index,signature):[];
  const chunks=new Array(urls.length);let bytes=0,done=0,next=0;
  for(const part of cache)if(part.part<urls.length){chunks[part.part]=part.data;bytes+=videoSize(part.data);done++;}
  job.videoWorkers=Math.max(1,Math.min(6,Number(message.chapter.videoConcurrency)||4,job.videoSafeWorkers??6));job.videoFailed=null;
  videoEtaStart(job,rangeMeta?'bytes':'parts',rangeMeta?rangeMeta.total:urls.length,rangeMeta?bytes:done);
  const inFlight=new Map(),inFlightBytes=new Map();let lastProgress=0;
  const updateEta=()=>{job.videoEta.done=(rangeMeta?bytes:done)+[...inFlight.values()].reduce((sum,value)=>sum+value,0);};
  videoLog(message,`${rangeMeta?'MP4 по частям':'HLS'}: ${urls.length} фрагментов, до ${job.videoWorkers} одновременно${rangeMeta?', размер '+(rangeMeta.total/1048576).toFixed(1)+' МиБ':''}. Сохранённых: ${done}.`);
  const progress=()=>{lastProgress=Date.now();videoReport(message,job,`Серия ${message.chapter.number} · Фрагментов ${done}/${urls.length} · ${((bytes+[...inFlightBytes.values()].reduce((sum,value)=>sum+value,0))/1048576).toFixed(1)} МБ`);};
  progress();
  async function worker(workerId){while(next<urls.length){
    await videoCooldown(job);if(workerId>=job.videoWorkers||next>=urls.length)return;
    const part=next++;if(chunks[part])continue;
    try{
      const onBytes=(length,total)=>{inFlight.set(part,rangeMeta?length:total>0?Math.min(.99,length/total):0);inFlightBytes.set(part,length);updateEta();if(Date.now()-lastProgress>500)progress();};
      const entry=urls[part];const data=(await videoFetch(job,rangeMeta?rangeMeta.url:entry,rangeMeta?{
        headers:{Range:`bytes=${entry.start}-${entry.end}`,'If-Range':rangeMeta.validator},
        range:{...entry,total:rangeMeta.total,validator:rangeMeta.validator,validatorHeader:rangeMeta.validatorHeader},maxBytes:entry.end-entry.start+1,onBytes
      }:{onBytes})).bytes;
      if(extension==='ts'&&(data[0]!==0x47||data.length%188!==0))throw new Error('Сервер вернул неверный фрагмент видео.');
      if(!data.length)throw new Error('Сервер вернул пустой фрагмент видео.');
      if(message.chapter.outputFormat!=='files'&&bytes+data.length+job.bytes>0xf0000000)throw videoLocalError('Видео или архив превышает 4 ГБ. Уменьшите диапазон или качество.');
      // Reserve bytes before the asynchronous disk write: parallel workers share this budget.
      bytes+=data.length;inFlight.delete(part);inFlightBytes.delete(part);if(rangeMeta)updateEta();const blob=new Blob([data]);
      if(typeof videoCacheWrite==='function')await videoCacheWrite(key,index,signature,part,blob);
      chunks[part]=blob;done++;updateEta();progress();
    }catch(error){job.videoFailed=error;for(const controller of job.controllers)controller.abort();throw error;}
  }}
  const settled=await Promise.allSettled(Array.from({length:job.videoWorkers},(_,i)=>worker(i)));
  const error=settled.find(item=>item.status==='rejected');job.videoFailed=null;if(error)throw error.reason;
  await imageCheckpoint(job);if(done!==urls.length)throw new Error('Получены не все фрагменты видео.');
  const blob=extension==='ts'&&message.chapter.videoContainer!=='original'?await videoRemuxTs(chunks,message,job):new Blob(chunks,{type:extension==='mp4'?'video/mp4':'video/mp2t'});
  if(extension==='ts'&&message.chapter.videoContainer!=='original')extension='mp4';
  if(message.chapter.outputFormat!=='files'&&job.bytes+blob.size>0xf0000000)throw videoLocalError('Архив MP4 превышает 4 ГБ. Выберите отдельные файлы.');
  const data=message.chapter.outputFormat==='files'?blob:new Uint8Array(await blob.arrayBuffer());
  return {name:'Серия '+message.chapter.number+'.'+extension,data};
}
async function probeVideoRange(job,url) {
  const result=await videoFetch(job,url,{headers:{Range:'bytes=0-0'},range:{start:0,end:0},probe:true,maxBytes:1});
  if(result.rangeUnsupported)return null;
  const total=Number(result.contentRange?.match(/\/(\d+)$/)?.[1]);
  const validator=result.etag&&!result.etag.startsWith('W/')?result.etag:result.modified;
  if(!Number.isSafeInteger(total)||total<VIDEO_PART_SIZE||!validator)return null;
  if(total>0xf0000000&&job.videoMessage?.chapter.outputFormat!=='files')throw videoLocalError('Архив превышает 4 ГБ. Выберите отдельные файлы или меньшее качество.');
  return {url,total,validator,validatorHeader:result.etag===validator?'ETag':'Last-Modified'};
}
async function downloadVideo(message,job) {
  job.videoMessage=message;job.videoFailed=null;job.videoStartedAt=Date.now();job.videoReceived=0;videoEtaStart(job,'pending');
  videoLog(message,'начинаю получение видео.');
  videoReport(message,job,'Серия '+message.chapter.number+' · Получаю поток '+(message.chapter.videoPlayer?.player||'видео')+'…');
  const url=await resolveVideo(message,job);
  // Probe only direct MP4 URLs; HLS already provides its own segment boundaries.
  if(message.chapter.videoRanges!==false&&/\.mp4(?:\?|$)/i.test(url)){
    const meta=await probeVideoRange(job,url);
    if(meta){const ranges=[];for(let start=0;start<meta.total;start+=VIDEO_PART_SIZE)ranges.push({start,end:Math.min(meta.total-1,start+VIDEO_PART_SIZE-1)});
      const signature=JSON.stringify(['range',url,meta.total,meta.validator,meta.validatorHeader]);
      try{
        const file=await videoParts(message,job,signature,ranges,'mp4',meta);
        const prefix=file.data instanceof Blob?new Uint8Array(await file.data.slice(0,12).arrayBuffer()):file.data.slice(0,12);
        if(String.fromCharCode(...prefix.slice(4,8))!=='ftyp'){if(typeof videoCacheDelete==='function')await videoCacheDelete(message.jobId,message.index??0);throw new Error('Сервер вернул ответ без MP4-видео.');}return videoFinished(message,job,file);
      }catch(error){
        if(job.stopped||!error.rangeFallback)throw error;
        if(typeof videoCacheDelete==='function')await videoCacheDelete(message.jobId,message.index??0);
        videoLog(message,'сервер перестал поддерживать Range; переключаюсь на обычную загрузку MP4.');
        videoReport(message,job,'Сервер перестал поддерживать диапазоны. Скачиваю видео обычным запросом…');
      }
    }else videoLog(message,'Range недоступен или нет надёжного валидатора; обычная загрузка MP4.');
  }
  let result=await videoFetch(job,url);
  if(String.fromCharCode(...result.bytes.slice(4,8))==='ftyp'){
    if(result.bytes.length+(message.chapter.outputFormat==='files'?0:job.bytes)>0xf0000000)throw videoLocalError('Архив превышает 4 ГБ. Уменьшите диапазон серий.');
    return videoFinished(message,job,{name:'Серия '+message.chapter.number+'.mp4',data:message.chapter.outputFormat==='files'?new Blob([result.bytes],{type:'video/mp4'}):result.bytes});
  }
  let manifest;
  for(let depth=0;depth<4;depth++){
    manifest=parseHls(result.text,result.url,videoQuality(message.chapter.quality));
    if(!manifest.variant)break;result=await videoFetch(job,manifest.variant,{text:true});
  }
  if(!manifest.segments)throw new Error('Не удалось выбрать HLS-поток серии.');
  const urls=[...(manifest.init?[manifest.init]:[]),...manifest.segments];
  return videoFinished(message,job,await videoParts(message,job,JSON.stringify(['hls',manifest.extension,urls]),urls,manifest.extension));
}
