const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.route('https://wildl.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);return route.fulfill({body:fs.readFileSync(path.join(root,name)),contentType:name.endsWith('.js')?'application/javascript':'text/html'});});
 await page.addInitScript(()=>window.chrome={runtime:{onMessage:{addListener:()=>{}},sendMessage:async()=>({ok:true})}});await page.goto('https://wildl.test/offscreen.html');
 async function fixture(fail=false){await page.evaluate(fail=>{
   window.requests=[];window.active=0;window.maximum=0;window.failed=fail;
   window.fetch=async(url,options={})=>{
     const path=new URL(url).pathname;window.requests.push(path);
     if(path.endsWith('m3u8'))return new Response('#EXTM3U\n'+Array.from({length:8},(_,i)=>'#EXTINF:6,\n'+i+'.ts').join('\n')+'\n#EXT-X-ENDLIST',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
     const part=Number(path.match(/(\d+)\.ts/)[1]);active++;maximum=Math.max(maximum,active);
     try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,part===5&&failed?220:20+(7-part)*9);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('aborted','AbortError'));},{once:true});});
       if(failed&&part===5)return new Response('',{status:403});const bytes=new Uint8Array(188);bytes[0]=0x47;bytes[1]=part;return new Response(bytes,{headers:{'Content-Type':'video/mp2t'}});
     }finally{active--;}
   };
   window.message={jobId:'hls-resume',index:0,chapter:{kind:'anime',videoContainer:'original',number:'1180',volume:'1',quality:'max',videoRanges:true,outputFormat:'files',videoConcurrency:4,videoPlayer:{player:'Animelib',src:'https://video1.cdnlibs.org/index.m3u8'}}};
 },fail);}
 await fixture(true);
 const failed=await page.evaluate(async()=>{let error;try{await storeChapter(message);}catch(e){error=e.message;}
  const rows=await new Promise(async(resolve,reject)=>{const db=await videoCacheDb(),r=db.transaction('parts').objectStore('parts').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return {error,maximum,parts:rows.map(row=>row.part),complete:(await checkpointRead(message.jobId)).length};});
 assert.match(failed.error,/403/);assert.equal(failed.maximum,4);assert(failed.parts.length>0&&failed.parts.length<8);assert.equal(failed.complete,0);
 await page.reload();await fixture(false);
 const resumed=await page.evaluate(async()=>{await storeChapter(message);const chapter=(await checkpointRead(message.jobId))[0].chapter;
  const bytes=new Uint8Array(await chapter.files[0].data.arrayBuffer());const db=await videoCacheDb();const count=await new Promise(resolve=>{const r=db.transaction('parts').objectStore('parts').count();r.onsuccess=()=>resolve(r.result);});
  return {order:Array.from({length:8},(_,i)=>bytes[i*188+1]),requests,maximum,count};});
 assert.deepEqual(resumed.order,[0,1,2,3,4,5,6,7]);assert.equal(resumed.count,0);
 for(const part of failed.parts)assert(!resumed.requests.includes('/'+part+'.ts'),'Persisted fragment fetched again: '+part);
 assert(resumed.maximum<=4);
 const binary=await page.evaluate(async()=>{const decoder=window.TextDecoder;window.TextDecoder=class{constructor(){throw Error('binary decoded');}};
  window.fetch=async()=>new Response(new Uint8Array([0,0,0,12,102,116,121,112,0,0,0,1]),{headers:{'Content-Type':'video/mp4'}});
  try{const result=await videoFetch(getJob('binary'),'https://video1.cdnlibs.org/b.mp4');return {text:'text' in result,length:result.bytes.length};}finally{window.TextDecoder=decoder;}});
 assert.equal(binary.text,false);assert.equal(binary.length,12);
 const rangeResult=await page.evaluate(async()=>{
  const total=16*1024*1024+19;window.calls=[];window.active=0;window.maximum=0;
  window.fetch=async(url,options={})=>{const match=options.headers?.Range?.match(/bytes=(\d+)-(\d+)/);calls.push(options.headers?.Range||'full');
   if(!match)throw Error('unexpected full request');const start=Number(match[1]),end=Number(match[2]);active++;maximum=Math.max(maximum,active);
   try{await new Promise(resolve=>setTimeout(resolve,start===0?40:10));const bytes=new Uint8Array(end-start+1).fill(Math.floor(start/(8*1024*1024)));
     if(start===0&&end>0)bytes.set([0,0,0,12,102,116,121,112]);
     return new Response(bytes,{status:206,headers:{'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${total}`,ETag:'"v1"'}});
   }finally{active--;}
  };
  const m={jobId:'range',index:0,chapter:{kind:'anime',volume:'1',number:'2',quality:'max',outputFormat:'files',videoPlayer:{player:'Animelib',video:{quality:[{quality:720,src:'https://video1.cdnlibs.org/low.mp4'},{quality:2160,src:'https://video1.cdnlibs.org/high.mp4'}]}}}};
  await storeChapter(m);const c=(await checkpointRead('range'))[0].chapter;const b=c.files[0].data;
  return {calls,maximum,size:b.size,prefix:Array.from(new Uint8Array(await b.slice(4,8).arrayBuffer())),middle:new Uint8Array(await b.slice(8*1024*1024,8*1024*1024+1).arrayBuffer())[0],last:new Uint8Array(await b.slice(-1).arrayBuffer())[0]};
 });
 assert.equal(rangeResult.calls.length,4);assert.equal(rangeResult.calls[0],'bytes=0-0');assert.equal(rangeResult.maximum,3);assert.equal(rangeResult.size,16*1024*1024+19);assert.deepEqual(rangeResult.prefix,[102,116,121,112]);assert.equal(rangeResult.middle,1);assert.equal(rangeResult.last,2);
 const unsupported=await page.evaluate(async()=>{let calls=0,cancelled=0;window.fetch=async(url,options)=>{calls++;if(options.headers?.Range)return new Response(new ReadableStream({cancel(){cancelled++;}}),{status:200});return new Response(new Uint8Array([0,0,0,12,102,116,121,112,0,0,0,1]),{headers:{'Content-Type':'video/mp4'}});};
  const file=await downloadVideo({jobId:'no-range',chapter:{number:'1',outputFormat:'files',videoPlayer:{player:'Animelib',src:'https://video1.cdnlibs.org/no.mp4'}}},getJob('no-range'));return {calls,cancelled,size:file.data.size};});
 assert.deepEqual(unsupported,{calls:2,cancelled:1,size:12});
 const resumeRanges=await page.evaluate(async()=>{
  const total=16*1024*1024+19,partSize=8*1024*1024;let fail=true;const paths=[];
  window.fetch=async(url,options={})=>{const [start,end]=options.headers.Range.slice(6).split('-').map(Number);paths.push(start);
   if(end>0&&start===partSize&&fail){await new Promise(resolve=>setTimeout(resolve,80));return new Response('',{status:403});}
   const data=new Uint8Array(end-start+1).fill(Math.floor(start/partSize));if(start===0&&end>0)data.set([0,0,0,12,102,116,121,112]);
   return new Response(data,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${total}`,ETag:'"r1"'}});
  };
  const m={jobId:'range-resume',index:0,chapter:{kind:'anime',volume:'1',number:'3',outputFormat:'files',videoPlayer:{player:'Animelib',src:'https://video1.cdnlibs.org/r.mp4'}}};
  let error;try{await storeChapter(m);}catch(e){error=e.message;}
  const signature=JSON.stringify(['range','https://video1.cdnlibs.org/r.mp4',total,'"r1"','ETag']);
  const cached=await videoCacheRead(m.jobId,0,signature);paths.length=0;fail=false;jobs.delete(m.jobId);
  await storeChapter(m);return {error,cached:cached.map(row=>row.part),paths};
 });
 assert.match(resumeRanges.error,/403/);assert.deepEqual(resumeRanges.cached.sort(),[0,2]);
 assert.deepEqual(resumeRanges.paths,[0,8*1024*1024],'Only a fresh validator probe and the missing MP4 part may be requested');
 const cooldown=await page.evaluate(async()=>{
  const j=getJob('cooldown');j.videoMessage={chapter:{number:'1',limitPause:1}};let first=true,inCooldown=false,violations=0,sleeps=0;
  const originalSleep=imageSleep;window.imageSleep=async(job,ms)=>{sleeps++;inCooldown=true;await new Promise(resolve=>setTimeout(resolve,40));inCooldown=false;};
  window.fetch=async(url)=>{if(inCooldown)violations++;if(first){first=false;return new Response('',{status:429,headers:{'Retry-After':'1'}});}return new Response(new Uint8Array([1]));};
  try{await Promise.all(Array.from({length:4},()=>videoFetch(j,'https://video1.cdnlibs.org/c.ts')));return {violations,sleeps,workers:j.videoWorkers};}finally{window.imageSleep=originalSleep;}
 });assert.equal(cooldown.violations,0);assert.equal(cooldown.sleeps,1);assert.equal(cooldown.workers,2);
 const changingRange=await page.evaluate(async()=>{
  let probes=0,full=0;window.fetch=async(url,options={})=>{
   if(options.headers?.Range==='bytes=0-0'){probes++;return new Response(new Uint8Array([0]),{status:206,headers:{'Content-Range':'bytes 0-0/8388627',ETag:'"z"'}});}
   if(options.headers?.Range)return new Response(new ReadableStream({cancel(){}}),{status:200});
   full++;return new Response(new Uint8Array([0,0,0,12,102,116,121,112,0,0,0,1]),{headers:{'Content-Type':'video/mp4'}});
  };
  const file=await downloadVideo({jobId:'changed-range',index:0,chapter:{number:'1',outputFormat:'files',videoPlayer:{player:'Animelib',src:'https://video1.cdnlibs.org/changed.mp4'}}},getJob('changed-range'));
  return {probes,full,size:file.data.size};
 });assert.deepEqual(changingRange,{probes:1,full:1,size:12});
 const large=await page.evaluate(async()=>{
  window.fetch=async()=>new Response(new Uint8Array([0]),{status:206,headers:{'Content-Range':'bytes 0-0/5368709120',ETag:'"large"'}});
  const j=getJob('large');j.videoMessage={chapter:{outputFormat:'files'}};const result=await probeVideoRange(j,'https://video1.cdnlibs.org/large.mp4');
  j.videoMessage.chapter.outputFormat='zip';let rejected=false;try{await probeVideoRange(j,'https://video1.cdnlibs.org/large.mp4');}catch{rejected=true;}return {total:result.total,rejected};
 });assert.equal(large.total,5368709120);assert(large.rejected);
 const invalid=await page.evaluate(async()=>{window.fetch=async()=>new Response(new Uint8Array([1]),{status:206,headers:{'Content-Range':'bytes 0-0/100',ETag:'"changed"'}});
  try{await videoFetch(getJob('bad-range'),'https://video1.cdnlibs.org/bad.mp4',{range:{start:0,end:0,total:100,validator:'"old"',validatorHeader:'ETag'}});return false;}catch(error){return /изменилась/.test(error.message);}});assert(invalid);
 console.log('PASS video transfer: four concurrent HLS fragments, ordered Blob, durable partial resume after page reload, no duplicate fragments, binary never decoded; MP4 max quality, verified parallel ranges, ignored Range cancels probe + single fallback, changed validator rejected.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
