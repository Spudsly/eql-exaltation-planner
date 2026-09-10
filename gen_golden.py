"""Golden-output generator for the JS parity suite.

Runs the real Python planner (planner.py) over a set of scenarios and dumps
normalized results to web/golden.json. Node's web/test_parity.js recomputes
the same scenarios from planner.js and must match byte-for-byte.

Run from the project root:  python web/gen_golden.py
"""
import io
import itertools
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import planner  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data",
                    "eql_focus_effects.json")

CLASSES = list(planner.CLASSES.keys())
TRIOS = sorted(map(sorted, itertools.combinations(CLASSES, 3)))

BROAD_TRIOS = [
    ["CLR", "DRU", "SHM"],
    ["SHM", "WAR", "MNK"],
    ["BRD", "ENC", "CLR"],
    ["BRD", "WAR", "SHD"],
    ["WIZ", "MAG", "NEC"],
    ["PAL", "CLR", "SHD"],
]


def trio_key(t):
    return "/".join(t)


def build_full(data, trio):
    items = planner.class_filter(data, trio)
    fx = planner.focus_effects_available(data, items, set(trio))
    effects = planner.max_rank_per_family(fx)
    return effects, fx


def build_effects(data, trio):
    return build_full(data, trio)[0]


def sorted_names(effects):
    return sorted(effects, key=lambda n: (effects[n]["category"], n))


def sorted_rows(plan):
    return sorted(plan, key=lambda p: (p[2] if p[2] else "", p[0]))


def stats_payload(stats):
    return {
        "total": stats["total"],
        "placed": stats["placed"],
        "restricted": stats["restricted"],
        "conflicts": list(stats["conflicts"]),
        "procs": list(stats["procs"]),
        "not_honored": list(stats["not_honored"]),
        "clashes": stats["clashes"],
        "why_here": stats["why_here"],
        "fell_back": stats.get("fell_back", {}),
        "high_total": stats.get("high_total", 0),
        "high_placed": stats.get("high_placed", 0),
    }


def main():
    with open(DATA, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    golden = {"effects_available": {}, "scenarios": []}

    # Tier 2: broad coverage, moderate selections over ~40 trios.
    broad = TRIOS[:: len(TRIOS) // 40][:40]
    t0 = time.time()
    for trio in broad + BROAD_TRIOS:
        effects, fx = build_full(data, trio)
        chosen = sorted_names(effects)[:12]
        plan, stats = planner.optimize_plan(effects, chosen, trio, all_effects=fx)
        golden["scenarios"].append({
            "trio": trio, "chosen": chosen, "gear_ok": None, "any_slots": None,
            "forced": None, "plan": sorted_rows(plan), "stats": stats_payload(stats),
        })
    print("tier2 scenarios: {} in {:.1f}s".format(
        len(golden["scenarios"]), time.time() - t0))

    # Tier 3: restriction/any/forced stress on representative trios.
    t0 = time.time()
    for trio in BROAD_TRIOS:
        effects, fx = build_full(data, trio)
        chosen = sorted_names(effects)
        n = min(13, len(chosen))
        chosen = chosen[:n]

        gear_ok = {
            "PRIMARY": ["WAR"] if "WAR" in trio else trio,
            "SECONDARY": ["WAR"] if "WAR" in trio else trio,
            "FINGERS": trio[:2],
            "FINGERS #2": trio[1:],
            "EARS": trio[0:1],
            "EARS #2": trio[1:2],
            "WRIST": [],
            "WRIST #2": trio,
        }
        plan, stats = planner.optimize_plan(effects, chosen, trio, gear_ok=gear_ok, all_effects=fx)
        golden["scenarios"].append({
            "trio": trio, "chosen": chosen, "gear_ok": gear_ok,
            "any_slots": None, "forced": None,
            "plan": sorted_rows(plan), "stats": stats_payload(stats),
        })

        any_slots = [{"slot": "FINGERS", "classes": None},
                     {"slot": "EARS", "classes": [trio[0]]},
                     {"slot": "WRIST", "classes": None},
                     {"slot": ""}]
        plan, stats = planner.optimize_plan(effects, chosen, trio, any_slots=any_slots, all_effects=fx)
        golden["scenarios"].append({
            "trio": trio, "chosen": chosen, "gear_ok": None, "any_slots": any_slots,
            "forced": None, "plan": sorted_rows(plan), "stats": stats_payload(stats),
        })

        forced = {}
        if len(chosen) >= 3:
            for nm in (chosen[0], chosen[2]):
                bucket = effects[nm]["sources"][0]["slot"]
                forced[nm] = bucket
        plan, stats = planner.optimize_plan(effects, chosen, trio, forced=forced, all_effects=fx)
        golden["scenarios"].append({
            "trio": trio, "chosen": chosen, "gear_ok": None, "any_slots": None,
            "forced": forced, "plan": sorted_rows(plan), "stats": stats_payload(stats),
        })

        plan, stats = planner.optimize_plan(
            effects, chosen, trio, forced=forced, gear_ok=gear_ok,
            any_slots=any_slots, all_effects=fx)
        golden["scenarios"].append({
            "trio": trio, "chosen": chosen, "gear_ok": gear_ok, "any_slots": any_slots,
            "forced": forced, "plan": sorted_rows(plan), "stats": stats_payload(stats),
        })
    print("tier3 scenarios: {} in {:.1f}s".format(
        4 * len(BROAD_TRIOS), time.time() - t0))

    # Tier 4: two-tier priority — a handful of "highest priority" goals that
    # must not be downgraded to make room for the useful remainder.
    t0 = time.time()
    for trio in BROAD_TRIOS:
        effects, fx = build_full(data, trio)
        chosen = sorted_names(effects)
        n = min(13, len(chosen))
        chosen = chosen[:n]
        high = set(chosen[:3])
        plan, stats = planner.optimize_plan(
            effects, chosen, trio, all_effects=fx, high_priority=high)
        golden["scenarios"].append({
            "trio": trio, "chosen": chosen, "gear_ok": None, "any_slots": None,
            "forced": None, "high_priority": sorted(high),
            "plan": sorted_rows(plan), "stats": stats_payload(stats),
        })
    print("tier4 scenarios: {} in {:.1f}s".format(
        len(BROAD_TRIOS), time.time() - t0))

    # Tier 1: the desktop smoke's own expectations.
    effects, fx = build_full(data, ["CLR", "DRU", "SHM"])
    golden["effects_available"][trio_key(["CLR", "DRU", "SHM"])] = sorted(effects)
    plan, stats = planner.optimize_plan(effects, sorted_names(effects), ["CLR", "DRU", "SHM"], all_effects=fx)
    golden["scenarios"].append({
        "trio": ["CLR", "DRU", "SHM"], "chosen": sorted_names(effects),
        "gear_ok": None, "any_slots": None, "forced": None,
        "plan": sorted_rows(plan), "stats": stats_payload(stats),
    })

    effects, fx = build_full(data, ["SHM", "WAR", "MNK"])
    golden["effects_available"][trio_key(["SHM", "WAR", "MNK"])] = sorted(effects)
    chosen = sorted_names(effects)
    plan, stats = planner.optimize_plan(effects, chosen, ["SHM", "WAR", "MNK"], all_effects=fx)
    golden["scenarios"].append({
        "trio": ["SHM", "WAR", "MNK"], "chosen": chosen,
        "gear_ok": None, "any_slots": None, "forced": None,
        "plan": sorted_rows(plan), "stats": stats_payload(stats),
    })

    for trio in (["CLR", "DRU", "SHM"], ["SHM", "WAR", "MNK"]):
        effects, fx = build_full(data, trio)
        chosen = sorted_names(effects)
        gear_ok = {}
        for b in ("EARS", "EARS #2", "FINGERS", "FINGERS #2",
                  "WRIST", "WRIST #2"):
            gear_ok[b] = [trio[0]]
        plan, stats = planner.optimize_plan(effects, chosen, trio, gear_ok=gear_ok, all_effects=fx)
        golden["scenarios"].append({
            "trio": trio, "chosen": chosen, "gear_ok": gear_ok,
            "any_slots": None, "forced": None,
            "plan": sorted_rows(plan), "stats": stats_payload(stats),
        })

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden.json")
    with io.open(out_path, "w", encoding="utf-8") as fh:
        json.dump(golden, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print("wrote {}".format(out_path))
    print("total scenarios: {}".format(len(golden["scenarios"])))


if __name__ == "__main__":
    main()