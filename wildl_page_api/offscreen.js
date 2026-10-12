const retained = new Set();
const jobs = new Map();
function getJob(id) {
  if (!jobs.has(id)) jobs.set(id, {chapters: [], paused: false, stopped: false, controllers: new Set(), pending: new Set(), bytes: 0});
  return jobs.get(id);
}
async function loadJob(id) {
  const job=getJob(id);
  if(!job.loaded)job.loaded=checkpointRead(id).then(rows=>{
    for(const row of rows)job.chapters[row.index]=row.chapter;
    job.bytes=job.chapters.filter(chapter=>chapter&&chapter.outputFormat!=='files').reduce((sum,chapter)=>sum+(chapter.files||[]).reduce((n,file)=>n+videoSize(file.data),0),0);
  });
  await job.loaded;return job;
}
async function imageCheckpoint(job) {
  while (job.paused && !job.stopped) await new Promise(resolve => setTimeout(resolve, 100));
  if (job.stopped) throw new Error('Остановлено');
}
async function imageSleep(job, ms) {
  let remaining = ms;
  while (remaining > 0) {
    await imageCheckpoint(job);
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)));
    remaining -= Date.now() - start;
  }
  await imageCheckpoint(job);
}
function imageExtension(bytes) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (String.fromCharCode(...bytes.slice(0,3)) === 'GIF') return 'gif';
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'webp';
  if (bytes[0] === 66 && bytes[1] === 77) return 'bmp';
  if (String.fromCharCode(...bytes.slice(4,8)) === 'ftyp' &&
      /avif|avis/.test(String.fromCharCode(...bytes.slice(8,32)))) return 'avif';
  throw new Error('Сервер вернул ответ без изображения.');
}
function allowedImageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['imglib.info','cdnlibs.org','hentaicdn.org'].some(domain =>
    url.hostname === domain || url.hostname.endsWith('.' + domain)))
    throw new Error('Сервер изображения не поддерживается: ' + url.hostname);
  return url.href;
}
function imageProgress(message, status, videoEta=null) {
  chrome.runtime.sendMessage({type: 'IMAGE_PROGRESS', jobId: message.runId || message.jobId, status,videoEta}).catch(() => {});
}
async function downloadImage(message, job, page) {
  let lastError = new Error('Нет адреса изображения.');
  for (const candidate of page.urls || []) {
    let url;
    try { url = allowedImageUrl(candidate); } catch (error) { lastError = error; continue; }
    for (let attempt = 0; attempt < 3; attempt++) {
      await imageCheckpoint(job);
      const controller = new AbortController();
      job.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(url, {cache: 'no-store', credentials: 'omit', signal: controller.signal,
          headers: {Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9'}});
        if (response.status === 429) {
          clearTimeout(timer);
          const retryAfter = response.headers.get('Retry-After');
          const seconds = Number(retryAfter) || Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000) ||
            Number(message.chapter.limitPause) || 180;
          imageProgress(message, `Лимит изображений. Ожидание ${Math.ceil(seconds)} сек.`);
          await imageSleep(job, seconds * 1000);
          attempt--;
          continue;
        }
        if (!response.ok) {
          lastError = new Error(`Страница ${page.number}: HTTP ${response.status} (${new URL(url).hostname})`);
          if ([401,403,404,410].includes(response.status)) break;
          throw lastError;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        await imageCheckpoint(job);
        const extension = imageExtension(bytes);
        return {bytes, extension};
      } catch (error) {
        if (job.stopped) throw new Error('Остановлено');
        lastError = error;
        if (error.name === 'TypeError' && page.urls.length > 1) break;
        if (attempt < 2) await imageSleep(job, (attempt + 1) * 800);
      } finally { clearTimeout(timer); job.controllers.delete(controller); }
    }
  }
  throw new Error(`Том ${message.chapter.volume} Глава ${message.chapter.number} · Страница ${page.number}: ${lastError.message}`);
}
function mediaLog(message,text){try{Promise.resolve(chrome.runtime.sendMessage({type:"MEDIA_LOG",jobId:message.runId||message.jobId,text})).catch(()=>{});}catch{}}
async function storeChapter(message) {
  const started=Date.now();
  const existed = jobs.has(message.jobId);
  const job = await loadJob(message.jobId), chapter = message.chapter;
  if (!existed) job.paused = !!message.paused;
  await imageCheckpoint(job);
  if (job.chapters[message.index]) {if(chapter.kind==='anime'&&chapter.outputFormat==='files'){const cached=job.chapters[message.index];if(chapter.videoContainer==='mp4'&&cached.files?.[0]?.name.endsWith('.ts')){const blob=await videoRemuxTs([cached.files[0].data],message,job);cached.files=[{name:'Серия '+chapter.number+'.mp4',data:blob}];cached.videoContainer='mp4';await checkpointWrite(message.jobId,message.index,cached);}return {ok:true};}throw new Error('Глава уже сохранена в этом задании.');}
  if (chapter.kind === 'anime') {
    let file;
    try{file=await downloadVideo(message,job);}
    catch(error){
      if(job.stopped||error.noFallback||!chapter.fallbackPlayer)throw error;
      videoLog(message,`${chapter.videoPlayer.player}: ${error.message}. Переключаюсь на Kodik с той же озвучкой.`);
      imageProgress(message,`Серия ${chapter.number} · ${chapter.videoPlayer.player}: ${error.message}. Та же озвучка через Kodik…`);
      file=await downloadVideo({...message,chapter:{...chapter,videoPlayer:chapter.fallbackPlayer,fallbackPlayer:null}},job);
    }
    await imageCheckpoint(job);
    if(chapter.outputFormat!=='files')job.bytes+=videoSize(file.data);
    job.chapters[message.index]={...chapter,files:[file],...(chapter.outputFormat==='files'?{delivered:false}:{})};
  } else if (chapter.kind === 'manga') {
    const files = new Array(chapter.pages.length);let next=0,done=0,failed=false,converted=0;
    async function imageWorker(){while(!failed&&next<chapter.pages.length){await imageCheckpoint(job);const index=next++;if(index>=chapter.pages.length)return;
      for(;;){await imageCheckpoint(job);if(failed)return;if((job.imageActive||0)<6){job.imageActive=(job.imageActive||0)+1;break;}await imageSleep(job,25);}
      try{let image=await downloadImage(message,job,chapter.pages[index]);
        const imageFormat=chapter.imageFormat||'original';
        if(imageFormat!=='original'){if(image.extension!==imageFormat)converted++;image=await formatImage(image,imageFormat);}else if(chapter.imageMode==='webp')image=await compactImage(image);
        await imageCheckpoint(job);files[index]={name:`${String(index+1).padStart(4,'0')}.${image.extension}`,data:image.bytes};done++;
        imageProgress(message,`Том ${chapter.volume} · Глава ${chapter.number} · Страниц ${done}/${chapter.pages.length}`);
      }catch(error){failed=true;throw error;}finally{job.imageActive--;}
    }}
    const tasks=Array.from({length:Math.min(chapter.pages.length,Math.max(1,Math.min(6,Number(chapter.imageConcurrency)||3)))},imageWorker);
    const settled=await Promise.allSettled(tasks),failure=settled.find(item=>item.status==='rejected');if(failure)throw failure.reason;
    await imageCheckpoint(job);
    const bytes=files.reduce((sum,file)=>sum+videoSize(file.data),0);
    if(job.bytes+bytes>0xf0000000)throw new Error('Архив превышает 4 ГБ. Уменьшите диапазон глав.');
    job.bytes+=bytes;
    job.chapters[message.index] = {...chapter, files};
    mediaLog(message,`Том ${chapter.volume} Глава ${chapter.number}: ${files.length} страниц, формат ${[...new Set(files.map(file=>file.name.split('.').at(-1).toUpperCase()))].join('/')}; преобразовано ${converted}; ${(bytes/1048576).toFixed(1)} МиБ за ${Math.ceil((Date.now()-started)/1000)} сек.`);
  } else job.chapters[message.index] = chapter;
  await imageCheckpoint(job);
  try {await checkpointWrite(message.jobId,message.index,job.chapters[message.index]);}
  catch(error){if(chapter.outputFormat!=='files')job.bytes-=(job.chapters[message.index]?.files||[]).reduce((sum,file)=>sum+videoSize(file.data),0);delete job.chapters[message.index];throw new Error("Не удалось сохранить главу на диск: "+error.message);}
  if(chapter.kind==='anime')await videoCacheDelete(message.jobId,message.index);
  return {ok: true};
}
async function exportJob(data) {
  const job = await loadJob(data.jobId), chapters = job?.chapters || [], title = data.title || data.slug || 'book';
  const skipped = data.skipped || [];
  const complete = chapters.filter(Boolean);
  if (complete.length !== data.total - skipped.length || !complete.length || !data.total)
    throw new Error('Не все главы переданы для сборки файла. Повторите скачивание.');
  for(let index=0;index<data.total;index++) if(!chapters[index]&&!skipped.some(item=>item.index===index))
    throw new Error('В архиве отсутствует глава без записи в отчёте.');
  const unit=data.kind==='anime'?'серий':'глав',part=data.kind==='anime'?'Сезон':'Том',entry=data.kind==='anime'?'Серия':'Глава';
  const note = skipped.length ? [
    data.partial ? 'ЧАСТИЧНОЕ СКАЧИВАНИЕ' : 'ОТЧЁТ О ПРОПУЩЕННЫХ ГЛАВАХ',title,
    `Сохранено: ${complete.length} из ${data.total} ${unit}.`,
    ...skipped.map(item=>`${part} ${item.volume} ${entry} ${item.number}: ${item.reason}`),
    ...(data.error ? ['Причина остановки: ' + data.error] : [])
  ].join('\n') : '';
  let blob, extension;
  if (data.kind === 'manga' || data.kind === 'anime') {
    const files = [];
    if(data.kind==='anime'&&data.videoContainer==='mp4')for(let index=0;index<chapters.length;index++){const chapter=chapters[index];if(!chapter)continue;for(const file of chapter.files||[])if(file.name.endsWith('.ts')){const blob=await videoRemuxTs([file.data],{jobId:data.jobId,runId:data.runId,chapter},job);file.name=file.name.replace(/\.ts$/,'.mp4');file.data=new Uint8Array(await blob.arrayBuffer());await checkpointWrite(data.jobId,index,chapter);}}
    const usedNames=new Set();
    chapters.forEach((chapter, index) => {
      if(data.kind==='anime') {
        for(const file of chapter.files || []) {
          const videoExtension=file.name.match(/\.(ts|mp4)$/i)?.[1].toLowerCase();
          if(!videoExtension)throw new Error('Неизвестный формат видео серии '+chapter.number+'.');
          const base=`${safe(title)}. ${safe(String(chapter.number))}`;
          let name=`${base}.${videoExtension}`;
          if(usedNames.has(name.toLowerCase())) {
            const alternate=`${base} (сезон ${safe(String(chapter.volume))})`;
            name=`${alternate}.${videoExtension}`;
            for(let duplicate=2;usedNames.has(name.toLowerCase());duplicate++)name=`${alternate} (${duplicate}).${videoExtension}`;
          }
          usedNames.add(name.toLowerCase());
          files.push({name,data:file.data});
        }
        return;
      }
      const folder = `${String(index + 1).padStart(5,'0')} - ${safe(`${part} ${chapter.volume} ${entry} ${chapter.number}${chapter.name ? ' - ' + chapter.name : ''}`)}`;
      for (const file of chapter.files || []) files.push({name: `${folder}/${file.name}`, data: file.data});
    });
    if (!files.length) throw new Error(data.kind==='anime'?'В архиве нет видео серий.':'В архиве нет страниц манги.');
    if(data.kind==='manga')files.push({name:'ComicInfo.xml',data:makeComicInfo(title,complete,files.length,data.bookInfo||{})});
    if(note)files.push({name:'_Пропущенные_главы.txt',data:note});
    extension = data.kind==='anime' || data.format === 'zip' ? 'zip' : data.format==='cbr'?'cbr':'cbz';
    blob = extension==='cbr'?makeCbr(files):zip(files, extension === 'cbz' ? 'application/vnd.comicbook+zip' : 'application/zip');
  } else {
    extension=data.format||'epub';
    switch(extension){
      case 'txt':blob=new Blob([(note?note+'\n\n\n':'')+complete.map(chapter=>
        `${title}\n\n${`Том ${chapter.volume} Глава ${chapter.number}${chapter.name?" - "+chapter.name:""}`}\n\n${chapter.text}`).join('\n\n\n')],{type:'text/plain;charset=utf-8'});break;
      case 'epub':blob=await makeEpub(title,complete,note);break;
      case 'fb2':blob=makeFb2(title,complete,note);break;
      case 'pdf':blob=await makePdf(title,complete,note);break;
      case 'docx':blob=await makeDocx(title,complete,note);break;
      case 'mobi':blob=makeMobi(title,complete,note);break;
      default:throw new Error('Не поддерживается формат книги: '+extension);
    }
  }
  const url = URL.createObjectURL(blob);
  retained.add(url);
  const suffix = data.partial ? ' - частично' : skipped.length ? ' - доступные главы' : '';
  return {url, filename: safe(title) + suffix + '.' + extension,bytes:blob.size};
}
async function exportEpisode(message){
  const job=await loadJob(message.jobId),chapter=job.chapters[message.index];
  if(!chapter||chapter.outputFormat!=='files')throw new Error('Серия не готова к сохранению.');
  if(message.type==='VIDEO_DOWNLOAD_ID'){chapter.downloadId=message.downloadId;await checkpointWrite(message.jobId,message.index,chapter);return {ok:true};}
  if(message.type==='VIDEO_SAVED'){chapter.delivered=true;chapter.files=[];await checkpointWrite(message.jobId,message.index,chapter);return {ok:true};}
  const file=chapter.files?.[0];if(!file)throw new Error('Нет файла серии.');
  const ext=file.name.endsWith('.mp4')?'mp4':'ts';
  const blob=file.data instanceof Blob?file.data:new Blob([file.data],{type:ext==='mp4'?'video/mp4':'video/mp2t'});
  const url=URL.createObjectURL(blob);retained.add(url);
  return {url,filename:`${safe(message.title)}. ${safe(String(chapter.number))}${message.seasonSuffix?' (сезон '+safe(String(chapter.volume))+')':''}.${ext}`,bytes:blob.size,downloadId:chapter.downloadId};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'wildl-export') return;
  if(['EXPORT_EPISODE','VIDEO_SAVED','VIDEO_DOWNLOAD_ID'].includes(message.type)){exportEpisode(message).then(respond).catch(error=>respond({error:error.message}));return true;}
  if (message.type === 'CHAPTER') {
    const job=getJob(message.jobId);
    const task=storeChapter(message);job.pending.add(task);
    task.then(respond).catch(error=>respond({ok:false,error:error.message})).finally(()=>job.pending.delete(task));
    return true;
  }
  if (message.type === 'CONTROL') {const job=getJob(message.jobId);job.paused=!!message.paused;if(job.paused)videoEtaHold(job);else if(!(job.videoCooldownUntil>Date.now()))videoEtaRelease(job);respond({ok:true});}
  if (['COMMIT','DISCARD','CANCEL_KEEP','RESET','INDICES'].includes(message.type)) {
    (async()=>{
      const job=await loadJob(message.jobId);
      if(['DISCARD','CANCEL_KEEP'].includes(message.type)){
        job.stopped=true;job.paused=false;for(const controller of job.controllers)controller.abort();
        await Promise.allSettled([...job.pending]);
      }
      if(['COMMIT','DISCARD'].includes(message.type)){await checkpointDelete(message.jobId);await videoCacheDelete(message.jobId);jobs.delete(message.jobId);return {ok:true};}
      if(message.type==='RESET'){job.stopped=false;job.paused=false;job.bytes=job.chapters.filter(chapter=>chapter&&chapter.outputFormat!=='files').reduce((sum,chapter)=>sum+(chapter.files||[]).reduce((n,file)=>n+videoSize(file.data),0),0);}
      return {ok:true,indices:job.chapters.map((chapter,index)=>chapter&&chapter.delivered!==false?index:null).filter(index=>index!==null)};
    })().then(respond).catch(error=>respond({ok:false,error:error.message}));return true;
  }
  if (message.type === 'RELEASE') {
    if (retained.delete(message.url)) URL.revokeObjectURL(message.url);
    respond({ok: true});
  }
  if (message.type === 'EXPORT') {
    exportJob(message.data).then(respond).catch(error=>respond({error:error.message}));return true;
  }
});
