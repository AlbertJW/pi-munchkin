# Pending planner candidates

These c40–c45 definitions are intentionally outside `configs/static/` while the
pre-existing c1–c39 remote sweep is running. They are not part of the active
candidate roster and must not be promoted or reverse-synced until that sweep has
exited.

After the sweep:

1. add the c40/c42/c45 tool-consistency checks and tool grants to
   `optimizer/real_gate.sh`;
2. run the deterministic harness and fixture checks;
3. move these six JSON files to `../static/` in their atomic candidate commits;
4. reverse-sync the changed harness files to `~/.pi/agent`;
5. do not adopt, retire, or approve a fixture without Albert's explicit decision.
