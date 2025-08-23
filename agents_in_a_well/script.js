(() => {
  // ------- Helpers -------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // ------- DOM -------
  const c = document.getElementById('sim');
  const wrap = c.parentElement;
  const ctx = c.getContext('2d');

  const dprMax = 3;
  let dpr = Math.min(window.devicePixelRatio || 1, dprMax);

  // Controls
  const el = {
    btnPlay: document.getElementById('btnPlay'),
    btnReseed: document.getElementById('btnReseed'),
    btnAlignWells: document.getElementById('btnAlignWells'),
    btnToggleField: document.getElementById('btnToggleField'),
    chkHeading: document.getElementById('chkHeading'),

    rngWells: document.getElementById('rngWells'),
    rngParticles: document.getElementById('rngParticles'),
    rngPr: document.getElementById('rngPr'),
    rngInner: document.getElementById('rngInner'),
    rngSpeed: document.getElementById('rngSpeed'),
    rngNoise: document.getElementById('rngNoise'),
    rngObs: document.getElementById('rngObs'),
    rngLw: document.getElementById('rngLw'),
    rngLo: document.getElementById('rngLo'),
    rngAlpha: document.getElementById('rngAlpha'),

    // value labels
    valWells: document.getElementById('valWells'),
    valParticles: document.getElementById('valParticles'),
    valPr: document.getElementById('valPr'),
    valInner: document.getElementById('valInner'),
    valSpeed: document.getElementById('valSpeed'),
    valNoise: document.getElementById('valNoise'),
    valObs: document.getElementById('valObs'),
    valLw: document.getElementById('valLw'),
    valLo: document.getElementById('valLo'),
    valAlpha: document.getElementById('valAlpha'),
  };

  // ------- State -------
  const state = {
    running: false,
    showField: false,

    // parameters
    P: 5,
    N: 20,
    prCSS: 15,
    innerPct: 0.30,
    v: 85,              // target self-propulsion speed
    sigma: 1.0,         // heading noise
    rObsCSS: 100,
    linkW: 10,
    linkAlpha: 1.0,
    alphaCoupling: 1.0,
    colorByHeading: false,

    // canvas/device
    w: 1000, h: 1000,

    // data
    agents: [],         // {x,y,theta,vx,vy}
    wells: [],          // {x,y}

    // force-field sprite cache
    fieldNeedsUpdate: true,
    kernelCanvas: null,
    kernelSigma: null,
    kernelAmp: null,
  };

  // ------- Resize -------
  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, dprMax);
    const widthPx = Math.max(1, Math.floor(rect.width * dpr));
    const heightPx = Math.max(1, Math.floor(rect.height * dpr));
    if (c.width !== widthPx || c.height !== heightPx) {
      c.width = widthPx;
      c.height = heightPx;
      state.w = widthPx;
      state.h = heightPx;
      state.fieldNeedsUpdate = true;
      reseedAgents();
    }
  }
  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(wrap);
  window.addEventListener('resize', resizeCanvas, { passive: true });
  resizeCanvas();

  // ------- Geometry -------
  function ringRadii() {
    const sz = Math.min(state.w, state.h);
    const Rout = 0.95 * 0.5 * sz;
    const Rin = clamp(state.innerPct * Rout, 0, 0.9 * Rout);
    return { Rin, Rout };
  }
  function randomAnnulus(cx, cy, Rin, Rout) {
    const u = Math.random();
    const rr = Math.sqrt((1 - u) * Rin * Rin + u * Rout * Rout);
    const t = Math.random() * Math.PI * 2;
    return { x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) };
  }

  // ------- Seeding -------
  function reseedAgents() {
    const { Rin, Rout } = ringRadii();
    const cx = state.w * 0.5, cy = state.h * 0.5;
    const pr = Math.max(1, state.prCSS * dpr);
    const rIn = Rin + pr + 1, rOut = Rout - pr - 1;
    state.agents = Array.from({ length: state.N }, () => {
      const u = Math.random();
      const rr = Math.sqrt((1 - u) * rIn * rIn + u * rOut * rOut);
      const t = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI * 2;
      const v0 = state.v;
      return {
        x: cx + rr * Math.cos(t),
        y: cy + rr * Math.sin(t),
        theta,
        vx: v0 * Math.cos(theta),
        vy: v0 * Math.sin(theta),
      };
    });
  }
  function reseedWells() {
    const { Rin, Rout } = ringRadii();
    const cx = state.w * 0.5, cy = state.h * 0.5;
    const pad = 6 * dpr;
    state.wells = Array.from({ length: state.P }, () => randomAnnulus(cx, cy, Rin + pad, Rout - pad));
    state.fieldNeedsUpdate = true;
  }
  function reseedAll() { reseedAgents(); reseedWells(); }

  function alignWellsEquidistant() {
    const { Rin, Rout } = ringRadii();
    const cx = state.w * 0.5, cy = state.h * 0.5;
    const r = 0.5 * (Rin + Rout);
    state.wells = Array.from({ length: state.P }, (_, i) => {
      const th = (i / Math.max(1, state.P)) * 2 * Math.PI;
      return { x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) };
    });
    state.fieldNeedsUpdate = true;
  }

  // ------- Collisions & rim reflections -------
  function reflectOnRims(a, cx, cy, Rin, Rout, pr) {
    const dx = a.x - cx, dy = a.y - cy;
    const r = Math.hypot(dx, dy) || 1e-9;
    const nx = dx / r, ny = dy / r;
    const inner = Rin + pr, outer = Rout - pr;
    if (r < inner || r > outer) {
      const target = r < inner ? inner : outer;
      a.x = cx + nx * target;
      a.y = cy + ny * target;
      const vn = a.vx * nx + a.vy * ny;
      a.vx = a.vx - 2 * vn * nx;
      a.vy = a.vy - 2 * vn * ny;
      a.theta = Math.atan2(a.vy, a.vx);
    }
  }
  function resolveCollisions(iter) {
    const pr = Math.max(1, state.prCSS * dpr);
    const minDist = 2 * pr, minDist2 = minDist * minDist;
    for (let it = 0; it < iter; it++) {
      for (let i = 0; i < state.agents.length; i++) {
        for (let j = i + 1; j < state.agents.length; j++) {
          const a = state.agents[i], b = state.agents[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < minDist2 && d2 > 0) {
            const d = Math.sqrt(d2);
            const overlap = (minDist - d) * 0.5;
            const ux = dx / d, uy = dy / d;
            a.x -= ux * overlap; a.y -= uy * overlap;
            b.x += ux * overlap; b.y += uy * overlap;
          }
        }
      }
      const { Rin, Rout } = ringRadii();
      const cx = state.w * 0.5, cy = state.h * 0.5;
      for (const a of state.agents) reflectOnRims(a, cx, cy, Rin, Rout, pr);
    }
  }

  // ------- Shared well params (for both force & field) -------
  function getWellParams() {
    const { Rin, Rout } = ringRadii();
    const bandWidth = Math.max(1, Rout - Rin);
    const kEff = (state.alphaCoupling * state.v) / Math.max(1, Rout);
    const base = 0.10 * bandWidth;
    const sigma = clamp(base / Math.sqrt(1 + 0.3 * kEff), 0.05 * bandWidth, 0.12 * bandWidth);
    const amp = clamp(0.25 + 0.6 * (kEff / (1 + kEff)), 0.25, 0.85);
    return { sigma, amp, kEff, bandWidth };
  }

  // ------- Simulation (sum-of-Gaussian wells, decisive capture) -------
  function simulate(dt) {
    const { Rin, Rout } = ringRadii();
    const cx = state.w * 0.5, cy = state.h * 0.5;

    const { sigma, amp } = getWellParams();
    const invSigma2 = 1 / (sigma * sigma);

    // Base damping & self-prop drive
    const gammaBase = 1.1;   // baseline linear damping (1/s)
    const aDrive = 2.2;      // velocity relaxation to heading*v (1/s)

    // Capture controls
    const sigmaC = 1.25 * sigma;   // capture width (a bit larger than sigma)
    const invSigmaC2 = 1 / (sigmaC * sigmaC);
    const gammaCap = 4.0;          // extra damping multiplier at full capture
    const tangentialDamp = 6.0;    // damping on tangential velocity near wells

    for (const a of state.agents) {
      // Heading noise
      if (state.sigma > 0) a.theta += state.sigma * randn() * Math.sqrt(dt);

      // Desired drive velocity along heading
      const v0x = state.v * Math.cos(a.theta);
      const v0y = state.v * Math.sin(a.theta);

      // Sum-of-Gaussians force and capture weight
      let Fx = 0, Fy = 0, C = 0;
      for (const w of state.wells) {
        const dx = w.x - a.x, dy = w.y - a.y;
        const d2 = dx * dx + dy * dy;
        const g = Math.exp(-0.5 * d2 * invSigma2);     // Gaussian weight for force
        const gc = Math.exp(-0.5 * d2 * invSigmaC2);   // wider Gaussian for capture
        C += gc;
        const weight = amp * g * invSigma2;            // F ∝ (amp/σ^2) e^{-d^2/2σ^2} (w - x)
        Fx += weight * dx;
        Fy += weight * dy;
      }
      // Normalize capture weight roughly to 0..1 when near at least one well
      C = 1 - Math.exp(-C); // soft squash

      // Damping increases strongly when captured
      const gamma = gammaBase + gammaCap * C;

      // OU-like drive but faded by (1 - C): inside the bowl, propulsion → 0
      const driveScale = 1 - C;
      let ax = aDrive * (v0x - a.vx) * driveScale;
      let ay = aDrive * (v0y - a.vy) * driveScale;

      // Add well force
      ax += Fx; ay += Fy;

      // Tangential damping near wells (kills circular orbits)
      const Fmag = Math.hypot(Fx, Fy);
      if (Fmag > 1e-9 && C > 0.2) {
        const tx = -Fy / Fmag, ty = Fx / Fmag; // unit tangent to force direction
        const vTan = a.vx * tx + a.vy * ty;
        ax += -tangentialDamp * C * vTan * tx;
        ay += -tangentialDamp * C * vTan * ty;
      }

      // Linear damping
      ax += -gamma * a.vx;
      ay += -gamma * a.vy;

      // Integrate
      a.vx += ax * dt;
      a.vy += ay * dt;
      a.x  += a.vx * dt;
      a.y  += a.vy * dt;

      // Heading follows velocity when meaningful
      if ((a.vx * a.vx + a.vy * a.vy) > 1e-9) a.theta = Math.atan2(a.vy, a.vx);

      // Reflect at rims
      const pr = Math.max(1, state.prCSS * dpr);
      reflectOnRims(a, cx, cy, Rin, Rout, pr);
    }

    resolveCollisions(2);
  }

  // ------- FAST force field (cached Gaussian sprite) -------
  function buildKernelSprite(sigma, amp) {
    const R = Math.max(4, Math.ceil(3 * sigma));
    const size = 2 * R;
    const k = document.createElement('canvas');
    k.width = size; k.height = size;
    const kctx = k.getContext('2d');

    const cx = R, cy = R;
    const grad = kctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    const stops = 8;
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      const u = t * 3.0;
      const a = amp * Math.exp(-0.5 * u * u);
      grad.addColorStop(t, `rgba(0,0,0,${a})`);
    }
    kctx.fillStyle = grad;
    kctx.beginPath();
    kctx.arc(cx, cy, R, 0, Math.PI * 2);
    kctx.fill();
    return { canvas: k, radius: R };
  }
  function getWellParamsForField() { return getWellParams(); }
  function ensureKernel() {
    const { sigma, amp } = getWellParamsForField();
    const tol = 1e-3;
    if (
      !state.kernelCanvas ||
      Math.abs((state.kernelSigma ?? -1) - sigma) > tol ||
      Math.abs((state.kernelAmp ?? -1) - amp) > tol
    ) {
      const { canvas: kc } = buildKernelSprite(sigma, amp);
      state.kernelCanvas = kc;
      state.kernelSigma = sigma;
      state.kernelAmp = amp;
    }
  }

  // ------- Draw -------
  function draw() {
    const w = state.w, h = state.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { Rin, Rout } = ringRadii();
    const cx = w * 0.5, cy = h * 0.5;

    // Annulus (white base)
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, Rout, 0, Math.PI * 2);
    ctx.arc(cx, cy, Rin, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.restore();

    // Force field (fast sprites) clipped to annulus
    if (state.showField) {
      ensureKernel();
      const kernel = state.kernelCanvas;
      if (kernel) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, Rout, 0, Math.PI * 2);
        ctx.arc(cx, cy, Rin, 0, Math.PI * 2, true);
        ctx.clip('evenodd');
        for (const wll of state.wells) {
          const R = kernel.width >> 1;
          ctx.drawImage(kernel, wll.x - R, wll.y - R);
        }
        ctx.restore();
      }
    }

    // Ring outlines
    ctx.beginPath(); ctx.arc(cx, cy, Rout, 0, Math.PI * 2);
    ctx.strokeStyle = '#c8c8c8'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, Rin, 0, Math.PI * 2);
    ctx.strokeStyle = '#c8c8c8'; ctx.lineWidth = 1; ctx.stroke();

    // Links within observation radius
    const a = state.agents;
    const r2 = Math.max(1, (state.rObsCSS * dpr)) ** 2;
    if (a.length > 1 && r2 > 4) {
      ctx.lineWidth = Math.max(1, state.linkW * dpr);
      for (let i = 0; i < a.length; i++) {
        const ai = a[i];
        for (let j = i + 1; j < a.length; j++) {
          const aj = a[j];
          const dx = aj.x - ai.x, dy = aj.y - ai.y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            const alpha = clamp(state.linkAlpha, 0, 1);
            ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
            ctx.beginPath(); ctx.moveTo(ai.x, ai.y); ctx.lineTo(aj.x, aj.y); ctx.stroke();
          }
        }
      }
    }

    // Nearest-neighbor links (always)
    if (a.length > 1) {
      ctx.lineWidth = Math.max(1, state.linkW * 0.6 * dpr);
      const alphaNN = clamp(state.linkAlpha * 0.6, 0, 1);
      ctx.strokeStyle = `rgba(0,0,0,${alphaNN})`;
      for (let i = 0; i < a.length; i++) {
        const ai = a[i];
        let bestJ = -1, bestD2 = Infinity;
        for (let j = 0; j < a.length; j++) {
          if (j === i) continue;
          const aj = a[j];
          const dx = aj.x - ai.x, dy = aj.y - ai.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; bestJ = j; }
        }
        if (bestJ >= 0) {
          const aj = a[bestJ];
          ctx.beginPath(); ctx.moveTo(ai.x, ai.y); ctx.lineTo(aj.x, aj.y); ctx.stroke();
        }
      }
    }

    // Wells
    ctx.fillStyle = '#2a7de1';
    for (const wll of state.wells) {
      ctx.beginPath();
      ctx.arc(wll.x, wll.y, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Particles
    const pr = Math.max(1, state.prCSS * dpr);
    const outline = Math.max(1, Math.round(0.1 * pr));
    for (const p of state.agents) {
      if (state.colorByHeading) {
        const hue = ((p.theta * 180) / Math.PI + 360) % 360;
        ctx.fillStyle = `hsl(${hue},70%,40%)`;
      } else {
        ctx.fillStyle = '#111';
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = outline;
      ctx.strokeStyle = '#444';
      ctx.stroke();
    }
  }

  // ------- Loop -------
  let last = performance.now();
  function tick(now) {
    const dt = clamp((now - last) / 1000, 0.001, 0.033);
    last = now;
    if (state.running) simulate(dt);
    draw();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ------- UI -------
  function syncLabels() {
    el.valWells.textContent = state.P;
    el.valParticles.textContent = state.N;
    el.valPr.textContent = `${state.prCSS} px`;
    el.valInner.textContent = `${Math.round(state.innerPct * 100)}%`;
    el.valSpeed.textContent = state.v;
    el.valNoise.textContent = state.sigma.toFixed(2);
    el.valObs.textContent = `${state.rObsCSS} px`;
    el.valLw.textContent = `${state.linkW} px`;
    el.valLo.textContent = state.linkAlpha.toFixed(2);
    el.valAlpha.textContent = state.alphaCoupling.toFixed(2);
  }

  el.btnPlay.addEventListener('click', () => {
    state.running = !state.running;
    const span = el.btnPlay.querySelector('.btn-txt');
    if (span) span.textContent = state.running ? '⏸' : '▶';
  });
  el.btnReseed.addEventListener('click', () => {
    reseedAll();
    state.fieldNeedsUpdate = true;
    draw();
  });
  el.btnAlignWells.addEventListener('click', () => {
    alignWellsEquidistant();
    state.fieldNeedsUpdate = true;
    draw();
  });
  el.btnToggleField.addEventListener('click', () => {
    state.showField = !state.showField;
    draw();
  });
  el.chkHeading.addEventListener('change', (e) => {
    state.colorByHeading = !!e.target.checked;
  });

  // Sliders
  el.rngWells.addEventListener('input', (e) => {
    state.P = parseInt(e.target.value, 10);
    reseedWells();
    syncLabels();
  });
  el.rngParticles.addEventListener('input', (e) => {
    state.N = parseInt(e.target.value, 10);
    reseedAgents();
    syncLabels();
  });
  el.rngPr.addEventListener('input', (e) => {
    state.prCSS = parseInt(e.target.value, 10);
    reseedAgents();
    syncLabels();
  });
  el.rngInner.addEventListener('input', (e) => {
    state.innerPct = parseInt(e.target.value, 10) / 100;
    reseedAgents();
    state.fieldNeedsUpdate = true;
    syncLabels();
  });
  el.rngSpeed.addEventListener('input', (e) => {
    state.v = parseFloat(e.target.value);
    state.fieldNeedsUpdate = true;
    syncLabels();
  });
  el.rngNoise.addEventListener('input', (e) => {
    state.sigma = parseFloat(e.target.value);
    syncLabels();
  });
  el.rngObs.addEventListener('input', (e) => {
    state.rObsCSS = parseInt(e.target.value, 10);
    syncLabels();
  });
  el.rngLw.addEventListener('input', (e) => {
    state.linkW = parseInt(e.target.value, 10);
    syncLabels();
  });
  el.rngLo.addEventListener('input', (e) => {
    state.linkAlpha = parseFloat(e.target.value);
    syncLabels();
  });
  el.rngAlpha.addEventListener('input', (e) => {
    state.alphaCoupling = parseFloat(e.target.value);
    state.fieldNeedsUpdate = true;
    syncLabels();
  });

  // ------- Init -------
  reseedAll();
  syncLabels();
})();