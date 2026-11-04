// Slope chart: two time points, direct labels at both ends with collision-free placement + leader lines.
import { svgEl, fmt } from "../viz-common.js";
import { textWidth, spreadLabels, bindTip } from "./shared.js";

/**
 * spec: series: [{name, short, a, b, ours, dash, tip: () => html, aria}],
 *       xLabels: [[line1, line2], [line1, line2]], axisLabel, aria, tip
 */
export function renderSlope(host, spec) {
  const W = Math.max(260, Math.floor(host.clientWidth));
  host.textContent = "";
  const svg = svgEl("svg", { role: "img", "aria-label": spec.aria, class: "res-svg res-slope-svg" });
  const S = spec.series;
  const valW = Math.max(...S.map((s) => textWidth(fmt(s.a), 12, 700))) + 4;
  const rightW = Math.max(...S.map((s) => textWidth(fmt(s.b), 12, 700) + 6 + textWidth(s.short, 12, s.ours ? 700 : 500)));
  const leftGutter = valW + 22, rightGutter = rightW + 24;
  const xL = leftGutter, xR = Math.max(xL + 90, W - rightGutter);
  const top = 30, plotH = 230, yB = top + plotH;
  const max = Math.max(...S.flatMap((s) => [s.a, s.b]));
  const dmax = Math.ceil((max * 1.06) / 5) * 5;
  const yS = (v) => yB - (v / dmax) * plotH;
  const H = yB + 46;
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  svgEl("text", { x: 0, y: 12, class: "res-axis-title" }, svg).textContent = spec.axisLabel;
  // zero baseline + the two time axes (recessive hairlines)
  svgEl("line", { x1: xL, x2: xR, y1: yB + 0.5, y2: yB + 0.5, class: "res-grid" }, svg);
  [xL, xR].forEach((x, i) => {
    svgEl("line", { x1: x + 0.5, x2: x + 0.5, y1: top - 8, y2: yB, class: "res-axis" }, svg);
    const [l1, l2] = spec.xLabels[i];
    svgEl("text", { x, y: yB + 18, "text-anchor": "middle", class: "res-xlab" }, svg).textContent = l1;
    svgEl("text", { x, y: yB + 33, "text-anchor": "middle", class: "res-gsub" }, svg).textContent = l2;
  });

  const gap = 16;
  const yl = spreadLabels(S.map((s) => yS(s.a)), gap, top - 4, yB - 2);
  const yr = spreadLabels(S.map((s) => yS(s.b)), gap, top - 4, yB - 2);
  const gLines = svgEl("g", {}, svg), gLab = svgEl("g", {}, svg), gHit = svgEl("g", {}, svg);
  const groups = [];
  // draw muted series first so VI-CuRL sits on top
  const order = S.map((s, i) => i).sort((i, j) => Number(S[i].ours) - Number(S[j].ours));
  for (const i of order) {
    const s = S[i];
    const ya = yS(s.a), yb = yS(s.b);
    const g = svgEl("g", { class: `res-series${s.ours ? " ours" : ""}` }, gLines);
    svgEl("line", { x1: xL, y1: ya, x2: xR, y2: yb, class: "res-line", "stroke-dasharray": s.dash || null }, g);
    svgEl("circle", { cx: xL, cy: ya, r: 4.5, class: "res-dot" }, g);
    svgEl("circle", { cx: xR, cy: yb, r: 4.5, class: "res-dot" }, g);
    const lg = svgEl("g", { class: `res-series${s.ours ? " ours" : ""}` }, gLab);
    // left: value only
    if (Math.abs(yl[i] - ya) > 1.5) svgEl("path", { d: `M${xL - 7},${ya}L${xL - 12},${yl[i]}H${xL - 14}`, class: "res-leader" }, lg);
    svgEl("text", { x: xL - 16, y: yl[i], dy: "0.34em", "text-anchor": "end", class: `res-val${s.ours ? " ours" : ""}` }, lg).textContent = fmt(s.a);
    // right: value + short name
    if (Math.abs(yr[i] - yb) > 1.5) svgEl("path", { d: `M${xR + 7},${yb}L${xR + 12},${yr[i]}H${xR + 14}`, class: "res-leader" }, lg);
    const t = svgEl("text", { x: xR + 16, y: yr[i], dy: "0.34em", class: `res-val${s.ours ? " ours" : ""}` }, lg);
    t.textContent = fmt(s.b);
    const nm = svgEl("tspan", { dx: 6, class: `res-slope-name${s.ours ? " ours" : ""}` }, t);
    nm.textContent = s.short;
    // generous hit area: the line, both dots and both labels
    const hit = svgEl("g", { class: "res-hit-g", tabindex: "0", "aria-label": s.aria }, gHit);
    svgEl("line", { x1: xL, y1: ya, x2: xR, y2: yb, class: "res-hit-line" }, hit);
    svgEl("circle", { cx: xL, cy: ya, r: 12, class: "res-hit" }, hit);
    svgEl("circle", { cx: xR, cy: yb, r: 12, class: "res-hit" }, hit);
    svgEl("rect", { x: 0, y: yl[i] - 8, width: xL - 8, height: 16, class: "res-hit" }, hit);
    svgEl("rect", { x: xR + 8, y: yr[i] - 8, width: W - xR - 8, height: 16, class: "res-hit" }, hit);
    groups.push({ g, lg });
    bindTip(hit, spec.tip, s.tip, {
      onEnter: () => { svg.classList.add("res-dim"); g.classList.add("on"); lg.classList.add("on"); },
      onLeave: () => { svg.classList.remove("res-dim"); g.classList.remove("on"); lg.classList.remove("on"); },
    });
  }
  host.appendChild(svg);
}
