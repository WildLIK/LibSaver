const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const files=process.argv[2]==='ui'?['popup-ui','popup-startup','anime-reload']:['content-lifecycle','quality-summary','video','updates'];
for(const file of files){
  const result=spawnSync(process.execPath,[path.join(root,'tests',file+'.cjs')],{cwd:root,stdio:'inherit'});
  if(result.error){console.error(result.error.message);process.exit(1);}
  if(result.status!==0)process.exit(result.status||1);
}
