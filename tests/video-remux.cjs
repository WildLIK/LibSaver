const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api'),fixture=fs.readFileSync(path.join(__dirname,'fixtures/h264-colors.ts'));
(async()=>{const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true});try{
 const page=await browser.newPage();await page.route('https://wildl.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);return route.fulfill({body:name==='fixture.ts'?fixture:fs.readFileSync(path.join(root,name)),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.ts')?'video/mp2t':'text/html'});});
 await page.addInitScript(()=>window.chrome={runtime:{onMessage:{addListener:()=>{}},sendMessage:async message=>{(window.mediaMessages ||= []).push(message);return {ok:true};}}});await page.goto('https://wildl.test/offscreen.html');
 const result=await page.evaluate(async()=>{
  const bytes=new Uint8Array(await(await fetch('fixture.ts')).arrayBuffer()),job=getJob('remux');job.videoMessage={chapter:{number:'1'}};
  const blob=await videoRemuxTs([new Blob([bytes.slice(0,1128)]),new Blob([bytes.slice(1128)])],job.videoMessage,job);
  const video=document.createElement('video');video.muted=true;video.src=URL.createObjectURL(blob);document.body.append(video);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MP4 metadata timeout')),10000);video.onloadedmetadata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(Error('MP4 decode failed: '+video.error?.message));};});
  const duration=video.duration;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MP4 seek timeout')),10000);video.onseeked=()=>{clearTimeout(timer);resolve();};video.currentTime=1.25;});
  const output=new Uint8Array(await blob.arrayBuffer());return {size:blob.size,header:String.fromCharCode(...output.slice(4,8)),duration,width:video.videoWidth,height:video.videoHeight,ready:video.readyState};
 });assert.equal(result.header,'ftyp');assert(result.duration>=1.9&&result.duration<=2.1,JSON.stringify(result));assert.equal(result.width,64);assert.equal(result.height,64);assert(result.ready>=2);
 const assembled=await page.evaluate(async()=>{const source=new Uint8Array(await(await fetch('fixture.ts')).arrayBuffer()),original=window.fetch;
  window.fetch=async(url,options)=>{
   if(String(url).includes('video1.cdnlibs.org')){if(String(url).endsWith('.m3u8'))return new Response('#EXTM3U\n#EXTINF:1,\nfirst.ts\n#EXTINF:1,\nsecond.ts\n#EXT-X-ENDLIST',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
    const bytes=String(url).includes('first.ts')?source.slice(0,1128):source.slice(1128);return new Response(bytes,{headers:{'Content-Type':'video/mp2t','Content-Length':String(bytes.length)}});}
   return original(url,options);
  };
  try{await storeChapter({jobId:'hls-to-mp4',index:0,chapter:{kind:'anime',volume:'1',number:'1',outputFormat:'files',videoPlayer:{player:'Animelib',src:'https://video1.cdnlibs.org/main.m3u8'}}});}
  finally{window.fetch=original;}
  const file=(await checkpointRead('hls-to-mp4'))[0].chapter.files[0],bytes=new Uint8Array(await file.data.slice(0,8).arrayBuffer());
  return {name:file.name,header:String.fromCharCode(...bytes.slice(4,8)),logs:mediaMessages.filter(item=>item.type==='VIDEO_LOG').map(item=>item.text)};
 });assert.equal(assembled.name,'Серия 1.mp4');assert.equal(assembled.header,'ftyp');
 assert(assembled.logs.some(text=>text.includes('HLS')));assert(assembled.logs.some(text=>text.includes('TS → MP4')));assert(assembled.logs.some(text=>text.includes('средняя скорость')));
 const rejected=await page.evaluate(async()=>{const source=new Uint8Array(await(await fetch('fixture.ts')).arrayBuffer());source[205]=0x24;const job=getJob('unsupported');
  try{await videoRemuxTs([new Blob([source])],{jobId:'unsupported',chapter:{number:'1'}},job);return false;}catch(error){return error.noFallback&&/кодек/.test(error.message);}});assert(rejected,'Unsupported HEVC TS must not produce a silent video-only MP4');
 console.log('PASS actual worker TS → MP4: own four-color H.264 fixture, two source parts, standalone browser playback/seek, 64×64, correct two-second duration.',result);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
