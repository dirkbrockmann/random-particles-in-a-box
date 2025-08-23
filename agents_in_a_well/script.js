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

  // Rendering quality controls
  const dprMax = 3;        // allow sharper main canvas on HiDPI
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
    P: 5,               // wells
    N: 20,              // particles
    prCSS: 15,          // particle radius in CSS px (scaled by dpr)
    innerPct: 0.30,     // 0..0.90 of Rout
    v: 85,              // speed
    sigma: 1.0,         // angular noise (Wiener)
    rObsCSS: 100,        // observation radius in CSS px
    linkW: 10,          // link width in CSS px
    linkAlpha: 0.5,     // 0..1
    alphaCoupling: 1.0, // well coupling
    colorByHeading: false,

    // canvas/device
    w: 1000, h: 1000,

    // data
    agents: [],         // {x,y,theta}
    wells: [],          // {x,y}

    // field rendering (fast sprite-based)
    fieldNeedsUpdate: true,
    kernelCanvas: null,      // cached Gaussian sprite
    kernelSigma: null,       // cache keys
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
      state.fieldNeedsUpdate = true;  // ring geometry changed -> recalc kernel radius
      reseedAgents();                 // keep agents within bounds if ring changed
    }
  }
  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(wrap);
  window.addEventListener('resize', resizeCanvas, { passive: true });
  resizeCanvas();

  // ------- Geometry -------
  function ringRadii() {
    const sz = Math.min(state.w, state.h);
    const Rout = 0.95 * 0.5 * sz;                           // outer radius = 95% of half min dimension
    const Rin = clamp(state.innerPct * Rout, 0, 0.9 * Rout);
    return { Rin, Rout };
  }
  function randomAnnulus(cx, cy, Rin, Rout) {
    // uniform area sampling in an annulus
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
      return { x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t), theta: Math.random() * Math.PI * 2 };
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
      const vx = Math.cos(a.theta), vy = Math.sin(a.theta);
      const dot = vx * nx + vy * ny;
      const rx = vx - 2 * dot * nx, ry = vy - 2 * dot * ny;
      a.theta = Math.atan2(ry, rx);
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

  // ------- Simulation -------
  function simulate(dt) {
    const { Rin, Rout } = ringRadii();
    const cx = state.w * 0.5, cy = state.h * 0.5;
    const pr = Math.max(1, state.prCSS * dpr);
    const kEff = (state.alphaCoupling * state.v) / Math.max(1, Rout);

    for (const a of state.agents) {
      // Wiener process for heading
      a.theta += state.sigma * randn() * Math.sqrt(dt);

      // Base motion
      let dx = state.v * Math.cos(a.theta) * dt;
      let dy = state.v * Math.sin(a.theta) * dt;

      // Attraction to nearest well only
      if (state.wells.length && kEff > 0) {
        let nearest = state.wells[0], best = (nearest.x - a.x) ** 2 + (nearest.y - a.y) ** 2;
        for (let k = 1; k < state.wells.length; k++) {
          const w = state.wells[k];
          const d2 = (w.x - a.x) ** 2 + (w.y - a.y) ** 2;
          if (d2 < best) { best = d2; nearest = w; }
        }
        dx += kEff * (nearest.x - a.x) * dt;
        dy += kEff * (nearest.y - a.y) * dt;
      }

      a.x += dx; a.y += dy;
      reflectOnRims(a, cx, cy, Rin, Rout, pr);
    }

    resolveCollisions(2);
  }

  // ------- FAST force field (cached Gaussian sprite) -------
  function buildKernelSprite(sigma, amp) {
    // We approximate a 2D Gaussian with a radial gradient: alpha(r) = amp * exp(-0.5*(r/sigma)^2)
    // Render a single sprite (diameter ~ 6σ), then reuse for all wells.
    const R = Math.max(4, Math.ceil(3 * sigma));
    const size = 2 * R;
    const k = document.createElement('canvas');
    k.width = size; k.height = size;
    const kctx = k.getContext('2d');

    const cx = R, cy = R;
    const grad = kctx.createRadialGradient(cx, cy, 0, cx, cy, R);

    // Use a few stops to approximate Gaussian falloff (center darkest).
    const stops = 8; // more stops = smoother, still cheap
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;         // 0..1
      const u = t * 3.0;           // r ~ t * (3σ)
      const a = amp * Math.exp(-0.5 * u * u); // Gaussian alpha
      grad.addColorStop(t, `rgba(0,0,0,${a})`);
    }

    kctx.fillStyle = grad;
    kctx.beginPath();
    kctx.arc(cx, cy, R, 0, Math.PI * 2);
    kctx.fill();
    return { canvas: k, radius: R };
  }

  function ensureKernel() {
    // Compute sigma & amp from current parameters (same mapping as before)
    const { Rin, Rout } = ringRadii();
    const bandWidth = Math.max(1, Rout - Rin);
    const kEff = (state.alphaCoupling * state.v) / Math.max(1, Rout);

    // Sigma ~ constant with mild shrink as coupling increases
    const base = 0.10 * bandWidth;
    const sigma = clamp(base / Math.sqrt(1 + 0.3 * kEff), 0.05 * bandWidth, 0.12 * bandWidth);

    // Amplitude increases with coupling and saturates
    const amp = clamp(0.25 + 0.6 * (kEff / (1 + kEff)), 0.25, 0.85);

    // Rebuild kernel sprite only if sigma/amp changed meaningfully
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

    // Annulus base (white)
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, Rout, 0, Math.PI * 2);
    ctx.arc(cx, cy, Rin, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.restore();

    // Force field (very fast: draw cached Gaussian sprite at each well, clipped to annulus)
    if (state.showField) {
      ensureKernel();
      const kernel = state.kernelCanvas;
      if (kernel) {
        ctx.save();
        // Clip to annulus using even-odd rule
        ctx.beginPath();
        ctx.arc(cx, cy, Rout, 0, Math.PI * 2);
        ctx.arc(cx, cy, Rin, 0, Math.PI * 2, true);
        ctx.clip('evenodd');

        // Draw one sprite per well (darker near center, overlap creates channels)
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

    // Links between observed pairs
    const r2 = Math.max(1, (state.rObsCSS * dpr)) ** 2;
    if (state.agents.length > 1 && r2 > 4) {
      ctx.lineWidth = Math.max(1, state.linkW * dpr);
      for (let i = 0; i < state.agents.length; i++) {
        const ai = state.agents[i];
        for (let j = i + 1; j < state.agents.length; j++) {
          const aj = state.agents[j];
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

    // Wells
    ctx.fillStyle = '#ff0000ff';
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
    state.fieldNeedsUpdate = true; // kernel will rebuild automatically
    draw();
  });
  el.btnAlignWells.addEventListener('click', () => {
    alignWellsEquidistant();
    state.fieldNeedsUpdate = true;
    draw();
  });
  el.btnToggleField.addEventListener('click', () => {
    state.showField = !state.showField;
    // No heavy recompute needed; kernel cached & reused
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
    state.fieldNeedsUpdate = true; // ring width changed → sigma base changes
    syncLabels();
  });
  el.rngSpeed.addEventListener('input', (e) => {
    state.v = parseFloat(e.target.value);
    state.fieldNeedsUpdate = true; // kEff changed → sigma/amp update
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
    state.fieldNeedsUpdate = true; // kEff changed → sigma/amp update
    syncLabels();
  });

  // ------- Init -------
  reseedAll();
  syncLabels();
})();