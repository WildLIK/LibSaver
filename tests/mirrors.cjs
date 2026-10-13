const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../wildl_page_api'),store={},grants=new Set(),alarms=new Map();let calls=0,offline=false,now=Date.now();
class Clock extends Date{static now(){return now;}}
const html=channel=>`<article data-post="${channel}/15"><div class="tgme_widget_message_text js-message_text">Новое зеркало <a href="https://v1.novelslib.me/ru">RanobeLib</a> <a href="https://mirror-new.libmirror.net/ru">Зеркало</a><a href="https://localhost/">local</a><a href="https://vk.com/foo">help</a><a href="javascript:evil()">evil</a></div></article><article data-post="${channel}/16"><div class="tgme_widget_message_text">Реклама <a href="https://ads.libmirror.net/">ads</a></div></article>`;
const chrome={runtime:{},storage:{local:{get:async key=>({[key]:structuredClone(store[key])}),set:async values=>Object.assign(store,structuredClone(values))}},
 permissions:{contains:async({origins})=>origins.every(origin=>grants.has(origin))},alarms:{create:async(name,value)=>alarms.set(name,value),clear:async name=>alarms.delete(name),onAlarm:{addListener:()=>{}}}};
const context=vm.createContext({chrome,URL,Date:Clock,AbortController,TextDecoder,Uint8Array,setTimeout,clearTimeout,fetch:async(url,options)=>{
 calls++;assert.equal(options.credentials,'omit');assert(!options.headers?.Authorization);if(offline)throw Error('Offline');return new Response(html(url.split('/').pop()),{headers:{'Content-Type':'text/html'}});
}});
for(const file of ['sites.js','mirrors.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const run=code=>vm.runInContext(code,context);
(async()=>{
 await run('mirrorReady');
 for(const [url,id] of [['https://v1.novelslib.me/ru/book/12--test',3],['https://v1.yaoilib.net/ru',2],['https://v2.shlib.life/ru',2],['https://anilib.me/ru',5],['https://v99.mangalib.org/ru',1],['https://v2.hentailib.me/ru',4]])assert.equal(run('getLibSite('+JSON.stringify(url)+').id'),id);
 assert.equal(run("getLibSite('https://mangalib.me.evil.org')"),null);
 assert.equal(run("getLibSite('https://fake-mangalib.me')"),null);
 for(const url of ['http://host.org','https://user:password@host.org','https://127.0.0.1','https://host.local','https://host.org:444'])assert.throws(()=>run('mirrorOrigin('+JSON.stringify(url)+')'));
 await assert.rejects(run('checkMirrors(true)'),/Разрешите/);assert.equal(calls,0);
 grants.add('https://t.me/*');const result=await run('checkMirrors(true)');assert.equal(calls,2);assert.equal(result.suggestions.length,2);assert.equal(result.suggestions[0].siteId,3);
 assert.equal(result.suggestions[1].siteId,null);assert.equal(run("getLibSite('https://mirror-new.libmirror.net')"),null,'Remote suggestions cannot enable a host');
 await assert.rejects(run("enableMirror('https://mirror-new.libmirror.net',5)"),/не разрешил/);
 grants.add('https://mirror-new.libmirror.net/*');await run("enableMirror('https://mirror-new.libmirror.net',5)");assert.equal(run("getLibSite('https://mirror-new.libmirror.net')").id,5);
 assert.equal(run("getLibSite('https://sub.mirror-new.libmirror.net')"),null,'Only the approved exact host is enabled');
 grants.add('https://v1.novelslib.me/*');await assert.rejects(run("enableMirror('https://v1.novelslib.me',1)"),/RanobeLib/);
 await run('setMirrorAuto(true)');assert.equal(alarms.get('wildl-mirror-check').periodInMinutes,1440);
 await run('checkMirrors(true)');assert.equal(calls,2,'Manual checks are limited to one per minute');
 now+=61000;offline=true;const cached=await run('checkMirrors(true)');assert.equal(cached.suggestions.length,2);assert.match(cached.error,/Offline/);
 await run('setMirrorAuto(false)');assert(!alarms.has('wildl-mirror-check'));assert(store.wildlMirrors.enabled.length===1);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));assert.equal(manifest.name,'WildLib');assert.deepEqual(manifest.optional_host_permissions,['https://*/*']);
 for(const domain of ['anilib.me','novelslib.me','yaoilib.net'])assert(manifest.host_permissions.includes('*://*.'+domain+'/*')&&manifest.content_scripts[0].matches.includes('*://*.'+domain+'/*'));
 console.log('PASS mirrors: five Lib sites, alias/subdomain recognition, exact host permissions, no silent activation, official-channel suggestions, caching, offline preservation and optional daily checks.');
})().catch(error=>{console.error(error);process.exitCode=1;});
