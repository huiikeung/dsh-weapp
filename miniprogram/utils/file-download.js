const { t } = require('./ui-preferences');
const { relativePath } = require('./file-deliverables');
const SHA256 = require('./file-sha256');
const MAX_BYTES = 50 * 1024 * 1024;
function fsCall(fs, method, options) {
  return new Promise((resolve,reject)=>fs[method](Object.assign({},options,{success:resolve,fail:reject})));
}
function removeFile(path, api = wx) {
  if (path) return fsCall(api.getFileSystemManager(), 'unlink', { filePath:path }).catch(()=>{});
  return Promise.resolve();
}
async function downloadFile(client, file, options = {}) {
  const api=options.api || wx, job=options.job || {}, generation=client.connectGeneration;
  const path=relativePath(file.path, options.cwd);
  if(client._activeFileDownload) throw Error(t('文件正在下载，请稍候'));
  client._activeFileDownload=job;
  let transferId, temporary, finalPath, completed=false;
  const check=()=>{
    if(job.cancelled || client.connectGeneration!==generation || (options.isCurrent && !options.isCurrent())) {
      throw Object.assign(Error(t('文件下载已取消')), {cancelled:true});
    }
  };
  try {
    check();
    const opened=await client.openFileDownload(file.sessionId,path);
    transferId=opened.transferId; check();
    if(!transferId || opened.sessionId!==file.sessionId || opened.path!==path || !Number.isSafeInteger(opened.size) || opened.size<0 || !Number.isSafeInteger(opened.chunkBytes) || opened.chunkBytes<=0) throw Error(t('文件下载响应无效'));
    if(opened.size>MAX_BYTES) throw Error(t('小程序单次最多打开 50 MB 文件'));
    const fs=api.getFileSystemManager();
    const id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
    const name=String(opened.name || 'file').replace(/[\\/\x00-\x1f:*?"<>|]/g,'_').slice(-160);
    finalPath=api.env.USER_DATA_PATH+'/dsh-file-'+id+'-'+name; temporary=finalPath+'.part';
    await fsCall(fs,'writeFile',{filePath:temporary,data:new ArrayBuffer(0)});
    const digest=new SHA256(); let offset=0;
    while(true) {
      check();const frame=await client.readFileDownload(transferId,offset);check();
      if(frame.transferId!==transferId || frame.offset!==offset || typeof frame.data!=='string' || typeof frame.eof!=='boolean' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) throw Error(t('文件下载响应无效'));
      const bytes=new Uint8Array(api.base64ToArrayBuffer(frame.data));
      if(bytes.length>opened.chunkBytes || offset+bytes.length>opened.size || (!frame.eof && !bytes.length)) throw Error(t('文件下载响应无效'));
      digest.update(bytes);
      if(bytes.length) await fsCall(fs,'appendFile',{filePath:temporary,data:bytes.buffer});
      offset+=bytes.length;check();
      if(options.onProgress) options.onProgress(opened.size ? Math.floor(offset/opened.size*100) : 100);
      if(frame.eof) {
        if(offset!==opened.size || typeof frame.sha256!=='string' || digest.hex()!==frame.sha256.toLowerCase()) throw Error(t('文件校验失败，请重新下载'));
        break;
      }
    }
    await fsCall(fs,'rename',{oldPath:temporary,newPath:finalPath});check();completed=true;
    return Object.assign({},file,{localPath:finalPath,size:opened.size,mediaType:opened.mediaType});
  } finally {
    if(!completed) {
      if(transferId && client.connectGeneration===generation) client.cancelFileDownload(transferId).catch(()=>{});
      await removeFile(temporary,api);await removeFile(finalPath,api);
    }
    if(client._activeFileDownload===job) client._activeFileDownload=null;
  }
}
module.exports={downloadFile,removeFile,fsCall,MAX_BYTES};
