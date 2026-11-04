// Playground widgets for the VI-CuRL page (Agent A). Each widget mounts into its card if present.
import { initConfidence } from "./demos/confidence.js";
import { initCurriculum } from "./demos/curriculum.js";

for (const [id, init] of [["demo-confidence", initConfidence], ["demo-curriculum", initCurriculum]]) {
  const el = document.getElementById(id);
  if (!el) continue;
  try {
    init(el);
  } catch (err) {
    console.error(`[demos] ${id} failed to initialize`, err);
  }
}
