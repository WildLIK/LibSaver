const VIDEO_DOMAINS=['kodikplayer.com','kodik.info','kodikvideo.com','kodik-cdn.com','kodikcdn.com','solodcdn.com','cdnlibs.org','imglib.info'];
function videoUrl(value,base) {
  const url=new URL(value,base);
  if(url.protocol!=='https:' || !VIDEO_DOMAINS.some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))
    throw new Error('Не поддерживается сервер видео: '+url.hostname);
  return url.href;
}
async function videoFetch(job,url,options={}) {
  url=videoUrl(url);
  for(let attempt=0;attempt<3;attempt++){
    await imageCheckpoint(job);
    const controller=new AbortController();job.controllers.add(controller);
    let timer=setTimeout(()=>controller.abort(),45000);
    try {
      const response=await fetch(url,{...options,credentials:'omit',signal:controller.signal});
      if(response.status===429){const retry=response.headers.get('Retry-After');const seconds=Number(retry)||Math.max(0,(Date.parse(retry)-Date.now())/1000)||Number(job.videoMessage?.chapter.limitPause)||180;
        if(job.videoMessage)imageProgress(job.videoMessage,`Лимит видео. Ожидание ${Math.ceil(seconds)} сек.`);
        await imageSleep(job,Math.max(1,seconds)*1000);attempt--;continue;}
      if(!response.ok)throw new Error('Видео: HTTP '+response.status+' ('+new URL(url).hostname+')');
      let bytes;
      if(response.body?.getReader) {
        const reader=response.body.getReader(),chunks=[];let length=0,lastUpdate=0;
        try {
          while(true) {
            clearTimeout(timer);await imageCheckpoint(job);timer=setTimeout(()=>controller.abort(),45000);
            const {value,done}=await reader.read();if(done)break;
            length+=value.length;if(job.bytes+length>0xf0000000)throw new Error('Архив превышает 4 ГБ. Уменьшите диапазон серий.');
            chunks.push(value);
            if(job.videoMessage && Date.now()-lastUpdate>500 && /video|octet-stream/.test(response.headers?.get('Content-Type')||'')){
              lastUpdate=Date.now();imageProgress(job.videoMessage,`Серия ${job.videoMessage.chapter.number} · Видео: ${(length/1048576).toFixed(1)} МБ`);
            }
          }
        }finally{reader.releaseLock();}
        bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      }else bytes=new Uint8Array(await response.arrayBuffer());
      await imageCheckpoint(job);
      return {bytes,url:response.url||url,text:new TextDecoder().decode(bytes)};
    } catch(error){if(job.stopped)throw new Error('Остановлено');if(attempt===2)throw error;
      if(job.videoMessage)imageProgress(job.videoMessage,`Серия ${job.videoMessage.chapter.number} · Повтор ${attempt+2}/3: ${error.message||error}`);
      await imageSleep(job,800*(attempt+1));}
    finally{clearTimeout(timer);job.controllers.delete(controller);}
  }
}
function decodeKodikUrl(src) {
  if(!src.includes('//'))src=atob(src.replace(/[a-zA-Z]/g,char=>{
    const max=char<='Z'?90:122,code=char.charCodeAt(0)+18;return String.fromCharCode(code<=max?code:code-26);
  }));
  return videoUrl(src.startsWith('//')?'https:'+src:src);
}
async function resolveVideo(message,job) {
  const player=message.chapter.videoPlayer,quality=Number(message.chapter.quality)||720;
  if(player.video?.quality?.length){
    const choices=[...player.video.quality].sort((a,b)=>videoResolution(b.quality)-videoResolution(a.quality));
    const choice=choices.find(item=>videoResolution(item.quality)<=quality)||choices.at(-1);
    const src=choice.src||choice.url;
    if(src){imageProgress(message,'Серия '+message.chapter.number+' · '+player.player+' · '+videoResolution(choice.quality)+'p');return videoUrl(src);}
  }
  if(/\.(mp4|m3u8)(?:\?|$)/i.test(player.src||''))return videoUrl(player.src,'https://v5.animelib.org');
  if(player.player!=='Kodik')throw new Error('Плеер '+player.player+' пока не поддерживается для скачивания.');
  const data=await kodikStreams(player,async(url,options)=>(await videoFetch(job,url,options)).text);
  const qualities=Object.keys(data.links||{}).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);
  const selected=qualities.find(item=>item<=quality)||qualities.at(-1);
  const src=data.links?.[selected]?.[0]?.src||data.link;
  if(!src)throw new Error('Kodik не вернул поток видео.');
  imageProgress(message,'Серия '+message.chapter.number+' · '+(selected||quality)+'p');
  return decodeKodikUrl(src);
}
async function kodikStreams(player,fetchText) {
  const url=videoUrl(player.src,'https://v5.animelib.org');
  const html=await fetchText(url);
  const params=html.match(/var\s+urlParams\s*=\s*'([^']+)'/);
  const path=new URL(url).pathname.match(/\/(seria|video|episode)\/(\d+)\/([^/]+)/);
  if(!params||!path)throw new Error('Kodik не выдал сведения о видео. Проверьте воспроизведение серии на сайте.');
  const raw=JSON.parse(params[1]),body=new URLSearchParams();
  for(const key of ['d','d_sign','pd','pd_sign','ref','ref_sign'])if(raw[key]!=null)body.set(key,key==='ref'?decodeURIComponent(raw[key]):raw[key]);
  body.set('type',path[1]);body.set('id',path[2]);body.set('hash',path[3]);
  const text=await fetchText(new URL('/ftor',url).href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  try{return JSON.parse(text);}catch{throw new Error('Kodik не разрешил получить сведения о качестве.');}
}
function videoResolution(value) {
  if(/^(?:4k|uhd)$/i.test(String(value)))return 2160;
  return Number(String(value).replace(/p$/i,''))||0;
}
function parseHls(text,base,quality=720) {
  if(!text.trimStart().startsWith('#EXTM3U'))throw new Error('Сервер не вернул HLS-плейлист.');
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(lines.some(line=>line.startsWith('#EXT-X-KEY:')&&!/METHOD=NONE(?:,|$)/.test(line)) || text.includes('#EXT-X-SESSION-KEY:'))
    throw new Error('Серия использует зашифрованный поток. Этот формат не поддерживается.');
  if(lines.some(line=>/^#EXT-X-(?:BYTERANGE|DISCONTINUITY)/.test(line)))throw new Error('Этот вариант HLS пока не поддерживается.');
  const variants=[];
  for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){
    if(/AUDIO=/.test(lines[i]))throw new Error('HLS с отдельной звуковой дорожкой пока не поддерживается.');
    const resolution=Number(lines[i].match(/RESOLUTION=\d+x(\d+)/)?.[1])||0;
    variants.push({url:videoUrl(lines[i+1],base),resolution});
  }
  if(variants.length){variants.sort((a,b)=>b.resolution-a.resolution);return {variant:(variants.find(v=>v.resolution<=quality)||variants.at(-1)).url};}
  if(!lines.includes('#EXT-X-ENDLIST'))throw new Error('Поток ещё не завершён. Скачивание прямых трансляций не поддерживается.');
  const map=lines.find(line=>line.startsWith('#EXT-X-MAP:'));
  const init=map?.match(/URI="([^"]+)"/)?.[1];
  const segments=lines.filter(line=>!line.startsWith('#')).map(line=>videoUrl(line,base));
  if(!segments.length)throw new Error('В HLS нет сегментов серии.');
  return {segments,init:init?videoUrl(init,base):null,extension:init?'mp4':'ts'};
}
async function downloadVideo(message,job) {
  job.videoMessage=message;
  imageProgress(message,'Серия '+message.chapter.number+' · Получаю поток '+message.chapter.videoPlayer.player+'…');
  let url=await resolveVideo(message,job),result=await videoFetch(job,url);
  if(String.fromCharCode(...result.bytes.slice(4,8))==='ftyp'){
    if(job.bytes+result.bytes.length>0xf0000000)throw new Error('Архив превышает 4 ГБ. Уменьшите диапазон серий.');
    job.bytes+=result.bytes.length;return {name:'Серия '+message.chapter.number+'.mp4',data:result.bytes};
  }
  let manifest;
  for(let depth=0;depth<4;depth++){
    manifest=parseHls(result.text,result.url,Number(message.chapter.quality)||720);
    if(!manifest.variant)break;
    result=await videoFetch(job,manifest.variant);
  }
  if(!manifest.segments)throw new Error('Не удалось выбрать HLS-поток серии.');
  const chunks=[];let bytes=0;
  const urls=[...(manifest.init?[manifest.init]:[]),...manifest.segments];
  for(let index=0;index<urls.length;index++){
    imageProgress(message,`Серия ${message.chapter.number} · Фрагмент ${index+1}/${urls.length}`);
    const data=(await videoFetch(job,urls[index])).bytes;
    if(manifest.extension==='ts'&&(data[0]!==0x47||data.length%188!==0))throw new Error('Сервер вернул неверный фрагмент видео.');
    if(!data.length||job.bytes+bytes+data.length>0xf0000000)throw new Error('Пустой фрагмент или архив превышает 4 ГБ. Уменьшите диапазон серий.');
    chunks.push(data);bytes+=data.length;
  }
  await imageCheckpoint(job);
  const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  job.bytes+=bytes;return {name:'Серия '+message.chapter.number+'.'+manifest.extension,data};
}
