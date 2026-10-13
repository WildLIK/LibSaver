const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'../wildl_page_api'),context=vm.createContext({Blob,TextEncoder,setTimeout});
for(const file of ['export.js','zip-blob.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
(async()=>{
 const seed=Buffer.alloc(1048576);for(let i=0;i<seed.length;i++)seed[i]=(i*31+17)&255;
 const large=new Blob(Array(12).fill(new Blob([seed]))),files=[{name:'Сериал. 1.mp4',data:large},...Array.from({length:11},(_,i)=>({name:`Сериал. ${i+2}.mp4`,data:new Blob([seed])}))];
 context.files=files;const original=Blob.prototype.arrayBuffer,reads=[],progress=[];context.onProgress=p=>progress.push(p);
 Blob.prototype.arrayBuffer=function(){reads.push(this.size);assert(this.size<=4*1048576,'ZIP assembly must never materialize a whole episode or archive');return original.call(this);};
 let blob;try{blob=await vm.runInContext('zipBlob(files,"application/zip",onProgress)',context);}finally{Blob.prototype.arrayBuffer=original;}
 assert.equal(Math.max(...reads),4*1048576);assert.equal(progress.at(-1).index,12);
 const data=Buffer.from(await blob.arrayBuffer());let offset=0,count=0;
 while(data.readUInt32LE(offset)===0x04034b50){
  assert.equal(data.readUInt16LE(offset+8),0);const size=data.readUInt32LE(offset+18),nameLength=data.readUInt16LE(offset+26),name=data.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength;
  assert.equal(name,files[count].name);assert.equal(size,files[count].data.size);const content=data.subarray(start,start+size);
  assert(content.equals(Buffer.from(await files[count].data.arrayBuffer())));
  if(zlib.crc32)assert.equal(data.readUInt32LE(offset+14),zlib.crc32(content));
  count++;offset=start+size;
 }assert.equal(count,12);assert.equal(data.readUInt32LE(offset),0x02014b50);assert.equal(data.readUInt32LE(data.length-22),0x06054b50);assert.equal(data.readUInt16LE(data.length-12),12);
 // Reject ZIP32 overflow before reading any video, including header overhead.
 context.files=[{name:'Big.mp4',data:{[Symbol.toStringTag]:'Blob',size:0xffffffff}}];
 const overflowContext=vm.createContext({TextEncoder,setTimeout,Blob:class{constructor(){this.size=0xffffffff;}}});
 for(const file of ['export.js','zip-blob.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),overflowContext);
 overflowContext.files=[{name:'Big.mp4',data:new (vm.runInContext('Blob',overflowContext))()}];
 await assert.rejects(vm.runInContext('zipBlob(files)',overflowContext),/4 ГБ/);
 console.log('PASS Blob ZIP: twelve Unicode video filenames, exact bytes, independent CRC, valid directory/footer, at most 4 MiB per read, early ZIP32 overflow rejection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
