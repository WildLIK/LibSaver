let saveSettingsLoaded=false;
function librarySize(bytes){return bytes>=1048576?(bytes/1048576).toFixed(1)+' МБ':(bytes/1024).toFixed(1)+' КБ';}
async function refreshLibrary(){
  try{
    const data=await chrome.runtime.sendMessage({type:'GET_LIBRARY'});if(!data?.settings)return;
    if(!saveSettingsLoaded){$('downloadFolder').value=data.settings.folder;$('askSave').checked=data.settings.ask;saveSettingsLoaded=true;}
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
  try{const data=await chrome.runtime.sendMessage({type:'SAVE_LIBRARY_SETTINGS',settings:{folder:$('downloadFolder').value,ask:$('askSave').checked}});
    if(data?.error)throw new Error(data.error);
    if(data?.settings){$('downloadFolder').value=data.settings.folder;$('saveSettingsStatus').textContent=data.settings.ask?'Будет открываться диалог сохранения.':'Сохраняем в Загрузки'+(data.settings.folder?'/'+data.settings.folder:'')+'.';}}
  catch(error){$('saveSettingsStatus').textContent=error.message;}
}
$('downloadFolder').onchange=storeSaveSettings;$('askSave').onchange=storeSaveSettings;
$('clearHistory').onclick=async()=>{await chrome.runtime.sendMessage({type:'CLEAR_HISTORY'});await refreshLibrary();};
chrome.runtime.onMessage.addListener(message=>{if(message.type==='LIBRARY_CHANGED')refreshLibrary();});
refreshLibrary();
