// Pure math for the playground widgets (no DOM). Formulas follow the VI-CuRL paper:
//   confidence  c(x) = 1 - u(x),  u(x) = mean over responses and tokens of H(pi(.|s_t)) / log|V|
//   selection   keep top k_t = ceil(beta_t * B) prompts, weight 1 / beta_hat_t with beta_hat_t = k_t / B
//   Theorem 1   |L - L_t| <= 2 L_max (1 - beta_t)
//   Theorem 2   Var(g_t) = sigma2_g / beta + V_prob / beta + (1 - beta) / beta * ||grad L_t||^2

/** Seeded PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sampler built on a uniform PRNG (Box-Muller). */
export function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/* ------------------------------------------------------------------ */
/* Confidence from token distributions                                 */
/* ------------------------------------------------------------------ */

/** Softmax of logits scaled by sharpness (= 1 / temperature). */
export function softmax(logits, sharp = 1) {
  const z = logits.map((v) => v * sharp);
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** Shannon entropy divided by log|V| (|V| = length of p), in [0, 1]. */
export function normEntropy(p) {
  let H = 0;
  for (const q of p) if (q > 0) H -= q * Math.log(q);
  return p.length > 1 ? H / Math.log(p.length) : 0;
}

/* ------------------------------------------------------------------ */
/* Curriculum toy population                                           */
/* ------------------------------------------------------------------ */

const DEG = Math.PI / 180;

// Toy assumptions (the paper measures, but does not prove, that confident prompts have
// lower action and problem variance):
//   action noise per response grows as confidence drops;
//   mean-gradient directions are more dispersed for low-confidence prompts;
//   confident prompts lean slightly to one side of the full-data direction (curriculum bias).
// Calibrated so that, averaged over 200 batches at beta = 0.2, the kept/full ratios of the top-confidence
// subset are ~0.67 (action) and ~0.65 (problem), inside the 0.55-0.80 the paper measured (Fig. 3).
export const TOY = {
  theta0: 38 * DEG,      // central direction of the mean gradients
  lean: 20 * DEG,        // direction drift across the confidence range (source of bias)
  dispMin: 34 * DEG,     // angular std of mean directions for c = 1
  dispMax: 60 * DEG,     // ... for c = 0
  noiseMin: 1.25,        // per-coordinate response noise std for c = 1
  noiseMax: 2.1,         // ... for c = 0
};

/**
 * Build a batch of B prompts with G responses each in 2-D gradient space.
 * Returns { prompts, order: {conf, random, least}, full } where each prompt has
 * c, mu [x,y], s (noise std), resp [[x,y] * G], gbar (empirical group mean).
 */
export function makeBatch(seed, B = 40, G = 4, toy = TOY) {
  const rand = rng(seed);
  const T = { ...TOY, ...toy };
  const prompts = [];
  for (let j = 0; j < B; j++) {
    // stratified confidences so every batch spans the range
    const c = 0.1 + 0.86 * ((j + 0.15 + 0.7 * rand()) / B);
    const disp = T.dispMin + (T.dispMax - T.dispMin) * Math.pow(1 - c, 1.25);
    const phi = T.theta0 + T.lean * (c - 0.55) + disp * gauss(rand);
    const r = 1 + 0.12 * gauss(rand);
    const mu = [r * Math.cos(phi), r * Math.sin(phi)];
    const s = T.noiseMin + (T.noiseMax - T.noiseMin) * Math.pow(1 - c, 1.2);
    const resp = [];
    for (let i = 0; i < G; i++) resp.push([mu[0] + s * gauss(rand), mu[1] + s * gauss(rand)]);
    const gbar = [resp.reduce((a, v) => a + v[0], 0) / G, resp.reduce((a, v) => a + v[1], 0) / G];
    prompts.push({ c, mu, s, resp, gbar });
  }
  // shuffle the batch so indices do not reveal confidence
  for (let j = B - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1));
    [prompts[j], prompts[k]] = [prompts[k], prompts[j]];
  }
  prompts.forEach((p, j) => { p.id = j + 1; });
  const idx = prompts.map((_, j) => j);
  // ties are impossible with continuous scores; break by batch index anyway (paper's rule)
  const conf = idx.slice().sort((a, b) => prompts[b].c - prompts[a].c || a - b);
  const least = conf.slice().reverse();
  const random = idx.slice();
  for (let j = B - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1));
    [random[j], random[k]] = [random[k], random[j]];
  }
  const full = mean2(prompts.map((p) => p.mu));
  return { seed, B, G, prompts, order: { conf, random, least }, full, varFull: variance(prompts, idx, G, 1) };
}

export const kOf = (beta, B) => Math.min(B, Math.max(1, Math.ceil(beta * B - 1e-9)));

/** Theorem 2 terms for a kept index set, computed exactly from the toy population. */
export function variance(prompts, kept, G, betaHat) {
  const k = kept.length;
  // action variance: trace of Var over y_{1:G} of the group gradient (1/G) sum_i g_i = 2 s^2 / G
  const sigma2 = kept.reduce((a, j) => a + (2 * prompts[j].s * prompts[j].s) / G, 0) / k;
  const m = mean2(kept.map((j) => prompts[j].mu)); // grad L_t (population mean over kept)
  const vprob = kept.reduce((a, j) => a + dist2(prompts[j].mu, m), 0) / k;
  const norm2 = m[0] * m[0] + m[1] * m[1];
  const action = sigma2 / betaHat, problem = vprob / betaHat, masking = ((1 - betaHat) / betaHat) * norm2;
  return { sigma2, vprob, norm2, action, problem, masking, total: action + problem + masking, gradLt: m };
}

/** Everything the curriculum widget shows for one (batch, rule, beta). */
export function evaluate(batch, rule, beta, redraws = 32) {
  const { B, G, prompts, order, full } = batch;
  const k = kOf(beta, B);
  const betaHat = k / B;
  const kept = order[rule].slice(0, k);
  const v = variance(prompts, kept, G, betaHat);
  // batch gradient from the drawn responses: (1/B) sum_j (w_j / beta_hat) gbar_j = mean over kept
  const ghat = mean2(kept.map((j) => prompts[j].gbar));
  // direction error: angle between a fresh-response batch gradient and the full-data gradient.
  // Common random numbers: every rule uses the same per-prompt noise draws, so equal kept sets give equal results.
  if (!batch.noise || batch.noise.length < redraws) {
    const rand = rng((batch.seed * 7919 + 131) >>> 0);
    batch.noise = [];
    for (let r = 0; r < redraws; r++) batch.noise.push(prompts.map(() => [gauss(rand), gauss(rand)]));
  }
  let ang = 0;
  for (let r = 0; r < redraws; r++) {
    let gx = 0, gy = 0;
    for (const j of kept) {
      const z = batch.noise[r][j], p = prompts[j], sd = p.s / Math.sqrt(G);
      gx += p.mu[0] + sd * z[0];
      gy += p.mu[1] + sd * z[1];
    }
    ang += angle([gx, gy], full);
  }
  return {
    k, betaHat, kept, keptSet: new Set(kept), ghat, ...v,
    bound: 2 * 1 * (1 - betaHat),
    biasAngle: angle(v.gradLt, full),
    batchAngle: angle(ghat, full),
    dirErr: ang / redraws,
    ratioAction: v.sigma2 / batch.varFull.sigma2,
    ratioProblem: v.vprob / batch.varFull.vprob,
  };
}

function mean2(vs) {
  const n = vs.length || 1;
  return [vs.reduce((a, v) => a + v[0], 0) / n, vs.reduce((a, v) => a + v[1], 0) / n];
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
/** Unsigned angle between two 2-D vectors, in degrees. */
export function angle(a, b) {
  const d = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) / DEG;
}
