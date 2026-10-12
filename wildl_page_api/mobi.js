// Mobipocket 6 / Palm Database, UTF-8 text. No DRM or image records.
function makeMobi(title,chapters,note='') {
  const textEncoder=new TextEncoder();
  const encode=value=>textEncoder.encode(String(value));
  const heading=c=>`Том ${c.volume} Глава ${c.number}${c.name?' — '+c.name:''}`;
  const content=`<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1>`+
    (note?`<p>${esc(note).replace(/\n/g,'<br>')}</p>`:'')+chapters.map(c=>`<mbp:pagebreak/><h2>${esc(heading(c))}</h2>`+(c.html||`<p>${esc(c.text).replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')}</p>`)).join('')+'</body></html>';
  const text=encode(content),titleBytes=encode(title),records=[];
  for(let offset=0;offset<text.length;){let end=Math.min(offset+4096,text.length);
    while(end<text.length&&(text[end]&0xc0)===0x80)end--;records.push(text.slice(offset,end));offset=end;}
  if(records.length>65530)throw new Error('Книга слишком большая для MOBI. Уменьшите диапазон.');
  const textCount=records.length;
  const exthItems=[[503,title],[524,'ru']].map(([type,value])=>{const data=encode(value),bytes=new Uint8Array(data.length+8),view=new DataView(bytes.buffer);view.setUint32(0,type);view.setUint32(4,bytes.length);bytes.set(data,8);return bytes;});
  const exthLength=12+exthItems.reduce((sum,item)=>sum+item.length,0),exth=new Uint8Array(Math.ceil(exthLength/4)*4),ev=new DataView(exth.buffer);
  exth.set(encode('EXTH'));ev.setUint32(4,exthLength);ev.setUint32(8,exthItems.length);let cursor=12;for(const item of exthItems){exth.set(item,cursor);cursor+=item.length;}
  const nameOffset=16+232+exth.length,record0=new Uint8Array(nameOffset+Math.ceil((titleBytes.length+2)/4)*4),v=new DataView(record0.buffer);
  v.setUint16(0,1);v.setUint32(4,text.length);v.setUint16(8,textCount);v.setUint16(10,4096);
  record0.set(encode('MOBI'),16);v.setUint32(20,232);v.setUint32(24,2);v.setUint32(28,65001);v.setUint32(32,crc32(titleBytes));v.setUint32(36,6);
  for(let offset=40;offset<=76;offset+=4)v.setUint32(offset,0xffffffff);
  v.setUint32(80,textCount+1);v.setUint32(84,nameOffset);v.setUint32(88,titleBytes.length);v.setUint32(92,0x419);v.setUint32(104,6);v.setUint32(108,0xffffffff);
  v.setUint32(128,0x40);v.setUint32(164,0xffffffff);v.setUint32(168,0xffffffff);
  v.setUint16(192,1);v.setUint16(194,textCount);v.setUint32(196,1);v.setUint32(200,textCount+2);v.setUint32(204,1);v.setUint32(208,textCount+1);v.setUint32(212,1);
  v.setUint32(224,0xffffffff);v.setUint32(232,0xffffffff);v.setUint32(236,0xffffffff);v.setUint32(244,0xffffffff);
  record0.set(exth,248);record0.set(titleBytes,nameOffset);
  const flis=new Uint8Array(36),fv=new DataView(flis.buffer);flis.set(encode('FLIS'));fv.setUint32(4,8);fv.setUint16(8,65);fv.setUint32(16,0xffffffff);fv.setUint16(20,1);fv.setUint16(22,3);fv.setUint32(24,3);fv.setUint32(28,1);fv.setUint32(32,0xffffffff);
  const fcis=new Uint8Array(44),cv=new DataView(fcis.buffer);fcis.set(encode('FCIS'));cv.setUint32(4,20);cv.setUint32(8,16);cv.setUint32(12,1);cv.setUint32(20,text.length);cv.setUint32(28,32);cv.setUint32(32,8);cv.setUint16(36,1);cv.setUint16(38,1);
  records.unshift(record0);records.push(flis,fcis,new Uint8Array([0xe9,0x8e,13,10]));
  const database=new Uint8Array(78+records.length*8+2),db=new DataView(database.buffer);
  database.set(encode('LibSaver').slice(0,31));db.setUint16(34,0);const time=Math.floor(Date.now()/1000)+2082844800;db.setUint32(36,time);db.setUint32(40,time);
  database.set(encode('BOOKMOBI'),60);db.setUint32(68,records.length+1);db.setUint16(76,records.length);
  let position=database.length;for(let index=0;index<records.length;index++){db.setUint32(78+index*8,position);db.setUint32(82+index*8,index+1);position+=records[index].length;}
  return new Blob([database,...records],{type:'application/x-mobipocket-ebook'});
}
