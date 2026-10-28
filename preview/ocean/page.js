// Renders the staged ocean-background previews inside preview/ocean/index.html.
// Generated CSS/modules/config come from scripts/build-ocean-preview.cjs; this
// file only mirrors the layer DOM of the shipped wxml and drives Chrome.
'use strict';
(function () {
  var CFG = window.OCEAN_PREVIEW;
  var MODULES = { before: window.OCEAN_MODULE_BEFORE, after: window.OCEAN_MODULE_AFTER };
  var MIN_RATIO = 0.4; // shipped renderer clamps its buffer ratio to >= 0.4

  function make(tag, className, attrs) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (attrs) for (var key in attrs) el.setAttribute(key, attrs[key]);
    return el;
  }

  function dataUrlBytes(url) {
    var comma = url.indexOf(',');
    if (comma < 0) return 0;
    var base64 = url.length - comma - 1;
    var padding = url.charAt(url.length - 1) === '=' ? (url.charAt(url.length - 2) === '=' ? 2 : 1) : 0;
    return Math.ceil(base64 * 3 / 4) - padding;
  }

  function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

  function loadImage(img, src) {
    return new Promise(function (resolve, reject) {
      img.onload = function () { resolve(); };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = src;
    });
  }

  function setMeta(stage, text) {
    var el = document.querySelector('[data-meta="' + stage + '"]');
    if (el) el.textContent = text;
  }

  function forceBuffer(canvas, ratio) {
    var width = Math.max(1, Math.round(CFG.width * ratio));
    var height = Math.max(1, Math.round(CFG.height * ratio));
    canvas.width = width;
    canvas.height = height;
    var gl = canvas.getContext('webgl');
    if (gl) gl.viewport(0, 0, width, height);
  }

  function drawFrame(module, ratio, time, quality) {
    var canvas = document.createElement('canvas');
    var renderer = module.createOceanRenderer(canvas, CFG.width, CFG.height, ratio);
    if (ratio < MIN_RATIO) forceBuffer(canvas, ratio);
    renderer.draw(time);
    var url = canvas.toDataURL('image/jpeg', quality);
    var result = {
      canvas: canvas,
      renderer: renderer,
      url: url,
      bytes: dataUrlBytes(url),
      buffer: [canvas.width, canvas.height]
    };
    try { renderer.dispose(); } catch (error) { /* free GPU while keeping the encoded frame */ }
    return result;
  }

  function freezeStage(root, seconds) {
    var grain = root.querySelector('.ocean-grain');
    if (grain) {
      grain.style.animation = 'none';
      grain.style.backgroundPosition = CFG.freeze.grainPosition;
    }
    var settle = root.querySelector('.ocean-settle');
    if (settle) {
      settle.style.animation = 'none';
      settle.style.opacity = String(0.10 * Math.min(1, seconds / 24));
    }
    var whale = root.querySelector('.ocean-whale');
    if (whale) {
      whale.style.animation = 'none';
      whale.style.transform = 'translate(-50%, -50%)';
    }
    // Split whale layers: freeze the tail sway and the shimmer for deterministic stills.
    var whaleBody = root.querySelector('.ocean-whale-body');
    var whaleTail = root.querySelector('.ocean-whale-tail');
    if (whaleBody) { whaleBody.style.animation = 'none'; whaleBody.style.opacity = '1'; }
    if (whaleTail) { whaleTail.style.animation = 'none'; whaleTail.style.opacity = '1'; whaleTail.style.transform = 'none'; }
    var art = root.querySelector('.ocean-whale-art');
    if (art) {
      art.style.animation = 'none';
      art.style.opacity = '1';
    }
  }

  // --- BEFORE: mirrors the shipped (pre-split-layer) ocean-background.wxml -----
  function beforeFallback(hidden) {
    var fallback = make('div', 'ocean-fallback' + (hidden ? ' ocean-fallback-hidden' : ''));
    fallback.appendChild(make('div', 'ocean-fallback-light'));
    var whale = make('img', 'ocean-fallback-whale');
    whale.alt = '';
    whale.src = CFG.assets.whaleFallback;
    fallback.appendChild(whale);
    return fallback;
  }

  function commonOverlays(root) {
    root.appendChild(make('div', 'ocean-grain'));
    root.appendChild(make('div', 'ocean-depth'));
    root.appendChild(make('div', 'ocean-settle'));
  }

  function buildBeforeStage() {
    var phone = document.querySelector('[data-phone="before"]');
    phone.className = 'phone ocean-before';
    var root = make('div', 'ocean-root ocean-background preview-freeze');
    root.appendChild(beforeFallback(true));
    var frame = make('img', 'ocean-frame');
    frame.alt = '';
    root.appendChild(frame);
    commonOverlays(root);
    phone.appendChild(root);
    freezeStage(root, CFG.before.time);
    var rendered = drawFrame(MODULES.before, CFG.before.ratio, CFG.before.time, CFG.before.quality);
    return loadImage(frame, rendered.url).then(function () {
      setMeta('before', '整帧 ' + rendered.buffer[0] + '×' + rendered.buffer[1] + ' · JPEG ' + kb(rendered.bytes) +
        ' · 拉伸到 1170×2532（' + (CFG.dpr / CFG.before.ratio).toFixed(2) + '× 上采样）');
    });
  }

  function buildFallbackStage() {
    var phone = document.querySelector('[data-phone="fallback"]');
    phone.className = 'phone ocean-before';
    var root = make('div', 'ocean-root ocean-background preview-freeze');
    root.appendChild(beforeFallback(false));
    commonOverlays(root);
    phone.appendChild(root);
    freezeStage(root, 0.1);
    var light = root.querySelector('.ocean-fallback-light');
    if (light) {
      light.style.animation = 'none';
      light.style.transform = 'translate(-1%, -1%)';
      light.style.opacity = '0.7';
    }
    setMeta('fallback', 'WebGL 就绪前：linear-gradient + 一张 115vw 的 bg-whale.png');
    var whale = root.querySelector('.ocean-fallback-whale');
    if (whale && whale.decode) return whale.decode().catch(function () {});
    return Promise.resolve();
  }

  // --- AFTER: mirrors the split-layer ocean-background.wxml --------------------
  function buildLayers(parent, layers) {
    layers.forEach(function (layer) {
      var el = make(layer.tag, layer.className);
      if (layer.src === '$WHALE') el.src = CFG.after.whale;
      if (layer.src === '$WHALE_BODY') el.src = CFG.after.whales['ocean-whale-body'];
      if (layer.src === '$WHALE_TAIL') el.src = CFG.after.whales['ocean-whale-tail'];
      if (layer.src === '$FLUID_FRAME') el.dataset.fluidFrame = '1';
      if (layer.children) buildLayers(el, layer.children);
      parent.appendChild(el);
    });
  }

  function buildAfterStage(name, fluidOpacity, settleSeconds, fluidTime) {
    if (!CFG.after) return Promise.resolve();
    var phone = document.querySelector('[data-phone="' + name + '"]');
    if (!phone) return Promise.resolve();
    phone.className = 'phone ocean-after';
    var rendered = drawFrame(MODULES.after, CFG.after.ratio, fluidTime == null ? CFG.after.time : fluidTime, CFG.after.quality);
    var root = make('div', 'ocean-root ocean-background ocean-ready preview-freeze');
    buildLayers(root, CFG.after.layers);
    phone.appendChild(root);
    var fluid = root.querySelector('.ocean-fluid');
    if (fluid) {
      fluid.style.transition = 'none';
      fluid.style.opacity = String(fluidOpacity);
      if (fluidOpacity > 0) fluid.classList.add('ocean-fluid-live');
    }
    freezeStage(root, settleSeconds);
    var frame = root.querySelector('[data-fluid-frame]');
    var meta = '流体帧 ' + rendered.buffer[0] + '×' + rendered.buffer[1] + ' · JPEG ' + kb(rendered.bytes) +
      ' · 网格+鲸鱼按设备像素绘制';
    if (fluidOpacity < 1) meta += ' · 流体淡入 ' + Math.round(fluidOpacity * 100) + '%';
    setMeta(name, meta);
    if (!frame) return Promise.resolve();
    return loadImage(frame, rendered.url);
  }

  // --- benchmark / pipeline ---------------------------------------------------
  function mean(list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i];
    return total / list.length;
  }

  function percentile(list, value) {
    if (!list.length) return 0;
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    var index = Math.min(sorted.length - 1, Math.floor(sorted.length * value));
    return sorted[index];
  }

  function runBenchmark(which) {
    var module = MODULES[which];
    var ratios = CFG.benchmark.ratios;
    var qualities = CFG.benchmark.qualities;
    var frames = CFG.benchmark.frames;
    var rows = [];
    var glRenderer = null;
    for (var ri = 0; ri < ratios.length; ri++) {
      var ratio = ratios[ri];
      var canvas = document.createElement('canvas');
      var renderer = module.createOceanRenderer(canvas, CFG.width, CFG.height, ratio);
      if (ratio < MIN_RATIO) forceBuffer(canvas, ratio);
      if (!glRenderer) {
        try {
          var gl = canvas.getContext('webgl');
          var ext = gl.getExtension('WEBGL_debug_renderer_info');
          glRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
        } catch (error) { glRenderer = 'unavailable'; }
      }
      for (var qi = 0; qi < qualities.length; qi++) {
        var quality = qualities[qi];
        for (var warm = 0; warm < 3; warm++) renderer.draw(warm / 8);
        var draws = [], encodes = [], totals = [];
        var bytes = 0;
        for (var i = 0; i < frames; i++) {
          var start = performance.now();
          renderer.draw(i / 8);
          var mid = performance.now();
          var url = canvas.toDataURL('image/jpeg', quality);
          var end = performance.now();
          draws.push(mid - start);
          encodes.push(end - mid);
          totals.push(end - start);
          bytes = dataUrlBytes(url);
        }
        rows.push({
          ratio: ratio,
          effectiveRatio: Math.round(canvas.width / CFG.width * 1000) / 1000,
          clamped: Math.round(canvas.width / CFG.width * 1000) / 1000 !== ratio,
          buffer: [canvas.width, canvas.height],
          quality: quality,
          avgDrawMs: Math.round(mean(draws) * 1000) / 1000,
          avgEncodeMs: Math.round(mean(encodes) * 1000) / 1000,
          avgTotalMs: Math.round(mean(totals) * 1000) / 1000,
          p95TotalMs: Math.round(percentile(totals, 0.95) * 1000) / 1000,
          dataUrlBytes: bytes
        });
      }
      try {
        var lose = canvas.getContext('webgl').getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (error) { /* canvas is detached */ }
    }
    return { glRenderer: glRenderer, frames: frames, width: CFG.width, height: CFG.height, dpr: CFG.dpr, rows: rows };
  }

  async function runPipeline(which) {
    var module = MODULES[which];
    var frameConfig = which === 'after' ? CFG.after : CFG.before;
    if (!frameConfig) return null;
    var canvas = document.createElement('canvas');
    var renderer = module.createOceanRenderer(canvas, CFG.width, CFG.height, frameConfig.ratio);
    if (frameConfig.ratio < MIN_RATIO) forceBuffer(canvas, frameConfig.ratio);
    var samples = [];
    var bytes = 0;
    for (var i = 0; i < 10; i++) {
      var start = performance.now();
      renderer.draw(frameConfig.time + i * 0.5);
      var encoded = performance.now();
      var url = canvas.toDataURL('image/jpeg', frameConfig.quality);
      var encodeDone = performance.now();
      var img = new Image();
      img.src = url;
      if (img.decode) { try { await img.decode(); } catch (error) { /* decode timing best effort */ } }
      else { await loadImage(img, url); }
      var decoded = performance.now();
      bytes = dataUrlBytes(url);
      samples.push({
        drawMs: encoded - start,
        encodeMs: encodeDone - encoded,
        decodeMs: decoded - encodeDone,
        totalMs: decoded - start
      });
    }
    var pick = function (key) { return samples.map(function (sample) { return sample[key]; }); };
    return {
      which: which,
      ratio: frameConfig.ratio,
      quality: frameConfig.quality,
      buffer: [canvas.width, canvas.height],
      dataUrlBytes: bytes,
      avgDrawMs: Math.round(mean(pick('drawMs')) * 1000) / 1000,
      avgEncodeMs: Math.round(mean(pick('encodeMs')) * 1000) / 1000,
      avgDecodeMs: Math.round(mean(pick('decodeMs')) * 1000) / 1000,
      avgTotalMs: Math.round(mean(pick('totalMs')) * 1000) / 1000
    };
  }

  function loadPoster() {
    var baseEl = document.querySelector('.ocean-after .ocean-base');
    if (!baseEl) return Promise.resolve(null);
    var value = getComputedStyle(baseEl).backgroundImage || '';
    var match = value.match(/url\("?([^")]+)"?\)/);
    if (!match) return Promise.resolve(null);
    var img = new Image();
    return loadImage(img, match[1]).then(function () { return img; });
  }

  function compareLayers(imageA, canvasB) {
    var width = 390, height = 844;
    var canvasA = document.createElement('canvas');
    canvasA.width = width; canvasA.height = height;
    var contextA = canvasA.getContext('2d');
    contextA.imageSmoothingEnabled = true;
    contextA.drawImage(imageA, 0, 0, width, height);
    var dataA = contextA.getImageData(0, 0, width, height).data;
    var dataB = canvasB.getContext('2d').getImageData(0, 0, width, height).data;
    var total = 0, max = 0, over4 = 0, over8 = 0, count = width * height;
    var diffs = [];
    for (var i = 0; i < dataA.length; i += 4) {
      var diff = Math.abs(dataA[i] - dataB[i]) + Math.abs(dataA[i + 1] - dataB[i + 1]) + Math.abs(dataA[i + 2] - dataB[i + 2]);
      diff = diff / 3;
      total += diff;
      if (diff > max) max = diff;
      if (diff > 4) over4++;
      if (diff > 8) over8++;
      diffs.push(diff);
    }
    diffs.sort(function (a, b) { return a - b; });
    return {
      mean: Math.round(total / count * 100) / 100,
      p95: Math.round(diffs[Math.floor(count * 0.95)] * 100) / 100,
      max: Math.round(max * 100) / 100,
      pctOver4: Math.round(over4 / count * 1000) / 10,
      pctOver8: Math.round(over8 / count * 1000) / 10
    };
  }

  function jpegBlockiness() {
    // Boundary-vs-interior gradient energy of the decoded fluid frame at its
    // native buffer resolution: ~1.0 = no visible 8x8 blocking.
    var rendered = drawFrame(MODULES.after, CFG.after.ratio, CFG.after.time, CFG.after.quality);
    var img = new Image();
    return loadImage(img, rendered.url).then(function () {
      var canvas = document.createElement('canvas');
      canvas.width = rendered.buffer[0];
      canvas.height = rendered.buffer[1];
      var context = canvas.getContext('2d');
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      var data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      var width = canvas.width, height = canvas.height;
      var lum = new Float32Array(width * height);
      for (var i = 0, p = 0; i < data.length; i += 4, p++) {
        lum[p] = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
      }
      function gradients(boundary) {
        var sum = 0, count = 0;
        for (var y = 1; y < height; y++) {
          for (var x = 1; x < width; x++) {
            if (boundary ? (x % 8 === 0 || y % 8 === 0) : (x % 8 !== 0 && x % 8 !== 1 && y % 8 !== 0 && y % 8 !== 1)) {
              sum += Math.abs(lum[y * width + x] - lum[y * width + x - 1]) + Math.abs(lum[y * width + x] - lum[(y - 1) * width + x]);
              count += 2;
            }
          }
        }
        return sum / count;
      }
      var boundary = gradients(true);
      var interior = gradients(false);
      return {
        ratio: CFG.after.ratio,
        quality: CFG.after.quality,
        buffer: [width, height],
        dataUrlBytes: rendered.bytes,
        boundaryGradient: Math.round(boundary * 1e5) / 1e5,
        interiorGradient: Math.round(interior * 1e5) / 1e5,
        blockinessRatio: Math.round((boundary / interior) * 1000) / 1000
      };
    });
  }

  async function measureAfterArtifacts() {
    if (!CFG.after) return null;
    var poster = await loadPoster();
    var result = { seam: null, blockiness: await jpegBlockiness() };
    if (!poster) return result;
    function fluidLayer(time) {
      var rendered = drawFrame(MODULES.after, CFG.after.ratio, time, CFG.after.quality);
      var canvas = document.createElement('canvas');
      canvas.width = 390; canvas.height = 844;
      var context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      var img = new Image();
      return loadImage(img, rendered.url).then(function () {
        context.drawImage(img, 0, 0, 390, 844);
        return canvas;
      });
    }
    var first = await fluidLayer(0);
    var after200 = await fluidLayer(0.2);
    result.seam = {
      posterVsFluid0: compareLayers(poster, first),
      posterVsFluid200ms: compareLayers(poster, after200),
      fluid0VsFluid200ms: compareLayers(first, after200)
    };
    return result;
  }

  window.__OCEAN_PREVIEW_API = {
    runBenchmark: runBenchmark,
    runPipeline: runPipeline,
    measureAfterArtifacts: measureAfterArtifacts
  };

  (async function boot() {
    try {
      await buildBeforeStage();
      await buildFallbackStage();
      await buildAfterStage('after', 1, CFG.after ? CFG.after.time : CFG.before.time);
      await buildAfterStage('after-base', 0, 0.1);
      // The shipped 520ms fade starts from the t=0 poster: show the seam with the
      // first fluid frame ~200ms in, not with the steady 8s frame.
      await buildAfterStage('after-crossfade', 0.5, 0.3, 0.2);
      var native = document.querySelector('.native-ref');
      if (native && native.decode) { try { await native.decode(); } catch (error) { /* screenshot still works */ } }
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (error) { /* fonts optional */ } }
      document.body.dataset.ready = '1';
      window.__PREVIEW_READY = true;
    } catch (error) {
      document.body.dataset.error = String(error && error.message || error);
      window.__PREVIEW_READY = false;
      console.error(error);
    }
  })();
})();
