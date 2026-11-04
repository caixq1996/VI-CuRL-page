// Tiny "math-ish" text helper: "β_t", "σ²_g,t", "L_max" -> base text with a real subscript.
import { svgEl } from "../viz-common.js";

const RE = /_([A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)/g;

function parts(str) {
  const out = [];
  let i = 0;
  for (const m of String(str).matchAll(RE)) {
    if (m.index > i) out.push([false, str.slice(i, m.index)]);
    out.push([true, m[1]]);
    i = m.index + m[0].length;
  }
  if (i < str.length) out.push([false, str.slice(i)]);
  return out;
}

/** HTML nodes (text + <sub>) for use as h() children. */
export function rich(str) {
  return parts(str).map(([sub, t]) => {
    if (!sub) return document.createTextNode(t);
    const s = document.createElement("sub");
    s.textContent = t;
    return s;
  });
}

/** Add <sub> tags to an HTML string built from trusted literals (tags contain no underscores). */
export const subHTML = (html) => String(html).replace(RE, "<sub>$1</sub>");

/** Fill an SVG <text> element with tspans, subscripts shifted down. */
export function svgRich(textEl, str) {
  let shifted = false;
  for (const [sub, t] of parts(str)) {
    const ts = svgEl("tspan", sub ? { dy: shifted ? 0 : 3, "font-size": "0.78em" } : { dy: shifted ? -3 : 0 }, textEl);
    ts.textContent = t;
    shifted = sub;
  }
  return textEl;
}
