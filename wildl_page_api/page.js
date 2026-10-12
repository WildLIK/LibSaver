// Self-contained: Chrome copies this function into the page.
function pageDownloader(jobId, cfg) {
  if (window.__wildlStop) window.__wildlStop();
  let stopped = false, paused = false;
  const controllers = new Set();
  const pendingChapters = new Map();
  const stop = () => {
    stopped = true;
    for (const controller of controllers) controller.abort();
    for (const waiter of pendingChapters.values()) waiter.reject(new Error('Остановлено'));
    pendingChapters.clear();
  };
  window.__wildlStop = stop;
  const onStop = event => {
    if (event.source !== window || event.data?.source !== 'wildl-ext' || event.data.jobId !== jobId) return;
    if (event.data.type === 'stop') stop();
    if (event.data.type === 'chapter-ack') {
      const waiter = pendingChapters.get(event.data.index);
      if (waiter) {
        pendingChapters.delete(event.data.index);
        if (event.data.ok) waiter.resolve();
        else waiter.reject(new Error(event.data.error || 'Не удалось сохранить главу.'));
      }
    }
    if (event.data.type === 'pause' || event.data.type === 'resume') {
      paused = event.data.type === 'pause';
      post('control', {paused});
    }
  };
  window.addEventListener('message', onStop);
  const post = (type, data = {}) => window.postMessage({source: 'wildl-page', jobId, type, ...data}, location.origin);
  const heartbeat = setInterval(() => post('heartbeat'), 15000);
  const checkpoint = async () => {
    while (paused && !stopped) await new Promise(resolve => setTimeout(resolve, 100));
    if (stopped) throw new Error('Остановлено');
  };
  const sleep = async ms => {
    let remaining = ms;
    while (remaining > 0) {
      await checkpoint();
      if (stopped) throw new Error('Остановлено');
      const started = Date.now();
      await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)));
      remaining -= Date.now() - started;
    }
    if (stopped) throw new Error('Остановлено');
  };
  // One paced queue for all API workers; media downloads have their own limits.
  const apiRate = Math.max(1, Math.min(120, Number(cfg.apiRate) || 60));
  let apiQueue = Promise.resolve();
  const waitApiSlot = () => {
    const slot = apiQueue.then(async () => {
      await checkpoint();
      for (;;) {
        const wait = Math.max(window.__wildlApiNextAt || 0, window.__wildlApiCooldownUntil || 0) - Date.now();
        if (wait <= 0) break;
        await sleep(Math.min(250, wait));
      }
      await checkpoint();
      window.__wildlApiNextAt = Date.now() + 60000 / apiRate;
    });
    apiQueue = slot.catch(() => {});
    return slot;
  };
  const api = 'https://api.cdnlibs.org/api';
  const siteId = Number(cfg.site?.id) || Number(document.documentElement.getAttribute('data-id')) || 3;
  const kind = cfg.site?.kind || (siteId === 3 ? 'novel' : siteId===5?'anime':'manga');
  const siteName = cfg.site?.name || ({1:'MangaLib',2:'SlashLib',3:'RanobeLib',4:'HentaiLib'}[siteId]);
  const sendChapter = (index, chapter) => new Promise((resolve, reject) => {
    pendingChapters.set(index, {resolve, reject});
    post('chapter', {index, chapter});
  });
  const branchKey = item => item.branch_id != null ? String(item.branch_id) :
    (item.teams?.length ? 'teams:' + item.teams.map(team => String(team.id)).sort().join(',') :
      item.user?.id ? 'user:' + item.user.id : 'default');
  function records(value, field) {
    if(value == null)return [];
    let items;
    if(Array.isArray(value))items=value;
    else if(typeof value==='object') {
      if('data' in value)return records(value.data,field);
      items=('id' in value || 'branch_id' in value)?[value]:Object.values(value);
    }
    if(!items || items.some(item=>item!=null&&(typeof item!=='object'||Array.isArray(item))))
      throw new Error('API вернул неизвестный формат поля «'+field+'». Обновите список глав.');
    return items.filter(item=>item!=null);
  }
  function compactChapter(chapter) {
    return {volume:chapter.volume,number:chapter.number,name:chapter.name,index:chapter.index,id:chapter.id,
      branches:records(chapter.branches,'branches').map(item=>({id:item.id,branch_id:item.branch_id,
        teams:records(item.teams,'teams').map(team=>({id:team.id,name:team.name})),
        user:item.user?{id:item.user.id,username:item.user.username}:null}))};
  }
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));
  async function fetchJson(url) {
    const retries = cfg.inspect?1:3, limitPause = Math.max(1, Number(cfg.limitPause) || 180);
    for (let attempt = 0;; attempt++) {
      await waitApiSlot();
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), cfg.inspect?12000:30000);
      let response, text;
      try {
        const headers = {Accept: 'application/json', 'Site-Id': String(siteId)};
        // Reuse the site's current session only for its own API. Tokens never
        // travel through extension messages or to image servers.
        if (url.startsWith(api + '/')) {
          try {
            const token = JSON.parse(localStorage.getItem('auth') || 'null')?.token?.access_token;
            if (typeof token === 'string' && token) headers.Authorization = 'Bearer ' + token;
          } catch {}
        }
        response = await fetch(url, {method: 'GET', credentials: 'include', signal: controller.signal,
          headers});
        text = await response.text();
      } catch (error) {
        if (stopped) throw new Error('Остановлено');
        if (attempt >= retries) throw new Error('API не ответил: ' + (error.message || error));
        post('log', {text: `API не ответил, повтор ${attempt + 1}/${retries}...`});
        post('progress',{status:`Нет ответа API. Повтор ${attempt+1}/${retries}…`});
        await sleep(800 * (attempt + 1));
        continue;
      } finally { clearTimeout(timeout); controllers.delete(controller); }
      await checkpoint();
      if (response.status === 429 || text.includes('Превышен лимит')) {
        const reset = Number(response.headers.get('X-Ratelimit-Reset'));
        const retry=response.headers.get('Retry-After');
        const retrySeconds=Number(retry)||Math.max(0,(Date.parse(retry)-Date.now())/1000);
        const wait = reset ? Math.max(5, reset - Math.floor(Date.now() / 1000)) : retrySeconds>0?Math.ceil(retrySeconds):limitPause;
        window.__wildlApiCooldownUntil = Math.max(window.__wildlApiCooldownUntil || 0, Date.now() + wait * 1000);
        post('log', {text: `Лимит API, жду ${wait} сек...`});
        post('progress',{status:`Лимит сайта: ожидание ${wait} сек. Можно остановить.`});
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}\n${text.slice(0,180)}`);
      try { return JSON.parse(text); }
      catch { throw new Error('API вернул не JSON: ' + text.slice(0,120)); }
    }
  }
  function renderNode(node) {
    if (!node) return '';
    if (node.type === 'text') {
      let text = escape(node.text);
      for (const mark of node.marks || []) {
        const tag = {bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code'}[mark.type];
        if (tag) text = `<${tag}>${text}</${tag}>`;
      }
      return text;
    }
    if (node.type === 'hardBreak') return '<br/>';
    if (node.type === 'horizontalRule') return '<hr/>';
    if (node.type === 'image') return '';
    const content = (node.content || []).map(renderNode).join('');
    const tag = {paragraph: 'p', blockquote: 'blockquote', bulletList: 'ul', orderedList: 'ol',
      listItem: 'li', codeBlock: 'pre'}[node.type];
    if (node.type === 'heading') {
      const level = Math.max(1, Math.min(6, Number(node.attrs?.level) || 2));
      return `<h${level}>${content}</h${level}>`;
    }
    return tag ? `<${tag}>${content}</${tag}>` : content || escape(node.text);
  }
  function chapterContent(data) {
    let html;
    if (typeof data?.content === 'string') html = data.content;
    else if (Array.isArray(data?.content)) html = data.content.map(renderNode).join('');
    else html = renderNode(data?.content);
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    // Serialize a safe subset as XML; legacy HTML becomes valid EPUB XHTML.
    const tags = new Set(['p','div','span','br','hr','strong','em','b','i','s','u',
      'blockquote','ul','ol','li','pre','code','h1','h2','h3','h4','h5','h6']);
    function serialize(node) {
      if (node.nodeType === 3) return escape(node.textContent);
      if (node.nodeType !== 1) return '';
      const tag = node.tagName.toLowerCase();
      if (['script','style','iframe','object','img'].includes(tag)) return '';
      const body = [...node.childNodes].map(serialize).join('');
      if (!tags.has(tag)) return body;
      return ['br','hr'].includes(tag) ? `<${tag}/>` : `<${tag}>${body}</${tag}>`;
    }
    const safeHtml = [...doc.body.childNodes].map(serialize).join('');
    for (const node of doc.querySelectorAll('script,style,iframe,object')) node.remove();
    for (const node of doc.querySelectorAll('br')) node.replaceWith('\n');
    for (const node of doc.querySelectorAll('p,div,li,blockquote,h1,h2,h3,h4,h5,h6,pre')) node.append('\n\n');
    const text = doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('API вернул пустой текст главы. Проверьте доступ к главе на сайте.');
    return {html: safeHtml, text};
  }
  async function runAnime() {
    const url=new URL(location.href),slug=url.pathname.split('/').find(segment=>/^\d+--/.test(segment));
    if(!slug)throw new Error('Откройте тайтл AnimeLib.');
    post('log',{text:'Получаю тайтл и список серий AnimeLib...'});
    let catalogue=cfg.catalogue||window.__wildlAnimeCatalogue;
    if(cfg.forceRefresh||catalogue?.slug!==slug||catalogue?.siteId!==5||Date.now()-catalogue.at>300000)catalogue=null;
    if(!catalogue){
      const [meta,list]=await Promise.all([fetchJson(`${api}/anime/${slug}`),fetchJson(`${api}/episodes?anime_id=${encodeURIComponent(slug)}`)]);
      const raw=list.data;if(!Array.isArray(raw))throw new Error('Неизвестный формат списка серий AnimeLib.');
      catalogue={slug,siteId:5,at:Date.now(),book:meta.data||{},raw};window.__wildlAnimeCatalogue=catalogue;
    }
    const {book,raw,sample}=catalogue,title=book.rus_name||book.name||slug;
    const playerKey=player=>[player.team?.id,player.translation_type?.id,player.player].join(':');
    const from=cfg.from==null||cfg.from===''?1:Number(cfg.from),to=cfg.to==null||cfg.to===''?Infinity:Number(cfg.to);
    if(!Number.isFinite(from)||Number.isNaN(to)||from>to)throw new Error('Неверный диапазон серий.');
    const scanRows=cfg.scanRange?raw.filter(item=>Number(item.number)>=from&&Number(item.number)<=to):raw;
    const scope=cfg.scanRange?scanRows.map(item=>String(item.id)).join(','):'all';
    // Large titles first load only the episode index; scanning is an explicit action.
    const deferred=cfg.inspect&&raw.length>100&&!cfg.scanRange&&!cfg.scanAll&&
      (!catalogue.voiceAvailability||catalogue.voiceAvailabilityVersion!==3);
    if(cfg.inspect&&!deferred&&(!catalogue.voiceAvailability||catalogue.voiceAvailabilityVersion!==3||catalogue.voiceScope!==scope)) {
      if(!scanRows.length)throw new Error('В выбранном диапазоне нет серий.');
      const providers=new Map(),voices=new Map(),voicePlayers=new Map();let next=0,checked=0;
      post('availabilityProgress',{title,chapterCount:scanRows.length,status:`Проверяю доступные озвучки: 0/${scanRows.length}`});
      async function scan() {
        while(next<scanRows.length) {
          const row=scanRows[next++];await checkpoint();
          const episode=String(row.id)===String(sample?.id)?sample:(await fetchJson(`${api}/episodes/${row.id}`)).data;
          if(String(episode?.id)!==String(row.id))throw new Error('API вернул другую серию при проверке озвучек.');
          if(!catalogue.sample||String(row.id)===url.searchParams.get('episode'))catalogue.sample=episode;
          const players=records(episode.players,'players');
          for(const player of players) {
            const id=playerKey(player),voice=[player.team?.id,player.translation_type?.id].join(':');
            if(!providers.has(id))providers.set(id,{id,voice,name:`${player.team?.name||'Без команды'} · ${player.translation_type?.label||''} · ${player.player}`,
              teamName:player.team?.name||'Без команды',translationType:String(player.translation_type?.id||''),translationLabel:player.translation_type?.label||'',player:player.player});
            if(!voices.has(voice))voices.set(voice,new Map());
            voices.get(voice).set(String(row.id),{season:String(row.season||1),number:String(row.number),
              episodeKind:row.status?.id||episode.status?.id||'default',groupLabel:row.status?.label||episode.status?.label||''});
            if(!voicePlayers.has(voice))voicePlayers.set(voice,new Map());
            voicePlayers.get(voice).set(String(row.id),players.filter(item=>[item.team?.id,item.translation_type?.id].join(':')===voice)
              .map(item=>({player:item.player,src:item.src,quality:records(item.video?.quality,'video.quality')})));
          }
          checked++;
          post('availabilityProgress',{title,chapterCount:scanRows.length,status:`Проверяю доступные озвучки: ${checked}/${scanRows.length}`});
        }
      }
      try{await Promise.all([scan(),scan()]);}catch(error){stop();throw error;}
      catalogue.qualitySources={};
      catalogue.voiceAvailability=[...providers.values()].map(({voice,...provider})=>{
        const episodes=[...voices.get(voice).values()];return {...provider,count:episodes.length,episodes};
      }).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ru'));
      for(const provider of providers.values())catalogue.qualitySources[provider.id]=[...voices.get(provider.voice)].map(([id,episode])=>{
        const choices=voicePlayers.get(provider.voice).get(id);
        return {episode,player:choices.find(item=>item.player===provider.player)||choices.find(item=>item.player==='Kodik')};
      });
      catalogue.voiceAvailabilityVersion=3;
      catalogue.voiceScope=scope;
      catalogue.checkedRange=cfg.scanRange?{from:String(from),to:Number.isFinite(to)?String(to):''}:null;
    }
    const branches=catalogue.voiceAvailability||[];
    const queryKey=[url.searchParams.get('team'),url.searchParams.get('translation_type'),url.searchParams.get('player')].join(':');
    const firstKey=records(catalogue.sample?.players,'players')[0];
    const branch=cfg.branchId??(branches.some(item=>item.id===queryKey)?queryKey:firstKey?playerKey(firstKey):branches[0]?.id||'');
    const chapterCount=catalogue.checkedRange?raw.filter(item=>Number(item.number)>=Number(catalogue.checkedRange.from)&&Number(item.number)<=(catalogue.checkedRange.to===''?Infinity:Number(catalogue.checkedRange.to))).length:raw.length;
    const selection={title,slug,kind,siteId,siteName,branches,selectedBranch:branch,chapterCount,catalogue,
      catalogueCount:raw.length,checkedRange:catalogue.checkedRange||null,availabilityDeferred:deferred,
      availabilityChecked:!!catalogue.voiceAvailability,availabilityVersion:3,mode:'ANIME API'};
    if(cfg.inspect){post('preview',{...selection,total:chapterCount});return;}
    const sorted=[...raw].sort((a,b)=>Number(a.season)-Number(b.season)||Number(a.number)-Number(b.number));
    const picked=cfg.resumePlan?.length?cfg.resumePlan:sorted.filter(item=>Number(item.number)>=from&&Number(item.number)<=to)
      .map((item,index)=>({index,volume:String(item.season||1),number:String(item.number),name:item.name||'',sourceId:item.id}));
    if(!picked.length)throw new Error('В выбранном диапазоне нет серий.');
    post('meta',{...selection,total:picked.length,plan:picked});
    const completed=new Set(cfg.completedIndices||[]),skipped=[];let done=completed.size;
    const available=new Map();let checked=0,nextEpisode=0;
    async function checkVoices() {
      while(nextEpisode<picked.length) {
        const index=nextEpisode++,chapter=picked[index];await checkpoint();
        if(completed.has(index)){checked++;continue;}
        post('progress',{done,total:picked.length,status:`Проверяю озвучку: ${checked+1}/${picked.length} · Серия ${chapter.number}`});
        const episode=(await fetchJson(`${api}/episodes/${chapter.sourceId}`)).data;
        if(String(episode?.id)!==String(chapter.sourceId))throw new Error('API вернул другую серию.');
        const players=records(episode.players,'players');
        const sameVoice=item=>branch&&[item.team?.id,item.translation_type?.id].join(':')===branch.split(':').slice(0,2).join(':');
        const exact=players.find(item=>!branch||playerKey(item)===branch);
        const alternate=players.find(item=>sameVoice(item)&&item.player==='Kodik');
        const player=exact||alternate;
        if(player){available.set(index,{player,alternate:exact&&exact.player!=='Kodik'?alternate:null});
          if(!exact)post('log',{text:`Серия ${chapter.number}: плеер недоступен, использую ту же озвучку через Kodik.`});}
        else {const item={...chapter,index,reason:'Нет выбранной озвучки или субтитров этой серии.'};skipped.push(item);
          post('skipped',{chapter:item,status:'Нет выбранной озвучки · Серия '+chapter.number,done,total:picked.length});}
        checked++;
      }
    }
    try{await Promise.all([checkVoices(),checkVoices()]);}catch(error){stop();throw error;}
    post('log',{text:`Проверка озвучки завершена: доступно ${available.size+completed.size} из ${picked.length} серий, отсутствует ${skipped.length}.`});
    for(let index=0;index<picked.length;index++){
      await checkpoint();if(completed.has(index))continue;
      const chapter=picked[index],choice=available.get(index);if(!choice)continue;
      const {player,alternate}=choice;
      post('progress',{done,total:picked.length,status:`Получаю видео · Серия ${chapter.number} · ${player.player}`});
      let videoPlayer=player;
      const qualities=records(player.video?.quality,'video.quality');
      if(qualities.some(choice=>choice.href)){
        if(!catalogue.videoServers)catalogue.videoServers=(await fetchJson(`${api}/constants?fields[]=videoServers`)).data?.videoServers||[];
        const server=catalogue.videoServers.find(item=>item.id===player.video_domain)||catalogue.videoServers.find(item=>item.id==='main');
        if(!server?.url)throw new Error('Не найден сервер видео AnimeLib.');
        videoPlayer={...player,video:{...player.video,quality:qualities.map(choice=>({...choice,src:choice.src||choice.url||
          (/^(?:https:)?\/\//.test(choice.href)?new URL(choice.href,server.url).href:server.url.replace(/\/+$/,'')+'/'+String(choice.href).replace(/^\/+/,''))}))}};
      } else if(player.video)videoPlayer={...player,video:{...player.video,quality:qualities}};
      await sendChapter(index,{...chapter,kind,videoPlayer,fallbackPlayer:alternate,quality:cfg.quality??'max',limitPause:cfg.limitPause,videoConcurrency:cfg.videoConcurrency??4,videoRanges:cfg.videoRanges!==false,videoContainer:cfg.videoContainer||'mp4',outputFormat:cfg.format||'files'});
      await checkpoint();done++;post('progress',{done,total:picked.length,status:`Скачано серий: ${done}/${picked.length}`});
      if(Number(cfg.pause)>0)await sleep(Number(cfg.pause)*1000);
    }
    if(!done)throw new Error('Нет доступных серий выбранной озвучки.');
    post('done',{title,slug,kind,total:picked.length,done,skipped:skipped.sort((a,b)=>a.index-b.index),format:cfg.format||'files',videoContainer:cfg.videoContainer||'mp4'});
  }
  async function run() {
    if(kind==='anime')return runAnime();
    const url = new URL(location.href);
    const slug = url.pathname.split('/').filter(Boolean).find(segment => /^\d+--/.test(segment));
    if (!slug) throw new Error('Откройте страницу тайтла или главы ' + siteName + '.');
    const requestedBranch = cfg.branchId == null ? url.searchParams.get('bid') : String(cfg.branchId);
    const branch = requestedBranch || null;
    post('log', {text: 'Загрузчик запущен. Получаю список глав через API...'});
    let catalogue=cfg.catalogue||window.__wildlCatalogue;
    if(cfg.forceRefresh||catalogue?.slug!==slug||catalogue?.siteId!==siteId||Date.now()-catalogue.at>300000)catalogue=null;
    if(!catalogue){
      const metadataFields=kind==='manga'?'&fields[]=summary&fields[]=authors&fields[]=artists&fields[]=genres&fields[]=publisher':'';
      const [bookResponse,listResponse]=await Promise.all([
        fetchJson(`${api}/manga/${slug}?fields[]=eng_name&fields[]=chap_count${metadataFields}`),fetchJson(`${api}/manga/${slug}/chapters`)]);
      catalogue={slug,siteId,at:Date.now(),book:bookResponse.data||{},raw:Array.isArray(listResponse.data)?listResponse.data.map(compactChapter):listResponse.data};
      window.__wildlCatalogue=catalogue;
    }else post('log',{text:'Использую сохранённый список глав. «Обновить» запрашивает новый.'});
    const {book}=catalogue;
    const raw=Array.isArray(catalogue.raw)?catalogue.raw.map(compactChapter):catalogue.raw;
    catalogue.raw=raw;
    if (!Array.isArray(raw)) throw new Error('API вернул неизвестный формат списка глав.');
    const branchMap = new Map();
    for (const chapter of raw) {
      const seen = new Set();
      for (const item of chapter.branches || []) {
        const id = branchKey(item);
        if (seen.has(id)) continue;
        seen.add(id);
        const name = (item.teams || []).map(team => team.name).filter(Boolean).join(' + ') ||
          item.user?.username || `Перевод ${id}`;
        if (!branchMap.has(id)) branchMap.set(id, {id, name, count: 0});
        branchMap.get(id).count++;
      }
    }
    const branches = [...branchMap.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
    const chapters = raw.filter(chapter => !branch ||
      (chapter.branches || []).some(item => branchKey(item) === branch))
      .map(chapter => {
        const translation = (chapter.branches || []).find(item => !branch || branchKey(item) === branch);
        return {volume: String(chapter.volume ?? 1), number: String(chapter.number),
        name: chapter.name || '', index: Number(chapter.index),
        branch: translation?.branch_id ?? null, sourceId: translation?.id ?? chapter.id};
      });
    chapters.sort((a,b) => Number(a.volume) - Number(b.volume) || Number(a.number) - Number(b.number) || a.index - b.index);
    const title = book.rus_name || book.name || slug;
    const names = value => (Array.isArray(value) ? value : []).map(item => typeof item === 'string' ? item : item?.rus_name || item?.name).filter(Boolean);
    const description = new DOMParser().parseFromString(typeof book.summary === 'string' ? book.summary : '', 'text/html');
    for (const node of description.querySelectorAll('script,style')) node.remove();
    const bookInfo = {summary:description.body.textContent.trim(),writers:names(book.authors),artists:names(book.artists),
      genres:names(book.genres),publishers:names(Array.isArray(book.publisher)?book.publisher:book.publisher?[book.publisher]:[]),sourceUrl:location.origin+url.pathname};
    const selection = {catalogue,bookInfo,branches, selectedBranch: branch || '', chapterCount: raw.length, slug, kind, siteName, siteId};
    if (cfg.inspect) { post('preview', {title, total: chapters.length, ...selection, mode: 'PAGE API'}); return; }
    const from = cfg.from === '' || cfg.from == null ? 1 : Number(cfg.from);
    const to = cfg.to === '' || cfg.to == null ? Infinity : Number(cfg.to);
    if (!Number.isFinite(from) || Number.isNaN(to) || from > to) throw new Error('Неверный диапазон глав.');
    const picked = cfg.resumePlan?.length ? cfg.resumePlan : chapters.filter(chapter => Number(chapter.number) >= from && Number(chapter.number) <= to);
    if (!picked.length) throw new Error('В выбранном диапазоне нет глав' + (branch ? ' этой ветки перевода.' : '.'));
    let imageServers = [];
    if (kind === 'manga') {
      const constants = (await fetchJson(`${api}/constants?fields[]=imageServers`)).data;
      imageServers = (constants?.imageServers || []).filter(server =>
        (server.site_ids || []).map(Number).includes(siteId) && ['main','secondary','compress','download'].includes(server.id) && server.url)
        .sort((a,b)=>cfg.imageMode==='server'?Number(b.id==='compress')-Number(a.id==='compress'):0)
        .map(server => server.url.replace(/\/$/, ''));
      imageServers = [...new Set(imageServers)];
      if (!imageServers.length) throw new Error('Не найден сервер изображений этого сайта.');
    }
    const plan = picked.map((chapter,index) => ({...chapter,index}));
    post('meta', {title, total: picked.length, plan, ...selection, mode: 'PAGE API'});
    const completed=new Set(cfg.completedIndices||[]);
    let done = completed.size, next = 0;
    const skipped = [];
    async function worker() {
      while (!stopped) {
        await checkpoint();
        if (next >= picked.length) break;
        const index = next++, chapter = picked[index];
        if(completed.has(index))continue;
        post('progress', {done, total: picked.length, status: `Скачиваю: Том ${chapter.volume} Глава ${chapter.number}`});
        const params = new URLSearchParams({number: chapter.number, volume: chapter.volume});
        if(kind==='manga'&&cfg.imageMode==='server')params.set('server','compress');
        if (chapter.branch) params.set('branch_id', chapter.branch);
        const data = (await fetchJson(`${api}/manga/${slug}/chapter?${params}`)).data;
        if (branch && data?.id != null && chapter.sourceId != null && String(data.id) !== String(chapter.sourceId))
          throw new Error(`Том ${chapter.volume} Глава ${chapter.number}: сайт вернул другой перевод. Обновите список переводчиков.`);
        if (data?.restricted_view?.is_open === false || data?.restricted_view?.is_open === 0) {
          const item = {index,volume:chapter.volume,number:chapter.number,reason:'Глава закрыта на сайте: нет доступа к содержимому.'};
          skipped.push(item);
          post('skipped', {chapter:item,done,total:picked.length,skipped:skipped.length,
            status:`Пропущена закрытая глава: Том ${chapter.volume} Глава ${chapter.number}`});
          continue;
        }
        let content;
        if (kind === 'manga') {
          if (!Array.isArray(data?.pages) || !data.pages.length)
            throw new Error(`Том ${chapter.volume} Глава ${chapter.number}: API не вернул страницы главы без признака ограничения доступа.`);
          const pages = [...data.pages].sort((a,b) => Number(a.slug) - Number(b.slug)).map(page => {
            const path = String(page.url || '');
            const absolute = /^https:\/\//i.test(path) || /^\/\/(?!manga\/)[^/]+\.[^/]+\//i.test(path);
            const urls = absolute ? [path.startsWith('//') ? 'https:' + path : path] :
              imageServers.map(server => server + '/' + path.replace(/^\/+/, ''));
            if (!path) throw new Error('Не найден адрес страницы манги.');
            return {urls, number: page.slug};
          });
          content = {kind, pages, limitPause: Number(cfg.limitPause) || 180,imageConcurrency:Math.max(1,Math.min(6,Number(cfg.imageConcurrency)||3)),imageMode:cfg.imageMode==='webp'?'webp':'original',imageFormat:cfg.imageFormat||'jpg'};
        } else content = {kind, ...chapterContent(data)};
        await sendChapter(index, {...chapter, name: data?.name || chapter.name, ...content});
        await checkpoint();
        done++;
        post('progress', {done, total: picked.length, skipped:skipped.length,status: `Скачано: ${done}/${picked.length}${skipped.length ? ' · пропущено ' + skipped.length : ''}`});
        if (Number(cfg.pause) > 0) await sleep(Number(cfg.pause) * 1000);
      }
    }
    try { await Promise.all(Array.from({length: Math.max(1, Math.min(6, Number(cfg.concurrency) || 2))}, worker)); }
    catch (error) { stop(); throw error; }
    if (stopped) throw new Error('Остановлено');
    if (!done) throw new Error('Нет доступных глав в выбранном диапазоне. Все главы закрыты на сайте.');
    post('done', {title, slug, total: picked.length, done, skipped:skipped.sort((a,b)=>a.index-b.index),
      kind, format: cfg.format || (kind === 'manga' ? 'cbz' : 'epub')});
  }
  run().catch(error => post('error', {text: error?.message || String(error)})).finally(() => {
    clearInterval(heartbeat);
    window.removeEventListener('message', onStop);
    if (window.__wildlStop === stop) delete window.__wildlStop;
  });
  return {started: true, jobId};
}
