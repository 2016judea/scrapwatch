# Demolition Notice

A map of every building the City of Minneapolis has okayed for demolition, and everything
the public record says about it, for the people who make a living on what comes out first.

Live at **demolition-notice.vercel.app** (scrapwatch.vercel.app still serves). The repo kept
its old name, scrapwatch.

## Who it's for

Scrappers pulling copper wiring, junk haulers, salvage pickers after furnaces, AC units,
water heaters, appliances and fixtures. Their scarce input is knowing *which* building is
coming down. The city already announces it, in a permit list nobody reads.

## What is on the map

One pin per Wrecking permit in the city register (2016 on; cancelled permits left out).
Last 30 days: big orange-red. Last year: amber. Older: small and grey. Three chips filter
by recency and carry the counts.

Tap a pin and it leads with what you act on: the address (a Google Maps link), the kind of
building and how long ago the city said yes, year built, who is tearing it down, whether
the permit is still open, the city's one-line note on what the building was, the
businesses listed on the lot (commercial only), and a "likely inside" guess. Under
"Everything we know": permit number, dates, status and stage, job value, fees, units
removed, neighborhood, ward, and the Hennepin County parcel as it stands today (use,
market value, land and building value, lot size, last sale).

Never a person's name. The applicant shows only when it reads as a company; the
register's `fullName` and the county's owner and taxpayer fields are never requested.

When the county's year built is the permit's year or later, the old building is gone and
the parcel describes its replacement; the pin says "already rebuilt" instead of passing
the new year off as the old one.

**Was:** up to three businesses Overture Places lists on the parcel, for apartment and
commercial permits only, and only while the county still shows the old building (once it
shows a newer one, the listings are the new building's tenants). Built by
`scripts/build_occupants.py` into `data/occupants.json` from Brick & Mortar's `businesses`
export; re-run it after a new Overture release. Not Google Places: Google's terms forbid
storing Places content beyond the place ID and showing it on a non-Google map, and this is
a Leaflet map with a public repo. Overture is CDLA-Permissive-2.0 and Apache-2.0, credited
in the map's attribution.

**Likely inside:** a small rule table in `lib/core.js` (`INSIDE_RULES`, each rule with its
reason) from the building type, the city's note, the businesses listed and the year built.
The page labels it a guess.

A permit means the city said yes, not that the building is still standing. Drive by
first; ask the owner or the crew before you take anything. The page says so.

## The numbers (measured 2026-10-06 off the live register)

918 Wrecking permits not cancelled, Dec 2016 to Oct 2026: 673 houses and duplexes, 245
apartment and commercial buildings. 90 in the last year, 8 in the last 30 days. A company
named on 901. Parcel joined on 856. A business listed on 71 (of 245 apartment and
commercial permits; 108 parcels matched, the rest were already rebuilt). 916 have coordinates. The payload is 542 KB, 71 KB
gzipped.

## How it runs

- **Page:** `index.html`, Leaflet from cdnjs on Esri's keyless light-gray tiles (Carto's
  `light_all` answered "API KEY REQUIRED" on 2026-10-06). Canvas markers, no clustering:
  918 circles draw fine on a phone and clusters would hide the recency colours.
- **Data:** one function, `api/scrapwatch.js`. It reads the City of Minneapolis permit
  register (ArcGIS `CCS_Permits`, no key) on request and joins Hennepin
  `LAND_PROPERTY/MapServer/1` by APN. Vercel's edge holds the answer an hour
  (`s-maxage=3600`, `stale-while-revalidate=86400`), so the register is read about once an
  hour and a phone gets a cached response.
- **Parcel cache:** Cloudflare Workers KV over REST (namespace `SCRAPWATCH`), key
  `parcels:v1`. Only APNs not already cached are asked of the county, because the county
  answered a laptop and failed Vercel on the same afternoon. Delete the key to refresh
  values. Field notes and traps: the `mpls-permits` skill.

Local: `node scripts/serve_local.mjs 4180` loads `.env` and serves the page and the function.
Tests: `npm test`.

Free. No email, no sign-up, no Stripe.

## History

Built 2026-09-07 as Scrapwatch, an email alert for transformer and switchgear refurbishers.
Rebuilt 2026-10-06 as Demolition Notice, an email alert for every Minneapolis wrecking
permit; the same day Aidan dropped the email entirely and made the page just a map. One
sign-up record from the alert sits untouched in KV (`sub:*`) and nothing reads it. The
dealer and contractor drafts in `drafts/` belong to the first product.
