export interface Env {
	DB: D1Database
}

const MARKETPLACES = new Set(["gallery", "skills", "modules", "mcp", "connectors"])
const EVENT_TYPES = new Set(["import", "install", "open_source", "copy_citation", "template_open", "uninstall"])

// events rows older than this are pruned by the scheduled() cron handler.
// item_counts (the durable aggregate) is never pruned.
const EVENTS_RETENTION_DAYS = 90

interface CountSummary {
	marketplace: string
	itemId: string
	events: Record<string, number>
	total: number
	updatedAt: string
	starredByClient?: boolean
}

function json(data: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			// Origin stays "*": these routes are called from static community
			// surfaces (Gallery/Skills/Modules JSON APIs, GitHub Pages, the
			// marketplace site) whose exact origin set isn't fixed/enumerable
			// here, and every write is anonymous + rate/dedup-limited server
			// side rather than origin-gated.
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			...(init.headers ?? {}),
		},
	})
}

function cleanText(value: unknown, maxLength = 120): string {
	return String(value ?? "")
		.trim()
		.slice(0, maxLength)
}

function validateClientHash(clientIdHash: string): boolean {
	return /^[a-f0-9]{32,128}$/i.test(clientIdHash)
}

// Server-derived dedup key for the write routes. clientIdHash in the request
// body is client-supplied and trivially rotated per request, so it cannot be
// trusted as an identity for abuse control (see daily_dedup in schema.sql).
// This key is NOT a security credential — it's a cheap, non-client-chosen
// grouping key (IP + User-Agent + UTC day) that raises the cost of casual
// inflation (retry loops, buggy clients). A determined attacker who varies
// IP/UA per request still defeats it; the Cloudflare-level rate limit rule
// (provisioned via the dashboard/API, not this file — see README) is the
// control for that case.
async function dailyDedupKey(request: Request): Promise<string> {
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown-ip"
	const ua = request.headers.get("User-Agent") ?? "unknown-ua"
	const day = new Date().toISOString().slice(0, 10)
	const data = new TextEncoder().encode(`${ip}|${ua}|${day}`)
	const digest = await crypto.subtle.digest("SHA-256", data)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function todayUtc(): string {
	return new Date().toISOString().slice(0, 10)
}

async function recordEvent(request: Request, env: Env): Promise<Response> {
	const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined
	if (!body) {
		return json({ error: "Invalid JSON body." }, { status: 400 })
	}

	const marketplace = cleanText(body.marketplace, 32)
	const itemId = cleanText(body.itemId ?? body.item_id, 180)
	const eventType = cleanText(body.eventType ?? body.event_type, 40)
	const clientIdHash = cleanText(body.clientIdHash ?? body.client_id_hash, 128)

	if (!MARKETPLACES.has(marketplace)) {
		return json({ error: "Invalid marketplace." }, { status: 400 })
	}
	if (!itemId) {
		return json({ error: "Missing itemId." }, { status: 400 })
	}
	if (!EVENT_TYPES.has(eventType)) {
		return json({ error: "Invalid eventType." }, { status: 400 })
	}
	if (!validateClientHash(clientIdHash)) {
		return json({ error: "Invalid anonymous client hash." }, { status: 400 })
	}

	const aiHydroVersion = cleanText(body.aiHydroVersion ?? body.ai_hydro_version, 40)
	const itemType = cleanText(body.itemType ?? body.item_type, 80)
	const itemVersion = cleanText(body.itemVersion ?? body.item_version, 40)
	const source = cleanText(body.source, 40)

	// Server-derived dedup gate: only the first (marketplace, item_id,
	// event_type) event from a given (IP, UA) pair per UTC day is counted.
	// INSERT OR IGNORE + meta.changes mirrors the existing item_stars pattern.
	const dedupKey = await dailyDedupKey(request)
	const dedupResult = await env.DB.prepare(
		`INSERT OR IGNORE INTO daily_dedup (marketplace, item_id, event_type, dedup_key, day)
		 VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(marketplace, itemId, eventType, dedupKey, todayUtc())
		.run()
	if (!dedupResult.meta.changes) {
		// Duplicate within the same day from the same (IP, UA) — no-op, but
		// still report success so the caller doesn't retry.
		return json({ ok: true, deduped: true })
	}

	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO events (
				marketplace, item_id, event_type, client_id_hash,
				ai_hydro_version, item_type, item_version, source
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(marketplace, itemId, eventType, clientIdHash, aiHydroVersion, itemType, itemVersion, source),
		env.DB.prepare(
			`INSERT INTO item_counts (marketplace, item_id, event_type, count, updated_at)
			 VALUES (?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			 ON CONFLICT(marketplace, item_id, event_type)
			 DO UPDATE SET
				count = count + 1,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		).bind(marketplace, itemId, eventType),
	])

	return json({ ok: true })
}

async function pruneOldEvents(env: Env): Promise<number> {
	const cutoff = new Date(Date.now() - EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
	const result = await env.DB.prepare(`DELETE FROM events WHERE created_at < ?`).bind(cutoff).run()
	// Also prune dedup rows older than a couple of days — they only need to
	// survive long enough to catch same-day repeats.
	const dedupCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
	await env.DB.prepare(`DELETE FROM daily_dedup WHERE day < ?`).bind(dedupCutoff).run()
	return result.meta.changes ?? 0
}

async function setStar(request: Request, env: Env): Promise<Response> {
	const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined
	if (!body) {
		return json({ error: "Invalid JSON body." }, { status: 400 })
	}

	const marketplace = cleanText(body.marketplace, 32)
	const itemId = cleanText(body.itemId ?? body.item_id, 180)
	const clientIdHash = cleanText(body.clientIdHash ?? body.client_id_hash, 128)
	const starred = Boolean(body.starred)

	if (!MARKETPLACES.has(marketplace)) {
		return json({ error: "Invalid marketplace." }, { status: 400 })
	}
	if (!itemId) {
		return json({ error: "Missing itemId." }, { status: 400 })
	}
	if (!validateClientHash(clientIdHash)) {
		return json({ error: "Invalid anonymous client hash." }, { status: 400 })
	}

	if (starred) {
		await env.DB.prepare(
			`INSERT OR IGNORE INTO item_stars (marketplace, item_id, client_id_hash)
			 VALUES (?, ?, ?)`,
		)
			.bind(marketplace, itemId, clientIdHash)
			.run()
	} else {
		await env.DB.prepare(
			`DELETE FROM item_stars
			 WHERE marketplace = ? AND item_id = ? AND client_id_hash = ?`,
		)
			.bind(marketplace, itemId, clientIdHash)
			.run()
	}

	const countResult = await env.DB.prepare(
		`SELECT COUNT(*) AS count
		 FROM item_stars
		 WHERE marketplace = ? AND item_id = ?`,
	)
		.bind(marketplace, itemId)
		.first<{ count: number }>()

	return json({
		ok: true,
		marketplace,
		itemId,
		starred,
		stars: Number(countResult?.count ?? 0),
	})
}

async function getCounts(url: URL, env: Env): Promise<Response> {
	const marketplace = cleanText(url.searchParams.get("marketplace"), 32)
	const clientIdHash = cleanText(url.searchParams.get("clientIdHash") ?? url.searchParams.get("client_id_hash"), 128)
	if (marketplace && !MARKETPLACES.has(marketplace)) {
		return json({ error: "Invalid marketplace." }, { status: 400 })
	}
	if (clientIdHash && !validateClientHash(clientIdHash)) {
		return json({ error: "Invalid anonymous client hash." }, { status: 400 })
	}

	const query = marketplace
		? env.DB.prepare(
				`SELECT marketplace, item_id, event_type, count, updated_at
				 FROM item_counts
				 WHERE marketplace = ?
				 ORDER BY marketplace, item_id, event_type`,
			).bind(marketplace)
		: env.DB.prepare(
				`SELECT marketplace, item_id, event_type, count, updated_at
				 FROM item_counts
				 ORDER BY marketplace, item_id, event_type`,
			)

	const result = await query.all<{
		marketplace: string
		item_id: string
		event_type: string
		count: number
		updated_at: string
	}>()

	const byItem = new Map<string, CountSummary>()
	for (const row of result.results ?? []) {
		const key = `${row.marketplace}:${row.item_id}`
		const current = byItem.get(key) ?? {
			marketplace: row.marketplace,
			itemId: row.item_id,
			events: {},
			total: 0,
			updatedAt: row.updated_at,
		}
		current.events[row.event_type] = Number(row.count)
		current.total += Number(row.count)
		current.updatedAt = row.updated_at > current.updatedAt ? row.updated_at : current.updatedAt
		byItem.set(key, current)
	}

	const starsQuery = marketplace
		? env.DB.prepare(
				`SELECT marketplace, item_id, COUNT(*) AS stars, MAX(created_at) AS updated_at
				 FROM item_stars
				 WHERE marketplace = ?
				 GROUP BY marketplace, item_id
				 ORDER BY marketplace, item_id`,
			).bind(marketplace)
		: env.DB.prepare(
				`SELECT marketplace, item_id, COUNT(*) AS stars, MAX(created_at) AS updated_at
				 FROM item_stars
				 GROUP BY marketplace, item_id
				 ORDER BY marketplace, item_id`,
			)
	const starsResult = await starsQuery.all<{
		marketplace: string
		item_id: string
		stars: number
		updated_at: string
	}>()
	for (const row of starsResult.results ?? []) {
		const key = `${row.marketplace}:${row.item_id}`
		const current = byItem.get(key) ?? {
			marketplace: row.marketplace,
			itemId: row.item_id,
			events: {},
			total: 0,
			updatedAt: row.updated_at,
		}
		current.events.star = Number(row.stars)
		current.total += Number(row.stars)
		current.updatedAt = row.updated_at > current.updatedAt ? row.updated_at : current.updatedAt
		byItem.set(key, current)
	}

	if (clientIdHash) {
		const starredQuery = marketplace
			? env.DB.prepare(
					`SELECT marketplace, item_id
					 FROM item_stars
					 WHERE marketplace = ? AND client_id_hash = ?`,
				).bind(marketplace, clientIdHash)
			: env.DB.prepare(
					`SELECT marketplace, item_id
					 FROM item_stars
					 WHERE client_id_hash = ?`,
				).bind(clientIdHash)
		const starredResult = await starredQuery.all<{ marketplace: string; item_id: string }>()
		for (const row of starredResult.results ?? []) {
			const key = `${row.marketplace}:${row.item_id}`
			const current = byItem.get(key) ?? {
				marketplace: row.marketplace,
				itemId: row.item_id,
				events: {},
				total: 0,
				updatedAt: "",
			}
			current.starredByClient = true
			byItem.set(key, current)
		}
	}

	return json({ items: Array.from(byItem.values()) })
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url)
		if (request.method === "OPTIONS") return json({ ok: true })
		if (request.method === "GET" && url.pathname === "/v1/health") return json({ ok: true })
		if (request.method === "POST" && url.pathname === "/v1/events") return recordEvent(request, env)
		if (request.method === "POST" && url.pathname === "/v1/stars") return setStar(request, env)
		if (request.method === "GET" && url.pathname === "/v1/counts") return getCounts(url, env)
		return json({ error: "Not found." }, { status: 404 })
	},

	// Retention cron (see [triggers] in wrangler.toml) — events is an
	// append-only audit log with no natural cap; item_counts (the durable
	// aggregate the marketplace UI actually reads) is never touched.
	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(pruneOldEvents(env))
	},
}
