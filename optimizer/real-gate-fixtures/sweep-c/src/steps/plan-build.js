// The wired-up planner (src/index.js imports THIS file). Currently a plain
// priority-agnostic input-order pass — it ignores dependencies entirely.
export function planBuild(steps) {
  return steps.map((step) => step.name);
}
