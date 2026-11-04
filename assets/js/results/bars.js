// Grouped bar chart (columns on wide containers, labeled horizontal bars on narrow ones).
import { svgEl, fmt, prefersReducedMotion } from "../viz-common.js";
import { niceDomain, ticks, barPath, textWidth, wrap2, bindTip } from "./shared.js";

const MIN_BAR = 2; // px: tiny values (e.g. 0.1) stay visible

/**
 * host: div to render into. spec:
 *  groups: [{label, sub, items: [{label, mean, std, ours, aria, tip: () => html}]}]
 *  groupLabels, ref: {value, label} | null, axisLabel, orient: "auto" | "h",
 *  minVertical (px), aria, tip (createTooltip instance), animate
 */
export function renderBars(host, spec) {
  const W = Math.max(260, Math.floor(host.clientWidth));
  const vertical = spec.orient !== "h" && W >= (spec.minVertical || 620);
  host.textContent = "";
  const svg = svgEl("svg", { role: "img", "aria-label": spec.aria, class: "res-svg" });
  if (spec.animate && !prefersReducedMotion()) svg.classList.add("res-anim", vertical ? "res-anim-v" : "res-anim-h");
  const items = spec.groups.flatMap((g) => g.items);
  let maxV = Math.max(...items.map((d) => d.mean + (d.std || 0)));
  if (spec.ref) maxV = Math.max(maxV, spec.ref.value);
  const dom = niceDomain(maxV * 1.03);
  (vertical ? drawVertical : drawHorizontal)(svg, W, spec, dom);
  host.appendChild(svg);
}

function hoverWire(spec, hit, band, d) {
  bindTip(hit, spec.tip, d.tip, {
    onEnter: () => band.classList.add("on"),
    onLeave: () => band.classList.remove("on"),
  });
}

function drawVertical(svg, W, spec, dom) {
  const groups = spec.groups;
  const n = groups.reduce((s, g) => s + g.items.length, 0);
  const left = 42, right = spec.ref ? 86 : 10;
  const groupGap = groups.length > 1 ? 28 : 0;
  const avail = W - left - right - groupGap * (groups.length - 1);
  const slot = Math.min(112, avail / n);
  const usedW = slot * n + groupGap * (groups.length - 1);
  const x0 = left + Math.max(0, (W - left - right - usedW) / 2);
  const plotTop = 36;
  const plotH = Math.round(Math.min(300, Math.max(210, W * 0.3)));
  const yB = plotTop + plotH;
  const yS = (v) => yB - (v / dom.max) * plotH;

  // method labels (wrap to two lines if needed)
  const lab = groups.map((g) => g.items.map((d) => wrap2(d.label, slot - 8, 12, d.ours ? 700 : 500)));
  const labelBlock = 10 + 2 * 14; // always reserve two lines so the chart height is stable across views
  const bottom = labelBlock + (spec.groupLabels ? 46 : 6);
  const H = yB + bottom;
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const gGrid = svgEl("g", {}, svg);
  for (const t of ticks(dom)) {
    const y = Math.round(yS(t)) + 0.5;
    if (t > 0) svgEl("line", { x1: x0, x2: x0 + usedW, y1: y, y2: y, class: "res-grid" }, gGrid);
    svgEl("text", { x: x0 - 8, y, dy: "0.32em", "text-anchor": "end", class: "res-tick" }, gGrid).textContent = fmt(t, dom.step < 1 ? 1 : 0);
  }
  svgEl("text", { x: x0 - left + 2, y: 12, class: "res-axis-title" }, svg).textContent = spec.axisLabel;

  const gBand = svgEl("g", {}, svg), gBars = svgEl("g", {}, svg), gTop = svgEl("g", {}, svg), gHit = svgEl("g", {}, svg);
  svgEl("line", { x1: x0 - 4, x2: x0 + usedW, y1: yB + 0.5, y2: yB + 0.5, class: "res-axis" }, gTop);

  const bw = Math.max(8, Math.min(24, slot * 0.46));
  let gx = x0, k = 0;
  groups.forEach((g, gi) => {
    const gStart = gx;
    g.items.forEach((d, i) => {
      const cx = gx + slot * (i + 0.5);
      const band = svgEl("rect", { x: cx - slot / 2 + 2, y: plotTop - 6, width: slot - 4, height: plotH + labelBlock + 6, rx: 6, class: "res-band" }, gBand);
      const hgt = Math.max(MIN_BAR, yB - yS(d.mean));
      svgEl("path", { d: barPath(cx - bw / 2, yB - hgt, bw, hgt, "v"), class: `res-bar${d.ours ? " ours" : ""}`, style: `animation-delay:${k * 25}ms` }, gBars);
      let labelY = yB - hgt;
      if (d.std > 0) {
        const y1 = yS(Math.max(0, d.mean - d.std)), y2 = yS(d.mean + d.std);
        svgEl("path", { d: `M${cx},${y1}V${y2}M${cx - 3.5},${y2}H${cx + 3.5}M${cx - 3.5},${y1}H${cx + 3.5}`, class: "res-err" }, gTop);
        labelY = Math.min(labelY, y2);
      }
      svgEl("text", { x: cx, y: labelY - 6, "text-anchor": "middle", class: `res-val res-halo${d.ours ? " ours" : ""}` }, gTop).textContent = fmt(d.mean);
      lab[gi][i].forEach((ln, li) => {
        svgEl("text", { x: cx, y: yB + 18 + li * 14, "text-anchor": "middle", class: `res-xlab${d.ours ? " ours" : ""}` }, gTop).textContent = ln;
      });
      const hit = svgEl("rect", { x: cx - slot / 2, y: plotTop - 6, width: slot, height: plotH + labelBlock + 6, class: "res-hit", tabindex: "0", "aria-label": d.aria }, gHit);
      hoverWire(spec, hit, band, d);
      k++;
    });
    gx += slot * g.items.length;
    if (spec.groupLabels) {
      const yb = yB + labelBlock + 4, x1 = gStart + 6, x2 = gx - 6, mid = (gStart + gx) / 2;
      svgEl("path", { d: `M${x1},${yb - 4}V${yb}H${x2}V${yb - 4}`, class: "res-bracket" }, gTop);
      svgEl("text", { x: mid, y: yb + 17, "text-anchor": "middle", class: "res-glab" }, gTop).textContent = g.label;
      if (g.sub) svgEl("text", { x: mid, y: yb + 32, "text-anchor": "middle", class: "res-gsub" }, gTop).textContent = g.sub;
    }
    gx += groupGap;
  });

  if (spec.ref) {
    const yr = Math.round(yS(spec.ref.value)) + 0.5;
    const xr = x0 + usedW + 4;
    svgEl("line", { x1: x0 - 4, x2: xr, y1: yr, y2: yr, class: "res-ref" }, gTop);
    svgEl("text", { x: xr + 6, y: yr - 3, class: "res-ref-lbl" }, gTop).textContent = spec.ref.label;
    svgEl("text", { x: xr + 6, y: yr + 12, class: "res-ref-val" }, gTop).textContent = fmt(spec.ref.value);
  }
}

function drawHorizontal(svg, W, spec, dom) {
  const right = 44, padL = 1;
  const plotW = W - padL - right;
  const xS = (v) => padL + (v / dom.max) * plotW;
  const bt = spec.barThickness || 14;
  const top = spec.ref ? 24 : 4;
  let y = top;
  const rows = [];
  spec.groups.forEach((g, gi) => {
    if (spec.groupLabels) {
      if (gi > 0) y += 6;
      rows.push({ type: "g", g, y });
      y += 24;
    }
    g.items.forEach((d) => { rows.push({ type: "i", d, y }); y += 18 + bt + 12; });
  });
  const plotBottom = y - 6;
  const H = plotBottom + 40;
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const gGrid = svgEl("g", {}, svg);
  const tk = ticks(dom);
  tk.forEach((t, i) => {
    const x = Math.round(xS(t)) + 0.5;
    svgEl("line", { x1: x, x2: x, y1: top - 2, y2: plotBottom, class: t > 0 ? "res-grid" : "res-axis" }, gGrid);
    const anchor = i === 0 ? "start" : i === tk.length - 1 ? "end" : "middle";
    svgEl("text", { x: i === 0 ? x - 1 : x, y: plotBottom + 15, "text-anchor": anchor, class: "res-tick" }, gGrid).textContent = fmt(t, dom.step < 1 ? 1 : 0);
  });
  svgEl("text", { x: padL, y: plotBottom + 33, class: "res-axis-title" }, svg).textContent = spec.axisLabel;

  const gBand = svgEl("g", {}, svg), gBars = svgEl("g", {}, svg), gTop = svgEl("g", {}, svg), gHit = svgEl("g", {}, svg);
  let k = 0;
  for (const r of rows) {
    if (r.type === "g") {
      const t = svgEl("text", { x: padL, y: r.y + 15, class: "res-glab res-halo" }, gTop);
      t.textContent = r.g.label;
      if (r.g.sub) {
        const s = svgEl("tspan", { class: "res-gsub", dx: 8 }, t);
        s.textContent = r.g.sub;
      }
      svgEl("line", { x1: padL, x2: W - 2, y1: r.y + 21.5, y2: r.y + 21.5, class: "res-sep" }, gTop);
      continue;
    }
    const d = r.d, by = r.y + 18;
    const band = svgEl("rect", { x: -4, y: r.y - 1, width: W + 6, height: 18 + bt + 8, rx: 6, class: "res-band" }, gBand);
    const len = Math.max(MIN_BAR, xS(d.mean) - xS(0));
    const barCls = `res-bar${d.ours ? " ours" : ""}${d.cls ? " " + d.cls : ""}`;
    svgEl("path", { d: barPath(xS(0), by, len, bt, "h"), class: barCls, style: `animation-delay:${k * 25}ms` }, gBars);
    let lx = xS(0) + len;
    if (d.std > 0) {
      const x1 = xS(Math.max(0, d.mean - d.std)), x2 = xS(d.mean + d.std), cy = by + bt / 2;
      svgEl("path", { d: `M${x1},${cy}H${x2}M${x1},${cy - 3.5}V${cy + 3.5}M${x2},${cy - 3.5}V${cy + 3.5}`, class: "res-err" }, gTop);
      lx = Math.max(lx, x2);
    }
    svgEl("text", { x: lx + 6, y: by + bt / 2, dy: "0.34em", class: `res-val res-halo${d.ours ? " ours" : ""}` }, gTop).textContent = fmt(d.mean);
    const lt = svgEl("text", { x: padL, y: r.y + 13, class: `res-ylab res-halo${d.ours ? " ours" : ""}` }, gTop);
    lt.textContent = d.label;
    if (d.sublabel) { const s = svgEl("tspan", { class: "res-ysub", dx: 6 }, lt); s.textContent = d.sublabel; }
    const hit = svgEl("rect", { x: 0, y: r.y - 1, width: W, height: 18 + bt + 8, class: "res-hit", tabindex: "0", "aria-label": d.aria }, gHit);
    hoverWire(spec, hit, band, d);
    k++;
  }

  if (spec.ref) {
    const xr = Math.round(xS(spec.ref.value)) + 0.5;
    svgEl("line", { x1: xr, x2: xr, y1: top - 6, y2: plotBottom, class: "res-ref" }, gTop);
    const txt = `${spec.ref.label} ${fmt(spec.ref.value)}`;
    const tw = textWidth(txt, 11.5, 600);
    let anchor = "middle", tx = xr;
    if (xr - tw / 2 < 0) { anchor = "start"; tx = Math.max(0, xr - 8); }
    else if (xr + tw / 2 > W) { anchor = "end"; tx = Math.min(W, xr + 8); }
    svgEl("text", { x: tx, y: top - 10, "text-anchor": anchor, class: "res-ref-lbl" }, gTop).textContent = txt;
  }
}
