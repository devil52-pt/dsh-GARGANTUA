// GARGANTUA — UI: control panel, HUD, keyboard shortcuts, help overlay, toast.

import { PARAMS, GROUPS, QUALITY, QUALITY_KEYS, PRESETS, DEBUG_VIEWS } from './config.js';

let panelOpen = true;

export function showToast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

export function setOverlay(html, show) {
  const o = document.getElementById('overlay');
  if (!o) return;
  if (show) {
    o.innerHTML = html;
    o.classList.remove('hidden');
  } else {
    o.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Control panel
// ---------------------------------------------------------------------------
export function buildPanel(api) {
  const panel = document.getElementById('panel');
  panel.innerHTML = '';

  // header
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML =
    '<div class="panel-title">CONTROL DECK</div>' +
    '<button id="panel-collapse" class="icon-btn" title="Toggle panel">▸</button>';
  panel.appendChild(head);

  // engine row: quality + presets + toggles + actions
  const engine = document.createElement('div');
  engine.className = 'engine';

  const qRow = el('div', 'btn-row');
  qRow.appendChild(el('div', 'btn-label', 'Quality'));
  const qWrap = el('div', 'seg');
  for (const k of QUALITY_KEYS) {
    const b = document.createElement('button');
    b.className = 'seg-btn';
    b.dataset.q = k;
    b.textContent = QUALITY[k].label;
    b.addEventListener('click', () => api.setQuality(k));
    qWrap.appendChild(b);
  }
  qRow.appendChild(qWrap);
  engine.appendChild(qRow);

  const pRow = el('div', 'btn-row');
  pRow.appendChild(el('div', 'btn-label', 'Preset'));
  const pWrap = el('div', 'seg');
  for (const pr of PRESETS) {
    const b = document.createElement('button');
    b.className = 'seg-btn';
    b.dataset.preset = pr.id;
    b.textContent = pr.name;
    b.addEventListener('click', () => api.setPreset(pr.id));
    pWrap.appendChild(b);
  }
  pRow.appendChild(pWrap);
  engine.appendChild(pRow);

  const tRow = el('div', 'toggle-row');
  tRow.appendChild(makeToggle('cinematic', 'Cinematic loop', api));
  tRow.appendChild(makeToggle('music', 'Music', api));
  tRow.appendChild(makeToggle('hud', 'HUD', api));
  engine.appendChild(tRow);

  const aRow = el('div', 'action-row');
  aRow.appendChild(makeAction('Screenshot', 'screenshot', api));
  aRow.appendChild(makeAction('Reset', 'reset', api));
  engine.appendChild(aRow);

  panel.appendChild(engine);

  // parameter sections
  for (const g of GROUPS) {
    const sec = document.createElement('div');
    sec.className = 'psec';
    sec.appendChild(el('div', 'psec-title', g.toUpperCase()));
    for (const p of PARAMS) {
      if (p.group !== g) continue;
      sec.appendChild(makeSlider(p, api));
    }
    panel.appendChild(sec);
  }

  // footer
  const foot = el('div', 'panel-foot', 'GARGANTUA v1.0 · Schwarzschild null-geodesic raytracer · ? for help');
  panel.appendChild(foot);

  // collapse button
  document.getElementById('panel-collapse').addEventListener('click', () => {
    panelOpen = !panelOpen;
    panel.classList.toggle('closed', !panelOpen);
    document.getElementById('panel-collapse').textContent = panelOpen ? '▸' : '◂';
  });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function makeToggle(id, label, api) {
  const w = el('label', 'tgl');
  w.innerHTML =
    `<span class="tgl-label">${label}</span>` +
    `<span class="tgl-box"><input type="checkbox" id="tgl-${id}"><span class="tgl-slider"></span></span>`;
  w.querySelector('input').addEventListener('change', (e) => {
    api.setFlag(id, e.target.checked);
  });
  return w;
}

function makeAction(label, action, api) {
  const b = document.createElement('button');
  b.className = 'act-btn';
  b.textContent = label;
  b.addEventListener('click', () => api[action]());
  return b;
}

function makeSlider(p, api) {
  const row = document.createElement('div');
  row.className = 'prow';
  row.dataset.param = p.id;

  const lab = el('div', 'plabel');
  lab.appendChild(el('span', 'pname', p.label));
  const val = el('span', 'pval', '');
  lab.appendChild(val);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = p.min;
  input.max = p.max;
  input.step = p.step;
  input.value = api.get(p.id);

  row.appendChild(lab);
  row.appendChild(input);

  const refresh = () => {
    const v = api.get(p.id);
    input.value = v;
    val.textContent = (p.display ? p.display(v) : v) + p.unit;
  };
  input.addEventListener('input', () => api.set(p.id, parseFloat(input.value)));
  input.addEventListener('dblclick', () => api.set(p.id, p.def));
  lab.title = `Double-click to reset (default ${p.def})`;

  api._refreshFns.push(refresh);
  refresh();
  return row;
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
export function buildHUD(api) {
  const tl = document.getElementById('hud-tl');
  tl.innerHTML =
    '<div class="hud-title">GARGANTUA</div>' +
    '<div class="hud-sub">Schwarzschild · real-time geodesic raytracer</div>' +
    '<div class="hud-stats"><span id="stat-fps">-- fps</span><span id="stat-res">--</span><span id="stat-ms">-- ms</span></div>';

  const tr = document.getElementById('hud-tr');
  tr.innerHTML =
    '<span class="badge" id="badge-quality">—</span>' +
    '<span class="badge" id="badge-debug" hidden>DBG 0</span>' +
    '<span class="badge amber" id="badge-cine" hidden>◉ CINEMATIC</span>' +
    '<span class="badge green" id="badge-music" hidden>♪ MUSIC</span>' +
    '<span class="badge red" id="badge-pause" hidden>❚❚ PAUSED</span>';

  const bl = document.getElementById('hud-bl');
  bl.innerHTML =
    '<div class="hint">drag <b>orbit</b> · wheel <b>zoom</b> · right-drag <b>pan</b> · <b>F1–F4</b> presets</div>' +
    '<div class="hint">0–9 <b>debug</b> · space <b>cinematic</b> · M <b>music</b> · P <b>pause</b> · H <b>HUD</b> · S <b>shot</b> · Q <b>quality</b> · R <b>reset</b> · ? <b>help</b></div>';

  const br = document.getElementById('hud-br');
  br.innerHTML = '<div class="hint dim">v1.0 · 21 params · real physics</div>';
}

export function updateHUD(api) {
  const q = api.getQuality();
  const bq = document.getElementById('badge-quality');
  if (bq) bq.textContent = QUALITY[q].label;

  const bd = document.getElementById('badge-debug');
  if (bd) {
    const n = api.getDebug();
    bd.hidden = n === 0;
    const v = DEBUG_VIEWS.find((d) => d.n === n);
    bd.textContent = 'DBG ' + n + (v ? ' ' + v.name : '');
  }
  const bc = document.getElementById('badge-cine');
  if (bc) bc.hidden = !api.getFlag('cinematic');
  const bm = document.getElementById('badge-music');
  if (bm) bm.hidden = !api.getFlag('music');
  const bp = document.getElementById('badge-pause');
  if (bp) bp.hidden = !api.getFlag('paused');

  // sync toggles
  for (const id of ['cinematic', 'music', 'hud']) {
    const c = document.getElementById('tgl-' + id);
    if (c && c.checked !== api.getFlag(id)) c.checked = api.getFlag(id);
  }
  // sync quality/preset buttons
  document.querySelectorAll('.seg-btn[data-q]').forEach((b) => {
    b.classList.toggle('on', b.dataset.q === api.getQuality());
  });
  document.querySelectorAll('.seg-btn[data-preset]').forEach((b) => {
    b.classList.toggle('on', b.dataset.preset === api.getPreset());
  });
}

// ---------------------------------------------------------------------------
// Help overlay
// ---------------------------------------------------------------------------
export function showHelp(show) {
  const o = document.getElementById('overlay');
  if (!show) { o.classList.add('hidden'); return; }
  o.classList.remove('hidden');
  o.innerHTML =
    '<div class="overlay-card">' +
    '<h2>GARGANTUA — controls &amp; notes</h2>' +
    '<table>' +
    '<tr><td>Drag</td><td>Orbit camera</td></tr>' +
    '<tr><td>Wheel / pinch</td><td>Zoom</td></tr>' +
    '<tr><td>Right-drag</td><td>Pan</td></tr>' +
    '<tr><td>0 – 9</td><td>Debug views (0 = final image)</td></tr>' +
    '<tr><td>Space</td><td>Toggle cinematic camera loop</td></tr>' +
    '<tr><td>F1 – F4</td><td>View presets: Classic / Overhead / Edge-on / Close-up</td></tr>' +
    '<tr><td>M</td><td>Toggle ambient music (procedural WebAudio)</td></tr>' +
    '<tr><td>H</td><td>Toggle HUD</td></tr>' +
    '<tr><td>P</td><td>Pause / resume rendering</td></tr>' +
    '<tr><td>Q</td><td>Cycle quality (Standard / High / Cinematic)</td></tr>' +
    '<tr><td>S</td><td>Save PNG screenshot</td></tr>' +
    '<tr><td>R</td><td>Reset all parameters</td></tr>' +
    '<tr><td>`</td><td>Toggle control panel</td></tr>' +
    '<tr><td>Esc / ?</td><td>Close / open this help</td></tr>' +
    '</table>' +
    '<p class="dim">Physics: exact Schwarzschild null geodesics (2M = 1). ' +
    'Event horizon r=1, photon sphere r=1.5, ISCO r=3. Keplerian disk, ' +
    'relativistic Doppler beaming, gravitational redshift, lensing, ' +
    'multi-crossing accretion disk, procedural starfield &amp; galaxy.</p>' +
    '<p class="dim">URL automation: <code>?quality=c&amp;preset=overhead&amp;diskTemp=14000&amp;shot=1' +
    '&amp;shot_url=http://host:port/shot</code></p>' +
    '<button class="act-btn" id="help-close">Close</button>' +
    '</div>';
  document.getElementById('help-close').addEventListener('click', () => showHelp(false));
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------
export function bindShortcuts(api) {
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    // 0..9 debug
    if (e.key >= '0' && e.key <= '9') {
      api.setDebug(parseInt(e.key, 10));
      showToast('Debug view ' + e.key + ' — ' + (DEBUG_VIEWS[e.key] ? DEBUG_VIEWS[e.key].name : ''));
      return;
    }
    switch (e.key) {
      case ' ': e.preventDefault(); api.toggleCinematic(); break;
      case 'm': case 'M': api.toggleMusic(); break;
      case 'h': case 'H': api.toggleHud(); break;
      case 'p': case 'P': api.togglePause(); break;
      case 'q': case 'Q': api.cycleQuality(); break;
      case 's': case 'S': api.screenshot(); break;
      case 'r': case 'R': api.resetParams(); break;
      case '`': case '~':
        panelOpen = !panelOpen;
        document.getElementById('panel').classList.toggle('closed', !panelOpen);
        document.getElementById('panel-collapse').textContent = panelOpen ? '▸' : '◂';
        break;
      case 'Escape':
        if (document.getElementById('overlay').classList.contains('hidden') === false) showHelp(false);
        else if (panelOpen) {
          panelOpen = false;
          document.getElementById('panel').classList.add('closed');
          document.getElementById('panel-collapse').textContent = '◂';
        }
        break;
      case '?': e.preventDefault(); showHelp(true); break;
      case 'F1': e.preventDefault(); api.setPreset('classic'); break;
      case 'F2': e.preventDefault(); api.setPreset('overhead'); break;
      case 'F3': e.preventDefault(); api.setPreset('edge'); break;
      case 'F4': e.preventDefault(); api.setPreset('close'); break;
    }
  });
}
