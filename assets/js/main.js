// Page shell: theme toggle, section highlighting, video chapters, BibTeX copy, KaTeX, hero background.
import { h, prefersReducedMotion } from "./viz-common.js";

/* ---------- theme toggle ---------- */
const root = document.documentElement;
const darkNow = () => root.getAttribute("data-theme") === "dark" ||
  (!root.hasAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
const toggle = document.getElementById("theme-toggle");
function syncToggle() {
  if (!toggle) return;
  toggle.setAttribute("aria-pressed", darkNow() ? "true" : "false");
  toggle.title = darkNow() ? "Switch to light mode" : "Switch to dark mode";
}
toggle?.addEventListener("click", () => {
  const next = darkNow() ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("vicurl-theme", next); } catch (e) { /* storage may be blocked */ }
  syncToggle();
});
syncToggle();

/* ---------- active section in the nav ---------- */
const links = [...document.querySelectorAll(".topnav nav a")];
const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    links.forEach((a) => a.classList.remove("active"));
    const a = byId.get(e.target.id);
    if (a) {
      a.classList.add("active");
      a.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
}, { rootMargin: "-45% 0px -50% 0px" });
document.querySelectorAll("main section[id]").forEach((s) => io.observe(s));

/* ---------- video chapters ---------- */
const CHAPTERS = [
  [0, "Intro"], [16, "Why verifier-free RL?"], [61, "The problem: collapse"], [115, "Key idea: confidence"],
  [174, "The algorithm"], [223, "Theory I: consistency"], [261, "Theory II: variance"],
  [301, "Evidence: variance drops"], [326, "Main results"], [403, "Why confidence & annealing?"], [435, "Takeaways"],
];
const video = document.getElementById("explainer");
const chapWrap = document.getElementById("video-chapters");
if (video && chapWrap) {
  for (const [t, name] of CHAPTERS) {
    const mm = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    chapWrap.appendChild(h("button", {
      type: "button", "aria-label": `Play from ${mm}: ${name}`,
      onclick: () => { video.currentTime = t; video.play().catch(() => {}); },
    }, [h("span", { class: "t" }, mm), name]));
  }
}

/* ---------- BibTeX copy ---------- */
const copyBtn = document.getElementById("copy-bibtex");
copyBtn?.addEventListener("click", async () => {
  const text = document.getElementById("bibtex-text").textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = h("textarea", {}, text);
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy"), 1600);
});

/* ---------- KaTeX (scripts are deferred; wait for them) ---------- */
function renderMath() {
  if (!window.renderMathInElement) return false;
  window.renderMathInElement(document.querySelector("main"), {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
  });
  return true;
}
if (!renderMath()) {
  window.addEventListener("load", renderMath, { once: true });
}

/* ---------- hero background: drifting "prompt" particles, a few lit up ---------- */
const canvas = document.querySelector(".hero canvas.hero-bg");
if (canvas && canvas.getContext) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, raf = 0, visible = true;
  const N = 70;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts = Array.from({ length: N }, () => ({ x: rnd(), y: rnd(), r: 0.8 + rnd() * 1.8, v: 0.002 + rnd() * 0.006, c: rnd() }));
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    // the "kept" fraction slowly breathes between 20% and 100%: a nod to the annealed retention rate
    const beta = prefersReducedMotion() ? 0.35 : 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(t / 9000));
    for (const p of pts) {
      if (!prefersReducedMotion()) { p.y -= p.v / 60; if (p.y < -0.02) p.y = 1.02; }
      const kept = p.c > 1 - beta;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, kept ? p.r + 0.6 : p.r, 0, Math.PI * 2);
      ctx.fillStyle = kept ? "rgba(94, 234, 212, 0.85)" : "rgba(199, 210, 254, 0.28)";
      ctx.fill();
    }
    if (visible && !prefersReducedMotion()) raf = requestAnimationFrame(draw);
  }
  resize();
  window.addEventListener("resize", () => { resize(); if (prefersReducedMotion()) draw(0); });
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    cancelAnimationFrame(raf);
    if (visible) raf = requestAnimationFrame(draw);
  }).observe(canvas);
  draw(0);
}
