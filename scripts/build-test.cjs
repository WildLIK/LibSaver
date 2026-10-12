const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),source=path.join(root,'wildl_page_api');
const firefox=process.argv.includes('--firefox'),release=process.argv.includes('--release'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const version=manifest.version;
if(process.argv.includes('--xpi')&&!firefox)throw Error('--xpi requires --firefox');
if(!/^\d+(?:\.\d+){1,3}$/.test(version))throw Error('Invalid release version');
if(!release)manifest.version_name=version+' (тестовая сборка)';
const target=path.join(root,'WildL-Downloader-'+version+(release?'':'-test')+(firefox?'-Firefox':''));
fs.mkdirSync(target,{recursive:true});
function copy(directory,relative=''){
 for(const item of fs.readdirSync(directory,{withFileTypes:true})){
  const name=path.join(relative,item.name),input=path.join(directory,item.name),output=path.join(target,name);
  if(item.isDirectory()){fs.mkdirSync(output,{recursive:true});copy(input,name);}
  else{if(/\.(pem|key|crx)$/i.test(item.name))throw Error('Unexpected packaged/key file');fs.copyFileSync(input,output);
   if(crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex')!==crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'))throw Error('Copy differs: '+name);}
 }
}
copy(source);
if(firefox){
 manifest.manifest_version=2;manifest.browser_action=manifest.action;delete manifest.action;delete manifest.minimum_chrome_version;
 manifest.background={page:'firefox-background.html',persistent:true};
 manifest.permissions=['tabs','downloads','storage','alarms','scripting','unlimitedStorage','webRequest','webRequestBlocking',...manifest.host_permissions];delete manifest.host_permissions;
 manifest.browser_specific_settings={gecko:{id:'libsaver@wildlik',strict_min_version:'128.0',data_collection_permissions:{required:['none']}}};
 manifest.content_scripts.forEach(item=>item.js=['compat.js',...item.js]);
}
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const notes=`# WildL Downloader 2.3 — тестовая сборка ${firefox?'Firefox':'Chromium'}\n\nВыпуск не опубликован.\n\n${firefox?'Откройте about:debugging → Этот Firefox → Загрузить временное дополнение → manifest.json в этой папке. Такая установка действует до закрытия Firefox. Для постоянной установки нужен подписанный Mozilla XPI.':'Откройте chrome://extensions или browser://extensions → режим разработчика → Загрузить распакованное расширение → эта папка.'}\n\nОтключите прежнюю копию и перезагрузите вкладку Lib.\n\nПроверяйте таймер серии, подробный журнал, анимацию загрузки, единый JPG манги, максимальное качество аниме, единые MP4, четыре параллельных фрагмента, продолжение после ошибки, MOBI для ранобэ, историю сохранений, подпапку LibSaver в Загрузках, параллельные страницы манги и экономный WebP. JPG по умолчанию: готовые JPEG без изменений, остальные с качеством 95%; можно выбрать PNG/WebP/исходный формат. MP4 — без перекодирования для поддерживаемого TS; исходный контейнер можно выбрать вручную. Архив до 4 ГБ. Общий темп API не гарантирует отсутствие лимита сайта.\n`;
const installation=`# WildL Downloader ${version} — ${firefox?'Firefox':'Chromium'}\n\n${firefox?'Откройте about:debugging → Этот Firefox → Загрузить временное дополнение → manifest.json в этой папке. Нужен Firefox 128+. Такая установка действует до закрытия Firefox. Для постоянной установки нужен подписанный Mozilla XPI; этот ZIP не подписан.':'Откройте chrome://extensions или browser://extensions → режим разработчика → Загрузить распакованное расширение → эта папка. Нужен Chromium 116+.'}\n\nОтключите прежнюю копию и перезагрузите вкладку Lib. При обновлении существующей установки замените файлы в её папке, нажмите обновление на странице расширений и перезагрузите вкладку Lib.\n\nПроект: https://github.com/WildLIK/LibSaver\nИзменения: https://github.com/WildLIK/LibSaver/releases/tag/v${version}\n\nПроект не связан с администрацией AnimeLib, MangaLib и RanobeLib. Все права на контент принадлежат правообладателям. Расширение предназначено только для личного офлайн-доступа. Пользователь самостоятельно несёт ответственность за соблюдение авторских прав и правил площадок.\n`;
fs.writeFileSync(path.join(target,release?'INSTALLATION.md':'TESTING.md'),release?installation:notes);
console.log(release?'Release folder:':'Test folder:',target);
if(process.argv.includes('--xpi')){
 const vm=require('node:vm'),context=vm.createContext({TextEncoder,Blob,Response,CompressionStream});
 for(const name of ['export.js','zip-compact.js'])vm.runInContext(fs.readFileSync(path.join(source,name),'utf8'),context);
 const files=[];
 function collect(directory,relative=''){
  for(const item of fs.readdirSync(directory,{withFileTypes:true})){
   const name=path.join(relative,item.name);
   if(item.isDirectory())collect(path.join(directory,item.name),name);
   else files.push({name:name.replaceAll('\\','/'),data:/\.(?:js|css|json|html|md|svg|txt)$/.test(item.name)?fs.readFileSync(path.join(target,name),'utf8'):new Uint8Array(fs.readFileSync(path.join(target,name)))});
  }
 }
 collect(source);context.files=files;
 vm.runInContext("zipCompact(files,'application/x-xpinstall')",context).then(async blob=>{
  const output=path.join(root,`WildL-Downloader-${version}-Firefox-unsigned.xpi`);
  fs.writeFileSync(output,Buffer.from(await blob.arrayBuffer()));console.log('Unsigned package for Mozilla signing:',output);
 }).catch(error=>{console.error(error);process.exitCode=1;});
}
