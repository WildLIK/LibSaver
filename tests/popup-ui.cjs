const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../wildl_page_api');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.WILDL_CHROME || chromium.executablePath(), headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 400, height: 600}, deviceScaleFactor: 1});
    await page.route('https://wildl.test/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'popup.html';
      route.fulfill({body: fs.readFileSync(path.join(root, name)), contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg')?'image/svg+xml':name.endsWith('.gif')?'image/gif':name.endsWith('.png')?'image/png':'text/html'});
    });
    await page.addInitScript(() => {
      window.calls = [];window.reloads=0;
      let listeners = [];
      let state = {title:'Теневой раб',slug:'122448--shadow-slave',total:3621,chapterCount:3621,done:0,
        running:false,paused:false,inspecting:false,selectedBranch:'',status:'Готово к скачиванию.',
        branches:[{id:'13947',name:'Silent Step',count:3161},{id:'13303',name:'Disoer',count:2250}],log:[]};
      window.chrome = {runtime:{reload:()=>window.reloads++,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async message => {
        window.calls.push(message);
        if(message.type==='CHECK_UPDATES')return {installedVersion:'2.3',latestVersion:'2.3',checkedAt:1,available:false};
        if(message.type==='SELECT_BRANCH') {state.selectedBranch=message.branchId;state.total=state.branches.find(branch=>branch.id===message.branchId)?.count||state.chapterCount;}
        if(message.type==='INSPECT') {state.inspecting=false;state.status='Список глав обновлён.';}
        if(message.type==='START') {state.running=true;state.total=10;state.done=2;state.status='Скачиваю: Том 1 Глава 3';}
        if(message.type==='PAUSE') {state.paused=true;state.status='На паузе. Можно продолжить.';}
        if(message.type==='RESUME') {state.paused=false;state.status='Продолжаю: 2/10';}
        if(message.type==='STOP') {state.running=false;state.paused=false;state.status='Остановлено.';}
        if(message.type==='SAVE_PARTIAL'){state.recovery=null;state.status='Скачанные главы сохранены.';}
        return structuredClone(state);
      }}};
      window.changeState=next=>{Object.assign(state,next);for(const listener of listeners)listener({type:'STATE',state:structuredClone(state)});};
    });
    await page.goto('https://wildl.test/popup.html');
    await page.waitForFunction(() => document.querySelector('#bookTitle').textContent === 'Теневой раб');
    await page.waitForFunction(()=>document.querySelector('#appLogo').naturalWidth===256);
    assert(await page.locator('#appLogo').isVisible());assert(!(await page.locator('#downloadMotion').isVisible()));
    const idleLogoBox=await page.locator('.logo').boundingBox();
    await page.evaluate(()=>window.changeState({restoreChecking:true,status:'Проверяю сохранённые файлы…'}));
    assert.equal(await page.locator('body').getAttribute('data-phase'),'inspect');assert(await page.locator('#start').isDisabled());assert.match(await page.locator('#count').textContent(),/сохранённые файлы/);
    await page.evaluate(()=>window.changeState({restoreChecking:false,status:'Готово к скачиванию.'}));await page.waitForFunction(()=>!document.querySelector('#start').disabled);
    await page.selectOption('#branch','13303');
    assert.match(await page.locator('#found').textContent(), /2\s?250/);
    await page.click('#refresh');
    await page.waitForFunction(()=>window.reloads===1);
    assert(await page.evaluate(()=>window.calls.some(call=>call.type==='PREPARE_RELOAD')));
    await page.fill('#to','10');
    const overflow = await page.evaluate(() => ({x:document.documentElement.scrollWidth>400,height:document.body.scrollHeight}));
    assert.equal(overflow.x,false);
    assert(overflow.height <= 600, `Popup default height ${overflow.height} exceeds Chrome popup height`);
    const important = await page.locator('#start').boundingBox();
    assert(important.height>=44);
    const range = await page.locator('#from').boundingBox();
    assert(important.height>range.height);
    fs.mkdirSync(path.join(__dirname,'../diagnostics/ui'), {recursive:true});
    await page.screenshot({path:path.join(__dirname,'../diagnostics/ui/popup-ready.png'),fullPage:true});
    await page.click('#start');
    const cfg = await page.evaluate(() => window.calls.find(call=>call.type==='START').cfg);
    assert.equal(cfg.branchId,'13303');assert.equal(cfg.to,'10');
    assert(await page.locator('#refresh').isEnabled());
    assert.equal(await page.locator('#newTitle').textContent(),'Начать другую загрузку');
    assert(Math.round((await page.locator('#newTitle').boundingBox()).height)>=36);
    assert(await page.locator('#branch').isDisabled());
    await page.click('#pauseJob');
    assert.equal(await page.locator('#pauseLabel').textContent(),'Продолжить');
    assert(!(await page.locator('#stop').isDisabled()));
    await page.screenshot({path:path.join(__dirname,'../diagnostics/ui/popup-paused.png'),fullPage:true});
    await page.click('#pauseJob');
    assert.equal(await page.locator('#pauseLabel').textContent(),'Пауза');
    await page.click('#stop');
    await page.evaluate(()=>window.changeState({running:false,done:12,total:17,skipped:0,status:'Ошибка',recovery:{done:12,jobId:'recover-test'}}));
    assert(await page.locator('#savePartial').isVisible());
    assert.match(await page.locator('#savePartial').textContent(),/12 глав/);
    assert.equal(await page.locator('#startLabel').textContent(),'Продолжить загрузку');
    await page.click('#savePartial');
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.type==='SAVE_PARTIAL').at(-1).format),'epub');
    assert(!(await page.locator('#savePartial').isVisible()));
    await page.evaluate(()=>window.changeState({running:false,done:13,total:17,skipped:4,status:'Сохранено 13 из 17 глав. Пропущено: 4.'}));
    assert.equal(await page.locator('#percent').textContent(),'100%');
    assert.match(await page.locator('#count').textContent(),/пропущено 4/);
    await page.locator('#bar').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)));
    await page.screenshot({path:path.join(__dirname,'../diagnostics/ui/popup-skipped.png'),fullPage:true});
    assert(!(await page.locator('#refresh').isDisabled()));
    await page.locator('.settings > summary').click();
    await page.locator('.log-panel summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>400),false);
    const buttons = await page.locator('.actions').boundingBox();
    assert(buttons.y+buttons.height<=600);
    await page.screenshot({path:path.join(__dirname,'../diagnostics/ui/popup-settings.png'),fullPage:true});
    await page.locator('.settings > summary').click();
    await page.locator('.log-panel summary').click();
    await page.evaluate(()=>window.changeState({kind:'manga',siteName:'MangaLib',title:'Всеведущий читатель',slug:'34466--jeonjijeog-dogja-sijeom_',
      chapterCount:313,total:187,done:0,skipped:0,selectedBranch:'teams:2460',status:'Готово к скачиванию.',branches:[{id:'teams:2460',name:'Assley Team',count:187}]}));
    assert.equal(await page.locator('#startLabel').textContent(),'Скачать мангу');
    assert.deepEqual(await page.locator('#format option').evaluateAll(options=>options.map(option=>option.value)),['cbz','zip','cbr']);
    await page.locator('#bar').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)));
    await page.screenshot({path:path.join(__dirname,'../diagnostics/ui/popup-manga.png'),fullPage:true});
    await page.selectOption('#format','zip');
    await page.click('#start');
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.type==='START').at(-1).cfg.format),'zip');
    await page.click('#stop');
    await page.evaluate(()=>window.changeState({kind:'anime',siteName:'AnimeLib',title:'Магическая битва',slug:'16133--jujutsu-kaisen-anime',chapterCount:24,total:24,done:0,selectedBranch:'32412:2:Kodik',branches:[{id:'32412:2:Kodik',name:'AniLibria.TV · Озвучка · Kodik',count:24}]}));
    assert.equal(await page.locator('#startLabel').textContent(),'Скачать серии');
    assert.deepEqual(await page.locator('#format option').allTextContents(),['По одному файлу','Одним архивом']);
    assert(await page.locator('#qualityField').isVisible());assert.equal(await page.locator('#format').inputValue(),'files');assert.equal(await page.locator('#quality').inputValue(),'max');
    assert.equal(await page.locator('#fromLabel').textContent(),'С серии');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>400),false);
    await page.screenshot({path:path.join(__dirname,'../diagnostics/ui/popup-anime.png'),fullPage:true});
    await page.evaluate(()=>window.changeState({running:true,status:'Серия 1180 · Фрагментов 15/60',videoEta:{series:'1180',phase:'estimate',seconds:135,progress:.25,totalBytes:104857600,speedBps:2097152,at:Date.now()}}));
    assert.equal(await page.locator('#percent').textContent(),'1%');
    assert.match(await page.locator('#status').textContent(),/Размер: 100\.0 МиБ.*2\.00 МиБ\/с/);
    assert(await page.locator('.meter-wave').isVisible());
    const waveAnimation=await page.locator('.meter-wave').evaluate(element=>({name:getComputedStyle(element).animationName,duration:getComputedStyle(element).animationDuration}));
    assert.equal(waveAnimation.name,'spin');assert.equal(waveAnimation.duration,'1.1s');
    const waveBefore=await page.locator('.meter-wave').evaluate(element=>getComputedStyle(element).transform);
    await page.waitForTimeout(150);
    assert.notEqual(await page.locator('.meter-wave').evaluate(element=>getComputedStyle(element).transform),waveBefore,'Work wave must keep moving while reported percentage remains fixed');
    assert(await page.locator('#downloadMotion').isVisible());
    assert(!(await page.locator('#appLogo').isVisible()));
    await page.waitForFunction(()=>document.querySelector('#downloadMotion').naturalWidth===256);
    assert.equal(await page.locator('#downloadMotion').evaluate(element=>!!element.closest('.brand')),true);
    assert.equal(await page.locator('.progress #downloadMotion').count(),0);
    assert.equal((await page.locator('.logo').boundingBox()).width,idleLogoBox.width);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert(await page.locator('#downloadMotion').isVisible(),'Requested animated logo must stay visible when system decorative animations are disabled');
    assert.equal(await page.locator('.meter-wave').evaluate(element=>getComputedStyle(element).animationName),'spin');
    await page.emulateMedia({reducedMotion:'no-preference'});
    const etaBox=await page.locator('#videoEta').boundingBox(),actionsBox=await page.locator('.actions').boundingBox();assert(etaBox.y+etaBox.height<=600);assert(actionsBox.y+actionsBox.height<=600);
    assert(await page.locator('#videoEta').isVisible());assert.match(await page.locator('#videoEtaText').textContent(),/Серия 1180.*Осталось ≈ 2 мин/);
    await page.screenshot({path:path.join(__dirname,'../diagnostics/ui/popup-eta-mp4.png'),fullPage:true});
    await page.evaluate(()=>window.changeState({paused:true}));assert.match(await page.locator('#videoEtaText').textContent(),/на паузе/);assert(!(await page.locator('#downloadMotion').isVisible()));
    assert(!(await page.locator('.meter-wave').isVisible()));assert.equal(await page.locator('#percent').textContent(),'1%');
    assert(await page.locator('#appLogo').isVisible());
    await page.evaluate(()=>window.changeState({paused:false,videoEta:{series:'1180',phase:'calculating',seconds:null,at:Date.now()}}));assert.match(await page.locator('#videoEtaText').textContent(),/Оцениваю/);
    await page.evaluate(()=>window.changeState({running:false,videoEta:null,status:'Готово к скачиванию.'}));assert(!(await page.locator('#videoEta').isVisible()));assert(!(await page.locator('#downloadMotion').isVisible()));
    assert(!(await page.locator('.meter-wave').isVisible()));
    assert(await page.locator('#appLogo').isVisible());
    await page.evaluate(()=>window.changeState({saving:true,status:'Сохраняю файл…'}));
    assert(await page.locator('#downloadMotion').isVisible());assert(!(await page.locator('#appLogo').isVisible()));
    await page.evaluate(()=>window.changeState({saving:false,inspecting:true,status:'Ищу список серий…'}));
    assert(await page.locator('#appLogo').isVisible());assert(!(await page.locator('#downloadMotion').isVisible()));
    await page.evaluate(()=>window.changeState({inspecting:false,status:'Ошибка'}));
    assert(await page.locator('#appLogo').isVisible());assert(!(await page.locator('#downloadMotion').isVisible()));
    await page.evaluate(()=>window.changeState({status:'Готово к скачиванию.'}));
    await page.evaluate(()=>window.changeState({running:true,total:2,done:0,status:'Серия 1 · Видео: 25 МБ',videoEta:{series:'1',phase:'calculating',progress:.25,at:Date.now()}}));
    assert.equal(await page.locator('#percent').textContent(),'12.5%');
    assert.equal(await page.locator('#progressBar').getAttribute('aria-valuenow'),'12.5');
    await page.evaluate(()=>window.changeState({done:1,videoEta:{series:'2',phase:'finishing',progress:1,at:Date.now()}}));
    assert.equal(await page.locator('#percent').textContent(),'99.9%','100% waits for actual file completion');
    await page.evaluate(()=>window.changeState({running:false,done:2,videoEta:null,status:'Скачанные серии сохранены.'}));
    assert.equal(await page.locator('#percent').textContent(),'100%');

    await page.evaluate(()=>renderUpdates({installedVersion:'2.3',latestVersion:'2.4',available:true,releaseUrl:'https://github.com/WildLIK/WildLib/releases/tag/v2.4'}));
    assert(await page.locator('#updateBanner').isVisible());assert.match(await page.locator('#updateTitle').textContent(),/2\.4/);
    assert.equal(await page.locator('#updateDownload').getAttribute('href'),'https://github.com/WildLIK/WildLib/releases/tag/v2.4');
    await page.evaluate(()=>renderUpdates({installedVersion:'2.3',latestVersion:'2.4',available:true,releaseUrl:'https://evil.test/'}));
    assert.equal(await page.locator('#updateDownload').getAttribute('href'),'https://github.com/WildLIK/WildLib/releases/latest');
    await page.locator('.settings > summary').click();await page.locator('.about > summary').click();
    assert.match(await page.locator('.disclaimer').textContent(),/Пользователь самостоятельно несёт ответственность/);
    await page.click('#checkUpdates');await page.waitForFunction(()=>document.querySelector('#updateBanner').hidden);
    assert(await page.evaluate(()=>window.calls.some(call=>call.type==='CHECK_UPDATES'&&call.force)));
    assert(!(await page.locator('.error-frame').isVisible()),'Update checks must not change the download/error phase');
    await page.screenshot({path:path.join(__dirname,'../diagnostics/ui/popup-about-2.3.png'),fullPage:true});
    console.log(`PASS popup: translator, refresh, pause/resume/stop, novel/manga formats, locked controls; ${overflow.height}px default height, no horizontal overflow.`);
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
