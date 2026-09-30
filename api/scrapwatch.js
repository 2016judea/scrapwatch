// One function, routed by ?action=. Vercel Hobby caps a deployment at twelve
// functions; one is plenty here and keeps the whole product in one file.
//
//   GET  /api/scrapwatch?action=feed&limit=12      latest rows + totals (the page reads this)
//   POST /api/scrapwatch?action=subscribe          {email, city, signals[]}
//   GET  /api/scrapwatch?action=unsubscribe&id=&token=
//   GET  /api/scrapwatch?action=check              the daily cron (Bearer CRON_SECRET)
//   GET  /api/scrapwatch?action=status             subscribers + last run (Bearer CRON_SECRET)
//
// The source of truth is the Brick & Mortar export at SOURCE_URL. This service
// owns the notification and nothing else: it never re-scrapes a permit desk.

import crypto from "node:crypto";
import { kvGet, kvPut, kvList } from "../lib/kv.js";
import {
  newRows, rowKey, matches, validateSignup, subscriberId,
  renderMail, renderConfirmation, summarize,
} from "../lib/core.js";

let cache = { at: 0, payload: null };
const CACHE_MS = 10 * 60 * 1000;

async function source() {
  if (cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload;
  const url = process.env.SOURCE_URL;
  if (!url) throw new Error("SOURCE_URL is not set");
  const r = await fetch(url, { headers: { "User-Agent": "scrapwatch/0.1 (+https://scrapwatch.vercel.app)" } });
  if (!r.ok) throw new Error(`source ${r.status}`);
  const payload = await r.json();
  if (!Array.isArray(payload.rows)) throw new Error("source has no rows");
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
    return { email: p.get("email"), city: p.get("city"), signals: p.getAll("signals") };
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

async function sendMail({ to, subject, text }) {
  const { MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM } = process.env;
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) throw new Error("Mailgun is not configured");
  const params = new URLSearchParams();
  params.set("from", `Scrapwatch <${MAILGUN_FROM || `hello@${MAILGUN_DOMAIN}`}>`);
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

function siteUrl() { return (process.env.SITE_URL || "https://scrapwatch.vercel.app").replace(/\/$/, ""); }
function unsubUrl(id, token) { return `${siteUrl()}/api/scrapwatch?action=unsubscribe&id=${id}&token=${token}`; }
function authed(req) {
  const s = process.env.CRON_SECRET;
  return Boolean(s) && req.headers.authorization === `Bearer ${s}`;
}

async function feed(req, res, url) {
  const payload = await source();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 100);
  res.setHeader("Cache-Control", "public, max-age=600");
  res.status(200).json({
    subject: payload.subject,
    source: payload.source,
    licence: payload.licence,
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
  res.status(200).json({ ok: true, mailed, city: sub.city, signals: sub.signals });
}

async function unsubscribe(req, res, url) {
  const id = url.searchParams.get("id") || "";
  const token = url.searchParams.get("token") || "";
  const sub = /^[a-f0-9]{16}$/.test(id) ? await kvGet(`sub:${id}`) : null;
  const ok = sub && sub.token === token;
  if (ok) await kvPut(`sub:${id}`, { ...sub, active: false, updated: new Date().toISOString() });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(ok ? 200 : 400).end(
    `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Scrapwatch</title>` +
    `<body style="font:18px/1.5 system-ui;margin:3rem auto;max-width:34rem;padding:0 1rem">` +
    (ok ? `<p>Done. No more emails.</p><p><a href="${siteUrl()}">Back to Scrapwatch</a></p>`
        : `<p>That link didn't match a subscription. Reply to any Scrapwatch email and we'll sort it by hand.</p>`),
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
  const seen = await kvGet("seen");
  const today = new Date().toISOString().slice(0, 10);

  // FIRST RUN: baseline, never mail. An empty seen set makes every row "new",
  // and mailing 558 historical permits to a new subscriber would be the last
  // mail they read.
  if (!Array.isArray(seen)) {
    const all = rows.map(rowKey).filter(Boolean);
    await kvPut("seen", all);
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
      const mail = renderMail({ rows: mine, sub, siteUrl: siteUrl(), unsubUrl: unsubUrl(sub.id, sub.token) });
      try { await sendMail({ to: sub.email, ...mail }); mailed += 1; }
      catch (e) { failures.push({ id: sub.id, error: e.message }); }
    }
    await kvPut("seen", [...new Set([...seen, ...fresh.map(rowKey)])]);
  }
  const log = {
    date: today, baseline: false, seen: seen.length, new: fresh.length,
    new_permits: fresh.slice(0, 50).map((r) => r.permit_no),
    subscribers: subs.length, mailed, failures,
    source_last_issued: summarize(rows).by_city,
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
    by_city: subs.reduce((a, s) => ((a[s.city] = (a[s.city] || 0) + 1), a), {}),
    signups: subs.map((s) => ({ email: s.email, city: s.city, signals: s.signals, active: s.active, created: s.created })),
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
