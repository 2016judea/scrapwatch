import test from "node:test";
import assert from "node:assert/strict";
import {
  newRows, rowKey, matches, validateSignup, subscriberId, renderMail, renderConfirmation,
  summarize, toRow, describe, wrecker, cleanYear,
} from "./core.js";

// Shapes copied from the live register, 2026-10-06.
const raw = [
  { permitNumber: "BLDG1197039", Display: "2003 COMO AVE SE", APN: "1902923220049", Neighborhoods_Desc: "Como",
    applicantName: "BD Construction, LLC", occupancyType: "SFD", status: "Issued",
    comments: "Wreck a Single Family Home per PDR PLAN21400.", issueDate: 1790954685000 },
  { permitNumber: "BLDG1182786", Display: "3246 NICOLLET AVE", APN: "0302824240015", Neighborhoods_Desc: "Lyndale",
    applicantName: "RAMSEY COMPANIES", occupancyType: "Comm", status: "Closed",
    comments: "Wreck a convenience store.  This permit is associated with Building Permit BLDG1150485 and PDR PLAN17614.", issueDate: 1788192000000 },
  { permitNumber: "BLDG0000001", Display: "3412 29TH ST W", APN: "0000000000001", Neighborhoods_Desc: "",
    applicantName: "David Hovda", occupancyType: "TFD", status: "Issued",
    comments: "A construction permit has not been submitted or approved. \nTherefore, any excavation left after the removal", issueDate: 1771632000000 },
];
const rows = raw.map((a) => toRow(a, { "1902923220049": "1912", "0000000000001": "0000" }));

test("toRow: house vs big, label, address casing, Chicago date, year joined", () => {
  assert.equal(rows[0].kind, "house");
  assert.equal(rows[0].label, "House");
  assert.equal(rows[0].address, "2003 Como Ave SE");
  assert.equal(rows[0].issued, "2026-10-02");
  assert.equal(rows[0].year_built, 1912);
  assert.equal(rows[1].kind, "big");
  assert.equal(rows[1].label, "Commercial building");
  assert.equal(rows[2].label, "Duplex");
  assert.equal(rows[2].kind, "house");
  assert.equal(rows[2].address, "3412 29th St W");
});

test("a person's name is never shown as the wrecker; a company is", () => {
  assert.equal(rows[2].wrecker, "");
  assert.equal(wrecker("Nitti Rolloff Services Inc"), "Nitti Rolloff Services Inc");
  assert.equal(wrecker("RAMSEY COMPANIES"), "Ramsey Companies");
});

test("year 0000 is unknown, not year zero", () => {
  assert.equal(cleanYear("0000"), null);
  assert.equal(rows[2].year_built, null);
});

test("describe keeps what the building was and drops the boilerplate", () => {
  assert.equal(rows[1].what, "Convenience store");
  assert.equal(rows[0].what, "");
  assert.equal(rows[2].what, "");
  assert.equal(describe("A lay"), "");
  assert.equal(describe("WRECKING A SFD"), "");
  assert.equal(describe("Wrecking Prospect Foundry building - 5 SAC Credits (251117A7) .  All wrecking must comply"), "Prospect Foundry building");
  assert.equal(describe("Source Information is Not Available"), "");
});

test("newRows returns only rows the check has not seen; empty seen returns all (why the first run baselines)", () => {
  assert.deepEqual(newRows(new Set([rowKey(rows[0])]), rows).map((r) => r.permit_no), ["BLDG1182786", "BLDG0000001"]);
  assert.equal(newRows([], rows).length, 3);
  assert.equal(newRows([], [{ address: "x" }]).length, 0);
});

test("matches honours kinds; an old subscriber with no kinds gets everything; inactive gets nothing", () => {
  assert.equal(rows.filter((r) => matches({ active: true, kinds: ["house"] }, r)).length, 2);
  assert.equal(rows.filter((r) => matches({ active: true, kinds: ["big"] }, r)).length, 1);
  assert.equal(rows.filter((r) => matches({ active: true, city: "any", signals: ["teardown"] }, r)).length, 3);
  assert.equal(rows.filter((r) => matches({ active: false, kinds: ["house", "big"] }, r)).length, 0);
});

test("validateSignup rejects a bad email; old card payloads (city, signals) still sign up for everything", () => {
  assert.equal(validateSignup({ email: "nope" }).ok, false);
  const legacy = validateSignup({ email: " A@B.co ", city: "Saint Paul", signals: ["teardown", "electrical"] });
  assert.equal(legacy.ok, true);
  assert.deepEqual(legacy.sub, { email: "A@B.co", kinds: ["house", "big"] });
  assert.deepEqual(validateSignup({ email: "a@b.co", kinds: "house" }).sub.kinds, ["house"]);
});

test("the same address in any case is one subscriber", () => {
  assert.equal(subscriberId("Aidan@Example.com"), subscriberId(" aidan@example.com "));
});

test("the mail carries every row, a map link, the unsubscribe link, and no em dash", () => {
  const m = renderMail({ rows, siteUrl: "https://s.test", unsubUrl: "https://s.test/u" });
  assert.equal(m.subject, "3 buildings coming down in Minneapolis");
  for (const r of rows) assert.ok(m.text.includes(r.address), r.address);
  assert.ok(m.text.includes("Tearing it down: BD Construction, LLC"));
  assert.ok(m.text.includes("Built 1912"));
  assert.ok(m.text.includes("google.com/maps"));
  assert.ok(m.text.includes("https://s.test/u"));
  assert.ok(!m.text.includes("David Hovda"));
  assert.ok(!/[—–]/.test(m.text + m.subject));
  assert.equal(renderMail({ rows: [rows[0]], siteUrl: "s", unsubUrl: "u" }).subject, "House coming down: 2003 Como Ave SE");
  const c = renderConfirmation({ sub: { kinds: ["house"] }, siteUrl: "s", unsubUrl: "u" });
  assert.match(c.text, /a house or duplex/);
});

test("summarize counts the last 30 days and the house/big split", () => {
  const s = summarize(rows, "2026-10-06");
  assert.equal(s.rows, 3);
  assert.equal(s.last_30, 1);
  assert.equal(s.houses, 2);
  assert.equal(s.newest, "2026-10-02");
});
