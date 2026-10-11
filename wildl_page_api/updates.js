const UPDATE_REPOSITORY='https://github.com/WildLIK/LibSaver';
const UPDATE_API='https://api.github.com/repos/WildLIK/LibSaver/releases/latest';
const UPDATE_INTERVAL=24*60*60*1000;
const UPDATE_ALARM='wildl-release-check';
let updateRequest=null;
function updateVersion(value){
  const version=String(value||'').replace(/^v/, '');
  return /^\d+(?:\.\d+){0,3}$/.test(version)&&version.split('.').every(part=>Number(part)<=65535)?version:'';
}
function newerUpdate(candidate,current){
  if(!updateVersion(candidate)||!updateVersion(current))return false;
  const left=updateVersion(candidate).split('.').map(Number),right=updateVersion(current).split('.').map(Number);
  for(let i=0;i<4;i++){if((left[i]||0)!==(right[i]||0))return (left[i]||0)>(right[i]||0);}
  return false;
}
function updateView(saved={}){
  const installedVersion=chrome.runtime.getManifest().version;
  const latestVersion=updateVersion(saved.latestVersion);
  const tag=updateVersion(saved.releaseTag)===latestVersion&&latestVersion?saved.releaseTag:'';
  return {installedVersion,latestVersion,available:!!tag&&newerUpdate(latestVersion,installedVersion),
    releaseUrl:tag?`${UPDATE_REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`:`${UPDATE_REPOSITORY}/releases/latest`,
    checkedAt:saved.checkedAt||0,lastAttemptAt:saved.lastAttemptAt||0,error:saved.error||''};
}
async function getUpdateStatus(){return updateView((await chrome.storage.local.get('wildlUpdates')).wildlUpdates);}
async function checkForUpdates(force=false){
  if(updateRequest)return updateRequest;
  updateRequest=(async()=>{
    const saved=(await chrome.storage.local.get('wildlUpdates')).wildlUpdates||{},now=Date.now();
    if(saved.lastAttemptAt&&now-saved.lastAttemptAt<(force?60000:UPDATE_INTERVAL))return updateView(saved);
    const next={...saved,lastAttemptAt:now};
    await chrome.storage.local.set({wildlUpdates:next});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(UPDATE_API,{headers:{Accept:'application/vnd.github+json'},credentials:'omit',cache:'no-store',signal:controller.signal});
      if(response.status===404){next.latestVersion='';next.releaseTag='';}
      else{
        if(!response.ok)throw new Error('GitHub: HTTP '+response.status);
        const release=await response.json(),version=updateVersion(release.tag_name);
        if(!version||release.draft||release.prerelease)throw new Error('GitHub вернул неподходящий выпуск.');
        next.latestVersion=version;next.releaseTag=release.tag_name;
      }
      next.checkedAt=now;next.error='';
    }catch(error){next.error=error.name==='AbortError'?'GitHub не ответил за 10 секунд.':error.message||'Проверка обновлений недоступна.';}
    finally{clearTimeout(timer);}
    await chrome.storage.local.set({wildlUpdates:next});
    const view=updateView(next);
    Promise.resolve().then(()=>chrome.runtime.sendMessage({type:'UPDATE_STATUS',update:view})).catch(()=>{});
    return view;
  })();
  try{return await updateRequest;}finally{updateRequest=null;}
}
async function ensureUpdateAlarm(){
  if(!await chrome.alarms.get(UPDATE_ALARM))await chrome.alarms.create(UPDATE_ALARM,{periodInMinutes:1440,delayInMinutes:1440});
}
if(chrome.alarms&&chrome.storage.local&&chrome.runtime.getManifest){
  const startup=()=>{ensureUpdateAlarm().catch(()=>{});checkForUpdates().catch(()=>{});};
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===UPDATE_ALARM)checkForUpdates().catch(()=>{});});
  chrome.runtime.onInstalled?.addListener(startup);chrome.runtime.onStartup?.addListener(startup);
  startup();
}
