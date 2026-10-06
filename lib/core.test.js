import test from "node:test";
import assert from "node:assert/strict";
import { summarize, toRow, describe, wrecker, cleanYear, parcelFacts } from "./core.js";

// Shapes copied from the live register and the Hennepin parcel layer, 2026-10-06.
const raw = [
  { permitNumber: "BLDG1197039", Display: "2003 COMO AVE SE", APN: "1902923220049", Latitude: 44.98811, Longitude: -93.22397,
    Neighborhoods_Desc: "Como", Wards: "1", applicantName: "BD Construction, LLC", occupancyType: "SFD", status: "Issued",
    milestone: "Hole Inspection", permit_Value: 22000, totalFees: 516.2, dwellingUnitsEliminated: null,
    comments: "Wreck a Single Family Home per PDR PLAN21400.", issueDate: 1790954685000, completeDate: null },
  { permitNumber: "BLDG1182786", Display: "3246 NICOLLET AVE", APN: "0302824240015", Latitude: 44.94, Longitude: -93.27,
    Neighborhoods_Desc: "Lyndale", applicantName: "RAMSEY COMPANIES", occupancyType: "Comm", status: "Closed",
    comments: "Wreck a convenience store.  This permit is associated with Building Permit BLDG1150485 and PDR PLAN17614.", issueDate: 1788192000000 },
  { permitNumber: "BLDG0000001", Display: "3412 29TH ST W", APN: "0000000000001", Neighborhoods_Desc: "",
    applicantName: "David Hovda", occupancyType: "TFD", status: "Issued",
    comments: "A construction permit has not been submitted or approved. \nTherefore, any excavation left after the removal", issueDate: 1771632000000 },
];
const parcels = {
  "1902923220049": { BUILD_YR: "1903", PR_TYP_NM1: "RESIDENTIAL", MKT_VAL_TOT: 240600, LAND_MV1: 81000, BLDG_MV1: 159600,
    PARCEL_AREA: 7210.78, SALE_DATE: "202402", SALE_PRICE: 500000 },
  "0302824240015": { BUILD_YR: "2026", PR_TYP_NM1: "COMMERCIAL-PREFERRED", MKT_VAL_TOT: 0 },
  "0000000000001": { BUILD_YR: "0000" },
};
const rows = raw.map((a) => toRow(a, parcels));

test("toRow: house vs big, label, address casing, Chicago date, coordinates, permit fields", () => {
  assert.equal(rows[0].kind, "house");
  assert.equal(rows[0].label, "House");
  assert.equal(rows[0].address, "2003 Como Ave SE");
  assert.equal(rows[0].issued, "2026-10-02");
  assert.equal(rows[0].lat, 44.98811);
  assert.equal(rows[0].stage, "Hole Inspection");
  assert.equal(rows[0].value, 22000);
  assert.equal(rows[1].kind, "big");
  assert.equal(rows[1].label, "Commercial building");
  assert.equal(rows[2].label, "Duplex");
  assert.equal(rows[2].address, "3412 29th St W");
  assert.equal(rows[2].lat, null);
});

test("a person's name is never shown as the wrecker; a company is", () => {
  assert.equal(rows[2].wrecker, "");
  assert.equal(wrecker("Nitti Rolloff Services Inc"), "Nitti Rolloff Services Inc");
  assert.equal(wrecker("RAMSEY COMPANIES"), "Ramsey Companies");
  assert.ok(!JSON.stringify(rows).includes("Hovda"));
});

test("parcel: the old building's year, or 'rebuilt' when the county now shows a newer one", () => {
  assert.equal(rows[0].parcel.built, 1903);
  assert.equal(rows[0].parcel.use, "Residential");
  assert.deepEqual(rows[0].parcel.sold, { month: "2024-02", price: 500000 });
  assert.equal(rows[0].parcel.lot_sqft, 7211);
  assert.equal(rows[1].parcel.built, null);
  assert.equal(rows[1].parcel.rebuilt, 2026);
  assert.equal(rows[1].parcel.value, null);
  assert.equal(rows[1].parcel.use, "Commercial Preferred");
  assert.equal(parcelFacts(null, "2026-01-01"), null);
  assert.equal(cleanYear("0000"), null);
  assert.equal(rows[2].parcel.built, null);
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

test("summarize counts 30 days, a year, and the house/big split", () => {
  const s = summarize(rows, "2026-10-06");
  assert.equal(s.rows, 3);
  assert.equal(s.last_30, 1);
  assert.equal(s.last_365, 3);
  assert.equal(s.houses, 2);
  assert.equal(s.newest, "2026-10-02");
});
