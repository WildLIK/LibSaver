const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.route('https://wildl.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);route.fulfill({body:fs.readFileSync(path.join(root,name)),contentType:name.endsWith('.js')?'application/javascript':'text/html'});});
 await page.addInitScript(()=>window.chrome={runtime:{onMessage:{addListener:()=>{}},sendMessage:async()=>({ok:true})}});await page.goto('https://wildl.test/offscreen.html');
 const result=await page.evaluate(async()=>{
  let active=0,max=0;window.downloadImage=async(message,job,p)=>{active++;max=Math.max(active,max);await imageSleep(job,20+(8-p.number)*3);active--;return {extension:'png',bytes:new Uint8Array([137,80,78,71,p.number])};};
  const chapter=(number)=>({kind:'manga',volume:'1',number:String(number),imageConcurrency:6,pages:Array.from({length:8},(_,index)=>({number:index+1,urls:['https://img3.cdnlibs.org/'+index]}))});
  await Promise.all([0,1,2].map(index=>storeChapter({jobId:'workers',index,chapter:chapter(index+1)})));
  const data=(await checkpointRead('workers')).map(row=>row.chapter.files.map(file=>file.data[4]));
  window.downloadImage=async()=>{throw Error('image failure');};let failed=false;
  try{await storeChapter({jobId:'failed',index:0,chapter:chapter(1)});}catch{failed=true;}
  const failedRows=await checkpointRead('failed');
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=450;const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,320,450);ctx.fillStyle='#222';ctx.fillText('Synthetic image',20,30);
  const source=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),original=new Uint8Array(await source.arrayBuffer());
  const compressed=await compactImage({bytes:original,extension:'png'}),bitmap=await createImageBitmap(new Blob([compressed.bytes]));
  return {max,data,failed,failedRows:failedRows.length,original:original.length,compressed:compressed.bytes.length,width:bitmap.width,height:bitmap.height};
 });assert.equal(result.max,6);assert.deepEqual(result.data,Array.from({length:3},()=>[1,2,3,4,5,6,7,8]));assert(result.failed);assert.equal(result.failedRows,0);
 assert(result.compressed<=result.original);assert.equal(result.width,320);assert.equal(result.height,450);
 const unified=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=80;const context=canvas.getContext('2d');context.fillStyle='#174050';context.fillRect(8,8,48,64);
  const encode=async mime=>new Uint8Array(await(await new Promise(resolve=>canvas.toBlob(resolve,mime,.9))).arrayBuffer());
  const jpeg=await encode('image/jpeg'),png=await encode('image/png'),webp=await encode('image/webp');
  const original=window.downloadImage;window.downloadImage=async(message,job,page)=>({bytes:[jpeg,png,webp][page.number-1],extension:['jpg','png','webp'][page.number-1]});
  try{await storeChapter({jobId:'unified-jpg',index:0,chapter:{kind:'manga',volume:'1',number:'1',imageFormat:'jpg',imageConcurrency:3,pages:[1,2,3].map(number=>({number,urls:[]}))}});}finally{window.downloadImage=original;}
  const files=(await checkpointRead('unified-jpg'))[0].chapter.files;const dimensions=[];
  for(const file of files){const bitmap=await createImageBitmap(new Blob([file.data]));dimensions.push([bitmap.width,bitmap.height]);bitmap.close();}
  const converted=await formatImage({bytes:png,extension:'png'},'jpg');const bitmap=await createImageBitmap(new Blob([converted.bytes]));context.clearRect(0,0,64,80);context.drawImage(bitmap,0,0);bitmap.close();
  return {names:files.map(file=>file.name),dimensions,unchanged:jpeg.every((byte,index)=>byte===files[0].data[index])&&jpeg.length===files[0].data.length,
    white:Array.from(context.getImageData(0,0,1,1).data),magic:files.map(file=>Array.from(file.data.slice(0,2)))};
 });assert.deepEqual(unified.names,['0001.jpg','0002.jpg','0003.jpg']);assert(unified.unchanged);assert.deepEqual(unified.dimensions,[[64,80],[64,80],[64,80]]);
 assert(unified.white.slice(0,3).every(value=>value>=250));assert.deepEqual(unified.magic,[[255,216],[255,216],[255,216]]);
 console.log('PASS unified manga JPG: JPEG copied byte-for-byte, PNG/WebP re-encoded to actual JPEG, exact dimensions, transparent background becomes white, ordered archive filenames.');
 console.log('PASS parallel images: global cap six across chapters, exact page order, failed chapters excluded from checkpoint; optional compression keeps dimensions and never increases size.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
