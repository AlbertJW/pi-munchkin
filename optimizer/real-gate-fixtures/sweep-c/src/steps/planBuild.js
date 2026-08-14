// DECOY: an older camelCase copy. Nothing imports this file — src/index.js
// wires up ./plan-build.js. Editing this changes no behaviour.
export function planBuild(steps) {
  return steps.map((step) => step.name);
}
