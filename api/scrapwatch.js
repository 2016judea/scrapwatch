// The one function behind the map.
//
//   GET /api/scrapwatch            every Minneapolis demolition permit + what we know
//
// Built on request and held at Vercel's edge for an hour (s-maxage=3600), so a
// phone gets a cached answer and the city's register is read about once an hour.
// No cron, no mail, no sign-up: on 2026-10-06 Aidan dropped the email alert and
// made the page just a map.
//
// SOURCE: the City of Minneapolis permit register, every Wrecking permit it holds
// (2016 on), cancelled ones left out. Parcel facts are joined from Hennepin
// County's parcel layer by APN; the join is optional, a pin goes out without
// them when the county is down.

import { kvGet, kvPut } from "../lib/kv.js";
import { summarize, toRow } from "../lib/core.js";
// Who was in each commercial building, from Overture Places (open licence), built
// by scripts/build_occupants.py. Not Google Places: see that script for why.
import occupantsDoc from "../data/occupants.json" with { type: "json" };

const REGISTER = "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0/query";
const PARCELS = "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1/query";
const FIELDS = [
  "Display", "APN", "Latitude", "Longitude", "Neighborhoods_Desc", "Wards", "applicantName",
  "permitNumber", "occupancyType", "status", "milestone", "permit_Value", "totalFees",
  "dwellingUnitsEliminated", "comments", "issueDate", "completeDate",
].join(",");
// Owner and taxpayer names are on this layer too; they are never requested.
const PARCEL_FIELDS = "PID,BUILD_YR,PR_TYP_NM1,MKT_VAL_TOT,LAND_MV1,BLDG_MV1,PARCEL_AREA,SALE_DATE,SALE_PRICE";
const PARCEL_KEY = "parcels:v1";
const UA = { "User-Agent": "demolition-notice/2.0 (+https://demolition-notice.vercel.app)" };

let cache = { at: 0, payload: null };
const CACHE_MS = 10 * 60 * 1000;

async function wreckingPermits() {
  const out = [];
  for (let offset = 0; ; offset += 2000) {
    const q = new URLSearchParams({
      where: "permitType='Wrecking' AND status<>'Cancelled'",
      outFields: FIELDS, orderByFields: "issueDate DESC", returnGeometry: "false",
      resultOffset: String(offset), resultRecordCount: "2000", f: "json",
    });
    const r = await fetch(`${REGISTER}?${q}`, { headers: UA });
    if (!r.ok) throw new Error(`register ${r.status}`);
    const d = await r.json();
    if (d.error) throw new Error(`register: ${d.error.message || "error"}`);
    for (const f of d.features || []) out.push(f.attributes);
    if (!d.exceededTransferLimit) break;
  }
  return out;
}

// Every answer the county gives is kept in KV and only APNs not already there
// are asked for. The county's server answered from a laptop and failed from
// Vercel on the same afternoon (2026-10-06); with the cache, one good answer is
// enough. A parcel's value moves once a year; delete the key to refresh it.
async function parcelsFor(apns) {
  let parcels = {};
  try { parcels = (await kvGet(PARCEL_KEY)) || {}; } catch { parcels = {}; }
  const ids = [...new Set(apns.filter((x) => /^\d{13}$/.test(x || "") && !(x in parcels)))];
  const join = { asked: ids.length, got: 0, errors: [] };
  for (let i = 0; i < ids.length; i += 150) {
    const batch = ids.slice(i, i + 150);
    try {
      const body = new URLSearchParams({
        where: `PID IN (${batch.map((x) => `'${x}'`).join(",")})`,
        outFields: PARCEL_FIELDS, returnGeometry: "false", f: "json",
      });
      const r = await fetch(PARCELS, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20000) });
      const d = JSON.parse(await r.text());
      if (d.error) throw new Error(d.error.message || "county error");
      for (const f of d.features || []) {
        const { PID, ...rest } = f.attributes;
        parcels[PID] = rest; join.got += 1;
      }
      // a PID the county answered without is recorded as unknown, so it is not re-asked
      for (const x of batch) if (!(x in parcels)) parcels[x] = null;
    } catch (e) { join.errors.push(String(e.message).slice(0, 120)); }
  }
  if (join.got) { try { await kvPut(PARCEL_KEY, parcels); } catch {} }
  return { parcels, join };
}

async function build() {
  if (cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload;
  const raw = await wreckingPermits();
  const { parcels, join } = await parcelsFor(raw.map((a) => a.APN));
  const rows = raw.map((a) => toRow(a, parcels, occupantsDoc.parcels)).sort((a, b) => (a.issued < b.issued ? 1 : -1));
  const payload = {
    source: "City of Minneapolis permit register (Wrecking permits, cancelled left out) + Hennepin County parcels + Overture Maps Foundation Places (CDLA-Permissive-2.0)",
    fetched: new Date().toISOString(),
    parcel_join: { ...join, with_parcel: rows.filter((r) => r.parcel).length },
    with_business: rows.filter((r) => r.was.length).length,
    totals: summarize(rows),
    rows,
  };
  cache = { at: Date.now(), payload };
  return payload;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
    const payload = await build();
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
