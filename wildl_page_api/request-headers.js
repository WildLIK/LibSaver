const IMAGE_REQUEST_RULE_ID = 12000;
let firefoxRequestOrigin='';
const firefoxHeaders=typeof browser!=='undefined'&&typeof document!=='undefined'&&!!chrome.webRequest;
if(firefoxHeaders)chrome.webRequest.onBeforeSendHeaders.addListener(details=>{
  const extensionBase=chrome.runtime.getURL('');
  if(!firefoxRequestOrigin||![details.originUrl,details.documentUrl].some(url=>url?.startsWith(extensionBase)))return {};
  const host=new URL(details.url).hostname;
  if(['api.cdnlibs.org','cover.cdnlibs.org'].includes(host))return {};
  const referer=['solodcdn.com','kodik-cdn.com','kodikcdn.com'].some(domain=>host===domain||host.endsWith('.'+domain))?'https://kodikplayer.com/':firefoxRequestOrigin+'/';
  return {requestHeaders:[...(details.requestHeaders||[]).filter(header=>header.name.toLowerCase()!=='referer'),{name:'Referer',value:referer}]};
},{urls:['https://*.imglib.info/*','https://*.cdnlibs.org/*','https://*.hentaicdn.org/*','https://*.kodikplayer.com/*','https://*.kodik.info/*','https://*.kodikvideo.com/*','https://*.solodcdn.com/*','https://*.kodik-cdn.com/*','https://*.kodikcdn.com/*'],types:['xmlhttprequest']},['blocking','requestHeaders']);
function imageRequestRule(siteOrigin, extensionId) {
  const source = new URL(siteOrigin);
  if (!getLibSite(source.href) || source.protocol !== 'https:')
    throw new Error('Не удалось определить сайт для загрузки изображений.');
  return {
    id: IMAGE_REQUEST_RULE_ID,
    priority: 1,
    action: {type: 'modifyHeaders', requestHeaders: [
      {header: 'Referer', operation: 'set', value: source.origin + '/'}
    ]},
    condition: {
      initiatorDomains: [extensionId],
      requestDomains: ['imglib.info', 'cdnlibs.org', 'hentaicdn.org'],
      excludedRequestDomains: ['api.cdnlibs.org', 'cover.cdnlibs.org'],
      resourceTypes: ['xmlhttprequest']
    }
  };
}
async function setImageRequestHeaders(siteOrigin) {
  if(firefoxHeaders){imageRequestRule(siteOrigin,chrome.runtime.id);firefoxRequestOrigin=siteOrigin;return;}
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [IMAGE_REQUEST_RULE_ID,12001,12002],
    addRules: [imageRequestRule(siteOrigin, chrome.runtime.id)]
  });
}
async function clearImageRequestHeaders() {
  if(firefoxHeaders){firefoxRequestOrigin='';return;}
  try {
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [IMAGE_REQUEST_RULE_ID,12001,12002]});
  } catch {
    // Cleanup must not hide the original startup error if an old manifest
    // is still loaded and has not granted access to this API yet.
  }
}

async function setVideoRequestHeaders(siteOrigin){
  if(firefoxHeaders){await setImageRequestHeaders(siteOrigin);return;}
  await clearImageRequestHeaders();
  await chrome.declarativeNetRequest.updateSessionRules({addRules:[
    imageRequestRule(siteOrigin,chrome.runtime.id),
    {id:12001,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:siteOrigin+'/'}]},
      condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['kodikplayer.com','kodik.info','kodikvideo.com'],resourceTypes:['xmlhttprequest']}},
    {id:12002,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:'https://kodikplayer.com/'}]},
      condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['solodcdn.com','kodik-cdn.com','kodikcdn.com'],resourceTypes:['xmlhttprequest']}}
  ]});
}
