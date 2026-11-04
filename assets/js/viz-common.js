// Shared helpers for the VI-CuRL page widgets (ES module, no dependencies).
// Owned by the integrator: widget modules may import from here but must not edit this file.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Read a CSS custom property from :root (resolved for the current theme). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Create an SVG element with attributes; optionally append to a parent. */
export function svgEl(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  if (parent) parent.appendChild(e);
  return e;
}

/** Create an HTML element: h("div", {class: "x"}, "text" | Node | [children]). */
export function h(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return e;
}

/** Call cb() whenever the effective color theme changes (toggle or OS setting). Returns an unsubscribe fn. */
export function onThemeChange(cb) {
  const mo = new MutationObserver(() => cb());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const l = () => cb();
  mq.addEventListener("change", l);
  return () => { mo.disconnect(); mq.removeEventListener("change", l); };
}

/** Call cb(width) when the element's content width changes (debounced to animation frames). */
export function onResize(elem, cb) {
  let raf = 0, last = -1;
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === last) return;
    last = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => cb(w));
  });
  ro.observe(elem);
  return () => ro.disconnect();
}

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A lightweight tooltip bound to a positioned container (container gets position:relative).
 * tip.show(htmlString, clientX, clientY) / tip.hide()
 */
export function createTooltip(container) {
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const el = h("div", { class: "viz-tooltip", role: "tooltip", "aria-hidden": "true" });
  container.appendChild(el);
  return {
    el,
    show(html, clientX, clientY) {
      el.innerHTML = html;
      el.style.opacity = "1";
      const r = container.getBoundingClientRect();
      const tw = el.offsetWidth, th = el.offsetHeight;
      let x = clientX - r.left + 14, y = clientY - r.top - th - 10;
      if (x + tw > r.width - 4) x = clientX - r.left - tw - 14;
      if (y < 4) y = clientY - r.top + 16;
      el.style.transform = `translate(${Math.max(4, x)}px, ${y}px)`;
    },
    hide() { el.style.opacity = "0"; },
  };
}

/** Format a number with fixed decimals (default 1). */
export const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v).toFixed(d));

/** Load the paper's results data once (shared promise). */
let _resultsPromise = null;
export function loadResults() {
  if (!_resultsPromise) _resultsPromise = fetch(new URL("../data/results.json", import.meta.url)).then((r) => r.json());
  return _resultsPromise;
}
