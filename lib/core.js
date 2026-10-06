// Pure functions. Nothing here touches the network, so all of it is testable
// with `npm test`.
//
// Demolition Notice reads one thing: the City of Minneapolis permit register,
// permitType = 'Wrecking'. Field notes and traps live in the mpls-permits skill
// (~/.claude/skills/mpls-permits/SKILL.md); the ones that shaped this file are
// cited where they bite.

// house = 1 to 4 units (SFD, TFD, 3to4, TH)   big = apartments, commercial, the rest
export const KINDS = ["house", "big"];
const HOUSE_OCC = new Set(["SFD", "TFD", "3to4", "TH"]);
const LABEL = {
  SFD: "House", TFD: "Duplex", "3to4": "3 to 4 unit building", TH: "Townhouse",
  MFD: "Apartment building", Comm: "Commercial building", Mixed: "Mixed-use building",
  Accessory: "Garage or shed",
};

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

// Hennepin's parcel record is TODAY's parcel, not the one the permit tore down.
// When the county's year built is the permit's year or later, the old building
// is gone and the record describes what replaced it; the row says so instead of
// passing the new house's year off as the old one's.
export function parcelFacts(p, issuedIso) {
  if (!p) return null;
  const yr = cleanYear(p.BUILD_YR);
  const issuedYr = Number(String(issuedIso).slice(0, 4)) || 0;
  const sale = /^\d{6}$/.test(p.SALE_DATE || "") ? `${p.SALE_DATE.slice(0, 4)}-${p.SALE_DATE.slice(4)}` : "";
  const num = (v) => (Number(v) > 0 ? Math.round(Number(v)) : null);
  return {
    built: yr && yr < issuedYr ? yr : null,
    rebuilt: yr && yr >= issuedYr ? yr : null,
    use: p.PR_TYP_NM1 ? title(String(p.PR_TYP_NM1).replace(/-/g, " ")) : "",
    value: num(p.MKT_VAL_TOT), land: num(p.LAND_MV1), bldg: num(p.BLDG_MV1),
    lot_sqft: num(p.PARCEL_AREA),
    sold: sale && num(p.SALE_PRICE) ? { month: sale, price: num(p.SALE_PRICE) } : null,
  };
}

// ---- what was in it, and what is likely still inside ---------------------

// Overture's category ids are snake_case ("fast_food_restaurant"); say them in words.
export function categoryWords(c) {
  return String(c || "").replace(/_/g, " ").replace(/\band\b/g, "&").trim();
}

// LIKELY INSIDE. A guess from the building type and age, labelled as a guess on
// the page; first rule that matches wins. Matched against the businesses listed
// at the lot, the city's note on the permit, and the occupancy label.
// Written 2026-10-06 off what scrappers and junk haulers say they pull; widen
// a rule only with a reason.
const INSIDE_RULES = [
  // kitchens carry the heaviest, most resaleable steel and the refrigeration copper
  { test: /restaurant|cafe|coffee|pizza|bakery|deli|diner|fast food|food|\bbar\b|brewery|kitchen/,
    basis: "a restaurant", items: ["walk-in cooler and its compressor", "stainless tables and sinks", "hood and exhaust fan", "grease trap"] },
  // stores that sell cold things have rows of display coolers, each with copper lines
  { test: /grocery|convenience|liquor|supermarket|\bmarket\b|gas station|service station/,
    basis: "a store with coolers", items: ["display coolers and compressors", "steel shelving", "rooftop HVAC unit"] },
  // auto shops leave lifts and compressors; tire and wash bays have pumps and motors
  { test: /\bauto|car wash|\btire|motorcycle|body shop/,
    basis: "an auto shop", items: ["car lifts", "air compressor", "steel shelving and benches", "overhead doors"] },
  // churches and schools: big boilers, old cast iron, copper roofing details
  { test: /church|cathedral|religious|chapel|school|college|academy/,
    basis: "a church or school", items: ["boiler and cast-iron radiators", "copper flashing and gutters", "doors, pews and light fixtures"] },
  // industrial lots are mostly steel, motors and heavy wire
  { test: /industrial|foundry|factory|manufactur|warehouse|freight|storage|plant|machine|propane|lumber/,
    basis: "an industrial building", items: ["structural steel", "electric motors and heavy wire", "overhead doors"] },
  // apartments multiply the house list: one water heater and fridge per unit
  { test: /apartment|mixed-use/,
    basis: "an apartment building", items: ["water heaters and boiler", "appliances in every unit", "copper plumbing and wiring"] },
  // offices, banks and clinics are the plain commercial list; named so a café in
  // an office lobby does not turn the building into a restaurant
  { test: /office|bank|clinic|medical/, basis: "an office building", items: ["rooftop HVAC unit", "light fixtures and ceiling grid", "copper wiring"] },
  { test: /garage or shed/, basis: "a garage or shed", items: ["metal roof or siding", "overhead door"] },
];
// Anything else commercial: offices, banks, clinics, salons, plain storefronts.
const COMMERCIAL = { basis: "a commercial building", items: ["rooftop HVAC unit", "aluminum storefront and glass", "light fixtures and copper wiring"] };

// Houses by age. Before ~1940 the wiring is knob-and-tube (little copper) but the
// heat is cast iron and the wood is old growth; 1940-1979 is the copper era;
// after 1980 the supply lines are often plastic, the mechanicals are newer.
function houseByYear(y) {
  if (!y) return { basis: "a house", items: ["furnace and water heater", "copper plumbing and wiring", "appliances"] };
  if (y < 1940) return { basis: `a house built ${y}`, items: ["cast-iron radiators and tub", "old-growth trim and doors", "brass and copper fixtures (old wiring has little copper)"] };
  if (y < 1980) return { basis: `a house built ${y}`, items: ["copper plumbing and wiring", "furnace and water heater", "appliances"] };
  return { basis: `a house built ${y}`, items: ["furnace, AC unit and water heater", "copper wiring (pipes are often plastic)", "appliances"] };
}

export function likelyInside(row) {
  if (row.kind === "house") return houseByYear(row.parcel?.built);
  // the city's own note on the permit outranks a tenant list: "Office building"
  // with a café in the lobby is an office building
  const own = [row.what, row.label].join(" ").toLowerCase();
  const tenants = (row.was || []).map((w) => categoryWords(w.category) + " " + w.name).join(" ").toLowerCase();
  return INSIDE_RULES.find((r) => r.test.test(own)) || INSIDE_RULES.find((r) => r.test.test(tenants)) || COMMERCIAL;
}

// One pin. What a scrapper acts on first (address, when, what kind, who is
// tearing it down, how old), the rest of the record after. Never a person's
// name: applicantName only when it reads as a company, fullName and the
// county's owner/taxpayer fields never read at all.
export function toRow(a, parcels = {}, occupants = {}) {
  const occ = a.occupancyType || "";
  const address = title(a.Display);
  const issued = isoDay(a.issueDate);
  const row = {
    permit_no: a.permitNumber || "",
    address,
    lat: Number.isFinite(a.Latitude) && a.Latitude ? Math.round(a.Latitude * 1e5) / 1e5 : null,
    lon: Number.isFinite(a.Longitude) && a.Longitude ? Math.round(a.Longitude * 1e5) / 1e5 : null,
    hood: a.Neighborhoods_Desc || "",
    ward: a.Wards || "",
    kind: HOUSE_OCC.has(occ) ? "house" : "big",
    label: LABEL[occ] || "Building",
    wrecker: wrecker(a.applicantName),
    issued,
    completed: isoDay(a.completeDate),
    status: a.status || "",
    stage: a.milestone || "",
    value: Number(a.permit_Value) > 0 ? Math.round(a.permit_Value) : null,
    fees: Number(a.totalFees) > 0 ? Math.round(a.totalFees * 100) / 100 : null,
    units_gone: Number(a.dwellingUnitsEliminated) > 0 ? Number(a.dwellingUnitsEliminated) : null,
    what: describe(a.comments),
    parcel: parcelFacts(parcels[a.APN], issued),
    was: [],
    inside: null,
    map: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Minneapolis, MN`)}`,
  };
  // the businesses listed on the lot TODAY: shown only for commercial permits, and
  // only while the county still has the old building there (otherwise they are
  // the new building's tenants)
  if (row.kind === "big" && !row.parcel?.rebuilt) {
    row.was = (occupants[a.APN] || []).slice(0, 3).map((o) => ({ name: o.name, category: o.category || "" }));
  }
  row.inside = likelyInside(row);
  return row;
}

// Counts for the page's filter chips, all computed from the rows: nothing typed.
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
    last_365: rows.filter((r) => r.issued >= back(365)).length,
    houses: rows.filter((r) => r.kind === "house").length,
    big: rows.filter((r) => r.kind === "big").length,
    newest: rows.reduce((m, r) => (r.issued > m ? r.issued : m), ""),
    oldest: rows.reduce((m, r) => (!m || r.issued < m ? r.issued : m), ""),
  };
}
