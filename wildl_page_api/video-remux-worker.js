// Runs in a packaged worker: no remote scripts and no video re-encoding.
importScripts('vendor/mux-mp4.min.js');
let transmuxer,initSegment,tracks,timescales,ends,outputCount=0,psiBuffers,pmtPids,streamTypes,pmtSeen;
function inspectSection(pid,section){
 if(pid===0&&section[0]===0){
  const programs=[];for(let i=8;i+4<=section.length-4;i+=4)if(section[i]||section[i+1])programs.push(((section[i+2]&31)<<8)|section[i+3]);
  if(programs.length>1)throw Error('В TS несколько программ. Выберите «Исходный контейнер».');for(const id of programs)pmtPids.add(id);
 }else if(pmtPids.has(pid)&&section[0]===2){
  pmtSeen=true;let offset=12+(((section[10]&15)<<8)|section[11]),videos=0,audios=0;
  while(offset+5<=section.length-4){const type=section[offset];
   if(![0x1b,0x0f,0x15].includes(type))throw Error('В TS неподдерживаемый кодек/дорожка (0x'+type.toString(16)+'). Выберите «Исходный контейнер».');
   if(type===0x1b)videos++;if(type===0x0f)audios++;streamTypes.add(type);offset+=5+(((section[offset+3]&15)<<8)|section[offset+4]);
  }
  if(videos>1||audios>1)throw Error('В TS несколько дорожек одного типа. Выберите «Исходный контейнер».');
 }
}
function psiAppend(pid,bytes){let current=psiBuffers.get(pid)||new Uint8Array(),data=new Uint8Array(current.length+bytes.length);data.set(current);data.set(bytes,current.length);
 while(data.length>=3&&data[0]!==255){const size=3+(((data[1]&15)<<8)|data[2]);if(size>4096)throw Error('Повреждена таблица дорожек TS.');if(data.length<size)break;inspectSection(pid,data.subarray(0,size));data=data.slice(size);}
 psiBuffers.set(pid,data[0]===255?new Uint8Array():data);
}
function inspectTs(bytes){
 for(let offset=0;offset+188<=bytes.length;offset+=188){
  if(bytes[offset]!==0x47)throw Error('Повреждён пакет TS.');const pid=((bytes[offset+1]&31)<<8)|bytes[offset+2],control=(bytes[offset+3]>>4)&3;
  if(!(control&1)||pid!==0&&!pmtPids.has(pid))continue;
  let payload=offset+4;if(control&2)payload+=1+bytes[payload];if(payload>=offset+188)continue;
  if(bytes[offset+1]&0x40){const pointer=bytes[payload++];if(pointer&&psiBuffers.get(pid)?.length)psiAppend(pid,bytes.subarray(payload,payload+pointer));payload+=pointer;psiBuffers.delete(pid);}
  if(payload<offset+188)psiAppend(pid,bytes.subarray(payload,offset+188));
 }
}
function boxes(bytes,start=0,end=bytes.length){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result=[];
 for(let offset=start;offset+8<=end;){let size=view.getUint32(offset),header=8;
  if(size===1){size=view.getUint32(offset+8)*4294967296+view.getUint32(offset+12);header=16;}
  if(!size)size=end-offset;
  if(size<header||offset+size>end)throw Error('Повреждена структура MP4.');
  result.push({type:String.fromCharCode(...bytes.subarray(offset+4,offset+8)),start:offset,data:offset+header,end:offset+size});offset+=size;
 }return result;
}
function child(bytes,parent,type){return boxes(bytes,parent.data,parent.end).find(box=>box.type===type);}
function timing(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(const moof of boxes(bytes).filter(box=>box.type==='moof'))for(const traf of boxes(bytes,moof.data,moof.end).filter(box=>box.type==='traf')){
  const tfhd=child(bytes,traf,'tfhd'),tfdt=child(bytes,traf,'tfdt');if(!tfhd||!tfdt)throw Error('Не найдены временные метки MP4.');
  const flags=view.getUint32(tfhd.data)&0xffffff,id=view.getUint32(tfhd.data+4);let offset=tfhd.data+8,defaultDuration=0;
  if(flags&1)offset+=8;if(flags&2)offset+=4;if(flags&8){defaultDuration=view.getUint32(offset);offset+=4;}
  const version=bytes[tfdt.data];let time=version?view.getUint32(tfdt.data+4)*4294967296+view.getUint32(tfdt.data+8):view.getUint32(tfdt.data+4);
  for(const trun of boxes(bytes,traf.data,traf.end).filter(box=>box.type==='trun')){
   const version=bytes[trun.data],flags=view.getUint32(trun.data)&0xffffff,count=view.getUint32(trun.data+4);let offset=trun.data+8;
   if(flags&1)offset+=4;if(flags&4)offset+=4;
   for(let i=0;i<count;i++){
    const duration=flags&256?view.getUint32(offset):defaultDuration;if(flags&256)offset+=4;
    if(flags&512)offset+=4;if(flags&1024)offset+=4;
    let composition=0;if(flags&2048){composition=version?view.getInt32(offset):view.getUint32(offset);offset+=4;}
    time+=duration;ends[id]=Math.max(ends[id]||0,time+composition);
   }
  }
 }
}
function writeDuration(view,bytes,box,offset0,offset1,duration){
 const offset=box.data+(bytes[box.data]===1?offset1:offset0),value=Math.ceil(duration);
 if(bytes[box.data]===1){view.setUint32(offset,Math.floor(value/4294967296));view.setUint32(offset+4,value%4294967296);}
 else{if(value>0xfffffffe)throw Error('Слишком большая длительность MP4 для этого контейнера.');view.setUint32(offset,value);}
}
function finalize(){
 if(!pmtSeen)throw Error('Не удалось проверить дорожки TS. Выберите «Исходный контейнер».');
 if(streamTypes.has(0x0f)&&!tracks.some(track=>track.type==='audio'))throw Error('Не удалось сохранить звуковую дорожку. Выберите «Исходный контейнер».');
 if(!initSegment||!outputCount)throw Error('В TS не найдены поддерживаемые аудио и видео.');
 const video=tracks.filter(track=>track.type==='video');if(!video.length||video.some(track=>!/^avc1/.test(track.codec)))throw Error('Этот TS-кодек нельзя перепаковать в MP4. Выберите «Исходный контейнер».');
 const duration=Math.max(...Object.keys(ends).map(id=>ends[id]/timescales[id]).filter(Number.isFinite));
 if(!(duration>0))throw Error('Не удалось определить длительность MP4.');
 const view=new DataView(initSegment.buffer,initSegment.byteOffset,initSegment.byteLength),moov=boxes(initSegment).find(box=>box.type==='moov'),mvhd=child(initSegment,moov,'mvhd');
 const movieScale=view.getUint32(mvhd.data+(initSegment[mvhd.data]===1?20:12));writeDuration(view,initSegment,mvhd,16,24,duration*movieScale);
 for(const trak of boxes(initSegment,moov.data,moov.end).filter(box=>box.type==='trak')){
  const tkhd=child(initSegment,trak,'tkhd'),mdia=child(initSegment,trak,'mdia'),mdhd=child(initSegment,mdia,'mdhd');
  const id=view.getUint32(tkhd.data+(initSegment[tkhd.data]===1?20:12)),trackDuration=ends[id]||0;
  writeDuration(view,initSegment,tkhd,20,28,trackDuration/timescales[id]*movieScale);writeDuration(view,initSegment,mdhd,16,24,trackDuration);
 }
 return duration;
}
onmessage=async event=>{const message=event.data;
 try{
  if(message.type==='start'){
   initSegment=null;tracks=[];timescales={};ends={};outputCount=0;psiBuffers=new Map();pmtPids=new Set();streamTypes=new Set();pmtSeen=false;
   transmuxer=new muxjs.Transmuxer({remux:true,keepOriginalTimestamps:false});
   transmuxer.on('data',segment=>{
    if(!initSegment){initSegment=new Uint8Array(segment.initSegment);tracks=muxjs.probe.tracks(initSegment);timescales=muxjs.probe.timescale(initSegment);}
    timing(segment.data);outputCount++;
    postMessage({type:'data',bytes:segment.data},[segment.data.buffer]);
   });
  }else if(message.type==='part'){
   const bytes=new Uint8Array(await message.blob.arrayBuffer());inspectTs(bytes);transmuxer.push(bytes);transmuxer.flush();
  }else if(message.type==='finish'){
   const duration=finalize();postMessage({type:'result',id:message.id,init:initSegment,duration,tracks},[initSegment.buffer]);transmuxer.dispose?.();return;
  }
  postMessage({type:'ready',id:message.id});
 }catch(error){postMessage({type:'error',id:message.id,error:error.message||String(error)});}
};
