// Pure functions. Nothing here touches the network, so all of it is testable
// with `npm test` and none of it can mail anyone by accident.
//
// Demolition Notice reads one thing: the City of Minneapolis permit register,
// permitType = 'Wrecking'. Field notes and traps live in the mpls-permits skill
// (~/.claude/skills/mpls-permits/SKILL.md); the ones that shaped this file are
// cited where they bite.

import crypto from "node:crypto";

// Two kinds a subscriber can pick. A junk hauler working houses and one with a
// roll-off for a strip mall want different mail.
//   house = 1 to 4 units (SFD, TFD, 3to4, TH)   big = apartments, commercial, the rest
export const KINDS = ["house", "big"];
const HOUSE_OCC = new Set(["SFD", "TFD", "3to4", "TH"]);
const LABEL = {
  SFD: "House", TFD: "Duplex", "3to4": "3 to 4 unit building", TH: "Townhouse",
  MFD: "Apartment building", Comm: "Commercial building", Mixed: "Mixed-use building",
  Accessory: "Garage or shed",
};

export function subscriberId(email) {
  return crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex").slice(0, 16);
}

// The bricks `trade` card still posts the old shape ({city, signals:["teardown",
// "electrical"]}) until its own rebuild ships, and old subscribers carry it in KV.
// Anything that is not a known kind means "everything".
export function validateSignup(body) {
  const email = String(body?.email || "").trim().slice(0, 254);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "That email doesn't look right. Check it and try again." };
  }
  let kinds = Array.isArray(body?.kinds) ? body.kinds : [body?.kinds].filter(Boolean);
  kinds = [...new Set(kinds.map(String).filter((k) => KINDS.includes(k)))];
  if (!kinds.length) kinds = [...KINDS];
  return { ok: true, sub: { email, kinds } };
}

// ---- turning a register row into an alert row ----------------------------

function title(s) {
  return String(s || "").trim().split(/\s+/).map((w) => {
    if (/^\d+(st|nd|rd|th)$/i.test(w)) return w.toLowerCase();
    if (/^\d/.test(w) || /^(NE|NW|SE|SW|N|S|E|W)$/i.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

// applicantName is sometimes the homeowner (skill trap). Show it only when it
// reads as a company; never show fullName, which is a person.
const BIZ = /\b(INC|LLC|L\.L\.C|CORP|CORPORATION|CO|COMPANY|COMPANIES|CONST|CONSTRUCTION|BUILDERS|BUILDING|HOMES|GROUP|PROPERT\w*|DEVELOP\w*|CONTRACT\w*|SERVICES|ENTERPRISES|EXCAVAT\w*|WRECKING|DEMOLITION|SITEWORK|ROLLOFF|TRUCKING|SONS|LTD|TECH)\b/i;
export function wrecker(name) {
  const n = String(name || "").trim();
  if (!n || !BIZ.test(n)) return "";
  return n === n.toUpperCase() ? title(n).replace(/\b(Llc|Inc)\b/g, (m) => (m === "Llc" ? "LLC" : m)) : n;
}

// `comments` is mostly boilerplate about filling the hole. Keep a sentence only
// if it says something a scrapper can use (what the building was, the site's
// name); drop the rules, the plan numbers, the SAC units and the square footage.
const BOILER = /(construction permit|building permit has not|excavation|hole must|graded|seeded|fill(ed)? to match|granular|drainage|ordinance|disturbed area|square footage|soil|no pdr|pdr (is|has)|sac (unit|credit)|requirements will apply|valuation is part)/i;
const LEAD = /^(applicant is |this permit is to )?wreck(ing)?( of)?\s+(a |an |the )?(existing )?/i;
const GENERIC = /^(single[- ]family (dwelling|home)|sfd|duplex|commercial (building|structure)|house|home|sfd wrecking)$/i;
export function describe(comments) {
  const raw = String(comments || "").replace(/\s+/g, " ").trim();
  if (!raw || /^source information/i.test(raw)) return "";
  const keep = [];
  for (let s of raw.split(/(?<=\.)\s+/)) {
    s = s
      .replace(/\bthis permit is associated with.*$/i, "")
      .replace(/\b(per |- )?(pdr )?plan\d+\b.*$/i, "")
      .replace(/[,-]?\s*\d+\s*sac (units?|credits?).*$/i, "")
      .replace(/\(\w+\)/g, "")
      .replace(/\s*@\s*\d+.*$/, "")
      .replace(/[\s.,;:-]+$/, "")
      .trim();
    // the register cuts comments at 255 characters, so a tail like "A lay" is a
    // torn boilerplate sentence, not a note
    if (!s || BOILER.test(s) || s.split(" ").length < 3) continue;
    keep.push(s);
    break; // one sentence is plenty on a phone
  }
  let out = keep.join(" ").replace(LEAD, "").replace(/\s*-\s*$/, "").trim();
  if (!out || GENERIC.test(out)) return "";
  if (out === out.toUpperCase()) out = out.toLowerCase();
  out = out.charAt(0).toUpperCase() + out.slice(1);
  return out.slice(0, 120);
}

const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
export function isoDay(ms) { return ms == null ? "" : fmtDay.format(new Date(ms)); }

// BUILD_YR comes back "0000" for a parcel the county has no year on; that is
// unknown, not year zero.
export function cleanYear(y) {
  const n = Number(y);
  return Number.isFinite(n) && n >= 1800 && n <= 2100 ? n : null;
}

export function toRow(a, years = {}) {
  const occ = a.occupancyType || "";
  const address = title(a.Display);
  return {
    permit_no: a.permitNumber || "",
    address,
    hood: a.Neighborhoods_Desc || "",
    kind: HOUSE_OCC.has(occ) ? "house" : "big",
    label: LABEL[occ] || "Building",
    year_built: cleanYear(years[a.APN]),
    wrecker: wrecker(a.applicantName),
    issued: isoDay(a.issueDate),
    closed: a.status === "Closed",
    what: describe(a.comments),
    map: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Minneapolis, MN`)}`,
  };
}

// A row's identity. permitNumber is the city's own id; the address is in the
// key because one permit can be filed on two addresses.
export function rowKey(r) {
  return r?.permit_no ? `${r.permit_no}|${r.address || ""}` : null;
}

export function newRows(seen, rows) {
  const s = seen instanceof Set ? seen : new Set(seen || []);
  return rows.filter((r) => { const k = rowKey(r); return k && !s.has(k); });
}

export function matches(sub, row) {
  if (!sub?.active) return false;
  const kinds = (sub.kinds || []).filter((k) => KINDS.includes(k));
  return !kinds.length || kinds.includes(row.kind);
}

// ---- the mail -------------------------------------------------------------
// Plain text on purpose: it is read on a phone in a truck. Hyphens, never em
// dashes. Short words.

function longDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function renderRow(r) {
  const lines = [`${r.label.toUpperCase()} - ${r.address}${r.hood ? ` (${r.hood})` : ""}`];
  lines.push(`  ${r.year_built ? `Built ${r.year_built}. ` : ""}City said yes on ${longDay(r.issued)}.`);
  lines.push(`  Tearing it down: ${r.wrecker || "not listed"}`);
  if (r.what) lines.push(`  What it is: ${r.what}`);
  lines.push(`  Map: ${r.map}`);
  return lines.join("\n");
}

export function renderMail({ rows, siteUrl, unsubUrl }) {
  const n = rows.length;
  const subject = n === 1
    ? `${rows[0].label} coming down: ${rows[0].address}`
    : `${n} buildings coming down in Minneapolis`;
  const text = [
    n === 1 ? "A new demolition permit in Minneapolis:" : `${n} new demolition permits in Minneapolis:`,
    "",
    ...rows.map(renderRow).flatMap((s) => [s, ""]),
    "Some buildings come down the same week the permit is issued. Drive by first.",
    "Ask the owner or the crew before you take anything.",
    "",
    "From the City of Minneapolis permit list, checked every morning.",
    `Demolition Notice: ${siteUrl}`,
    "",
    `Stop these: ${unsubUrl}`,
  ].join("\n");
  return { subject, text };
}

export function kindWords(kinds) {
  const k = (kinds || []).filter((x) => KINDS.includes(x));
  if (k.length === 1) return k[0] === "house" ? "houses and duplexes" : "apartments and commercial buildings";
  return "every building";
}
const ONE = { "houses and duplexes": "a house or duplex", "apartments and commercial buildings": "an apartment or commercial building", "every building": "a building" };

export function renderConfirmation({ sub, siteUrl, unsubUrl }) {
  const what = kindWords(sub.kinds);
  return {
    subject: `You're on Demolition Notice: ${what} in Minneapolis`,
    text: [
      `When the city okays tearing down ${ONE[what]} in Minneapolis, you get an email.`,
      "The address, who is doing the job, and a map link.",
      "We check every morning. No email on a quiet day.",
      "",
      `Latest ones, any time: ${siteUrl}`,
      `Stop these: ${unsubUrl}`,
    ].join("\n"),
  };
}

// What the page shows above the list, all computed from the rows: nothing typed.
export function summarize(rows, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const back = (days) => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  };
  const d30 = back(30);
  return {
    rows: rows.length,
    last_30: rows.filter((r) => r.issued >= d30).length,
    houses: rows.filter((r) => r.kind === "house").length,
    big: rows.filter((r) => r.kind === "big").length,
    newest: rows.reduce((m, r) => (r.issued > m ? r.issued : m), ""),
    oldest: rows.reduce((m, r) => (!m || r.issued < m ? r.issued : m), ""),
  };
}
