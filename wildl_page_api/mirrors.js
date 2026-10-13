// Telegram supplies suggestions, never executable code or silent host grants.
const MIRROR_KEY='wildlMirrors',MIRROR_ALARM='wildl-mirror-check';
const MIRROR_CHANNELS=['mangalib_social','slashlibme'];
const MIRROR_INTERVAL=24*60*60*1000;
let mirrorChecking=null,mirrorQueue=Promise.resolve();
const mirrorReady=loadMirrors();
async function loadMirrors(){
  if(!chrome.storage?.local)return {};
  const saved=(await chrome.storage.local.get(MIRROR_KEY))[MIRROR_KEY]||{};
  customLibMirrors=(saved.enabled||[]).filter(item=>{try{return mirrorOrigin(item.origin)===item.origin&&LIB_SITES.some(site=>site.id===item.siteId);}catch{return false;}});
  return saved;
}
function mirrorChange(transform){const task=mirrorQueue.then(async()=>{const saved=await loadMirrors();const next=transform(saved);await chrome.storage.local.set({[MIRROR_KEY]:next});await loadMirrors();return next;});mirrorQueue=task.catch(()=>{});return task;}
async function mirrorView(){const saved=await loadMirrors();return {sites:LIB_SITES,enabled:customLibMirrors,suggestions:saved.suggestions||[],auto:!!saved.auto,checkedAt:saved.checkedAt||0,error:saved.error||'',channels:MIRROR_CHANNELS};}
function mirrorDecode(text){return text.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:x([a-f0-9]+)|(\d+));/gi,(_,hex,dec)=>{const value=parseInt(hex||dec,hex?16:10);return value<=0x10ffff?String.fromCodePoint(value):'';});}
function telegramMirrors(html,channel){
  if(!MIRROR_CHANNELS.includes(channel))return [];
  const found=[];
  for(const chunk of html.split(/(?=data-post=")/).slice(1)){
    const post=chunk.match(/^data-post="([a-z0-9_]+\/\d+)"/i)?.[1];if(!post||!post.startsWith(channel+'/'))continue;
    const body=chunk.match(/<div\b[^>]*class="[^"]*tgme_widget_message_text[^\"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
    if(!body||!/зеркал|\bmirrors?\b/i.test(body.replace(/<[^>]*>/g,' ')))continue;
    for(const match of body.matchAll(/href="(https:\/\/[^"<>]+)"/gi)){try{
      const origin=mirrorOrigin(mirrorDecode(match[1])),host=new URL(origin).hostname;
      if(/(?:^|\.)(?:t\.me|telegram\.org|vk\.com|youtube\.com|lib\.social|github\.com)$/.test(host))continue;
      const site=getLibSite(origin),suggestion={origin,siteId:site?.id||null,source:'https://t.me/'+post};
      if(!found.some(item=>item.origin===origin))found.push(suggestion);
    }catch{}}
  }
  return found.slice(-40);
}
async function checkMirrors(force=false){
  if(mirrorChecking)return mirrorChecking;
  mirrorChecking=(async()=>{
    const saved=await loadMirrors(),now=Date.now();
    if(saved.lastAttemptAt&&now-saved.lastAttemptAt<(force?60000:MIRROR_INTERVAL))return mirrorView();
    if(!await chrome.permissions.contains({origins:['https://t.me/*']}))throw new Error('Разрешите чтение публичных каналов Telegram кнопкой «Проверить зеркала».');
    await mirrorChange(value=>({...value,lastAttemptAt:now}));
    const results=await Promise.allSettled(MIRROR_CHANNELS.map(async channel=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try{
        const response=await fetch('https://t.me/s/'+channel,{credentials:'omit',cache:'no-store',signal:controller.signal});
        if(!response.ok||new URL(response.url||'https://t.me').hostname!=='t.me')throw new Error(channel+': HTTP '+response.status);
        const reader=response.body.getReader(),parts=[];let bytes=0;
        for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1048576){await reader.cancel();throw new Error('Страница Telegram слишком большая.');}parts.push(part.value);}
        const all=new Uint8Array(bytes);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
        const html=new TextDecoder().decode(all);if(!/tgme_widget_message/.test(html))throw new Error(channel+': публичная лента недоступна.');
        return telegramMirrors(html,channel);
      }finally{clearTimeout(timer);}
    }));
    const successes=results.filter(item=>item.status==='fulfilled'),fresh=successes.flatMap(item=>item.value);
    const errors=results.filter(item=>item.status==='rejected').map(item=>item.reason.message||String(item.reason));
    await mirrorChange(value=>{const suggestions=new Map((value.suggestions||[]).map(item=>[item.origin,item]));for(const item of fresh)suggestions.set(item.origin,item);
      return {...value,suggestions:[...suggestions.values()].slice(-60),checkedAt:successes.length?now:value.checkedAt||0,error:errors.join('; ')};});
    return mirrorView();
  })();try{return await mirrorChecking;}finally{mirrorChecking=null;}
}
async function enableMirror(origin,siteId){
  origin=mirrorOrigin(origin);siteId=Number(siteId);if(!LIB_SITES.some(site=>site.id===siteId))throw new Error('Выберите сайт группы Lib.');
  const builtIn=LIB_SITES.find(site=>site.domains.some(domain=>new URL(origin).hostname===domain||new URL(origin).hostname.endsWith('.'+domain)));
  if(builtIn&&builtIn.id!==siteId)throw new Error('Этот адрес относится к '+builtIn.name+'.');
  if(!await chrome.permissions.contains({origins:[origin+'/*']}))throw new Error('Браузер не разрешил доступ к зеркалу.');
  await mirrorChange(saved=>({...saved,enabled:[...(saved.enabled||[]).filter(item=>item.origin!==origin),{origin,siteId}].slice(-60)}));return mirrorView();
}
async function setMirrorAuto(auto){
  if(auto&&!await chrome.permissions.contains({origins:['https://t.me/*']}))throw new Error('Нет разрешения Telegram.');
  await mirrorChange(saved=>({...saved,auto:!!auto}));
  if(auto)await chrome.alarms.create(MIRROR_ALARM,{periodInMinutes:1440,delayInMinutes:1440});else await chrome.alarms.clear(MIRROR_ALARM);
  return mirrorView();
}
if(chrome.alarms){
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===MIRROR_ALARM)mirrorReady.then(async()=>{if((await loadMirrors()).auto)await checkMirrors();}).catch(()=>{});});
  const startMirrors=()=>mirrorReady.then(async()=>{if((await loadMirrors()).auto){await chrome.alarms.create(MIRROR_ALARM,{periodInMinutes:1440,delayInMinutes:1440});await checkMirrors();}}).catch(()=>{});
  chrome.runtime.onStartup?.addListener(startMirrors);startMirrors();
}
