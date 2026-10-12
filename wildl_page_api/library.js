const HISTORY_KEY='wildlHistory',SAVE_SETTINGS_KEY='wildlSaveSettings';
let libraryQueue=Promise.resolve();
function normalizeSaveSettings(value={}) {
  const folder=String(value.folder??'LibSaver').trim().replace(/\\/g,'/').replace(/\/{2,}/g,'/');
  if(folder.startsWith('/')||/[:*?"<>|\x00-\x1f]/.test(folder)||folder.split('/').some(part=>part==='.'||part==='..'||part.endsWith('.')||part.endsWith(' ')))
    throw new Error('Укажите подпапку внутри Загрузок, например LibSaver. Абсолютный путь и «..» не поддерживаются.');
  return {folder:folder.replace(/\/+$/,''),ask:!!value.ask};
}
async function getLibrary(){
  if(!chrome.storage.local)return {history:[],settings:normalizeSaveSettings()};
  const data=await chrome.storage.local.get([HISTORY_KEY,SAVE_SETTINGS_KEY]);
  return {history:data[HISTORY_KEY]||[],settings:normalizeSaveSettings(data[SAVE_SETTINGS_KEY]||{})};
}
async function saveLibrarySettings(value){const settings=normalizeSaveSettings(value);await chrome.storage.local.set({[SAVE_SETTINGS_KEY]:settings});return settings;}
function changeHistory(transform){
  const task=libraryQueue.then(async()=>{
    if(!chrome.storage.local)return [];
    const data=await chrome.storage.local.get(HISTORY_KEY),history=transform(data[HISTORY_KEY]||[]).slice(0,100);
    await chrome.storage.local.set({[HISTORY_KEY]:history});
    chrome.runtime.sendMessage({type:'LIBRARY_CHANGED'}).catch(()=>{});return history;
  });libraryQueue=task.catch(()=>{});return task;
}
function addHistory(entry){return changeHistory(history=>[{...entry,createdAt:Date.now(),status:'saving'},...history.filter(item=>item.id!==entry.id)]);}
function finishHistory(id,status,details={}){return changeHistory(history=>history.map(item=>item.id===id?{...item,...details,status,finishedAt:Date.now()}:item));}
