/*
 * EverQuest Legends Exaltation Focus Planner - JavaScript port.
 *
 * Faithful port of planner.py so the web app produces exactly the same plans
 * as the desktop tool. Parity is verified by web/test_parity.js against golden
 * output from the Python planner. No DOM dependencies.
 */

(function (global) {
    "use strict";

    const CLASSES = {
        WAR: "Warrior",  CLR: "Cleric",   PAL: "Paladin",  RNG: "Ranger",
        SHD: "Shadow Knight", DRU: "Druid", MNK: "Monk",    BRD: "Bard",
        ROG: "Rogue",   SHM: "Shaman",  NEC: "Necromancer", WIZ: "Wizard",
        MAG: "Magician", ENC: "Enchanter", BST: "Beastlord", BER: "Berserker",
    };

    const SUPER = {
        "Affliction Efficiency": "Damage",
        "Affliction Haste": "Damage",
        "Burning Affliction": "Damage",
        "Improved Damage": "Damage",
        "Lifetap": "Damage",
        "Improved Healing": "Healing & Mitigation",
        "Health and Mana": "Healing & Mitigation",
        "Mana Preservation": "Healing & Mitigation",
        "Reagent Conservation": "Healing & Mitigation",
        "Extended Enhancement": "Buffs & Utility",
        "Enhancement Haste": "Buffs & Utility",
        "Spell Haste": "Buffs & Utility",
        "Extended Range": "Buffs & Utility",
        "Summoning Haste": "Pets",
        "Summoning Efficiency": "Pets",
        "Reanimation Haste": "Pets",
        "Reanimation Efficiency": "Pets",
        "Bard Instrument": "Bard Instruments",
    };
    const SUPER_ORDER = [
        "Damage", "Healing & Mitigation", "Buffs & Utility",
        "Pets", "Bard Instruments", "Other",
    ];
    const SUPER_COLOR = {
        "Damage": "#ff9d8a",
        "Healing & Mitigation": "#7fe0a8",
        "Buffs & Utility": "#9fd0ff",
        "Pets": "#e0b1ff",
        "Bard Instruments": "#f4d35e",
        "Other": "#a8b6ca",
    };

    // physical equipment slots, in the order they are listed in the gear
    // column and both right-hand panels
    const GEAR_SLOTS = [
        "EARS", "EARS #2",
        "NECK", "FACE", "HEAD",
        "FINGERS", "FINGERS #2",
        "WRIST", "WRIST #2",
        "ARMS", "HANDS", "SHOULDERS", "CHEST", "BACK", "WAIST", "LEGS",
        "FEET",
        "PRIMARY", "SECONDARY", "RANGE",
    ];
    const GEAR_LABEL = {
        "EARS": "LEFT EAR", "EARS #2": "RIGHT EAR",
        "FINGERS": "LEFT RING", "FINGERS #2": "RIGHT RING",
        "WRIST": "LEFT WRIST", "WRIST #2": "RIGHT WRIST",
        "FEET": "BOOTS",
    };
    const GEAR_SIDE_LABEL = {
        "EARS": "LEFT EAR / RIGHT EAR",
        "FINGERS": "LEFT RING / RIGHT RING",
        "WRIST": "LEFT WRIST / RIGHT WRIST",
    };
    const REGION_RANK = {};
    GEAR_SLOTS.forEach(function (b) {
        const d = display_region(b);
        if (!(d in REGION_RANK)) REGION_RANK[d] = Object.keys(REGION_RANK).length;
    });
    const BIT_INDEX = {};
    GEAR_SLOTS.forEach(function (b, i) { BIT_INDEX[b] = i; });
    ["ANY 1", "ANY 2"].forEach(function (b) {
        BIT_INDEX[b] = Object.keys(BIT_INDEX).length;
    });
    const ANY_LABEL_BIT = {};
    GEAR_SLOTS.forEach(function (b) { ANY_LABEL_BIT[GEAR_LABEL[b] || b] = b; });
    const ANY_NONE = "\u2014 choose slot \u2014";
    const SLOT_GROUP = {
        "PRIMARY SECONDARY": ["PRIMARY", "SECONDARY"],
        "RANGE PRIMARY SECONDARY": ["RANGE", "PRIMARY", "SECONDARY"],
        "EAR": ["EARS"],
        "FINGER": ["FINGERS"],
        "HANDS": ["HANDS"],
    };

    function gear_labels(regions) {
        return regions.map(function (r) {
            return GEAR_SIDE_LABEL[r] || GEAR_LABEL[r] || r;
        });
    }

    function slot_regions(bucket) {
        return SLOT_GROUP[bucket] || [bucket];
    }

    function is_instrument_mod(name) {
        return name.startsWith("Brass Resonance") ||
            name.startsWith("Percussion Resonance") ||
            name.startsWith("String Resonance") ||
            name.startsWith("Wind Resonance");
    }

    const PROC_AUGMENTS = new Set(["Lifebite"]);
    function is_proc_augment(name) { return PROC_AUGMENTS.has(name); }

    const ROMAN_RANK_RE = /^(.*?)\s+(V|IV|III|II|I)$/;
    const NUM_RANK_RE = /^(.*?):\s*(\d+)$/;
    const ROMAN_VALUE = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

    function effect_family(name) {
        let m = ROMAN_RANK_RE.exec(name);
        if (m) return m[1];
        m = NUM_RANK_RE.exec(name);
        if (m) return m[1].trim();
        return name;
    }

    function effect_rank(name) {
        let m = ROMAN_RANK_RE.exec(name);
        if (m) return ROMAN_VALUE[m[2]];
        m = NUM_RANK_RE.exec(name);
        if (m) return parseInt(m[2], 10);
        return 0;
    }

    function max_rank_per_family(effects) {
        // preserve insertion order, like the Python dict
        const best = {};
        Object.keys(effects).forEach(function (name) {
            const fam = effect_family(name);
            if (!(fam in best) || effect_rank(name) > effect_rank(best[fam])) {
                best[fam] = name;
            }
        });
        const out = {};
        Object.keys(best).forEach(function (fam) {
            const name = best[fam];
            out[name] = JSON.parse(JSON.stringify(effects[name]));
        });
        return out;
    }

    function class_filter(data, trio) {
        const trio_set = new Set(trio);
        const items = [];
        (data.items || []).forEach(function (it) {
            if (!(it.effects || []).length) return;
            const cls = it.classes || [];
            const usable = cls.indexOf("ALL") >= 0 || cls.some((c) => trio_set.has(c));
            if (usable) items.push(it);
        });
        return items;
    }

    function focus_effects_available(data, items, trio_set) {
        trio_set = new Set(trio_set);
        const ref = data.focus_reference || {};

        const effect_sources = {};
        items.forEach(function (it) {
            (it.effects || []).forEach(function (e) {
                if ((e.type || "") !== "focus") return;
                const name = e.name;
                if (!effect_sources[name]) effect_sources[name] = [];
                effect_sources[name].push({
                    item: it.name,
                    slot: it.slot,
                    classes: it.classes || [],
                });
            });
        });

        const effects = {};
        Object.keys(effect_sources).forEach(function (name) {
            if (is_proc_augment(name)) return;
            const info = ref[name] || {};
            effects[name] = {
                category: info.category || "",
                tier: info.tier || "",
                description: info.description || "",
                sources: effect_sources[name],
            };
        });

        if (trio_set.has("BRD")) {
            const withBard = {};
            Object.keys(effects).forEach(function (n) {
                const e = effects[n];
                withBard[n] = is_instrument_mod(n)
                    ? Object.assign({}, e, { category: e.category || "Bard Instrument" })
                    : e;
            });
            return withBard;
        }
        const noBard = {};
        Object.keys(effects).forEach(function (n) {
            if (!is_instrument_mod(n)) noBard[n] = effects[n];
        });
        return noBard;
    }

    function format_slot_options(effect) {
        const by_slot = {};
        (effect.sources || []).forEach(function (s) {
            const slot = s.slot || "?";
            if (!by_slot[slot]) by_slot[slot] = [];
            if (by_slot[slot].indexOf(s.item) < 0) by_slot[slot].push(s.item);
        });
        return by_slot;
    }

    function _plan_regions(bucket) {
        const map = {
            "PRIMARY SECONDARY": ["PRIMARY", "SECONDARY"],
            "RANGE PRIMARY SECONDARY": ["RANGE", "PRIMARY", "SECONDARY"],
            EAR: ["EARS"],
            FINGER: ["FINGERS"],
        };
        return map[bucket] || [bucket];
    }

    function _slot_bits(region) {
        if (region === "EARS") return ["EARS", "EARS #2"];
        if (region === "FINGERS") return ["FINGERS", "FINGERS #2"];
        if (region === "WRIST") return ["WRIST", "WRIST #2"];
        return [region];
    }

    function display_region(region) {
        return region.endsWith(" #2") ? region.slice(0, -3) : region;
    }

    function _pin_slot(bit) {
        return { EARS: "EAR", FINGERS: "FINGER" }[bit] || bit;
    }

    // ------------------------------------------------------------- optimizer
    const NEG_CNT = -1000000000;

    function family_chain(all_effects, name) {
        const list = [];
        Object.keys(all_effects || {}).forEach(function (n) {
            if (effect_family(n) === effect_family(name)) list.push(n);
        });
        list.sort(function (a, b) { return effect_rank(b) - effect_rank(a); });
        return list;
    }

    function optimizeOnce(effects, chosen_names, trio, forced, gear_ok, any_slots,
            all_effects) {
        forced = forced || {};
        gear_ok = gear_ok || {};
        const trio_set = new Set(trio);
        const RANK_SCALE = 1000000;

        function classes_in(bit) {
            const allowed = gear_ok[bit];
            return allowed !== undefined ? new Set(allowed) : new Set(trio_set);
        }
        function is_all(cls) { return (cls || []).indexOf("ALL") >= 0; }
        function countMissing(allowedSet, clsSet) {
            let n = 0;
            allowedSet.forEach(function (c) { if (!clsSet.has(c)) n++; });
            return n;
        }
        function keepRegion(regions, bit, rankv, excluded, item, rankName) {
            const cur = regions[bit];
            if (cur === undefined || rankv > cur[0] ||
                (rankv === cur[0] && excluded < cur[1])) {
                regions[bit] = [rankv, excluded, item, rankName];
            }
        }
        function overlap(a, b) {
            for (const c of a) { if (b.has(c)) return true; }
            return false;
        }

        // wildcard sockets -> one extra placement target of its chosen type
        const any_names = [];
        const any_meta = [];   // [base region, allowed set]
        (any_slots || []).forEach(function (a, aindex) {
            const base = display_region((a && a.slot) || "");
            if (!base) return;
            const allowed = a.classes !== undefined && a.classes !== null
                ? new Set(a.classes) : new Set(trio_set);
            if (allowed.size === 0) return;
            any_names.push("ANY " + (aindex + 1));
            any_meta.push([base, allowed]);
        });

        const procs = chosen_names.filter(is_proc_augment);
        const fams = [];
        const fams_name = [];
        const rank_to_fam = {};
        const noChoice = [];
        const slot_index = {};
        const item_bucket = {};
        const sorted_chosen = chosen_names.slice().sort(function (a, b) {
            const cA = effects[a] ? (effects[a].category || "") : "";
            const cB = effects[b] ? (effects[b].category || "") : "";
            if (cA < cB) return -1;
            if (cA > cB) return 1;
            return a < b ? -1 : a > b ? 1 : 0;
        });
        sorted_chosen.forEach(function (name) {
            if (is_proc_augment(name)) return;
            const e = effects[name] || {};
            let chain = all_effects ? family_chain(all_effects, name) : [name];
            if (chain.indexOf(name) < 0) chain = [name];
            const regions = {};
            chain.forEach(function (cname) {
                const ce = effects[cname] || {};
                const rankv = RANK_SCALE * effect_rank(cname);
                (ce.sources || []).forEach(function (s) {
                    const bucket = s.slot;
                    if (!bucket) return;
                    const cls = new Set(s.classes || []);
                    _plan_regions(bucket).forEach(function (region) {
                        _slot_bits(region).forEach(function (bit) {
                            const allowed = classes_in(bit);
                            if (allowed.size === 0) return;
                            if (!is_all(s.classes) && !overlap(allowed, cls)) return;
                            const excluded = is_all(s.classes) ? 0 :
                                countMissing(allowed, cls);
                            keepRegion(regions, bit, rankv, excluded, s.item, cname);
                            item_bucket[s.item] = bucket;
                            if (!(bit in slot_index)) {
                                slot_index[bit] = Object.keys(slot_index).length;
                            }
                        });
                    });
                    for (let i = 0; i < any_names.length; i++) {
                        const any_name = any_names[i];
                        const any_base = any_meta[i][0];
                        const any_allowed = any_meta[i][1];
                        if (_plan_regions(bucket).indexOf(any_base) < 0) continue;
                        if (!is_all(s.classes) && !overlap(any_allowed, cls)) continue;
                        const excluded = is_all(s.classes) ? 0 :
                            countMissing(any_allowed, cls);
                        keepRegion(regions, any_name, rankv, excluded, s.item, cname);
                        item_bucket[s.item] = bucket;
                        if (!(any_name in slot_index)) {
                            slot_index[any_name] = Object.keys(slot_index).length;
                        }
                    }
                });
            });
            if (Object.keys(regions).length === 0) {
                noChoice.push(name);
                return;
            }
            chain.forEach(function (cname) { rank_to_fam[cname] = name; });
            fams.push(regions);
            fams_name.push(name);
        });

        const nslots = Object.keys(slot_index).length;
        const size = nslots ? 1 << nslots : 1;
        const region_names = new Array(nslots);
        Object.keys(slot_index).forEach(function (bit) {
            region_names[slot_index[bit]] = bit;
        });

        const max_opts = fams.reduce(function (mx, m) {
            return Math.max(mx, Object.keys(m).length);
        }, 1);
        const scarce = fams.map((m) => max_opts - Object.keys(m).length + 1);

        function better(cand, cur) {
            return cand[0] > cur[0] ||
                (cand[0] === cur[0] && cand[1] > cur[1]) ||
                (cand[0] === cur[0] && cand[1] === cur[1] && cand[2] < cur[2]);
        }

        // split forced vs free, keeping processing order
        const forced_names_set = new Set();
        fams_name.forEach(function (n) {
            if (n in forced &&
                new Set((effects[n].sources || []).map((s) => s.slot))
                    .has(_pin_slot(forced[n]))) {
                forced_names_set.add(n);
            }
        });
        const order = [];
        fams_name.forEach(function (n, i) { if (forced_names_set.has(n)) order.push(i); });
        fams_name.forEach(function (n, i) { if (!forced_names_set.has(n)) order.push(i); });
        const seq_name = order.map((i) => fams_name[i]);
        const seq_opt = order.map((i) => fams[i]);
        const seq_scarce = order.map((i) => scarce[i]);
        const forced_names = seq_name.filter((n) => forced_names_set.has(n));

        // a pin must actually be honoured: restrict each forced effect to the
        // regions its pinned bucket covers, not every region it could use
        const forced_regions = seq_name.map(function (name) {
            if (!forced_names_set.has(name)) return null;
            const regs = new Set();
            _plan_regions(_pin_slot(forced[name])).forEach(function (r) {
                _slot_bits(r).forEach((b) => regs.add(b));
            });
            return regs;
        });

        function allocArrays() {
            return {
                cnt: new Int32Array(size).fill(NEG_CNT),
                scar: new Int32Array(size).fill(NEG_CNT),
                pen: new Int32Array(size).fill(1000000000),
                parMask: new Int32Array(size).fill(-1),
                parStep: new Int16Array(size).fill(-1),
                parReg: new Int16Array(size).fill(-1),
            };
        }
        function copyArrays(src) {
            return {
                cnt: new Int32Array(src.cnt),
                scar: new Int32Array(src.scar),
                pen: new Int32Array(src.pen),
                parMask: new Int32Array(src.parMask),
                parStep: new Int16Array(src.parStep),
                parReg: new Int16Array(src.parReg),
            };
        }

        function applyStep(dp, m, scarceVal, j, forceOnly, capture, par2) {
            // reads old `dp`, writes fresh `ndp` (copy semantics, matching the
            // Python ndp = dp[:] so one effect's regions never chain together).
            // Loop order mirrors Python: mask outermost, regions innermost,
            // so equal-value ties resolve exactly as in planner.py.
            const regions = Object.keys(m);
            const ndp = forceOnly ? allocArrays() : copyArrays(dp);
            for (let mask = 0; mask < size; mask++) {
                if (dp.cnt[mask] < 0) continue;
                for (let r = 0; r < regions.length; r++) {
                    const region = regions[r];
                    const bit = 1 << slot_index[region];
                    if (mask & bit) continue;
                    const nm = mask | bit;
                    const entry = m[region];
                    const candCnt = dp.cnt[mask] + 1;
                    const candScar = dp.scar[mask] + scarceVal + entry[0];
                    const candPen = dp.pen[mask] + entry[1];
                    if (better([candCnt, candScar, candPen],
                            [ndp.cnt[nm], ndp.scar[nm], ndp.pen[nm]])) {
                        ndp.cnt[nm] = candCnt;
                        ndp.scar[nm] = candScar;
                        ndp.pen[nm] = candPen;
                        ndp.parMask[nm] = mask;
                        ndp.parStep[nm] = j;
                        ndp.parReg[nm] = slot_index[region];
                        if (capture) par2[j].set(nm, [mask, slot_index[region]]);
                    }
                }
            }
            return ndp;
        }

        function runDp(capture) {
            let dp = allocArrays();
            dp.cnt[0] = 0; dp.scar[0] = 0; dp.pen[0] = 0;
            let par2 = capture ? seq_name.map(() => new Map()) : null;
            let broken_forced = null;
            for (let j = 0; j < seq_name.length; j++) {
                const forced_step = j < forced_names.length;
                let m = seq_opt[j];
                if (forced_step) {
                    // forced: only the pinned rank, and only regions of the
                    // pinned bucket (forced_regions)
                    const filtered = {};
                    Object.keys(m).forEach(function (r) {
                        const entry = m[r];
                        if (entry[3] !== seq_name[j]) return;
                        if (forced_regions[j] && forced_regions[j].size &&
                            !forced_regions[j].has(r)) return;
                        filtered[r] = entry;
                    });
                    m = filtered;
                }
                dp = applyStep(dp, m, seq_scarce[j], j, forced_step, capture, par2);
                if (forced_step) {
                    let allNeg = true;
                    for (let x = 0; x < size; x++) {
                        if (dp.cnt[x] >= 0) { allNeg = false; break; }
                    }
                    if (allNeg) {
                        // forced pins mutually impossible -> degrade to free
                        dp = allocArrays();
                        dp.cnt[0] = 0; dp.scar[0] = 0; dp.pen[0] = 0;
                        par2 = capture ? seq_name.map(() => new Map()) : null;
                        broken_forced = new Set(forced_names);
                        for (let j2 = 0; j2 < seq_name.length; j2++) {
                            dp = applyStep(dp, seq_opt[j2], seq_scarce[j2],
                                j2, false, capture, par2);
                        }
                        break;
                    }
                }
            }
            let best = 0;
            for (let mask = 1; mask < size; mask++) {
                const cBest = dp.cnt[best], sBest = dp.scar[best], pBest = dp.pen[best];
                const cM = dp.cnt[mask], sM = dp.scar[mask], pM = dp.pen[mask];
                const gt = cM > cBest ||
                    (cM === cBest && sM > sBest) ||
                    (cM === cBest && sM === sBest && pM < pBest);
                if (gt) best = mask;
            }
            return { dp: dp, best: best, broken_forced: broken_forced, par2: par2 };
        }

        function rebuild(par, best_mask) {
            const plan = [];
            let mask = best_mask;
            while (mask && par.parMask[mask] !== -1) {
                const prev = par.parMask[mask];
                const j = par.parStep[mask];
                const region = region_names[par.parReg[mask]];
                const entry = seq_opt[j][region];
                plan.push([entry[3], item_bucket[entry[2]], region, entry[2], entry[1]]);
                mask = prev;
            }
            plan.reverse();
            return plan;
        }

        function rebuildStrict(par2, best_mask) {
            const plan = [];
            let mask = best_mask;
            let bound = par2.length;
            while (mask) {
                let picked = null;
                for (let j = bound - 1; j >= 0; j--) {
                    const rec = par2[j].get(mask);
                    if (rec !== undefined) { picked = [j, rec]; break; }
                }
                if (picked === null) break;
                const j = picked[0];
                const prev = picked[1][0];
                const region = region_names[picked[1][1]];
                const entry = seq_opt[j][region];
                plan.push([entry[3], item_bucket[entry[2]], region, entry[2], entry[1]]);
                mask = prev;
                bound = j;
            }
            plan.reverse();
            return plan;
        }

        let r = runDp(false);
        let plan = rebuild(r.dp, r.best);
        const names_in_plan = plan.map((p) => p[0]);
        if (new Set(names_in_plan).size !== names_in_plan.length ||
            plan.length !== r.dp.cnt[r.best]) {
            r = runDp(true);
            plan = rebuildStrict(r.par2, r.best);
            const strict_names = plan.map((p) => p[0]);
            if (new Set(strict_names).size !== strict_names.length) {
                throw new Error("plan places an effect twice");
            }
            if (plan.length !== r.dp.cnt[r.best]) {
                throw new Error("plan length does not match optimal count");
            }
        }

        const placed = new Set(plan.map((p) => p[0]));
        const max_to_idx = {};
        fams_name.forEach(function (n, i) { max_to_idx[n] = i; });
        const placed_fams = new Set(plan.map(function (p) {
            return rank_to_fam[p[0]] !== undefined ? rank_to_fam[p[0]] : p[0];
        }));
        const not_honored = [];
        if (r.broken_forced) {
            r.broken_forced.forEach(function (n) {
                if (!placed_fams.has(n)) not_honored.push(n);
            });
        }
        const occupant = {};
        plan.forEach(function (p) {
            if (!occupant[p[2]]) occupant[p[2]] = [];
            occupant[p[2]].push(p[0]);
        });
        const clashes = {};
        fams_name.forEach(function (n) {
            if (placed_fams.has(n)) return;
            const opts = fams[max_to_idx[n]];
            const only = Object.keys(opts).filter((r) => r in occupant);
            if (only.length) clashes[n] = only.map((r) => [r, occupant[r]]);
        });
        const why_here = {};
        plan.forEach(function (p) {
            if (!p[4]) return;
            const idx = max_to_idx[rank_to_fam[p[0]] !== undefined ? rank_to_fam[p[0]] : p[0]];
            const opts = fams[idx];
            const others = Object.keys(opts).filter((r) => r !== p[2]);
            const details = [];
            others.forEach(function (r) {
                const holders = occupant[r];
                if (holders) details.push([r, holders.slice().sort().join(", ")]);
                else details.push([r, "free"]);
            });
            why_here[p[0]] = details;
        });
        const stats = {
            total: fams.length + noChoice.length,
            placed: plan.length,
            restricted: plan.filter((p) => p[4]).length,
            conflicts: noChoice.concat(fams_name.filter((n) => !placed_fams.has(n))),
            clashes: clashes,
            why_here: why_here,
            procs: procs,
            not_honored: not_honored,
        };
        return { plan: plan, stats: stats };
    }

    function lower_rank_name(all_effects, name) {
        if (!all_effects) return null;
        const fam = effect_family(name);
        const rank = effect_rank(name);
        let best = null;
        let bestR = 0;
        Object.keys(all_effects).forEach(function (n) {
            if (effect_family(n) !== fam) return;
            const r = effect_rank(n);
            if (r > 0 && r < rank && r > bestR) { best = n; bestR = r; }
        });
        return best;
    }

    function family_chain(all_effects, name) {
        const list = [];
        Object.keys(all_effects || {}).forEach(function (n) {
            if (effect_family(n) === effect_family(name)) list.push(n);
        });
        list.sort(function (a, b) { return effect_rank(b) - effect_rank(a); });
        return list;
    }

    function optimize_plan(effects, chosen_names, trio, forced, gear_ok, any_slots,
            all_effects) {
        forced = forced || {};
        gear_ok = gear_ok || {};
        all_effects = all_effects || null;
        const pool = {};
        Object.keys(effects).forEach((n) => { pool[n] = effects[n]; });
        if (all_effects) {
            Object.keys(all_effects).forEach(function (n) {
                if (!(n in pool)) pool[n] = all_effects[n];
            });
        }
        const res = optimizeOnce(pool, chosen_names, trio, forced, gear_ok,
            any_slots, all_effects);
        // report which placed tiers fall below what the player actually asked for
        const fam_max = {};
        Object.keys(pool).forEach(function (n) {
            const f = effect_family(n);
            if (fam_max[f] === undefined ||
                effect_rank(n) > effect_rank(fam_max[f])) {
                fam_max[f] = n;
            }
        });
        const fell_back = {};
        res.plan.forEach(function (row) {
            const want = fam_max[effect_family(row[0])] !== undefined
                ? fam_max[effect_family(row[0])] : row[0];
            if (want !== row[0]) fell_back[row[0]] = want;
        });
        res.stats.fell_back = fell_back;
        return res;
    }

    const Planner = {
        CLASSES: CLASSES,
        SUPER: SUPER,
        SUPER_ORDER: SUPER_ORDER,
        SUPER_COLOR: SUPER_COLOR,
        GEAR_SLOTS: GEAR_SLOTS,
        GEAR_LABEL: GEAR_LABEL,
        GEAR_SIDE_LABEL: GEAR_SIDE_LABEL,
        REGION_RANK: REGION_RANK,
        BIT_INDEX: BIT_INDEX,
        ANY_LABEL_BIT: ANY_LABEL_BIT,
        ANY_NONE: ANY_NONE,
        gear_labels: gear_labels,
        slot_regions: slot_regions,
        is_instrument_mod: is_instrument_mod,
        is_proc_augment: is_proc_augment,
        effect_family: effect_family,
        effect_rank: effect_rank,
        max_rank_per_family: max_rank_per_family,
        class_filter: class_filter,
        focus_effects_available: focus_effects_available,
        format_slot_options: format_slot_options,
        _plan_regions: _plan_regions,
        _slot_bits: _slot_bits,
        display_region: display_region,
        _pin_slot: _pin_slot,
        optimize_plan: optimize_plan,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = Planner;
    } else {
        global.Planner = Planner;
    }
})(typeof window !== "undefined" ? window : globalThis);