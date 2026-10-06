# Demolition Notice

A free email the morning a building in Minneapolis gets a demolition permit: the address,
the company tearing it down, and a map link.

Live at **scrapwatch.vercel.app**. (The repo kept its old name, scrapwatch.)

## Who it's for

People who make a living on what comes out of a building before and during a teardown:
scrappers pulling copper wiring, junk haulers, salvage pickers after furnaces, AC units,
water heaters, appliances and fixtures. Their scarce input is knowing *which* building is
coming down *this week*. The city already announces it, in a permit list nobody reads.

## Where it came from

Aidan, digging through Minneapolis permits for a client, looking for new restaurants:
the city issues a "demolition permit" (the register calls it *Wrecking*) when a building is
about to be knocked down. Which means scrap metal, copper, used HVAC. And there are people
who make a living doing junk arbitrage. They are the customer.

## What one alert row carries

Kind (house, duplex, apartment building, commercial building), address, neighborhood,
year built (Hennepin County parcel layer, when the county has it), the wrecking company
(only when the applicant reads as a company; a homeowner's name is never shown), the
day the permit was issued, a one-line note on what the building was when the city wrote
one ("Convenience store", "Prospect Foundry building"), and a Google Maps link.

A permit means the city said yes. It does not mean the building is still standing; some
come down the same week. The page and every email say so, and say to ask the owner or
the crew before taking anything.

## The numbers (measured 2026-10-06 off the live register)

90 Wrecking permits in the last 365 days, none cancelled: 63 houses and duplexes,
27 apartment and commercial buildings. 8 in the last 30 days. Year built joined on 68
of 90. A company named on 89 of 90.

## How it runs

- **Source:** the City of Minneapolis permit register (ArcGIS `CCS_Permits`, no key),
  `permitType='Wrecking' AND status<>'Cancelled'`, last 365 days, read directly by the
  function. Year built: Hennepin `LAND_PROPERTY/MapServer/1` by APN in batches of 150;
  if the county is down the alert still goes without the year. Field notes and traps:
  the `mpls-permits` skill. (Until 2026-10-06 this read the Brick & Mortar platform
  export, which stopped refreshing when its permits job was disabled 2026-10-02.)
- **One function**, `api/scrapwatch.js`, routed by `?action=`: `feed`, `subscribe`,
  `unsubscribe`, `check` (the cron), `status`.
- **Storage:** Cloudflare Workers KV over REST (namespace `SCRAPWATCH`). Keys: `sub:<id>`,
  `seen:mpls-wrecking`, `log:<date>`, `log:latest`. (`seen` is the retired source's set.)
- **Mail:** Mailgun on `brickandmortar.dev`, plain text, hyphens not em dashes, unsubscribe
  link in every message.
- **Cron:** daily at 13:00 UTC (`vercel.json`). The first run on a source **baselines** and
  mails nothing; after that a subscriber gets only new rows of the kinds they picked
  (`house`, `big`). Subscribers from the old product carry no kinds and get everything.
- **CORS:** `subscribe` and `feed` allow brickandmortar.dev, whose `trade` role carries the
  sign-up card. Old payloads (`city`, `signals`) are accepted and sign up for everything.
- **Counting signups:** `GET /api/scrapwatch?action=status` with `Authorization: Bearer $CRON_SECRET`.

Local: `node scripts/serve_local.mjs 4180` loads `.env` and serves the page and the function.
Tests: `npm test`.

Free. No Stripe.

## History

Built 2026-09-07 as Scrapwatch, an alert for transformer and switchgear refurbishers off
commercial teardowns and Saint Paul electrical permits. Rebuilt 2026-10-06 as Demolition
Notice for the junk-arbitrage customer, every Minneapolis wrecking permit, houses included.
The dealer and contractor drafts in `drafts/` belong to the old product.
