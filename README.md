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

## Status

Scaffolded 2026-09-07 from a research session in the `bricks` repo. Nothing deployed yet.
