const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../wildl_page_api');
function zipFiles(bytes){
 const buffer=Buffer.from(bytes),files=new Map();let offset=0;
 while(buffer.readUInt32LE(offset)===0x04034b50){
  assert.equal(buffer.readUInt16LE(offset+8),0);
  const size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extraLength=buffer.readUInt16LE(offset+28);
  const start=offset+30+nameLength+extraLength;
  files.set(buffer.subarray(offset+30,offset+30+nameLength).toString('utf8'),buffer.subarray(start,start+size));offset=start+size;
 }
 return files;
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.route('https://wildl.test/**',route=>{
   const name=new URL(route.request().url()).pathname.slice(1);
   return route.fulfill({body:fs.readFileSync(path.join(root,name)),contentType:name.endsWith('.js')?'application/javascript':'text/html'});
  });
  await page.addInitScript(()=>window.chrome={runtime:{onMessage:{addListener:()=>{}},sendMessage:async()=>({ok:true})}});
  await page.goto('https://wildl.test/offscreen.html');
  const outputs=await page.evaluate(async()=>{
   const title='Манга & <тест>',bookInfo={summary:'Описание & пример\u0001',writers:['Автор & Соавтор','Автор & Соавтор'],artists:['Художник'],sourceUrl:'https://mangalib.me/ru/manga/1--test'};
   const result=[];
   await checkpointWrite('manga',0,{kind:'manga',volume:'1',number:'1',files:[{name:'0001.png',data:new Uint8Array([137,80,78,71])},{name:'0002.png',data:new Uint8Array([137,80,78,71])}]});
   await checkpointWrite('manga',2,{kind:'manga',volume:'1',number:'3',files:[{name:'0001.png',data:new Uint8Array([137,80,78,71])}]});
   jobs.delete('manga'); // Recover completed chapters from IndexedDB, as after a restart.
   for(const format of ['cbz','zip','cbr']){
    const file=await exportJob({jobId:'manga',kind:'manga',title,total:3,format,partial:true,bookInfo,skipped:[{index:1,volume:'1',number:'2',reason:'Нет доступа'}]});
    result.push({format,bytes:Array.from(new Uint8Array(await(await fetch(file.url)).arrayBuffer()))});
   }
   const xml=makeComicInfo(title,[{volume:'1',number:'1'}],2,bookInfo);
   const doc=new DOMParser().parseFromString(xml,'application/xml');
   if(doc.querySelector('parsererror'))throw Error('Malformed ComicInfo XML');
   return {outputs:result,xml,fields:Object.fromEntries([...doc.documentElement.children].map(item=>[item.tagName,item.textContent]))};
  });
  assert.equal(outputs.fields.Title,'Манга & <тест>');assert.equal(outputs.fields.Summary,'Описание & пример');
  assert.equal(outputs.fields.Writer,'Автор & Соавтор');assert.equal(outputs.fields.Number,'1');assert.equal(outputs.fields.PageCount,'2');
  for(const item of outputs.outputs){
   const bytes=Buffer.from(item.bytes);
   if(item.format==='cbr'){
    assert.deepEqual([...bytes.subarray(0,8)],[82,97,114,33,26,7,1,0]);
    assert(bytes.includes(Buffer.from('ComicInfo.xml')));assert(bytes.includes(Buffer.from('<PageCount>3</PageCount>')));continue;
   }
   const files=zipFiles(bytes);assert.equal([...files.keys()].filter(name=>name.endsWith('.png')).length,3);
   const xml=files.get('ComicInfo.xml').toString('utf8');assert.match(xml,/<PageCount>3<\/PageCount>/);
   assert(!xml.includes('<Number>'),'A multi-chapter collection must not pretend to be a single numbered issue');
   assert.match(xml,/глава 1; Том 1, глава 3/);assert(!xml.includes('глава 2'));
   assert(files.has('_Пропущенные_главы.txt'));
  }
  console.log('PASS ComicInfo: actual CBZ/ZIP/CBR output, partial archive restored from IndexedDB, page counts, XML escaping, omitted unknown metadata.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
