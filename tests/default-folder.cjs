const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'libsaver-chrome-folder-'));
(async()=>{let browser;try{
 const downloads=path.join(temp,'downloads'),profile=path.join(temp,'profile');fs.mkdirSync(downloads);fs.mkdirSync(path.join(profile,'Default'),{recursive:true});
 fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({download:{default_directory:downloads,prompt_for_download:false}}));
 browser=await chromium.launchPersistentContext(profile,{executablePath:chromium.executablePath(),headless:true,acceptDownloads:false,args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
 const cdp=await browser.browser().newBrowserCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:true});
 const manager=await browser.newPage();await manager.goto('chrome://extensions');await manager.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},resolve)));
 await cdp.send('Extensions.loadUnpacked',{path:root});const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
 const extensionId=await worker.evaluate(()=>chrome.runtime.id),page=await browser.newPage();await page.goto(`chrome-extension://${extensionId}/popup.html`);
 await page.addScriptTag({url:`chrome-extension://${extensionId}/checkpoint-store.js`});
 await page.evaluate(()=>checkpointWrite('native-folder',0,{kind:'novel',volume:'1',number:'1',text:'Native Chromium test'}));
 const id=await worker.evaluate(async()=>{await restored;
  return await saveResult({jobId:'native-folder',kind:'novel',title:'Native Chromium',format:'mobi',total:1,done:1});});
 let item;for(let attempt=0;attempt<80;attempt++){item=(await worker.evaluate(id=>chrome.downloads.search({id}),id))[0];if(['complete','interrupted'].includes(item?.state))break;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(item.state,'complete',JSON.stringify(item));assert.equal(item.filename,path.join(downloads,'LibSaver','Native Chromium.mobi'));
 assert(fs.existsSync(item.filename));console.log('PASS native Chromium default Downloads/LibSaver folder without a prompt:',item.fileSize,'bytes');
 await page.evaluate(()=>checkpointWrite('native-video',0,{kind:'anime',outputFormat:'files',volume:'1',number:'2',delivered:false,
   files:[{name:'Серия 2.mp4',data:new Blob([new Uint8Array([0,0,0,12,102,116,121,112,0,0,0,1])],{type:'video/mp4'})}]}));
 await worker.evaluate(async()=>{Object.assign(state,{title:'Native Anime',archiveId:'native-video',kind:'anime',format:'files',running:true,cfg:{},plan:[{index:0,number:'2',volume:'1'}]});jobId='native-run';
   await saveVideoEpisode({index:0,chapter:{number:'2'}},'native-run');});
 const movie=(await worker.evaluate(()=>chrome.downloads.search({orderBy:['-startTime'],limit:1})))[0];
 assert.equal(movie.state,'complete');assert.equal(movie.filename,path.join(downloads,'LibSaver','Native Anime','Native Anime. 2.mp4'));
 assert.equal(fs.readFileSync(movie.filename).subarray(4,8).toString(),'ftyp');
 // Recreate the crash window: the browser saved the file, but the delivery marker wasn't persisted.
 await page.evaluate(downloadId=>checkpointWrite('native-crash',0,{kind:'anime',outputFormat:'files',volume:'1',number:'2',delivered:false,downloadId,
   files:[{name:'Серия 2.mp4',data:new Blob([new Uint8Array([0,0,0,12,102,116,121,112,0,0,0,1])],{type:'video/mp4'})}]}),movie.id);
 const before=await worker.evaluate(async()=>{state.archiveId='native-crash';return (await chrome.downloads.search({})).length;});
 await worker.evaluate(()=>saveVideoEpisode({index:0,chapter:{number:'2'}},'native-run'));
 assert.equal((await worker.evaluate(()=>chrome.downloads.search({}))).length,before,'Already completed native file must not be saved twice');
 const delivered=await page.evaluate(()=>checkpointRead('native-crash'));assert.equal(delivered[0].chapter.delivered,true);assert.equal(delivered[0].chapter.files.length,0);
 console.log('PASS native separate MP4: one series folder, exact title/episode filename, successful write acknowledged, crash-window recovery without duplicate file, payload released.');

}finally{if(browser)await browser.close();if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(temp).startsWith('libsaver-chrome-folder-'))fs.rmSync(temp,{recursive:true,force:true,maxRetries:3,retryDelay:250});}})().catch(error=>{console.error(error);process.exitCode=1;});
