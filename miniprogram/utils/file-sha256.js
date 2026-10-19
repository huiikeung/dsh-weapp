// Incremental SHA-256: bounded 64-byte state, no whole-file JS allocation.
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotate = (v, n) => (v >>> n) | (v << (32 - n));
class FileSHA256 {
  constructor() {
    this.state = new Int32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    this.block = new Uint8Array(64); this.words = new Int32Array(64); this.used = 0; this.length = 0;
  }
  compress() {
    const w = this.words, b = this.block, s = this.state;
    for (let i = 0; i < 16; i++) w[i] = (b[i*4]<<24)|(b[i*4+1]<<16)|(b[i*4+2]<<8)|b[i*4+3];
    for (let i = 16; i < 64; i++) {
      const x = w[i-15], y = w[i-2];
      w[i] = (w[i-16] + (rotate(x,7)^rotate(x,18)^(x>>>3)) + w[i-7] + (rotate(y,17)^rotate(y,19)^(y>>>10))) | 0;
    }
    let a=s[0],c=s[2],b0=s[1],d=s[3],e=s[4],f=s[5],g=s[6],h=s[7];
    for (let i=0;i<64;i++) {
      const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])|0;
      const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b0)^(a&c)^(b0&c)))|0;
      h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b0;b0=a;a=(t1+t2)|0;
    }
    [a,b0,c,d,e,f,g,h].forEach((v,i)=>{s[i]=(s[i]+v)|0;});
  }
  update(bytes) {
    this.length += bytes.length;
    let offset=0;
    while(offset<bytes.length) {
      const take=Math.min(64-this.used,bytes.length-offset);
      this.block.set(bytes.subarray(offset,offset+take),this.used);this.used+=take;offset+=take;
      if(this.used===64){this.compress();this.used=0;}
    }
  }
  hex() {
    const bits=this.length*8, pad=new Uint8Array(this.used<56?64-this.used:128-this.used);
    pad[0]=128;const view=new DataView(pad.buffer);
    view.setUint32(pad.length-8,Math.floor(bits/0x100000000));view.setUint32(pad.length-4,bits>>>0);
    this.update(pad);return Array.from(this.state,v=>(v>>>0).toString(16).padStart(8,'0')).join('');
  }
}
module.exports = FileSHA256;
