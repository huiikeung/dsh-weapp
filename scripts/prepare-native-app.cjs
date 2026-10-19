const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..'),source=path.join(root,'miniprogram'),target=path.join(root,'native-app/generated-miniprogram');
fs.mkdirSync(target,{recursive:true});
fs.cpSync(source,target,{recursive:true,filter:file=>!['project.config.json','project.private.config.json','README.md'].includes(path.basename(file))});
for(const file of ['project.miniapp.json','app.miniapp.json'])fs.copyFileSync(path.join(root,'native-app',file),path.join(target,file));
for(const directory of ['miniapp','i18n'])fs.cpSync(path.join(root,'native-app',directory),path.join(target,directory),{recursive:true});
const config=JSON.parse(fs.readFileSync(path.join(source,'project.config.json'),'utf8'));config.projectArchitecture='multiPlatform';fs.writeFileSync(path.join(target,'project.config.json'),JSON.stringify(config,null,2)+'\n');
console.log('Multi-platform staging directory: '+target);
