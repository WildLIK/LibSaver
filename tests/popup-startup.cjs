const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.WILDL_CHROME||chromium.executablePath(),headless:true});
 fs.mkdirSync(path.resolve(__dirname,'../diagnostics/ui'),{recursive:true});
 try{
  async function pageFor(mode){
   const page=await browser.newPage({viewport:{width:400,height:600}});
   await page.route('https://wildl.test/**',route=>{
    const name=new URL(route.request().url()).pathname.slice(1);
    const body=mode==='syntax'&&name==='popup.js'?'const broken = ;':fs.readFileSync(path.resolve('wildl_page_api',name));
    return route.fulfill({body,contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html'});
   });
   await page.addInitScript(mode=>{
    const timer=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timer(fn,ms===12000?150:ms===1200?80:ms,...args);
    window.transportMode=mode;window.calls=[];window.respond=false;window.reloads=0;
    window.chrome={runtime:{reload:()=>window.reloads++,onMessage:{addListener:()=>{}},sendMessage:async message=>{
     window.calls.push(message.type);
     if(message.type==='PREPARE_RELOAD'&&window.transportMode==='pending')return new Promise(()=>{});
     if(message.type==='GET_STATE'&&!window.respond){
      if(window.transportMode==='empty')return undefined;
      if(window.transportMode==='rejected')throw new Error('Could not establish connection. Receiving end does not exist.');
      return new Promise(()=>{});
     }
     return {running:false,inspecting:false,title:'Тёмный король',siteName:'RanobeLib',kind:'novel',chapterCount:1202,total:1202,done:0,status:'Список глав обновлён.',branches:[],log:[]};
    }}};
   },mode);
   await page.goto('https://wildl.test/popup.html');return page;
  }
  for(const mode of ['pending','empty','rejected']){
   const page=await pageFor(mode);
   await page.waitForFunction(()=>document.body.dataset.phase==='error');
   assert.equal(await page.locator('#percent').textContent(),'ERROR');
   assert(await page.locator('#start').isDisabled());assert(await page.locator('#refresh').isEnabled());
   assert(!(await page.evaluate(()=>calls.includes('AUTO_INSPECT'))));
   assert.match(await page.locator('#log').textContent(),/Фоновый|Receiving end/);
   if(mode==='pending'){
    assert.equal(await page.evaluate(()=>calls.filter(x=>x==='GET_STATE').length),1);
    await page.screenshot({path:'diagnostics/ui/popup-connection-error.png',fullPage:true});
   }
   await page.click('#refresh');await page.waitForFunction(()=>window.reloads===1);
   await page.evaluate(async()=>{window.respond=true;await refresh();});
   await page.waitForFunction(()=>document.body.dataset.phase==='ready');
   assert.equal(await page.locator('#bookTitle').textContent(),'Тёмный король');assert(await page.locator('#start').isEnabled());
   assert(await page.evaluate(()=>calls.includes('AUTO_INSPECT')));
   await page.close();console.log('PASS popup startup:',mode,'is diagnosed, controls are safe, Refresh reconnects.');
  }
  const broken=await pageFor('syntax');await broken.waitForFunction(()=>document.body.dataset.phase==='error');
  assert.match(await broken.locator('#log').textContent(),/Ошибка интерфейса/);assert(await broken.locator('#start').isDisabled());
  console.log('PASS separate bootstrap reports a syntax error in popup.js instead of showing idle markup.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
