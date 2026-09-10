/* EQ Legends Exaltation Planner - web UI.
 * Ports gui.py's interactions verbatim: trio picker, gear restrictions +
 * any sockets, desired-focus checklist, force-specific-choice build list,
 * and the auto-refreshing Best path panel. planner.js is the Python-faithful
 * solver. */
"use strict";

(function () {
    const $ = (s) => document.querySelector(s);

    // ------------------------------------------------------------- constants
    const CLASS_CODES = Object.keys(Planner.CLASSES);
    const NAME_TO_CODE = {};
    const CLASS_NAMES = CLASS_CODES.map((c) => Planner.CLASSES[c]).sort();
    CLASS_NAMES.forEach((n) => {
        for (const c of CLASS_CODES) {
            if (Planner.CLASSES[c] === n) NAME_TO_CODE[n] = c;
        }
    });
    const ANY_LABEL_OPTIONS = [Planner.ANY_NONE].concat(
        Planner.GEAR_SLOTS.map((b) => Planner.GEAR_LABEL[b] || b)
    );
    const DONATE_URL = "https://buymeacoffee.com/spudsly";

    // ------------------------------------------------------------- state
    let data = null;
    let effects = {};
    let effectsAll = {};
    let trio = [];
    let checkVars = {};
    let superMembers = {};
    let itemChoices = {};
    let gearVars = {};
    let anySel = { "ANY 1": "", "ANY 2": "" };
    let anyVars = { "ANY 1": {}, "ANY 2": {} };
    let highVars = {};
    let currentHighSet = new Set();

    const gearBody = $("#gearBody");
    const checkBody = $("#checkBody");
    const buildBody = $("#buildBody");
    const planBody = $("#planBody");
    const planTitle = $("#planTitle");

    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function setStatus(text) {
        $("#status").textContent = text;
    }

    function chosenNames() {
        return Object.keys(checkVars).filter((n) => checkVars[n]);
    }

    function itemInfo(name) {
        return (data && data.items || []).find((it) => it.name === name) || null;
    }

    function trioUsable(itemClasses, theTrio) {
        if (!itemClasses || itemClasses.indexOf("ALL") >= 0) return theTrio.slice();
        return theTrio.filter((c) => itemClasses.indexOf(c) >= 0);
    }

    function classesNote(itemClasses, theTrio) {
        const ok = trioUsable(itemClasses, theTrio);
        if (!ok.length || ok.length === theTrio.length) return "";
        return ok.join("/");
    }

    function superOf(category) {
        return Planner.SUPER[category] || "Other";
    }

    function superColor(sup) {
        return Planner.SUPER_COLOR[sup] || Planner.SUPER_COLOR.Other;
    }

    function bucketKey(bucket) {
        const regions = Planner.slot_regions(bucket);
        const idx = regions.map((r) =>
            (Planner.REGION_RANK[r] !== undefined ? Planner.REGION_RANK[r]
                : Object.keys(Planner.REGION_RANK).length));
        return idx.length ? Math.min.apply(null, idx) : Object.keys(Planner.REGION_RANK).length;
    }

    function gearOk() {
        const out = {};
        for (const bit of Object.keys(gearVars)) {
            const kv = gearVars[bit];
            const allowed = Object.keys(kv).filter((c) => kv[c].checked);
            if (allowed.length !== Object.keys(kv).length) out[bit] = allowed;
        }
        return Object.keys(out).length ? out : null;
    }

    function anySlots() {
        const out = [];
        for (const socket of ["ANY 1", "ANY 2"]) {
            const label = (anySel[socket] || "").trim();
            if (!label || label === Planner.ANY_NONE) continue;
            const bit = Planner.ANY_LABEL_BIT[label];
            if (!bit) continue;
            const kv = anyVars[socket];
            const cls = Object.keys(kv).filter((c) => kv[c].checked);
            if (cls.length !== Object.keys(kv).length) {
                out.push({ slot: Planner.display_region(bit), classes: cls });
            } else {
                out.push({ slot: Planner.display_region(bit) });
            }
        }
        return out;
    }

    // ------------------------------------------------------------- picker
    function populateTrioSelects() {
        ["trio0", "trio1", "trio2"].forEach((id) => {
            const sel = $("#" + id);
            sel.innerHTML = "<option value=\"\">\u2014</option>" +
                CLASS_NAMES.map((n) => "<option value=\"" + esc(n) + "\">" + esc(n) + "</option>").join("");
        });
    }

    function readTrio() {
        const names = ["trio0", "trio1", "trio2"].map((id) => $("#" + id).value);
        return names.map((n) => NAME_TO_CODE[n]).filter(Boolean);
    }

    function onTrioChange() {
        const t = readTrio();
        setStatus(t.length === 3 ? "Trio: " + t.join(" / ")
            : "Pick " + (3 - t.length) + " more class(es)...");
        if (t.length === 3) return;
        autoRefreshPlan();
    }

    // ------------------------------------------------------------- load
    function loadEffects() {
        const t = readTrio();
        if (t.length !== 3) {
            setStatus("Pick a full class trio first.");
            autoRefreshPlan();
            return;
        }
        if (new Set(t).size !== 3) {
            setStatus("Trio must be three different classes.");
            return;
        }
        trio = t.slice();
        const items = Planner.class_filter(data, trio);
        let fx = Planner.focus_effects_available(data, items, trio);
        effectsAll = fx;
        effects = Planner.max_rank_per_family(fx);

        checkVars = {};
        superMembers = {};
        Object.keys(effects).forEach((n) => { checkVars[n] = false; });

        buildGearColumn();
        buildChecklist();
        setStatus(Object.keys(effects).length +
            " focus effect families available (max rank shown).");
        renderBuild();
        autoRefreshPlan();
    }

    // ------------------------------------------------------------- gear
    function buildGearColumn() {
        gearBody.innerHTML = "";
        gearVars = {};
        if (!trio.length) {
            const d = document.createElement("div");
            d.className = "hint";
            d.textContent = "Pick a class trio, then press Load effects.";
            gearBody.appendChild(d);
            return;
        }
        for (const bit of Planner.GEAR_SLOTS) {
            const row = document.createElement("div");
            row.className = "gear-row";
            const name = document.createElement("span");
            name.className = "gear-name";
            name.textContent = Planner.GEAR_LABEL[bit] || bit;
            row.appendChild(name);
            const box = document.createElement("div");
            gearVars[bit] = {};
            for (const c of trio) {
                const label = document.createElement("label");
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = true;
                cb.addEventListener("change", autoRefreshPlan);
                gearVars[bit][c] = cb;
                label.appendChild(cb);
                label.appendChild(document.createTextNode(" " + c));
                box.appendChild(label);
            }
            row.appendChild(box);
            gearBody.appendChild(row);
        }

        const anyTitle = document.createElement("div");
        anyTitle.className = "any-title";
        anyTitle.textContent = "ANY SOCKETS";
        gearBody.appendChild(anyTitle);
        const anyNote = document.createElement("div");
        anyNote.className = "any-note";
        anyNote.textContent = "unpicked = not used";
        gearBody.appendChild(anyNote);

        anySel = { "ANY 1": "", "ANY 2": "" };
        anyVars = { "ANY 1": {}, "ANY 2": {} };
        for (const socket of ["ANY 1", "ANY 2"]) {
            const row = document.createElement("div");
            row.className = "any-row";
            const lbl = document.createElement("span");
            lbl.className = "gear-name";
            lbl.textContent = socket;
            const sel = document.createElement("select");
            sel.innerHTML = ANY_LABEL_OPTIONS.map((o) =>
                "<option value=\"" + esc(o) + "\">" + esc(o) + "</option>").join("");
            sel.addEventListener("change", () => {
                anySel[socket] = sel.value;
                autoRefreshPlan();
            });
            row.appendChild(lbl);
            row.appendChild(sel);
            anyVars[socket] = {};
            for (const c of trio) {
                const label = document.createElement("label");
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = true;
                cb.addEventListener("change", autoRefreshPlan);
                anyVars[socket][c] = cb;
                label.appendChild(cb);
                label.appendChild(document.createTextNode(" " + c));
                row.appendChild(label);
            }
            gearBody.appendChild(row);
        }
    }

    // ------------------------------------------------------------- checklist
    function buildChecklist() {
        checkBody.innerHTML = "";
        if (!trio.length) {
            const d = document.createElement("div");
            d.className = "hint";
            d.textContent = "Pick a class trio, then press Load effects.";
            checkBody.appendChild(d);
            return;
        }
        const names = Object.keys(effects).sort(function (a, b) {
            const cA = effects[a].category, cB = effects[b].category;
            if (cA < cB) return -1;
            if (cA > cB) return 1;
            return a < b ? -1 : a > b ? 1 : 0;
        });
        if (!names.length) {
            const d = document.createElement("div");
            d.className = "hint";
            d.textContent = "No focus effects for this trio.";
            checkBody.appendChild(d);
            return;
        }
        const groups = {};
        names.forEach((n) => {
            const sup = superOf(effects[n].category || "Other");
            (groups[sup] = groups[sup] || []).push(n);
        });
        superMembers = groups;

        for (const sup of Planner.SUPER_ORDER) {
            const members = groups[sup];
            if (!members) continue;
            const card = document.createElement("div");
            card.className = "super-card";

            const stripe = document.createElement("div");
            stripe.className = "stripe";
            stripe.style.width = "4px";
            stripe.style.background = superColor(sup);

            const head = document.createElement("div");
            head.className = "super-head";
            head.style.background = "inherit";
            const icon = document.createElement("span");
            icon.className = "super-icon";
            icon.style.color = "var(--muted)";
            const nameLbl = document.createElement("span");
            nameLbl.className = "super-name";
            nameLbl.textContent = sup;
            const count = document.createElement("span");
            count.className = "super-count";
            head.appendChild(icon);
            head.appendChild(nameLbl);
            head.appendChild(count);

            const body = document.createElement("div");
            members.forEach((n) => {
                const row = document.createElement("div");
                row.className = "effect-row";
                const star = document.createElement("span");
                star.className = "star-box";
                star.textContent = highVars[n] ? "\u2605" : "\u2606";
                star.style.color = highVars[n] ? "var(--gold)" : "var(--muted)";
                star.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    highVars[n] = !highVars[n];
                    star.textContent = highVars[n] ? "\u2605" : "\u2606";
                    star.style.color = highVars[n] ? "var(--gold)" : "var(--muted)";
                    autoRefreshPlan();
                });
                const box = document.createElement("span");
                box.className = "check-box";
                const nm = document.createElement("span");
                nm.className = "effect-name";
                nm.textContent = n;
                row.appendChild(star);
                row.appendChild(box);
                row.appendChild(nm);
                row.addEventListener("click", () => {
                    checkVars[n] = !checkVars[n];
                    refreshSuperIcons();
                    renderBuild();
                    autoRefreshPlan();
                });
                body.appendChild(row);
            });

            head.addEventListener("click", () => {
                const membersOn = members.filter((m) => checkVars[m]);
                const target = membersOn.length === members.length ? false : true;
                members.forEach((m) => { checkVars[m] = target; });
                refreshSuperIcons();
                renderBuild();
                autoRefreshPlan();
            });
            head.addEventListener("mouseenter", () => { nameLbl.style.color = "var(--gold)"; });
            head.addEventListener("mouseleave", () => { nameLbl.style.color = ""; });

            card.appendChild(stripe);
            card.appendChild(head);
            card.appendChild(body);
            checkBody.appendChild(card);
        }
        refreshSuperIcons();
    }

    function refreshSuperIcons() {
        for (const sup of Object.keys(superMembers)) {
            const members = superMembers[sup];
            const on = members.filter((m) => checkVars[m]).length;
            const total = members.length;
            const cards = checkBody.querySelectorAll(".super-card");
            for (const card of cards) {
                const nameNode = card.querySelector(".super-name");
                if (!nameNode || nameNode.textContent !== sup) continue;
                const icon = card.querySelector(".super-icon");
                const count = card.querySelector(".super-count");
                count.textContent = on + "/" + total;
                if (!on) {
                    icon.textContent = "\u2610";
                    icon.style.color = "var(--muted)";
                } else if (on === total) {
                    icon.textContent = "\u2611";
                    icon.style.color = "var(--green)";
                } else {
                    icon.textContent = "\u2610";
                    icon.style.color = superColor(sup);
                }
                card.querySelectorAll(".effect-row").forEach((row) => {
                    const nm = row.querySelector(".effect-name").textContent;
                    const box = row.querySelector(".check-box");
                    if (checkVars[nm]) {
                        box.textContent = "\u2611";
                        box.style.color = "var(--green)";
                    } else {
                        box.textContent = "\u2610";
                        box.style.color = "var(--muted)";
                    }
                });
            }
        }
    }

    // ------------------------------------------------------------- build list
    function renderBuild() {
        buildBody.innerHTML = "";
        const chosen = chosenNames();
        if (!Object.keys(effects).length) {
            const d = document.createElement("div");
            d.className = "hint";
            d.textContent = "Pick a class trio, then press Load effects.";
            buildBody.appendChild(d);
            return;
        }
        if (!chosen.length) {
            const d = document.createElement("div");
            d.className = "hint";
            d.textContent = "Tick the exaltations you want on the left \u2014 they'll be " +
                "listed here, one row per equipment slot, like your inventory.";
            buildBody.appendChild(d);
            return;
        }
        const entries = {};
        chosen.forEach((name) => {
            const bySlot = Planner.format_slot_options(effects[name]);
            for (const bucket of Object.keys(bySlot)) {
                (entries[bucket] = entries[bucket] || {})[name] = bySlot[bucket].slice().sort();
            }
        });
        for (const name of Object.keys(itemChoices)) {
            const bucket = itemChoices[name];
            if (chosen.indexOf(name) < 0 || !entries[bucket] || !entries[bucket][name]) {
                delete itemChoices[name];
            }
        }
        const shown = {};
        for (const bucket of Object.keys(entries)) {
            const keep = {};
            for (const name of Object.keys(entries[bucket])) {
                if (itemChoices[name] === bucket || !(name in itemChoices)) {
                    keep[name] = entries[bucket][name];
                }
            }
            if (Object.keys(keep).length) shown[bucket] = keep;
        }
        Object.keys(shown).sort((a, b) => bucketKey(a) - bucketKey(b)).forEach((bucket) => {
            buildBucketRow(bucket, shown[bucket]);
        });
        const foot = document.createElement("div");
        foot.className = "build-foot";
        foot.textContent = "Tick \u201cchoose this item\u201d to pin an exaltation to one slot; " +
            "its other slots disappear. Ear/ring/wrist pairs = either side \u00b7 " +
            "PRIMARY or SECONDARY both work";
        buildBody.appendChild(foot);
    }

    function buildBucketRow(bucket, emap) {
        const card = document.createElement("div");
        card.className = "bucket-card";
        const label = document.createElement("div");
        label.className = "bucket-label";
        label.textContent = Planner.gear_labels(Planner.slot_regions(bucket)).join(" / ");
        card.appendChild(label);
        for (const name of Object.keys(emap)) {
            const e = effects[name];
            const pinnedHere = itemChoices[name] === bucket;
            const head = document.createElement("div");
            head.className = "entry-head";
            head.style.cursor = "pointer";
            const glyph = document.createElement("span");
            glyph.className = "glyph";
            glyph.textContent = pinnedHere ? "\u2611" : "\u2610";
            glyph.style.color = pinnedHere ? "var(--green)" : "var(--muted)";
            const nm = document.createElement("span");
            nm.className = "entry-name" + (pinnedHere ? " pinned" : "");
            nm.textContent = name;
            head.appendChild(glyph);
            head.appendChild(nm);
            if (pinnedHere) {
                const note = document.createElement("span");
                note.className = "pinned-note";
                note.textContent = "  (chosen \u2014 other slots hidden)";
                head.appendChild(note);
            }
            head.addEventListener("click", () => {
                if (itemChoices[name] === bucket) delete itemChoices[name];
                else itemChoices[name] = bucket;
                renderBuild();
                autoRefreshPlan();
            });
            card.appendChild(head);

            if (e.description) {
                const desc = document.createElement("div");
                desc.className = "entry-desc";
                desc.textContent = e.description;
                card.appendChild(desc);
            }
            for (const it of emap[name]) {
                const line = document.createElement("div");
                line.className = "item-line";
                line.appendChild(document.createTextNode("get  "));
                const itemName = document.createElement("span");
                itemName.className = "item-name";
                itemName.textContent = it;
                line.appendChild(itemName);
                const info = itemInfo(it);
                const note = info ? classesNote(info.classes, trio) : "";
                if (note) {
                    const nn = document.createElement("span");
                    nn.className = "class-note";
                    nn.textContent = "   [" + note + "]";
                    line.appendChild(nn);
                }
                card.appendChild(line);
            }
        }
        buildBody.appendChild(card);
    }

    // ------------------------------------------------------------- plan
    function clearPlan() {
        planTitle.textContent = "Best path";
        planBody.innerHTML = "<span class=\"plan-note\">" +
            "Tick foci on the left and the best path appears here automatically.</span>";
    }

    function autoRefreshPlan() {
        const t = readTrio();
        const chosen = chosenNames();
        if (t.length !== 3 || !Object.keys(effects).length || !chosen.length) {
            clearPlan();
            return;
        }
        let plan, stats;
        try {
            const highSet = Object.keys(highVars).filter((n) => highVars[n] && checkVars[n]);
            currentHighSet = new Set(highSet);
            const result = Planner.optimize_plan(
                effects, chosen, t.slice(),
                Object.keys(itemChoices).length ? Object.assign({}, itemChoices) : null,
                gearOk(),
                anySlots(),
                effectsAll,
                highSet.length ? highSet : null,
            );
            plan = result.plan;
            stats = result.stats;
        } catch (err) {
            planTitle.textContent = "Best path";
            planBody.innerHTML = "<span class=\"plan-note\">" + esc(err.message) + "</span>";
            return;
        }
        showPlan(plan, stats, t);
    }

    function showPlan(plan, stats, t) {
        planTitle.textContent = "Best path \u00b7 " + t.join(" / ");
        planBody.innerHTML = "";
        const rows = plan.slice().sort(function (a, b) {
            const ia = Planner.BIT_INDEX[a[2]] !== undefined ? Planner.BIT_INDEX[a[2]]
                : Object.keys(Planner.BIT_INDEX).length;
            const ib = Planner.BIT_INDEX[b[2]] !== undefined ? Planner.BIT_INDEX[b[2]]
                : Object.keys(Planner.BIT_INDEX).length;
            return ia - ib;
        });
        planBody.appendChild(el("div", "plan-why",
            "Recommended build \u2014 one focus per slot, every class of your " +
            "trio can wear the item unless marked:\n\n"));

        const whyHere = stats.why_here || {};
        for (const [effect, bucket, region, item, excluded] of rows) {
            const line = document.createElement("div");
            line.className = "plan-row";
            if (currentHighSet.has(effect)) {
                line.appendChild(el("span", "plan-star", "\u2605 "));
            }
            const slot = el("span", "plan-slot",
                pad(Planner.GEAR_LABEL[region] || region, 12));
            line.appendChild(slot);
            line.appendChild(document.createTextNode(" <- "));
            line.appendChild(el("span", "plan-item", item));
            if (excluded) {
                const info = itemInfo(item);
                const note = info ? classesNote(info.classes, t) : "";
                line.appendChild(el("span", "plan-note", "   [" + (note || "class only") + "]"));
            }
            line.appendChild(el("span", "plan-why", "    (" + effect + ")"));
            if (stats.fell_back && stats.fell_back[effect]) {
                line.appendChild(el("span", "plan-note",
                    "   (requested " + stats.fell_back[effect] +
                    " \u2014 didn't fit)"));
            }
            planBody.appendChild(line);

            if (effect in whyHere) {
                const bits = [];
                for (const [other, holders] of whyHere[effect]) {
                    const head = holders !== "free"
                        ? (Planner.GEAR_LABEL[other] || other) + " is taken by " + holders
                        : (Planner.GEAR_LABEL[other] || other) +
                          " is free (taking it drops a focus)";
                    bits.push(head);
                }
                const wh = document.createElement("div");
                wh.className = "plan-why";
                wh.textContent = bits.length
                    ? "         why here: " + bits.join("; ")
                    : "         why here: this slot is the only one for this focus";
                planBody.appendChild(wh);
            }
        }

        const foot = el("div", "plan-foot", "\n" +
            stats.placed + "/" + stats.total +
            " foci placed \u00b7 " + stats.restricted +
            " slot(s) only usable by some classes of your trio");
        planBody.appendChild(foot);
        if (stats.conflicts && stats.conflicts.length) {
            planBody.appendChild(el("div", "plan-foot",
                "\nCould not fit: " + stats.conflicts.join("; ")));
        }
        const clashes = stats.clashes || {};
        if (Object.keys(clashes).length) {
            planBody.appendChild(el("div", "plan-note2", "\n\nWhy:"));
            for (const name of stats.conflicts) {
                if (!(name in clashes)) continue;
                const parts = [];
                for (const [region, occupants] of clashes[name]) {
                    parts.push((Planner.GEAR_LABEL[region] || region) + " is taken by " +
                        occupants.slice().sort().join(" & "));
                }
                planBody.appendChild(el("div", "plan-why",
                    "  " + name + " \u2014 " + parts.join("; ")));
            }
            planBody.appendChild(el("div", "plan-note2",
                "\n  Tip: pin one focus to a slot (\u2611) to force the choice."));
        }
    }

    function pad(text, width) {
        text = String(text);
        return text.length >= width ? text : text + " ".repeat(width - text.length);
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // ------------------------------------------------------------- init
    populateTrioSelects();
    $("#trio0").addEventListener("change", onTrioChange);
    $("#trio1").addEventListener("change", onTrioChange);
    $("#trio2").addEventListener("change", onTrioChange);
    $("#loadBtn").addEventListener("click", loadEffects);
    $("#checkAllBtn").addEventListener("click", () => {
        Object.keys(checkVars).forEach((n) => { checkVars[n] = true; });
        refreshSuperIcons();
        renderBuild();
        autoRefreshPlan();
    });
    $("#checkNoneBtn").addEventListener("click", () => {
        Object.keys(checkVars).forEach((n) => { checkVars[n] = false; });
        refreshSuperIcons();
        renderBuild();
        autoRefreshPlan();
    });
    $("#clearPlanBtn").addEventListener("click", clearPlan);
    $("#donate").addEventListener("click", (ev) => {
        ev.preventDefault();
        window.open(DONATE_URL, "_blank", "noopener");
    });

    clearPlan();
    setStatus("Loading data\u2026");
    fetch("data/eql_focus_effects.json")
        .then((r) => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        })
        .then((d) => {
            data = d;
            setStatus("Loaded " + (d.items || []).length +
                " focus-effect items \u00b7 " +
                Object.keys(d.focus_reference || {}).length +
                " focus effects in reference.");
        })
        .catch((err) => {
            setStatus("Could not read data file: " + err.message +
                " (serve over http, not file://)");
        });
})();