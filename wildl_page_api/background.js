if(typeof importScripts==='function')importScripts('sites.js', 'mirrors.js', 'request-headers.js', 'page.js', 'video.js', 'updates.js','library.js');
let state = {running: false, inspecting: false, paused: false, saving: false, title: '', total: 0,
  done: 0, status: 'Готово.', mode: '', branches: [], selectedBranch: '', chapterCount: 0, slug: '',
  kind: 'novel', siteName: '', siteId: 3, starting: false, skipped:0, skippedChapters:[], plan:[],
  format:'epub', recovery:null, cfg:null, archiveId:null, sourceUrl:'', catalogue:null, log: []};
let jobId = null, tabId = null, lastSeen = 0;
let pendingChapter = 0;
let exporterCreation = null;
let queue = Promise.resolve();
let persistedCatalogue=null;
let qualityProbe=null;
function cancelQualityProbe(){if(qualityProbe){qualityProbe.cancelled=true;for(const controller of qualityProbe.controllers)controller.abort();qualityProbe=null;}state.qualityChecking=false;}
async function checkQuality(force=false){
  cancelQualityProbe();
  const branch=state.branches?.find(item=>item.id===state.selectedBranch),rows=state.catalogue?.qualitySources?.[state.selectedBranch];
  if(state.kind!=='anime'||state.running||state.inspecting||state.recovery||!branch||!rows?.length)return;
  if(branch.qualitySummary&&!force)return;
  const probe={controllers:new Set(),cancelled:false};qualityProbe=probe;state.qualityChecking=true;
  state.status=`Проверяю качество выбранной озвучки: 0/${rows.length}`;await publish();
  const qualities=new Set(),uhdEpisodes=[];let checked=0,unknown=0,next=0;
  try{
    if(probe.cancelled)return;
    await setVideoRequestHeaders(state.siteOrigin);
    const text=async(url,options={})=>{
      if(probe.cancelled)throw new Error('Остановлено');
      const controller=new AbortController();probe.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),12000);
      try{const response=await fetch(videoUrl(url),{...options,credentials:'omit',signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);return await response.text();}
      finally{clearTimeout(timer);probe.controllers.delete(controller);}
    };
    async function scan(){while(next<rows.length&&!probe.cancelled){const row=rows[next++];
      let available=(row.player?.quality||[]).filter(item=>item.src||item.url||item.href).map(item=>videoResolution(item.quality)).filter(Boolean);
      try{
        if(!available.length&&row.player?.player==='Kodik'&&!/\.(?:mp4|m3u8)(?:\?|$)/i.test(row.player.src||'')){
          const data=await kodikStreams(row.player,text);available=Object.entries(data.links||{}).filter(([,links])=>Array.isArray(links)&&links.some(item=>item?.src))
            .map(([height])=>videoResolution(height)).filter(Boolean);
        }
        if(!available.length)unknown++;
        for(const height of available)qualities.add(height);
        if(available.some(height=>height>=2160))uhdEpisodes.push(row.episode);
      }catch{if(probe.cancelled)return;unknown++;}
      checked++;if(probe.cancelled)return;
      state.status=`Проверяю качество выбранной озвучки: ${checked}/${rows.length}`;await publish();
    }}
    await Promise.all([scan(),scan()]);
    if(probe.cancelled)return;
    branch.qualitySummary={total:rows.length,checked,unknown,qualities:[...qualities].sort((a,b)=>a-b),uhdEpisodes};
    const cached=state.catalogue?.voiceAvailability?.find(item=>item.id===branch.id);
    if(cached){cached.qualitySummary=branch.qualitySummary;state.catalogue={...state.catalogue};}
    state.status=unknown?`Список серий обновлён. Качество не определено у ${unknown} из ${rows.length} серий.`:'Список серий и качество обновлены.';
  }catch(error){if(!probe.cancelled){state.status='Качество не удалось проверить. Можно повторить проверку.';log('Проверка качества: '+error.message);}}
  finally{if(qualityProbe===probe){qualityProbe=null;state.qualityChecking=false;await clearImageRequestHeaders();await publish();}}
}
function publicState(){const {catalogue,plan,...view}=state;return view;}
let restoringState=true;
const restored = chrome.storage.session.get('wildl').then(async ({wildl}) => {
  if (wildl) {({state, jobId, tabId, lastSeen} = wildl);state.qualityChecking=false;if(!state.catalogue)state.catalogue=(await chrome.storage.session.get('wildlCatalogue')).wildlCatalogue||null;persistedCatalogue=state.catalogue;}
  else if(chrome.storage.local){
    const saved=(await chrome.storage.local.get('wildlCheckpoint')).wildlCheckpoint;
    if(saved){state=saved;jobId=null;tabId=null;lastSeen=Date.now();state.running=false;state.inspecting=false;state.paused=false;state.saving=false;state.starting=false;state.qualityChecking=false;
      if(state.archiveId&&state.cfg){
        const original=state.recovery||{};await ensureExporter();
        const stored=await chrome.runtime.sendMessage({target:'wildl-export',type:'INDICES',jobId:state.archiveId});
        const indices=new Set(stored?.indices||[]);
        state.done=indices.size;
        state.recovery={...original,jobId:state.archiveId,title:state.title,slug:state.slug,done:indices.size,total:state.total,kind:state.kind,format:state.format,
          partial:true,error:original.error||'Браузер был закрыт.',skipped:(state.plan||[]).filter(item=>!indices.has(item.index)).map(item=>({...item,
            reason:(state.skippedChapters||[]).find(chapter=>chapter.index===item.index)?.reason||'Не скачана: загрузка прервана.'}))};
        state.running=false;state.inspecting=false;state.paused=false;state.saving=false;state.starting=false;state.status='Загрузка прервана. Можно продолжить.';
      }
    }
  }
}).finally(async()=>{restoringState=false;await publish();});
async function publish() {
  if(state.catalogue!==persistedCatalogue){await chrome.storage.session.set({wildlCatalogue:state.catalogue});persistedCatalogue=state.catalogue;}
  const {catalogue,...sessionState}=state;
  await chrome.storage.session.set({wildl: {state:sessionState, jobId, tabId, lastSeen}});
  if(chrome.storage.local){const {catalogue,...checkpoint}=state;await chrome.storage.local.set({wildlCheckpoint:checkpoint});}
  chrome.runtime.sendMessage({type: 'STATE', state:publicState()}).catch(() => {});
}
function log(text) {state.log.push('['+new Date().toLocaleTimeString('ru-RU',{hour12:false})+'] '+String(text));if(state.log.length>300)state.log.shift();}
function isSite(url) {
  return !!getLibSite(url);
}
async function findTab(sourceUrl) {
  if(typeof mirrorReady!=='undefined')await mirrorReady;
  if(sourceUrl){const url=new URL(sourceUrl);return (await chrome.tabs.query({})).find(tab=>{try{const other=new URL(tab.url);return other.hostname===url.hostname&&other.pathname.split("/").find(x=>/^\d+--/.test(x))===url.pathname.split("/").find(x=>/^\d+--/.test(x));}catch{return false;}});}
  const tabs = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  if (tabs[0] && isSite(tabs[0].url)) return tabs[0];
  return (await chrome.tabs.query({})).find(tab => isSite(tab.url));
}
async function stop() {
  cancelQualityProbe();
  if(state.running&&!state.saving){await fail(new Error('Остановлено'),'Остановлено.');return;}
  const oldJob = jobId; jobId = null;
  state.running = false; state.inspecting = false; state.paused = false; state.saving = false; state.status = 'Остановлено.';
  state.starting = false;
  if (tabId != null) await chrome.tabs.sendMessage(tabId, {type: 'WILDL_STOP', jobId: oldJob}).catch(() => {});
  await discard(oldJob);
  await clearImageRequestHeaders();
  await publish();
}
async function start(cfg, inspect = false, resume = false) {
  if (state.running) return;
  cancelQualityProbe();
  if (state.inspecting) await stop();
  const recovery = inspect||resume ? state.recovery || null : null;
  const previous=state;
  if(resume){if(!recovery||!state.cfg)throw new Error('Нет задания для продолжения.');cfg={...state.cfg};}
  const ratePreference=chrome.storage.local?(await chrome.storage.local.get('wildlApiRate')).wildlApiRate:null;
  cfg={...cfg,apiRate:Math.max(1,Math.min(120,Number(cfg.apiRate??ratePreference)||60))};
  if(chrome.storage.local)await chrome.storage.local.set({wildlApiRate:cfg.apiRate});
  const tab = await findTab(resume?state.sourceUrl:null);
  if (!tab) throw new Error(resume?'Откройте исходный тайтл и нажмите «Продолжить загрузку».':'Откройте тайтл на RanobeLib, MangaLib, HentaiLib, SlashLib или AnimeLib.');
  if(!inspect&&!resume&&state.recovery)await discard(state.recovery.jobId);
  const site = getLibSite(tab.url);
  if(site.kind==='anime')cfg={...cfg,videoContainer:cfg.videoContainer||(resume?'original':'mp4')};
  if(site.kind==='manga')cfg={...cfg,imageFormat:cfg.imageFormat||(resume?'original':'jpg')};
  const currentSlug = new URL(tab.url).pathname.split('/').find(segment => /^\d+--/.test(segment)) || '';
  const sameBook = currentSlug === state.slug && site.id === (state.siteId || 3);
  if (inspect && !sameBook) { cfg = {...cfg}; delete cfg.branchId; }
  if (cfg.branchId === undefined && sameBook) cfg = {...cfg, branchId: state.selectedBranch || ''};
  const book = sameBook ? {title: state.title, branches: state.branches || [],
    selectedBranch: cfg.branchId || '', chapterCount: state.chapterCount || 0, slug: currentSlug} :
    {title: '', branches: [], selectedBranch: '', chapterCount: 0, slug: currentSlug};
  let completed=[];
  if(resume){await ensureExporter();const reset=await chrome.runtime.sendMessage({target:'wildl-export',type:'RESET',jobId:recovery.jobId});
    if(!reset?.ok)throw new Error(reset?.error||'Не удалось восстановить скачанные главы.');completed=reset.indices||[];}
  if(sameBook&&state.catalogue&&!cfg.forceRefresh)cfg={...cfg,catalogue:state.catalogue};
  tabId = tab.id; jobId = crypto.randomUUID(); lastSeen = Date.now();
  state = {running: !inspect, inspecting: inspect, paused: false, saving: false, starting: true,
    kind: site.kind, siteName: site.name, siteId: site.id, siteOrigin: new URL(tab.url).origin, ...book, total: resume?previous.total:0, done: completed.length,
    skipped:0,skippedChapters:[],plan:resume?previous.plan:[],format:cfg.format || (site.kind==='manga'?'cbz':site.kind==='anime'?'files':'epub'),recovery,
    cfg:inspect?previous.cfg:{...cfg,catalogue:undefined},archiveId:resume?recovery.jobId:inspect?previous.archiveId:jobId,
    sourceUrl:resume||inspect&&sameBook?previous.sourceUrl:tab.url,catalogue:sameBook?previous.catalogue:null,
    bookInfo:sameBook?previous.bookInfo:null,apiRate:cfg.apiRate,
    availabilityDeferred:sameBook?previous.availabilityDeferred:false,checkedRange:sameBook?previous.checkedRange:null,
    status: inspect ? (site.kind==='anime'?'Определяю фильм / сериал…':'Определяю книгу...') : 'Запускаю API на странице...', mode: '', log: []};
  log('Запуск загрузчика ' + site.name + '...'); await publish();
  const launchingJob = jobId;
  if (!inspect && site.kind === 'anime') await setVideoRequestHeaders(state.siteOrigin);
  else if (!inspect && site.kind === 'manga') await setImageRequestHeaders(state.siteOrigin);
  else await clearImageRequestHeaders();
  await chrome.scripting.executeScript({target: {tabId}, files: ['content.js']});
  if (jobId !== launchingJob) return;
  const ready = await chrome.tabs.sendMessage(tabId, {type: 'WILDL_PREPARE', jobId});
  if (!ready?.ok) throw new Error('Не удалось подключить расширение к странице. Обновите вкладку.');
  const result = await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN',
    func: pageDownloader, args: [jobId, {...cfg, inspect, site,completedIndices:completed,resumePlan:resume?state.plan:undefined}]});
  if (!result?.[0]?.result?.started) throw new Error('Браузер не подтвердил запуск загрузчика. Обновите вкладку.');
  state.starting = false;
  log('Браузер подтвердил запуск загрузчика.'); await publish();
}
async function fail(error,status='Ошибка') {
  const oldJob = jobId, archiveId=state.archiveId||oldJob,wasRunning=state.running; jobId = null;
  state.running = false; state.inspecting = false; state.paused = false; state.saving = false; state.status = status;
  state.starting = false;state.videoEta=null;
  log('Ошибка: ' + (error.message || error));
  if (tabId != null) await chrome.tabs.sendMessage(tabId, {type: 'WILDL_STOP', jobId: oldJob}).catch(() => {});
  let retained = null;
  if(wasRunning&&archiveId){await ensureExporter();
    retained = await chrome.runtime.sendMessage({target:'wildl-export',type:'CANCEL_KEEP',jobId:archiveId}).catch(()=>null);}
  if(wasRunning&&retained?.ok&&state.cfg) {
    const indices = new Set(retained.indices);
    const skipped = state.plan.filter(chapter=>!indices.has(chapter.index)).map(chapter=>({
      ...chapter,reason:(state.skippedChapters||[]).find(item=>item.index===chapter.index)?.reason || 'Не скачана: загрузка прервана.'
    }));
    state.recovery = {jobId:archiveId,title:state.title,slug:state.slug,kind:state.kind,format:state.format,
      total:state.total,done:retained.indices.length,skipped,partial:retained.indices.length+(state.skippedChapters?.length||0)<state.total,error:error.message||String(error)};
    state.done = retained.indices.length;
    log(`Сохранено на диске ${state.done} ${state.kind==='anime'?'серий':'глав'}. Можно продолжить загрузку${state.done?' или сохранить скачанное':''}.`);
  } else if(wasRunning)await discard(archiveId);
  await clearImageRequestHeaders();
  await publish();
}
async function saveRecovered(format) {
  const recovery = state.recovery;
  if(!recovery || state.running || state.inspecting)return;
  const formats = recovery.kind==='manga'?['cbz','zip','cbr']:recovery.kind==='anime'?['files','zip']:['epub','txt','fb2','pdf','docx','mobi'];
  if(!recovery.done||recovery.format==='files')return;
  const message = {...recovery,keepCheckpoint:!!recovery.partial,format:formats.includes(format)?format:recovery.format};
  state.running=true;state.saving=true;state.status=recovery.kind==='anime'?'Собираю скачанные серии…':'Собираю скачанные главы...';await publish();
  try {
    if(recovery.kind==='anime'&&message.format==='files'){
      state.format='files';state.cfg={...state.cfg,format:'files'};state.recovery={...recovery,format:'files'};
      const stored=await chrome.runtime.sendMessage({target:'wildl-export',type:'INDICES',jobId:recovery.jobId});
      if(stored?.indices?.length!==recovery.done)throw new Error('Часть сохранённых серий недоступна. Нажмите «Продолжить загрузку» для восстановления.');
      for(const index of stored.indices||[]){const chapter=state.plan.find(item=>item.index===index);if(!chapter)throw new Error('Не найдена серия в плане загрузки.');
        await saveVideoEpisode({index,chapter},jobId);}
      if(!recovery.partial)await chrome.runtime.sendMessage({target:'wildl-export',type:'COMMIT',jobId:recovery.jobId});
    }else await saveResult(message);
    if(state.archiveId!==recovery.jobId)return;
    state.done=recovery.done;state.total=recovery.total;
    state.skipped=recovery.skipped.length;state.skippedChapters=recovery.skipped;
    state.partial=!!recovery.partial;state.summary={done:state.done,total:state.total,skipped:state.skipped,partial:state.partial};
    state.status=recovery.kind==='anime'?'Скачанные серии сохранены.':'Скачанные главы сохранены.';
    if(!recovery.partial){state.recovery=null;state.archiveId=null;state.cfg=null;}
  } catch(error) {if(state.archiveId!==recovery.jobId)return;await fail(error,'Ошибка сохранения');}
  state.running=false;state.saving=false;await publish();
}
async function discard(id) {
  if(id){await ensureExporter();
    await chrome.runtime.sendMessage({target: 'wildl-export', type: 'DISCARD', jobId: id}).catch(() => {});}
}
async function ensureExporter() {
  if (exporterCreation) return exporterCreation;
  exporterCreation = (async () => {
    if(!chrome.offscreen&&typeof document!=='undefined'){
      if(document.getElementById('wildl-export-frame'))return;
      await new Promise((resolve,reject)=>{const frame=document.createElement('iframe');frame.id='wildl-export-frame';frame.hidden=true;
        frame.onload=resolve;frame.onerror=()=>{frame.remove();reject(new Error('Не удалось запустить сборку файлов Firefox.'));};
        frame.src=chrome.runtime.getURL('offscreen.html');document.body.append(frame);});return;
    }
    if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['BLOBS'],
      justification: 'Create and retain the TXT/EPUB/CBZ Blob until the browser finishes downloading it.'});
  })();
  try { await exporterCreation; } finally { exporterCreation = null; }
}
async function saveResult(message) {
  await ensureExporter();
  const file = await chrome.runtime.sendMessage({target: 'wildl-export', type: 'EXPORT', data: {...message,runId:jobId,videoContainer:message.videoContainer||state.cfg?.videoContainer||'original',bookInfo:message.bookInfo||state.bookInfo}});
  if (!file?.url) throw new Error(file?.error || 'Не удалось собрать файл.');
  const {settings}=await getLibrary();
  const filename=settings.folder?settings.folder+'/'+file.filename:file.filename;
  let id;
  try { id = await chrome.downloads.download({url: file.url, filename, saveAs: settings.ask,conflictAction:'uniquify'}); }
  catch (error) {
    await chrome.runtime.sendMessage({target: 'wildl-export', type: 'RELEASE', url: file.url}); throw error;
  }
  const {wildlDownloads = {}} = await chrome.storage.session.get('wildlDownloads');
  wildlDownloads[id] = {url: file.url, jobId:message.jobId,awaitCompletion:true,keepCheckpoint:!!message.keepCheckpoint};
  wildlDownloads[id].summary={kind:message.kind,done:message.done??message.total,total:message.total,skipped:message.skipped?.length||0,partial:!!message.partial};
  await chrome.storage.session.set({wildlDownloads});
  await addHistory({id,title:message.title||state.title,sourceUrl:state.sourceUrl,filename,bytes:file.bytes||0,kind:message.kind,format:message.format||state.format,
    done:message.done??message.total,total:message.total,partial:!!message.partial,branch:state.branches?.find(item=>item.id===state.selectedBranch)?.name||'',
    from:state.cfg?.from??'',to:state.cfg?.to??''});
  try{
    // A download ID confirms creation, not successful writing to disk.
    // Poll outside the command queue: onChanged is queued behind this export.
    for(;;){
      const item=(await chrome.downloads.search({id}))[0];
      if(item?.state==='complete'){
        await finishHistory(id,'complete',{bytes:item.fileSize>=0?item.fileSize:file.bytes||0,filename:item.filename||filename});
        if(!message.keepCheckpoint){const committed=await chrome.runtime.sendMessage({target:'wildl-export',type:'COMMIT',jobId:message.jobId});
          if(!committed?.ok)log('Файл записан, но контрольные точки пока не очищены.');}
        log(`Файл успешно сохранён: ${item.filename||filename} (${((file.bytes||0)/1048576).toFixed(1)} МиБ).`);
        return id;
      }
      if(!item||item.state==='interrupted'){
        const error=downloadFailure(item);
        await finishHistory(id,'interrupted',{error:item?.error||'DOWNLOAD_NOT_FOUND',filename:item?.filename||filename});
        throw error;
      }
      lastSeen=Date.now();
      if(state.archiveId===message.jobId){state.status=`Записываю файл на диск: ${((file.bytes||0)/1048576).toFixed(1)} МиБ…`;await publish();}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  }finally{
    await chrome.runtime.sendMessage({target:'wildl-export',type:'RELEASE',url:file.url}).catch(()=>{});
    const current=(await chrome.storage.session.get('wildlDownloads')).wildlDownloads||{};
    delete current[id];await chrome.storage.session.set({wildlDownloads:current});
  }
}
function downloadFailure(item){
  const code=item?.error||'DOWNLOAD_NOT_FOUND';
  const reasons={FILE_NO_SPACE:'Не хватает места для записи файла. Для ZIP нужны место под сохранённые серии, временный архив и итоговую копию. Освободите место на диске профиля браузера и на диске загрузок либо выберите «По одному файлу».',FILE_ACCESS_DENIED:'Нет доступа к выбранной папке.',FILE_TOO_LARGE:'Файл слишком большой для выбранного диска или файловой системы.',
    FILE_FAILED:'Браузер не смог записать файл на диск.',FILE_TRANSIENT_ERROR:'Временная ошибка записи файла.',FILE_VIRUS_INFECTED:'Защитная программа заблокировала файл.',FILE_BLOCKED:'Браузер заблокировал файл.',
    USER_CANCELED:'Сохранение отменено.',USER_SHUTDOWN:'Браузер был закрыт.',NETWORK_FAILED:'Браузер прервал получение файла.',NETWORK_TIMEOUT:'Истекло время получения файла.',DOWNLOAD_NOT_FOUND:'Запись загрузки не найдена.'};
  return new Error(`Ошибка сохранения (${code}): ${reasons[code]||'Браузер прервал сохранение файла.'} Скачанные данные оставлены для повторного сохранения.`);
}
// A chapter acknowledgement in files mode means the browser has finished writing it.
async function saveVideoEpisode(message,runId) {
  const archiveId=state.archiveId||runId;
  const request={target:'wildl-export',jobId:archiveId,index:message.index};
  state.videoEta={series:String(message.chapter.number),at:Date.now(),phase:'saving',seconds:null,progress:1};
  const file=await chrome.runtime.sendMessage({...request,type:'EXPORT_EPISODE',title:state.title,seasonSuffix:state.plan.filter(item=>String(item.number)===String(message.chapter.number)).length>1});
  if(file?.delivered)return;
  if(!file?.url)throw new Error(file?.error||'Нет видео для сохранения.');
  let id=file.downloadId;
  try{
    let existing=id!=null?(await chrome.downloads.search({id}))[0]:null;
    if(existing?.state==='interrupted'&&existing.canResume){await chrome.downloads.resume(id).catch(()=>{});existing=(await chrome.downloads.search({id}))[0];}
    if(!existing||existing.state==='interrupted'){
      const {settings}=await getLibrary();
      const filename=(settings.folder?settings.folder+'/':'')+safeVideoFolder(state.title)+'/'+file.filename;
      log(`Серия ${message.chapter.number}: сохраняю ${filename} (${(file.bytes/1048576).toFixed(1)} МиБ).`);
      id=await chrome.downloads.download({url:file.url,filename,saveAs:settings.ask,conflictAction:'uniquify'});
      const recorded=await chrome.runtime.sendMessage({...request,type:'VIDEO_DOWNLOAD_ID',downloadId:id});
      if(!recorded?.ok){await chrome.downloads.cancel(id).catch(()=>{});throw new Error(recorded?.error||'Не удалось сохранить состояние записи серии.');}
      await addHistory({id,title:state.title,sourceUrl:state.sourceUrl,filename,bytes:file.bytes,kind:'anime',format:file.filename.endsWith('.mp4')?'mp4':'ts',
        done:1,total:1,branch:state.branches?.find(item=>item.id===state.selectedBranch)?.name||'',from:message.chapter.number,to:message.chapter.number});
    }
    for(;;){
      const item=(await chrome.downloads.search({id}))[0];
      if(item?.state==='complete'){
        await finishHistory(id,'complete',{bytes:item.fileSize,filename:item.filename});
        const saved=await chrome.runtime.sendMessage({...request,type:'VIDEO_SAVED'});if(!saved?.ok)throw new Error(saved?.error||'Не удалось отметить сохранённую серию.');log(`Серия ${message.chapter.number}: файл успешно сохранён.`);return;
      }
      if(jobId!==runId){if(item?.state==='in_progress')await chrome.downloads.cancel(id).catch(()=>{});throw new Error('Загрузка прервана. Можно продолжить.');}
      if(!item||item.state==='interrupted'){await finishHistory(id,'interrupted',{error:item?.error||'DOWNLOAD_NOT_FOUND'});throw downloadFailure(item);}
      lastSeen=Date.now();if(!state.paused)state.status='Сохраняю файл серии '+message.chapter.number+'…';
      await publish();await new Promise(resolve=>setTimeout(resolve,500));
    }
  }finally{await chrome.runtime.sendMessage({target:'wildl-export',type:'RELEASE',url:file.url}).catch(()=>{});}
}
function safeVideoFolder(value){return String(value||'Anime').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'Anime';}
async function handlePage(message) {
  lastSeen = Date.now();
  if(message.type==='availabilityProgress') {
    state.title=message.title;state.chapterCount=message.chapterCount;state.status=message.status;
  }
  if (message.type === 'log') log(message.text);
  if (message.type === 'preview' || message.type === 'meta') {
    state.title = message.title; state.total = message.total; state.mode = message.mode;
    state.branches = message.branches || state.branches || [];
    state.selectedBranch = message.selectedBranch ?? state.selectedBranch ?? '';
    state.chapterCount = message.chapterCount ?? state.chapterCount ?? message.total;
    state.slug = message.slug || state.slug;
    state.kind = message.kind || state.kind;
    state.siteName = message.siteName || state.siteName;
    state.siteId = message.siteId || state.siteId;
    if(message.bookInfo)state.bookInfo=message.bookInfo;
    if(message.availabilityChecked!=null)state.availabilityChecked=message.availabilityChecked;
    if(message.availabilityVersion!=null)state.availabilityVersion=message.availabilityVersion;
    if(message.availabilityDeferred!=null)state.availabilityDeferred=message.availabilityDeferred;
    if(message.catalogueCount!=null)state.catalogueCount=message.catalogueCount;
    if('checkedRange' in message)state.checkedRange=message.checkedRange;
    if(message.plan)state.plan=message.plan;
    if(message.catalogue)state.catalogue=message.catalogue;
    state.status = state.kind==='anime'?
      (message.availabilityDeferred?'Задайте диапазон и нажмите «Сканировать диапазон».':message.total?(message.type==='preview'?'Список серий обновлён.':`Подготовлено ${message.total} серий.`):'Нет доступных серий выбранной озвучки.'):
      message.total ? (message.type === 'preview' ? 'Список глав обновлён.' : `Подготовлено ${message.total} глав.`) : 'Нет доступных глав выбранного переводчика.';
    log(`${message.total} ${state.kind==='anime'?'серий':'глав'} найдено • ${message.mode}`);
    if (message.type === 'preview') { state.inspecting = false; jobId = null;checkQuality().catch(()=>{}); }
  }
  if (message.type === 'progress') {
    state.videoEta=null;
    if(message.done!=null)state.done = message.done;if(message.total!=null)state.total = message.total;
    if (!state.paused) state.status = message.status;
  }
  if (message.type === 'skipped') {
    if(!state.skippedChapters.some(chapter=>chapter.index===message.chapter.index))state.skippedChapters.push(message.chapter);
    state.skipped=state.skippedChapters.length;
    log(state.kind==='anime'?`Пропущена: Сезон ${message.chapter.volume} Серия ${message.chapter.number}. ${message.chapter.reason}`:
      `Пропущена: Том ${message.chapter.volume} Глава ${message.chapter.number}. ${message.chapter.reason}`);
    if(!state.paused)state.status=message.status;
  }
  if (message.type === 'control') {
    state.paused = !!message.paused;
    state.status = state.paused ? 'На паузе. Можно продолжить.' : `Продолжаю: ${state.done}/${state.total}`;
  }
  if (message.type === 'chapter') {
    pendingChapter++;
    try {
      await ensureExporter();
      if (jobId !== message.jobId) return;
      const stored = await chrome.runtime.sendMessage({target: 'wildl-export', type: 'CHAPTER',
        jobId: state.archiveId||message.jobId,runId:message.jobId, index: message.index, chapter: message.chapter, paused: state.paused});
      if (jobId !== message.jobId) return;
      if (!stored?.ok) throw new Error(stored?.error || 'Не удалось сохранить полученную главу.');
      if(state.kind==='anime'&&state.format==='files')await saveVideoEpisode(message,message.jobId);
    } finally { pendingChapter--; }
  }
  if (message.type === 'error') { await fail(new Error(message.text)); return; }
  if (message.type === 'done') {
    state.done = message.done??message.total;state.skippedChapters=message.skipped||[];state.skipped=state.skippedChapters.length;
    state.summary={done:state.done,total:state.total,skipped:state.skipped,partial:false};
    state.videoEta=null;state.paused = false; state.saving = true; state.status = 'Собираю файл...'; await publish();
    try {
      await clearImageRequestHeaders();
      const direct=state.kind==='anime'&&state.format==='files';
      const id=direct?null:await saveResult({...message,jobId:state.archiveId||message.jobId});
      if(jobId!==message.jobId)return;
      if(direct)await chrome.runtime.sendMessage({target:'wildl-export',type:'COMMIT',jobId:state.archiveId||message.jobId});
      state.recovery=null;state.archiveId=null;state.cfg=null;
      state.status = direct||state.skipped?`Сохранено ${state.done} из ${state.total} ${state.kind==='anime'?'серий':'глав'}. Пропущено: ${state.skipped}.`:'Файл сохранён.'; log(direct?'Все доступные серии сохранены отдельными файлами.':'Сохранение файла завершено: '+id);
    } catch (error) { if(jobId===message.jobId)await fail(error); return; }
    state.running = false; state.saving = false; jobId = null;
  }
  await publish();
}
async function dispatch(message, sender) {
  await restored;
  if(message.type==='PREPARE_RELOAD') {
    cancelQualityProbe();
    if(state.running&&!state.saving)await fail(new Error('Расширение перезапущено. Можно продолжить загрузку.'),'Загрузка прервана. Можно продолжить.');
    else if(state.inspecting)await stop();
    await publish();return {ok:true};
  }
  if (message.type === 'GET_STATE') {
    if ((state.running || state.inspecting) && !state.saving && Date.now() - lastSeen > 90000)
      await fail(new Error(state.kind==='anime'?'Нет ответа от вкладки. Обновите страницу фильма / сериала и повторите запуск.':'Нет ответа от вкладки. Обновите страницу книги и повторите запуск.'));
    return state;
  }
  if (message.type === 'INSPECT') { if (!state.running&&!state.recovery) await start(message.cfg || {}, true); return state; }
  if (message.type === 'AUTO_INSPECT') {if(!state.running&&!state.inspecting&&!state.recovery){const tab=await findTab();const slug=tab&&new URL(tab.url).pathname.split('/').find(x=>/^\d+--/.test(x));if(!state.title||slug!==state.slug||getLibSite(tab?.url)?.id!==state.siteId||(state.kind==='anime'&&state.availabilityVersion!==3))await start({},true);}return state;}
  if(message.type==='CHECK_QUALITY'){checkQuality(true).catch(()=>{});return state;}
  if(message.type==='CONTINUE'){if(message.format&&state.cfg){const formats=state.kind==='manga'?['cbz','zip','cbr']:state.kind==='anime'?['files','zip']:['epub','txt','fb2','pdf','docx','mobi'];if(state.kind==='anime'&&message.format!==state.cfg.format)throw new Error('При продолжении сохраните исходный формат загрузки.');if(!formats.includes(message.format))throw new Error('Не поддерживается формат: '+message.format);state.cfg={...state.cfg,format:message.format};}if(message.videoContainer&&state.kind==='anime'&&['mp4','original'].includes(message.videoContainer))state.cfg={...state.cfg,videoContainer:message.videoContainer};await start({},false,true);return state;}
  if(message.type==='INTERRUPTED'&&message.jobId===jobId&&sender.tab?.id===tabId){if(!state.saving)await fail(new Error('Исходная вкладка закрыта или перезагружена. Можно продолжить.'));return state;}
  if (message.type === 'SELECT_BRANCH' && !state.running && !state.inspecting) {
    const id = String(message.branchId || '');
    if (id && !(state.branches || []).some(branch => branch.id === id)) throw new Error('Переводчик не найден. Обновите список.');
    state.selectedBranch = id;
    state.total = id ? state.branches.find(branch => branch.id === id).count : state.chapterCount;
    state.done = 0; state.status = 'Готово к скачиванию.';
    checkQuality().catch(()=>{});
    await publish(); return state;
  }
  if (message.type === 'PAUSE' || message.type === 'RESUME') {
    if (state.running && !state.saving && !state.starting) {
      const action = message.type === 'PAUSE' ? 'pause' : 'resume';
      const response = await chrome.tabs.sendMessage(tabId, {type: 'WILDL_CONTROL', jobId, action});
      if (!response?.ok) throw new Error('Не удалось передать команду во вкладку.');
      if (chrome.offscreen?await chrome.offscreen.hasDocument():typeof document!=='undefined'&&document.getElementById('wildl-export-frame')) await chrome.runtime.sendMessage({target: 'wildl-export',
        type: 'CONTROL', jobId:state.archiveId||jobId, paused: action === 'pause'});
      state.paused = action === 'pause';
      state.status = state.paused ? 'На паузе. Можно продолжить.' : `Продолжаю: ${state.done}/${state.total}`;
      await publish();
    }
    return state;
  }
  if(message.type==='NEW_TITLE'){
    if(state.running||state.inspecting)await stop();
    if(state.recovery)await discard(state.recovery.jobId);
    state.recovery=null;state.archiveId=null;state.cfg=null;state.title='';state.selectedBranch='';state.catalogue=null;
    await start({forceRefresh:true},true);return state;
  }
  if (message.type === 'START') { await start(message.cfg || {}); return state; }
  if (message.type === 'SAVE_PARTIAL') {await saveRecovered(message.format);return state;}
  if (message.type === 'STOP') { await stop(); return state; }
  if (message.source === 'wildl-page' && message.jobId === jobId && sender.tab?.id === tabId) {
    await handlePage(message);
    return message.type === 'chapter' && message.jobId !== jobId ? {ok: false, error: 'Остановлено'} : {ok: true};
  }
  return null;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if(['GET_MIRRORS','CHECK_MIRRORS','ENABLE_MIRROR','REMOVE_MIRROR','SET_MIRROR_AUTO'].includes(message.type)){
    if(sender.url!==chrome.runtime.getURL('popup.html')){respond({error:'Настройки зеркал доступны только из окна расширения.'});return;}
    (async()=>{
      if(message.type==='CHECK_MIRRORS')return checkMirrors(true);
      if(message.type==='ENABLE_MIRROR')return enableMirror(message.origin,message.siteId);
      if(message.type==='SET_MIRROR_AUTO')return setMirrorAuto(!!message.auto);
      if(message.type==='REMOVE_MIRROR'){const origin=mirrorOrigin(message.origin);await mirrorChange(saved=>({...saved,enabled:(saved.enabled||[]).filter(item=>item.origin!==origin)}));}
      return mirrorView();
    })().then(respond).catch(error=>respond({error:error.message}));return true;
  }
  if(message.type==='GET_STATE'&&restoringState){respond({...publicState(),restoreChecking:true,status:'Проверяю сохранённые файлы. Пожалуйста, подождите…'});return;}
  if(['GET_LIBRARY','SAVE_LIBRARY_SETTINGS','CLEAR_HISTORY','SHOW_DOWNLOAD'].includes(message.type)){
    (async()=>{if(message.type==='SAVE_LIBRARY_SETTINGS')await saveLibrarySettings(message.settings);
      if(message.type==='CLEAR_HISTORY')await changeHistory(()=>[]);
      if(message.type==='SHOW_DOWNLOAD'){const {history}=await getLibrary();if(!history.some(item=>item.id===message.id))throw new Error('Запись загрузки не найдена.');await chrome.downloads.show(message.id);}
      return await getLibrary();})().then(respond).catch(error=>respond({error:error.message}));return true;
  }
  if(['GET_UPDATES','CHECK_UPDATES'].includes(message.type)){
    (message.type==='CHECK_UPDATES'?checkForUpdates(!!message.force):getUpdateStatus()).then(respond).catch(()=>respond({error:'Проверка обновлений недоступна.'}));return true;
  }
  const reply=value=>respond(value===state?publicState():value);
  if (message.target === 'wildl-export' || ['STATE','UPDATE_STATUS','LIBRARY_CHANGED'].includes(message.type)) return;
  if (['IMAGE_PROGRESS','VIDEO_LOG','MEDIA_LOG'].includes(message.type)) {
    restored.then(async () => {
      if (message.jobId !== jobId || sender.url !== chrome.runtime.getURL('offscreen.html')) return;
      lastSeen = Date.now();
      if(message.type!=='IMAGE_PROGRESS')log(message.text);
      else{state.videoEta=message.videoEta||null;if(!state.paused)state.status=message.status;}
      await publish();
    }).then(() => respond({ok: true})).catch(() => respond({ok: false}));
    return true;
  }
  // Controls and heartbeat must not wait behind a paused image download.
  if (['PREPARE_RELOAD','NEW_TITLE','GET_STATE','INTERRUPTED'].includes(message.type) || (message.source === 'wildl-page' && message.type === 'chapter') ||
      (pendingChapter && ['PAUSE','RESUME','STOP','GET_STATE','INTERRUPTED'].includes(message.type)) ||
      (message.source === 'wildl-page' && message.type === 'heartbeat')) {
    dispatch(message, sender).then(reply).catch(async error => {
      if(message.source === 'wildl-page') {
        if(message.jobId === jobId) await fail(error);
        respond({ok:false,error:error.message});
      } else {await fail(error); reply(state);}
    });
    return true;
  }
  queue = queue.then(() => dispatch(message, sender)).then(reply).catch(async error => {
    if (message.source === 'wildl-page' && message.jobId !== jobId) {
      respond({ok: false, error: error.message}); return;
    }
    await fail(error); reply(state);
  });
  return true;
});
chrome.downloads.onChanged.addListener(delta => {
  if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
  queue = queue.then(async () => {
    await restored;
    const {wildlDownloads = {}} = await chrome.storage.session.get('wildlDownloads');
    const download = wildlDownloads[delta.id]; if (!download) return;
    const details=chrome.downloads.search?(await chrome.downloads.search({id:delta.id}))[0]:null;
    await finishHistory(delta.id,delta.state.current,{...(details?.filename?{filename:details.filename}:{}),...(details?.fileSize>=0?{bytes:details.fileSize}:{}),...(details?.error?{error:details.error}:{})});
    const url = download.url;
    await chrome.runtime.sendMessage({target: 'wildl-export', type: 'RELEASE', url}).catch(() => {});
    delete wildlDownloads[delta.id]; await chrome.storage.session.set({wildlDownloads});
    // A restarted worker has no polling promise; reconcile the persisted export.
    if(download.awaitCompletion){
      if(delta.state.current==='complete'&&!download.keepCheckpoint)await chrome.runtime.sendMessage({target:'wildl-export',type:'COMMIT',jobId:download.jobId}).catch(()=>{});
      if(state.archiveId===download.jobId&&state.saving){
        if(delta.state.current==='interrupted'){await fail(downloadFailure(details));return;}
        if(!download.keepCheckpoint){state.recovery=null;state.archiveId=null;state.cfg=null;}
        state.running=false;state.saving=false;jobId=null;
      }
    }
    const summary=download.summary||{};
    const status = delta.state.current === 'complete' ?
      (summary.skipped ? `Сохранено ${summary.done} из ${summary.total} ${summary.kind==='anime'?'серий':'глав'}. ${summary.partial?'Не скачано':'Пропущено'}: ${summary.skipped}.` : 'Файл сохранён.') :
      downloadFailure(details).message;
    if (!state.running && !state.inspecting && jobId === null) state.status = status;
    log(status); await publish();
  }).catch(() => {});
});

function interruptTab(id,reason){
  queue=queue.then(async()=>{await restored;if(tabId===id&&(state.running||state.inspecting)&&!state.saving)await fail(new Error(reason));}).catch(()=>{});
}
chrome.tabs.onRemoved?.addListener(id=>interruptTab(id,'Исходная вкладка закрыта. Откройте тайтл и продолжите загрузку.'));
chrome.tabs.onUpdated?.addListener((id,change)=>{
  if(change.discarded===true){interruptTab(id,'Браузер выгрузил исходную вкладку. Можно продолжить загрузку.');return;}
  if(change.status!=='complete')return;
  const expected=jobId;
  queue=queue.then(async()=>{await restored;if(tabId!==id||!expected||jobId!==expected||!state.running&&!state.inspecting||state.saving)return;
    const alive=await chrome.tabs.sendMessage(id,{type:'WILDL_PING',jobId:expected}).catch(()=>null);
    if(jobId===expected&&!alive?.ok)await fail(new Error('Связь с исходной страницей потеряна. Можно продолжить загрузку.'));
  }).catch(()=>{});
});
