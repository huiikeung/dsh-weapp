const fs = require('node:fs');
const path = require('node:path');
function once(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw new Error('Unsupported gateway source; no files changed');
  return source.replace(before, after);
}
function adapter(source) {
  return once(source, '    settings: {', `    pluginConfiguration: {
      credentialDescribe: (ref) => invoke('credentials', 'describe', { refs: [ref] }),
      credentialSet: (ref, value) => invoke('credentials', 'set', { ref, value }),
      translationLimits: () => invoke('cotTranslation', 'limits', {}),
    },
    settings: {`);
}
function management(source) {
  source = once(source, "  'plugin-settings',", "  'plugin-credential-describe',\n  'plugin-credential-set',\n  'plugin-translation-limits',\n  'plugin-settings',");
  source = once(source, "    } else if (type === 'plugin-settings') {", `    } else if (type === 'plugin-translation-limits') {
      value = await api.pluginConfiguration.translationLimits()
    } else if (type === 'plugin-credential-describe' || type === 'plugin-credential-set') {
      if (typeof msg.ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(msg.ref)) return badRequest(type, requestId, 'invalid credential reference')
      const settings = await api.settings.describe()
      const scopes = (settings.namespaces || []).filter(item => ['web-search-deepseek', 'web-deepseek-api'].includes(item.ns))
      if (!scopes.some(item => (item.value?.apiKeyEnv || 'DEEPSEEK_API_KEY') === msg.ref)) return badRequest(type, requestId, 'reference is not used by web search')
      if (type === 'plugin-credential-set') {
        if (settings.writable !== true) return badRequest(type, requestId, 'settings are read-only')
        if (typeof msg.value !== 'string' || !msg.value.trim() || msg.value.length > 8192) return badRequest(type, requestId, 'invalid credential value')
        try { await api.pluginConfiguration.credentialSet(msg.ref, msg.value) }
        catch { return { kind: 'error', code: 'plugin-credentials/write-failed', message: 'Credential write failed', requestId, requestType: type } }
        value = { saved: true }
      } else {
        const descriptions = await api.pluginConfiguration.credentialDescribe(msg.ref)
        const view = descriptions[msg.ref]
        value = { configured: view?.configured === true, writable: settings.writable === true && view?.writable === true }
      }
    } else if (type === 'plugin-settings') {`);
  return source;
}
function install(root, checkOnly) {
  if (!root || !path.isAbsolute(root)) throw new Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-mobile-gateway','dsh-plugin-weapp-gateway'].includes(manifest.name)) throw new Error('Not a supported gateway package');
  const edits = [['lib/dsh-host-adapter.mjs', adapter],['lib/plugin-management.mjs',management]].map(([file, transform]) => {
    const target=path.join(root,file),original=fs.readFileSync(target,'utf8');return {target,original,updated:transform(original)};
  }).filter(edit=>edit.original!==edit.updated);
  if(checkOnly)return {compatible:true,files:edits.map(edit=>edit.target)};
  const stamp=Date.now();for(const edit of edits)fs.writeFileSync(edit.target+'.before-plugin-settings-'+stamp,edit.original,{flag:'wx'});
  const applied=[];try{for(const edit of edits){applied.push(edit);fs.writeFileSync(edit.target,edit.updated);}}
  catch(error){for(const edit of applied)fs.writeFileSync(edit.target,edit.original);throw error;}
  return {updated:edits.length,restartRequired:edits.length>0};
}
if(require.main===module){try{console.log(JSON.stringify(install(process.argv[2],process.argv.includes('--check')),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={adapter,management,install};
