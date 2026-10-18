// Phone fluid/particle port of dsh-mobile @ 70b60b7 (MIT).
// Copyright (c) 2026 Chaofan Li. See THIRD_PARTY_NOTICES.md.
const particles = require('./ocean-particles');
const VERTEX = 'attribute vec2 aPosition; void main(){ gl_Position=vec4(aPosition,0.0,1.0); }';
const FRAGMENT = `
precision highp float;
uniform vec2 uSize;
uniform vec2 uBufferSize;
uniform float uTime;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+1.0),u.x),u.y);}
float fbm(vec2 p){float v=0.0,a=0.56;mat2 rotation=mat2(0.80,-0.60,0.60,0.80);for(int i=0;i<4;i++){v+=a*noise(p);p=rotation*p*2.03+17.17;a*=0.46;}return v;}
void main(){
 vec2 uv=vec2(gl_FragCoord.x/uBufferSize.x,1.0-gl_FragCoord.y/uBufferSize.y);
 float aspect=uSize.x/uSize.y,t=uTime*0.075;
 vec2 p=vec2(uv.x*aspect,uv.y)*2.05+vec2(-0.30,-0.08);
 vec2 q=vec2(fbm(p*0.62+vec2(0,t)),fbm(p*0.62+vec2(5.2,1.3-t)));
 vec2 r=vec2(fbm(p*0.72+q*0.62+vec2(1.7,3.1+t*0.7)),fbm(p*0.72+q*0.62+vec2(9.2,5.7-t*0.65)));
 float fluid=fbm((p+q*0.76+r*0.52)*0.72+t*0.25),swirl=noise(p*1.25+r*2.1-t*0.42);
 vec3 deep=vec3(0.102,0.220,0.439),color=mix(vec3(0.002,0.008,0.018),deep,smoothstep(0.14,0.63,fluid));
 color=mix(color,vec3(0.125,0.290,0.494),smoothstep(0.42,0.82,fluid+swirl*0.18));
 color=mix(color,vec3(0.325,0.553,0.790),smoothstep(0.74,0.98,swirl)*0.18);
 vec2 warped=vec2(uv.x*aspect,uv.y)+(q-0.5)*0.085+(r-0.5)*0.045;
 float ra=length(warped-vec2(aspect*0.58,0.16)),rb=length(warped-vec2(aspect*-0.20,0.13));
 float a=exp(-pow((ra-(0.35+0.025*sin(t*1.5)))/0.042,2.0));
 float b=exp(-pow((rb-(0.83+0.020*cos(t*1.15)))/0.065,2.0));
 color=mix(color,vec3(0.933,0.847,0.667),clamp(a*0.78+b*0.62,0.0,1.0)*(0.48+0.24*swirl)*0.55);
 float glow=1.0-smoothstep(0.18,0.90,length((uv-vec2(0.58,0.32))*vec2(0.82,1)));
 color+=deep*glow*0.22;
 float vignette=1.0-smoothstep(0.23,0.95,length((uv-0.5)*vec2(0.86,1)));
 color*=0.38+0.72*vignette;
 color+=(hash(uv*uSize+floor(uTime*12.0))-0.5)*0.010;
 // Native 42pt grid and sparse intersections, faded below the whale.
 vec2 pixel=uv*uSize,cell=mod(pixel+21.0,42.0)-21.0;
 float fade=uv.y<0.56?mix(0.8,1.0,uv.y/0.56):1.0-smoothstep(0.56,1.0,uv.y);
 float line=1.0-smoothstep(0.10,0.65,min(abs(cell.x),abs(cell.y)));
 color=mix(color,vec3(1),line*0.043*fade);
 vec2 index=floor(pixel/42.0+0.5);
 float square=(1.0-step(1.1,max(abs(cell.x),abs(cell.y))))*(1.0-step(0.5,mod(index.y*11.0+index.x*7.0,13.0)));
 color=mix(color,vec3(1),square*0.085*fade);
 gl_FragColor=vec4(max(color,0.0),1);
}`;
const WHALE_VERTEX = `
precision highp float;
attribute vec4 aParticle;
attribute vec2 aLight;
uniform vec2 uSize;
uniform float uTime;
uniform float uRatio;
varying vec3 vColor;
varying float vAlpha;
void main(){
 float x=aParticle.x,y=aParticle.y,l=aParticle.z,edge=aParticle.w,phase=aLight.x,light=aLight.y;
 float square=max(uSize.x*1.15,uSize.y*0.48),tail=smoothstep(0.54,0.94,x),drift=0.35+0.65*edge;
 vec2 point=uSize*vec2(0.55,0.34)+(vec2(x,y)-0.5)*square;
 point.x+=sin(uTime*0.50+phase*0.53)*2.8*drift;
 point.y+=cos(uTime*0.42+phase*0.71)*2.6*drift+sin(uTime*1.10-x*7.0)*7.0*tail;
 gl_Position=vec4(point.x/uSize.x*2.0-1.0,1.0-point.y/uSize.y*2.0,0,1);
 gl_PointSize=max(1.45,square/220.0)*(0.72+l*0.58)*uRatio;
 vColor=vec3(0.73+0.15*light,0.79+0.12*light,0.92+0.08*light);
 vAlpha=(0.10+l*0.38)*(0.90+0.10*sin(uTime*1.5+x*15.0+y*9.0))*0.56;
}`;
const WHALE_FRAGMENT = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main(){vec2 q=abs(gl_PointCoord-0.5)-vec2(0.32);float distance=length(max(q,0.0))-0.18;float mask=1.0-smoothstep(-0.06,0.04,distance);gl_FragColor=vec4(vColor*vAlpha*mask,1);}
`;
function createOceanRenderer(canvas, width, height, pixelRatio) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL unavailable');
  const shaders = [], programs = [], buffers = [];
  function dispose() { buffers.forEach(b => gl.deleteBuffer(b)); programs.forEach(p => gl.deleteProgram(p)); shaders.forEach(s => gl.deleteShader(s)); }
  function program(vs, fs) {
    const p = gl.createProgram(); programs.push(p);
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); shaders.push(s); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Ocean shader compilation failed');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Ocean shader link failed');
    return p;
  }
  function buffer(data) { const b = gl.createBuffer(); buffers.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return b; }
  try {
    const fluid = program(VERTEX, FRAGMENT), whale = program(WHALE_VERTEX, WHALE_FRAGMENT);
    const quad = buffer([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const dots = buffer([].concat(...particles));
    const position = gl.getAttribLocation(fluid, 'aPosition');
    const dotPosition = gl.getAttribLocation(whale, 'aParticle'), dotLight = gl.getAttribLocation(whale, 'aLight');
    const uniforms = p => ({ size: gl.getUniformLocation(p, 'uSize'), time: gl.getUniformLocation(p, 'uTime'), ratio: gl.getUniformLocation(p, 'uRatio'), bufferSize: gl.getUniformLocation(p, 'uBufferSize') });
    const fu = uniforms(fluid), wu = uniforms(whale);
    let ratio;
    function resize(w, h, dpr) {
      width = Math.max(1, w); height = Math.max(1, h);
      ratio = Math.max(0.5, Math.min(dpr || 1, 1.5, 1200 / height));
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize(width, height, pixelRatio);
    return {
      resize, dispose,
      draw(time) {
        gl.disable(gl.BLEND); gl.useProgram(fluid); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        if (dotLight !== position) gl.disableVertexAttribArray(dotLight);
        if (dotPosition !== position) gl.disableVertexAttribArray(dotPosition);
        gl.uniform2f(fu.size, width, height); gl.uniform2f(fu.bufferSize, canvas.width, canvas.height); gl.uniform1f(fu.time, time);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.useProgram(whale); gl.bindBuffer(gl.ARRAY_BUFFER, dots);
        gl.enableVertexAttribArray(dotPosition); gl.vertexAttribPointer(dotPosition, 4, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(dotLight); gl.vertexAttribPointer(dotLight, 2, gl.FLOAT, false, 24, 16);
        gl.uniform2f(wu.size, width, height); gl.uniform1f(wu.time, time); gl.uniform1f(wu.ratio, ratio);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
        gl.drawArrays(gl.POINTS, 0, particles.length); gl.disable(gl.BLEND);
      }
    };
  } catch (error) { dispose(); throw error; }
}
module.exports = { createOceanRenderer, VERTEX, FRAGMENT, WHALE_VERTEX, WHALE_FRAGMENT };
