/*
 * Web UI smoke: drives index.html + app.js in jsdom and asserts the same
 * behaviors the desktop smoke checks (load, check-all plan counts, gear
 * restrictions, any sockets, pins, plan panel text).
 *
 * Run:  node web/test_web.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const WEB = __dirname;
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const data = fs.readFileSync(path.join(WEB, "data", "eql_focus_effects.json"), "utf8");

const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
});
const { window } = dom;
window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(data)) });
window.open = () => null;
window.eval(fs.readFileSync(path.join(WEB, "planner.js"), "utf8"));
window.eval(fs.readFileSync(path.join(WEB, "app.js"), "utf8"));
window.eval(fs.readFileSync(path.join(WEB, "mote.js"), "utf8"));

const doc = window.document;
const $ = (s) => doc.querySelector(s);

let passed = 0;
function check(cond, msg) {
    if (cond) { passed++; console.log("OK " + msg); return; }
    throw new Error("FAIL: " + msg);
}
function sel(id, name) {
    const s = $(id);
    s.value = name;
    s.dispatchEvent(new window.Event("change"));
}
function planText() {
    return $("#planBody").textContent.replace(/\s+/g, " ").trim();
}

// data loaded by app.js fetch
new Promise((res) => setTimeout(res, 20)).then(() => {
    check($("#status").textContent.indexOf("focus-effect items") >= 0,
        "data loaded status");

    sel("#trio0", "Cleric");
    sel("#trio1", "Druid");
    sel("#trio2", "Shaman");
    $("#loadBtn").click();
    check($("#status").textContent.indexOf("focus effect families available") >= 0,
        "load effects status");
    check(doc.querySelectorAll(".super-card").length >= 3, "super cards rendered");

    // check all -> plan auto-fills; CLR/DRU/SHM full set = 16/16 like desktop
    $("#checkAllBtn").click();
    check(planText().indexOf("16/16 foci placed") >= 0,
        "best path auto plan 16/16 for CLR/DRU/SHM");
    check($("#planTitle").textContent === "Best path \u00b7 CLR / DRU / SHM",
        "plan title shows trio");

    // any socket: pick LEFT RING for ANY 1 -> extra slot of that type
    const anyRow = Array.from(doc.querySelectorAll(".any-row")).find((r) =>
        r.querySelector(".gear-name").textContent === "ANY 1");
    const anySel = anyRow.querySelector("select");
    anySel.value = "LEFT RING";
    anySel.dispatchEvent(new window.Event("change"));
    check(planText().indexOf("ANY 1 <-") >= 0,
        "any socket LEFT RING is used for a focus");
    check(planText().indexOf("16/16 foci placed") >= 0,
        "best path still 16/16 with an any socket on");

    const anyUnpick = anyRow.querySelector("select");
    anyUnpick.value = "\u2014 choose slot \u2014";
    anyUnpick.dispatchEvent(new window.Event("change"));

    // force a pin: pin first effect row in build list to its bucket, then unpin
    const firstGlyph = doc.querySelector(".entry-head .glyph");
    firstGlyph.parentElement.click();
    check(planText().indexOf("foci placed") >= 0, "plan still renders after pin");
    firstGlyph.parentElement.click();

    // gear restriction: untick Shaman on PRIMARY
    const primary = Array.from(doc.querySelectorAll(".gear-row")).find((r) =>
        r.querySelector(".gear-name").textContent === "PRIMARY");
    const shamanCb = Array.from(primary.querySelectorAll("input")).find((cb) =>
        cb.nextSibling.textContent === " SHM");
    shamanCb.checked = false;
    shamanCb.dispatchEvent(new window.Event("change"));
    check(planText().indexOf("foci placed") >= 0, "plan renders after gear change");

    // reload for SHM/WAR/MNK: disabling SECONDARY keeps a full plan, no SECONDARY slot
    sel("#trio0", "Shaman");
    sel("#trio1", "Warrior");
    sel("#trio2", "Monk");
    $("#loadBtn").click();
    $("#checkAllBtn").click();
    check(planText().indexOf("16/16 foci placed") >= 0,
        "best path auto plan 16/16 for SHM/WAR/MNK");
    const secondary = Array.from(doc.querySelectorAll(".gear-row")).find((r) =>
        r.querySelector(".gear-name").textContent === "SECONDARY");
    Array.from(secondary.querySelectorAll("input")).forEach((cb) => {
        cb.checked = false;
        cb.dispatchEvent(new window.Event("change"));
    });
    check(planText().indexOf("foci placed") >= 0,
        "SECONDARY disabled still renders a plan");
    const hasSecondary = planText().indexOf("SECONDARY <-") >= 0;
    if (hasSecondary) console.log("PLAN TEXT:", planText());
    check(!hasSecondary,
        "no focus placed in SECONDARY after disabling it");

    // regression: a gear restriction that makes the highest rank unwearable
    // falls back to the next tier and SAYS so (EE III -> EE II here)
    sel("#trio0", "Wizard");
    sel("#trio1", "Enchanter");
    sel("#trio2", "Shadow Knight");
    $("#loadBtn").click();
    function clickEffect(name) {
        const rows = Array.from(doc.querySelectorAll(".effect-row")).filter((r) =>
            r.querySelector(".effect-name").textContent === name);
        if (rows.length) rows[0].click();
    }
    function superCard(name) {
        return Array.from(doc.querySelectorAll(".super-card")).find((c) =>
            c.querySelector(".super-name").textContent === name);
    }
    clickEffect("Improved Damage III");
    Array.from(superCard("Healing & Mitigation").querySelectorAll(".effect-row"))
        .slice(0, 3).forEach((r) => r.click());
    Array.from(superCard("Buffs & Utility").querySelectorAll(".effect-row"))
        .forEach((r) => r.click());
    clickEffect("Improved Vampirism III");
    check(planText().indexOf("9/9 foci placed") >= 0,
        "WIZ/ENC/SHD all 9 placed before gear restriction");
    const secRow = Array.from(doc.querySelectorAll(".gear-row")).find((r) =>
        r.querySelector(".gear-name").textContent === "SECONDARY");
    Array.from(secRow.querySelectorAll("input")).forEach((cb) => {
        if (["ENC", "WIZ"].indexOf(cb.nextSibling.textContent.trim()) >= 0) {
            cb.checked = false;
            cb.dispatchEvent(new window.Event("change"));
        }
    });
    check(planText().indexOf("9/9 foci placed") >= 0 &&
        planText().indexOf("Extended Enhancement II") >= 0 &&
        planText().indexOf("requested Extended Enhancement III") >= 0 &&
        planText().indexOf("Could not fit") < 0,
        "gear restriction downgrades to Extended Enhancement II and notes it");

    // tabs: mote page opens with its inventory grid + a pre-run sample plan
    check(!!$("#tabMoteBtn") && !!$("#tabExaltBtn"), "tab buttons exist");
    $("#tabMoteBtn").click();
    check($("#tabMotePage").hidden === false && $("#tabExaltPage").hidden === true,
        "mote tab shows, exalt tab hides");
    check(window.getComputedStyle($("#tabExaltPage")).display === "none" &&
        window.getComputedStyle($("#tabMotePage")).display !== "none",
        "hidden page is actually not rendered (CSS display: none)");
    check($("#tabMoteBtn").className.indexOf("active") >= 0 &&
        $("#tabExaltBtn").className.indexOf("active") < 0,
        "active tab styling follows the switch");
    check(doc.querySelectorAll("#invRows .inv-row").length === 10,
        "mote inventory grid has 10 quality rows");
    check(doc.querySelectorAll("#invRows .q-icon").length === 10 &&
        doc.querySelector("#invRows .q-icon").src.indexOf("mote1.png") >= 0,
        "each inventory row shows its mote icon");
    check(doc.querySelectorAll(".road-legend .legend-swatch").length >= 1 &&
        doc.querySelector(".road-legend .legend-swatch").tagName === "IMG",
        "legend uses the mote icons");
    const firstName = doc.querySelector("#invRows .inv-row .q-name").textContent;
    const firstPts = doc.querySelector("#invRows .inv-row .q-pts").textContent;
    check(/Infinitesimal/.test(firstName),
        "quality 1 row shows the full mote name (got: " + firstName + ")");
    check(/\(q1/.test(firstPts),
        "quality 1 row still shows its quality number (got: " + firstPts + ")");
    check($("#moteBody").querySelector(".way-card") !== null,
        "sample inventory auto-plans at least one way card");
    const carryInp = $("#startCarry");
    const carryWays = () => $("#moteBody").querySelectorAll(".way-card").length;
    check(!!carryInp && carryInp.value === "0",
        "partial-start input present and defaults to 0");
    check($("#startCarryMax").textContent.indexOf("max 0 at +0") >= 0,
        "at +0 the carried max is 0 (feeding 1 pt would already be +1)");
    const startSel0 = $("#startLevel");
    startSel0.value = "1";
    startSel0.dispatchEvent(new window.Event("change"));
    check($("#startCarryMax").textContent.indexOf("max 1 at +1") >= 0,
        "at +1 the carried max updates to 1");
    carryInp.value = "1";
    carryInp.dispatchEvent(new window.Event("change"));
    check(carryWays() > 0 && /1 pt fed/.test($("#moteOutTitle").textContent),
        "setting 1 pt already fed re-plans and is reflected in the title");
    carryInp.value = "0";
    carryInp.dispatchEvent(new window.Event("change"));
    check(/^From \+1 \(0 pt fed\) to \+5|^From \+1 to \+5/.test($("#moteOutTitle").textContent),
        "resetting carried points restores the plain title");
    startSel0.value = "0";
    startSel0.dispatchEvent(new window.Event("change"));
    const firstCard = $("#moteBody").querySelector(".way-card");
    check(firstCard.querySelector(".roadmap") !== null &&
        firstCard.querySelectorAll(".road-row").length === 5,
        "way card draws a 0 -> +5 roadmap with one bar per level (got " + firstCard.querySelectorAll(".road-row").length + ")");
    check(firstCard.querySelectorAll(".road-tag").length >= 1,
        "roadmap bars carry text labels like '1x Greater'");
    const stepRows = firstCard.querySelectorAll(".roadmap .road-desc");
    check(stepRows.length === 5,
        "each level row has its description on the right (got " + stepRows.length + ")");
    check(/Mote of \w+ Potential \(q\d+\)/.test(
            firstCard.querySelector(".roadmap .road-desc").textContent) &&
        /pt/.test(firstCard.querySelector(".roadmap .road-desc").textContent),
        "the top (final) row spells out its feed and points");
    check(/^\+\d/.test(firstCard.querySelector(".roadmap .road-label").textContent),
        "the top row label is the final level transition");
    check(firstCard.querySelector(".road-legend") === null &&
        $("#moteBody").querySelector(".road-legend") !== null,
        "color legend rendered above the grouped ways");
    check(/ways in this grouping/.test(firstCard.querySelector(".way-head").textContent),
        "way card header reports the grouping size");
    $("#tabExaltBtn").click();
    check($("#tabExaltPage").hidden === false && $("#tabMotePage").hidden === true,
        "exalt tab restores when switched back");

    console.log("\nALL WEB UI CHECKS PASSED (" + passed + " assertions)");
    window.close();
}).catch((err) => {
    console.error(err);
    process.exit(1);
});