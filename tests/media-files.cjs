const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api');
(async()=>{const browser=await chromium.launch({executablePath:process.env.WILDL_CHROME||chromium.executablePath(),headless:true});try{
 const page=await browser.newPage();await page.route('https://media.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1)||'offscreen.html';route.fulfill({body:fs.readFileSync(path.join(root,name)),contentType:name.endsWith('.js')?'application/javascript':'text/html'});});
 await page.addInitScript(()=>window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async()=>({ok:true})}});await page.goto('https://media.test/offscreen.html');
 const report=await page.evaluate(async()=>{
  const originalPut=IDBObjectStore.prototype.put;
  function hasBlob(value){return value instanceof Blob||!!value&&typeof value==='object'&&Object.values(value).some(hasBlob);}
  IDBObjectStore.prototype.put=function(value,...args){if(hasBlob(value))throw new DOMException('Failed to write blobs (InvalidBlob)','DataError');return originalPut.call(this,value,...args);};
  try{
   for(let index=0;index<8;index++){
    const output=await mediaOutput('eight-series','video/mp4');
    for(let part=0;part<8;part++){const bytes=new Uint8Array(4*1048576).fill(index*8+part);await output.write(bytes);}
    const file=await output.finish();await checkpointWrite('eight-series',index,{kind:'anime',volume:'1',number:String(index+1),files:[{name:'Episode '+(index+1)+'.mp4',data:file}]});
   }
   const db=await checkpointDb(),rows=await new Promise((resolve,reject)=>{const r=db.transaction('chapters').objectStore('chapters').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   if(rows.some(hasBlob)||rows.some(r=>!mediaReference(r.chapter.files[0].data)))throw Error('Video bytes entered IndexedDB');
   const job=await loadJob('eight-series'),files=[];for(const chapter of job.chapters)files.push({name:chapter.files[0].name,data:await mediaFile(chapter.files[0].data)});
   const before=(await navigator.storage.estimate()).usage;
   const exported=await exportJob({jobId:'eight-series',kind:'anime',title:'Eight episodes',format:'zip',total:8,done:8});
   const after=(await navigator.storage.estimate()).usage;
   if(after-before>1048576)throw Error('ZIP export duplicated the video payload in OPFS');
   try{await mediaDirectory('archive-eight-series');throw Error('ZIP export created an intermediate archive');}catch(error){if(error.name!=='NotFoundError')throw error;}
   const zip=await (await fetch(exported.url)).blob();
   const first=new Uint8Array(await zip.slice(0,30).arrayBuffer()),footer=new Uint8Array(await zip.slice(-22).arrayBuffer());
   if(new DataView(footer.buffer).getUint16(10,true)!==8)throw Error('Incomplete ZIP');
   for(let i=0;i<8;i++){const file=await mediaFile(rows[i].chapter.files[0].data),head=new Uint8Array(await file.slice(0,1).arrayBuffer()),tail=new Uint8Array(await file.slice(-1).arrayBuffer());if(head[0]!==i*8||tail[0]!==i*8+7)throw Error('Data changed');}
   // Reproduce a dead stored file, then repair only this episode.
   await mediaDeleteFile(rows[3].chapter.files[0].data);jobs.delete('eight-series');const damaged=await loadJob('eight-series');await checkStoredMedia(damaged);
   const valid=damaged.chapters.map((chapter,index)=>chapter&&!chapter.mediaError?index:null).filter(index=>index!==null);
   if(valid.length!==7||valid.includes(3))throw Error('A missing file counted as downloaded');
   let requests=0;window.fetch=async()=>{requests++;return new Response(new Uint8Array([0,0,0,12,102,116,121,112,0,0,0,1]),{headers:{'Content-Type':'video/mp4'}});};
   await storeChapter({jobId:'eight-series',index:3,chapter:{kind:'anime',volume:'1',number:'4',outputFormat:'zip',videoRanges:false,videoPlayer:{player:'Kodik',src:'https://p14.solodcdn.com/repair.mp4'}}});
   await checkStoredMedia(damaged);if(requests!==1||damaged.chapters.some(c=>c.mediaError))throw Error('Damaged episode recovery failed');
   URL.revokeObjectURL(exported.url);retained.delete(exported.url);
   await checkpointDelete('eight-series');await mediaDeleteJob('archive-eight-series');
   return {series:8,bytes:zip.size,firstSignature:[...first.slice(0,4)],requests,temporaryZipBytes:after-before};
  }finally{IDBObjectStore.prototype.put=originalPut;}
 });assert.equal(report.series,8);assert(report.bytes>256*1048576);assert.deepEqual(report.firstSignature,[80,75,3,4]);assert.equal(report.requests,1);
 console.log('PASS OPFS media: eight unique 32 MiB videos, IndexedDB Blob writes forcibly rejected, metadata-only checkpoints, readable ZIP with no intermediate OPFS copy, seven healthy episodes retained and one repaired.',report);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
