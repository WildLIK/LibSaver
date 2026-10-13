(()=>{
  const el=id=>document.getElementById(id),status=text=>el('mirrorStatus').textContent=text;
  function link(url,label){const node=document.createElement('a');node.href=url;node.textContent=label;node.target='_blank';node.rel='noopener noreferrer';return node;}
  function render(view){
    if(!view?.sites)return;
    el('mirrorAuto').checked=!!view.auto;el('mirrorSites').replaceChildren();el('mirrorSuggestions').replaceChildren();
    for(const site of view.sites){
      const row=document.createElement('div');row.className='mirror-row';const label=document.createElement('strong');label.textContent=site.name;row.append(label);
      for(const domain of site.domains){const prefix=domain==='novelslib.me'||domain==='yaoilib.net'?'v1.':domain==='shlib.life'?'v2.':domain==='animelib.org'?'v5.':'';row.append(link('https://'+prefix+domain+'/ru',prefix+domain));}
      for(const item of view.enabled.filter(item=>item.siteId===site.id)){
        const saved=document.createElement('div');saved.className='mirror-custom';saved.append(link(item.origin+'/ru',new URL(item.origin).hostname));
        const remove=document.createElement('button');remove.textContent='Отключить';remove.onclick=async()=>{try{render(await request({type:'REMOVE_MIRROR',origin:item.origin}));}catch(error){status(error.message);}};saved.append(remove);row.append(saved);
      }
      el('mirrorSites').append(row);
    }
    for(const item of view.suggestions||[]){
      const row=document.createElement('div');row.className='mirror-row';row.append(link(item.origin+'/ru',new URL(item.origin).hostname));
      if(/^https:\/\/t\.me\/(?:mangalib_social|slashlibme)\/\d+$/.test(item.source))row.append(link(item.source,'Сообщение с адресом'));
      const select=document.createElement('select');select.setAttribute('aria-label','Сайт для '+item.origin);select.append(new Option('Выберите сайт',''));
      for(const site of view.sites)select.append(new Option(site.name,site.id));select.value=item.siteId?String(item.siteId):'';
      const button=document.createElement('button');button.textContent=view.enabled.some(saved=>saved.origin===item.origin)?'Подключено':'Подключить';button.disabled=button.textContent==='Подключено';
      button.onclick=()=>connect(item.origin,select.value);row.append(select,button);el('mirrorSuggestions').append(row);
    }
    status(view.error?'Часть каналов недоступна: '+view.error:view.checkedAt?'Проверено: '+new Date(view.checkedAt).toLocaleString('ru-RU')+'. Новые домены подключаются кнопкой «Подключить».':'Каналы: @mangalib_social и @slashlibme. Для других адресов используйте ручное добавление.');
  }
  async function request(message){const result=await chrome.runtime.sendMessage(message);if(result?.error&&!result?.sites)throw new Error(result.error);return result;}
  async function connect(value,siteId){
    try{if(!siteId)throw new Error('Выберите сайт группы Lib.');const origin=mirrorOrigin(value);
      // Call the permissions API directly in the button's user gesture.
      if(!await chrome.permissions.request({origins:[origin+'/*']}))throw new Error('Доступ к зеркалу не разрешён.');
      render(await request({type:'ENABLE_MIRROR',origin,siteId:Number(siteId)}));status('Зеркало подключено. Откройте на нём тайтл и нажмите «Начать другую загрузку».');
    }catch(error){status(error.message);}
  }
  el('addMirror').onclick=()=>connect(el('mirrorUrl').value,el('mirrorSite').value);
  el('checkMirrors').onclick=async()=>{const button=el('checkMirrors');button.disabled=true;try{
    if(!await chrome.permissions.request({origins:['https://t.me/*']}))throw new Error('Чтение Telegram не разрешено.');status('Проверяю публичные каналы…');render(await request({type:'CHECK_MIRRORS'}));
  }catch(error){status(error.message);}finally{button.disabled=false;}};
  el('mirrorAuto').onchange=async()=>{try{const auto=el('mirrorAuto').checked;if(auto&&!await chrome.permissions.request({origins:['https://t.me/*']}))throw new Error('Чтение Telegram не разрешено.');render(await request({type:'SET_MIRROR_AUTO',auto}));}catch(error){el('mirrorAuto').checked=false;status(error.message);}};
  document.querySelector('.mirror-panel').addEventListener('toggle',()=>{if(document.querySelector('.mirror-panel').open)request({type:'GET_MIRRORS'}).then(render).catch(error=>status(error.message));});
})();
