// Widget 1: "From token entropy to prompt confidence" (#demo-confidence).
// c(x) = 1 - u(x), u(x) = mean over sampled responses of the mean over tokens of H(pi(.|s_t)) / log|V|.
import { h, onThemeChange, createTooltip, fmt } from "../viz-common.js";
import { softmax, normEntropy } from "./sim-core.js";
import { rich } from "./rich.js";

// Logit profile of the 6 candidates (candidate 0 is the most likely); gamma scales the gap.
const SHAPE = [0, 1, 1.35, 1.6, 1.8, 2.0];
const V = SHAPE.length;
const STEP = 1.6; // per-token sharpen / flatten factor

// Each token: [text, gamma, rank of the sampled candidate (default 0)].
const PRESETS = {
  confident: {
    label: "Confident prompt",
    prompt: "What is 12 + 7?",
    responses: [
      [["12", 5], ["+", 6], ["7", 6], ["=", 5.5], ["19", 4.5], [".", 3], ["Answer:", 2.2], ["19", 5]],
      [["Adding", 2], ["7", 4], ["to", 4.5], ["12", 5], ["gives", 3], ["19", 4.5], [".", 4], ["19", 5]],
      [["12", 5], ["+", 6], ["7", 6], ["=", 5.5], ["19", 4.5], [".", 3.5], ["Done", 2.4], [".", 5]],
      [["The", 2.6], ["sum", 3], ["is", 5], ["19", 4.5], [".", 4], ["Answer:", 2.5], ["19", 5.5], [".", 5]],
    ],
  },
  mixed: {
    label: "Mixed",
    prompt: "Solve 3x + 5 = 20 for x.",
    responses: [
      [["3x", 3.5], ["=", 5], ["15", 3.8], [",", 3], ["so", 2.8], ["x", 4.5], ["=", 5.5], ["5", 4.2]],
      [["Subtract", 1.6], ["5", 3.5], [":", 2.5], ["3x", 4], ["=", 5], ["15", 3.5], [";", 2], ["x=5", 3.2]],
      [["Move", 1.2], ["5", 2.2], ["over", 1.5], ["→", 1.0, 1], ["3x", 2.5], ["=", 4], ["25", 0.7, 1], ["?", 0.6, 2]],
      [["x", 2.2], ["=", 4], ["(20−5)/3", 1.8], ["=", 5], ["5", 4], [".", 3], ["Check", 1.3], ["✓", 2.5]],
    ],
  },
  uncertain: {
    label: "Uncertain prompt",
    prompt: "How many primes are there below 1000?",
    responses: [
      [["There", 2.5], ["are", 3.5], ["about", 1.4], ["168", 0.9], ["primes", 3], [",", 1.8], ["I", 1.2], ["think", 1.6]],
      [["Roughly", 0.8], ["170", 0.6, 1], [".", 2.2], ["Let", 1.2], ["me", 3], ["count", 1.1], ["…", 1.0, 1], ["168", 0.7]],
      [["Using", 1.0], ["π(x)", 1.2], ["≈", 1.8], ["x/ln x", 1.4], [":", 2], ["~145", 0.5, 2], [".", 2.5], ["So", 1.0, 1]],
      [["I", 1.5], ["estimate", 1.0], ["160", 0.5, 1], ["or", 1.3], ["so", 2.0], [".", 2.6], ["Maybe", 0.9], ["168", 0.8]],
    ],
  },
};
const ORDER = ["confident", "mixed", "uncertain"];
const SUB = ["₁", "₂", "₃", "₄"];

export function initConfidence(root) {
  const state = { preset: "confident", sharpLog: 0, G: 4, resp: 0, tok: -1, edits: {}, table: false };
  root.classList.add("demo-root");
  let tip = null; // created after the skeleton is mounted (replaceChildren would remove it)

  // ---------- static skeleton ----------
  const presetSeg = h("div", { class: "seg", role: "group", "aria-label": "Prompt preset" });
  const gSeg = h("div", { class: "seg", role: "group", "aria-label": "Number of sampled responses G" });
  const slider = h("input", { type: "range", class: "slider", min: "-2", max: "2", step: "0.05", value: "0", id: "demo-sharp",
    "aria-label": "Sharpness (inverse temperature) of every next-token distribution" });
  const sharpOut = h("output", { class: "demo-out", for: "demo-sharp" });
  const resetBtn = h("button", { class: "btn-small", type: "button" }, "Reset");
  const tableBtn = h("button", { class: "btn-small", type: "button", "aria-expanded": "false" }, "Table");
  const promptBox = h("div", { class: "demo-prompt" });
  const respTitle = h("div", { class: "demo-sub" });
  const respMean = h("div", { class: "small muted demo-num" });
  const chips = h("div", { class: "demo-chips", role: "group", "aria-label": "Tokens of the selected response" });
  const editor = h("div", { class: "demo-editor", "aria-live": "polite" });
  const rows = h("div", { class: "demo-rows" });
  const urow = h("div", { class: "demo-urow" });
  const gauge = h("div", { class: "demo-panel demo-gauge" });
  const tables = h("div", { class: "demo-tables", hidden: true });

  for (const key of ORDER) {
    presetSeg.appendChild(h("button", { type: "button", "data-k": key, onclick: () => {
      state.preset = key; state.resp = 0; state.tok = -1; render();
    } }, PRESETS[key].label));
  }
  for (const g of [2, 3, 4]) {
    gSeg.appendChild(h("button", { type: "button", "data-g": String(g), "aria-label": `G = ${g} responses`, onclick: () => {
      state.G = g; if (state.resp >= g) { state.resp = 0; state.tok = -1; } render();
    } }, String(g)));
  }
  slider.addEventListener("input", () => { state.sharpLog = Number(slider.value); render(); });
  resetBtn.addEventListener("click", () => { state.sharpLog = 0; state.edits = {}; state.tok = -1; slider.value = "0"; render(); });
  tableBtn.addEventListener("click", () => {
    state.table = !state.table; tableBtn.setAttribute("aria-expanded", String(state.table)); tables.hidden = !state.table; render();
  });

  root.replaceChildren(
    h("h3", { class: "demo-title", style: "margin-top:0" }, ["From token entropy to prompt confidence", h("span", { class: "badge-sim" }, "Toy simulation")]),
    h("p", { class: "demo-desc" }, "Each token's next-token distribution has a normalized entropy; averaging it over tokens and sampled responses gives u(x), and the prompt's confidence is c(x) = 1 − u(x)."),
    h("div", { class: "controls demo-controls demo-controls-top" }, [
      h("span", { class: "demo-ctl" }, [h("span", { class: "control-label" }, "Prompt"), presetSeg]),
      h("span", { class: "demo-ctl" }, [h("span", { class: "control-label" }, "Responses G"), gSeg]),
    ]),
    h("div", { class: "controls demo-controls" }, [
      h("label", { class: "demo-ctl-range demo-ctl-wide", for: "demo-sharp" }, [h("span", { class: "control-label" }, "Sharpness"), slider, sharpOut]),
      h("span", { class: "demo-spacer" }),
      h("span", { class: "demo-btns" }, [resetBtn, tableBtn]),
    ]),
    promptBox,
    h("div", { class: "demo-resp-head" }, [respTitle, respMean]),
    chips,
    editor,
    h("div", { class: "demo-conf-grid" }, [
      h("div", { class: "demo-panel" }, [
        h("div", { class: "demo-sub" }, ["Mean normalized entropy per response ", h("span", { class: "muted" }, "(select a row to inspect it)")]),
        rows, urow,
      ]),
      gauge,
    ]),
    tables,
    h("p", { class: "demo-note" }, [h("b", {}, "Toy vocabulary. "),
      "Each step offers |V| = 6 candidate tokens, so entropies are divided by log 6. A real LLM has |V| ≈ 150k tokens and divides by log|V|. Confidence is never a reward: VI-CuRL uses it only to rank prompts."]),
  );

  tip = createTooltip(root);

  // ---------- model ----------
  const editKey = (r, t) => `${state.preset}:${r}:${t}`;
  function tokenInfo(r, t) {
    const [text, gamma, rank = 0] = PRESETS[state.preset].responses[r][t];
    const m = state.edits[editKey(r, t)] || 0;
    const sharp = Math.pow(2, state.sharpLog) * Math.pow(STEP, m);
    const p = softmax(SHAPE.map((v) => -gamma * v), sharp);
    return { text, rank, p, hn: normEntropy(p), edit: m };
  }
  function compute() {
    const resp = [];
    for (let r = 0; r < state.G; r++) {
      const toks = PRESETS[state.preset].responses[r].map((_, t) => tokenInfo(r, t));
      resp.push({ toks, mean: toks.reduce((a, b) => a + b.hn, 0) / toks.length });
    }
    const u = resp.reduce((a, b) => a + b.mean, 0) / resp.length;
    return { resp, u, c: 1 - u };
  }

  // ---------- render ----------
  function render() {
    if (tip) tip.hide();
    const act = document.activeElement, fk = act && root.contains(act) ? act.getAttribute("data-fk") : null;
    const P = PRESETS[state.preset];
    const d = compute();
    const cur = d.resp[state.resp];
    for (const b of presetSeg.children) b.setAttribute("aria-pressed", String(b.dataset.k === state.preset));
    for (const b of gSeg.children) b.setAttribute("aria-pressed", String(Number(b.dataset.g) === state.G));
    const sharp = Math.pow(2, state.sharpLog);
    sharpOut.textContent = `×${sharp.toFixed(2)}`;
    slider.setAttribute("aria-valuetext", `sharpness ${sharp.toFixed(2)}`);

    promptBox.replaceChildren(h("span", { class: "k" }, "Prompt x"), h("span", { class: "v" }, P.prompt));
    respTitle.replaceChildren(`Sampled response y${SUB[state.resp]} `, h("span", { class: "muted" }, "· bars: next-token distribution, sampled token highlighted"));
    respMean.textContent = `mean over tokens = ${fmt(cur.mean, 3)}`;

    // token chips
    chips.replaceChildren(...cur.toks.map((tk, t) => {
      const bars = h("span", { class: "demo-dist", "aria-hidden": "true" },
        tk.p.map((q, i) => h("i", { class: i === tk.rank ? "on" : null, style: `height:${Math.max(1, q * 100).toFixed(1)}%` })));
      const chip = h("button", { type: "button", class: "demo-chip", "data-fk": `chip-${t}`, "aria-pressed": String(t === state.tok),
        "aria-label": `Token ${tk.text}: probability ${fmt(tk.p[tk.rank], 2)}, normalized entropy ${fmt(tk.hn, 2)}. Press to edit this token.` },
      [bars, h("span", { class: "demo-tok" }, tk.text), h("span", { class: "demo-h" }, `h ${fmt(tk.hn, 2)}`)]);
      chip.addEventListener("click", () => { state.tok = state.tok === t ? -1 : t; render(); });
      const show = (x, y) => tip.show(
        `<b>${fmt(tk.hn, 3)}</b> normalized entropy<br>token <b>${esc(tk.text)}</b> · p = ${fmt(tk.p[tk.rank], 3)}<br><span class="muted">top-6 probabilities: ${tk.p.map((q) => fmt(q, 2)).join(", ")}</span>`, x, y);
      chip.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
      chip.addEventListener("pointerleave", () => tip.hide());
      chip.addEventListener("focus", () => { const r = chip.getBoundingClientRect(); show(r.left + r.width / 2, r.top); });
      chip.addEventListener("blur", () => tip.hide());
      return chip;
    }));

    // token editor
    if (state.tok >= 0) {
      const tk = cur.toks[state.tok];
      const bump = (dm) => { const k = editKey(state.resp, state.tok); state.edits[k] = (state.edits[k] || 0) + dm; render(); };
      editor.replaceChildren(
        h("span", {}, ["Token ", h("code", {}, tk.text), ` · p = ${fmt(tk.p[tk.rank], 2)} · h = `, h("b", { class: "demo-num" }, fmt(tk.hn, 3))]),
        h("span", { class: "demo-btns" }, [
          h("button", { type: "button", class: "btn-small", "data-fk": "ed-sharpen", onclick: () => bump(1) }, "Sharpen"),
          h("button", { type: "button", class: "btn-small", "data-fk": "ed-flatten", onclick: () => bump(-1) }, "Flatten"),
          tk.edit ? h("button", { type: "button", class: "btn-small", "data-fk": "ed-undo", onclick: () => { delete state.edits[editKey(state.resp, state.tok)]; render(); } }, "Undo edit") : null,
        ]),
      );
    } else {
      editor.replaceChildren(h("span", { class: "muted" }, "Click a token to sharpen or flatten only its distribution."));
    }

    // per-response rows
    rows.replaceChildren(...d.resp.map((r, i) => {
      const row = h("button", { type: "button", class: "demo-row", "data-fk": `row-${i}`, "aria-pressed": String(i === state.resp),
        "aria-label": `Response ${i + 1}: mean normalized entropy ${fmt(r.mean, 3)}` }, [
        h("span", { class: "lab" }, `y${SUB[i]}`),
        h("span", { class: "demo-prof", "aria-hidden": "true" }, r.toks.map((tk) => h("i", { style: `height:${Math.max(4, tk.hn * 100).toFixed(1)}%` }))),
        h("span", { class: "demo-track", "aria-hidden": "true" }, h("span", { style: `width:${(r.mean * 100).toFixed(1)}%` })),
        h("span", { class: "val" }, fmt(r.mean, 3)),
      ]);
      row.addEventListener("click", () => { state.resp = i; state.tok = -1; render(); });
      return row;
    }));
    urow.replaceChildren(
      h("span", { class: "lab" }, ["u(x) ", h("span", { class: "muted small", style: "font-weight:500" }, `mean of ${state.G}`)]),
      h("span", { class: "demo-track", "aria-hidden": "true" }, h("span", { style: `width:${(d.u * 100).toFixed(1)}%` })),
      h("span", { class: "val" }, fmt(d.u, 3)),
    );

    // confidence gauge
    gauge.replaceChildren(
      h("div", { class: "k" }, "Prompt confidence"),
      h("div", { class: "big" }, [fmt(d.c, 2), h("small", {}, "c(x) = 1 − u(x)")]),
      h("div", { class: "demo-meter", role: "meter", "aria-valuemin": "0", "aria-valuemax": "1", "aria-valuenow": d.c.toFixed(3),
        "aria-label": "Prompt confidence c(x)" }, h("span", { style: `width:${(d.c * 100).toFixed(1)}%` })),
      h("div", { class: "demo-scale", "aria-hidden": "true" }, [h("span", {}, "0"), h("span", {}, "0.5"), h("span", {}, "1")]),
      h("div", { class: "eq" }, rich("In each batch, VI-CuRL keeps the top ⌈β_t·B⌉ prompts by c(x); low-confidence prompts join as β_t anneals to 1.")),
    );

    if (state.table) renderTable(d);
    if (fk) {
      const el = root.querySelector(`[data-fk="${fk}"]`) || (state.tok >= 0 ? root.querySelector(`[data-fk="chip-${state.tok}"]`) : null);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function renderTable(d) {
    const head = h("tr", {}, [h("th", { scope: "col" }, "Response"),
      ...d.resp[0].toks.map((_, t) => h("th", { scope: "col" }, `t = ${t + 1}`)), h("th", { scope: "col" }, "Mean")]);
    const body = d.resp.map((r, i) => h("tr", {}, [h("th", { scope: "row", style: "text-align:left" }, `y${SUB[i]}`),
      ...r.toks.map((tk) => h("td", {}, [h("span", { class: "demo-tok-cell" }, tk.text), fmt(tk.hn, 3)])), h("td", {}, fmt(r.mean, 3))]));
    const n = d.resp[0].toks.length;
    const foot = [
      h("tr", { class: "ours" }, [h("td", {}, "u(x)"), h("td", { colspan: String(n) }, `mean over ${state.G} responses`), h("td", {}, fmt(d.u, 3))]),
      h("tr", { class: "ours" }, [h("td", {}, "c(x)"), h("td", { colspan: String(n) }, "1 − u(x)"), h("td", {}, fmt(d.c, 3))]),
    ];
    const cap = `Normalized entropy H/log|V| per token (|V| = ${V}), sharpness ×${Math.pow(2, state.sharpLog).toFixed(2)}`;
    tables.replaceChildren(h("div", { class: "demo-tcap", "aria-hidden": "true" }, cap), h("div", { class: "table-wrap" }, h("table", { class: "data" }, [
      h("caption", { class: "sr-only" }, cap),
      h("thead", {}, head), h("tbody", {}, [...body, ...foot]),
    ])));
  }

  render();
  onThemeChange(render);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}
