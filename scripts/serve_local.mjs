// Serve index.html and route /api/scrapwatch to the real handler, with .env
// loaded, so the whole product can be driven at localhost before a push.
//   node scripts/serve_local.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.existsSync(path.join(root, ".env")) ? fs.readFileSync(path.join(root, ".env"), "utf8").split("\n") : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const { default: handler } = await import(path.join(root, "api/scrapwatch.js"));
const port = Number(process.argv[2]) || 4180;

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  // the shape Vercel gives a function
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
  if (url.pathname.startsWith("/api/scrapwatch")) return handler(req, res);
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const p = path.join(root, file);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
  res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`scrapwatch at http://localhost:${port}`));
