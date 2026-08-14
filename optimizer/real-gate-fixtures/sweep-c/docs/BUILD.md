# Build ordering contract (authoritative)

`planBuild(steps)` takes build steps `{ name, needs }` and returns the names in
a valid execution order.

1. **Dependencies come first.** A step never appears before any step in its
   `needs`. A plain priority or input-order sort cannot express this — it needs
   a real dependency ordering.
2. **Tie-break is input order.** Among steps whose dependencies are all already
   satisfied, keep the order they appeared in the input.
3. **Reject bad graphs.** Throw on an unknown dependency, a duplicate step
   name, or a cycle. Do not silently drop or reorder around them.
4. **Pure.** `planBuild` must not mutate its input array or the step objects.

## Where the code lives

The exported planner is `src/index.js`. Note there are two similarly named
files: `src/steps/plan-build.js` (the real, wired-up module) and
`src/steps/planBuild.js` (an older camelCase copy that nothing imports). Follow
the import in `src/index.js` to find the one that matters.
