// GARGANTUA — parameter registry, quality presets, view presets.

// 21 user-tunable parameters.
// target: 'ray'   -> uniform on the raytracer material
//         'final' -> uniform on the final composite material
//         'bloom' -> uniform on the first bloom down-pass material
export const PARAMS = [
  // ---- Camera (1)
  { id: 'fov',          label: 'Field of view',     group: 'Camera',  min: 30,   max: 100, step: 1, def: 60,    unit: '°',  target: 'ray',   uniform: 'uFov',          display: (v) => v.toFixed(0) },
  // ---- Integration (1)
  { id: 'stepScale',    label: 'Ray step size',     group: 'Physics', min: 0.005, max: 0.08, step: 0.001, def: 0.02, unit: '', target: 'ray', uniform: 'uStepScale', display: (v) => v.toFixed(3) },
  // ---- Accretion disk (10)
  { id: 'diskInner',    label: 'Disk inner radius', group: 'Disk',    min: 2.5,  max: 8,    step: 0.1, def: 3.2,  unit: ' M', target: 'ray', uniform: 'uDiskInner', display: (v) => v.toFixed(1) },
  { id: 'diskOuter',    label: 'Disk outer radius', group: 'Disk',    min: 8,    max: 60,   step: 1,   def: 22,   unit: ' M', target: 'ray', uniform: 'uDiskOuter', display: (v) => v.toFixed(0) },
  { id: 'diskTemp',     label: 'Disk temperature',  group: 'Disk',    min: 3000, max: 20000, step: 100, def: 9000, unit: ' K', target: 'ray', uniform: 'uDiskTemp',  display: (v) => v.toFixed(0) },
  { id: 'tempExp',      label: 'Temp falloff',      group: 'Disk',    min: 0.25, max: 1.5,  step: 0.01, def: 0.75, unit: '', target: 'ray', uniform: 'uTempExp',    display: (v) => v.toFixed(2) },
  { id: 'turbulence',   label: 'Disk turbulence',   group: 'Disk',    min: 0,    max: 0.6,  step: 0.01, def: 0.3,  unit: '', target: 'ray', uniform: 'uTurb',       display: (v) => v.toFixed(2) },
  { id: 'turbSpeed',    label: 'Turbulence speed',  group: 'Disk',    min: 0,    max: 1,    step: 0.01, def: 0.5,  unit: '', target: 'ray', uniform: 'uTurbSpeed',  display: (v) => v.toFixed(2) },
  { id: 'doppler',      label: 'Doppler beaming',   group: 'Disk',    min: 0,    max: 1,    step: 0.01, def: 1,    unit: '', target: 'ray', uniform: 'uDoppler',    display: (v) => v.toFixed(2) },
  { id: 'redshift',     label: 'Grav. redshift',    group: 'Disk',    min: 0,    max: 1,    step: 0.01, def: 1,    unit: '', target: 'ray', uniform: 'uRedshift',   display: (v) => v.toFixed(2) },
  { id: 'emission',     label: 'Disk emission',     group: 'Disk',    min: 0.1,  max: 5,    step: 0.05, def: 1.1,  unit: '', target: 'ray', uniform: 'uEmission',   display: (v) => v.toFixed(2) },
  { id: 'diskOpacity',  label: 'Disk opacity',      group: 'Disk',    min: 0.5,  max: 1,    step: 0.01, def: 0.94, unit: '', target: 'ray', uniform: 'uDiskOpacity', display: (v) => v.toFixed(2) },
  // ---- Sky (3)
  { id: 'starDensity',  label: 'Star density',      group: 'Sky',     min: 0,    max: 2,    step: 0.01, def: 0.8,  unit: '', target: 'ray', uniform: 'uStarDensity', display: (v) => v.toFixed(2) },
  { id: 'galaxy',       label: 'Galaxy intensity',  group: 'Sky',     min: 0,    max: 2,    step: 0.01, def: 1.0,  unit: '', target: 'ray', uniform: 'uGalaxy',      display: (v) => v.toFixed(2) },
  { id: 'galaxyTwist',  label: 'Galaxy arm twist',  group: 'Sky',     min: 0,    max: 3,    step: 0.01, def: 1.2,  unit: '', target: 'ray', uniform: 'uGalaxyTwist', display: (v) => v.toFixed(2) },
  // ---- Post (6)
  { id: 'exposure',     label: 'Exposure',          group: 'Post',    min: 0.1,  max: 4,    step: 0.05, def: 1.0,  unit: '', target: 'final', uniform: 'uExposure',       display: (v) => v.toFixed(2) },
  { id: 'bloom',        label: 'Bloom intensity',   group: 'Post',    min: 0,    max: 3,    step: 0.05, def: 0.6,  unit: '', target: 'final', uniform: 'uBloomIntensity', display: (v) => v.toFixed(2) },
  { id: 'bloomThresh',  label: 'Bloom threshold',   group: 'Post',    min: 0,    max: 2,    step: 0.05, def: 1.0,  unit: '', target: 'bloom', uniform: 'uThreshold',     display: (v) => v.toFixed(2) },
  { id: 'vignette',     label: 'Vignette',          group: 'Post',    min: 0,    max: 1,    step: 0.01, def: 0.45, unit: '', target: 'final', uniform: 'uVignette',       display: (v) => v.toFixed(2) },
  { id: 'grain',        label: 'Film grain',        group: 'Post',    min: 0,    max: 1,    step: 0.01, def: 0.12, unit: '', target: 'final', uniform: 'uGrain',          display: (v) => v.toFixed(2) },
  { id: 'chromatic',    label: 'Chromatic ab.',     group: 'Post',    min: 0,    max: 1,    step: 0.01, def: 0.25, unit: '', target: 'final', uniform: 'uChromatic',      display: (v) => v.toFixed(2) },
];

export const PARAM_MAP = Object.fromEntries(PARAMS.map((p) => [p.id, p]));
export const GROUPS = ['Camera', 'Physics', 'Disk', 'Sky', 'Post'];

// Engine quality presets (not part of the 21 user parameters).
export const QUALITY = {
  standard:  { label: 'Standard',  steps: 500,  stepMul: 1.2,  scale: 0.5,  bloomOctaves: 3, maxSteps: 500,  mobile: true },
  high:      { label: 'High',      steps: 1000, stepMul: 1.0,  scale: 0.75, bloomOctaves: 4, maxSteps: 1000, mobile: false },
  cinematic: { label: 'Cinematic', steps: 1600, stepMul: 0.8,  scale: 1.0,  bloomOctaves: 5, maxSteps: 1600, mobile: false },
};
export const QUALITY_KEYS = ['standard', 'high', 'cinematic'];

// Four camera view presets (positions in units of 2M; shadow ~ b_crit=2.6).
export const PRESETS = [
  { id: 'classic',  name: 'Classic',   pos: [0, 3.2, 11.5],  target: [0, 0, 0] },
  { id: 'overhead', name: 'Overhead',  pos: [0.01, 22, 0.01], target: [0, 0, 0] },
  { id: 'edge',     name: 'Edge-on',   pos: [0, 1.4, 14],    target: [0, 0, 0] },
  { id: 'close',    name: 'Close-up',  pos: [4.6, 1.9, 6.4], target: [0, 0, 0] },
];

// Debug views for keys 0-9.
export const DEBUG_VIEWS = [
  { n: 0, name: 'Final image' },
  { n: 1, name: 'Integration steps' },
  { n: 2, name: 'Hit type' },
  { n: 3, name: 'Disk crossings' },
  { n: 4, name: 'Doppler shift' },
  { n: 5, name: 'Radius at hit' },
  { n: 6, name: 'Closest approach' },
  { n: 7, name: 'Raw HDR (no post)' },
  { n: 8, name: 'Bloom only' },
  { n: 9, name: 'Test card' },
];

export const DEFAULTS = Object.fromEntries(PARAMS.map((p) => [p.id, p.def]));
