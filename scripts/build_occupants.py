"""Who was in each commercial building, from Overture Places, keyed by APN.

    python3 scripts/build_occupants.py

Reads Brick & Mortar's `businesses` export (Overture Places joined to the parcel
each business sits on), keeps only the parcels that carry a non-house Wrecking
permit, and writes data/occupants.json, which the function joins at request time.

Why Overture and not Google Places (2026-10-06): Google's terms forbid storing
Places content beyond the place ID and showing it on a non-Google map, and this
map is Leaflet with a public repo behind it. Overture is CDLA-Permissive-2.0 and
Apache-2.0: redistribution allowed with attribution, which the page carries.
Overture is a snapshot of what is listed TODAY, so the function shows it only
when the county still has the old building on the lot.
"""
import json
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUSINESSES = Path.home() / "Desktop/bricks/website/api/_data/exports/businesses.json"
REGISTER = "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0/query"
HOUSE = {"SFD", "TFD", "3to4", "TH"}


def permits():
    q = urllib.parse.urlencode({
        "where": "permitType='Wrecking' AND status<>'Cancelled'",
        "outFields": "APN,occupancyType", "returnGeometry": "false",
        "resultRecordCount": "2000", "f": "json"})
    req = urllib.request.Request(f"{REGISTER}?{q}", headers={"User-Agent": "demolition-notice/2.0"})
    d = json.load(urllib.request.urlopen(req, timeout=60))
    assert not d.get("exceededTransferLimit"), "page the register"
    return [f["attributes"] for f in d["features"]]


def main():
    want = {a["APN"] for a in permits() if a["occupancyType"] not in HOUSE and a.get("APN")}
    src = json.loads(BUSINESSES.read_text())
    by = defaultdict(list)
    for r in src["rows"]:
        pid = str(r.get("site_parcel_id") or "")
        if pid in want and r.get("name"):
            by[pid].append(r)
    out = {}
    for pid, rs in sorted(by.items()):
        rs.sort(key=lambda r: -(r.get("confidence") or 0))
        seen, keep = set(), []
        for r in rs:
            if r["name"].lower() in seen:
                continue
            seen.add(r["name"].lower())
            keep.append({"name": r["name"], "category": r.get("category") or ""})
        out[pid] = keep[:3]
    doc = {"_source": "Overture Maps Foundation, Places (CDLA-Permissive-2.0, Apache-2.0), "
                      "via Brick & Mortar's businesses export, retrieved " + str(src.get("retrieved", "")),
           "parcels": out}
    (ROOT / "data/occupants.json").write_text(json.dumps(doc, indent=0, ensure_ascii=False) + "\n")
    print(f"{len(want)} commercial permit parcels, {len(out)} with a business listed")


if __name__ == "__main__":
    main()
