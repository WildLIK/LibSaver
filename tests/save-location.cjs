const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:400,height:600}});
 await page.route('https://save.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1)||'popup.html';route.fulfill({body:fs.readFileSync(path.join(root,name)),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.gif')?'image/gif':'text/html'});});
 await page.addInitScript(()=>{
  window.calls=[];let settings={folder:'WildLib',ask:true};
  const state={kind:'novel',title:'Test',chapterCount:1,total:1,done:0,branches:[],log:[],running:false,inspecting:false};
  window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async message=>{
   window.calls.push(message);
   if(message.type==='GET_LIBRARY')return {settings,history:[]};
   if(message.type==='SAVE_LIBRARY_SETTINGS'){if(message.settings.folder.includes(':'))return {error:'Диск и базовую папку выберите кнопкой «Папка загрузок браузера».'};settings={...message.settings};return {settings,history:[]};}
   if(message.type==='OPEN_DOWNLOAD_SETTINGS')return {ok:true};
   if(message.type==='CHECK_UPDATES')return {installedVersion:'2.3',available:false};
   return {...state};
  }}};
 });
 await page.goto('https://save.test/popup.html');await page.waitForFunction(()=>document.querySelector('#saveSettingsStatus').textContent.includes('Перед каждым'));
 await page.locator('.settings>summary').click();assert(!(await page.locator('#autoSave').isChecked()));
 await page.check('#autoSave');await page.waitForFunction(()=>document.querySelector('#saveSettingsStatus').textContent.includes('Без запросов'));
 assert(await page.evaluate(()=>window.calls.some(call=>call.type==='SAVE_LIBRARY_SETTINGS'&&call.settings.ask===false)));
 await page.fill('#downloadFolder','Anime');await page.locator('#downloadFolder').blur();await page.waitForFunction(()=>document.querySelector('#saveSettingsStatus').textContent.includes('/ Anime'));
 await page.click('#openDownloadSettings');assert(await page.evaluate(()=>window.calls.some(call=>call.type==='OPEN_DOWNLOAD_SETTINGS')));
 await page.fill('#downloadFolder','D:\\downloads');await page.locator('#downloadFolder').blur();await page.waitForFunction(()=>document.querySelector('#saveSettingsStatus').textContent.includes('Диск и базовую папку'));
 assert.equal(await page.locator('.error-frame').isVisible(),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>400),false);
 console.log('PASS save-location UI: previous ask preference preserved, automatic saving persisted, relative subfolder, settings shortcut and clear absolute-path guidance without a job error.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
