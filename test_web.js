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

    // check all -> plan auto-fills; CLR/DRU/SHM full set = 14/16 like desktop
    $("#checkAllBtn").click();
    check(planText().indexOf("14/16 foci placed") >= 0,
        "best path auto plan 14/16 for CLR/DRU/SHM");
    check($("#planTitle").textContent === "Best path \u00b7 CLR / DRU / SHM",
        "plan title shows trio");

    // any socket: pick LEFT RING for ANY 1 -> extra slot of that type
    const anyRow = Array.from(doc.querySelectorAll(".any-row")).find((r) =>
        r.querySelector(".gear-name").textContent === "ANY 1");
    const anySel = anyRow.querySelector("select");
    anySel.value = "LEFT RING";
    anySel.dispatchEvent(new window.Event("change"));
    check(planText().indexOf("15/16 foci placed") >= 0,
        "any socket adds a slot (14/16 -> 15/16)");

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

    // reload for SHM/WAR/MNK: disabling SECONDARY keeps 14/16, no SECONDARY slot
    sel("#trio0", "Shaman");
    sel("#trio1", "Warrior");
    sel("#trio2", "Monk");
    $("#loadBtn").click();
    $("#checkAllBtn").click();
    check(planText().indexOf("15/16 foci placed") >= 0,
        "best path auto plan 15/16 for SHM/WAR/MNK");
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
        planText().indexOf("SECONDARY <-") < 0 &&
        planText().indexOf("requested Extended Enhancement III") >= 0 &&
        planText().indexOf("Could not fit") < 0,
        "gear restriction downgrades to Extended Enhancement II and notes it");

    console.log("\nALL WEB UI CHECKS PASSED (" + passed + " assertions)");
    window.close();
}).catch((err) => {
    console.error(err);
    process.exit(1);
});