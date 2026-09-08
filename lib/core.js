// Pure functions. Nothing here touches the network, so all of it is testable
// with `npm test` and none of it can mail anyone by accident.

import crypto from "node:crypto";

export const SIGNALS = ["teardown", "electrical"];
export const CITIES = ["Minneapolis", "Saint Paul"];

// A subscriber's id is a hash of the lower-cased address, so signing up twice
// updates one record instead of mailing one person twice.
export function subscriberId(email) {
  return crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function validateSignup(body) {
  const email = String(body?.email || "").trim().slice(0, 254);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "That email doesn't look right. Check it and try again." };
  }
  const city = String(body?.city || "any");
  if (city !== "any" && !CITIES.includes(city)) {
    return { ok: false, error: "Pick Minneapolis, Saint Paul, or both." };
  }
  let signals = Array.isArray(body?.signals) ? body.signals : [body?.signals].filter(Boolean);
  signals = signals.map(String).filter((s) => SIGNALS.includes(s));
  if (!signals.length) signals = [...SIGNALS];
  return { ok: true, sub: { email, city, signals } };
}

// A row's identity. The permit number is the office's own id but it is NOT
// unique in the file: 556 distinct numbers on 558 rows when this was measured
// (2026-09-07), because one permit can be filed against two addresses. The
// address is part of the key so both rows are seen, and seen once.
export function rowKey(r) {
  return r?.permit_no ? `${r.permit_no}|${r.address || ""}` : null;
}

// The rows the check has not seen. `seen` is every rowKey already mailed or
// baselined.
export function newRows(seen, rows) {
  const s = seen instanceof Set ? seen : new Set(seen || []);
  return rows.filter((r) => { const k = rowKey(r); return k && !s.has(k); });
}

export function matches(sub, row) {
  if (!sub?.active) return false;
  if (sub.city && sub.city !== "any" && row.city !== sub.city) return false;
  if (sub.signals?.length && !sub.signals.includes(row.signal)) return false;
  return true;
}

function money(v) {
  if (v == null || v === "") return "";
  return "$" + Math.round(Number(v)).toLocaleString("en-US");
}

// Plain text on purpose: it is read on a phone in a truck, and a mail client
// cannot mangle a list. Hyphens, never em dashes, so the sent body and the
// stored copy agree.
export function renderRow(r) {
  const what = r.signal === "teardown" ? "TEARDOWN" : "ELECTRICAL";
  const bits = [`${r.issued}  ${what}  ${r.address}`];
  if (r.firm) bits.push(`  firm: ${r.firm}${r.firm_address ? ", " + r.firm_address : ""}`);
  const facts = [];
  if (r.work) facts.push(r.work);
  if (r.value_usd) facts.push(`${money(r.value_usd)} declared`);
  if (r.use) facts.push(`parcel: ${String(r.use).toLowerCase()}`);
  if (r.year_built) facts.push(`built ${r.year_built}`);
  if (r.assessed) facts.push(`assessed ${money(r.assessed)}`);
  if (facts.length) bits.push(`  ${facts.join(" - ")}`);
  return bits.join("\n");
}

export function renderMail({ rows, sub, siteUrl, unsubUrl }) {
  const n = rows.length;
  const where = sub.city === "any" ? "Minneapolis and Saint Paul" : sub.city;
  const subject = `${n} new ${n === 1 ? "permit" : "permits"} in ${where}: ${rows.map((r) => r.signal).includes("teardown") ? "teardown" : "electrical"} work filed`;
  const text = [
    `${n} new ${n === 1 ? "permit" : "permits"} since the last check, ${where}.`,
    "",
    ...rows.map(renderRow).flatMap((s) => [s, ""]),
    "A permit is permission, not a piece of equipment. Nothing in the record says what",
    "gear is inside. The firm on the row is who to call.",
    "",
    `Source: the Minneapolis and Saint Paul permit desks, via Brick & Mortar (CC BY 4.0).`,
    `Full file: https://brickandmortar.dev/datasets/teardowns/`,
    `Scrapwatch: ${siteUrl}`,
    "",
    `Stop these: ${unsubUrl}`,
  ].join("\n");
  return { subject, text };
}

export function renderConfirmation({ sub, siteUrl, unsubUrl }) {
  const where = sub.city === "any" ? "Minneapolis and Saint Paul" : sub.city;
  const what = sub.signals.length === 2 ? "teardowns and big electrical jobs" : sub.signals[0] === "teardown" ? "teardowns" : "big electrical jobs";
  return {
    subject: `Scrapwatch is on: ${what}, ${where}`,
    text: [
      `You will get one email on any day a new permit lands: ${what}, ${where}.`,
      "We check the permit desks once a day. No mail on a quiet day.",
      "",
      `Latest rows, any time: ${siteUrl}`,
      `Stop these: ${unsubUrl}`,
    ].join("\n"),
  };
}

// What the page and the feed compute from the whole file, so no number on the
// page is typed. Last-issued per city is the honest coverage line: Saint Paul's
// desk stopped publishing in mid-2025 and this is where a reader sees it.
export function summarize(rows) {
  const byCity = {};
  for (const r of rows) {
    const c = byCity[r.city] || (byCity[r.city] = { rows: 0, teardown: 0, electrical: 0, last_issued: "" });
    c.rows += 1;
    if (r.signal === "teardown") c.teardown += 1; else c.electrical += 1;
    if (r.issued > c.last_issued) c.last_issued = r.issued;
  }
  return {
    rows: rows.length,
    teardown: rows.filter((r) => r.signal === "teardown").length,
    electrical: rows.filter((r) => r.signal === "electrical").length,
    by_city: byCity,
  };
}
