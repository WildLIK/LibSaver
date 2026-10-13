const LIB_SITES = [
  {id:5,name:'AnimeLib',kind:'anime',domains:['animelib.org','animelib.me','anilib.me']},
  {id:3,name:'RanobeLib',kind:'novel',domains:['ranobelib.me','ranobelib.org','novelslib.me']},
  {id:1,name:'MangaLib',kind:'manga',domains:['mangalib.me','mangalib.org']},
  {id:4,name:'HentaiLib',kind:'manga',domains:['hentailib.me','hentailib.org']},
  {id:2,name:'SlashLib',kind:'manga',domains:['slashlib.me','slashlib.org','shlib.life','yaoilib.net']}
];
let customLibMirrors = [];
function mirrorOrigin(value){
  const url=new URL(String(value).includes('://')?String(value):'https://'+String(value));
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname.length>253||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname))throw new Error('Укажите HTTPS-адрес публичного зеркала Lib.');
  return url.origin;
}
function getLibSite(url) {
  let host;
  try {host=new URL(url).hostname.toLowerCase();}catch{return null;}
  const builtIn=LIB_SITES.find(site=>site.domains.some(domain=>host===domain||host.endsWith('.'+domain)));
  if(builtIn)return builtIn;
  const mirror=customLibMirrors.find(item=>{try{return new URL(item.origin).hostname===host;}catch{return false;}});
  return mirror?LIB_SITES.find(site=>site.id===mirror.siteId)||null:null;
}
