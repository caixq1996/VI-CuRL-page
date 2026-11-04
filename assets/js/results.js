// Results widgets for the VI-CuRL page (Agent B). Every number comes from assets/data/results.json.
import { h, onThemeChange, onResize, createTooltip, fmt, loadResults } from "./viz-common.js";
import {
  SETTINGS, SETTING_LABEL, SETTING_SUB, METRIC_LABEL, esc, diff1, signed, pm,
  header, segCtl, selectCtl, tableToggle, buildTable, tipHTML,
} from "./results/shared.js";
import { renderBars } from "./results/bars.js";
import { renderSlope } from "./results/slope.js";

const renderers = [];
function register(host, fn) {
  renderers.push(fn);
  onResize(host, () => fn(false));
  fn(false);
}

const legendItem = (kind, text) => h("span", { class: "res-lg" }, [h("span", { class: `res-key res-key-${kind}`, "aria-hidden": "true" }), text]);
const chartLegend = (withRef = true, withStd = true) =>
  h("div", { class: "legend res-legend" }, [
    legendItem("ours", "VI-CuRL"),
    legendItem("muted", "Baselines"),
    withRef ? legendItem("ref", "Base model (no RL)") : null,
    withStd ? legendItem("err", "±1 std (5 seeds)") : null,
  ]);
const footer = (caption, btn) => h("div", { class: "res-foot" }, [h("p", { class: "figcap" }, caption), btn]);
const derived = (children) => h("p", { class: "res-summary", "aria-live": "polite" }, [h("span", { class: "res-derived" }, "Derived"), ...children]);

/* ====================================================================== */
/* 1 + 2: grouped bar widget (math explorer and general knowledge)          */
/* ====================================================================== */
function barWidget(card, data, cfg) {
  const benches = data.benchmarks[cfg.domain];
  const st = { model: cfg.models[0], metric: cfg.metrics[0], reward: cfg.defaultReward, bench: "avg" };
  const tip = createTooltip(card);
  header(card, cfg.title, cfg.desc);

  const controls = h("div", { class: "controls res-controls" });
  if (cfg.models.length > 1) controls.appendChild(selectCtl("Model", cfg.models.map((m) => ({ value: m, label: m })), st.model, (v) => { st.model = v; update(); }));
  if (cfg.metrics.length > 1) controls.appendChild(segCtl("Metric", cfg.metrics.map((m) => ({ value: m, label: METRIC_LABEL[m] })), st.metric, (v) => { st.metric = v; update(); }));
  controls.appendChild(segCtl("Reward", cfg.rewards, st.reward, (v) => { st.reward = v; update(); }));
  controls.appendChild(selectCtl("Benchmark", [{ value: "avg", label: `Average (${benches.length})` }, ...benches.map((b) => ({ value: b, label: b }))], st.bench, (v) => { st.bench = v; update(); }));
  const panel = h("div", { class: "res-table-panel" });
  card.appendChild(controls);
  card.appendChild(chartLegend());
  const host = h("div", { class: "res-chart" });
  card.appendChild(host);
  const summary = h("div", { class: "res-summary-wrap" });
  card.appendChild(summary);
  card.appendChild(footer(cfg.caption, tableToggle(panel)));
  card.appendChild(panel);

  const rowsFor = () => data.rows.filter((r) => r.domain === cfg.domain && r.metric === st.metric && r.model === st.model);
  const val = (r) => (st.bench === "avg" ? r.avg : r.scores[st.bench]);
  const benchLabel = () => (st.bench === "avg" ? `Average of ${benches.length} benchmarks` : st.bench);

  function draw(animate) {
    const rows = rowsFor();
    const base = rows.find((r) => r.setting === "base");
    const settings = st.reward === "all" ? ["oracle", "majority_vote", "entropy"] : [st.reward];
    const M = METRIC_LABEL[st.metric];
    const groups = settings.map((s) => ({
      key: s, label: SETTING_LABEL[s], sub: SETTING_SUB[s],
      items: rows.filter((r) => r.setting === s).map((r) => {
        const [mean, std] = val(r);
        return {
          label: r.method, mean, std, ours: r.ours,
          aria: `${r.method}, ${SETTING_LABEL[s]}: ${pm(mean, std)} percent`,
          tip: () => tipHTML({
            value: `${fmt(mean)}% <span class="res-tt-std">± ${fmt(std)}</span>`,
            name: r.method, key: r.ours ? "ours" : "muted",
            meta: [esc(data.notes.settings[s] || SETTING_LABEL[s]), `${esc(st.model)} · ${esc(benchLabel())} · ${M}`],
          }),
        };
      }),
    }));
    // derived: VI-CuRL minus the best baseline, from the shown means only
    const parts = groups.map((g) => {
      const ours = g.items.find((d) => d.ours);
      const others = g.items.filter((d) => !d.ours);
      const best = others.reduce((a, b) => (b.mean > a.mean ? b : a), others[0]);
      return { g, ours, best, d: diff1(ours.mean, best.mean) };
    });
    summary.textContent = "";
    if (parts.length === 1) {
      const p = parts[0];
      summary.appendChild(derived([
        "VI-CuRL vs best baseline in this setting (", p.best.label, "): ",
        h("b", {}, `${signed(p.d)} points`), h("span", { class: "muted" }, ` (${fmt(p.ours.mean)} vs ${fmt(p.best.mean)})`),
      ]));
    } else {
      const kids = ["VI-CuRL vs best baseline, per setting: "];
      parts.forEach((p, i) => {
        if (i) kids.push(h("span", { class: "res-dot-sep", "aria-hidden": "true" }, " · "));
        kids.push(`${p.g.label} `, h("b", {}, signed(p.d)), h("span", { class: "muted" }, ` (vs ${p.best.label})`));
      });
      kids.push(" points");
      summary.appendChild(derived(kids));
    }
    const aria = `${M} on ${benchLabel()} for ${st.model}. ` +
      parts.map((p) => `${p.g.label}: VI-CuRL ${fmt(p.ours.mean)}, best baseline ${p.best.label} ${fmt(p.best.mean)}`).join("; ") +
      (base ? `. Base model ${fmt(val(base)[0])}.` : ".");
    renderBars(host, {
      groups, groupLabels: true,
      ref: base ? { value: val(base)[0], label: "Base model" } : null,
      axisLabel: `${M} (%)`, aria, tip, animate,
    });
  }

  function drawTable() {
    const rows = rowsFor();
    const M = METRIC_LABEL[st.metric];
    const blocks = SETTINGS.map((s) => ({
      label: s === "base" ? null : `${SETTING_LABEL[s]} (${SETTING_SUB[s]})`,
      rows: rows.filter((r) => r.setting === s).map((r) => ({
        head: r.setting === "base" ? "Base model (no RL)" : r.method, ours: r.ours,
        cells: [...benches.map((b) => ({ v: r.scores[b][0], s: r.scores[b][1] })), { v: r.avg[0], s: r.avg[1] }],
      })),
    })).filter((b) => b.rows.length);
    panel.textContent = "";
    panel.appendChild(buildTable({
      caption: `${M} (%) for ${st.model}, mean ± std over 5 seeds. Bold: best mean within each reward setting.`,
      cols: ["Method", ...benches, "Average"], blocks, sticky: true,
    }));
  }

  let lastKey = "";
  function update(animate = true) {
    draw(animate);
    const key = st.model + st.metric;
    if (key !== lastKey) { drawTable(); lastKey = key; }
  }
  update(false);
  register(host, (anim) => draw(anim));
}

/* ====================================================================== */
/* 3: curriculum-control ablation                                          */
/* ====================================================================== */
const ABL_LABEL = {
  "RENT / No Curriculum": "No curriculum (RENT)",
  "RENT / Length-First Filter": "Shortest responses first",
  "RENT / Random Filter": "Random subset",
  "RENT / Reverse-Confidence": "Least confident first",
  "VI-CuRL / RENT": "VI-CuRL (most confident first)",
};

function ablationWidget(card, data) {
  const A = data.ablation, benches = data.benchmarks.math;
  const st = { metric: "pass1", bench: "avg" };
  const tip = createTooltip(card);
  header(card, "Is it just filtering? Curriculum controls", "Swap VI-CuRL's confidence ranking for other rules that pick which prompts to train on.");
  const panel = h("div", { class: "res-table-panel" });
  const controls = h("div", { class: "controls res-controls" }, [
    segCtl("Metric", [{ value: "pass1", label: "Pass@1" }, { value: "pass8", label: "Pass@8" }], st.metric, (v) => { st.metric = v; draw(true); }),
    selectCtl("Benchmark", [{ value: "avg", label: `Average (${benches.length})` }, ...benches.map((b) => ({ value: b, label: b }))], st.bench, (v) => { st.bench = v; draw(true); }),
  ]);
  card.appendChild(controls);
  const host = h("div", { class: "res-chart" });
  const summary = h("div", { class: "res-summary-wrap" });
  card.append(host, summary, footer(`${A.model}, entropy (RENT) reward. The paper reports single values (no std) for this table.`, tableToggle(panel)), panel);

  function draw(animate) {
    const M = st.metric === "pass1" ? "Pass@1" : "Pass@8";
    const bl = st.bench === "avg" ? `Average of ${benches.length} benchmarks` : st.bench;
    const v = (r) => (st.bench === "avg" ? r[`${st.metric}_avg`] : r[st.metric][st.bench]);
    const items = A.rows.map((r) => ({
      label: ABL_LABEL[r.setting] || r.setting, mean: v(r), std: 0, ours: r.ours,
      aria: `${ABL_LABEL[r.setting] || r.setting}: ${fmt(v(r))} percent`,
      tip: () => tipHTML({
        value: `${fmt(v(r))}%`, name: ABL_LABEL[r.setting] || r.setting, key: r.ours ? "ours" : "muted",
        meta: [`Paper name: ${esc(r.setting)}`, `${esc(bl)} · ${M}`, `${esc(A.model)}, RENT reward`],
      }),
    }));
    const ours = items.find((d) => d.ours), others = items.filter((d) => !d.ours);
    const best = others.reduce((a, b) => (b.mean > a.mean ? b : a), others[0]);
    summary.textContent = "";
    summary.appendChild(derived(["VI-CuRL vs best other rule (", best.label, "): ", h("b", {}, `${signed(diff1(ours.mean, best.mean))} points`)]));
    renderBars(host, {
      groups: [{ items }], groupLabels: false, ref: null, orient: "h", barThickness: 16,
      axisLabel: `${M} (%) · ${bl}`, tip, animate,
      aria: `Horizontal bar chart, ${M} on ${bl}: ` + items.map((d) => `${d.label} ${fmt(d.mean)}`).join(", "),
    });
  }
  const cells = (r, m) => [...benches.map((b) => ({ v: r[m][b] })), { v: r[`${m}_avg`] }];
  panel.appendChild(buildTable({
    caption: `${A.model}, RENT reward. Bold: best value within each metric.`,
    cols: ["Setting", ...benches, "Average"],
    blocks: [["Pass@1", "pass1"], ["Pass@8", "pass8"]].map(([lab, m]) => ({ label: lab, rows: A.rows.map((r) => ({ head: r.setting, ours: r.ours, cells: cells(r, m) })) })),
  }));
  register(host, draw);
}

/* ====================================================================== */
/* 4: mechanism (slope chart)                                              */
/* ====================================================================== */
const MECH = {
  "RENT / No Curriculum": { short: "No curriculum", long: "No curriculum (RENT)", dash: "7 4" },
  "RENT / Static Conf. Filter": { short: "Static filter", long: "Static confidence filter (β = 0.2)", dash: "1 4" },
  "RENT / Soft Conf. Weighting": { short: "Soft weighting", long: "Soft confidence weighting", dash: "10 3 2 3" },
  "VI-CuRL / RENT": { short: "VI-CuRL", long: "VI-CuRL (annealed)", dash: null },
};

function mechanismWidget(card, data) {
  const Mx = data.mechanism, benches = data.benchmarks.math;
  const tip = createTooltip(card);
  header(card, "Why annealing matters", `Average Pass@1 at step ${Mx.t_ref_step} and step ${Mx.t_long_step}: static and soft confidence filters decay, while the annealed curriculum holds.`);
  const panel = h("div", { class: "res-table-panel" });
  const legend = h("div", { class: "legend res-legend" }, Mx.summary.map((s) => {
    const m = MECH[s.setting] || { long: s.setting };
    const key = h("span", { class: `res-key res-key-line${s.ours ? " ours" : ""}`, "aria-hidden": "true" });
    key.innerHTML = `<svg width="26" height="10" viewBox="0 0 26 10"><line x1="1" y1="5" x2="25" y2="5"${m.dash ? ` stroke-dasharray="${m.dash}"` : ""}/></svg>`;
    return h("span", { class: "res-lg" }, [key, m.long]);
  }));
  card.appendChild(legend);
  const host = h("div", { class: "res-chart" });
  card.append(host, footer(`Entropy (RENT) reward, ${Mx.rollouts} rollouts. AULC normalized to RENT / No Curriculum = 1.0. Hover a line for best Pass@1, change and AULC.`, tableToggle(panel)), panel);

  const series = Mx.summary.map((s) => {
    const m = MECH[s.setting] || { short: s.setting, long: s.setting, dash: null };
    return {
      name: s.setting, short: m.short, a: s.p1_tref, b: s.p1_tlong, ours: s.ours, dash: m.dash,
      aria: `${m.long}: ${fmt(s.p1_tref)} at step ${Mx.t_ref_step}, ${fmt(s.p1_tlong)} at step ${Mx.t_long_step}`,
      tip: () => tipHTML({
        value: `${fmt(s.p1_tref)} → ${fmt(s.p1_tlong)}`, name: m.long, key: s.ours ? "ours" : "muted",
        meta: [
          `Avg Pass@1 (%), step ${Mx.t_ref_step} → ${Mx.t_long_step}`,
          `Change: <b>${signed(s.change)}</b>`,
          `Best Pass@1: <b>${fmt(s.best_p1)}</b>`,
          `AULC: <b>${fmt(s.aulc)}</b> (No curriculum = 1.0)`,
          `Paper name: ${esc(s.setting)}`,
        ],
      }),
    };
  });
  const draw = () => renderSlope(host, {
    series, tip, axisLabel: "Average Pass@1 (%)",
    xLabels: [[`Step ${Mx.t_ref_step}`, "T_ref"], [`Step ${Mx.t_long_step}`, "T_long"]],
    aria: `Slope chart of average Pass@1 from step ${Mx.t_ref_step} to ${Mx.t_long_step}: ` + series.map((s) => `${s.short} ${fmt(s.a)} to ${fmt(s.b)}`).join("; "),
  });
  panel.append(
    buildTable({
      caption: `Summary. Change = Pass@1 at T_long minus T_ref (the paper's "Upgration" column). Bold: best per column.`,
      cols: ["Setting", `P@1 @ step ${Mx.t_ref_step}`, `P@1 @ step ${Mx.t_long_step}`, "Best P@1", "Change", "AULC"],
      blocks: [{ rows: Mx.summary.map((s) => ({ head: s.setting, ours: s.ours, cells: [{ v: s.p1_tref }, { v: s.p1_tlong }, { v: s.best_p1 }, { v: s.change }, { v: s.aulc }] })) }],
    }),
    buildTable({
      caption: `Per-benchmark Pass@1 at T_long (step ${Mx.t_long_step}).`,
      cols: ["Setting", ...benches],
      blocks: [{ rows: Mx.breakdown_tlong.map((s) => ({ head: s.setting, ours: s.ours, cells: benches.map((b) => ({ v: s.pass1_tlong[b] })) })) }],
    }),
  );
  // the change column: show the sign explicitly
  panel.querySelectorAll("table")[0].querySelectorAll("tbody tr").forEach((tr, i) => {
    const td = tr.children[5];
    if (td) td.textContent = signed(Mx.summary[i].change);
  });
  register(host, draw);
}

/* ====================================================================== */
/* 5: long-output robustness                                               */
/* ====================================================================== */
function longOutputWidget(card, data) {
  const L = data.long_output, benches = data.benchmarks.math;
  const tip = createTooltip(card);
  header(card, "Robustness to longer outputs", "Raising the generation cap from 3,072 to 8,192 tokens changes average Pass@1 by less than one point for either method.");
  const panel = h("div", { class: "res-table-panel" });
  const tokens = (n) => n.toLocaleString("en-US");
  const settings = [...new Set(L.accuracy.map((a) => a.setting))];
  const isOurs = (s) => /VI-CuRL/.test(s);
  const nice = (s) => (isOurs(s) ? "VI-CuRL" : `${s} (no curriculum)`);
  const caps = [...new Set(L.accuracy.map((a) => a.max_new_tokens))].sort((a, b) => a - b);
  const host = h("div", { class: "res-chart" });
  const summary = h("div", { class: "res-summary-wrap" });
  const lenTable = buildTable({
    caption: "Output-length statistics (tokens)",
    cols: ["Setting", "Cap", "Cap-hit", "No-boxed", "Mean", "P90"], best: false,
    blocks: [{ rows: L.length_stats.map((r) => ({ head: isOurs(r.setting) ? "VI-CuRL" : r.setting, ours: isOurs(r.setting), cells: [tokens(r.max_new_tokens), `${fmt(r.cap_hit_pct)}%`, `${fmt(r.no_boxed_pct)}%`, tokens(r.mean_len), tokens(r.p90_len)] })) }],
  });
  card.appendChild(h("div", { class: "legend res-legend" }, [legendItem("ours", "VI-CuRL"), legendItem("muted", "RENT")]));
  card.appendChild(h("div", { class: "res-lo-grid" }, [h("div", { class: "res-lo-chart" }, [host, summary]), h("div", { class: "res-lo-table" }, lenTable)]));
  card.append(footer(`${L.model}, RENT reward. ${tokens(caps[0])} tokens is the paper's default max_new_tokens. Cap-hit: responses that hit the token cap; no-boxed: responses without a \\boxed{} answer.`, tableToggle(panel)), panel);

  const groups = settings.map((s) => ({
    label: nice(s),
    items: caps.map((c) => {
      const a = L.accuracy.find((x) => x.setting === s && x.max_new_tokens === c);
      return {
        label: `${tokens(c)} tokens`, sublabel: c === caps[0] ? "default" : null, mean: a.avg, std: 0, ours: isOurs(s),
        aria: `${s}, max_new_tokens ${c}: average Pass@1 ${fmt(a.avg)} percent`,
        tip: () => tipHTML({
          value: `${fmt(a.avg)}%`, name: s, key: isOurs(s) ? "ours" : "muted",
          meta: [`max_new_tokens = ${tokens(c)}`, `Average Pass@1 over ${benches.length} benchmarks`],
        }),
      };
    }),
  }));
  const deltas = groups.map((g) => ({ g, d: diff1(g.items[g.items.length - 1].mean, g.items[0].mean) }));
  summary.appendChild(derived([
    `${tokens(caps[0])} → ${tokens(caps[caps.length - 1])} tokens: `,
    ...deltas.flatMap((x, i) => [i ? ", " : "", h("b", {}, signed(x.d)), ` (${isOurs(x.g.label) ? "VI-CuRL" : "RENT"})`]),
    " points",
  ]));
  const draw = (animate) => renderBars(host, {
    groups, groupLabels: true, ref: null, orient: "h", barThickness: 14, axisLabel: "Average Pass@1 (%)", tip, animate,
    aria: "Average Pass@1 by max_new_tokens: " + groups.map((g) => `${g.label} ${g.items.map((d) => `${d.label} ${fmt(d.mean)}`).join(", ")}`).join("; "),
  });
  panel.appendChild(buildTable({
    caption: "Pass@1 (%) by benchmark. Bold: best per column.",
    cols: ["Setting", "Max tokens", ...benches, "Average"],
    blocks: [{ rows: L.accuracy.map((a) => ({ head: a.setting, ours: isOurs(a.setting), cells: [tokens(a.max_new_tokens), ...benches.map((b) => ({ v: a.pass1[b] })), { v: a.avg }] })) }],
  }));
  register(host, draw);
}

/* ====================================================================== */
function init(data) {
  const W = (id, fn) => { const el = document.getElementById(id); if (el) { try { fn(el); } catch (e) { console.error(`[results] ${id}:`, e); } } };
  const allRewards = [
    { value: "oracle", label: "Oracle verifier" }, { value: "majority_vote", label: "Majority vote" },
    { value: "entropy", label: "Entropy" }, { value: "all", label: "All" },
  ];
  W("results-explorer", (el) => barWidget(el, data, {
    domain: "math", models: data.models.math, metrics: ["pass@1", "pass@8"], rewards: allRewards, defaultReward: "all",
    title: "Results explorer (math)",
    desc: "Choose a backbone, metric, reward and benchmark. VI-CuRL is blue, baselines are gray.",
    caption: `Mean ± std over 5 seeds, 16 samples per problem; trained on ${data.notes.training_data.math}. VI-CuRL's curriculum never uses a verifier; only the reward source changes.`,
  }));
  W("general-results", (el) => barWidget(el, data, {
    domain: "general", models: data.models.general, metrics: ["pass@1"], defaultReward: "all",
    rewards: [allRewards[3], { value: "oracle", label: "Oracle" }, allRewards[1], allRewards[2]],
    title: "General knowledge (Llama-3.2-3B-Instruct, Pass@1)",
    desc: "The same comparison on four non-math benchmarks.",
    caption: `Pass@1, mean ± std over 5 seeds; trained on ${data.notes.training_data.general}.`,
  }));
  W("ablation-chart", (el) => ablationWidget(el, data));
  W("mechanism-chart", (el) => mechanismWidget(el, data));
  W("long-output", (el) => longOutputWidget(el, data));
  const redraw = () => renderers.forEach((fn) => fn(false));
  onThemeChange(redraw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
}

const ids = ["results-explorer", "general-results", "ablation-chart", "mechanism-chart", "long-output"];
if (ids.some((id) => document.getElementById(id))) {
  loadResults().then(init).catch((e) => {
    console.error("[results] could not load results.json", e);
    ids.forEach((id) => { const el = document.getElementById(id); if (el && !el.childElementCount) el.appendChild(h("p", { class: "muted small" }, "Results could not be loaded.")); });
  });
}
