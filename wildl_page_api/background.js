importScripts('sites.js', 'request-headers.js', 'page.js', 'video.js', 'updates.js');
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
});
async function publish() {
  if(state.catalogue!==persistedCatalogue){await chrome.storage.session.set({wildlCatalogue:state.catalogue});persistedCatalogue=state.catalogue;}
  const {catalogue,...sessionState}=state;
  await chrome.storage.session.set({wildl: {state:sessionState, jobId, tabId, lastSeen}});
  if(chrome.storage.local){const {catalogue,...checkpoint}=state;await chrome.storage.local.set({wildlCheckpoint:checkpoint});}
  chrome.runtime.sendMessage({type: 'STATE', state:publicState()}).catch(() => {});
}
function log(text) { state.log.push(text); if (state.log.length > 120) state.log.shift(); }
function isSite(url) {
  return !!getLibSite(url);
}
async function findTab(sourceUrl) {
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
  const tab = await findTab(resume?state.sourceUrl:null);
  if (!tab) throw new Error(resume?'Откройте исходный тайтл и нажмите «Продолжить загрузку».':'Откройте тайтл на RanobeLib, MangaLib, HentaiLib, SlashLib или AnimeLib.');
  if(!inspect&&!resume&&state.recovery)await discard(state.recovery.jobId);
  const site = getLibSite(tab.url);
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
    skipped:0,skippedChapters:[],plan:resume?previous.plan:[],format:cfg.format || (site.kind==='manga'?'cbz':site.kind==='anime'?'zip':'epub'),recovery,
    cfg:inspect?previous.cfg:{...cfg,catalogue:undefined},archiveId:resume?recovery.jobId:inspect?previous.archiveId:jobId,
    sourceUrl:resume||inspect&&sameBook?previous.sourceUrl:tab.url,catalogue:sameBook?previous.catalogue:null,
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
  state.starting = false;
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
      total:state.total,done:retained.indices.length,skipped,partial:true,error:error.message||String(error)};
    state.done = retained.indices.length;
    log(`Сохранено на диске ${state.done} ${state.kind==='anime'?'серий':'глав'}. Можно продолжить загрузку${state.done?' или сохранить скачанное':''}.`);
  } else if(wasRunning)await discard(archiveId);
  await clearImageRequestHeaders();
  await publish();
}
async function saveRecovered(format) {
  const recovery = state.recovery;
  if(!recovery || state.running || state.inspecting)return;
  const formats = recovery.kind==='manga'?['cbz','zip','cbr']:recovery.kind==='anime'?['zip']:['epub','txt','fb2','pdf','docx'];
  if(!recovery.done)return;
  const message = {...recovery,keepCheckpoint:true,format:formats.includes(format)?format:recovery.format};
  state.running=true;state.saving=true;state.status=recovery.kind==='anime'?'Собираю скачанные серии…':'Собираю скачанные главы...';await publish();
  try {
    await saveResult(message);
    state.done=recovery.done;state.total=recovery.total;
    state.skipped=recovery.skipped.length;state.skippedChapters=recovery.skipped;
    state.partial=true;state.summary={done:state.done,total:state.total,skipped:state.skipped,partial:true};
    state.status='Скачанные главы переданы браузеру для сохранения.';
  } catch(error) {state.status='Ошибка сохранения';log(error.message||String(error));}
  state.running=false;state.saving=false;await publish();
}
async function discard(id) {
  if(id){await ensureExporter();
    await chrome.runtime.sendMessage({target: 'wildl-export', type: 'DISCARD', jobId: id}).catch(() => {});}
}
async function ensureExporter() {
  if (exporterCreation) return exporterCreation;
  exporterCreation = (async () => {
    if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['BLOBS'],
      justification: 'Create and retain the TXT/EPUB/CBZ Blob until the browser finishes downloading it.'});
  })();
  try { await exporterCreation; } finally { exporterCreation = null; }
}
async function saveResult(message) {
  await ensureExporter();
  const file = await chrome.runtime.sendMessage({target: 'wildl-export', type: 'EXPORT', data: message});
  if (!file?.url) throw new Error(file?.error || 'Не удалось собрать файл.');
  let id;
  try { id = await chrome.downloads.download({url: file.url, filename: file.filename, saveAs: true}); }
  catch (error) {
    await chrome.runtime.sendMessage({target: 'wildl-export', type: 'RELEASE', url: file.url}); throw error;
  }
  const {wildlDownloads = {}} = await chrome.storage.session.get('wildlDownloads');
  wildlDownloads[id] = {url: file.url, jobId};
  wildlDownloads[id].summary={kind:message.kind,done:message.done??message.total,total:message.total,skipped:message.skipped?.length||0,partial:!!message.partial};
  await chrome.storage.session.set({wildlDownloads});
  if(!message.keepCheckpoint)await chrome.runtime.sendMessage({target:'wildl-export',type:'COMMIT',jobId:message.jobId});
  return id;
}
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
    } finally { pendingChapter--; }
  }
  if (message.type === 'error') { await fail(new Error(message.text)); return; }
  if (message.type === 'done') {
    state.done = message.done??message.total;state.skippedChapters=message.skipped||[];state.skipped=state.skippedChapters.length;
    state.summary={done:state.done,total:state.total,skipped:state.skipped,partial:false};
    state.paused = false; state.saving = true; state.status = 'Собираю файл...'; await publish();
    try {
      await clearImageRequestHeaders();
      const id = await saveResult({...message,jobId:state.archiveId||message.jobId});
      state.recovery=null;state.archiveId=null;state.cfg=null;
      state.status = 'Файл передан браузеру для сохранения.'; log('Загрузка файла создана: ' + id);
    } catch (error) { await fail(error); return; }
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
    if ((state.running || state.inspecting) && Date.now() - lastSeen > 90000)
      await fail(new Error(state.kind==='anime'?'Нет ответа от вкладки. Обновите страницу фильма / сериала и повторите запуск.':'Нет ответа от вкладки. Обновите страницу книги и повторите запуск.'));
    return state;
  }
  if (message.type === 'INSPECT') { if (!state.running&&!state.recovery) await start(message.cfg || {}, true); return state; }
  if (message.type === 'AUTO_INSPECT') {if(!state.running&&!state.inspecting&&!state.recovery){const tab=await findTab();const slug=tab&&new URL(tab.url).pathname.split('/').find(x=>/^\d+--/.test(x));if(!state.title||slug!==state.slug||getLibSite(tab?.url)?.id!==state.siteId||(state.kind==='anime'&&state.availabilityVersion!==3))await start({},true);}return state;}
  if(message.type==='CHECK_QUALITY'){checkQuality(true).catch(()=>{});return state;}
  if(message.type==='CONTINUE'){if(message.format&&state.cfg){const formats=state.kind==='manga'?['cbz','zip','cbr']:state.kind==='anime'?['zip']:['epub','txt','fb2','pdf','docx'];if(!formats.includes(message.format))throw new Error('Не поддерживается формат: '+message.format);state.cfg={...state.cfg,format:message.format};}await start({},false,true);return state;}
  if(message.type==='INTERRUPTED'&&message.jobId===jobId&&sender.tab?.id===tabId){await fail(new Error('Исходная вкладка закрыта или перезагружена. Можно продолжить.'));return state;}
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
      if (await chrome.offscreen.hasDocument()) await chrome.runtime.sendMessage({target: 'wildl-export',
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
  if(['GET_UPDATES','CHECK_UPDATES'].includes(message.type)){
    (message.type==='CHECK_UPDATES'?checkForUpdates(!!message.force):getUpdateStatus()).then(respond).catch(()=>respond({error:'Проверка обновлений недоступна.'}));return true;
  }
  const reply=value=>respond(value===state?publicState():value);
  if (message.target === 'wildl-export' || ['STATE','UPDATE_STATUS'].includes(message.type)) return;
  if (message.type === 'IMAGE_PROGRESS') {
    restored.then(async () => {
      if (message.jobId !== jobId || sender.url !== chrome.runtime.getURL('offscreen.html')) return;
      lastSeen = Date.now();
      if (!state.paused) state.status = message.status;
      await publish();
    }).then(() => respond({ok: true})).catch(() => respond({ok: false}));
    return true;
  }
  // Controls and heartbeat must not wait behind a paused image download.
  if (['PREPARE_RELOAD','NEW_TITLE'].includes(message.type) || (message.source === 'wildl-page' && message.type === 'chapter') ||
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
    const url = download.url;
    await chrome.runtime.sendMessage({target: 'wildl-export', type: 'RELEASE', url}).catch(() => {});
    delete wildlDownloads[delta.id]; await chrome.storage.session.set({wildlDownloads});
    const summary=download.summary||{};
    const status = delta.state.current === 'complete' ?
      (summary.skipped ? `Сохранено ${summary.done} из ${summary.total} ${summary.kind==='anime'?'серий':'глав'}. ${summary.partial?'Не скачано':'Пропущено'}: ${summary.skipped}.` : 'Файл сохранён.') :
      'Сохранение отменено или прервано.';
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
