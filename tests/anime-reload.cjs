const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wildl-anime-reload-'));
(async()=>{let browser;try{
 const downloads=path.join(tmp,'downloads');fs.mkdirSync(downloads);let mediaRequests=[],episodeRequests=[],limitNextScan=false;
 fs.mkdirSync(path.resolve(__dirname,'../diagnostics/exports'),{recursive:true});fs.mkdirSync(path.resolve(__dirname,'../diagnostics/ui'),{recursive:true});
 fs.mkdirSync(path.join(tmp,'profile','Default'),{recursive:true});
 fs.writeFileSync(path.join(tmp,'profile','Default','Preferences'),JSON.stringify({extensions:{ui:{developer_mode:true}}}));
 browser=await chromium.launchPersistentContext(path.join(tmp,'profile'),{executablePath:chromium.executablePath(),headless:true,acceptDownloads:true,downloadsPath:downloads,args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
 await browser.route('https://v5.animelib.org/**',route=>route.fulfill({body:'<html data-id="5"></html>'}));
 await browser.route('https://api.cdnlibs.org/**',route=>{
  const u=new URL(route.request().url());let data;
  if(u.pathname.endsWith('/constants'))data={videoServers:[{id:'main',url:'https://video1.cdnlibs.org/.аs/'}]};
  else if(/\/episodes\/\d+$/.test(u.pathname)){
   if(limitNextScan&&Number(u.pathname.split('/').at(-1))<=2)return route.fulfill({status:429,body:'Превышен лимит',headers:{'Access-Control-Allow-Origin':'https://v5.animelib.org','Access-Control-Allow-Credentials':'true'}});
   const n=Number(u.pathname.split('/').at(-1));episodeRequests.push(n);data={id:n,players:n>=1180?[{player:'Animelib',team:{id:4,name:'Dream Cast'},translation_type:{id:2,label:'Озвучка'},video_domain:'main',video:{quality:{2160:{quality:2160,href:`/movie/${n}.mp4`},720:{quality:720,href:`/low/${n}.mp4`}}}}]:n<=5?[{player:'Animelib',team:{id:1,name:'JAM'},translation_type:{id:2,label:'Озвучка'},video_domain:'main',video:{quality:{720:{quality:720,href:`/movie/${n}.mp4`}}}},{player:'Kodik',team:{id:1,name:'JAM'},translation_type:{id:2,label:'Озвучка'},src:`https://p14.solodcdn.com/movie/${n}.mp4`}]:[{player:'Kodik',team:{id:2,name:'Другой перевод'},translation_type:{id:2,label:'Озвучка'},src:'https://kodikplayer.com/seria/99/hash/720p'}]};
   data.players.push({player:'Animelib',team:{id:20,name:'Crunchyroll.Subtitles'},translation_type:{id:1,label:'Субтитры'}});
   if(n<=2)data.players.push({player:'Animelib',team:{id:21,name:'Crunchyroll - ENG SUB'},translation_type:{id:1,label:'Субтитры'}});
  }else if(u.pathname.endsWith('/episodes'))data=Array.from({length:u.searchParams.get('anime_id')==='88--long-series'?1182:u.searchParams.get('anime_id')==='23126--chainsaw-man-movie-reze-hen-anime'?1:6},(_,index)=>({id:index+1,number:String(index+1),season:'1'}));
  else data={rus_name:'Проверка аниме'};
  return route.fulfill({body:JSON.stringify({data}),contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://v5.animelib.org','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Site-Id,Accept'}});
 });
 const cdp=await browser.browser().newBrowserCDPSession();let commandId=0;
 const manager=await browser.newPage();await manager.goto('chrome://extensions');
 await manager.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},resolve)));
 console.log('Test developer mode',await manager.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getProfileConfiguration(resolve))));
 await manager.close();
 await cdp.send('Extensions.loadUnpacked',{path:root});
 async function mockOffscreenMedia(worker) {
  await worker.evaluate(()=>ensureExporter());
  const target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/offscreen.html'));
  const attached=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
  async function evaluate(expression){
   const id=++commandId;
   const reply=new Promise((resolve,reject)=>{const listener=event=>{if(event.sessionId!==attached.sessionId)return;const data=JSON.parse(event.message);if(data.id!==id)return;cdp.off('Target.receivedMessageFromTarget',listener);if(data.error)reject(Error(data.error.message));else resolve(data.result);};cdp.on('Target.receivedMessageFromTarget',listener);});
   await cdp.send('Target.sendMessageToTarget',{sessionId:attached.sessionId,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}})});return reply;
  }
  await evaluate(`(()=>{window.mediaRequests=[];const original=window.fetch;window.fetch=async(url,options)=>{if(String(url).startsWith('https://video1.cdnlibs.org/')||String(url).startsWith('https://p14.solodcdn.com/')){window.mediaRequests.push(String(url));if(String(url).startsWith('https://video1.cdnlibs.org/')&&String(url).endsWith('/2.mp4'))return new Response('',{status:403});return new Response(new Uint8Array([0,0,0,12,102,116,121,112,0,0,0,1]),{headers:{'Content-Type':'video/mp4'}});}return original(url,options);};})()`);
  return async()=>{const r=await evaluate('window.mediaRequests');return r.result.value;};
 }
 let worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');const id=await worker.evaluate(()=>chrome.runtime.id);
 let getMedia=await mockOffscreenMedia(worker);
 const book=await browser.newPage();await book.goto('https://v5.animelib.org/ru/anime/77--anime-reload');
 let popup=await browser.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.waitForFunction(()=>!document.querySelector('#branch').disabled);
 const labels=await popup.locator('#branch option').allTextContents();
 assert(labels.some(text=>text.startsWith('JAM (серии 1–5)')));
 assert(labels.some(text=>text.startsWith('Другой перевод (серии 6)')),'Discover a voice that appears after the first episode');
 assert(labels.some(text=>text.startsWith('Crunchyroll.Subtitles (серии 1–6)')));
 assert(labels.some(text=>text.startsWith('Crunchyroll - ENG SUB (серии 1–2)')),'Keep distinct Crunchyroll team IDs separate');
 assert.equal(await popup.locator('#branchHint').textContent(),'Доступны серии: 1–5.');
 await popup.waitForFunction(()=>document.querySelector('#qualityHint').textContent.includes('4K не найдено'));
 assert(await popup.locator('#quality option[value="2160"]').isDisabled());
 assert.equal(await popup.evaluate(()=>episodeRanges([{season:1,number:1},{season:1,number:2},{season:1,number:4},{season:2,number:1},{season:2,number:2}])),'сезон 1: 1–2, 4; сезон 2: 1–2');
 assert.equal(await popup.evaluate(()=>episodeRanges([{season:2,number:1},{season:2,number:2},{season:10000,number:1,episodeKind:'recap',groupLabel:'Рекап'},{season:10000,number:2,episodeKind:'recap',groupLabel:'Рекап'}])),'сезон 2: 1–2; рекапы: 1–2');
 assert.equal(await popup.evaluate(()=>episodeRanges([{season:10000,number:1,episodeKind:'recap'}])),'рекапы: 1');
 await popup.selectOption('#branch','1:2:Animelib');await popup.locator('.settings summary').click();await popup.fill('#pause','5');await popup.locator('.settings summary').click();
 await popup.click('#start');await popup.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('1 /'),null,{timeout:12000}).catch(async error=>{console.log(await popup.locator('#status').textContent(),await popup.locator('#log').textContent());console.log(await worker.evaluate(()=>publicState()));throw error;});
 assert(await popup.locator('#refresh').isEnabled());assert.equal(await popup.locator('#newTitle').textContent(),'Начать другую загрузку');
 assert((await popup.locator('#newTitle').boundingBox()).height>=36);
 const oldState=await worker.evaluate(()=>publicState());assert.equal(oldState.skipped,1);assert.match(oldState.log.join('\n'),/доступно 5 из 6/);
 await book.evaluate(()=>{history.pushState({},'',location.pathname+'?episode=2');const frame=document.createElement('iframe');frame.src='https://v5.animelib.org/player-test';document.body.append(frame);});
 await book.waitForTimeout(100);assert(await worker.evaluate(()=>state.running),'Changing episode/player frame must not be treated as source reload');
 mediaRequests.push(...await getMedia());
 await popup.click('#refresh').catch(()=>{});
 await popup.waitForEvent('close',{timeout:15000}).catch(()=>{});
 const previousWorker=worker;
 popup=await browser.newPage();
 for(let retry=0;;retry++){
  try{await popup.goto(`chrome-extension://${id}/popup.html`);break;}
  catch(error){if(retry>=20){
    const debug=await browser.newPage();await debug.goto('chrome://extensions');
    console.log(await debug.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},items=>resolve(items.map(i=>({id:i.id,name:i.name,state:i.state,disableReasons:i.disableReasons,runtimeErrors:i.runtimeErrors,manifestErrors:i.manifestErrors,loadError:i.loadError})))))));
    throw error;
  }await new Promise(resolve=>setTimeout(resolve,200));}
 }
 worker=browser.serviceWorkers().find(w=>w!==previousWorker)||await browser.waitForEvent('serviceworker',{predicate:w=>w!==previousWorker,timeout:15000});
 await popup.waitForFunction(()=>document.querySelector('#startLabel').textContent==='Продолжить загрузку');
 const recovered=await worker.evaluate(()=>publicState());assert.equal(recovered.done,1);assert.equal(recovered.recovery.done,1);
 getMedia=await mockOffscreenMedia(worker);
 await worker.evaluate(()=>{const download=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=o=>download({...o,saveAs:false});state.cfg.pause=0;});
 await popup.click('#start');await popup.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Сохранено '),null,{timeout:30000});
 const final=await worker.evaluate(()=>publicState());assert.equal(final.done,5);assert.equal(final.skipped,1);
 mediaRequests.push(...await getMedia());
 assert(mediaRequests.filter(url=>url.startsWith('https://video1.cdnlibs.org/')).every(url=>decodeURI(url).includes('/.аs/movie/')));
 assert(mediaRequests.some(url=>url==='https://p14.solodcdn.com/movie/2.mp4'),'Failed Animelib source must use Kodik with the same JAM voice');
 assert.equal(mediaRequests.filter(url=>url.endsWith('/1.mp4')).length,1,'Episode 1 must not be downloaded twice after reload');
 const file=(await worker.evaluate(()=>chrome.downloads.search({orderBy:['-startTime'],limit:1})))[0];assert.equal(file.state,'complete');
 fs.copyFileSync(file.filename,path.resolve(__dirname,'../diagnostics/exports/anime-reload.zip'));
 await popup.click('#newTitle');await popup.waitForFunction(()=>!document.querySelector('#branch').disabled);
 assert.equal(await popup.locator('#startLabel').textContent(),'Скачать серии');
 const groups=await popup.locator('#branch optgroup').evaluateAll(items=>items.map(group=>({label:group.label,ids:[...group.children].map(option=>option.value)})));
 assert.match(groups[0].label,/Озвучка/);assert(groups[0].ids.every(id=>id.split(':')[1]==='2'));
 assert.match(groups[1].label,/Субтитры/);assert(groups[1].ids.every(id=>id.split(':')[1]==='1'));
 await book.goto('https://v5.animelib.org/ru/anime/88--long-series');episodeRequests=[];
 await popup.evaluate(()=>send({type:'AUTO_INSPECT'}));await popup.waitForFunction(()=>document.querySelector('#scanRange').disabled===false);
 assert.equal(episodeRequests.length,0,'Opening 1182 episodes must not scan every episode or even sample episode 1');
 assert.match(await popup.locator('#scanHint').textContent(),/Укажите номера/);assert(await popup.locator('#start').isDisabled());
 await popup.fill('#from','1180');await popup.fill('#to','1182');await popup.click('#scanRange');
 await popup.waitForFunction(()=>!document.querySelector('#branch').disabled);
 assert.deepEqual(episodeRequests.sort((a,b)=>a-b),[1180,1181,1182]);
 assert((await popup.locator('#branch option').allTextContents()).some(text=>/Dream Cast \(серии 1180–1182\)/.test(text)));
 await popup.selectOption('#branch','4:2:Animelib');
 await popup.waitForFunction(()=>document.querySelector('#qualityHint').textContent.includes('4K — серии 1180–1182'));
 assert(await popup.locator('#quality option[value="2160"]').isEnabled());
 assert(!(await popup.locator('#concurrencyField').isVisible()));
 await popup.selectOption('#quality','2160');
 await popup.click('#start');await popup.waitForFunction(()=>document.querySelector('#status').textContent==='Файл сохранён.',null,{timeout:30000});
 assert(episodeRequests.every(id=>id>=1180&&id<=1182),'Downloading range must not trigger full availability scan');
 assert.equal(await worker.evaluate(()=>state.done),3);
 assert.match(await popup.locator('#qualityHint').textContent(),/4K — серии 1180–1182/);
 assert((await getMedia()).filter(url=>/\/movie\/118[012]\.mp4$/.test(url)).length===3,'Download 2160p rather than lower /low/ source');
 await popup.screenshot({path:path.resolve(__dirname,'../diagnostics/ui/anime-range-2.1.png'),clip:{x:0,y:0,width:400,height:Math.ceil((await popup.locator('.app').boundingBox()).height)}});
 limitNextScan=true;await popup.click('#scanAll');
 await popup.waitForFunction(()=>document.querySelector('#status').textContent.includes('Лимит сайта'));
 assert(await popup.locator('#from').isEnabled());assert(await popup.locator('#scanRange').isEnabled());
 await popup.fill('#from','1180');await popup.fill('#to','1182');limitNextScan=false;
 await popup.click('#scanRange');await popup.waitForFunction(()=>!document.querySelector('#branch').disabled,null,{timeout:5000});
 assert.match(await popup.locator('#scanHint').textContent(),/1180–1182/);
 await book.goto('https://v5.animelib.org/ru/anime/23126--chainsaw-man-movie-reze-hen-anime/watch?episode=134259&player=Animelib&team=33028&translation_type=2');
 await popup.evaluate(()=>send({type:'AUTO_INSPECT'}));
 await popup.waitForFunction(()=>!document.querySelector('#start').disabled,null,{timeout:8000});
 assert.equal(await worker.evaluate(()=>state.chapterCount),1);
 assert(!(await popup.locator('#log').textContent()).includes("reading 'id'"),'Single-episode film must not access a second scan row');
 await popup.click('#start');await popup.waitForFunction(()=>document.querySelector('#status').textContent==='Файл сохранён.',null,{timeout:10000});
 assert.equal(await worker.evaluate(()=>state.done),1,'Single-episode film downloads successfully');
 await book.goto('https://v5.animelib.org/ru/anime/88--long-series');
 // Leave an active bridge, invalidate it without PREPARE_RELOAD, then send an orphan event.
 await worker.evaluate(()=>start({scanAll:true},true));
 const orphan=await worker.evaluate(()=>jobId);assert(orphan);
 await worker.evaluate(()=>chrome.runtime.reload()).catch(()=>{});
 await book.evaluate(jobId=>window.postMessage({source:'wildl-page',jobId,type:'chapter',index:0},location.origin),orphan);
 await book.waitForTimeout(200);
 const errorManager=await browser.newPage();await errorManager.goto('chrome://extensions');
 const runtimeErrors=await errorManager.evaluate(id=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},items=>resolve(items.find(item=>item.id===id)?.runtimeErrors||[]))),id);
 assert(!runtimeErrors.some(error=>/context invalidated/i.test(error.message)),JSON.stringify(runtimeErrors));
 console.log('PASS native runtime.reload: selected Animelib MP4 with sparse quality, first five JAM episodes only, missing sixth skipped, checkpoint/bridge restored, one flat archive, no duplicates, large new-download button works.');
 console.log('PASS 2.1: grouped voices/subtitles, 1180–1182 scan/download among 1182 episodes, 4K source, orphan bridge after forced runtime.reload without uncaught context error.');
}finally{if(browser)await browser.close();const target=path.resolve(tmp);if(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('wildl-anime-reload-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:250});}})().catch(e=>{console.error(e);process.exitCode=1;});
