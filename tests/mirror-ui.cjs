const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api');
(async()=>{const browser=await chromium.launch({executablePath:process.env.WILDL_CHROME||chromium.executablePath(),headless:true});try{
 const page=await browser.newPage({viewport:{width:400,height:600}});
 await page.route('https://wildl.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1)||'popup.html';route.fulfill({body:fs.readFileSync(path.join(root,name)),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.gif')?'image/gif':'text/html'});});
 await page.addInitScript(()=>{
  window.calls=[];window.grants=[];window.allow=true;
  const state={kind:'anime',title:'Test anime',total:3,done:3,running:false,inspecting:false,log:[],branches:[],chapterCount:3,recovery:{format:'zip',done:3}};
  const mirrors={sites:[{id:5,name:'AnimeLib',domains:['animelib.org','anilib.me']},{id:3,name:'RanobeLib',domains:['novelslib.me']}],enabled:[],suggestions:[],auto:false};
  window.chrome={permissions:{request:async value=>{window.grants.push(value);return window.allow;}},runtime:{onMessage:{addListener:()=>{}},sendMessage:async message=>{
   window.calls.push(message);
   if(message.type==='GET_MIRRORS')return structuredClone(mirrors);
   if(message.type==='CHECK_MIRRORS'){mirrors.suggestions=[{origin:'https://mirror.libmirror.net',siteId:5,source:'https://t.me/mangalib_social/123'}];mirrors.checkedAt=Date.now();return structuredClone(mirrors);}
   if(message.type==='ENABLE_MIRROR'){mirrors.enabled.push({origin:message.origin,siteId:message.siteId});return structuredClone(mirrors);}
   if(message.type==='REMOVE_MIRROR'){mirrors.enabled=mirrors.enabled.filter(item=>item.origin!==message.origin);return structuredClone(mirrors);}
   if(message.type==='SET_MIRROR_AUTO'){mirrors.auto=message.auto;return structuredClone(mirrors);}
   if(message.type==='CHECK_UPDATES')return {installedVersion:'2.3',available:false};
   return structuredClone(state);
  }}};
 });
 await page.goto('https://wildl.test/popup.html');await page.waitForFunction(()=>document.querySelector('#bookTitle').textContent==='Test anime');
 assert.equal(await page.locator('.brand h1').textContent(),'WildLib');assert(await page.locator('#saveSeparate').isVisible());
 await page.click('#saveSeparate');assert(await page.evaluate(()=>window.calls.some(item=>item.type==='SAVE_PARTIAL'&&item.format==='files')));
 assert.equal(await page.evaluate(()=>window.calls.some(item=>item.type==='CHECK_MIRRORS')),false);
 await page.locator('.settings>summary').click();await page.locator('.mirror-panel>summary').click();await page.waitForSelector('#mirrorSites a');
 assert.equal(await page.locator('#mirrorSites a').first().getAttribute('href'),'https://v5.animelib.org/ru');
 await page.click('#checkMirrors');await page.waitForSelector('#mirrorSuggestions button');assert.equal(await page.locator('#mirrorSuggestions a').nth(1).getAttribute('href'),'https://t.me/mangalib_social/123');
 await page.locator('#mirrorSuggestions button').click();await page.waitForFunction(()=>document.querySelector('#mirrorSuggestions button').textContent==='Подключено');
 assert(await page.evaluate(()=>window.grants.some(item=>item.origins[0]==='https://mirror.libmirror.net/*')));
 await page.locator('.mirror-custom button').click();assert.equal(await page.locator('.mirror-custom').count(),0);
 await page.selectOption('#mirrorSite','3');await page.fill('#mirrorUrl','https://another.libmirror.net/ru');await page.click('#addMirror');
 await page.waitForSelector('.mirror-custom');assert(await page.evaluate(()=>window.calls.some(item=>item.type==='ENABLE_MIRROR'&&item.siteId===3&&item.origin==='https://another.libmirror.net')));
 await page.check('#mirrorAuto');assert(await page.evaluate(()=>window.calls.some(item=>item.type==='SET_MIRROR_AUTO'&&item.auto)));
 await page.uncheck('#mirrorAuto');await page.evaluate(()=>window.allow=false);await page.click('#mirrorAuto');assert(!(await page.locator('#mirrorAuto').isChecked()));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>400),false);
 fs.mkdirSync(path.resolve(__dirname,'../diagnostics/ui'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../diagnostics/ui/wildlib-mirrors.png'),fullPage:true});
 console.log('PASS mirror UI: WildLib brand, cached episodes saved separately, optional Telegram permissions, source links, exact-host connection/removal, daily toggle and denied-permission feedback.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
