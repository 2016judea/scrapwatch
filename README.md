# scrapwatch

Know where a working electrical asset is about to become scrap, before the scrap yard does.

## What it is

An alert service for the people who buy used transformers and switchgear: refurbishers
with yards (Maddox, Sunbelt Solomon, T&R Electric), regional surplus dealers, and scrap
yards with a resale side. Their scarce input is not buyers. It is *seller leads*: knowing
which building, plant or substation is about to shed a $20k to $500k unit that someone
else sees as metal weight.

Public records announce that ahead of time:

- **commercial and multifamily demolition permits** (the demo contractor is named on the permit)
- **commercial electrical replacement permits**
- **plant closings** (MN DEED monthly WARN reports)

We watch those records, join them to the parcel, and email a subscriber the moment a new
one lands in their territory.

## Where the data comes from

The record itself is free. It ships as an open dataset on the Brick & Mortar platform
(`brickandmortar.dev`), derived from the Twin Cities permits slice, and this repo consumes
that export. This product does not own the record; it owns the notification.

## Why it can be a business, and why it is not one yet

Measured 2026-09-07 off the platform's permits slice: 25 commercial and multifamily
wrecking permits in Minneapolis in the trailing 12 months. Saint Paul shows zero, which is
a data gap, not a fact about Saint Paul. A reconditioned 2500 kVA padmount resells for
about $25k with a two-week ship against an 80 to 120 week wait for new; scrap value of the
same unit is low four figures. The spread is real, the metro count is small. This becomes a
business only when the same feed is repeated city by city.

Free first. Signups are the demand measurement. A price goes on the alert, never the record.

## How it runs

- **Source:** `SOURCE_URL`, the platform's `/api/export?dataset=teardowns&format=json&columns=…`
  (558 rows on 2026-09-07: 205 teardowns, 353 top-decile electrical jobs). Cached 10 min.
- **One function**, `api/scrapwatch.js`, routed by `?action=`: `feed`, `subscribe`,
  `unsubscribe`, `check` (the cron), `status`. Vercel Hobby caps functions at 12; this uses one.
- **Storage:** Cloudflare Workers KV over REST (namespace `SCRAPWATCH`), because the account
  token was already on disk. Keys: `sub:<id>`, `seen`, `log:<date>`, `log:latest`.
- **Mail:** Mailgun on `brickandmortar.dev`, plain text, hyphens not em dashes, unsubscribe
  link in every message.
- **Cron:** daily at 13:00 UTC (`vercel.json`). The first run **baselines** and mails nothing;
  after that a subscriber is mailed only the rows that are new and match their city and kind.
- **A row's identity is `permit_no|address`**, not the permit number alone: one permit can be
  filed on two addresses (2 of 558 rows).
- **Counting signups:** `GET /api/scrapwatch?action=status` with `Authorization: Bearer $CRON_SECRET`.

Local: `node scripts/serve_local.mjs 4180` loads `.env` and serves the page and the function.
Tests: `npm test`.

## Status

Scaffolded 2026-09-07 from a research session in the `bricks` repo; built the same evening.
Live at scrapwatch.vercel.app. One subscriber (the test address). No price, no Stripe.
