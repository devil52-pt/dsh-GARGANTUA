// GARGANTUA — application state, persistence (localStorage) and URL automation.

import { PARAMS, PARAM_MAP, DEFAULTS, QUALITY_KEYS } from './config.js';

const LS_KEY = 'gargantua.v1';

export class State {
  constructor() {
    this.params = { ...DEFAULTS };
    this.quality = 'high';
    this.preset = 'classic';
    this.cinematic = false;
    this.music = false;
    this.hud = true;
    this.debug = 0;
    this.paused = false;
    this.time = 0;
    this.listeners = []; // fn(id, value)
    this.saveTimer = null;
  }

  onParam(fn) { this.listeners.push(fn); }

  set(id, value) {
    const p = PARAM_MAP[id];
    if (!p) return;
    this.params[id] = Math.min(p.max, Math.max(p.min, Number(value)));
    for (const fn of this.listeners) fn(id, this.params[id]);
    this.scheduleSave();
  }

  setMany(obj) {
    for (const k in obj) if (PARAM_MAP[k]) this.set(k, obj[k]);
  }

  setQuality(q) {
    if (QUALITY_KEYS.includes(q)) { this.quality = q; this.scheduleSave(); }
  }
  setCinematic(b) { this.cinematic = !!b; this.scheduleSave(); }
  setMusic(b) { this.music = !!b; this.scheduleSave(); }
  setHud(b) { this.hud = !!b; this.scheduleSave(); }
  setDebug(n) { this.debug = Math.max(0, Math.min(9, n | 0)); }

  reset() {
    this.params = { ...DEFAULTS };
    for (const fn of this.listeners) for (const id in this.params) fn(id, this.params[id]);
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  save() {
    try {
      const data = {
        params: this.params, quality: this.quality, preset: this.preset,
        cinematic: this.cinematic, music: this.music, hud: this.hud,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable — ignore */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.params) this.setMany(data.params);
      if (QUALITY_KEYS.includes(data.quality)) this.quality = data.quality;
      if (data.preset) this.preset = data.preset;
      if (typeof data.cinematic === 'boolean') this.cinematic = data.cinematic;
      if (typeof data.music === 'boolean') this.music = data.music;
      if (typeof data.hud === 'boolean') this.hud = data.hud;
      return true;
    } catch (e) { return false; }
  }

  clearStorage() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
  }
}

// Parse URL automation parameters (?key=value...).
// Returns { shot, shotUrl, logUrl, scale, overrides }
export function parseURL() {
  const q = new URLSearchParams(window.location.search);
  const out = {
    shot: q.has('shot') ? (q.get('shot') || '1') : null,
    series: q.has('series') && q.get('series') === '1',
    shotUrl: q.get('shot_url') || null,
    logUrl: q.get('log_url') || null,
    scale: q.has('scale') ? clampNum(parseFloat(q.get('scale')), 0.25, 2, 1) : null,
    logcam: q.has('logcam') && q.get('logcam') === '1',
    quality: QUALITY_KEYS.includes(q.get('quality')) ? q.get('quality') : null,
    debug: q.has('debug') ? clampNum(parseInt(q.get('debug'), 10), 0, 9, 0) : null,
    preset: q.get('preset') || null,
    cinematic: q.has('cinematic') ? q.get('cinematic') === '1' : null,
    music: q.has('music') ? q.get('music') === '1' : null,
    close: q.has('close') && q.get('close') === '1',
    reset: q.has('reset') && q.get('reset') === '1',
    overrides: {},
  };
  for (const [k, v] of q.entries()) {
    if (PARAM_MAP[k]) out.overrides[k] = clampNum(parseFloat(v), PARAM_MAP[k].min, PARAM_MAP[k].max, PARAM_MAP[k].def);
  }
  return out;
}

function clampNum(v, lo, hi, def) {
  if (Number.isNaN(v)) return def;
  return Math.min(hi, Math.max(lo, v));
}
