'use strict';
// Explicit local smoke test. Never records a microphone, changes voice settings,
// or writes a conversation. --audio accepts an explicitly supplied PCM16 mono WAV.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
async function check({ gateway, management, audio }) {
  const base = new URL(management);
  if (!path.isAbsolute(gateway) || base.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(base.hostname) || base.pathname !== '/' || base.username || base.password || base.search || base.hash) throw Error('Use an absolute gateway path and loopback HTTP origin');
  const WebSocket = createRequire(path.join(gateway,'package.json'))('ws');
  const previous = global.wx, report = {}; let client, socket, pairId, deviceId;
  const http = async (route, body) => {
    const response = await fetch(new URL(route,base), { method:body?'POST':'GET', signal:AbortSignal.timeout(10000), ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}) });
    if (!response.ok) throw Error(route + ': HTTP ' + response.status); return response.json();
  };
  try {
    const status = await http('/mgw/status'); report.gatewayVersion = status.version;
    if (!status.gatewayEnabled || !status.requireAuth) throw Error('Authenticated gateway must be enabled');
    const pair = await http('/mgw/pair',{}); pairId=pair.pairing?.id;
    const url = new URL(status.wsPath || '/ws/mobile',base); url.protocol='ws:';
    const storage=new Map([['dsh_device_id','voice-check-'+randomUUID()]]);
    global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),getSystemInfoSync:()=>({language:'zh',brand:'Voice',model:'compatibility check'}),connectSocket(o){
      socket=new WebSocket(o.url,o.protocols,{headers:o.header});
      return {onOpen:fn=>socket.on('open',fn),onMessage:fn=>socket.on('message',(data,binary)=>fn({data:binary?Uint8Array.from(data).buffer:data.toString()})),onError:fn=>socket.on('error',()=>fn({errMsg:'WebSocket failed'})),onClose:fn=>socket.on('close',()=>fn({})),send({data,success,fail}){socket.send(data,error=>error?fail?.({errMsg:'Send failed'}):success?.());},close(){socket.terminate();}};
    }};
    const {GatewayClient}=require('../miniprogram/utils/gateway');
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Pairing timeout')),10000);
      client=new GatewayClient({onPaired(frame){deviceId=frame.device?.id||frame.deviceId;clearTimeout(timer);resolve();},onState(state){if(state==='failed'){clearTimeout(timer);reject(Error('Connection failed'));}}});
      client.connect(url.href,{pairingCode:pair.payload.pairingCode});
    });
    const catalog=await client.requestPlugin('speech-catalog',{},10000);
    report.available=catalog.available;report.selection=catalog.selection;
    report.providers=(catalog.providers||[]).map(p=>({id:p.id,phase:p.preparation?.phase}));
    report.maxAudioBytes=catalog.maxAudioBytes;report.maxDurationSeconds=catalog.maxDurationSeconds;
    if(audio){
      const {catalogLimits,pcmToWav}=require('../miniprogram/utils/voice-input');const limits=catalogLimits(catalog);
      const source=fs.readFileSync(audio);let format,pcm;
      if(source.toString('ascii',0,4)!=='RIFF'||source.toString('ascii',8,12)!=='WAVE')throw Error('Expected WAV');
      for(let at=12;at+8<=source.length;){const size=source.readUInt32LE(at+4),kind=source.toString('ascii',at,at+4);if(at+8+size>source.length)throw Error('Invalid WAV chunk');if(kind==='fmt ')format=source.subarray(at+8,at+8+size);if(kind==='data')pcm=source.subarray(at+8,at+8+size);at+=8+size+(size%2);}
      if(!format||format.length<16||!pcm||pcm.length>limits.maxPcmBytes||format.readUInt16LE(0)!==1||format.readUInt16LE(2)!==1||format.readUInt32LE(4)!==16000||format.readUInt16LE(14)!==16)throw Error('Expected bounded mono PCM16 16kHz WAV');
      // Exercise the exact mini-program canonical encoder (strip platform LIST/JUNK chunks).
      const wav=Buffer.from(pcmToWav(Uint8Array.from(pcm).buffer,limits.maxPcmBytes));
      const result=await client.requestPlugin('speech-transcribe',{audioBase64:wav.toString('base64'),providerId:limits.providerId,language:limits.language},185000);
      report.transcription={text:result.text,audioSeconds:result.audioSeconds,inferenceSeconds:result.inferenceSeconds};
    }
  } finally {
    client?.disconnect();socket?.terminate();
    if(previous===undefined)delete global.wx;else global.wx=previous;
    if(deviceId||pairId){const result=await http('/mgw/devices/'+encodeURIComponent(deviceId||pairId)+'/revoke',{});report.temporaryDeviceRevoked=result.revoked===true;if(!report.temporaryDeviceRevoked)throw Error('Temporary device revocation failed');}
  }
  return report;
}
if(require.main===module){const args=process.argv.slice(2),option=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;check({gateway:option('--gateway'),management:option('--management'),audio:option('--audio')}).then(value=>console.log(JSON.stringify(value,null,2))).catch(error=>{console.error(JSON.stringify({code:error.code,message:error.message}));process.exitCode=1;});}
module.exports={check};
