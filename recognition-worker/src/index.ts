export interface Env {
	DB: D1Database
}

const MARKETPLACES = new Set(["gallery", "skills", "modules", "mcp", "connectors"])
const EVENT_TYPES = new Set(["import", "install", "open_source", "copy_citation", "template_open", "uninstall"])

function json(data: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
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
	if (!/^[a-f0-9]{32,128}$/i.test(clientIdHash)) {
		return json({ error: "Invalid anonymous client hash." }, { status: 400 })
	}

	const aiHydroVersion = cleanText(body.aiHydroVersion ?? body.ai_hydro_version, 40)
	const itemType = cleanText(body.itemType ?? body.item_type, 80)
	const itemVersion = cleanText(body.itemVersion ?? body.item_version, 40)
	const source = cleanText(body.source, 40)

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

async function getCounts(url: URL, env: Env): Promise<Response> {
	const marketplace = cleanText(url.searchParams.get("marketplace"), 32)
	if (marketplace && !MARKETPLACES.has(marketplace)) {
		return json({ error: "Invalid marketplace." }, { status: 400 })
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

	const byItem = new Map<
		string,
		{ marketplace: string; itemId: string; events: Record<string, number>; total: number; updatedAt: string }
	>()
	for (const row of result.results ?? []) {
		const key = `${row.marketplace}:${row.item_id}`
		const current =
			byItem.get(key) ??
			({
				marketplace: row.marketplace,
				itemId: row.item_id,
				events: {},
				total: 0,
				updatedAt: row.updated_at,
			} as const)
		current.events[row.event_type] = Number(row.count)
		current.total += Number(row.count)
		current.updatedAt = row.updated_at > current.updatedAt ? row.updated_at : current.updatedAt
		byItem.set(key, current)
	}

	return json({ items: Array.from(byItem.values()) })
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url)
		if (request.method === "OPTIONS") return json({ ok: true })
		if (request.method === "GET" && url.pathname === "/v1/health") return json({ ok: true })
		if (request.method === "POST" && url.pathname === "/v1/events") return recordEvent(request, env)
		if (request.method === "GET" && url.pathname === "/v1/counts") return getCounts(url, env)
		return json({ error: "Not found." }, { status: 404 })
	},
}
