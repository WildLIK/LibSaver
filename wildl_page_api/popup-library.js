let saveSettingsLoaded=false;
function librarySize(bytes){return bytes>=1048576?(bytes/1048576).toFixed(1)+' МБ':(bytes/1024).toFixed(1)+' КБ';}
async function refreshLibrary(){
  try{
    const data=await chrome.runtime.sendMessage({type:'GET_LIBRARY'});if(!data?.settings)return;
    if(!saveSettingsLoaded){$('downloadFolder').value=data.settings.folder;$('autoSave').checked=!data.settings.ask;saveSettingsLoaded=true;renderSaveLocation(data.settings);}
    const list=$('historyList');list.replaceChildren();
    if(!data.history?.length){const p=document.createElement('p');p.className='hint';p.textContent='Загрузок пока нет.';list.append(p);return;}
    for(const item of data.history){
      const row=document.createElement('article');row.className='history-entry';
      const title=document.createElement('strong');title.textContent=item.title||'Без названия';row.append(title);
      const meta=document.createElement('p');meta.className='hint';meta.textContent=[String(item.format||'').toUpperCase(),item.done+' / '+item.total+(item.kind==='anime'?' серий':' глав'),librarySize(item.bytes||0),
        ({saving:'Сохраняется',complete:'Сохранено',interrupted:'Прервано'})[item.status]||item.status,new Date(item.createdAt).toLocaleString('ru-RU')].join(' · ');row.append(meta);
      if(item.branch){const branch=document.createElement('p');branch.className='hint';branch.textContent=item.branch+(item.from||item.to?' · '+(item.from||'начало')+'–'+(item.to||'конец'):'');row.append(branch);}
      const path=document.createElement('p');path.className='hint history-path';path.textContent=item.filename;row.append(path);
      const actions=document.createElement('div');actions.className='history-actions';
      if(/^https:\/\//.test(item.sourceUrl||'')){const link=document.createElement('a');link.href=item.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Открыть тайтл';actions.append(link);}
      if(item.status==='complete'){const button=document.createElement('button');button.textContent='Показать файл';button.onclick=async()=>{const result=await chrome.runtime.sendMessage({type:'SHOW_DOWNLOAD',id:item.id});if(result?.error)$('saveSettingsStatus').textContent=result.error;};actions.append(button);}
      row.append(actions);list.append(row);
    }
  }catch{}
}
async function storeSaveSettings(){
  try{const data=await chrome.runtime.sendMessage({type:'SAVE_LIBRARY_SETTINGS',settings:{folder:$('downloadFolder').value,ask:!$('autoSave').checked}});
    if(data?.error)throw new Error(data.error);
    if(data?.settings){$('downloadFolder').value=data.settings.folder;renderSaveLocation(data.settings);}}
  catch(error){$('saveSettingsStatus').textContent=error.message;}
}
function renderSaveLocation(settings){$('saveSettingsStatus').textContent=settings.ask?'Перед каждым файлом будет открываться выбор места.':'Без запросов: папка загрузок браузера'+(settings.folder?' / '+settings.folder:'')+'.';}
$('downloadFolder').onchange=storeSaveSettings;$('autoSave').onchange=storeSaveSettings;
if(/Firefox\//i.test(navigator.userAgent))$('openDownloadSettings').textContent='Как выбрать папку в Firefox';
$('openDownloadSettings').onclick=async()=>{try{const result=await chrome.runtime.sendMessage({type:'OPEN_DOWNLOAD_SETTINGS'});if(result?.error)throw new Error(result.error);
  if(result?.manual)$('saveSettingsStatus').textContent='Firefox: откройте Настройки → Основные → Файлы и приложения. Выберите «Сохранять файлы в» и нужную папку. Адрес настроек: about:preferences#general.';
}catch(error){$('saveSettingsStatus').textContent=error.message;}};
$('clearHistory').onclick=async()=>{await chrome.runtime.sendMessage({type:'CLEAR_HISTORY'});await refreshLibrary();};
chrome.runtime.onMessage.addListener(message=>{if(message.type==='LIBRARY_CHANGED')refreshLibrary();});
refreshLibrary();
