const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../miniprogram');
const LIMIT = 2 * 1024 * 1024;
const MAIN_LIMIT = Math.floor(1.5 * 1024 * 1024);
const BUDGET = Math.floor(1.8 * 1024 * 1024);
const MEDIA_BUDGET = 200 * 1024;
function inventory() {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const groups = [{ name: 'main', root: '', bytes: 0, files: 0, mediaBytes: 0 }].concat((app.subPackages || []).map(p => ({name:p.name || p.root,root:p.root+'/',bytes:0,files:0,mediaBytes:0})));
  const files = [];
  function walk(dir) { for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Symlinks are not allowed in the upload root: '+full);
    if(entry.isDirectory())walk(full);else {
      const relative=path.relative(root,full).replace(/\\/g,'/');
      if(['project.config.json','project.private.config.json','README.md'].includes(relative))continue;
      if(!/\.(js|json|wxml|wxss|wxs|png|jpg|jpeg|gif|webp|svg|ttf|woff|woff2)$/.test(relative))throw Error('Unexpected upload file: '+relative);
      const group=groups.slice(1).find(g=>relative.startsWith(g.root))||groups[0],bytes=fs.statSync(full).size;group.bytes+=bytes;group.files++;
      if (/\.(png|jpe?g|gif|webp|svg|mp3|wav|aac|ogg|mp4)$/i.test(relative)) group.mediaBytes+=bytes;
      files.push({relative,bytes});
    }
  }}walk(root);
  return {
    root,
    groups,
    totalBytes: groups.reduce((sum,g)=>sum+g.bytes,0),
    packagedMediaBytes: groups.reduce((sum,g)=>sum+g.mediaBytes,0),
    files
  };
}
function check() {
  const report=inventory();
  const outer=JSON.parse(fs.readFileSync(path.resolve(root,'../project.config.json'),'utf8'));
  const inner=JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8'));
  if(outer.miniprogramRoot!=='miniprogram/'||inner.miniprogramRoot!=='./')throw Error('Upload roots are not isolated');
  for(const config of [outer,inner])if(!config.setting.minified||!config.setting.minifyWXSS||!config.setting.minifyWXML||config.setting.uploadWithSourceMap)throw Error('Upload minification must stay enabled and source maps must stay disabled');
  for(const dir of ['dsh-console','harmonyos','native-app','dsh-mini','resources','tests','scripts','node_modules'])if(fs.existsSync(path.join(root,dir)))throw Error('Non-miniapp directory in upload root: '+dir);
  for(const group of report.groups)if(group.bytes>BUDGET)throw Error(group.name+' exceeds the 1.8 MiB source budget ('+group.bytes+' bytes). Split or optimize before upload.');
  if(report.groups[0].mediaBytes>=MEDIA_BUDGET)throw Error('Main package image/audio resources must stay below 200 KiB ('+report.groups[0].mediaBytes+' bytes).');
  if(report.packagedMediaBytes>=MEDIA_BUDGET)throw Error('All-package image/audio resources must stay below 200 KiB ('+report.packagedMediaBytes+' bytes). Remove duplicates or optimize media before upload.');
  return report;
}
if(require.main===module){try{const r=check();console.log(JSON.stringify({root:r.root,sourceBudgetBytes:BUDGET,mainPackageCompiledLimitBytes:MAIN_LIMIT,compiledPackageLimitBytes:LIMIT,allPackageMediaBudgetBytes:MEDIA_BUDGET,packagedMediaBytes:r.packagedMediaBytes,totalBytes:r.totalBytes,packages:r.groups.map(g=>({...g,KiB:+(g.bytes/1024).toFixed(1),mediaKiB:+(g.mediaBytes/1024).toFixed(1)})),note:'Source inventory and required minification settings; confirm final package sizes in WeChat DevTools after recompiling.'},null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={inventory,check,LIMIT,MAIN_LIMIT,BUDGET,MEDIA_BUDGET};
