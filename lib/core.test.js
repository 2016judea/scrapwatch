import test from "node:test";
import assert from "node:assert/strict";
import { newRows, rowKey, matches, validateSignup, subscriberId, renderMail, summarize } from "./core.js";

const rows = [
  { permit_no: "A1", city: "Minneapolis", signal: "teardown", issued: "2026-08-13", address: "1600 Marshall St NE", firm: "MM Miller Brothers" },
  { permit_no: "B2", city: "Saint Paul", signal: "electrical", issued: "2025-06-30", address: "1 Kellogg Blvd", firm: "Someone Electric", value_usd: 42000 },
  { permit_no: "C3", city: "Minneapolis", signal: "electrical", issued: "2026-07-01", address: "2 Nicollet" },
];

test("newRows returns only permits the check has not seen", () => {
  const out = newRows(new Set([rowKey(rows[0])]), rows);
  assert.deepEqual(out.map((r) => r.permit_no), ["B2", "C3"]);
});

test("newRows with an empty seen set returns everything, which is why the first run baselines instead of mailing", () => {
  assert.equal(newRows([], rows).length, 3);
});

test("a row with no permit number is never new (it could never be marked seen)", () => {
  assert.equal(newRows([], [{ city: "Minneapolis", signal: "teardown" }]).length, 0);
});

test("one permit number filed on two addresses is two rows, each seen once", () => {
  const two = [
    { permit_no: "Z9", address: "1 First St", city: "Saint Paul", signal: "electrical" },
    { permit_no: "Z9", address: "3 First St", city: "Saint Paul", signal: "electrical" },
  ];
  const first = newRows([], two);
  assert.equal(first.length, 2);
  const seen = new Set(first.map(rowKey));
  assert.equal(newRows(seen, two).length, 0);
});

test("matches honours city and signal, and an inactive subscriber matches nothing", () => {
  const both = { active: true, city: "any", signals: ["teardown", "electrical"] };
  const mplsTear = { active: true, city: "Minneapolis", signals: ["teardown"] };
  const off = { active: false, city: "any", signals: ["teardown", "electrical"] };
  assert.equal(rows.filter((r) => matches(both, r)).length, 3);
  assert.deepEqual(rows.filter((r) => matches(mplsTear, r)).map((r) => r.permit_no), ["A1"]);
  assert.equal(rows.filter((r) => matches(off, r)).length, 0);
});

test("validateSignup rejects a bad email and a made-up city, and defaults to both signals", () => {
  assert.equal(validateSignup({ email: "nope" }).ok, false);
  assert.equal(validateSignup({ email: "a@b.co", city: "Duluth" }).ok, false);
  const v = validateSignup({ email: " A@B.co ", city: "any", signals: "bogus" });
  assert.equal(v.ok, true);
  assert.deepEqual(v.sub.signals, ["teardown", "electrical"]);
  assert.equal(v.sub.email, "A@B.co");
});

test("the same address in any case is one subscriber", () => {
  assert.equal(subscriberId("Aidan@Example.com"), subscriberId(" aidan@example.com "));
});

test("the mail carries every row, the unsubscribe link, and no em dash", () => {
  const m = renderMail({ rows, sub: { city: "any", signals: ["teardown", "electrical"] }, siteUrl: "https://s.test", unsubUrl: "https://s.test/u" });
  assert.match(m.subject, /^3 new permits/);
  for (const r of rows) assert.ok(m.text.includes(r.address), r.address);
  assert.ok(m.text.includes("https://s.test/u"));
  assert.ok(!m.text.includes("—"));
  assert.ok(m.text.includes("$42,000 declared"));
});

test("summarize counts per city and carries each city's last issued date", () => {
  const s = summarize(rows);
  assert.equal(s.rows, 3);
  assert.equal(s.by_city["Saint Paul"].last_issued, "2025-06-30");
  assert.equal(s.by_city.Minneapolis.teardown, 1);
});
