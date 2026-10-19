const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const name of ['interface','trajectory']){const source=JSON.parse(fs.readFileSync(path.join(root,'resources/i18n',name+'.json'),'utf8').replace(/^\uFEFF/,''));fs.writeFileSync(path.join(root,'miniprogram/i18n',name+'.js'),'// Generated from resources/i18n; run node scripts/sync-i18n.cjs.\nmodule.exports = '+JSON.stringify(source)+';\n');}
console.log('Runtime language dictionaries synchronized.');
