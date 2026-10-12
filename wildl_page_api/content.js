if(typeof browser!=='undefined')globalThis.chrome=browser;
// Bridge in the isolated extension world; downloader is launched in MAIN.
(() => {
  if(typeof window.__wildlBridgeInstalled==='function')window.__wildlBridgeInstalled();
  let activeJob = null, disposed = false;
  const post = data => window.postMessage({source:'wildl-ext',...data}, location.origin);
  const dispose = () => {
    if(disposed)return;
    disposed=true;
    const oldJob=activeJob;activeJob=null;
    window.removeEventListener('pagehide',onHide);window.removeEventListener('message',onPage);
    try{chrome.runtime.onMessage.removeListener(onControl);}catch{}
    if(oldJob)post({type:'stop',jobId:oldJob});
  };
  // sendMessage may throw before returning a Promise after extension reload.
  const send = message => Promise.resolve().then(()=>{
    if(disposed || !chrome.runtime.id)throw new Error('Extension context invalidated.');
    return chrome.runtime.sendMessage(message);
  }).catch(error=>{
    if(!chrome.runtime.id || /context invalidated/i.test(error.message||''))dispose();
    throw error;
  });
  const onControl=(msg, sender, respond) => {
    if(msg.type==='WILDL_PING'){respond({ok:!disposed&&msg.jobId===activeJob});return;}
    if (msg.type === 'WILDL_PREPARE') { activeJob = msg.jobId; respond({ok: true}); }
    if (msg.type === 'WILDL_STOP') {
      window.postMessage({source: 'wildl-ext', type: 'stop', jobId: msg.jobId}, location.origin);
      if(msg.jobId===activeJob)activeJob=null;
      respond({ok: true});
    }
    if (msg.type === 'WILDL_CONTROL' && msg.jobId === activeJob) {
      window.postMessage({source: 'wildl-ext', type: msg.action, jobId: msg.jobId}, location.origin);
      respond({ok: true});
    }
  };
  const onHide=()=>{if(activeJob)send({type:'INTERRUPTED',jobId:activeJob}).catch(()=>{});};
  window.addEventListener('pagehide',onHide);
  const onPage=event => {
    const msg = event.data;
    if (disposed || !activeJob || event.source !== window || !msg || msg.source !== 'wildl-page' || msg.jobId !== activeJob) return;
    send(msg).then(response => {
      if (msg.type === 'chapter') window.postMessage({source: 'wildl-ext', type: 'chapter-ack',
        jobId: msg.jobId, index: msg.index, ok: response?.ok === true, error: response?.error}, location.origin);
      if(['preview','done','error'].includes(msg.type)&&activeJob===msg.jobId)activeJob=null;
    }).catch(error => {
      if (msg.type === 'chapter') window.postMessage({source: 'wildl-ext', type: 'chapter-ack',
        jobId: msg.jobId, index: msg.index, ok: false, error: error.message}, location.origin);
    });
  };
  window.addEventListener('message',onPage);
  window.__wildlBridgeInstalled=dispose;
  try{chrome.runtime.onMessage.addListener(onControl);}catch{dispose();}
})();
