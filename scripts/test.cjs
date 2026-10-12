const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const files=process.argv[2]==='ui'?['popup-ui','popup-startup','api-rate','comic-info','optimized-files','image-workers','video-transfer','video-remux','default-folder','anime-reload']:['content-lifecycle','quality-summary','video','video-eta','updates','library'];
for(const file of files){
  const result=spawnSync(process.execPath,[path.join(root,'tests',file+'.cjs')],{cwd:root,stdio:'inherit'});
  if(result.error){console.error(result.error.message);process.exit(1);}
  if(result.status!==0)process.exit(result.status||1);
}
