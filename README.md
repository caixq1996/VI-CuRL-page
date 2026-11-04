# VI-CuRL project page

Project page for **VI-CuRL: Stabilizing Verifier-Independent Reinforcement Learning Reasoning via Confidence-Guided Variance Reduction** (NeurIPS 2026), by Xin-Qiang Cai and Masashi Sugiyama.

The live page is https://caixq1996.github.io/VI-CuRL-page/

It is a static site with no build step:
- `index.html`
- `assets/css/`: design tokens and styles; light and dark modes
- `assets/js/`: vanilla ES modules
  - `main.js`: the page shell
  - `demos.js`: the interactive toy simulations
  - `results.js`: the result explorers, drawn as hand-written SVG
- `assets/data/results.json`: every result table of the paper, extracted from the camera-ready LaTeX source
- `assets/paper/`: the camera-ready PDF
- `assets/video/`: the explainer video, its captions and the poster

To preview locally, run `python3 -m http.server` and open http://localhost:8000. The page fetches JSON, so opening it with `file://` does not work.
