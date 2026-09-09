from __future__ import annotations

import itertools
import math
from typing import Iterable


class PolicyError(ValueError):
    pass


def _cells(evaluation: dict) -> dict[tuple[str, int, int], dict]:
    observations = evaluation.get("observations")
    if not isinstance(observations, list) or not observations:
        raise PolicyError("evaluation has no observations")
    cells = {}
    for row in observations:
        if not isinstance(row, dict):
            raise PolicyError("evaluation contains a malformed observation")
        key = (row.get("case_id"), row.get("seed"), row.get("repetition", 0))
        if (not isinstance(key[0], str) or not key[0] or type(key[1]) is not int
                or type(key[2]) is not int or key[2] < 0 or key in cells):
            raise PolicyError("evaluation contains malformed or duplicate paired cells")
        value = row.get("score")
        if type(value) not in (int, float) or not math.isfinite(value):
            raise PolicyError("evaluation score must be a finite number")
        cells[key] = row
    return cells


def matched_classification(parent: dict, candidate: dict, metric: dict | None = None) -> dict:
    before, after = _cells(parent), _cells(candidate)
    if set(before) != set(after):
        raise PolicyError("parent and candidate do not cover identical paired cells")
    direction = -1 if metric and metric["direction"] == "minimize" else 1
    if metric and metric["kind"] == "continuous":
        changes = [(after[key]["score"] - before[key]["score"]) * direction for key in before]
        return {"improved": sum(x > 1e-12 for x in changes),
                "regressed": sum(x < -1e-12 for x in changes),
                "unchanged": sum(abs(x) <= 1e-12 for x in changes)}
    classes = {name: [] for name in ("fixed", "regressed", "still_failing", "still_passing")}
    for key in sorted(before):
        old, new = before[key]["score"], after[key]["score"]
        if old not in (0, 1) or new not in (0, 1):
            raise PolicyError("task outcome classification requires binary outcomes")
        if direction == -1:
            old, new = 1 - old, 1 - new
        if old == 0 and new == 1:
            classes["fixed"].append(key)
        elif old == 1 and new == 0:
            classes["regressed"].append(key)
        elif old == 0 and new == 0:
            classes["still_failing"].append(key)
        else:
            classes["still_passing"].append(key)
    return {name: len(values) for name, values in classes.items()}


def _guards_pass(evaluation: dict, guards: Iterable[dict]) -> tuple[bool, list[str]]:
    measured = evaluation.get("guards") or {}
    failures = []
    for guard in guards:
        value = measured.get(guard["metric"])
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            failures.append(f"missing guard metric {guard['metric']}")
        elif guard["direction"] == "at_most" and value > guard["threshold"]:
            failures.append(f"{guard['metric']} exceeds {guard['threshold']}")
        elif guard["direction"] == "at_least" and value < guard["threshold"]:
            failures.append(f"{guard['metric']} is below {guard['threshold']}")
    return not failures, failures


def _permutation_pvalue(differences: list[float]) -> float:
    nonzero = [value for value in differences if value]
    if not nonzero:
        return 1.0
    if len(nonzero) > 20:
        raise PolicyError("exact paired permutation policy supports at most 20 nonzero cells")
    observed = sum(nonzero) / len(nonzero)
    extreme = total = 0
    for signs in itertools.product((-1, 1), repeat=len(nonzero)):
        total += 1
        permuted = sum(value * sign for value, sign in zip(nonzero, signs)) / len(nonzero)
        if permuted >= observed - 1e-12:
            extreme += 1
    return extreme / total


def accept_training_candidate(parent: dict, candidate: dict, campaign) -> dict:
    before, after = _cells(parent), _cells(candidate)
    if set(before) != set(after):
        raise PolicyError("parent and candidate do not cover identical paired cells")
    direction = 1 if campaign.primary_metric["direction"] == "maximize" else -1
    differences = [(after[key]["score"] - before[key]["score"]) * direction for key in sorted(before)]
    policy = campaign.primary_metric["paired_policy"]
    modern = policy["name"].endswith("/v1")
    # Legacy binary reporting retains its historical direction convention.
    classification = matched_classification(parent, candidate, campaign.primary_metric if modern or campaign.primary_metric["kind"] == "continuous" else None)
    if campaign.primary_metric["kind"] == "binary":
        if any(row["score"] not in (0, 1) for row in [*before.values(), *after.values()]):
            raise PolicyError("binary outcomes must be zero or one")
    if modern:
        # Average repeated measurements within a case before inference. More
        # seeds improve a case estimate; they never mint independent cases.
        grouped: dict[str, list[float]] = {}
        for key, delta in zip(sorted(before), differences):
            grouped.setdefault(key[0], []).append(delta)
        deltas = [math.fsum(values) / len(values) for values in grouped.values()]
        wins, losses = sum(x > 1e-12 for x in deltas), sum(x < -1e-12 for x in deltas)
        pvalue = None
        if policy["name"] == "net-case-wins/v1":
            improved = wins - losses >= policy["minimum_net_wins"]
        elif policy["name"] == "case-sign/v1":
            discordant = wins + losses
            pvalue = sum(math.comb(discordant, k) for k in range(wins, discordant + 1)) / 2**discordant
            improved = wins > losses and pvalue <= policy["alpha"]
        elif policy["name"] == "case-permutation/v1":
            if len(deltas) > policy["max_exact_cases"]:
                raise PolicyError("exact case permutation workload exceeded")
            pvalue = _permutation_pvalue(deltas)
            improved = math.fsum(deltas) / len(deltas) > 1e-12 and pvalue <= policy["alpha"]
        else:
            raise PolicyError("unsupported versioned policy")
        improved = improved and len(deltas) >= policy["minimum_cases"]
        policy_detail = {"name": policy["name"], "sampling_unit": "case",
                         "independent_cases": len(deltas), "wins": wins, "losses": losses,
                         "ties": len(deltas) - wins - losses, "pvalue": pvalue,
                         "mean_paired_difference": math.fsum(deltas) / len(deltas)}
    elif campaign.primary_metric["kind"] == "binary":
        if policy["name"] != "exact-sign":
            raise PolicyError("binary campaigns require exact-sign paired policy")
        minimum = policy.get("minimum_net_fixes", 1)
        net_fixes = (classification["fixed"] - classification["regressed"]) * direction
        improved = net_fixes >= minimum
        policy_detail = {"net_fixes": net_fixes, "minimum_net_fixes": minimum}
    else:
        if policy["name"] != "paired-permutation":
            raise PolicyError("continuous campaigns require paired-permutation policy")
        pvalue = _permutation_pvalue(differences)
        improved = sum(differences) / len(differences) > 0 and pvalue <= policy.get("alpha", 0.05)
        policy_detail = {"mean_paired_difference": sum(differences) / len(differences), "pvalue": pvalue}
    exposed = candidate.get("mechanism_exposed") is True
    guards_ok, guard_failures = _guards_pass(candidate, campaign.hard_guards)
    return {
        "accepted": bool(improved and exposed and guards_ok), "improved": improved,
        "mechanism_exposed": exposed, "guards_passed": guards_ok,
        "guard_failures": guard_failures, "classification": classification,
        "policy": policy_detail,
    }


def score(evaluation: dict) -> float:
    cells = _cells(evaluation)
    return sum(value["score"] for value in cells.values()) / len(cells)
