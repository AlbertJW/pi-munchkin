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
        key = (row.get("case_id"), row.get("seed"), row.get("repetition", 0))
        if not isinstance(key[0], str) or not isinstance(key[1], int) or key in cells:
            raise PolicyError("evaluation contains malformed or duplicate paired cells")
        cells[key] = row
    return cells


def matched_classification(parent: dict, candidate: dict) -> dict:
    before, after = _cells(parent), _cells(candidate)
    if set(before) != set(after):
        raise PolicyError("parent and candidate do not cover identical paired cells")
    classes = {name: [] for name in ("fixed", "regressed", "still_failing", "still_passing")}
    for key in sorted(before):
        old, new = before[key]["score"], after[key]["score"]
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
        if not isinstance(value, (int, float)) or isinstance(value, bool):
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
    classification = matched_classification(parent, candidate)
    policy = campaign.primary_metric["paired_policy"]
    if campaign.primary_metric["kind"] == "binary":
        if policy["name"] != "exact-sign":
            raise PolicyError("binary campaigns require exact-sign paired policy")
        minimum = policy.get("minimum_net_fixes", 1)
        improved = classification["fixed"] - classification["regressed"] >= minimum
        policy_detail = {"net_fixes": classification["fixed"] - classification["regressed"], "minimum_net_fixes": minimum}
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

