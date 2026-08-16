// GARGANTUA — entry point. WebGL2 renderer, HDR raytracer pass, bloom chain,
// final composite, camera controls, cinematic loop, persistence, URL automation.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { PARAMS, PARAM_MAP, DEFAULTS, QUALITY, QUALITY_KEYS, PRESETS } from './config.js';
import { State, parseURL } from './state.js';
import { RAYVERT, RAYFRAG, BL_DOWN_VERT, BL_DOWN_FRAG, BL_UP_VERT, BL_UP_FRAG, FINAL_VERT, FINAL_FRAG } from './shaders.js';
import { CinematicCamera, PresetFlight } from './camera.js';
import { AmbientAudio } from './audio.js';
import { buildPanel, buildHUD, updateHUD, bindShortcuts, showHelp, showToast, setOverlay } from './ui.js';

const canvas = document.getElementById('gl');
const state = new State();
const audio = new AmbientAudio();
const cineCam = new CinematicCamera();
const flight = new PresetFlight();

let renderer = null;
let quadScene = null, quadCam = null, quadMesh = null;
let rayMat = null, finalMat = null;
let downMats = [], upMats = [];
let rtColor = null, rtAux = null;
let rtB = [], rtU = [];
let camera = null, controls = null;

let quality = QUALITY.high;
let qualityKey = 'high';
let renderScaleOverride = null; // from ?scale=
let W = 0, H = 0;               // internal render resolution
let t = 0, lastNow = 0, pausedAt = 0;
let frames = 0, fpsAcc = 0, fpsTime = 0;
let frameCount = 0;
let logCam = false;
let shotPending = null;
let shotReady = false;
let contextLost = false;
let initDone = false;

const logErrors = [];
const logWarnings = [];

// ---------------------------------------------------------------------------
// Error / logging collection (used by ?log_url= for automated verification)
// ---------------------------------------------------------------------------
window.addEventListener('error', (e) => {
  logErrors.push(String(e.message || e.error));
  console.error('GARGANTUA error:', e.message || e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  logErrors.push('unhandledrejection: ' + String(e.reason));
});
window.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  setOverlay(
    '<div class="overlay-card"><h2>WebGL context lost</h2>' +
    '<p>Attempting automatic recovery…</p></div>', true);
  logWarnings.push('webglcontextlost');
  setTimeout(() => { if (contextLost) { try { renderer.forceContextRestore(); } catch (_) {} } }, 250);
});
window.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  console.warn('WebGL context restored — reinitialising');
  try { initGL(); } catch (err) { fatal(err); }
});

function fatal(err) {
  console.error('GARGANTUA fatal:', err);
  setOverlay(
    '<div class="overlay-card"><h2>GARGANTUA could not start</h2>' +
    '<p>' + String((err && err.message) || err) + '</p>' +
    '<p class="dim">This page requires WebGL2. Try a recent Chrome / Edge / Firefox, ' +
    'or enable hardware acceleration.</p></div>', true);
  const h = document.getElementById('hud');
  if (h) h.style.display = 'none';
}

// ---------------------------------------------------------------------------
// GL init
// ---------------------------------------------------------------------------
function makeRT(w, h) {
  const rt = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  return rt;
}

function initGL() {
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    stencil: false,
    depth: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  const gl = renderer.getContext();
  if (!gl || !(gl instanceof WebGL2RenderingContext)) {
    throw new Error('WebGL2 is not available on this device.');
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    logWarnings.push('EXT_color_buffer_float missing — HDR rendering may fail');
  }
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.NoColorSpace;

  // fullscreen quad
  quadScene = new THREE.Scene();
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quadMesh.frustumCulled = false;
  quadScene.add(quadMesh);

  // raytracer material
  rayMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: RAYVERT,
    fragmentShader: RAYFRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3(0, 4.8, 19.5) },
      uCamBasis: { value: new THREE.Matrix3() },
      uFov: { value: THREE.MathUtils.degToRad(60) },
      uAspect: { value: 1 },
      uMaxDist: { value: 500 },
      uMaxSteps: { value: quality.steps },
      uStepScale: { value: 0.02 },
      uDiskInner: { value: 3.2 },
      uDiskOuter: { value: 22 },
      uDiskTemp: { value: 9000 },
      uTempExp: { value: 0.75 },
      uTurb: { value: 0.3 },
      uTurbSpeed: { value: 0.5 },
      uDoppler: { value: 1 },
      uRedshift: { value: 1 },
      uEmission: { value: 1.1 },
      uDiskOpacity: { value: 0.94 },
      uStarDensity: { value: 0.8 },
      uGalaxy: { value: 1 },
      uGalaxyTwist: { value: 1.2 },
      uPass: { value: 0 },
    },
  });

  // final composite material
  finalMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FINAL_VERT,
    fragmentShader: FINAL_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uColorTex: { value: null },
      uAuxTex: { value: null },
      uBloomTex: { value: null },
      uDebug: { value: 0 },
      uExposure: { value: 1 },
      uBloomIntensity: { value: 0.6 },
      uVignette: { value: 0.45 },
      uGrain: { value: 0.12 },
      uChromatic: { value: 0.25 },
    },
  });

  // bloom materials (created per octave)
  downMats = [];
  upMats = [];
  for (let i = 0; i < 5; i++) {
    const dm = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: BL_DOWN_VERT,
      fragmentShader: BL_DOWN_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTex: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uThreshold: { value: 1.0 },
        uBoost: { value: 1.0 },
      },
    });
    downMats.push(dm);
    const um = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: BL_UP_VERT,
      fragmentShader: BL_UP_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTex: { value: null },
        uAdd: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });
    upMats.push(um);
  }

  // camera + controls
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(...PRESETS[0].pos);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.8;
  controls.minDistance = 5.5;
  controls.maxDistance = 160;
  controls.minPolarAngle = 0.01;
  controls.maxPolarAngle = Math.PI - 0.01;

  // render targets (sized in resize())
  rtColor = makeRT(8, 8);
  rtAux = makeRT(4, 4);
  rtB = []; rtU = [];
  for (let i = 0; i < 5; i++) {
    rtB.push(makeRT(4, 4));
    rtU.push(makeRT(4, 4));
  }

  // apply loaded state to uniforms
  syncUniforms();
  resize();
  initDone = true;
}

// ---------------------------------------------------------------------------
// Uniform sync
// ---------------------------------------------------------------------------
function syncUniforms() {
  if (!rayMat) return;
  for (const p of PARAMS) {
    const v = state.params[p.id];
    const u = p.target === 'final' ? finalMat.uniforms[p.uniform] : rayMat.uniforms[p.uniform];
    if (u) u.value = p.target === 'final' ? v : v;
  }
  // bloom threshold lives on the first bloom down pass
  if (downMats[0]) downMats[0].uniforms.uThreshold.value = state.params.bloomThresh;
  // engine knobs
  rayMat.uniforms.uMaxSteps.value = quality.steps;
  rayMat.uniforms.uStepScale.value = state.params.stepScale * quality.stepMul;
  finalMat.uniforms.uDebug.value = state.debug;
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
function resize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = renderScaleOverride || quality.scale;
  W = Math.max(64, Math.floor(w * pr * scale));
  H = Math.max(64, Math.floor(h * pr * scale));

  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  rayMat.uniforms.uResolution.value.set(W, H);
  rayMat.uniforms.uAspect.value = w / h;

  rtColor.setSize(W, H);
  rtAux.setSize(Math.max(2, W >> 1), Math.max(2, H >> 1));

  for (let i = 0; i < 5; i++) {
    const div = Math.pow(2, i + 1);
    rtB[i].setSize(Math.max(2, W / div), Math.max(2, H / div));
    rtU[i].setSize(Math.max(2, W / div), Math.max(2, H / div));
  }

  finalMat.uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
}

// ---------------------------------------------------------------------------
// Bloom chain
// ---------------------------------------------------------------------------
function renderBloom() {
  const n = quality.bloomOctaves;
  const boost = qualityKey === 'standard' ? 1.2 : 1.0;

  // down: bright extract (first pass only) + Kawase blur
  let src = rtColor;
  for (let i = 0; i < n; i++) {
    const m = downMats[i];
    m.uniforms.uTex.value = src.texture;
    m.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    m.uniforms.uResolution.value.set(rtB[i].width, rtB[i].height);
    m.uniforms.uThreshold.value = (i === 0) ? state.params.bloomThresh : 0.0;
    m.uniforms.uBoost.value = boost;
    renderer.setRenderTarget(rtB[i]);
    renderer.render(quadScene, quadCam);
    src = rtB[i];
  }
  // up: additive Kawase
  for (let i = n - 2; i >= 0; i--) {
    const m = upMats[i];
    const s = (i === n - 2) ? rtB[n - 1] : rtU[i + 1];
    m.uniforms.uTex.value = s.texture;
    m.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
    m.uniforms.uAdd.value = rtB[i].texture;
    m.uniforms.uResolution.value.set(rtU[i].width, rtU[i].height);
    renderer.setRenderTarget(rtU[i]);
    renderer.render(quadScene, quadCam);
  }
  finalMat.uniforms.uBloomTex.value = rtU[0].texture;
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  if (contextLost) return;
  frameCount++;

  const dt = Math.min(0.1, (now - lastNow) / 1000 || 0.016);
  lastNow = now;
  if (!state.paused) t += dt;

  // camera
  if (state.cinematic && !state.paused) {
    cineCam.update(camera, t);
    controls.enabled = false;
  } else if (flight.active) {
    flight.update(camera, controls, dt);
    controls.enabled = false;
  } else {
    controls.enabled = true;
    controls.update();
  }

  // uniforms
  camera.updateMatrixWorld(true);
  const m = camera.matrixWorld.elements;
  const r = new THREE.Vector3(m[0], m[1], m[2]).normalize();
  const u = new THREE.Vector3(m[4], m[5], m[6]).normalize();
  const f = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
  const basis = new THREE.Matrix3().set(r.x, u.x, f.x, r.y, u.y, f.y, r.z, u.z, f.z);
  rayMat.uniforms.uCamPos.value.copy(camera.position);
  rayMat.uniforms.uCamBasis.value.copy(basis);
  rayMat.uniforms.uTime.value = t;
  rayMat.uniforms.uFov.value = THREE.MathUtils.degToRad(state.params.fov);
  finalMat.uniforms.uTime.value = t;
  if (logCam && frameCount % 60 === 0) {
    console.log('[cam] pos=' + camera.position.toArray().map((v) => v.toFixed(3)).join(',')
      + ' fwd=' + f.toArray().map((v) => v.toFixed(3)).join(',')
      + ' fov=' + state.params.fov.toFixed(1)
      + ' aspect=' + camera.aspect.toFixed(3));
  }

  // pass 0: raytracer -> HDR colour
  renderer.setRenderTarget(rtColor);
  rayMat.uniforms.uResolution.value.set(rtColor.width, rtColor.height);
  rayMat.uniforms.uPass.value = 0;
  quadMesh.material = rayMat;
  renderer.render(quadScene, quadCam);

  // pass 0b: aux (only while a debug view needs it)
  if (state.debug > 0) {
    renderer.setRenderTarget(rtAux);
    rayMat.uniforms.uResolution.value.set(rtAux.width, rtAux.height);
    rayMat.uniforms.uPass.value = 1;
    renderer.render(quadScene, quadCam);
    finalMat.uniforms.uAuxTex.value = rtAux.texture;
  }
  finalMat.uniforms.uColorTex.value = rtColor.texture;

  // bloom chain
  renderBloom();

  // final pass -> canvas
  renderer.setRenderTarget(null);
  quadMesh.material = finalMat;
  renderer.render(quadScene, quadCam);

  // HUD stats
  frames++;
  fpsAcc += dt;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const fps = Math.round(frames / Math.max(fpsAcc, 1e-4));
    const ms = (fpsAcc / frames) * 1000;
    frames = 0; fpsAcc = 0; fpsTime = 0;
    const elFps = document.getElementById('stat-fps');
    if (elFps) elFps.textContent = fps + ' fps';
    const elMs = document.getElementById('stat-ms');
    if (elMs) elMs.textContent = ms.toFixed(1) + ' ms';
    const elRes = document.getElementById('stat-res');
    if (elRes) elRes.textContent = W + '×' + H + (renderScaleOverride ? ' (scaled)' : '');
  }

  // pending URL-automation shot
  if (shotPending) {
    const fn = shotPending;
    shotPending = null;
    fn();
  }
  if (!shotReady && initDone && t > 0.5) {
    shotReady = true;
    onReady();
  }
}

function onReady() {
  updateHUD(api);
  const url = parseURL();
  if (url.series) {
    // URL automation: capture a full series of debug views / presets / qualities
    runShotSeries(url).then(() => {
      showToast('Shot series complete');
      if (url.close) setTimeout(() => window.close(), 400);
    }).catch((e) => showToast('Series failed: ' + e.message));
  } else if (url.shot) {
    setTimeout(() => {
      doShot().then(() => {
        if (!url.shotUrl) showToast('Screenshot saved');
        if (url.close) setTimeout(() => window.close(), 400);
      }).catch((e) => showToast('Shot failed: ' + e.message));
    }, 600);
  }
  if (url.logUrl) {
    setTimeout(() => {
      try {
        fetch(url.logUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ errors: logErrors, warnings: logWarnings, url: location.href }),
        }).catch(() => {});
      } catch (_) {}
    }, 2500);
  }
}

function waitFrames(n) {
  return new Promise((resolve) => {
    let k = 0;
    const step = () => { if (++k >= n) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

async function runShotSeries(url) {
  const p = parseURL();
  console.log('[series] start, shotUrl=' + p.shotUrl);
  const items = [];
  for (const d of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) items.push({ name: 'dbg' + d, debug: d });
  for (const pr of PRESETS) items.push({ name: 'preset_' + pr.id, preset: pr.id });
  for (const q of QUALITY_KEYS) items.push({ name: 'quality_' + q, quality: q });
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    try {
      if (item.debug !== undefined) api.setDebug(item.debug);
      else api.setDebug(0); // reset debug for preset/quality items
      if (item.preset) api.snapPreset(item.preset);
      if (item.quality) api.setQuality(item.quality);
      await waitFrames(5);
      if (p.shotUrl) {
        const dataUrl = canvas.toDataURL('image/png');
        const resp = await fetch(p.shotUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ png: dataUrl, name: item.name, quality: qualityKey, url: location.href }),
        });
        const txt = await resp.text();
        console.log('[series] ' + idx + '/' + items.length + ' ' + item.name + ' -> ' + resp.status + ' ' + txt.slice(0, 80));
      }
    } catch (err) {
      console.error('[series] item ' + item.name + ' FAILED: ' + (err && err.message));
    }
  }
  console.log('[series] done');
  api.setDebug(0);
  api.setPreset('classic');
}

// ---------------------------------------------------------------------------
// Screenshot / URL automation
// ---------------------------------------------------------------------------
async function doShot() {
  const url = canvas.toDataURL('image/png');
  const p = parseURL();
  if (p.shotUrl) {
    await fetch(p.shotUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ png: url, url: location.href, params: state.params, quality: qualityKey }),
    });
  } else {
    downloadPNG(url, 'gargantua_' + qualityKey + '_' + Date.now() + '.png');
  }
  return url;
}

function downloadPNG(dataUrl, name) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------------------
// Public API (also used by the UI)
// ---------------------------------------------------------------------------
const api = {
  get: (id) => state.params[id],
  set: (id, v) => { state.set(id, v); applyParam(id); },
  setMany: (obj) => { state.setMany(obj); syncUniforms(); },
  getQuality: () => qualityKey,
  setQuality(k) {
    if (!QUALITY_KEYS.includes(k)) return;
    qualityKey = k;
    quality = QUALITY[k];
    state.setQuality(k);
    syncUniforms();
    resize();
    updateHUD(api);
    showToast('Quality: ' + quality.label);
  },
  cycleQuality() {
    const i = (QUALITY_KEYS.indexOf(qualityKey) + 1) % QUALITY_KEYS.length;
    api.setQuality(QUALITY_KEYS[i]);
  },
  getPreset: () => state.preset,
  setPreset(id) {
    const pr = PRESETS.find((x) => x.id === id);
    if (!pr) return;
    state.preset = id;
    state.setCinematic(false);
    flight.start(camera, new THREE.Vector3(...pr.pos), new THREE.Vector3(...pr.target));
    updateHUD(api);
    showToast('Preset: ' + pr.name);
  },
  snapPreset(id) {
    // instant pose (used by the URL shot-series automation)
    const pr = PRESETS.find((x) => x.id === id);
    if (!pr) return;
    state.preset = id;
    state.setCinematic(false);
    flight.active = false;
    camera.position.set(...pr.pos);
    camera.lookAt(...pr.target);
    camera.updateMatrixWorld(true);
    updateHUD(api);
  },
  getDebug: () => state.debug,
  setDebug(n) { state.setDebug(n); finalMat.uniforms.uDebug.value = state.debug; updateHUD(api); },
  getFlag: (id) => (id === 'cinematic' ? state.cinematic : id === 'music' ? state.music : id === 'hud' ? state.hud : id === 'paused' ? state.paused : false),
  setFlag(id, b) {
    if (id === 'cinematic') state.setCinematic(b);
    else if (id === 'music') { state.setMusic(b); if (b) audio.start(); else audio.stop(); }
    else if (id === 'hud') { state.setHud(b); document.getElementById('hud').style.opacity = b ? '1' : '0'; }
    else if (id === 'paused') state.paused = b;
    updateHUD(api);
  },
  toggleCinematic() { api.setFlag('cinematic', !state.cinematic); showToast(state.cinematic ? 'Cinematic loop ON' : 'Cinematic loop OFF'); },
  toggleMusic() { api.setFlag('music', !state.music); showToast(state.music ? 'Music ON' : 'Music OFF'); },
  toggleHud() { api.setFlag('hud', !state.hud); },
  togglePause() { api.setFlag('paused', !state.paused); showToast(state.paused ? 'Paused' : 'Resumed'); },
  screenshot: () => doShot().then(() => showToast('Screenshot saved')),
  resetParams() {
    state.reset();
    syncUniforms();
    updateHUD(api);
    showToast('All parameters reset');
  },
  _refreshFns: [],
};

function applyParam(id) {
  const p = PARAM_MAP[id];
  if (!p) return;
  const v = state.params[id];
  if (p.target === 'final') {
    if (finalMat && finalMat.uniforms[p.uniform]) finalMat.uniforms[p.uniform].value = v;
  } else if (p.target === 'bloom') {
    if (downMats[0]) downMats[0].uniforms.uThreshold.value = v;
  } else {
    if (rayMat) rayMat.uniforms[p.uniform].value = v;
    if (id === 'stepScale') rayMat.uniforms.uStepScale.value = v * quality.stepMul;
    if (id === 'fov') rayMat.uniforms.uFov.value = THREE.MathUtils.degToRad(v);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  const url = parseURL();

  if (url.reset) {
    try { localStorage.removeItem('gargantua.v1'); } catch (_) {}
    state.params = { ...DEFAULTS };
  } else {
    state.load();
  }
  if (url.quality) state.setQuality(url.quality);
  qualityKey = state.quality;
  quality = QUALITY[qualityKey];
  if (url.scale !== null) renderScaleOverride = url.scale;
  if (url.logcam) logCam = true;
  if (url.cinematic !== null) state.setCinematic(url.cinematic);
  if (url.music !== null) state.setMusic(url.music);
  if (url.debug !== null) state.setDebug(url.debug);
  if (url.preset) {
    const pr = PRESETS.find((x) => x.id === url.preset);
    if (pr) state.preset = pr.id;
  }
  state.setMany(url.overrides);

  // wire param listeners -> live uniform updates
  state.onParam((id) => applyParam(id));

  try {
    initGL();
  } catch (err) {
    fatal(err);
    return;
  }

  // apply URL preset pose immediately (no flight)
  const pr = PRESETS.find((x) => x.id === state.preset) || PRESETS[0];
  camera.position.set(...pr.pos);
  camera.lookAt(0, 0, 0);

  buildHUD(api);
  buildPanel(api);
  bindShortcuts(api);
  updateHUD(api);

  state.onParam(() => updateHUD(api));

  if (state.music) audio.start();

  // mobile defaults
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const small = window.innerWidth < 720;
  if (!url.quality && (coarse || small)) {
    api.setQuality('standard');
  }

  window.addEventListener('resize', () => resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { lastNow = performance.now(); }
  });

  // expose automation API
  window.GARGANTUA = {
    capture: doShot,
    setParam: api.set,
    getParams: () => ({ ...state.params }),
    setQuality: api.setQuality,
    setDebug: api.setDebug,
    setPreset: api.setPreset,
    setCinematic: (b) => api.setFlag('cinematic', !!b),
    reset: api.resetParams,
    state,
  };

  lastNow = performance.now();
  requestAnimationFrame(frame);

  showToast('GARGANTUA online — press ? for help');
  console.log('GARGANTUA ready | quality=' + qualityKey + ' | res=' + W + 'x' + H);
}

boot();
