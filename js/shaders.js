// GARGANTUA — GLSL shader sources (WebGL2 / GLSL ES 3.0, RawShaderMaterial).
// All passes render a fullscreen quad whose vertex shader writes NDC directly.

export const RAYVERT = `precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Pass 0 — real-time Schwarzschild null-geodesic raytracer (fullscreen).
// Units: 2M = 1  (Schwarzschild radius = 1, photon sphere r = 1.5, ISCO r = 3).
// Geodesic ODE (exact for null rays in Schwarzschild, affine parameter):
//   x'' = -(3/2) * |x x v|^2 / r^5 * x
// uPass=0 -> outColor.rgb = HDR radiance, a = minR/maxDist
// uPass=1 -> outColor    = debug aux: (steps, crossings, doppler, rHit)
// ---------------------------------------------------------------------------
export const RAYFRAG = `precision highp float;
precision highp int;

uniform vec2  uResolution;
uniform float uTime;
uniform vec3  uCamPos;
uniform mat3  uCamBasis;      // columns: right, up, forward (world axes)
uniform float uFov;           // vertical fov, radians
uniform float uAspect;
uniform float uMaxDist;
uniform float uMaxSteps;
uniform float uStepScale;     // integration step factor
uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uDiskTemp;      // peak temperature (K, display units)
uniform float uTempExp;       // T ~ r^-exp
uniform float uTurb;          // disk turbulence amount
uniform float uTurbSpeed;
uniform float uDoppler;       // 0..1 strength of relativistic beaming
uniform float uRedshift;      // 0..1 strength of gravitational redshift
uniform float uEmission;      // disk HDR emission scale
uniform float uDiskOpacity;   // per-crossing transmission (self absorption)
uniform float uStarDensity;
uniform float uGalaxy;
uniform float uGalaxyTwist;
uniform float uPass;          // 0 = color, 1 = aux

layout(location = 0) out vec4 outColor;

#define MAX_STEPS 2048

// ---------------- hash / noise ----------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash33(i).x;
  float n100 = hash33(i + vec3(1.0, 0.0, 0.0)).x;
  float n010 = hash33(i + vec3(0.0, 1.0, 0.0)).x;
  float n110 = hash33(i + vec3(1.0, 1.0, 0.0)).x;
  float n001 = hash33(i + vec3(0.0, 0.0, 1.0)).x;
  float n101 = hash33(i + vec3(1.0, 0.0, 1.0)).x;
  float n011 = hash33(i + vec3(0.0, 1.0, 1.0)).x;
  float n111 = hash33(i + vec3(1.0, 1.0, 1.0)).x;
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
float fbm(vec3 p) {
  float a = 0.55;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.1 + vec3(17.13, 9.7, 4.3);
    a *= 0.5;
  }
  return s;
}

// ---------------- blackbody colour (Tanner Helland style fit) ----------------
vec3 blackbody(float T) {
  T = clamp(T, 1000.0, 40000.0);
  float t = T / 100.0;
  vec3 c;
  if (t <= 66.0) c.r = 1.0;
  else c.r = clamp(1.292936186062745 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  if (t <= 66.0) c.g = clamp(0.3900815787690196 * log(t) - 0.631841443788627, 0.0, 1.0);
  else c.g = clamp(1.129890860895294 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  if (t >= 66.0) c.b = 1.0;
  else if (t <= 19.0) c.b = 0.0;
  else c.b = clamp(0.543206789110196 * log(t - 10.0) - 1.196254089142991, 0.0, 1.0);
  return c;
}

// ---------------- accretion disk emission ----------------
// pc: crossing point, v: photon direction at crossing, rc: crossing radius,
// dopp: relativistic Doppler factor already computed by the caller.
vec3 diskEmit(vec3 pc, vec3 v, float rc, float dopp) {
  // Keplerian angular velocity (2M=1): omega = 1/sqrt(2 r^3)
  float ang = atan(pc.y, pc.x);
  float omega = inversesqrt(2.0 * rc * rc * rc);
  // co-rotating swirl coordinate -> differential rotation shears the pattern
  float phase = ang - uTime * omega * uTurbSpeed * 30.0;
  vec2 sw = rc * 0.45 * vec2(cos(phase), sin(phase));
  float n1 = fbm(vec3(sw, uTime * 0.08 + rc * 0.06));
  float n2 = fbm(vec3(sw * 3.1 + vec2(7.7, 3.1), uTime * 0.16 + rc * 0.22));
  float turb = n1 * 0.6 + n2 * 0.4;
  float Tloc = uDiskTemp * pow(uDiskInner / rc, uTempExp) * (1.0 + uTurb * (turb - 0.5) * 2.0);

  // gravitational redshift, observer at infinity (2M=1): g = sqrt(1 - 1/r)
  float gshift = sqrt(max(1.0 - 1.0 / rc, 0.0));
  float shift = mix(1.0, dopp, uDoppler) * mix(1.0, gshift, uRedshift);

  // observed temperature -> colour AND Stefan-Boltzmann luminosity shift
  float Tobs = Tloc * shift;
  vec3 col = blackbody(Tobs);
  float lum = pow(max(Tobs / 7000.0, 0.0), 4.0);
  return col * lum * uEmission;
}

// ---------------- procedural starfield + galaxy ----------------
vec3 starfield(vec3 dir, float minR) {
  vec3 col = vec3(0.0);

  float z = dir.z;
  float plane = exp(-abs(z) * 4.5);                       // galactic band
  vec2 xy = dir.xy;
  float rp = length(xy);
  float ang = atan(xy.y, xy.x);
  float arm = 0.5 + 0.5 * cos(3.0 * (ang - uGalaxyTwist * rp * 2.2) + 1.3);
  float bulge = exp(-rp * 7.0);
  float gal = (0.35 + 0.65 * arm) * plane * (0.25 + 0.75 * exp(-rp * 1.6)) + bulge * 1.4;

  // faint nebula glow
  float neb = fbm(dir * 4.0 + 11.0);
  vec3 nebCol = mix(vec3(0.62, 0.5, 0.92), vec3(0.92, 0.62, 0.5), fbm(dir * 3.0 + 5.0));
  col += nebCol * neb * 0.12 * (0.3 + 0.7 * plane) * uGalaxy;

  // stars: 3 octaves of direction-space cells
  float dens = min(uStarDensity * (0.16 + 0.84 * clamp(gal, 0.0, 1.0)), 1.0);
  for (int layer = 0; layer < 3; layer++) {
    float sc = mix(90.0, 420.0, float(layer) / 2.0);
    vec3 g = floor(dir * sc);
    vec3 f = fract(dir * sc);
    vec3 h = hash33(g + float(layer) * 137.0);
    float accept = dens * (0.5 + 0.5 * (1.0 - float(layer) / 3.0));
    if (h.x < accept) {
      vec3 sp = 0.5 + 0.6 * (hash33(g + float(layer) * 71.0) - 0.5);
      float d = length(f - sp);
      float mag = pow(h.z, 12.0);
      float s = exp(-d * d * (260.0 + 220.0 * float(layer))) * (0.08 + 3.2 * mag);
      vec3 tint = mix(vec3(1.0, 0.92, 0.8), vec3(0.72, 0.8, 1.0), hash33(g + float(layer) * 41.0).x);
      float tw = 0.85 + 0.15 * sin(uTime * (1.0 + h.y * 3.0) + h.z * 40.0);
      col += tint * s * tw * uStarDensity;
    }
  }

  // gravitational-lens magnification boost for rays grazing the photon sphere
  float x = minR - 1.5;
  float boost = 1.0 + 0.05 / (x * x + 0.02);
  return col * clamp(boost, 1.0, 3.5);
}

// ---------------- main ----------------
void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
  float f = 1.0 / tan(uFov * 0.5);
  vec3 rd = normalize(uCamBasis * vec3(uv.x * f, uv.y * f, 1.0));
  vec3 ro = uCamPos;

  vec3 p = ro;
  vec3 v = rd;
  vec3 pPrev = ro;

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float steps = 0.0;
  float crossings = 0.0;
  float doppler = 1.0;
  float rHit = uMaxDist;
  float minR = 1e4;
  int type = 0; // 0 sky, 1 disk, 2 horizon

  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= uMaxSteps) break;
    steps += 1.0;
    float r = length(p);
    minR = min(minR, r);

    if (r < 1.0) { type = 2; rHit = r; break; }            // captured
    if (r > uMaxDist) { type = 0; rHit = r; break; }        // escaped

    // accretion disk plane crossing (thin luminous disk at z = 0)
    if (pPrev.z * p.z < 0.0) {
      float fz = pPrev.z / (pPrev.z - p.z);
      vec3 pc = mix(pPrev, p, fz);
      float rc = length(pc);
      if (rc > uDiskInner && rc < uDiskOuter) {
        crossings += 1.0;
        // relativistic Doppler factor (Keplerian emitter, photon direction)
        vec3 radial = pc / rc;
        vec3 tang = normalize(cross(vec3(0.0, 0.0, 1.0), radial));
        float beta = 1.0 / sqrt(2.0 * rc);
        float gamma = inversesqrt(1.0 - beta * beta);
        float cosang = dot(normalize(v), tang);
        doppler = 1.0 / (gamma * (1.0 - beta * cosang));
        if (uPass < 0.5) {
          col += trans * diskEmit(pc, v, rc, doppler);
          trans *= uDiskOpacity;
        }
      }
    }
    pPrev = p;

    // integrate Schwarzschild null geodesic
    // adaptive step; refine near the photon sphere (r ~ 1.5) for accurate grazing orbits
    float h = max(uStepScale * 0.2, uStepScale * r);
    h *= 0.35 + 0.65 * smoothstep(1.4, 4.0, r);
    vec3 c = cross(p, v);
    float c2 = dot(c, c);
    vec3 acc = -1.5 * (c2 / (r * r * r * r * r)) * p;
    v += acc * h;
    p += v * h;
  }

  if (type == 0 && uPass < 0.5) {
    col += starfield(normalize(v), minR);
  }

  if (uPass < 0.5) {
    outColor = vec4(col, clamp(minR / uMaxDist, 0.0, 1.0));
  } else {
    outColor = vec4(steps / uMaxSteps,
                    crossings / 8.0,
                    clamp(doppler / 8.0, 0.0, 1.0),
                    clamp(rHit / uMaxDist, 0.0, 1.0));
  }
}
`;

// ---------------------------------------------------------------------------
// Bloom — Kawase dual-filter (down passes + additive up passes)
// ---------------------------------------------------------------------------
export const BL_DOWN_VERT = RAYVERT;
export const BL_DOWN_FRAG = `precision highp float;
uniform sampler2D uTex;
uniform vec2  uTexel;      // 1 / input size
uniform vec2  uResolution; // target size
uniform float uThreshold;
uniform float uBoost;
layout(location = 0) out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 o = uTexel;
  vec3 c = texture(uTex, uv + vec2(-o.x, -o.y)).rgb;
  c += texture(uTex, uv + vec2( o.x, -o.y)).rgb;
  c += texture(uTex, uv + vec2(-o.x,  o.y)).rgb;
  c += texture(uTex, uv + vec2( o.x,  o.y)).rgb;
  c *= 0.25;
  // luminance-based bright extraction keeps colour hue (no per-channel clipping)
  float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  c *= clamp((l - uThreshold) / l, 0.0, 1.0) * uBoost;
  outColor = vec4(c, 1.0);
}
`;

export const BL_UP_VERT = RAYVERT;
export const BL_UP_FRAG = `precision highp float;
uniform sampler2D uTex;   // smaller source (upsampling)
uniform sampler2D uAdd;   // same-level down result
uniform vec2  uTexel;     // 1 / source size
uniform vec2  uResolution;// target size
layout(location = 0) out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 o = uTexel * 2.0;
  vec3 c = texture(uTex, uv + vec2(-o.x, -o.y)).rgb;
  c += texture(uTex, uv + vec2( o.x, -o.y)).rgb;
  c += texture(uTex, uv + vec2(-o.x,  o.y)).rgb;
  c += texture(uTex, uv + vec2( o.x,  o.y)).rgb;
  c = c * 0.25 + texture(uAdd, uv).rgb;
  outColor = vec4(c, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Final pass — combine, chromatic aberration, ACES, vignette, grain, debug
// ---------------------------------------------------------------------------
export const FINAL_VERT = RAYVERT;
export const FINAL_FRAG = `precision highp float;
uniform vec2  uResolution;
uniform float uTime;
uniform sampler2D uColorTex;
uniform sampler2D uAuxTex;
uniform sampler2D uBloomTex;
uniform float uDebug;        // 0..9
uniform float uExposure;
uniform float uBloomIntensity;
uniform float uVignette;
uniform float uGrain;
uniform float uChromatic;
layout(location = 0) out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 ACES(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.0, 0.0, 0.5);
  vec3 b = vec3(0.0, 0.9, 1.0);
  vec3 c = vec3(0.0, 1.0, 0.0);
  vec3 d = vec3(1.0, 1.0, 0.0);
  vec3 e = vec3(1.0, 0.0, 0.0);
  float s = t * 4.0;
  if (s < 1.0) return mix(a, b, s);
  if (s < 2.0) return mix(b, c, s - 1.0);
  if (s < 3.0) return mix(c, d, s - 2.0);
  return mix(d, e, s - 3.0);
}

vec3 debugMap(float mode, vec2 uv) {
  vec4 a = texture(uAuxTex, uv);
  if (mode < 1.5) return heat(a.x);                          // 1 steps
  if (mode < 2.5) {                                          // 2 hit type
    float rn = a.w;
    if (rn < 0.004) return vec3(0.0);                        // horizon
    if (rn < 0.5) return vec3(0.1, 0.85, 1.0);               // disk
    return vec3(0.95, 0.9, 0.8);                             // sky
  }
  if (mode < 3.5) return heat(a.y * 8.0 / 6.0);              // 3 crossings
  if (mode < 4.5) {                                          // 4 doppler
    float d = a.z * 8.0;
    if (d >= 1.0) return vec3(0.1, 0.4, 1.0) * clamp((d - 1.0) * 0.8, 0.0, 1.0);
    return vec3(1.0, 0.15, 0.1) * clamp((1.0 - d) * 0.8, 0.0, 1.0);
  }
  if (mode < 5.5) {                                          // 5 r at hit
    float rn = max(a.w * 500.0, 0.01);
    return heat(clamp(log2(rn) / 9.0, 0.0, 1.0));
  }
  // 6 closest approach to the hole (from colour RT alpha)
  float m = max(texture(uColorTex, uv).a * 500.0, 0.02);
  return heat(1.0 - clamp(log2(m) / 9.0, 0.0, 1.0));
}

vec3 testCard(vec2 uv) {
  vec3 col = pow(ACES(vec3(uv.x) * uExposure), vec3(1.0 / 2.2));
  if (uv.y < 0.3) {
    float x = uv.x * 6.0;
    float i = floor(x);
    float f = fract(x);
    vec3 bar = vec3(0.0);
    if (i < 0.5) bar = vec3(1.0, 0.2, 0.2);
    else if (i < 1.5) bar = vec3(0.2, 1.0, 0.2);
    else if (i < 2.5) bar = vec3(0.2, 0.4, 1.0);
    else if (i < 3.5) bar = vec3(1.0, 1.0, 0.2);
    else if (i < 4.5) bar = vec3(0.2, 1.0, 1.0);
    else bar = vec3(1.0, 0.2, 1.0);
    col = mix(col, bar, smoothstep(0.0, 0.04, f) * smoothstep(0.04, 0.0, 1.0 - f));
  }
  vec2 g = fract(uv * 12.0);
  float line = smoothstep(0.0, 0.03, min(g.x, 1.0 - g.x)) * smoothstep(0.0, 0.03, min(g.y, 1.0 - g.y));
  col = mix(col, col * 0.35, 1.0 - line);
  if (uv.y > 0.97) col = vec3(1.0);
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 col;
  if (uDebug > 0.5 && uDebug < 6.5) {
    col = debugMap(uDebug, uv);                              // 1..6 debug maps
  } else if (uDebug > 6.5 && uDebug < 7.5) {
    col = texture(uColorTex, uv).rgb;                        // 7 raw HDR
  } else if (uDebug > 7.5 && uDebug < 8.5) {
    col = pow(ACES(texture(uBloomTex, uv).rgb * uBloomIntensity * uExposure), vec3(1.0 / 2.2)); // 8 bloom only
  } else if (uDebug > 8.5) {
    col = testCard(uv);                                      // 9 test card
  } else {
    // normal path: chromatic aberration + bloom + ACES + vignette + grain
    vec2 c = uv - 0.5;
    float rad = length(c);
    vec2 dirn = rad > 1e-4 ? c / rad : vec2(0.0);
    float ca = uChromatic * 0.012;
    vec3 hdr;
    hdr.r = texture(uColorTex, uv + dirn * rad * ca).r;
    hdr.g = texture(uColorTex, uv).g;
    hdr.b = texture(uColorTex, uv - dirn * rad * ca).b;
    vec3 bloom = texture(uBloomTex, uv).rgb * uBloomIntensity;
    col = hdr + bloom;
    col = ACES(col * uExposure);
    col = pow(col, vec3(1.0 / 2.2));
    col *= 1.0 - uVignette * smoothstep(0.35, 1.0, rad * 1.6);
    float g = hash12(gl_FragCoord.xy + fract(uTime * 61.7) * 97.0) - 0.5;
    col += g * uGrain * 0.08;
  }
  outColor = vec4(max(col, 0.0), 1.0);
}
`;
