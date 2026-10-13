const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../wildl_page_api/updates.js'),'utf8');
let now=Date.now(),calls=0,mode='new',release,store={},notifications=[];
class Clock extends Date{static now(){return now;}}
const chrome={runtime:{getManifest:()=>({version:'2.2'}),sendMessage:async message=>notifications.push(message)},
 storage:{local:{get:async key=>structuredClone({[key]:store[key]}),set:async data=>Object.assign(store,structuredClone(data))}}};
const context=vm.createContext({chrome,Date:Clock,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
 calls++;assert.equal(url,'https://api.github.com/repos/WildLIK/WildLib/releases/latest');assert.equal(options.credentials,'omit');assert(!options.headers.Authorization);
 if(mode==='error')throw Error('Offline');
 if(mode==='absent')return {status:404};
 return {ok:true,status:200,json:async()=>release||{tag_name:'v2.10',draft:false,prerelease:false,html_url:'https://evil.test/'}};
}});
vm.runInContext(source,context);
(async()=>{
 assert(vm.runInContext("newerUpdate('v2.10','2.9')",context));
 assert(!vm.runInContext("newerUpdate('2.2.0','2.2')",context));
 assert(!vm.runInContext("newerUpdate('2.3-rc1','2.2')",context));
 const result=await vm.runInContext('checkForUpdates()',context);assert(result.available);assert.equal(result.latestVersion,'2.10');
 assert.equal(result.releaseUrl,'https://github.com/WildLIK/WildLib/releases/tag/v2.10');
 await vm.runInContext('checkForUpdates()',context);assert.equal(calls,1,'Daily cache prevents repeated requests');
 now+=61000;await vm.runInContext('Promise.all([checkForUpdates(true),checkForUpdates(true)])',context);assert.equal(calls,2,'Concurrent checks are coalesced');
 now+=61000;mode='error';const offline=await vm.runInContext('checkForUpdates(true)',context);
 assert(offline.available,'Network failure retains a previously known update');assert.match(offline.error,/Offline/);
 now+=24*60*60*1000+1;mode='absent';assert(!(await vm.runInContext('checkForUpdates()',context)).available);
 assert.equal(store.wildlUpdates.error,'');
 now+=61000;mode='new';release={tag_name:'../../bad',draft:false};assert(!(await vm.runInContext('checkForUpdates(true)',context)).available);
 now+=61000;release={tag_name:'v3.0',prerelease:true};assert(!(await vm.runInContext('checkForUpdates(true)',context)).available);
 now+=61000;release={tag_name:'v2.2'};assert(!(await vm.runInContext('checkForUpdates(true)',context)).available,'Installed release is not advertised as new');
 let created;chrome.alarms={get:async()=>null,create:async(name,options)=>{created={name,...options};}};
 await vm.runInContext('ensureUpdateAlarm()',context);assert.equal(created.periodInMinutes,1440);
 assert(notifications.some(message=>message.type==='UPDATE_STATUS'));
 console.log('PASS updates: numeric versions, daily cache/manual refresh, coalescing, offline preservation, no releases, invalid/prerelease rejection, trusted links, 24h alarm.');
})().catch(error=>{console.error(error);process.exitCode=1;});
