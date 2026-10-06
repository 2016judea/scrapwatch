// Cloudflare Workers KV over its REST API. Chosen because the account token was
// already on disk and a namespace can be created with one call; no dashboard,
// no new vendor. Every value is JSON text.
//
// Keys:
//   parcels:v1   Hennepin parcel facts by APN, so the county is asked once per parcel
//   sub:*, seen:*, log:*, years   left from the retired email alert (2026-10-06);
//                nothing reads them. sub:* are people's addresses: not ours to delete.

const API = "https://api.cloudflare.com/client/v4";

function base() {
  const { CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_NAMESPACE } = process.env;
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_KV_NAMESPACE) {
    throw new Error("KV is not configured (CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_NAMESPACE)");
  }
  return {
    url: `${API}/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE}`,
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
  };
}

export async function kvGet(key) {
  const { url, headers } = base();
  const r = await fetch(`${url}/values/${encodeURIComponent(key)}`, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`KV get ${key}: ${r.status}`);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

export async function kvPut(key, value) {
  const { url, headers } = base();
  const r = await fetch(`${url}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "text/plain" },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV put ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

export async function kvDelete(key) {
  const { url, headers } = base();
  const r = await fetch(`${url}/values/${encodeURIComponent(key)}`, { method: "DELETE", headers });
  if (!r.ok && r.status !== 404) throw new Error(`KV delete ${key}: ${r.status}`);
}

// Every key under a prefix. KV lists at most 1000 per page; the cursor loop
// is here so a thousandth subscriber does not silently stop getting mail.
export async function kvList(prefix) {
  const { url, headers } = base();
  const names = [];
  let cursor = "";
  for (;;) {
    const q = new URLSearchParams({ prefix, limit: "1000" });
    if (cursor) q.set("cursor", cursor);
    const r = await fetch(`${url}/keys?${q}`, { headers });
    if (!r.ok) throw new Error(`KV list ${prefix}: ${r.status}`);
    const d = await r.json();
    for (const k of d.result || []) names.push(k.name);
    cursor = d.result_info?.cursor || "";
    if (!cursor) break;
  }
  return names;
}
