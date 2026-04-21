#!/usr/bin/env node
/**
 * mock-spend-limit-server.mjs
 *
 * Lightweight proxy for hands-on testing of the SpendLimitError UI.
 *
 * - POST /api/v1/chat/completions        → 429 SPEND_LIMIT_EXCEEDED
 * - POST /api/v1/users/me/budget/request → 204 OK (simulates "Request Increase" success)
 * - Everything else                      → proxied to REAL_BACKEND
 *
 * Usage:
 *   node scripts/mock-spend-limit-server.mjs
 *
 * Then point the extension at http://localhost:7777 by adding to .vscode/launch.json:
 *   "env": { "CLINE_API_BASE_URL": "http://localhost:7777" }
 *
 * See docs/testing/spend-limit-error-hands-on.md for the full guide.
 */

import { createServer } from "node:http"
import { request as httpsRequest } from "node:https"

const PORT = 7777
const REAL_BACKEND = "https://api.cline.bot" // swap for your local backend if needed

// ── Tune these to change what the card shows ─────────────────────────────────
const SPEND_LIMIT_BODY = JSON.stringify({
	error: {
		code: "SPEND_LIMIT_EXCEEDED",
		limit_scope: "user",
		budget_period: "daily", // "daily" | "monthly"
		limit_usd: 20.0,
		spent_usd: 20.5,
		resets_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // 8h from now
		message: "Your daily spend limit of $20.00 has been reached.",
	},
})
// ─────────────────────────────────────────────────────────────────────────────

function proxyToReal(req, res, body) {
	const url = new URL(req.url, REAL_BACKEND)
	const options = {
		hostname: url.hostname,
		port: 443,
		path: url.pathname + url.search,
		method: req.method,
		headers: { ...req.headers, host: url.hostname },
	}
	const proxy = httpsRequest(options, (proxyRes) => {
		res.writeHead(proxyRes.statusCode, proxyRes.headers)
		proxyRes.pipe(res)
	})
	proxy.on("error", (e) => {
		console.error("[proxy] Error:", e.message)
		res.writeHead(502)
		res.end("Bad gateway")
	})
	if (body?.length) proxy.write(body)
	proxy.end()
}

createServer((req, res) => {
	const chunks = []
	req.on("data", (c) => chunks.push(c))
	req.on("end", () => {
		const body = Buffer.concat(chunks)

		if (req.url?.includes("/chat/completions")) {
			// ── Intercept: return SPEND_LIMIT_EXCEEDED ───────────────
			console.log(`\x1b[31m[mock]\x1b[0m 429 SPEND_LIMIT_EXCEEDED  ${req.method} ${req.url}`)
			res.writeHead(429, { "Content-Type": "application/json" })
			res.end(SPEND_LIMIT_BODY)
		} else if (req.url?.includes("/budget/request") && req.method === "POST") {
			// ── Intercept: simulate successful limit-increase request ─
			console.log(`\x1b[32m[mock]\x1b[0m 204 OK                     POST ${req.url}`)
			res.writeHead(204)
			res.end()
		} else {
			// ── Proxy everything else to the real backend ─────────────
			console.log(`\x1b[90m[proxy]\x1b[0m ${req.method} ${req.url}`)
			proxyToReal(req, res, body)
		}
	})
}).listen(PORT, () => {
	console.log(`
\x1b[1mMock spend-limit server\x1b[0m  →  http://localhost:${PORT}

  \x1b[31m✗\x1b[0m  POST /api/v1/chat/completions        429 SPEND_LIMIT_EXCEEDED
  \x1b[32m✓\x1b[0m  POST /api/v1/.../budget/request      204 OK
  \x1b[90m↗\x1b[0m  everything else                      proxy → ${REAL_BACKEND}

Point the extension at this server:
  .vscode/launch.json → "env": { "CLINE_API_BASE_URL": "http://localhost:${PORT}" }

See docs/testing/spend-limit-error-hands-on.md for the full walkthrough.
`)
})
