const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'../wildl_page_api');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.goto('about:blank');
 for(const name of ['export.js','zip-compact.js','formats.js','mobi.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8')});
 const result=await page.evaluate(async()=>{
  const text='Кириллица, эмодзи 🦊 и форматирование. '.repeat(1300),chapters=[{volume:'1',number:'1',name:'Глава',text}];
  const compact=await makeEpub('Тест',chapters),mobi=makeMobi('Тест',chapters);
  return {epub:Array.from(new Uint8Array(await compact.arrayBuffer())),mobi:Array.from(new Uint8Array(await mobi.arrayBuffer())),crc:crc32(new TextEncoder().encode('123456789')),text};
 });assert.equal(result.crc,0xcbf43926);
 const epub=Buffer.from(result.epub);let offset=0,compressed=0;
 while(epub.readUInt32LE(offset)===0x04034b50){const method=epub.readUInt16LE(offset+8),size=epub.readUInt32LE(offset+18),nameLength=epub.readUInt16LE(offset+26),extra=epub.readUInt16LE(offset+28);
  const name=epub.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extra,data=epub.subarray(start,start+size);
  if(name==='mimetype')assert.equal(method,0);
  if(method===8){compressed++;const raw=zlib.inflateRawSync(data);assert.equal(raw.length,epub.readUInt32LE(offset+22));if(name.endsWith('/c1.xhtml'))assert(raw.toString('utf8').includes(result.text));}
  offset=start+size;
 }assert(compressed>0);assert(epub.length<Buffer.byteLength(result.text)*.3);
 const mobi=Buffer.from(result.mobi);assert.equal(mobi.subarray(60,68).toString(),'BOOKMOBI');const count=mobi.readUInt16BE(76),first=mobi.readUInt32BE(78),recordCount=mobi.readUInt16BE(first+8);
 assert.equal(mobi.readUInt32BE(first+28),65001);const records=[];
 for(let i=1;i<=recordCount;i++){const start=mobi.readUInt32BE(78+i*8),end=mobi.readUInt32BE(78+(i+1)*8);const chunk=mobi.subarray(start,end);assert(chunk.length<=4096);assert(!chunk.toString('utf8').includes('\ufffd'));records.push(chunk);}
 assert.equal(count,recordCount+4);const html=Buffer.concat(records).toString('utf8');assert(html.includes(result.text));
 console.log('PASS fast CRC32, DEFLATE EPUB with stored mimetype and exact Cyrillic text; real UTF-8 MOBI records without split Unicode characters.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
