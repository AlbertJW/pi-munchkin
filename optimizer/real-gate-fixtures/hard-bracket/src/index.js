import { isBalanced } from './balance.js';
import { maxDepth } from './depth.js';

// Analyze a bracket string: is it balanced, and how deeply is it nested?
export function analyze(s) {
  return { balanced: isBalanced(s), maxDepth: maxDepth(s) };
}
