// One function, routed by ?action=. Vercel Hobby caps a deployment at twelve
// functions; one is plenty here and keeps the whole product in one file.
//
//   GET  /api/scrapwatch?action=feed&limit=12      latest rows + totals (the page reads this)
//   POST /api/scrapwatch?action=subscribe          {email, kinds[]}  (kinds: house, big)
//   GET  /api/scrapwatch?action=unsubscribe&id=&token=
//   GET  /api/scrapwatch?action=check              the daily cron (Bearer CRON_SECRET)
//   GET  /api/scrapwatch?action=status             subscribers + last run (Bearer CRON_SECRET)
//
// SOURCE (2026-10-06): the City of Minneapolis permit register, read directly,
// every Wrecking permit issued in the last year. This used to read the bricks
// platform export, which stopped refreshing when the bricks permits job was
// disabled on 2026-10-02; the alert could never fire. Year built is joined from
// Hennepin County's parcel layer by APN, and the join is optional: if the county
// is down the alert still goes, without the year.

import crypto from "node:crypto";
import { kvGet, kvPut, kvList } from "../lib/kv.js";
import {
  newRows, rowKey, matches, validateSignup, subscriberId,
  renderMail, renderConfirmation, summarize, toRow,
} from "../lib/core.js";

const REGISTER = "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0/query";
const PARCELS = "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1/query";
const FIELDS = "Display,APN,Neighborhoods_Desc,applicantName,permitNumber,occupancyType,status,comments,issueDate";
// The seen set from the old bricks-export source keyed rows differently; a new
// key means the first run on this source baselines instead of mailing a year.
const SEEN_KEY = "seen:mpls-wrecking";
const UA = { "User-Agent": "demolition-notice/1.0 (+https://demolition-notice.vercel.app)" };

let cache = { at: 0, payload: null };
const CACHE_MS = 10 * 60 * 1000;

async function wreckingPermits(sinceIso) {
  const out = [];
  for (let offset = 0; ; offset += 2000) {
    const q = new URLSearchParams({
      where: `permitType='Wrecking' AND status<>'Cancelled' AND issueDate >= date '${sinceIso}'`,
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

// Year built never changes, so every answer the county gives is kept in KV
// ("years") and only APNs not already there are asked for. The county's server
// answered from a laptop and failed from Vercel on the same afternoon
// (2026-10-06); with the cache, one good answer is enough forever.
async function yearsBuilt(apns) {
  let years = {};
  try { years = (await kvGet("years")) || {}; } catch { years = {}; }
  const ids = [...new Set(apns.filter((x) => /^\d{13}$/.test(x || "") && !(x in years)))];
  const join = { asked: ids.length, got: 0, errors: [] };
  for (let i = 0; i < ids.length; i += 150) {
    const batch = ids.slice(i, i + 150);
    try {
      const body = new URLSearchParams({
        where: `PID IN (${batch.map((x) => `'${x}'`).join(",")})`,
        outFields: "PID,BUILD_YR", returnGeometry: "false", f: "json",
      });
      const r = await fetch(PARCELS, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20000) });
      const text = await r.text();
      const d = JSON.parse(text);
      if (d.error) throw new Error(d.error.message || "county error");
      for (const f of d.features || []) { years[f.attributes.PID] = f.attributes.BUILD_YR; join.got += 1; }
      // a PID the county answered without is recorded as unknown, so it is not re-asked daily
      for (const x of batch) if (!(x in years)) years[x] = null;
    } catch (e) { join.errors.push(String(e.message).slice(0, 120)); }
  }
  if (join.got || ids.length) { try { await kvPut("years", years); } catch {} }
  return { years, join };
}

async function source() {
  if (cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload;
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const raw = await wreckingPermits(since);
  const { years, join } = await yearsBuilt(raw.map((a) => a.APN));
  const rows = raw.map((a) => toRow(a, years)).sort((a, b) => (a.issued < b.issued ? 1 : -1));
  const payload = { since, rows, join, fetched: new Date().toISOString() };
  cache = { at: Date.now(), payload };
  return payload;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  if ((req.headers["content-type"] || "").includes("application/x-www-form-urlencoded")) {
    const p = new URLSearchParams(raw);
    return { email: p.get("email"), kinds: p.getAll("kinds") };
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

async function sendMail({ to, subject, text }) {
  const { MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM } = process.env;
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) throw new Error("Mailgun is not configured");
  const params = new URLSearchParams();
  params.set("from", `Demolition Notice <${MAILGUN_FROM || `hello@${MAILGUN_DOMAIN}`}>`);
  params.set("to", to);
  params.set("subject", subject);
  params.set("text", text);
  const resp = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!resp.ok) throw new Error(`Mailgun ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

function siteUrl() { return (process.env.SITE_URL || "https://demolition-notice.vercel.app").replace(/\/$/, ""); }
function unsubUrl(id, token) { return `${siteUrl()}/api/scrapwatch?action=unsubscribe&id=${id}&token=${token}`; }
function authed(req) {
  const s = process.env.CRON_SECRET;
  return Boolean(s) && req.headers.authorization === `Bearer ${s}`;
}

async function feed(req, res, url) {
  const payload = await source();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 100);
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600");
  res.status(200).json({
    source: "City of Minneapolis permit register, Wrecking permits",
    since: payload.since,
    fetched: payload.fetched,
    year_join: { ...payload.join, with_year: payload.rows.filter((r) => r.year_built).length },
    totals: summarize(payload.rows),
    rows: payload.rows.slice(0, limit),
  });
}

async function subscribe(req, res) {
  const v = validateSignup(await readBody(req));
  if (!v.ok) { res.status(400).json({ ok: false, error: v.error }); return; }
  const id = subscriberId(v.sub.email);
  const existing = await kvGet(`sub:${id}`);
  const sub = {
    ...v.sub,
    id,
    token: existing?.token || crypto.randomBytes(12).toString("hex"),
    active: true,
    created: existing?.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  await kvPut(`sub:${id}`, sub);
  const mail = renderConfirmation({ sub, siteUrl: siteUrl(), unsubUrl: unsubUrl(id, sub.token) });
  let mailed = true;
  try { await sendMail({ to: sub.email, ...mail }); }
  catch (e) { mailed = false; console.error("confirmation mail failed", e.message); }
  res.status(200).json({ ok: true, mailed, kinds: sub.kinds });
}

async function unsubscribe(req, res, url) {
  const id = url.searchParams.get("id") || "";
  const token = url.searchParams.get("token") || "";
  const sub = /^[a-f0-9]{16}$/.test(id) ? await kvGet(`sub:${id}`) : null;
  const ok = sub && sub.token === token;
  if (ok) await kvPut(`sub:${id}`, { ...sub, active: false, updated: new Date().toISOString() });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(ok ? 200 : 400).end(
    `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Demolition Notice</title>` +
    `<body style="font:18px/1.5 system-ui;margin:3rem auto;max-width:34rem;padding:0 1rem">` +
    (ok ? `<p>Done. No more emails.</p><p><a href="${siteUrl()}">Back to Demolition Notice</a></p>`
        : `<p>That link didn't match a subscription. Reply to any Demolition Notice email and we'll sort it by hand.</p>`),
  );
}

async function loadSubscribers() {
  const keys = await kvList("sub:");
  const subs = await Promise.all(keys.map((k) => kvGet(k)));
  return subs.filter(Boolean);
}

async function check(req, res) {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  cache = { at: 0, payload: null };
  const payload = await source();
  const rows = payload.rows;
  const seen = await kvGet(SEEN_KEY);
  const today = new Date().toISOString().slice(0, 10);

  // FIRST RUN: baseline, never mail. An empty seen set makes every row "new",
  // and mailing a year of historical permits to a new subscriber would be the last
  // mail they read.
  if (!Array.isArray(seen)) {
    const all = rows.map(rowKey).filter(Boolean);
    await kvPut(SEEN_KEY, all);
    const log = { date: today, baseline: true, seen: all.length, new: 0, mailed: 0 };
    await kvPut(`log:${today}`, log); await kvPut("log:latest", log);
    res.status(200).json(log); return;
  }

  const fresh = newRows(seen, rows);
  const subs = (await loadSubscribers()).filter((s) => s.active);
  let mailed = 0; const failures = [];
  if (fresh.length) {
    for (const sub of subs) {
      const mine = fresh.filter((r) => matches(sub, r));
      if (!mine.length) continue;
      const mail = renderMail({ rows: mine, siteUrl: siteUrl(), unsubUrl: unsubUrl(sub.id, sub.token) });
      try { await sendMail({ to: sub.email, ...mail }); mailed += 1; }
      catch (e) { failures.push({ id: sub.id, error: e.message }); }
    }
    // Mailgun's plan caps the whole brickandmortar.dev domain at 100 requests a
    // day, shared with every other sender on it (hit 2026-10-06). If no mail got
    // out, leave the rows unseen so tomorrow's run sends them instead of dropping them.
    const allFailed = failures.length && !mailed;
    if (!allFailed) await kvPut(SEEN_KEY, [...new Set([...seen, ...fresh.map(rowKey)])]);
  }
  const log = {
    date: today, baseline: false, seen: seen.length, new: fresh.length,
    new_permits: fresh.slice(0, 50).map((r) => r.permit_no),
    subscribers: subs.length, mailed, failures, held_for_retry: Boolean(fresh.length && failures.length && !mailed),
    source_newest: summarize(rows).newest,
  };
  await kvPut(`log:${today}`, log); await kvPut("log:latest", log);
  res.status(200).json(log);
}

async function status(req, res) {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  const subs = await loadSubscribers();
  res.status(200).json({
    subscribers: subs.length,
    active: subs.filter((s) => s.active).length,
    signups: subs.map((s) => ({ email: s.email, kinds: s.kinds || null, legacy: s.signals ? { city: s.city, signals: s.signals } : undefined, active: s.active, created: s.created })),
    last_run: await kvGet("log:latest"),
  });
}

// THE ALERT CARD ON brickandmortar.dev posts here from the browser (the `trade`
// role, 2026-09-30). Only its origins get CORS; the rest of the API stays same-site.
const CORS_ORIGINS = new Set(["https://brickandmortar.dev", "https://www.brickandmortar.dev"]);

export default async function handler(req, res) {
  const url = new URL(req.url, "http://local");
  const action = url.searchParams.get("action") || "feed";
  const origin = req.headers.origin || "";
  if (CORS_ORIGINS.has(origin) && (action === "subscribe" || action === "feed")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
  }
  try {
    if (action === "feed" && req.method === "GET") return await feed(req, res, url);
    if (action === "subscribe" && req.method === "POST") return await subscribe(req, res);
    if (action === "unsubscribe" && req.method === "GET") return await unsubscribe(req, res, url);
    if (action === "check" && req.method === "GET") return await check(req, res);
    if (action === "status" && req.method === "GET") return await status(req, res);
    res.status(404).json({ error: `unknown action ${action}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
