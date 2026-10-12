// Compress textual entries only. JPEG/PNG/video are already compressed.
async function zipCompact(files,mime='application/epub+zip'){
  if(files.length>65535)throw new Error('Слишком много файлов для одного архива.');
  const chunks=[],central=[];let offset=0;
  for(const file of files){
    const name=enc(file.name),data=typeof file.data==='string'?enc(file.data):file.data,crc=crc32(data);let packed=data,method=0;
    if(typeof file.data==='string'&&file.name!=='mimetype'&&data.length>256&&typeof CompressionStream!=='undefined'){
      try{const compressed=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
        if(compressed.length<data.length){packed=compressed;method=8;}}
      catch{} // Browsers without raw DEFLATE still produce a valid stored ZIP.
    }
    const local=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0x800),...u16(method),...u16(0),...u16(0),...u32(crc),...u32(packed.length),...u32(data.length),...u16(name.length),...u16(0),...name]);
    chunks.push(local,packed);central.push({name,crc,size:data.length,packedSize:packed.length,method,offset});offset+=local.length+packed.length;
    if(offset>0xffffffff)throw new Error('Архив превышает 4 ГБ. Уменьшите диапазон.');
  }
  const start=offset;
  for(const file of central){const header=new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x800),...u16(file.method),...u16(0),...u16(0),...u32(file.crc),...u32(file.packedSize),...u32(file.size),...u16(file.name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(file.offset),...file.name]);chunks.push(header);offset+=header.length;}
  chunks.push(new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(central.length),...u16(central.length),...u32(offset-start),...u32(start),...u16(0)]));
  return new Blob(chunks,{type:mime});
}
