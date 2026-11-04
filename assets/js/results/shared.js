// Shared helpers for the results widgets (Agent B). Builds on ../viz-common.js.
import { h, cssVar, fmt } from "../viz-common.js";

export const SETTINGS = ["base", "oracle", "majority_vote", "entropy"];
export const SETTING_LABEL = {
  base: "Base model (no RL)",
  oracle: "Oracle reward",
  majority_vote: "Majority vote",
  entropy: "Entropy",
};
export const SETTING_SUB = { oracle: "with verifier", majority_vote: "no verifier", entropy: "no verifier" };
export const METRIC_LABEL = { "pass@1": "Pass@1", "pass@8": "Pass@8" };

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Difference of two one-decimal paper numbers, rounded to one decimal (no float noise). */
export const diff1 = (a, b) => Math.round((a - b) * 10) / 10;
/** Signed one-decimal string with a true minus sign. */
export function signed(v) {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "0.0";
  return (r > 0 ? "+" : "−") + Math.abs(r).toFixed(1);
}
export const pm = (m, s) => `${fmt(m)} ± ${fmt(s)}`;

/* ---------- text measurement (canvas, same font stack as the page) ---------- */
let _ctx = null;
export function textWidth(str, size = 12, weight = 500) {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  _ctx.font = `${weight} ${size}px ${cssVar("--font-sans") || "sans-serif"}`;
  return _ctx.measureText(String(str)).width;
}

/** Split a label into at most two lines so that each fits maxW (greedy on spaces). */
export function wrap2(str, maxW, size = 12, weight = 500) {
  if (textWidth(str, size, weight) <= maxW) return [str];
  const words = String(str).split(" ");
  if (words.length < 2) return [str];
  let best = [str], bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const w = Math.max(textWidth(a, size, weight), textWidth(b, size, weight));
    if (w < bestW) { bestW = w; best = [a, b]; }
  }
  return best;
}

/* ---------- scales ---------- */
export function niceDomain(max, target = 5) {
  if (!(max > 0)) return { max: 1, step: 0.2 };
  const raw = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  return { max: Math.ceil(max / step - 1e-9) * step, step };
}
export function ticks(dom) {
  const out = [];
  for (let v = 0; v <= dom.max + 1e-9; v += dom.step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Path for a bar with 4px rounded data-end, square at the baseline. */
export function barPath(x, y, w, hgt, orient = "v", r = 4) {
  if (orient === "v") {
    const rr = Math.max(0, Math.min(r, w / 2, hgt));
    return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
  }
  // horizontal: x = baseline, w = length, hgt = thickness, rounded at the right end
  const rr = Math.max(0, Math.min(r, hgt / 2, w));
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt - rr}Q${x + w},${y + hgt} ${x + w - rr},${y + hgt}H${x}Z`;
}

/* ---------- labels that must not collide: cluster-and-spread placement ---------- */
/**
 * ys: desired positions; gap: minimum spacing; lo/hi: bounds.
 * Overlapping labels are merged into clusters centered on the mean of their targets,
 * then clusters are clamped to [lo, hi] and re-merged until nothing overlaps.
 */
export function spreadLabels(ys, gap, lo, hi) {
  const items = ys.map((y, i) => ({ i, y })).sort((a, b) => a.y - b.y);
  let clusters = items.map((it) => ({ members: [it], c: it.y }));
  const top = (cl) => cl.c - ((cl.members.length - 1) * gap) / 2;
  const clamp = (cl) => {
    const span = (cl.members.length - 1) * gap;
    const t = Math.min(Math.max(top(cl), lo), Math.max(lo, hi - span));
    cl.c = t + span / 2;
  };
  for (let guard = 0; guard < 50; guard++) {
    clusters.forEach(clamp);
    let merged = false;
    const next = [clusters[0]];
    for (let k = 1; k < clusters.length; k++) {
      const a = next[next.length - 1], b = clusters[k];
      const aBottom = top(a) + (a.members.length - 1) * gap;
      if (top(b) - aBottom < gap - 0.01) {
        const members = a.members.concat(b.members);
        next[next.length - 1] = { members, c: members.reduce((s, m) => s + m.y, 0) / members.length };
        merged = true;
      } else next.push(b);
    }
    clusters = next;
    if (!merged) break;
  }
  clusters.forEach(clamp);
  const out = new Array(ys.length);
  for (const cl of clusters) cl.members.forEach((m, k) => { out[m.i] = top(cl) + k * gap; });
  return out;
}

/* ---------- DOM pieces ---------- */
export function header(card, title, desc) {
  card.classList.add("res-card");
  card.appendChild(h("h3", { style: "margin-top:0", class: "res-title" }, title));
  if (desc) card.appendChild(h("p", { class: "res-desc" }, desc));
}

let _uid = 0;
export const uid = (p) => `${p}-${++_uid}`;

/** Labeled segmented control. options: [{value, label}] */
export function segCtl(label, options, value, onChange) {
  const id = uid("res-seg");
  const group = h("div", { class: `seg res-seg res-seg-${options.length}`, role: "group", "aria-labelledby": id });
  const buttons = options.map((o) => {
    const b = h("button", { type: "button", "aria-pressed": String(o.value === value) }, o.label);
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      onChange(o.value);
    });
    group.appendChild(b);
    return b;
  });
  return h("div", { class: "res-ctl" }, [h("span", { class: "control-label", id }, label), group]);
}

/** Labeled native select. options: [{value, label}] */
export function selectCtl(label, options, value, onChange) {
  const id = uid("res-sel");
  const sel = h("select", { class: "select", id });
  for (const o of options) {
    const opt = h("option", { value: o.value }, o.label);
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return h("div", { class: "res-ctl" }, [h("label", { class: "control-label", for: id }, label), sel]);
}

/** "Show table" toggle bound to a panel element (hidden by default). */
export function tableToggle(panel, onOpen) {
  const id = panel.id || (panel.id = uid("res-table"));
  panel.hidden = true;
  const btn = h("button", { type: "button", class: "btn-small res-table-btn", "aria-expanded": "false", "aria-controls": id }, [
    h("span", { class: "res-table-ico", "aria-hidden": "true" }),
    h("span", { class: "res-table-txt" }, "Show table"),
  ]);
  btn.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.querySelector(".res-table-txt").textContent = open ? "Hide table" : "Show table";
    if (open && onOpen) onOpen();
  });
  return btn;
}

/**
 * Build a table.data.
 * cols: header labels (first = row header). blocks: [{label?, rows: [{head, cells:[{v, s?} | string], ours}]}]
 * best: mark the max mean per numeric column within each block of >= 2 rows (td.best).
 */
export function buildTable({ caption, cols, blocks, best = true, decimals = 1, sticky = false }) {
  const thead = h("thead", {}, h("tr", {}, cols.map((c, i) => h("th", { scope: "col" }, c))));
  const tbody = h("tbody");
  for (const blk of blocks) {
    if (blk.label) {
      tbody.appendChild(h("tr", { class: "res-grp" }, h("th", { colspan: String(cols.length), scope: "colgroup" }, blk.label)));
    }
    const bestVals = [];
    if (best && blk.rows.length > 1) {
      for (let j = 0; j < cols.length - 1; j++) {
        const vals = blk.rows.map((r) => (r.cells[j] && typeof r.cells[j] === "object" ? r.cells[j].v : NaN)).filter((v) => !Number.isNaN(v));
        bestVals[j] = vals.length ? Math.max(...vals) : NaN;
      }
    }
    for (const r of blk.rows) {
      const tr = h("tr", { class: r.ours ? "ours" : null });
      tr.appendChild(h("th", { scope: "row" }, r.head));
      r.cells.forEach((c, j) => {
        if (typeof c !== "object") { tr.appendChild(h("td", {}, String(c))); return; }
        const isBest = bestVals[j] !== undefined && c.v === bestVals[j];
        const td = h("td", { class: isBest ? "best" : null }, fmt(c.v, c.d ?? decimals));
        if (c.s !== undefined) td.appendChild(h("span", { class: "res-pm" }, ` ± ${fmt(c.s)}`));
        if (c.suffix) td.appendChild(document.createTextNode(c.suffix));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
  }
  const table = h("table", { class: "data" }, [caption ? h("caption", { class: "sr-only" }, caption) : null, thead, tbody]);
  return h("div", { class: "res-table-block" }, [
    caption ? h("p", { class: "res-caption", "aria-hidden": "true" }, caption) : null,
    h("div", { class: `table-wrap res-table${sticky ? " res-sticky" : ""}` }, table),
  ]);
}

/** Bind hover + keyboard focus on an SVG element to a tooltip. */
export function bindTip(el, tip, html, { onEnter, onLeave } = {}) {
  const enter = (x, y) => { tip.show(html(), x, y); onEnter && onEnter(); };
  const leave = () => { tip.hide(); onLeave && onLeave(); };
  el.addEventListener("pointerenter", (e) => enter(e.clientX, e.clientY));
  el.addEventListener("pointermove", (e) => tip.show(html(), e.clientX, e.clientY));
  el.addEventListener("pointerleave", leave);
  el.addEventListener("focus", () => {
    const r = el.getBoundingClientRect();
    enter(r.left + r.width / 2, r.top + Math.min(r.height / 2, 40));
  });
  el.addEventListener("blur", leave);
}

/** Tooltip body: value first (strong), then a line-keyed name, then muted meta lines. */
export function tipHTML({ value, name, key = "muted", dash = null, meta = [] }) {
  const keyCls = `res-tt-key ${key}${dash ? " dash" : ""}`;
  return `<div class="res-tt-val">${value}</div>` +
    `<div class="res-tt-name"><span class="${keyCls}"></span>${esc(name)}</div>` +
    meta.map((m) => `<div class="res-tt-meta">${m}</div>`).join("");
}
