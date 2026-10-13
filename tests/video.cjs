const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../wildl_page_api'),context=vm.createContext({URL,URLSearchParams,TextDecoder,TextEncoder,Uint8Array,Blob,AbortController,setTimeout,clearTimeout,
  atob:value=>Buffer.from(value,'base64').toString('binary'),imageCheckpoint:async()=>{},imageSleep:async()=>{},imageProgress:()=>{}});
vm.runInContext(fs.readFileSync(path.join(root,'video.js'),'utf8'),context);
const parse=text=>vm.runInContext(`parseHls(${JSON.stringify(text)},'https://p14.solodcdn.com/episode/index.m3u8',720)`,context);
assert.deepEqual(Array.from(parse('#EXTM3U\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nseg2.ts\n#EXT-X-ENDLIST').segments),['https://p14.solodcdn.com/episode/seg1.ts','https://p14.solodcdn.com/episode/seg2.ts']);
assert(parse('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg.m4s\n#EXT-X-ENDLIST').init.endsWith('/init.mp4'));
assert(parse('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\na.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\nb.m3u8').variant.endsWith('/b.m3u8'));
for(const text of ['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="secret"\nseg.ts\n#EXT-X-ENDLIST',
  '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES\nseg.ts\n#EXT-X-ENDLIST',
  '#EXTM3U\n#EXT-X-STREAM-INF:AUDIO="other"\na.m3u8','#EXTM3U\nseg.ts',
  '#EXTM3U\n#EXT-X-BYTERANGE:100\nseg.ts\n#EXT-X-ENDLIST','#EXTM3U\nhttps://evil.test/a.ts\n#EXT-X-ENDLIST'])assert.throws(()=>parse(text));
assert.throws(()=>vm.runInContext("videoUrl('http://p14.solodcdn.com/video')",context));
const rotate=src=>Buffer.from(src).toString('base64').replace(/[a-zA-Z]/g,char=>{const code=char.charCodeAt(0)-18,min=char<='Z'?65:97;return String.fromCharCode(code<min?code+26:code);});
const expected='https://p14.solodcdn.com/video/index.m3u8';assert.equal(vm.runInContext(`decodeKodikUrl(${JSON.stringify(rotate(expected))})`,context),expected);
(async()=>{
  let calls=[],chunks=[Buffer.alloc(188,0),Buffer.alloc(188,1)];for(const chunk of chunks)chunk[0]=0x47;
  context.fetch=async(url,options)=>{
    calls.push({url,body:options.body?.toString()});let data;
    if(url.includes('/seria/'))data=`<script>var urlParams = '${JSON.stringify({d:'v5.animelib.org',d_sign:'public',pd:'kodikplayer.com',pd_sign:'public',ref:'https%3A%2F%2Fv5.animelib.org%2F',ref_sign:'public'})}'</script>`;
    else if(url.endsWith('/ftor'))data=JSON.stringify({links:{720:[{src:rotate(expected)}]}});
    else if(url.endsWith('m3u8'))data='#EXTM3U\n#EXTINF:6,\na.ts\n#EXTINF:6,\nb.ts\n#EXT-X-ENDLIST';
    else data=chunks[url.endsWith('/a.ts')?0:1];
    return {ok:true,status:200,url,arrayBuffer:async()=>typeof data==='string'?new TextEncoder().encode(data).buffer:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};
  };
  context.job={controllers:new Set(),bytes:0};context.message={chapter:{number:'1',videoContainer:'original',videoRanges:false,quality:720,videoPlayer:{player:'Kodik',src:'//kodikplayer.com/seria/7/hash/720p'}}};
  const file=await vm.runInContext('downloadVideo(message,job)',context);
  assert.equal(file.name,'Серия 1.ts');assert.equal(file.data.size,376);assert.equal(new Uint8Array(await file.data.arrayBuffer())[190],1);
  assert.equal(new URLSearchParams(calls.find(call=>call.url.endsWith('/ftor')).body).get('ref'),'https://v5.animelib.org/');
  assert.equal(calls.length,5);
  context.message={chapter:{number:'1180',quality:2160,videoPlayer:{player:'Animelib',video:{quality:[
    {quality:'1080p',src:'https://video1.cdnlibs.org/hd.mp4'}, {quality:'4K',src:'https://video1.cdnlibs.org/uhd.mp4'}]}}}};
  assert.equal(await vm.runInContext('resolveVideo(message,job)',context),'https://video1.cdnlibs.org/uhd.mp4');
  context.message.chapter.quality='max';assert.equal(await vm.runInContext('resolveVideo(message,job)',context),'https://video1.cdnlibs.org/uhd.mp4');
  context.message.chapter.quality=1080;
  assert.equal(await vm.runInContext('resolveVideo(message,job)',context),'https://video1.cdnlibs.org/hd.mp4');
  assert(vm.runInContext("parseHls('#EXTM3U\\n#EXT-X-STREAM-INF:RESOLUTION=3840x2160\\nuhd.m3u8\\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\\nhd.m3u8','https://video1.cdnlibs.org/index.m3u8',2160).variant",context).endsWith('/uhd.m3u8'));
  let attempts=0,waits=[];context.imageSleep=async(job,ms)=>waits.push(ms);context.job.videoMessage={chapter:{limitPause:45}};
  context.fetch=async()=>++attempts===1?{status:429,headers:{get:()=>null}}:{ok:true,url:'https://p14.solodcdn.com/retry.mp4',arrayBuffer:async()=>new Uint8Array([1]).buffer};
  await vm.runInContext("videoFetch(job,'https://p14.solodcdn.com/retry.mp4')",context);assert.equal(waits.length,1);assert(waits[0]>=44900&&waits[0]<=45000);
  attempts=0;waits=[];context.fetch=async()=>++attempts===1?{status:429,headers:{get:()=> '2'}}:{ok:true,url:'https://p14.solodcdn.com/retry.mp4',arrayBuffer:async()=>new Uint8Array([1]).buffer};
  await vm.runInContext("videoFetch(job,'https://p14.solodcdn.com/retry.mp4')",context);assert.equal(waits.length,1);assert(waits[0]>=1900&&waits[0]<=2000);
  console.log('PASS video: public Kodik request fields + URL decoding, quality selection, complete ordered HLS assembly; encrypted, live, external-audio and untrusted URLs rejected.');
})().catch(error=>{console.error(error);process.exitCode=1;});
