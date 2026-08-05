/* =========================================================================
   pipeline.js — the substrate
   A GPGPU particle field written directly against WebGL2. Particle state
   lives in a pair of ping-ponged RGBA32F textures; each particle streams
   along a path defined by the active stage, and stages morph by mixing
   two path samples. No three.js, no build step.

   Public API (used by site.js):
     SDViz.ready            boolean
     SDViz.setMode(name, dur)
     SDViz.setRect(domRect | null)
     SDViz.setAlpha(a)
     SDViz.refreshColors()
     SDViz.pointer(x, y)
   ========================================================================= */
(function () {
  'use strict';

  var MODES = ['hero', 'generate', 'launch', 'gate', 'serve', 'foundation', 'quiet'];

  var API = {
    ready: false,
    setMode: function () {},
    setRect: function () {},
    setAlpha: function () {},
    refreshColors: function () {},
    pointer: function () {}
  };
  window.SDViz = API;

  var canvas = document.getElementById('viz');
  if (!canvas) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;

  var gl = canvas.getContext('webgl2', {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, powerPreference: 'low-power',
    preserveDrawingBuffer: false
  });
  if (!gl) return;
  if (!gl.getExtension('EXT_color_buffer_float')) return;

  /* ---------------- size of the simulation ---------------- */
  var lowPower =
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    window.matchMedia('(max-width: 780px)').matches;
  var SIDE = lowPower ? 128 : 256;          // 16k or 65k particles
  var COUNT = SIDE * SIDE;
  var DPR_CAP = lowPower ? 1.25 : 1.75;

  /* ---------------- shader sources ---------------- */
  var QUAD_VS = [
    '#version 300 es',
    'in vec2 a_pos;',
    'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }'
  ].join('\n');

  /* shared path maths, injected into the sim shader */
  var PATHS = [
    'const float TAU = 6.2831853;',

    'float hash11(float n){ return fract(sin(n * 127.1) * 43758.5453123); }',
    'vec2 hash22(vec2 p){',
    '  float n = dot(p, vec2(127.1, 311.7));',
    '  return fract(sin(vec2(n, n + 1.7)) * 43758.5453123);',
    '}',

    /* cheap value-noise curl, for organic drift */
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash11(dot(i, vec2(1.0, 57.0)));',
    '  float b = hash11(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));',
    '  float c = hash11(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0)));',
    '  float d = hash11(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'vec2 curl(vec2 p, float t){',
    '  float e = 0.28;',
    '  float n1 = vnoise(p + vec2(0.0, e) + t);',
    '  float n2 = vnoise(p - vec2(0.0, e) + t);',
    '  float n3 = vnoise(p + vec2(e, 0.0) + t);',
    '  float n4 = vnoise(p - vec2(e, 0.0) + t);',
    '  return vec2(n1 - n2, n4 - n3) * 2.0;',
    '}',

    'vec2 bez(vec2 a, vec2 b, vec2 c, float t){',
    '  float u = 1.0 - t;',
    '  return u * u * a + 2.0 * u * t * b + t * t * c;',
    '}',

    /* target position in local space [-1,1] for one mode */
    'vec2 pathFor(int m, float p, float s1, float s2, float t){',
    '  float lane3 = floor(s1 * 3.0);',
    '  float ly = (lane3 - 1.0) * 0.52;',

    /* 0 — hero: wide slow drift that bleeds off every edge */
    '  if (m == 0){',
    '    float y = sin(p * TAU + s1 * TAU) * 0.62 + (s2 - 0.5) * 1.05;',
    '    return vec2(p * 2.3 - 1.15, y);',
    '  }',
    /* 1 — generate: one source fans into three lanes, reconverges */
    '  if (m == 1){',
    '    vec2 a = vec2(-0.88, (s2 - 0.5) * 0.1);',
    '    vec2 b = vec2(0.0, ly * 1.45);',
    '    vec2 c = vec2(0.88, (s2 - 0.5) * 0.35);',
    '    return bez(a, b, c, p);',
    '  }',
    /* 2 — launch: a lattice that fills in waves, everything parked */
    '  if (m == 2){',
    '    float cols = 26.0;',
    '    float gx = mod(floor(s1 * 676.0), cols);',
    '    float gy = floor(floor(s1 * 676.0) / cols);',
    '    vec2 cell = vec2(gx / (cols - 1.0), gy / (cols - 1.0)) * 2.0 - 1.0;',
    '    cell *= 0.84;',
    '    float arrive = smoothstep(0.0, 0.55, p - (gy / cols) * 0.35);',
    '    vec2 from = vec2(-0.95, cell.y * 0.25);',
    '    return mix(from, cell, arrive);',
    '  }',
    /* 3 — gate: funnel through a slot, a fifth of them deflected out.
       Interpolation stays linear on purpose: smoothstep eases at both ends,
       which parks particles at the entry and exit and draws a hard bright
       band there instead of an even stream. */
    '  if (m == 3){',
    '    float blocked = step(s2, 0.21);',
    '    vec2 a = vec2(-0.9, (s1 - 0.5) * 1.15);',
    '    vec2 slot = vec2(-0.02, (s1 - 0.5) * 0.06);',
    /* pass exits right and slightly up; blocked peels away downward, spread
       across an arc so it reads as a fan rather than one bright line */
    '    vec2 outPass = vec2(0.9, -0.18 + (s1 - 0.5) * 0.22);',
    '    vec2 outBlock = vec2(0.32 + s1 * 0.4, 0.66 + (s2 - 0.5) * 0.3);',
    '    vec2 dst = mix(outPass, outBlock, blocked);',
    '    if (p < 0.5) return mix(a, slot, p / 0.5);',
    '    return mix(slot, dst, (p - 0.5) / 0.5);',
    '  }',
    /* 4 — serve: travel the perimeter of the embedded surface */
    '  if (m == 4){',
    '    float w = 0.78, h = 0.62;',
    '    float q = fract(p + s1);',
    '    float seg = q * 4.0;',
    '    vec2 r;',
    '    if (seg < 1.0)      r = vec2(mix(-w, w, seg), -h);',
    '    else if (seg < 2.0) r = vec2(w, mix(-h, h, seg - 1.0));',
    '    else if (seg < 3.0) r = vec2(mix(w, -w, seg - 2.0), h);',
    '    else                r = vec2(-w, mix(h, -h, seg - 3.0));',
    '    float inner = step(s2, 0.34);',
    '    vec2 fill = vec2((s1 - 0.5) * 1.3, (hash11(s2 * 91.7) - 0.5) * 1.0);',
    '    return mix(r, fill, inner);',
    '  }',
    /* 5 — foundation: three stacked tiers, flowing left to right */
    '  if (m == 5){',
    '    float y = (lane3 - 1.0) * 0.6 + (s2 - 0.5) * 0.1;',
    '    return vec2(p * 2.3 - 1.15, y);',
    '  }',
    /* 6 — quiet: near-still ambient */
    '  float yy = (s2 - 0.5) * 1.7;',
    '  return vec2(fract(p * 0.4 + s1) * 2.2 - 1.1, yy);',
    '}'
  ].join('\n');

  var SIM_FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D u_state;',
    'uniform float u_time;',
    'uniform float u_dt;',
    'uniform float u_modeA;',
    'uniform float u_modeB;',
    'uniform float u_mix;',
    'uniform vec4  u_rect;',      // x, y, w, h in pixels
    'uniform float u_fill;',      // 0 shape-preserving, 1 fill the rect
    'uniform vec2  u_ptr;',       // pointer in pixels, (-1,-1) when absent
    'uniform float u_ptrOn;',
    'uniform int   u_side;',
    'out vec4 outState;',
    PATHS,
    'void main(){',
    '  ivec2 tc = ivec2(gl_FragCoord.xy);',
    '  vec4 st = texelFetch(u_state, tc, 0);',
    '  float idx = float(tc.y * u_side + tc.x);',
    '  float s1 = hash11(idx * 0.7231 + 3.17);',
    '  float s2 = hash11(idx * 1.9137 + 11.71);',
    '  float phase = hash11(idx * 0.4413 + 7.03);',
    '  float speed = 0.055 + s1 * 0.075;',
    '  float p = fract(u_time * speed + phase);',

    '  vec2 lA = pathFor(int(u_modeA), p, s1, s2, u_time);',
    '  vec2 lB = pathFor(int(u_modeB), p, s1, s2, u_time);',
    '  vec2 local = mix(lA, lB, u_mix);',

    /* Map local [-1,1] into the focus rect. u_fill blends between
       shape-preserving (0, so the stage topologies aren't stretched inside
       the schematic panel) and filling the rect (1, for the full-viewport
       ambient modes). "half" is reserved in GLSL ES, hence hf. */
    '  vec2 hf = u_rect.zw * 0.5;',
    '  float r = min(hf.x, hf.y);',
    '  vec2 centre = u_rect.xy + hf;',
    '  vec2 sc = mix(vec2(r), hf, u_fill);',
    '  vec2 target = centre + local * sc;',

    '  vec2 pos = st.xy;',
    '  vec2 vel = st.zw;',

    /* first frame: drop the particle straight onto its target */
    '  if (pos.x == 0.0 && pos.y == 0.0) { pos = target; }',

    '  vec2 desired = (target - pos) * 6.2;',
    '  vec2 drift = curl(pos * 0.0022, u_time * 0.06) * 26.0;',
    '  vec2 acc = desired + drift;',

    /* pointer pushes the field around */
    '  if (u_ptrOn > 0.5){',
    '    vec2 d = pos - u_ptr;',
    '    float dist = length(d) + 0.0001;',
    '    float f = clamp(1.0 - dist / 240.0, 0.0, 1.0);',
    '    acc += (d / dist) * f * f * 900.0;',
    '  }',

    '  vel = mix(vel, acc, 0.14);',
    '  pos += vel * u_dt;',
    '  outState = vec4(pos, vel);',
    '}'
  ].join('\n');

  var DRAW_VS = [
    '#version 300 es',
    'precision highp float;',
    'in float a_index;',
    'uniform sampler2D u_state;',
    'uniform vec2  u_res;',
    'uniform int   u_side;',
    'uniform float u_size;',
    'uniform float u_modeA;',
    'uniform float u_modeB;',
    'uniform float u_mix;',
    'out float v_kind;',   // 0 neutral, 1 pass, 2 block
    'out float v_fade;',
    'float h11(float n){ return fract(sin(n * 127.1) * 43758.5453123); }',
    'void main(){',
    '  int i = int(a_index);',
    '  ivec2 tc = ivec2(i % u_side, i / u_side);',
    '  vec4 st = texelFetch(u_state, tc, 0);',
    '  vec2 clip = (st.xy / u_res) * 2.0 - 1.0;',
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);',

    '  float s1 = h11(a_index * 0.7231 + 3.17);',
    '  float s2 = h11(a_index * 1.9137 + 11.71);',

    /* verdict colouring only applies while the gate is on screen */
    '  float gateW = 0.0;',
    '  if (int(u_modeA) == 3) gateW += 1.0 - u_mix;',
    '  if (int(u_modeB) == 3) gateW += u_mix;',
    '  float blocked = step(s2, 0.21);',
    '  v_kind = gateW * (blocked * 2.0 + (1.0 - blocked) * 1.0);',

    '  v_fade = 0.45 + s1 * 0.55;',
    '  gl_PointSize = u_size * (0.7 + s2 * 0.75);',
    '}'
  ].join('\n');

  var DRAW_FS = [
    '#version 300 es',
    'precision highp float;',
    'in float v_kind;',
    'in float v_fade;',
    'uniform vec3 u_ink;',
    'uniform vec3 u_pass;',
    'uniform vec3 u_block;',
    'uniform float u_alpha;',
    'out vec4 frag;',
    'void main(){',
    '  vec2 d = gl_PointCoord - 0.5;',
    '  float r = dot(d, d);',
    '  if (r > 0.25) discard;',
    '  float soft = 1.0 - smoothstep(0.04, 0.25, r);',
    '  vec3 c = u_ink;',
    '  if (v_kind > 1.5)      c = u_block;',
    '  else if (v_kind > 0.5) c = u_pass;',
    '  frag = vec4(c, soft * v_fade * u_alpha);',
    '}'
  ].join('\n');

  /* ---------------- gl helpers ---------------- */
  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      if (window.console) console.warn('[viz] shader', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function program(vsSrc, fsSrc) {
    var vs = compile(gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (window.console) console.warn('[viz] link', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  var simProg = program(QUAD_VS, SIM_FS);
  var drawProg = program(DRAW_VS, DRAW_FS);
  if (!simProg || !drawProg) return;

  var simU = {
    state: gl.getUniformLocation(simProg, 'u_state'),
    time: gl.getUniformLocation(simProg, 'u_time'),
    dt: gl.getUniformLocation(simProg, 'u_dt'),
    modeA: gl.getUniformLocation(simProg, 'u_modeA'),
    modeB: gl.getUniformLocation(simProg, 'u_modeB'),
    mix: gl.getUniformLocation(simProg, 'u_mix'),
    rect: gl.getUniformLocation(simProg, 'u_rect'),
    fill: gl.getUniformLocation(simProg, 'u_fill'),
    ptr: gl.getUniformLocation(simProg, 'u_ptr'),
    ptrOn: gl.getUniformLocation(simProg, 'u_ptrOn'),
    side: gl.getUniformLocation(simProg, 'u_side')
  };
  var drawU = {
    state: gl.getUniformLocation(drawProg, 'u_state'),
    res: gl.getUniformLocation(drawProg, 'u_res'),
    side: gl.getUniformLocation(drawProg, 'u_side'),
    size: gl.getUniformLocation(drawProg, 'u_size'),
    modeA: gl.getUniformLocation(drawProg, 'u_modeA'),
    modeB: gl.getUniformLocation(drawProg, 'u_modeB'),
    mix: gl.getUniformLocation(drawProg, 'u_mix'),
    ink: gl.getUniformLocation(drawProg, 'u_ink'),
    pass: gl.getUniformLocation(drawProg, 'u_pass'),
    block: gl.getUniformLocation(drawProg, 'u_block'),
    alpha: gl.getUniformLocation(drawProg, 'u_alpha')
  };

  /* full-screen quad for the sim pass */
  var quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);
  var quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(simProg, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  /* one vertex per particle */
  var pointVAO = gl.createVertexArray();
  gl.bindVertexArray(pointVAO);
  var idx = new Float32Array(COUNT);
  for (var i = 0; i < COUNT; i++) idx[i] = i;
  var idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  var aIndex = gl.getAttribLocation(drawProg, 'a_index');
  gl.enableVertexAttribArray(aIndex);
  gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  /* ping-pong state targets */
  function makeTarget() {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, SIDE, SIDE, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: tex, fbo: fbo };
  }
  var A = makeTarget(), B = makeTarget();
  if (!A || !B) return;

  /* ---------------- state ---------------- */
  var W = 1, H = 1, dpr = 1;
  var rect = { x: 0, y: 0, w: 1, h: 1 };
  var fill = 1;
  var rectTarget = null;                 // DOMRect-ish or null for full viewport
  var modeA = 0, modeB = 0, mixV = 0;
  var alpha = 0.85, alphaTarget = 0.85;
  var ptrX = -1, ptrY = -1, ptrOn = 0;
  var t = 0, last = 0, running = false, visible = true, inited = false;
  var slowFrames = 0, degraded = false, dead = false;
  var colors = { ink: [1, 1, 1], pass: [0, 1, 0.6], block: [1, 0.4, 0.35] };
  var isDark = true;

  function parseColor(str) {
    str = (str || '').trim();
    var m = str.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      var n = parseInt(m[1], 16);
      return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    }
    m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    }
    return null;
  }

  function refreshColors() {
    var cs = getComputedStyle(document.documentElement);
    var ink = parseColor(cs.getPropertyValue('--ink-3'));
    var pass = parseColor(cs.getPropertyValue('--pass'));
    var block = parseColor(cs.getPropertyValue('--block'));
    if (ink) colors.ink = ink;
    if (pass) colors.pass = pass;
    if (block) colors.block = block;

    var bg = parseColor(cs.getPropertyValue('--bg')) || [0, 0, 0];
    isDark = (bg[0] + bg[1] + bg[2]) / 3 < 0.5;
  }
  refreshColors();

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    /* innerWidth, not clientWidth: the canvas is 100vw so it spans the
       scrollbar gutter too, and the drawing buffer has to match or the field
       gets squeezed and leaves the right edge unpainted. */
    var cw = window.innerWidth || canvas.clientWidth;
    var ch = window.innerHeight || canvas.clientHeight;
    W = Math.max(1, Math.round(cw * dpr));
    H = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    computeRect();
  }

  function computeRect() {
    if (rectTarget) {
      /* inside the schematic panel: exact bounds, shape preserved */
      rect.x = rectTarget.left * dpr;
      rect.y = rectTarget.top * dpr;
      rect.w = rectTarget.width * dpr;
      rect.h = rectTarget.height * dpr;
      fill = 0.3;
    } else {
      /* ambient: overscan past every edge so the field bleeds off screen
         instead of drawing itself a visible rectangle */
      rect.x = -W * 0.14;
      rect.y = -H * 0.14;
      rect.w = W * 1.28;
      rect.h = H * 1.28;
      fill = 1;
    }
  }

  /* ---------------- frame ---------------- */
  function frame(now) {
    if (dead) return;
    if (!running || !visible) { last = now; requestAnimationFrame(frame); return; }

    var dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    if (dt > 0.05) dt = 0.05;            // tab stalls shouldn't teleport particles

    /* frame-time watchdog: shed work once, then bail out entirely */
    if (dt > 0.032) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 90 && !degraded) {
      degraded = true;
      DPR_CAP = 1;
      resize();
      slowFrames = 0;
    } else if (slowFrames > 200 && degraded) {
      dead = true;
      canvas.removeAttribute('data-ready');
      return;
    }

    t += dt;
    alpha += (alphaTarget - alpha) * Math.min(1, dt * 3.2);

    /* --- simulate --- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.fbo);
    gl.viewport(0, 0, SIDE, SIDE);
    gl.disable(gl.BLEND);
    gl.useProgram(simProg);
    gl.bindVertexArray(quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, A.tex);
    gl.uniform1i(simU.state, 0);
    gl.uniform1f(simU.time, t);
    gl.uniform1f(simU.dt, dt);
    gl.uniform1f(simU.modeA, modeA);
    gl.uniform1f(simU.modeB, modeB);
    gl.uniform1f(simU.mix, mixV);
    gl.uniform4f(simU.rect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform1f(simU.fill, fill);
    gl.uniform2f(simU.ptr, ptrX * dpr, ptrY * dpr);
    gl.uniform1f(simU.ptrOn, ptrOn);
    gl.uniform1i(simU.side, SIDE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    var swap = A; A = B; B = swap;

    /* --- draw --- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (isDark) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(drawProg);
    gl.bindVertexArray(pointVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, A.tex);
    gl.uniform1i(drawU.state, 0);
    gl.uniform2f(drawU.res, W, H);
    gl.uniform1i(drawU.side, SIDE);
    gl.uniform1f(drawU.size, (isDark ? 2.5 : 2.2) * dpr);
    gl.uniform1f(drawU.modeA, modeA);
    gl.uniform1f(drawU.modeB, modeB);
    gl.uniform1f(drawU.mix, mixV);
    gl.uniform3fv(drawU.ink, colors.ink);
    gl.uniform3fv(drawU.pass, colors.pass);
    gl.uniform3fv(drawU.block, colors.block);
    /* light theme composites with normal alpha over paper, so the same value
       reads far heavier there than additive-on-black does */
    gl.uniform1f(drawU.alpha, alpha * (isDark ? 0.68 : 0.3));
    gl.drawArrays(gl.POINTS, 0, COUNT);
    gl.bindVertexArray(null);

    if (!inited) {
      inited = true;
      canvas.setAttribute('data-ready', 'true');
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- public API ---------------- */
  var tween = null;

  API.ready = true;

  API.setMode = function (name, dur) {
    var next = MODES.indexOf(name);
    if (next < 0) return;
    var cur = mixV < 0.5 ? modeA : modeB;
    if (next === cur && mixV === (mixV < 0.5 ? 0 : 1)) return;

    /* collapse whatever is in flight onto the current visible mode, then cross */
    modeA = cur;
    modeB = next;
    mixV = 0;

    if (tween && tween.kill) tween.kill();
    var d = typeof dur === 'number' ? dur : 1.1;
    if (window.gsap) {
      var box = { v: 0 };
      tween = window.gsap.to(box, {
        v: 1, duration: d, ease: 'power2.inOut',
        onUpdate: function () { mixV = box.v; },
        onComplete: function () { modeA = next; mixV = 0; }
      });
    } else {
      mixV = 1;
      modeA = next;
      mixV = 0;
    }
  };

  API.setRect = function (r) {
    rectTarget = r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
    computeRect();
  };

  API.setAlpha = function (a) { alphaTarget = Math.max(0, Math.min(1, a)); };
  API.refreshColors = refreshColors;
  API.pointer = function (x, y) {
    if (x == null) { ptrOn = 0; return; }
    ptrX = x; ptrY = y; ptrOn = 1;
  };

  /* ---------------- wiring ---------------- */
  resize();
  window.addEventListener('resize', function () { resize(); }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    visible = !document.hidden;
  });

  /* A phone that backgrounds the tab, or a driver reset, can take the GL
     context away. Without this the canvas freezes on its last frame or goes
     black and never recovers. Stop drawing and fade it out instead: the page
     is already complete without it. */
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    dead = true;
    canvas.removeAttribute('data-ready');
  }, false);

  if (!window.matchMedia('(pointer: coarse)').matches) {
    window.addEventListener('pointermove', function (e) {
      API.pointer(e.clientX, e.clientY);
    }, { passive: true });
    window.addEventListener('pointerleave', function () { API.pointer(null); }, { passive: true });
  }

  running = true;
  requestAnimationFrame(frame);
})();
