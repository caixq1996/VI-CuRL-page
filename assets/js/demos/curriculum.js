// Widget 2: "Curriculum simulator: bias vs. variance" (#demo-curriculum).
// Toy batch of B prompts in 2-D gradient space; top-k_t selection with k_t = ceil(beta_t B), weights 1/beta_hat_t;
// Theorem 1 bound and Theorem 2 decomposition computed exactly from the toy population.
import { h, svgEl, onThemeChange, onResize, createTooltip, fmt, prefersReducedMotion } from "../viz-common.js";
import { makeBatch, evaluate } from "./sim-core.js";
import { rich, subHTML, svgRich } from "./rich.js";

const B = 40, G = 4, STEPS = 32; // beta_t = 0.2 + 0.8 * n / 32, so beta_t * B = 8 + n is an integer
const RULES = [
  { key: "conf", label: "Most confident (VI-CuRL)", short: "VI-CuRL" },
  { key: "random", label: "Random", short: "Random" },
  { key: "least", label: "Least confident", short: "Least confident" },
];
const TERMS = [
  { key: "action", cls: "demo-seg-a", name: "Action", tex: "σ²_g,t / β_t" },
  { key: "problem", cls: "demo-seg-p", name: "Problem", tex: "V_prob,t / β_t" },
  { key: "masking", cls: "demo-seg-m", name: "Masking", tex: "(1−β_t)/β_t · ‖∇L_t‖²" },
];
const R_DOM = 3; // half-width of the gradient plot, in toy gradient units
let uid = 0;

export function initCurriculum(root) {
  const id = `demo-cur-${++uid}`;
  const state = { seed: 487, n: 0, rule: "conf", playing: false, visible: true, table: false };
  let batch = null, domain = 1, rdom = 1.5, timer = 0, last = null;
  root.classList.add("demo-root");
  let tip0 = null; // created after the skeleton is mounted (replaceChildren would remove it)
  const tip = { show: (html, x, y) => tip0.show(subHTML(html), x, y), hide: () => tip0.hide() };

  // ---------- controls ----------
  const playBtn = h("button", { type: "button", class: "btn-small demo-btn-play", "aria-pressed": "false" });
  const slider = h("input", { type: "range", class: "slider", min: "0", max: String(STEPS), step: "1", value: "0", id: `${id}-p`,
    "aria-label": "Training progress p" });
  const pOut = h("output", { class: "demo-out", for: `${id}-p` });
  const ruleSeg = h("div", { class: "seg", role: "group", "aria-label": "Selection rule" },
    RULES.map((r) => h("button", { type: "button", "data-k": r.key, onclick: () => { state.rule = r.key; render(); } }, r.label)));
  const resample = h("button", { type: "button", class: "btn-small" }, "Resample batch");
  const tableBtn = h("button", { type: "button", class: "btn-small", "aria-expanded": "false" }, "Table");

  // ---------- views ----------
  const stripBox = h("div", { class: "demo-strip-svg" });
  const stripLegend = h("div", { class: "legend demo-legend" }, [
    h("span", {}, [h("span", { class: "sw demo-sw-kept", style: "background:var(--series-accent)" }), "kept for the update"]),
    h("span", {}, [h("span", { class: "sw", style: "background:var(--series-faint)" }), "dropped this step"]),
  ]);
  const plotBox = h("div", {});
  const plotCap = h("div", { class: "demo-caption" });
  const tiles = h("div", { class: "demo-tiles" });
  const ratioBox = h("div", {});
  const barsBox = h("div", {});
  const barsCap = h("div", { class: "demo-caption" });
  const dirBox = h("div", {});
  const tables = h("div", { class: "demo-tables", hidden: true });

  root.replaceChildren(
    h("h3", { class: "demo-title", style: "margin-top:0" }, ["Curriculum simulator: bias vs. variance", h("span", { class: "badge-sim" }, "Toy simulation")]),
    h("p", { class: "demo-desc" }, rich(`A batch of ${B} prompts with ${G} responses each, drawn as gradients in a 2-D toy parameter space. Drag training progress to anneal β_t from 0.2 to 1 and compare selection rules.`)),
    h("div", { class: "controls demo-controls demo-controls-top" }, [
      playBtn,
      h("label", { class: "demo-ctl-range demo-ctl-wide", for: `${id}-p` }, [h("span", { class: "control-label" }, "Training progress"), slider, pOut]),
    ]),
    h("div", { class: "controls demo-controls" }, [
      h("span", { class: "demo-ctl" }, [h("span", { class: "control-label" }, "Keep"), ruleSeg]),
      h("span", { class: "demo-spacer" }),
      h("span", { class: "demo-btns" }, [resample, tableBtn]),
    ]),
    h("div", { class: "demo-strip" }, [
      h("div", { class: "demo-sub" }, ["Prompts ranked by confidence c(x) ", h("span", { class: "muted" }, "· most confident on the left")]),
      stripBox, stripLegend,
    ]),
    h("div", { class: "demo-cur-grid" }, [
      h("div", { class: "demo-read" }, [
        tiles,
        h("div", {}, [
          h("div", { class: "demo-sub" }, ["Variance of the kept set vs. the full batch ", h("span", { class: "muted" }, "· ratio, as in the paper's Fig. 3")]),
          ratioBox,
          h("div", { class: "legend demo-legend" }, [
            h("span", {}, [h("span", { class: "sw", style: "background:var(--series-accent)" }), "VI-CuRL"]),
            h("span", {}, [h("span", { class: "sw", style: "background:var(--series-muted)" }), "other rules"]),
            h("span", {}, [h("span", { class: "lk dash" }), "full batch = 1"]),
          ]),
          h("div", { class: "demo-caption" }, rich("Below 1, the kept prompts' gradients are less noisy than the full batch's. In real training the paper measured 0.55–0.80 at β_t ≈ 0.2 (Fig. 3).")),
        ]),
        h("div", {}, [
          h("div", { class: "demo-sub" }, [...rich("Variance of ĝ_t (Theorem 2) "), h("span", { class: "muted" }, rich("· the three rules at the same β_t"))]),
          barsBox,
          h("div", { class: "legend demo-legend" }, TERMS.map((t) => h("span", {}, [h("span", { class: "sw", style: `background:var(${t.key === "action" ? "--cat-2" : t.key === "problem" ? "--cat-7" : "--cat-3"})` }), ...rich(`${t.name} ${t.tex}`)]))),
          barsCap,
        ]),
      ]),
      h("div", { class: "demo-plot-wrap" }, [
        h("div", { class: "demo-sub" }, ["Gradients of the kept prompts ", h("span", { class: "muted" }, "· toy 2-D parameter space")]),
        plotBox,
        h("div", { class: "legend demo-legend" }, [
          h("span", {}, [h("span", { class: "lk thin" }), "one response"]),
          h("span", {}, [h("span", { class: "dot", style: "background:var(--series-accent)" }), "prompt mean ḡ(x)"]),
          h("span", {}, [h("span", { class: "lk bold" }), ...rich("batch gradient ĝ_t")]),
          h("span", {}, [h("span", { class: "lk dash" }), "full-data gradient ∇L"]),
        ]),
        plotCap,
        h("div", { class: "demo-dir" }, [
          h("div", { class: "demo-sub" }, [...rich("Update direction error "), h("span", { class: "muted" }, rich("· mean ∠(ĝ_t, ∇L) over 32 redraws"))]),
          dirBox,
          h("div", { class: "demo-caption" }, "Selection bias and gradient noise both tilt the update away from the full-data direction; at β = 1 the rules coincide."),
        ]),
      ]),
    ]),
    tables,
    h("p", { class: "demo-note" }, [h("b", {}, "Toy assumption. "),
      "Lower-confidence prompts get noisier responses and more dispersed mean gradients, and confident prompts lean slightly off the full-data direction (the curriculum bias). The paper measures this variance pattern in real training (Fig. 3); it is not a theorem. All terms are computed exactly for this toy population of ",
      ...rich(`${B} prompts × ${G} responses, with L_max = 1. Resample to see how much one batch varies from the next.`)]),
  );

  tip0 = createTooltip(root);

  // ---------- events ----------
  playBtn.addEventListener("click", () => setPlaying(!state.playing));
  slider.addEventListener("input", () => { setPlaying(false); state.n = Number(slider.value); render(); });
  resample.addEventListener("click", () => { state.seed = (state.seed * 48271 + 11) % 2147483647; newBatch(); render(); });
  tableBtn.addEventListener("click", () => {
    state.table = !state.table; tableBtn.setAttribute("aria-expanded", String(state.table)); tables.hidden = !state.table; render();
  });
  const io = new IntersectionObserver((es) => { state.visible = es[0].isIntersecting; schedule(); }, { threshold: 0.05 });
  io.observe(root);
  document.addEventListener("visibilitychange", schedule);

  function setPlaying(on) {
    state.playing = on;
    if (on && state.n >= STEPS) state.n = 0;
    schedule();
    renderPlay();
    if (on) render();
  }
  function schedule() {
    clearTimeout(timer);
    if (!state.playing || !state.visible || document.hidden) return;
    const slow = prefersReducedMotion();
    const wait = state.n >= STEPS ? 1600 : slow ? 650 : 230;
    timer = setTimeout(() => { state.n = state.n >= STEPS ? 0 : state.n + 1; render(); schedule(); }, wait);
  }
  function renderPlay() {
    playBtn.setAttribute("aria-pressed", String(state.playing));
    playBtn.setAttribute("aria-label", state.playing ? "Pause the annealing animation" : "Play the annealing animation");
    playBtn.replaceChildren(icon(state.playing), state.playing ? "Pause" : "Play");
  }

  function newBatch() {
    batch = makeBatch(state.seed, B, G);
    domain = 0; rdom = 1;
    for (let n = 0; n <= STEPS; n++) for (const r of RULES) {
      const e = evaluate(batch, r.key, beta(n), 0);
      domain = Math.max(domain, e.total); rdom = Math.max(rdom, e.ratioAction, e.ratioProblem);
    }
    domain = niceMax(domain);
    rdom = Math.max(1.5, Math.ceil(rdom * 4 - 1e-9) / 4);
  }

  // ---------- render ----------
  function render() {
    if (tip0) tip0.hide(); // marks are rebuilt below, so any open tooltip would go stale
    const wS = stripBox.clientWidth, wP = plotBox.clientWidth, wB = barsBox.clientWidth, wD = dirBox.clientWidth, wR = ratioBox.clientWidth; // read before writing
    const b = beta(state.n);
    const evs = Object.fromEntries(RULES.map((r) => [r.key, evaluate(batch, r.key, b)]));
    const ev = evs[state.rule];
    last = { b, evs, ev };
    for (const btn of ruleSeg.children) btn.setAttribute("aria-pressed", String(btn.dataset.k === state.rule));
    slider.value = String(state.n);
    const p = state.n / STEPS;
    pOut.textContent = `p = ${fmt(p, 2)}`;
    slider.setAttribute("aria-valuetext", `p = ${fmt(p, 2)}, beta_t = ${fmt(b, 3)}, k_t = ${ev.k} of ${B}`);
    renderTiles(b, ev);
    renderStrip(wS || 600, ev);
    renderPlot(wP || 400, ev);
    renderRatio(wR || 400, b, evs);
    renderBars(wB || 400, b, evs);
    renderDir(wD || 400, b, evs);
    plotCap.replaceChildren(
      ...rich("This draw: ĝ_t is "), h("b", { class: "demo-num" }, `${fmt(ev.batchAngle, 1)}°`), " from ∇L. Curriculum bias ", ...rich("∠(∇L_t, ∇L) = "),
      h("b", { class: "demo-num" }, `${fmt(ev.biasAngle, 1)}°`), ".");
    barsCap.replaceChildren(...rich("Read across rules at one β_t. Every rule pays the same 1/β_t price for keeping only part of the batch, so the gaps come from the kept set's action and problem variance; the masking term vanishes as β_t → 1."));
    if (state.table) renderTables(b, evs);
  }

  function renderTiles(b, ev) {
    const tile = (lab, val, small, frac, neutral, note) => h("div", { class: "demo-tile" }, [
      h("div", { class: "lab" }, rich(lab)),
      h("div", { class: "val" }, [val, small ? h("small", {}, small) : null]),
      h("div", { class: `demo-track${neutral ? " neutral" : ""}`, "aria-hidden": "true" }, h("span", { style: `width:${(frac * 100).toFixed(1)}%` })),
      note ? h("div", { class: "note" }, rich(note)) : null,
    ]);
    tiles.replaceChildren(
      tile("Retention β_t", fmt(b, 3), null, b, false, "0.2 + 0.8·p"),
      tile("Kept k_t", String(ev.k), `/ ${B}`, ev.k / B, false, "⌈β_t·B⌉"),
      tile("Bias bound", fmt(ev.bound, 2), null, ev.bound / 2, true, "2L_max(1−β_t), Thm 1"),
    );
  }

  // (a) ranked strip
  function renderStrip(W, ev) {
    const H = 104, padL = 26, padR = 4, top = 22, bot = 16, ph = H - top - bot;
    const pitch = (W - padL - padR) / B, bw = Math.min(24, Math.max(2, pitch - 2));
    const svg = svgEl("svg", { class: "demo-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${B} prompts ranked by confidence; ${ev.k} kept by the ${RULES.find((r) => r.key === state.rule).short} rule.` });
    const y = (c) => top + ph * (1 - c);
    for (const v of [0, 0.5, 1]) {
      svgEl("line", { class: v === 0 ? "demo-axisline" : "demo-gridline", x1: padL, x2: W - padR, y1: y(v), y2: y(v) }, svg);
      svgEl("text", { x: padL - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = v === 0.5 ? ".5" : String(v);
    }
    const order = batch.order.conf;
    const bars = order.map((j, r) => {
      const pr = batch.prompts[j], x = padL + r * pitch + (pitch - bw) / 2, hgt = Math.max(1, ph * pr.c);
      return svgEl("path", { d: roundTop(x, top + ph - hgt, bw, hgt, Math.min(3, bw / 2)), class: ev.keptSet.has(j) ? "demo-fill-kept" : "demo-fill-drop" }, svg);
    });
    // threshold marker
    if (state.rule !== "random") {
      const pos = state.rule === "conf" ? ev.k : B - ev.k;
      if (pos > 0 && pos < B) {
        const x = padL + pos * pitch;
        svgEl("line", { class: "demo-thresh", x1: x, x2: x, y1: top - 6, y2: top + ph + 3 }, svg);
        const tau = state.rule === "conf" ? batch.prompts[order[ev.k - 1]].c : null;
        const txt = state.rule === "conf" ? `top k_t = ${ev.k}, τ_t = ${fmt(tau, 2)}` : `bottom k_t = ${ev.k}`;
        const anchor = state.rule === "conf" ? (x > W - 150 ? "end" : "start") : (x < 140 ? "start" : "end");
        svgRich(svgEl("text", { class: "t-2 halo", x: anchor === "start" ? x + 5 : x - 5, y: top - 9, "text-anchor": anchor }, svg), txt);
      }
    } else {
      svgRich(svgEl("text", { class: "t-2", x: padL, y: top - 9 }, svg), `k_t = ${ev.k} kept at random`);
    }
    svgEl("text", { x: padL, y: H - 2 }, svg).textContent = "rank 1";
    svgEl("text", { x: W - padR, y: H - 2, "text-anchor": "end" }, svg).textContent = `rank ${B}`;
    const hit = svgEl("rect", { class: "demo-hit", x: padL, y: top - 4, width: W - padL - padR, height: ph + 8 }, svg);
    let hov = -1;
    hit.addEventListener("pointermove", (e) => {
      const r = Math.max(0, Math.min(B - 1, Math.floor((e.clientX - svg.getBoundingClientRect().left - padL) / pitch)));
      if (hov >= 0) bars[hov].classList.remove("demo-hov");
      hov = r; bars[r].classList.add("demo-hov");
      const j = order[r], pr = batch.prompts[j];
      tip.show(`<b>c = ${fmt(pr.c, 3)}</b><br>prompt #${pr.id} · rank ${r + 1} of ${B}<br>${ev.keptSet.has(j) ? "kept" : "dropped"} · response noise s = ${fmt(pr.s, 2)}`, e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => { if (hov >= 0) bars[hov].classList.remove("demo-hov"); hov = -1; tip.hide(); });
    stripBox.replaceChildren(svg);
  }

  // (b) gradient arrow plot
  function renderPlot(W, ev) {
    const S = Math.min(W, 460), pad = 10, sc = (S / 2 - pad) / R_DOM, cx = S / 2, cy = S / 2;
    const X = (v) => cx + v * sc, Y = (v) => cy - v * sc;
    const svg = svgEl("svg", { class: "demo-svg", width: S, height: S, viewBox: `0 0 ${S} ${S}`, role: "img",
      "aria-label": `Gradient plot: ${ev.k} kept prompts. Batch gradient at ${fmt(ev.batchAngle, 0)} degrees from the full-data gradient.` });
    const clip = svgEl("clipPath", { id: `${id}-clip` }, svgEl("defs", {}, svg));
    svgEl("rect", { x: pad, y: pad, width: S - 2 * pad, height: S - 2 * pad }, clip);
    for (let v = -R_DOM + 1; v < R_DOM; v++) {
      if (v === 0) continue;
      svgEl("line", { class: "demo-gridline", x1: X(v), x2: X(v), y1: pad, y2: S - pad }, svg);
      svgEl("line", { class: "demo-gridline", y1: Y(v), y2: Y(v), x1: pad, x2: S - pad }, svg);
    }
    svgEl("line", { class: "demo-axisline", x1: pad, x2: S - pad, y1: cy, y2: cy }, svg);
    svgEl("line", { class: "demo-axisline", y1: pad, y2: S - pad, x1: cx, x2: cx }, svg);
    svgEl("text", { class: "halo", x: S - pad - 2, y: cy - 6, "text-anchor": "end" }, svg).textContent = "θ₁";
    svgEl("text", { class: "halo", x: cx + 6, y: pad + 11 }, svg).textContent = "θ₂";
    const g = svgEl("g", { "clip-path": `url(#${id}-clip)` }, svg);
    const P = batch.prompts;
    P.forEach((pr, j) => { if (!ev.keptSet.has(j)) svgEl("circle", { class: "demo-fill-drop", cx: X(pr.mu[0]), cy: Y(pr.mu[1]), r: 3 }, g); });
    for (const j of ev.kept) for (const r of P[j].resp) {
      svgEl("line", { class: "demo-respline", x1: cx, y1: cy, x2: X(r[0]), y2: Y(r[1]) }, g);
      svgEl("circle", { class: "demo-resptip", cx: X(r[0]), cy: Y(r[1]), r: 1.8 }, g);
    }
    // full-data direction as a dashed ray to the plot edge
    const f = batch.full, fl = Math.hypot(...f), ux = f[0] / fl, uy = f[1] / fl, tmax = (R_DOM - 0.12) / Math.max(Math.abs(ux), Math.abs(uy));
    svgEl("line", { class: "demo-ref", x1: cx, y1: cy, x2: X(ux * tmax), y2: Y(uy * tmax) }, g);
    for (const j of ev.kept) svgEl("circle", { class: "demo-fill-kept demo-ring", cx: X(P[j].mu[0]), cy: Y(P[j].mu[1]), r: 4 }, g);
    // bold batch gradient with a surface halo
    const gx = ev.ghat[0], gy = ev.ghat[1], gl = Math.hypot(gx, gy) * sc;
    if (gl > 2) {
      const ax = X(gx), ay = Y(gy), dx = (ax - cx) / gl, dy = (ay - cy) / gl, hl = Math.min(11, gl * 0.6), bx = ax - dx * hl, by = ay - dy * hl;
      svgEl("line", { x1: cx, y1: cy, x2: bx, y2: by, stroke: "var(--surface-1)", "stroke-width": 7, "stroke-linecap": "round" }, g);
      svgEl("line", { class: "demo-stroke-ink", x1: cx, y1: cy, x2: bx, y2: by, "stroke-width": 3, "stroke-linecap": "round" }, g);
      const pts = [[ax, ay], [bx - dy * 5.5, by + dx * 5.5], [bx + dy * 5.5, by - dx * 5.5]].map((q) => q.join(",")).join(" ");
      svgEl("polygon", { points: pts, class: "demo-fill-ink demo-ring", "stroke-linejoin": "round" }, g);
      const lx = ax + dx * 10 - dy * 12, ly = ay + dy * 10 + dx * 12;
      svgRich(svgEl("text", { class: "t-1 halo", x: lx, y: ly + 4, "text-anchor": lx < ax - 2 ? "end" : "start" }, svg), "ĝ_t");
    }
    const ex = X(ux * tmax), ey = Y(uy * tmax);
    svgEl("text", { class: "t-2 halo", x: ex + (ux > 0 ? -4 : 4), y: ey + (uy > 0 ? 14 : -6), "text-anchor": ux > 0 ? "end" : "start" }, svg).textContent = "∇L";
    // hover: nearest prompt mean (or the batch-gradient tip)
    const hit = svgEl("rect", { class: "demo-hit", x: 0, y: 0, width: S, height: S }, svg);
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 18 * 18;
      P.forEach((pr, j) => { const d = (X(pr.mu[0]) - mx) ** 2 + (Y(pr.mu[1]) - my) ** 2; if (d < bd) { bd = d; best = j; } });
      const dg = (X(gx) - mx) ** 2 + (Y(gy) - my) ** 2;
      if (dg < bd) {
        tip.show(`<b>${fmt(ev.batchAngle, 1)}°</b> from ∇L<br>batch gradient ĝ_t = (${fmt(gx, 2)}, ${fmt(gy, 2)})<br>mean of ${ev.k} kept prompts × ${G} responses`, e.clientX, e.clientY);
      } else if (best !== null) {
        const pr = P[best];
        tip.show(`<b>c = ${fmt(pr.c, 3)}</b><br>prompt #${pr.id} · ${ev.keptSet.has(best) ? "kept" : "dropped"}<br>ḡ(x) = (${fmt(pr.mu[0], 2)}, ${fmt(pr.mu[1], 2)}) · noise s = ${fmt(pr.s, 2)}`, e.clientX, e.clientY);
      } else tip.hide();
    });
    hit.addEventListener("pointerleave", () => tip.hide());
    plotBox.replaceChildren(svg);
  }

  // (c1) headline: kept-set variance relative to the full batch (mirrors the paper's Fig. 3)
  function renderRatio(W, b, evs) {
    const narrow = W < 420, labW = narrow ? 100 : 120, valW = 44, gh = 22, rowH = 22, bh = 10, top = 18, gap = 8, bot = 20;
    const GROUPS = [
      { key: "ratioAction", raw: "sigma2", name: "Action variance σ²_g,t", short: "action variance" },
      { key: "ratioProblem", raw: "vprob", name: "Problem variance V_prob,t", short: "problem variance" },
    ];
    const H = top + GROUPS.length * (gh + rowH * RULES.length) + gap + bot, bwid = Math.max(40, W - labW - valW);
    const X = (v) => labW + (Math.min(v, rdom) / rdom) * bwid;
    const yEnd = H - bot + 2;
    const svg = svgEl("svg", { class: "demo-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Kept-set variance divided by full-batch variance at beta_t ${fmt(b, 3)}: ` +
        RULES.map((r) => `${r.short} action ${fmt(evs[r.key].ratioAction, 2)}, problem ${fmt(evs[r.key].ratioProblem, 2)}`).join("; ") + "." });
    for (let t = 0; t <= rdom + 1e-9; t += 0.5) {
      svgEl("line", { class: t === 0 ? "demo-axisline" : "demo-gridline", x1: X(t), x2: X(t), y1: top, y2: yEnd }, svg);
      svgEl("text", { x: X(t), y: H - 6, "text-anchor": "middle" }, svg).textContent = fmtTick(t);
    }
    let y = top;
    GROUPS.forEach((g, gi) => {
      svgRich(svgEl("text", { class: "t-1", x: 0, y: y + 15 }, svg), g.name);
      y += gh;
      RULES.forEach((r) => {
        const e = evs[r.key], v = e[g.key], sel = r.key === state.rule, yb = y + (rowH - bh) / 2;
        if (sel) svgEl("rect", { class: "demo-rowband", x: 0, y: y + 1, width: W, height: rowH - 2, rx: 5 }, svg);
        svgEl("text", { class: sel ? "t-1" : "t-2", x: 8, y: y + rowH / 2 + 4 }, svg).textContent = r.short;
        const w = Math.max(1, X(v) - labW);
        const bar = svgEl("path", { d: roundRight(labW, yb, w, bh, Math.min(4, w)), class: r.key === "conf" ? "demo-fill-kept" : "demo-fill-muted" }, svg);
        svgEl("text", { class: "t-val halo", x: labW + w + 6, y: y + rowH / 2 + 4 }, svg).textContent = fmt(v, 2);
        const hit = svgEl("rect", { class: "demo-hit", x: 0, y, width: W, height: rowH }, svg);
        hit.addEventListener("pointermove", (ev2) => {
          bar.classList.add("demo-hov");
          tip.show(`<b>${fmt(v, 2)}×</b> full-batch ${g.short}<br>${r.short} kept set · β_t = ${fmt(b, 3)} · k_t = ${e.k}<br>${fmt(e[g.raw], 3)} kept vs. ${fmt(batch.varFull[g.raw], 3)} full batch`, ev2.clientX, ev2.clientY);
        });
        hit.addEventListener("pointerleave", () => { bar.classList.remove("demo-hov"); tip.hide(); });
        y += rowH;
      });
      if (gi < GROUPS.length - 1) y += gap;
    });
    const x1 = X(1);
    svgEl("line", { class: "demo-ref", x1, x2: x1, y1: top - 4, y2: yEnd }, svg);
    svgEl("text", { class: "halo", x: x1 + 4, y: top - 6 }, svg).textContent = "full batch = 1";
    ratioBox.replaceChildren(svg);
  }

  // (c) Theorem 2 stacked bars, one row per rule
  function renderBars(W, b, evs) {
    const narrow = W < 420, labW = narrow ? 100 : 120, valW = 42, top = 6, rowH = 32, bh = 16, bot = 22;
    const H = top + rowH * RULES.length + bot, x0 = labW, bwid = Math.max(40, W - labW - valW);
    const X = (v) => x0 + (v / domain) * bwid;
    const svg = svgEl("svg", { class: "demo-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Theorem 2 variance at beta_t ${fmt(b, 3)}: ` + RULES.map((r) => `${r.short} total ${fmt(evs[r.key].total, 2)}`).join("; ") + "." });
    const ticks = niceTicks(domain);
    for (const t of ticks) {
      svgEl("line", { class: t === 0 ? "demo-axisline" : "demo-gridline", x1: X(t), x2: X(t), y1: top - 2, y2: top + rowH * RULES.length }, svg);
      svgEl("text", { x: X(t), y: H - 6, "text-anchor": "middle", class: "demo-num" }, svg).textContent = fmtTick(t);
    }
    const segs = [];
    RULES.forEach((r, i) => {
      const e = evs[r.key], yr = top + i * rowH, yb = yr + (rowH - bh) / 2, sel = r.key === state.rule;
      if (sel) svgEl("rect", { class: "demo-rowband", x: 0, y: yr + 1, width: W, height: rowH - 2, rx: 6 }, svg);
      svgEl("text", { class: sel ? "t-1" : "t-2", x: 8, y: yr + rowH / 2 + 4 }, svg).textContent = r.short;
      const parts = TERMS.map((t) => ({ t, v: e[t.key] })).filter((q) => q.v * bwid / domain >= 0.5);
      let acc = 0;
      parts.forEach((q, k) => {
        const xa = X(acc), xb = X(acc + q.v), lastSeg = k === parts.length - 1, w = Math.max(0.5, xb - xa - (lastSeg ? 0 : 2));
        const el = svgEl("path", { class: q.t.cls, d: lastSeg ? roundRight(xa, yb, w, bh, Math.min(4, w)) : `M${xa},${yb}h${w}v${bh}h${-w}z` }, svg);
        segs.push({ el, row: i, key: q.t.key, html: `<b>${fmt(q.v, 2)}</b> ${q.t.name.toLowerCase()} term ${q.t.tex}<br>${r.short} · β_t = ${fmt(b, 3)} · k_t = ${e.k}` });
        acc += q.v;
      });
      svgEl("text", { class: "t-val", x: X(e.total) + 6, y: yr + rowH / 2 + 4 }, svg).textContent = fmt(e.total, 2);
      const hitRow = svgEl("rect", { class: "demo-hit", x: x0, y: yr, width: bwid + valW, height: rowH }, svg);
      hitRow.addEventListener("pointermove", (ev2) => {
        const mx = ev2.clientX - svg.getBoundingClientRect().left;
        let a = 0, pick = null;
        for (const q of parts) { if (mx <= X(a + q.v) + 1) { pick = q; break; } a += q.v; }
        segs.forEach((s) => s.el.classList.remove("demo-hov"));
        if (!pick) { tip.show(`<b>${fmt(e.total, 2)}</b> total Var(ĝ_t)<br>${r.short} · β_t = ${fmt(b, 3)}`, ev2.clientX, ev2.clientY); return; }
        const s = segs.find((z) => z.key === pick.t.key && z.row === i);
        if (s) { s.el.classList.add("demo-hov"); tip.show(s.html + `<br>total ${fmt(e.total, 2)}`, ev2.clientX, ev2.clientY); }
      });
      hitRow.addEventListener("pointerleave", () => { segs.forEach((s) => s.el.classList.remove("demo-hov")); tip.hide(); });
    });
    barsBox.replaceChildren(svg);
  }

  // (d) direction error per rule (emphasis: VI-CuRL in accent, other rules in gray)
  function renderDir(W, b, evs) {
    const narrow = W < 420, labW = narrow ? 100 : 120, valW = 48, rowH = 28, bh = 12, top = 2, bot = 20;
    const H = top + rowH * RULES.length + bot, bwid = Math.max(40, W - labW - valW);
    const vmax = Math.max(...RULES.map((r) => evs[r.key].dirErr)), dom = vmax > 90 ? 180 : 90;
    const X = (v) => labW + (Math.min(v, dom) / dom) * bwid;
    const svg = svgEl("svg", { class: "demo-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": "Mean angle between the batch gradient and the full-data gradient: " + RULES.map((r) => `${r.short} ${fmt(evs[r.key].dirErr, 1)} degrees`).join("; ") + "." });
    for (let t = 0; t <= dom; t += dom / 3) {
      svgEl("line", { class: t === 0 ? "demo-axisline" : "demo-gridline", x1: X(t), x2: X(t), y1: top, y2: top + rowH * RULES.length }, svg);
      svgEl("text", { x: X(t), y: H - 6, "text-anchor": "middle" }, svg).textContent = `${t}°`;
    }
    RULES.forEach((r, i) => {
      const e = evs[r.key], yr = top + i * rowH, yb = yr + (rowH - bh) / 2, sel = r.key === state.rule;
      if (sel) svgEl("rect", { class: "demo-rowband", x: 0, y: yr + 1, width: W, height: rowH - 2, rx: 6 }, svg);
      svgEl("text", { class: sel ? "t-1" : "t-2", x: 8, y: yr + rowH / 2 + 4 }, svg).textContent = r.short;
      const w = Math.max(1, X(e.dirErr) - labW);
      const bar = svgEl("path", { d: roundRight(labW, yb, w, bh, Math.min(4, w)), class: r.key === "conf" ? "demo-fill-kept" : "demo-fill-muted" }, svg);
      svgEl("text", { class: "t-val", x: labW + w + 6, y: yr + rowH / 2 + 4 }, svg).textContent = `${fmt(e.dirErr, 1)}°`;
      const hit = svgEl("rect", { class: "demo-hit", x: 0, y: yr, width: W, height: rowH }, svg);
      hit.addEventListener("pointermove", (ev2) => {
        bar.classList.add("demo-hov");
        tip.show(`<b>${fmt(e.dirErr, 1)}°</b> mean angle to ∇L<br>${r.short} · β_t = ${fmt(b, 3)} · k_t = ${e.k}<br>bias alone ∠(∇L_t, ∇L) = ${fmt(e.biasAngle, 1)}°`, ev2.clientX, ev2.clientY);
      });
      hit.addEventListener("pointerleave", () => { bar.classList.remove("demo-hov"); tip.hide(); });
    });
    dirBox.replaceChildren(svg);
  }

  function renderTables(b, evs) {
    const full = batch.varFull;
    const head = ["Rule", "k_t", "σ²_g,t", "V_prob,t", "Action", "Problem", "Masking", "Total", "Action kept/full", "Problem kept/full", "∠(∇L_t, ∇L)", "Mean ∠(ĝ_t, ∇L)"];
    const rowsT = RULES.map((r) => {
      const e = evs[r.key];
      return h("tr", { class: r.key === "conf" ? "ours" : null }, [h("td", {}, r.short), h("td", {}, String(e.k)),
        ...[e.sigma2, e.vprob, e.action, e.problem, e.masking, e.total, e.ratioAction, e.ratioProblem].map((v) => h("td", {}, fmt(v, 3))),
        h("td", {}, `${fmt(e.biasAngle, 1)}°`), h("td", {}, `${fmt(e.dirErr, 1)}°`)]);
    });
    rowsT.push(h("tr", {}, [h("td", {}, "Full batch (ratio reference)"), h("td", {}, String(B)),
      h("td", {}, fmt(full.sigma2, 3)), h("td", {}, fmt(full.vprob, 3)), ...[0, 1, 2, 3].map(() => h("td", {}, "–")),
      h("td", {}, "1.000"), h("td", {}, "1.000"), h("td", {}, "–"), h("td", {}, "–")]));
    const cap1 = `Theorem 2 terms at p = ${fmt(state.n / STEPS, 2)}, β_t = ${fmt(b, 3)}; bias bound 2L_max(1−β_t) = ${fmt(evs.conf.bound, 3)} with L_max = 1`;
    const t1 = h("div", { class: "table-wrap" }, h("table", { class: "data" }, [
      h("caption", { class: "sr-only" }, cap1),
      h("thead", {}, h("tr", {}, head.map((c) => h("th", { scope: "col" }, rich(c))))), h("tbody", {}, rowsT)]));
    const ev = evs[state.rule];
    const prow = batch.order.conf.map((j, r) => {
      const pr = batch.prompts[j];
      return h("tr", {}, [h("td", {}, String(r + 1)), h("td", {}, `#${pr.id}`), h("td", {}, fmt(pr.c, 3)), h("td", {}, ev.keptSet.has(j) ? "kept" : "dropped"),
        h("td", {}, fmt(pr.s, 3)), h("td", {}, `(${fmt(pr.mu[0], 3)}, ${fmt(pr.mu[1], 3)})`), h("td", {}, `(${fmt(pr.gbar[0], 3)}, ${fmt(pr.gbar[1], 3)})`)]);
    });
    const cap2 = `Prompts in this batch (rule: ${RULES.find((r) => r.key === state.rule).short}); ĝ_t = (${fmt(ev.ghat[0], 3)}, ${fmt(ev.ghat[1], 3)}), ∇L = (${fmt(batch.full[0], 3)}, ${fmt(batch.full[1], 3)})`;
    const t2 = h("div", { class: "table-wrap" }, h("table", { class: "data" }, [
      h("caption", { class: "sr-only" }, cap2),
      h("thead", {}, h("tr", {}, ["Rank", "Prompt", "c(x)", "Status", "Noise s", "ḡ(x)", `Mean of ${G} responses`].map((c) => h("th", { scope: "col" }, c)))),
      h("tbody", {}, prow)]));
    tables.replaceChildren(h("div", { class: "demo-tcap", "aria-hidden": "true" }, rich(cap1)), t1,
      h("div", { class: "demo-tcap", "aria-hidden": "true" }, rich(cap2)), t2);
  }

  newBatch();
  renderPlay();
  render();
  onResize(root, () => render());
  onThemeChange(() => render());
}

const beta = (n) => 0.2 + (0.8 * n) / STEPS;

function icon(playing) {
  const s = svgEl("svg", { viewBox: "0 0 12 12", "aria-hidden": "true" });
  if (playing) { svgEl("rect", { x: 2, y: 1.5, width: 3, height: 9, rx: 0.8 }, s); svgEl("rect", { x: 7, y: 1.5, width: 3, height: 9, rx: 0.8 }, s); }
  else svgEl("path", { d: "M3 1.5v9l7.5-4.5z" }, s);
  return s;
}

function roundTop(x, y, w, hgt, r) {
  r = Math.min(r, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}
function roundRight(x, y, w, hgt, r) {
  r = Math.min(r, w, hgt / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x}Z`;
}
function niceStep(max) {
  const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
function niceMax(max) { const s = niceStep(max); return Math.ceil(max / s) * s; }
function niceTicks(max) { const s = niceStep(max), out = []; for (let v = 0; v <= max + 1e-9; v += s) out.push(+v.toFixed(6)); return out; }
const fmtTick = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));
