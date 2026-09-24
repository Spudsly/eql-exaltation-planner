/*
 * Mote optimizer solver checks: level curve, quality restriction, the
 * carry-over (banking) model, end-waste for +10, high-tier-saving ranking,
 * dedup, and errors.
 *
 * Run:  node web/test_mote.js
 */
"use strict";
const Mote = require("./mote.js");

let passed = 0;
function check(cond, msg) {
    if (cond) { passed++; console.log("OK " + msg); return; }
    throw new Error("FAIL: " + msg);
}

// ------------------------------------------------------------- constants
check(Mote.REQ[0] === 1 && Mote.REQ[9] === 512, "level curve 1..512");
check(Mote.CUM[5] === 31 && Mote.CUM[10] === 1023, "cumulative points to +5 / +10");
check(Mote.VALUES[1] === 1 && Mote.VALUES[2] === 1 && Mote.VALUES[3] === 2 &&
    Mote.VALUES[4] === 4 && Mote.VALUES[5] === 5 && Mote.VALUES[10] === 10,
    "mote values 1,1,2,4,5,6,7,8,9,10");

// strict structural validation of every returned way
function norm(inv) {
    const o = {};
    for (let q = 1; q <= 10; q++) o[q] = inv[q] || 0;
    return o;
}
function validate(res, start, target, inv, carried) {
    carried = carried || 0;
    const netNeed = Mote.CUM[target] - Mote.CUM[start] - carried;
    const cum0 = Mote.CUM[start] + carried;
    const invNorm = norm(inv);
    for (const w of res.ways) {
        for (let q = 1; q <= 10; q++) {
            if (w.used[q] + w.remaining[q] !== invNorm[q]) throw new Error("inventory leak q" + q);
        }
        let pts = 0, cnt = 0;
        for (let q = 1; q <= 10; q++) { pts += w.used[q] * Mote.VALUES[q]; cnt += w.used[q]; }
        if (pts !== w.total) throw new Error("used motes do not sum to total");
        if (cnt !== w.motes) throw new Error("motes count mismatch");
        let hi = 0;
        for (let q = 6; q <= 10; q++) hi += w.used[q];
        if (hi !== w.highMotes) throw new Error("highMotes mismatch");
        const endLevel = (() => { let l = 0; for (let k = 1; k <= 10 && Mote.CUM[k] <= cum0 + pts; k++) l = k; return l; })();
        if (w.endLevel !== endLevel) throw new Error("endLevel mismatch");
        if (w.endLevel < target) throw new Error("way does not reach target");
        if (w.endLevel === 10) {
            if (w.waste !== pts - netNeed) throw new Error("way waste mismatch at +10");
            if (w.bank !== 0) throw new Error("no banking above +10");
        } else {
            if (w.waste !== 0) throw new Error("no end waste below +10");
            if (w.bank !== (cum0 + pts) - Mote.CUM[w.endLevel]) throw new Error("bank mismatch");
            if (w.bank < 0 || w.bank >= Mote.REQ[w.endLevel]) throw new Error("bank out of range");
        }
        let cum = cum0;
        for (let q = 1; q <= 10; q++) {
            for (let k = 0; k < w.used[q]; k++) {
                if (cum >= Mote.CUM[q]) throw new Error("quality " + q + " fed past its window");
                cum += Mote.VALUES[q];
            }
        }
        // level-split bar data must be self-consistent
        if (w.steps.length !== target - start) throw new Error("steps count mismatch");
        if (w.steps[0].carry !== carried) throw new Error("first level bank mismatch");
        const union = {};
        for (let i = 0; i < w.steps.length; i++) {
            const s = w.steps[i];
            if (s.level !== start + i) throw new Error("step level order mismatch");
            if (i > 0 && s.carry !== w.steps[i - 1].out) throw new Error("bank chain broken (carry of step "
                + i + " != out of step " + (i - 1) + ")");
            let sum = 0;
            for (let q = 1; q <= 10; q++) {
                if (s.used[q]) {
                    sum += s.used[q] * Mote.VALUES[q];
                    union[q] = (union[q] || 0) + s.used[q];
                }
            }
            if (s.sum !== sum) throw new Error("step sum mismatch");
            if (s.carry + sum - Mote.REQ[s.level] !== s.out) throw new Error("step accounting (carry + sum - need != out)");
        }
        for (let q = 1; q <= 10; q++) {
            if ((union[q] || 0) !== w.used[q]) throw new Error("step union != way multiset q" + q);
        }
    }
    return true;
}

// carry-over: 0 -> +5 with the mid stock, zero end-waste (surplus banks)
{
    const inv = { 1: 5, 2: 5, 3: 5, 4: 5, 5: 10, 6: 10, 7: 5, 8: 5 };
    const res = Mote.findWays(0, 5, inv);
    check(res.ok, "0 -> +5 with full mid inventory is reachable");
    check(res.minWaste === 0, "0 -> +5 has zero end-waste ways");
    check(res.total > 0 && res.ways.length > 0, "0 -> +5 returns ways");
    check(validate(res, 0, 5, inv), "every 0 -> +5 way is valid and feedable in order");
    check(res.ways.every((w) => w.endLevel === 5), "0 -> +5 ways stay at +5 (no forced overshoot)");
    check(res.ways.every((w) => w.total >= 31 && w.total < 63), "0 -> +5 ways feed 31..62 points");
}

// ranking: minimise motes above Major (q6+), then save high tiers
{
    const inv = { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5, 9: 0, 10: 3 };
    const res = Mote.findWays(0, 5, inv);
    check(res.ok && res.total >= 2, "ranking case yields at least 2 ways");
    check(res.ways[0].highMotes === 0, "highest-ranked way uses no q6+ motes");
    check(res.ways[0].used[10] === 0, "highest-ranked way also spends no q10");
    const minHigh = Math.min.apply(null, res.ways.map((w) => w.highMotes));
    check(res.ways[0].highMotes === minHigh, "first way has the global minimum q6+ count");
    let sorted = true;
    for (let i = 1; i < res.ways.length; i++) {
        const a = res.ways[i - 1], b = res.ways[i];
        if (a.highMotes !== b.highMotes) { sorted = a.highMotes < b.highMotes; continue; }
        for (let q = 10; q >= 1; q--) {
            if (a.remaining[q] !== b.remaining[q]) {
                if (a.remaining[q] < b.remaining[q]) sorted = false;
                break;
            }
        }
    }
    check(sorted, "ways sorted: q6+ count, then remaining high-tier stock descending");

    // big appetite: q6+ motes are unavoidable and should still be minimized
    const inv2 = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 6, 6: 20, 7: 20, 8: 20, 10: 20 };
    const r2 = Mote.findWays(0, 8, inv2);
    check(r2.ok, "0 -> +8 case reachable");
    const min2 = Math.min.apply(null, r2.ways.map((w) => w.highMotes));
    check(r2.ways[0].highMotes === min2 &&
        r2.ways.every((w) => w.highMotes >= min2),
        "0 -> +8 first way uses the fewest q6+ motes of any way");
}

// carry changes the +10 math: feed q10s continuously, so 0 -> +10 with pure
// q10 costs 1030 pts (103 motes) -> 7 wasted, not 8.
{
    const inv = { 10: 103 };
    const res = Mote.findWays(0, 10, inv);
    check(res.ok, "0 -> +10 with 103 q10 is reachable");
    check(res.minWaste === 7, "0 -> +10 with only q10 wastes exactly 7");
    check(res.ways[0].motes === 103 && res.ways[0].total === 1030 &&
        res.ways[0].endLevel === 10 && res.ways[0].waste === 7,
        "uses all 103 q10 motes for 1030 pts, 7 lost at +10 (no +11)");
    check(res.ways[0].used[10] === 103, "all fed motes are q10");
    check(validate(res, 0, 10, inv), "0 -> +10 q10 ways validate");
}

// +9 -> +10 single level: needs a 512 pt net; a lone q10 mote overfeeds to 520
{
    const inv = { 10: 52 };
    const res = Mote.findWays(9, 10, inv);
    check(res.ok, "9 -> +10 with 52 q10 is reachable");
    check(res.minWaste === 8, "9 -> +10 wastes exactly 8 (520 - 512)");
    check(res.ways[0].motes === 52 && res.ways[0].total === 520,
        "9 -> +10 uses all 52 q10 motes for 520 pts");

    const withQ9 = { 9: 5, 10: 52 };
    const r2 = Mote.findWays(9, 10, withQ9);
    check(r2.ok && r2.minWaste === 8, "9 -> +10 still wastes 8 even with q9s owned");
    check(r2.ways[0].used[9] === 0, "q9 motes are unusable at +9 (only quality > 9)");
}

// quality restriction is a feeding-order rule: at +1 only q2+ usable
{
    const res = Mote.findWays(1, 2, { 1: 2, 10: 1 });
    check(res.ok, "1 -> +2 reachable");
    check(res.ways[0].used[1] === 0, "q1 motes are unusable while the item is at +1");
    const res2 = Mote.findWays(1, 2, { 2: 3 });
    check(res2.ok && res2.minWaste === 0 && res2.ways[0].used[2] === 2,
        "1 -> +2 with three q1-point (q2) motes: two q2 used, bank 0");
}

// q1 is only feedable as the very first mote (cumulative under CUM[1]=1)
{
    const res = Mote.findWays(0, 1, { 1: 3 });
    check(res.ok && res.ways.length === 1 && res.ways[0].used[1] === 1,
        "0 -> +1 from three q1 motes uses exactly one (window < 1 pt)");
    check(validate(res, 0, 1, { 1: 3 }), "0 -> +1 q1 way validates");
}

// errors
{
    const none = Mote.findWays(0, 5, {});
    check(!none.ok && /motes/i.test(none.error), "empty inventory rejected");
    const tiny = Mote.findWays(0, 5, { 1: 1 });
    check(!tiny.ok && /Not enough/i.test(tiny.error), "too few points rejected");
    const badRange = Mote.findWays(5, 5, { 1: 5 });
    check(!badRange.ok && /range/i.test(badRange.error), "start >= target rejected");
    // plenty of points, but no usable quality at the top: blocked by outleveling
    const blocked = Mote.findWays(0, 10, { 9: 200 });
    check(!blocked.ok && /pushed to \+9/.test(blocked.error),
        "reaching +10 with only q9 motes is rejected (item caps at +9)");
}

// dedup: each distinct mote multiset appears once
{
    const inv = { 2: 4, 4: 2, 8: 1 };
    const res = Mote.findWays(0, 3, inv);
    check(res.ok && res.minWaste === 0, "0 -> +3 reachable with mixed stock");
    const keys = new Set(res.ways.map((w) => w.used.join(",")));
    check(keys.size === res.ways.length, "no duplicate aggregate multisets listed");
    check(validate(res, 0, 3, inv), "0 -> +3 mixed ways validate");
}

// decompose: level-split rows for a small deterministic case
{
    const inv = { 2: 3 };
    const res = Mote.findWays(0, 2, inv);
    check(res.ok && res.total === 1, "0 -> +2 with three q2 motes: exactly one way");
    const w = res.ways[0];
    check(validate(res, 0, 2, inv), "0 -> +2 q2 way validates");
    check(w.steps.length === 2, "0 -> +2 splits into 2 level rows");
    check(w.steps[0].level === 0 && w.steps[0].carry === 0 &&
        w.steps[0].used[2] === 1 && w.steps[0].sum === 1 && w.steps[0].out === 0,
        "row +0 -> +1: one q2, exact, no bank");
    check(w.steps[1].level === 1 && w.steps[1].need === 2 &&
        w.steps[1].carry === 0 && w.steps[1].used[2] === 2 &&
        w.steps[1].sum === 2 && w.steps[1].out === 0,
        "row +1 -> +2: two q2, exact, no bank");
    check(w.bank === 0, "bank on the way is the top row's out");
}

// decompose: banked carry flows across rows on a heavier lot
{
    const inv = { 5: 5, 6: 4 };
    const res = Mote.findWays(0, 5, inv);
    check(res.ok, "0 -> +5 with majors + greaters is reachable");
    const w = res.ways[0];
    check(validate(res, 0, 5, inv), "0 -> +5 carry way validates");
    const top = w.steps[4];
    check(top.level === 4 && top.need === 16, "top row of 0 -> +5 is +4 -> +5 needing 16");
    check(top.carry + top.sum - top.need === top.out && top.out === w.bank,
        "top row carries exactly the way's ending bank");
}

// partial start: begin with points already fed toward the current level
{
    // at +1 with 1 pt already fed (cumulative = CUM[1] + 1 = 2), +1 -> +2 needs 1 more pt
    const inv = { 2: 2 };
    const r = Mote.findWays(1, 2, inv, { startCarry: 1 });
    check(r.ok, "1 -> +2 with 1 pt already fed is reachable");
    check(r.carried === 1 && r.ways[0].used[2] === 1 && r.ways[0].total === 1,
        "with 1 of 2 pt already fed, only a single 1-pt mote is needed");
    check(validate(r, 1, 2, inv, 1), "partial-start way validates");
    check(r.ways[0].steps[0].carry === 1 && r.ways[0].steps[0].need === 2,
        "first roadmap row shows the 1 pt already banked into the 2-pt level");

    // zero carried behaves exactly like the original model
    const r0 = Mote.findWays(1, 2, inv, { startCarry: 0 });
    check(r0.ok && r0.ways[0].total === 2 && r0.ways[0].used[2] === 2,
        "starting fresh at +1 still needs the full 2 pt");

    // carried >= the level requirement is rejected
    const bad = Mote.findWays(1, 2, inv, { startCarry: 2 });
    check(!bad.ok && /between 0 and 1/.test(bad.error),
        "carried >= level requirement rejected");

    // carried reduces the +10 math: 9 -> +10 with 40 pt already fed
    const r10 = Mote.findWays(9, 10, { 10: 48 }, { startCarry: 40 });
    check(r10.ok && r10.minWaste === 8 && r10.ways[0].total === 480,
        "9 -> +10 with 40/512 fed: feed 480, still wastes 8 (480 + 40 - 512)");
    check(validate(r10, 9, 10, { 10: 48 }, 40), "partial +10 way validates");
}

console.log("\nALL MOTE SOLVER CHECKS PASSED (" + passed + " assertions)");