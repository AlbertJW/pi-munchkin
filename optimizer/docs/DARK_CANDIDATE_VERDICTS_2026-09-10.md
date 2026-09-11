# Dark candidate verdicts — 2026-09-10 (judgment-adoption paperwork)

This is not a new adoption. It formally records two judgment adoptions that already
shipped on 2026-08-24, and finishes ADR-0006's paperwork for them (`optimizer/docs/adr/
0006-candidate-graduation-and-retirement-playbook.md`'s "Judgment adoptions recorded,
not graduated" note). Neither flag nor its schema field is removed — both remain
expressible kill switches, per the same rule the 2026-08-03 batch used.

## Ratified

**`FORCE_PLAN_WRITE` → default off (explicit-only planning).** Commit `41ab87b`
("feat(harness): adopt core tools and explicit planning"), 2026-08-24: `plan-runner.ts`'s
`FORCE_PLAN_WRITE_DEFAULT` flipped `"on" → "off"`. `FORCE_PLAN_WRITE=on` is now the
opt-in *rollback* to the pre-2026-08-24 forced-planning behavior (`docs/SURFACE_BOUNDARIES.md`
row, same date), not the default. The gemma-family harm this flag exists to let an
operator route around is real and specific: c38 (this same mechanism, pre-rename)
measured 0/9 gemma sessions reporting fabricated "tests passed" claims over red gates
(`optimizer/docs/archive/DARK_CANDIDATE_VERDICTS_2026-08-03.md`). The kill switch is
kept for exactly that reason — with the default now off, `=on` is the one thing that
still lets forced planning be measured or deliberately re-enabled without a code
change, and removing it would force a choice between re-inflicting that harm
unconditionally or deleting forced planning outright (a c38 retirement decision, out
of scope here).

**`VERIFICATION_PLATEAU` → default enforce.** Commit `079cc9b` ("feat(harness): AVO
adoption batch — flip the two dark pillars, raise the child budget"), 2026-08-24:
`verify-gate.ts`'s `PLATEAU_MODE` fallback flipped from `shadow` to `enforce`
(introduced shadow-by-default in `71e1707`, 2026-08-17). Commit message, verbatim:
"It sat in shadow while the exact failure it exists for happened live — the session
plateaued at streak 3 and stalled overnight... Rollback =shadow or =off." The
in-code comment at `verify-gate.ts:36-45` documents `=shadow`/`=off` as the
contracted rollback; that contract is the reason the flag and schema field stay.

## Honesty box (carried forward from `archive/DARK_CANDIDATE_VERDICTS_2026-08-03.md`)

These are reversible deployments, not measured wins — neither flip passed a powered
trial; both are judgment calls documented as such in their own commit messages. A
future round measuring either needs a suppression arm (`FORCE_PLAN_WRITE=on` /
`VERIFICATION_PLATEAU=shadow` or `=off`), not a re-run assuming the flag still varies
by default.

## Not this ADR's graduation checklist

Full ADR-0006 graduation removes the flag and its schema entry outright. That was
considered and rejected for both: it would delete a tested, contractually-documented
rollback surface for no evidenced gain, and contradicts the standing "keep dark /
reversible" posture this pass otherwise follows for every unscreened candidate. If
either flag's kill switch is ever to be removed, that is its own future decision with
its own sign-off — not a consequence of finishing this paperwork.
