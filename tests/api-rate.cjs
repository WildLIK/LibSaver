const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.resolve(__dirname,'../wildl_page_api/page.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  async function scenario(mode){
   const page=await browser.newPage(),requests=[];let limited=false,cooldown=0;
   const origin=mode==='manga'?'https://mangalib.me':'https://ranobelib.me';
   await page.route(origin+'/**',route=>route.fulfill({body:'<html></html>'}));
   await page.route('https://api.cdnlibs.org/**',async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Site-Id,Accept'}});
    requests.push({at:Date.now(),path:url.pathname,query:url.search});
    let data;
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Expose-Headers':'Retry-After'};
    if(url.pathname.endsWith('/chapters'))data=Array.from({length:6},(_,index)=>({number:String(index+1),volume:'1',index,branches:[]}));
    else if(url.pathname.endsWith('/chapter')){
     if(mode==='429'&&!limited){limited=true;cooldown=Date.now();return route.fulfill({status:429,body:'Превышен лимит',headers:{...headers,'Retry-After':'2'}});}
     data={name:'Глава',content:'<p>Синтетический текст.</p>',pages:[{slug:1,url:'/manga/page.png'}]};
    }else if(url.pathname.endsWith('/constants'))data={imageServers:[{site_ids:[1],id:'main',url:'https://img3.cdnlibs.org'}]};
    else data={rus_name:'Тестовый тайтл',summary:'<p>Описание &amp; пример</p><script>ignored()</script>',authors:[{name:'Автор'}],artists:[{rus_name:'Художник'}],genres:[{name:'Фантастика'}],publisher:{name:'Издатель'}};
    await route.fulfill({contentType:'application/json',body:JSON.stringify({data}),headers});
   });
   await page.goto(origin+'/ru/'+(mode==='manga'?'manga':'book')+'/1--rate-test');
   await page.addScriptTag({content:source});
   await page.evaluate(mode=>{
    window.messages=[];
    window.addEventListener('message',event=>{
     if(event.data?.source!=='wildl-page')return;
     window.messages.push(event.data);
     if(event.data.type==='chapter')window.postMessage({source:'wildl-ext',jobId:'rate',type:'chapter-ack',index:event.data.index,ok:true},location.origin);
    });
    pageDownloader('rate',{apiRate:120,concurrency:6,from:1,to:6,imageMode:mode==='manga'?'server':'original',site:mode==='manga'?{id:1,kind:'manga',name:'MangaLib'}:{id:3,kind:'novel',name:'RanobeLib'}});
   },mode);
   if(mode==='pause'||mode==='stop'){
    await page.waitForFunction(()=>window.messages.some(item=>item.type==='meta'));
    await page.evaluate(type=>window.postMessage({source:'wildl-ext',jobId:'rate',type},location.origin),mode);
    await page.waitForFunction(mode=>window.messages.some(item=>mode==='pause'?item.type==='control'&&item.paused:item.type==='error'),mode);
    const count=requests.length;
    await page.waitForTimeout(900);assert.equal(requests.length,count,mode+' must interrupt queued API work');
    if(mode==='stop'){await page.close();return;}
    await page.evaluate(()=>window.postMessage({source:'wildl-ext',jobId:'rate',type:'resume'},location.origin));
   }
   await page.waitForFunction(()=>window.messages.some(item=>item.type==='done'||item.type==='error'),null,{timeout:15000}).catch(async error=>{console.log(mode,requests,await page.evaluate(()=>window.messages));throw error;});
   const result=await page.evaluate(()=>window.messages.find(item=>item.type==='error')||window.messages.find(item=>item.type==='done'));
   assert.equal(result.type,'done',JSON.stringify(result));assert.equal(result.done,6);
   if(mode==='manga'){
    const info=await page.evaluate(()=>window.messages.find(item=>item.type==='meta').bookInfo);
    assert.deepEqual(info,{summary:'Описание & пример',writers:['Автор'],artists:['Художник'],genres:['Фантастика'],publishers:['Издатель'],sourceUrl:'https://mangalib.me/ru/manga/1--rate-test'});
    assert.equal(requests.filter(item=>!item.path.endsWith('/chapter')).length,3,'Metadata should use the existing title request, without a separate API call');
    assert(requests.filter(item=>item.path.endsWith('/chapter')).every(item=>new URLSearchParams(item.query).get('server')==='compress'));
   }
   for(let index=1;index<requests.length;index++)assert(requests[index].at-requests[index-1].at>=440,'All API workers must share a paced queue');
   if(mode==='429'){
    const later=requests.filter(item=>item.at>cooldown+50);
    assert(later.length>0);assert(later[0].at-cooldown>=1950,'429 cooldown must hold other workers, not just the failed request');
   }
   await page.close();
  }
  for(const mode of ['parallel','429','pause','stop','manga'])await scenario(mode);
  console.log('PASS API pacing: parallel workers, shared Retry-After cooldown, pause/resume without a burst, cancellation of queued work; manga metadata from the existing title request.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
