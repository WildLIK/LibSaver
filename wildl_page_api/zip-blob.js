// Stored ZIP for video: reference immutable OPFS Files and small ZIP headers.
// The default path creates no intermediate archive; CRC reads are capped at 4 MiB.
// An optional sink remains available for callers that need a standalone file.
async function zipBlob(files,mime='application/zip',onProgress=()=>{},sink=null){
  if(files.length>65535)throw new Error('Слишком много файлов для одного архива.');
  const entries=files.map(file=>({name:enc(file.name),blob:file.data instanceof Blob?file.data:new Blob([typeof file.data==='string'?enc(file.data):file.data])}));
  let total=22;
  for(const entry of entries){
    if(entry.name.length>65535||entry.blob.size>0xffffffff)throw new Error('Файл превышает ограничения ZIP. Выберите «По одному файлу».');
    total+=entry.blob.size+76+entry.name.length*2;
  }
  if(total>0xffffffff)throw new Error('Архив превышает 4 ГБ. Выберите «По одному файлу» или меньший диапазон.');
  const chunks=[],central=[];let offset=0,processed=0,index=0;
  for(const {name,blob} of entries){
    const header=crc=>new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0x800),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(blob.size),...u32(blob.size),...u16(name.length),...u16(0),...name]);
    if(sink)await sink.write(header(0));
    let crc=0xffffffff;
    for(let start=0;start<blob.size;start+=4*1048576){
      const bytes=new Uint8Array(await blob.slice(start,Math.min(blob.size,start+4*1048576)).arrayBuffer());
      for(let i=0;i<bytes.length;i++)crc=(crc>>>8)^crcTable[(crc^bytes[i])&255];
      if(sink)await sink.write(bytes);
      processed+=bytes.length;onProgress({index,total:entries.length,bytes:processed,size:total});
      // Give controls and runtime messages time to run while checking large files.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    crc=(crc^0xffffffff)>>>0;
    const local=header(crc);
    if(sink){await sink.seek(offset+14);await sink.write(new Uint8Array(u32(crc)));await sink.seek(offset+local.length+blob.size);}else chunks.push(local,blob);
    central.push({name,crc,size:blob.size,offset});offset+=local.length+blob.size;index++;
  }
  const start=offset;
  for(const file of central){const header=new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x800),...u16(0),...u16(0),...u16(0),...u32(file.crc),...u32(file.size),...u32(file.size),...u16(file.name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(file.offset),...file.name]);if(sink)await sink.write(header);else chunks.push(header);offset+=header.length;}
  const footer=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(central.length),...u16(central.length),...u32(offset-start),...u32(start),...u16(0)]);
  if(sink)await sink.write(footer);else chunks.push(footer);
  onProgress({index,total:entries.length,bytes:processed,size:total});
  return sink?await sink.finish():new Blob(chunks,{type:mime});
}
