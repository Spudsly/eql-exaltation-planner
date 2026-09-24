/*
 * EQ Legends Mote Optimizer - web tool.
 *
 * Powers an item from +start to +target with a mote inventory.
 *  - Being at +L costs CUM[L] points in total (1, 3, 7, 15, 31, ... 1023).
 *  - A mote of quality q adds VALUES[q] points and is usable only while the
 *    item is below +q (quality > current level).
 *  - Points always carry over: overshooting a level's requirement just banks
 *    progress toward the next level, so feeding extra is never per-level
 *    waste. The only waste is at the very end when the item is already +10
 *    (max) and fed points can no longer bank into anything.
 *
 * The solver finds every distinct lot of motes that reaches the target (a lot
 * must be feedable in quality-ascending order to satisfy the +q rule). Ways
 * are ranked by end waste, then by leaving the most high-tier motes, then by
 * fewest motes used. The model has no DOM dependencies; the UI wiring at the
 * bottom only runs when the tab markup is present.
 */
(function (global) {
    "use strict";

    // --------------------------------------------------------------- model
    const MAX_LEVEL = 10;
    const VALUES = [0, 1, 1, 2, 4, 5, 6, 7, 8, 9, 10];   // quality -> points
    const MOTES = [null,
        "Mote of Infinitesimal Potential", "Mote of Minor Potential",
        "Mote of Lesser Potential", "Mote of Potential",
        "Mote of Major Potential", "Mote of Greater Potential",
        "Mote of Superior Potential", "Mote of Grand Potential",
        "Mote of Ascendant Potential", "Mote of Infinite Potential",
    ];
    const QUALITIES = [];
    for (let q = 1; q <= MAX_LEVEL; q++) QUALITIES.push(q);
    const REQ = [];
    for (let l = 0; l < MAX_LEVEL; l++) REQ.push(1 << l);   // 1..512
    const CUM = [0];
    for (let l = 1; l <= MAX_LEVEL; l++) CUM.push(CUM[l - 1] + REQ[l - 1]);

    function moteLabel(q) {
        return MOTES[q] + " (q" + q + ")";
    }

    function sumPts(arr) {
        let s = 0;
        for (let q = 1; q <= MAX_LEVEL; q++) s += arr[q] * VALUES[q];
        return s;
    }
    function motesOf(arr) {
        let n = 0;
        for (let q = 1; q <= MAX_LEVEL; q++) n += arr[q];
        return n;
    }
    // motes of quality above Major (q6..q10) - the premium stock to conserve
    function motesAboveMajor(arr) {
        let n = 0;
        for (let q = 6; q <= MAX_LEVEL; q++) n += arr[q];
        return n;
    }
    function levelOf(cumAbs) {
        let l = 0;
        for (let k = 1; k <= MAX_LEVEL && CUM[k] <= cumAbs; k++) l = k;
        return l;
    }

    // one color per quality for the level-split bar chart
    const QCOLOR = ["", "#6e7681", "#58a6ff", "#79c0ff", "#7ee787",
        "#e3b341", "#f778ba", "#ffa657", "#ff7b72", "#bc8cff", "#f2cc60"];
    const QSHORT = ["", "Infini", "Minor", "Lesser", "Poten.", "Major",
        "Greater", "Superior", "Grand", "Ascend.", "Infinite"];
    const IMG = [];
    for (let q = 1; q <= MAX_LEVEL; q++) IMG[q] = "img/motes/mote" + q + ".png";

    // Split a feed lot into one bucket per level crossed (start..target-1):
    // what the item had banked on entry ("carry"), which motes are fed while
    // at that level ("used"), and how many points roll past the threshold
    // ("out"). Feeding is simulated in ascending quality order. The top row
    // also drains any surplus motes fed after the final threshold (they bank
    // toward the next level, or waste at +10), so the whole lot is accounted.
    function decompose(start, target, used, carried) {
        const fed = used.slice();
        const steps = [];
        let cum = CUM[start] + (carried || 0);
        let bank = carried || 0;
        for (let L = start; L < target; L++) {
            const need = REQ[L];
            const climb = {};
            let sum = 0;
            while (cum < CUM[L + 1]) {
                let qNext = -1;
                for (let q = L + 1; q <= MAX_LEVEL; q++) {
                    if (fed[q] > 0 && cum < CUM[q]) { qNext = q; break; }
                }
                if (qNext < 0) break;
                fed[qNext]--;
                cum += VALUES[qNext];
                sum += VALUES[qNext];
                climb[qNext] = (climb[qNext] || 0) + 1;
            }
            if (L === target - 1) {
                // drain the banked/wasted tail into the final row
                let qNext = 1;
                while (qNext > 0) {
                    qNext = -1;
                    for (let q = L + 1; q <= MAX_LEVEL; q++) {
                        if (fed[q] > 0 && cum < CUM[q]) { qNext = q; break; }
                    }
                    if (qNext < 0) break;
                    fed[qNext]--;
                    cum += VALUES[qNext];
                    sum += VALUES[qNext];
                    climb[qNext] = (climb[qNext] || 0) + 1;
                }
                for (let q = L + 1; q <= MAX_LEVEL; q++) {
                    if (fed[q] > 0) {   // safety net: never drop part of the lot
                        climb[q] = (climb[q] || 0) + fed[q];
                        sum += fed[q] * VALUES[q];
                        fed[q] = 0;
                    }
                }
            }
            steps.push({
                level: L,
                need: need,
                carry: bank,
                used: climb,
                sum: sum,
                out: (bank + sum) - need,
            });
            bank = steps[steps.length - 1].out;
        }
        return steps;
    }

    // Highest absolute cumulative reachable by feeding every legally usable
    // mote (simulated in ascending quality order, the maximally permissive
    // scheduling). Used as a cheap infeasibility check.
    function maxReach(start, inv, carried) {
        const stock = inv.slice();
        let cum = CUM[start] + (carried || 0);
        for (let q = start + 1; q <= MAX_LEVEL; q++) {
            while (stock[q] > 0 && cum < CUM[q]) {
                cum += VALUES[q];
                stock[q]--;
            }
        }
        return cum;
    }

    // Consecutive q-motes feedable from the current cumulative: the c-th feed
    // is legal while cumulative-before < CUM[q].
    function windowFits(q, cumAbs) {
        if (cumAbs >= CUM[q]) return 0;
        return Math.floor((CUM[q] - 1 - cumAbs) / VALUES[q]) + 1;
    }

    // rank full ways: least end waste, then fewest motes above Major (q6+),
    // then leave the most q10, then q9, ..., then fewest motes, then least
    // points fed.
    function cmpRank(a, b, inv) {
        if (a.waste !== b.waste) return a.waste - b.waste;
        if (a.highMotes !== b.highMotes) return a.highMotes - b.highMotes;
        for (let q = MAX_LEVEL; q >= 1; q--) {
            const ra = inv[q] - a.used[q];
            const rb = inv[q] - b.used[q];
            if (ra !== rb) return rb - ra;
        }
        if (a.motes !== b.motes) return a.motes - b.motes;
        return a.total - b.total;
    }

    // ----------------------------------------------------------------- API
    // inventory: {quality: count, ...} with qualities 1..10.
    // Returns { ok, error? } or { ok, ways, total, shown, truncated,
    //                            minWaste, overreach, start, target }.
    function findWays(start, target, inventory, opts) {
        opts = opts || {};
        const wasteCap = (opts.maxWasteTotal !== undefined ? opts.maxWasteTotal : 128);
        const maxStored = opts.maxStored || 50000;
        const showLimit = opts.showLimit || 50;
        const nodeCap = opts.nodeCap || 5000000;

        const inv = new Array(MAX_LEVEL + 1).fill(0);
        let totalPts = 0;
        for (const q of QUALITIES) {
            const n = Math.floor(Number(inventory ? inventory[q] : 0));
            inv[q] = n > 0 ? n : 0;
            totalPts += inv[q] * VALUES[q];
        }
        start = Math.floor(Number(start));
        target = Math.floor(Number(target));
        const carried = Math.floor(Number(opts.startCarry)) || 0;

        if (!inventory || totalPts === 0) {
            return { ok: false, error: "Enter how many motes you have of each quality first." };
        }
        if (!isFinite(start) || !isFinite(target) ||
            start < 0 || target > MAX_LEVEL || start >= target) {
            return { ok: false, error: "Pick a valid range: 0 \u2264 from < to \u2264 +" + MAX_LEVEL + "." };
        }
        if (carried < 0 || carried >= REQ[start]) {
            return { ok: false, error: "Points already fed into +" + start +
                " must be between 0 and " + (REQ[start] - 1) + "." };
        }
        const cum0 = CUM[start] + carried;
        const netNeed = CUM[target] - cum0;
        if (totalPts < netNeed) {
            return { ok: false, error: "Not enough mote points: you have " + totalPts +
                " total, but +" + start + " \u2192 +" + target + " still needs " + netNeed +
                " (" + carried + " pt" + (carried === 1 ? "" : "s") + " already fed)." };
        }
        const reach = maxReach(start, inv, carried);
        if (reach < CUM[target]) {
            return { ok: false, error: "With this inventory the item can only be pushed to +" +
                levelOf(reach) + ": some motes become unusable once the item outlevels their " +
                "quality (only quality > level motes can be fed)." };
        }

        // Enumerate distinct feed-lots (counts per quality, fed lowest quality
        // first) whose net fed points land in [totalLower, totalUpper].
        function search(totalLower, totalUpper) {
            const found = [];
            const budget = { nodes: 0, cut: false };
            const used = new Array(MAX_LEVEL + 1).fill(0);
            const maxRemain = new Array(MAX_LEVEL + 2).fill(0);
            for (let q = MAX_LEVEL; q >= 1; q--) {
                maxRemain[q] = maxRemain[q + 1] + inv[q] * VALUES[q];
            }
            let fed = 0;   // net points fed so far
            function rec(q) {
                budget.nodes++;
                if (budget.nodes > nodeCap) { budget.cut = true; return; }
                if (found.length >= maxStored) return;
                if (q > MAX_LEVEL) {
                    if (fed >= totalLower) found.push({ used: used.slice() });
                    return;
                }
                if (fed > totalUpper) return;
                if (fed + maxRemain[q] < totalLower) return;
                const maxC = Math.min(inv[q], windowFits(q, cum0 + fed),
                    (totalUpper - fed) / VALUES[q] | 0);
                for (let c = 0; c <= maxC; c++) {
                    if (c) { used[q] += c; fed += c * VALUES[q]; }
                    rec(q + 1);
                    if (budget.cut || found.length >= maxStored) {
                        if (c) { used[q] -= c; fed -= c * VALUES[q]; }
                        return;
                    }
                    if (c) { used[q] -= c; fed -= c * VALUES[q]; }
                }
            }
            rec(start + 1);
            return { found, budget };
        }

        // Target below max: any total that keeps the item at +target is
        // zero-waste (surplus banks). Fall back to the smallest forced
        // overshoot if no such lot exists.
        let foundAll = null;
        let winBudget = { cut: false };
        let overreach = false;
        if (target < MAX_LEVEL) {
            const lower = CUM[target] - cum0;
            const upper = CUM[target + 1] - cum0 - 1;
            let r = search(lower, upper);
            if (r.found.length) {
                foundAll = r.found;
                winBudget = r.budget;
            } else {
                overreach = true;
                const lo2 = CUM[target + 1] - cum0;
                const hi2 = Math.max(lo2 + wasteCap, reach - cum0);
                r = search(lo2, hi2);
                foundAll = r.found;
                winBudget = r.budget;
            }
        } else {
            // Target +10: surplus past netNeed cannot bank (no +11), so walk
            // the end waste upward until the first feasible lot.
            for (let w = 0; w <= wasteCap; w++) {
                const r = search(netNeed + w, netNeed + w);
                if (r.found.length) { foundAll = r.found; winBudget = r.budget; break; }
            }
        }

        if (!foundAll || !foundAll.length) {
            return { ok: false, error: target === MAX_LEVEL
                ? "No way to reach +" + target + " from +" + start + " without wasting more than " +
                  wasteCap + " points (nothing above +10 can carry)."
                : "No way to reach +" + target + " from +" + start + " within this inventory." };
        }

        const seen = new Map();
        for (const f of foundAll) {
            const key = f.used.join(",");
            if (!seen.has(key)) seen.set(key, f);
        }
        const ways = Array.from(seen.values()).map((w) => {
            const rem = new Array(MAX_LEVEL + 1).fill(0);
            for (let q = 1; q <= MAX_LEVEL; q++) rem[q] = inv[q] - w.used[q];
            const total = sumPts(w.used);
            const endLevel = levelOf(cum0 + total);
            return {
                used: w.used,
                remaining: rem,
                total: total,
                motes: motesOf(w.used),
                endLevel: endLevel,
                highMotes: motesAboveMajor(w.used),
                bank: endLevel === MAX_LEVEL ? 0 : (cum0 + total) - CUM[endLevel],
                waste: endLevel === MAX_LEVEL ? total - netNeed : 0,
                steps: decompose(start, target, w.used, carried),
            };
        });
        ways.sort((a, b) => cmpRank(a, b, inv));
        const truncated = winBudget.cut || ways.length > showLimit;

        return {
            ok: true,
            start: start,
            target: target,
            carried: carried,
            maxLevel: MAX_LEVEL,
            minWaste: ways[0].waste,
            overreach: overreach,
            total: ways.length,
            truncated: truncated,
            shown: Math.min(ways.length, showLimit),
            ways: ways.slice(0, showLimit),
        };
    }

    // ------------------------------------------------------------- UI wire
    function initUI() {
        const startSel = document.getElementById("startLevel");
        if (!startSel) return;   // module loaded in node without the page
        const targetSel = document.getElementById("targetLevel");
        const startCarry = document.getElementById("startCarry");
        const startCarryMax = document.getElementById("startCarryMax");
        const invBody = document.getElementById("invRows");
        const clearBtn = document.getElementById("clearInvBtn");
        const outTitle = document.getElementById("moteOutTitle");
        const outBody = document.getElementById("moteBody");
        if (!targetSel || !invBody || !outBody) return;

        for (let l = 0; l < MAX_LEVEL; l++) {
            const o = document.createElement("option");
            o.value = String(l);
            o.textContent = "+" + l;
            startSel.appendChild(o);
        }
        for (let l = 1; l <= MAX_LEVEL; l++) {
            const o = document.createElement("option");
            o.value = String(l);
            o.textContent = "+" + l;
            targetSel.appendChild(o);
        }
        startSel.value = "0";
        targetSel.value = "5";

        function syncCarry() {
            const s = Number(startSel.value);
            const mx = REQ[s] - 1;
            startCarry.max = String(mx);
            startCarryMax.textContent = "points (max " + mx + " at +" + s + ")";
            let v = startCarry.value === "" ? 0 : Math.floor(Number(startCarry.value));
            if (v < 0) v = 0;
            if (v > mx) v = mx;
            startCarry.value = String(v);
            return v;
        }

        const inputs = {};
        for (const q of QUALITIES) {
            const row = document.createElement("div");
            row.className = "inv-row";
            const img = document.createElement("img");
            img.className = "q-icon";
            img.src = IMG[q];
            img.alt = MOTES[q];
            const lbl = document.createElement("span");
            lbl.className = "q-name";
            lbl.textContent = MOTES[q];
            const pts = document.createElement("span");
            pts.className = "q-pts";
            pts.textContent = "(q" + q + " \u00b7 " + VALUES[q] + " pt" + (VALUES[q] > 1 ? "s" : "") + ")";
            const inp = document.createElement("input");
            inp.type = "number";
            inp.min = "0";
            inp.step = "1";
            inp.value = "0";
            inputs[q] = inp;
            inp.addEventListener("change", plan);
            row.appendChild(img);
            row.appendChild(lbl);
            row.appendChild(pts);
            row.appendChild(inp);
            invBody.appendChild(row);
        }

        function readInv() {
            const inv = {};
            for (const q of QUALITIES) {
                const v = Math.floor(Number(inputs[q].value));
                inv[q] = isFinite(v) && v > 0 ? v : 0;
            }
            return inv;
        }
        function setInv(obj) {
            for (const q of QUALITIES) inputs[q].value = String(obj[q] || 0);
        }
        function plan() {
            const start = Number(startSel.value);
            const target = Number(targetSel.value);
            const carried = syncCarry();
            render(outTitle, outBody, findWays(start, target, readInv(), { startCarry: carried }));
        }

        clearBtn.addEventListener("click", () => { setInv({}); startCarry.value = "0"; syncCarry(); plan(); });
        syncCarry();
        startSel.addEventListener("change", plan);
        startCarry.addEventListener("change", plan);
        targetSel.addEventListener("change", plan);

        setInv({ 1: 5, 2: 5, 3: 5, 4: 5, 5: 10, 6: 10, 7: 5, 8: 5, 9: 0, 10: 0 });
        plan();
    }

    function render(titleEl, bodyEl, res) {
        bodyEl.innerHTML = "";
        if (!res.ok) {
            titleEl.textContent = "Ways";
            bodyEl.appendChild(el2("div", "plan-note", res.error));
            bodyEl.appendChild(el2("div", "mote-hint",
                "Enter your inventory above and press \u201cPlan ways\u201d."));
            return;
        }
        titleEl.textContent = "From +" + res.start + (res.carried > 0
            ? " (" + res.carried + " pt fed)" : "") + " to +" + res.target +
            "  \u00b7  " + outcomeNote(res);
        const summary = document.createElement("div");
        summary.className = "mote-summary";
        let text = res.total + (res.total === 1 ? " way" : " ways") +
            " \u00b7 grouped by final level feed";
        if (res.target === res.maxLevel) {
            text += " \u00b7 best wastes " + res.minWaste + " pt at the end";
        } else if (res.overreach) {
            text += " \u00b7 unavoidably overshoots past +" + res.target;
        }
        summary.appendChild(el2("span", null, text));
        if (res.truncated) {
            summary.appendChild(el2("span", "plan-note",
                " Showing first " + res.shown + " of " + res.total + "."));
        }
        bodyEl.appendChild(summary);

        const groups = groupWays(res.ways);
        bodyEl.appendChild(legendFor(res.ways));
        const maxGroups = 12;
        groups.slice(0, maxGroups).forEach((g, i) =>
            bodyEl.appendChild(wayCard(g, i + 1)));
        if (groups.length > maxGroups) {
            bodyEl.appendChild(el2("div", "mote-hint",
                "showing " + maxGroups + " of " + groups.length +
                " final-step groupings."));
        }
    }

    function outcomeNote(res) {
        if (res.target === res.maxLevel) {
            return res.minWaste === 0
                ? "zero end-waste"
                : "end waste " + res.minWaste + " pt";
        }
        return res.overreach ? "overshoots past +" + res.target : "zero end-waste";
    }

    // Group ways that feed the final (top) level with the same motes and enter
    // it with the same banked points; they differ only in the setup levels.
    function lastSig(w) {
        const s = w.steps[w.steps.length - 1];
        const seg = [];
        for (let q = 1; q <= MAX_LEVEL; q++) {
            if (s.used[q]) seg.push(q + "x" + s.used[q]);
        }
        return s.carry + "|" + seg.join(",");
    }
    function groupWays(ways) {
        const order = [];
        const map = new Map();
        ways.forEach((w) => {
            const key = lastSig(w);
            if (!map.has(key)) { map.set(key, []); order.push(key); }
            map.get(key).push(w);
        });
        return order.map((k) => ({ key: k, ways: map.get(k) }));
    }

    function legendFor(ways) {
        const legend = document.createElement("div");
        legend.className = "road-legend";
        const seen = new Set();
        ways.forEach((w) => w.steps.forEach((s) => {
            for (let q = 1; q <= MAX_LEVEL; q++) if (s.used[q]) seen.add(q);
        }));
        seen.forEach((q) => {
            const item = document.createElement("span");
            item.className = "legend-item";
            const sw = document.createElement("img");
            sw.className = "legend-swatch";
            sw.src = IMG[q];
            sw.alt = MOTES[q];
            sw.title = MOTES[q] + " (q" + q + ")";
            item.appendChild(sw);
            item.appendChild(document.createTextNode(QSHORT[q] + " (q" + q + ")"));
            legend.appendChild(item);
        });
        return legend;
    }

    function wayCard(group, idx) {
        const w = group.ways[0];
        const card = document.createElement("div");
        card.className = "way-card";
        const head = document.createElement("div");
        head.className = "way-head";
        head.textContent = "Option " + idx + "  \u00b7  feed " + w.total + " pt" +
            (w.total > 1 ? "s" : "") + "  \u00b7  " + w.motes +
            " mote" + (w.motes === 1 ? "" : "s") + (w.highMotes > 0
                ? "  (" + w.highMotes + " above Major)" : "  (all Major or lower)") +
            "  \u00b7  reaches +" + w.endLevel +
            "  \u00b7  " + group.ways.length +
            (group.ways.length === 1 ? " way" : " ways") + " in this grouping";
        card.appendChild(head);

        card.appendChild(roadmap(w, w.endLevel === MAX_LEVEL));

        const remaining = group.ways.slice(1);
        if (remaining.length) {
            const det = document.createElement("details");
            det.className = "way-alts";
            const sum = document.createElement("summary");
            sum.textContent = "other ways to set up this top level (" + remaining.length + ")";
            det.appendChild(sum);
            remaining.forEach((alt) => {
                const lower = alt.steps.slice(0, -1)
                    .map((p) => fmtParts(p.used)).filter((t) => t !== "\u2014");
                const line = document.createElement("div");
                line.className = "way-alternate";
                line.textContent = "feed " + alt.total + " pt \u00b7 " + alt.motes +
                    " mote" + (alt.motes === 1 ? "" : "s") +
                    " \u00b7 " + alt.highMotes + " above Major" +
                    "  \u00b7  lower levels: " +
                    (lower.length ? lower.join("  \u2192  ") : "nothing");
                det.appendChild(line);
            });
            card.appendChild(det);
        }

        const note = document.createElement("div");
        note.className = "way-step";
        if (w.waste > 0) {
            note.appendChild(el2("span", "plan-note",
                w.waste + " pt" + (w.waste > 1 ? "s" : "") +
                " wasted at the end \u2014 the item is already +" + w.endLevel +
                " and no level above +10 exists to carry into."));
        } else if (w.bank > 0) {
            note.appendChild(el2("span", "mote-hint",
                w.bank + " pt banked toward +" + (w.endLevel + 1) +
                " \u2014 overshooting a level is not waste, it carries"));
        } else {
            note.appendChild(el2("span", "mote-hint",
                "exact \u2014 no leftover points."));
        }
        card.appendChild(note);
        return card;
    }

    // Vertical stack of level rows, the final level on top. Each row is
    // [level label] [bar] [description]: the bar's segments are the motes fed
    // at that level (dim block at the front = points already banked), and the
    // description spells out the exact feed in the same row.
    function roadmap(w, isMax) {
        const el = document.createElement("div");
        el.className = "roadmap";
        const steps = w.steps;
        for (let i = steps.length - 1; i >= 0; i--) {
            const s = steps[i];
            const top = i === 0;
            const row = document.createElement("div");
            row.className = "road-row";
            row.appendChild(el2("div", "road-label", "+" + s.level + " \u2192 +" + (s.level + 1)));
            const track = document.createElement("div");
            track.className = "road-track";
            const segs = [];
            const total = s.carry + s.sum;
            if (total > 0) {
                if (s.carry > 0) {
                    segs.push({ cls: "carry", color: "", w: (s.carry / total) * 100,
                        label: s.carry + " pt",
                        tip: s.carry + " pt already banked when reaching +" + s.level });
                }
                for (let q = 1; q <= MAX_LEVEL; q++) {
                    if (s.used[q]) segs.push({
                        cls: "q" + q, color: QCOLOR[q],
                        w: ((s.used[q] * VALUES[q]) / total) * 100,
                        label: s.used[q] + "\u00d7 " + QSHORT[q],
                        tip: s.used[q] + "\u00d7 " + moteLabel(q) + " = " +
                            (s.used[q] * VALUES[q]) + " pt fed at +" + s.level,
                    });
                }
                segs.forEach((x) => {
                    const seg = document.createElement("div");
                    seg.className = "road-seg " + x.cls;
                    seg.style.width = x.w + "%";
                    if (x.cls !== "carry") seg.style.background = x.color;
                    seg.title = x.tip;
                    if (x.label && x.w >= 17) {
                        const tag = document.createElement("span");
                        tag.className = "road-tag";
                        tag.textContent = x.label;
                        seg.appendChild(tag);
                    }
                    track.appendChild(seg);
                });
            }
            row.appendChild(track);
            const bits = [];
            for (let q = 1; q <= MAX_LEVEL; q++) {
                if (s.used[q]) bits.push(s.used[q] + "\u00d7 " + moteLabel(q));
            }
            let txt = (bits.length ? bits.join(", ") : "\u2014") + " = " + s.sum + " pt";
            if (s.carry > 0) txt += " (" + s.carry + " pt banked)";
            if (s.out > 0) txt += " +" + s.out + (top && isMax ? " wasted" : " carries over");
            row.appendChild(el2("div", "road-desc", txt));
            el.appendChild(row);
        }
        return el;
    }

    function fmtParts(used) {
        const out = [];
        for (let q = 1; q <= MAX_LEVEL; q++) {
            if (used[q] > 0) out.push(moteLabel(q) + "\u00d7" + used[q]);
        }
        return out.length ? out.join(", ") : "\u2014";
    }

    function el2(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    const Mote = {
        MAX_LEVEL: MAX_LEVEL,
        VALUES: VALUES,
        MOTES: MOTES,
        QUALITIES: QUALITIES,
        REQ: REQ,
        CUM: CUM,
        findWays: findWays,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = Mote;
    } else {
        global.Mote = Mote;
    }

    if (typeof document !== "undefined") {
        initUI();
    }
})(typeof window !== "undefined" ? window : globalThis);