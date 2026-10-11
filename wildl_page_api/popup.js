window.wildlBoot?.started();
const $ = id => document.getElementById(id);
const logEl = $('log');
let state = {}, pending = false, pendingType = '', branchSignature = '', formatKind = '', settingsSignature='';
let refreshing=false, connectionError='',rangeSlug='';
function requestState() {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Фоновый процесс не ответил за 12 секунд. Обновите расширение на browser://extensions.')),12000);
    Promise.resolve().then(()=>chrome.runtime.sendMessage({type:'GET_STATE'})).then(next=>{
      if(!next || typeof next!=='object')throw new Error('Фоновый процесс вернул пустой ответ. Обновите расширение на browser://extensions.');
      resolve(next);
    }).catch(reject).finally(()=>clearTimeout(timer));
  });
}
function acceptState(next) {
  connectionError='';window.wildlBoot?.connected();setState(next);
}
function availableCount(st) {
  const branch = (st.branches || []).find(item => item.id === st.selectedBranch);
  return st.selectedBranch ? branch?.count || 0 : st.chapterCount || st.total || 0;
}
function episodeRanges(episodes) {
  const seasons=new Map();
  for(const episode of episodes||[]) {
    const special=episode.episodeKind&&episode.episodeKind!=='default';
    const season=special?(episode.episodeKind==='recap'?'рекапы':episode.groupLabel||'спецвыпуски'):
      Number(episode.season)>=10000?'спецвыпуски':String(episode.season||1),number=String(episode.number);
    if(!seasons.has(season))seasons.set(season,new Set());
    seasons.get(season).add(Number.isFinite(Number(number))?String(Number(number)):number);
  }
  function ranges(values) {
    const sorted=[...values].sort((a,b)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))?Number(a)-Number(b):a.localeCompare(b,'ru',{numeric:true}));
    const result=[];let first,last;
    const flush=()=>{if(first!=null)result.push(first===last?first:first+'–'+last);};
    for(const value of sorted){
      if(last!=null&&Number.isInteger(Number(last))&&Number.isInteger(Number(value))&&Number(value)===Number(last)+1)last=value;
      else {flush();first=last=value;}
    }
    flush();return result.join(', ');
  }
  const groups=[...seasons].sort(([a],[b])=>{
    const regularA=Number.isFinite(Number(a)),regularB=Number.isFinite(Number(b));
    return regularA!==regularB?(regularA?-1:1):a.localeCompare(b,'ru',{numeric:true});
  });
  return groups.map(([season,values])=>(Number.isFinite(Number(season))?(groups.length>1?'сезон '+season+': ':''):season+': ')+ranges(values)).join('; ')||'нет';
}
function setState(st) {
  if (!st) return;
  state = st;
  const busy = !!(st.running || st.inspecting || st.qualityChecking || pending);
  const kind = st.kind || 'novel';
  const failed=/ошиб|прерван|отмен/i.test(st.status||'');
  const searching=st.inspecting || st.qualityChecking || (st.running && (st.starting || st.mode === '')) ||
    (pending && ['INSPECT','AUTO_INSPECT','START','CONTINUE'].includes(pendingType) && !st.running);
  const phase=connectionError?'error':st.saving?'saving':st.paused?'paused':searching?'inspect':st.running||pending?'working':failed?'error':st.recovery?'recover':
    st.done>0&&/сохран|передан/i.test(st.status||'')?'complete':'ready';
  document.body.dataset.phase=phase;
  document.body.dataset.loading=String(['working','inspect','saving'].includes(phase));
  $('phase').textContent=({saving:'Сборка',paused:'Пауза',inspect:'Поиск',working:'Загрузка',recover:'Продолжить',error:'Ошибка',complete:'Готово',ready:'Готово'})[phase];
  if (formatKind !== kind) {
    $('format').replaceChildren(...(kind === 'anime' ? [new Option('ZIP','zip')] : kind === 'manga' ? [new Option('CBZ', 'cbz'), new Option('ZIP', 'zip'),new Option('CBR','cbr')] :
      [new Option('EPUB', 'epub'), new Option('TXT', 'txt'),new Option('FB2','fb2'),new Option('PDF','pdf'),new Option('DOCX','docx')]));
    const previousFormat=st.running?st.format:st.recovery?.format;
    if(previousFormat&&[...$('format').options].some(option=>option.value===previousFormat))$('format').value=previousFormat;
    formatKind = kind;
  }
  const siteNames={AnimeLib:'Анимелиб',RanobeLib:'Ранобелиб',MangaLib:'Мангалиб',HentaiLib:'Хентайлиб',SlashLib:'Слешлиб'};
  $('siteLabel').textContent = st.siteName ? `Определен: ${siteNames[st.siteName]||st.siteName}` : 'Сайт не определен';
  $('kindLabel').textContent = kind === 'anime' ? 'АНИМЕ' : kind === 'manga' ? 'МАНГА' : 'КНИГА';
  $('startLabel').textContent = st.recovery ? 'Продолжить загрузку' : kind === 'anime' ? 'Скачать серии' : kind === 'manga' ? 'Скачать мангу' : 'Скачать книгу';
  if(st.slug&&st.slug!==rangeSlug){rangeSlug=st.slug;if(!st.cfg&&!st.recovery){$('from').value='1';$('to').value='';}}
  const signatureSettings=JSON.stringify([st.archiveId,st.cfg,st.checkedRange]);
  const savedSettings=st.cfg||st.checkedRange;
  if(savedSettings&&signatureSettings!==settingsSignature){
    for(const id of ['from','to','pause','concurrency','limitPause','quality','format'])if(savedSettings[id]!=null)$(id).value=String(savedSettings[id]);
    settingsSignature=signatureSettings;
  }
  const unit=kind==='anime'?'серий':'глав';
  $('fromLabel').textContent=kind==='anime'?'С серии':'С главы';$('toLabel').textContent=kind==='anime'?'По серию':'По главу';
  document.body.dataset.kind=kind;$('qualityField').hidden=kind!=='anime';$('videoHint').hidden=kind!=='anime';$('translatorLabel').textContent=kind==='anime'?'Озвучка / субтитры':'Переводчик';
  $('concurrencyField').hidden=kind==='anime';$('intervalLabel').textContent=kind==='anime'?'Между сериями, сек.':'Интервал, сек.';
  $('settingsHint').textContent=kind==='anime'?'Видео скачивается последовательно. Интервал — пауза между сериями, поиск озвучек он не замедляет. При лимите ждём указанное время или срок сервера.':
    'Больше потоков может ускорить загрузку, но повышает риск лимита. Интервал — пауза каждого потока между главами. Время ожидания сервера имеет приоритет.';
  $('qualityInfo').hidden=kind!=='anime';
  $('animeScan').hidden=kind!=='anime';$('scanHint').hidden=kind!=='anime';
  const canScan=kind==='anime'&&!!st.title&&!st.running&&!st.recovery&&!pending&&!connectionError;
  $('scanRange').disabled=!canScan;$('scanAll').disabled=!canScan;
  $('scanHint').textContent=st.availabilityDeferred?'Укажите номера серий выше. Проверим озвучки только в этом диапазоне.':
    st.checkedRange?`Озвучки проверены только для серий ${st.checkedRange.from}–${st.checkedRange.to||'до конца'}.`:
    'Можно проверить озвучки только для выбранного диапазона серий.';
  document.body.dataset.hasJob=String(!!(st.recovery||st.running||st.done));
  $('newTitle').hidden=!(st.recovery||st.running||st.done);$('newTitle').disabled=!!st.saving||pending;
  const branches = st.branches || [];
  const signature = JSON.stringify([st.slug, branches, st.chapterCount]);
  if (signature !== branchSignature) {
    const automatic = new Option(`${kind==='anime'?'Любая озвучка':'Любой перевод'} · ${st.chapterCount || 0} ${unit}`, '');
    const optionFor = branch => {
      const ranges=kind==='anime'&&branch.episodes?episodeRanges(branch.episodes):null;
      const label=kind==='anime'?(ranges!=null?
        `${branch.teamName||branch.name} (${ranges.includes(':')?'':'серии '}${ranges}) · ${branch.translationLabel||''} · ${branch.player||''}`:branch.name):
        `${branch.name} · ${branch.count} глав`;
      return new Option(label,branch.id);
    };
    const options = [];
    if(kind==='anime') {
      for(const [label,isSubtitle] of [['──── Озвучка ────',false],['──── Субтитры ────',true]]) {
        const items=branches.filter(branch=>(branch.translationType==='1'||branch.id.split(':')[1]==='1'||/субтитр/i.test(branch.translationLabel||''))===isSubtitle);
        if(items.length){const group=document.createElement('optgroup');group.label=label;group.append(...items.map(optionFor));options.push(group);}
      }
    } else options.push(...branches.map(optionFor));
    if (st.selectedBranch && !branches.some(branch => branch.id === st.selectedBranch))
      options.push(new Option('Выбранный на сайте перевод', st.selectedBranch));
    $('branch').replaceChildren(automatic, ...options);
    branchSignature = signature;
  }
  $('branch').value = st.selectedBranch || '';
  $('bookTitle').textContent = st.title || 'Откройте тайтл на сайте Lib';
  $('bookTitle').classList.toggle('is-placeholder', !st.title);
  document.body.dataset.hasTitle=String(!!st.title);
  $('found').textContent = st.qualityChecking?'Проверяю качество серий…':phase==='inspect' ? kind==='anime'?'Ищу список серий…':'Ищу список глав…' : `${availableCount(st).toLocaleString('ru-RU')} ${unit} в списке`;
  const selected=branches.find(item=>item.id===st.selectedBranch);
  const quality=selected?.qualitySummary;
  $('checkQuality').disabled=!!connectionError||pending||st.running||st.inspecting||st.qualityChecking||!!st.recovery||!selected;
  $('qualityHint').textContent=st.qualityChecking?'Проверяю разрешения выбранной озвучки…':quality?
    `Качество: ${quality.qualities.map(value=>value>=2160?'4K':value+'p').join(', ')||'не определено'}. `+
    (quality.uhdEpisodes.length?`4K — ${episodeRanges(quality.uhdEpisodes).includes(':')?'':'серии '}${episodeRanges(quality.uhdEpisodes)}.`:quality.unknown?'4K пока не подтверждено.':'4K не найдено.')+
    (quality.unknown?` Не проверено: ${quality.unknown} из ${quality.total}; наличие 4K у них неизвестно.`:''):
    selected?'Качество ещё не проверено.':'Выберите озвучку для проверки качества.';
  for(const height of quality?.qualities||[])if(![...$('quality').options].some(option=>Number(option.value)===height))$('quality').append(new Option(height>=2160?height===2160?'4K':height+'p':height+'p',String(height)));
  for(const option of $('quality').options){option.disabled=!!quality&&!quality.unknown&&!quality.qualities.includes(Number(option.value));}
  if(quality&&!quality.unknown&&quality.qualities.length&&!st.running&&!st.recovery&&$('quality').selectedOptions[0]?.disabled){
    const desired=Number($('quality').value),choices=[...$('quality').options].filter(option=>!option.disabled).map(option=>Number(option.value)).sort((a,b)=>b-a);
    if(choices.length)$('quality').value=String(choices.find(value=>value<=desired)||choices.at(-1));
  }
  const selectedRanges=selected?.episodes?episodeRanges(selected.episodes):null;
  $('branchHint').textContent = kind==='anime'?
    (selectedRanges!=null?`${selectedRanges.includes(':')?'Доступно':'Доступны серии'}: ${selectedRanges}.`:st.inspecting?'Проверяю доступные серии для каждой озвучки…':'Доступность озвучек проверяется по списку серий.'):
    st.selectedBranch ? 'Только главы выбранного переводчика.' : '«Любой перевод»: главы разных команд.';
  const total = st.total || 0, done = st.done || 0;
  const skipped=st.skipped||0;
  const percent = total ? Math.min(100, Math.round((done+skipped) * 100 / total)) : 0;
  $('count').textContent = st.qualityChecking?'Проверяю разрешения':phase==='inspect' ? kind==='anime'?'Определяю список серий':'Определяю список глав' : `${done.toLocaleString('ru-RU')} / ${total.toLocaleString('ru-RU')} ${unit}${skipped?' · пропущено '+skipped:''}`;
  $('percent').textContent = phase==='error' ? 'ERROR' : percent + '%';
  $('percent').hidden = phase==='inspect' || (phase==='working' && !total);
  const meterLabel=st.qualityChecking?'КАЧЕСТВО':({inspect:'ПОИСК',working:'ЗАГРУЗКА',saving:'СБОРКА',paused:'ПАУЗА'})[phase] || '';
  $('meterLabel').textContent=meterLabel;
  $('meterLabel').hidden=!meterLabel;
  $('bar').style.width = (phase==='inspect'?0:percent) + '%';
  document.body.style.setProperty('--progress',(phase==='inspect'?0:percent)+'%');
  if(phase==='error') {
    $('progressBar').removeAttribute('aria-valuenow');
    $('progressBar').setAttribute('aria-valuetext','Ошибка загрузки');
  } else if(phase==='inspect' || (phase==='working' && !total)) {
    $('progressBar').removeAttribute('aria-valuenow');
    $('progressBar').setAttribute('aria-valuetext',phase==='inspect'?'Поиск '+(kind==='anime'?'серий':'глав'):'Загрузка');
  } else {
    $('progressBar').setAttribute('aria-valuenow', percent);
    $('progressBar').removeAttribute('aria-valuetext');
  }
  $('status').textContent = connectionError ? 'Нет связи с фоновым процессом. Нажмите «Обновить» для проверки подключения.' : st.status || 'Готово к скачиванию.';
  document.body.dataset.paused = String(!!st.paused);
  $('start').disabled = !!connectionError || busy || (!st.recovery&&(!st.title||!availableCount(st)||st.availabilityDeferred));
  $('savePartial').hidden=!st.recovery?.done;
  $('savePartial').disabled=busy||!!connectionError;
  $('savePartial').textContent=st.recovery?`Сохранить скачанное (${st.recovery.done} ${unit})`:'Сохранить скачанное';
  $('pauseJob').disabled = !!connectionError || !st.running || !!st.saving || !!st.starting || pending;
  $('stop').disabled = !!connectionError || !(st.running || st.inspecting || st.qualityChecking) || !!st.saving || pending;
  $('refresh').disabled = false;
  $('refresh').classList.remove('is-busy');
  $('refreshLabel').textContent = 'Обновить';
  $('pauseLabel').textContent = st.paused ? 'Продолжить' : 'Пауза';
  $('pauseIcon').innerHTML = st.paused ? '<path d="m8 5 11 7-11 7Z"/>' : '<path d="M8 5v14M16 5v14"/>';
  for (const id of ['branch','from','to','format','pause','concurrency','limitPause','quality']) {
    const changeDuringScan=kind==='anime'&&(st.inspecting||st.qualityChecking)&&['from','to'].includes(id)&&!pending || st.qualityChecking&&id==='branch'&&!pending;
    $(id).disabled = !!connectionError || (busy&&!changeDuringScan) || (!!st.recovery&&id!=='format') || (id === 'branch' && !st.title);
  }
  logEl.textContent = (st.log || []).slice(-80).join('\n');
  if(!logEl.textContent && pending)logEl.textContent='Ожидаю подтверждение команды '+pendingType+' от фонового процесса…';
  if(connectionError)logEl.textContent+='\n'+connectionError;
  logEl.scrollTop = logEl.scrollHeight;
}
function showError(error) {
  document.body.dataset.phase='error';document.body.dataset.loading='false';$('phase').textContent='Ошибка';
  $('percent').textContent='ERROR';$('percent').hidden=false;$('meterLabel').hidden=true;
  $('progressBar').removeAttribute('aria-valuenow');
  $('progressBar').setAttribute('aria-valuetext','Ошибка расширения');
  $('status').textContent = 'Ошибка расширения';
  logEl.textContent += '\n' + (error.message || String(error));
}
async function send(message) {
  let failure;
  pending = true; pendingType = message.type;
  setState(state);
  try {
    const next = await chrome.runtime.sendMessage(message);
    if(next){connectionError='';window.wildlBoot?.connected();state=next;}
  } catch (error) { failure = error; }
  finally { pending = false; pendingType = ''; setState(state); if (failure) showError(failure); }
}
function config() {
  return {branchId: $('branch').value, from: $('from').value, to: $('to').value,
    pause: Math.max(0, Number($('pause').value) || 0), concurrency: Math.max(1, Math.min(6, Number($('concurrency').value) || 2)),
    limitPause: Math.max(30, Number($('limitPause').value) || 180),quality:Number($('quality').value)||720, format: $('format').value};
}
$('start').onclick = () => send(state.recovery?{type:'CONTINUE',format:$('format').value}:{type: 'START', cfg: config()});
$('newTitle').onclick=()=>send({type:'NEW_TITLE'});
$('scanRange').onclick=()=>send({type:'INSPECT',cfg:{...config(),scanRange:true}});
$('checkQuality').onclick=()=>send({type:'CHECK_QUALITY'});
$('scanAll').onclick=()=>{ $('from').value='1';$('to').value='';send({type:'INSPECT',cfg:{...config(),scanAll:true}}); };
$('refresh').onclick = () => {
  $('status').textContent='Перезапускаю расширение…';
  const prepared=Promise.resolve().then(()=>chrome.runtime.sendMessage({type:'PREPARE_RELOAD'})).catch(()=>{});
  Promise.race([prepared,new Promise(resolve=>setTimeout(resolve,1200))]).finally(()=>chrome.runtime.reload());
};
$('branch').onchange = () => send({type: 'SELECT_BRANCH', branchId: $('branch').value});
$('pauseJob').onclick = () => send({type: state.paused ? 'RESUME' : 'PAUSE'});
$('stop').onclick = () => send({type: 'STOP'});
$('savePartial').onclick = () => send({type:'SAVE_PARTIAL',format:$('format').value});
function renderUpdates(info){
  if(!info||typeof info.installedVersion!=='string')return;
  $('installedVersion').textContent='Версия '+info.installedVersion;
  $('updateBanner').hidden=!info.available;
  $('updateTitle').textContent=info.available?'Доступна версия '+info.latestVersion:'';
  // Only navigate to our own releases, even if cached data is malformed.
  let url='https://github.com/WildLIK/LibSaver/releases/latest';
  try{const candidate=new URL(info.releaseUrl);if(candidate.protocol==='https:'&&candidate.hostname==='github.com'&&!candidate.username&&!candidate.password&&candidate.pathname.startsWith('/WildLIK/LibSaver/releases/'))url=candidate.href;}catch{}
  $('updateDownload').href=url;
  $('updateStatus').textContent=info.error?'Проверка недоступна: '+info.error:
    info.available?'Новый выпуск готов. Скачайте его и замените файлы установленного расширения.':
    info.checkedAt?info.latestVersion?'Установлена актуальная версия. Проверяем новые выпуски раз в сутки.':'Пока нет опубликованных выпусков. Проверяем раз в сутки.':'Новые выпуски проверяются раз в сутки.';
}
let updateChecking=false;
async function refreshUpdates(force=false){
  if(updateChecking)return;
  updateChecking=true;$('checkUpdates').disabled=true;$('updateStatus').textContent='Проверяю GitHub Releases…';
  let timer;
  try{const result=await Promise.race([Promise.resolve().then(()=>chrome.runtime.sendMessage({type:'CHECK_UPDATES',force})),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Нет ответа от проверки обновлений.')),12000);})]);
    if(!result||typeof result.installedVersion!=='string')throw new Error('Проверка вернула пустой ответ.');renderUpdates(result);}
  catch{$('updateStatus').textContent='Проверка обновлений недоступна. Загрузки продолжают работать.';}
  finally{clearTimeout(timer);updateChecking=false;$('checkUpdates').disabled=false;}
}
$('checkUpdates').onclick=()=>refreshUpdates(true);
chrome.runtime.onMessage.addListener(message => { if (message.type === 'STATE' && message.state) acceptState(message.state);
  if(message.type==='UPDATE_STATUS')renderUpdates(message.update); });
async function refresh() {
  if (refreshing) return false;
  refreshing=true;
  try {
    const reconnecting=!!connectionError;
    acceptState(await requestState());
    if(reconnecting)inspectIfNeeded().catch(showError);
    return true;
  }
  catch(error){connectionError=error.message||String(error);setState(state);document.querySelector('.log-panel').open=true;return false;}
  finally{refreshing=false;}
}
async function inspectIfNeeded() {
  if (!pending && !state.running && !state.inspecting && !state.recovery) await send({type: 'AUTO_INSPECT'});
}
async function initialize() {
  if(await refresh())await inspectIfNeeded();
}
initialize();
refreshUpdates();
setInterval(refresh, 1000);
