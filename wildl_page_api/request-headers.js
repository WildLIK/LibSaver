const IMAGE_REQUEST_RULE_ID = 12000;
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
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [IMAGE_REQUEST_RULE_ID,12001,12002],
    addRules: [imageRequestRule(siteOrigin, chrome.runtime.id)]
  });
}
async function clearImageRequestHeaders() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [IMAGE_REQUEST_RULE_ID,12001,12002]});
  } catch {
    // Cleanup must not hide the original startup error if an old manifest
    // is still loaded and has not granted access to this API yet.
  }
}

async function setVideoRequestHeaders(siteOrigin){
  await clearImageRequestHeaders();
  await chrome.declarativeNetRequest.updateSessionRules({addRules:[
    imageRequestRule(siteOrigin,chrome.runtime.id),
    {id:12001,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:siteOrigin+'/'}]},
      condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['kodikplayer.com','kodik.info','kodikvideo.com'],resourceTypes:['xmlhttprequest']}},
    {id:12002,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:'https://kodikplayer.com/'}]},
      condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['solodcdn.com','kodik-cdn.com','kodikcdn.com'],resourceTypes:['xmlhttprequest']}}
  ]});
}
