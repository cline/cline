/**
 * VCR (Video Cassette Recorder) for HTTP requests.
 *
 * Uses nock to record and replay HTTP interactions, enabling deterministic
 * testing of the CLI without making real API calls.
 *
 * Environment variables:
 *   CLINE_VCR           - "record" to record HTTP requests, "playback" to replay them
 *   CLINE_VCR_CASSETTE  - Path to the cassette file (default: ./vcr-cassette.json)
 *   CLINE_VCR_FILTER    - Substring to filter recorded/replayed request paths.
 *                         Defaults to "chat/completions" so only inference requests
 *                         are captured. Set to "" to record/replay all requests.
 *
 * Usage:
 *   # Record only inference requests (default filter)
 *   CLINE_VCR=record CLINE_VCR_CASSETTE=./fixtures/my-test.json cline task "hello"
 *
 *   # Replay — auth/S3/etc. requests go through normally, only inference is mocked
 *   CLINE_VCR=playback CLINE_VCR_CASSETTE=./fixtures/my-test.json cline task "hello"
 *
 *   # Record everything (no filter)
 *   CLINE_VCR=record CLINE_VCR_FILTER="" CLINE_VCR_CASSETTE=./fixtures/all.json cline task "hello"
 *
 * Note on net.ts / nock interception:
 *   The CLI normally uses undici's fetch directly (IS_STANDALONE=true path in shared/net.ts).
 *   When CLINE_VCR is set, shared/net.ts falls back to globalThis.fetch so that nock's
 *   recorder/interceptors — which patch globalThis.fetch — can intercept requests.
 */

import fs from "node:fs"
import path from "node:path"
import type nock from "nock"
import type { Definition } from "nock"

type VcrMode = "record" | "playback"

// ── Response body sanitization ──────────────────────────────────────────
// Keys whose *values* are redacted in response bodies (matched case-insensitively).
const SENSITIVE_RESPONSE_KEYS = new Set([
	"accesskeyid", // AWS access key ID
	"secretaccesskey", // AWS secret access key
	"idtoken", // JWT / OIDC id tokens
	"refreshtoken", // Refresh tokens
	"access_token", // OAuth access tokens
	"refresh_token", // OAuth refresh tokens
])

// Regex patterns that are redacted from any string value regardless of key name.
const SENSITIVE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
	// AWS access key IDs (always start with AKIA)
	{ pattern: /AKIA[A-Z0-9]{16}/g, replacement: "AKIA_REDACTED_KEY_ID" },
]

/**
 * Deep-sanitize a value, redacting known sensitive keys and patterns.
 * Handles objects, arrays, plain strings, and JSON-encoded strings
 * (e.g. the remote-config `value` field which is a JSON string inside JSON).
 */
function sanitizeResponseValue(obj: unknown): unknown {
	if (obj === null || obj === undefined) {
		return obj
	}

	if (typeof obj === "string") {
		// First, try to parse as embedded JSON and sanitize recursively
		try {
			const parsed = JSON.parse(obj)
			if (typeof parsed === "object" && parsed !== null) {
				return JSON.stringify(sanitizeResponseValue(parsed))
			}
		} catch {
			// Not JSON — fall through to pattern-based sanitization
		}
		// Apply regex patterns to plain string values
		let result = obj
		for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
			result = result.replace(pattern, replacement)
		}
		return result
	}

	if (Array.isArray(obj)) {
		return obj.map(sanitizeResponseValue)
	}

	if (typeof obj === "object") {
		const result: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			if (SENSITIVE_RESPONSE_KEYS.has(key.toLowerCase()) && typeof value === "string") {
				result[key] = "REDACTED"
			} else {
				result[key] = sanitizeResponseValue(value)
			}
		}
		return result
	}

	return obj
}

/**
 * Sanitize a single recorded nock Definition, stripping sensitive data
 * from headers, request bodies, and response bodies.
 */
function sanitizeRecording(rec: Definition): Definition {
	const cleaned = { ...rec }

	// Strip raw response headers (contain request IDs, dates, etc.)
	delete (cleaned as any).rawHeaders

	// Remove sensitive request headers if present
	if (cleaned.reqheaders) {
		delete cleaned.reqheaders.authorization
		delete cleaned.reqheaders.Authorization
		delete cleaned.reqheaders["x-api-key"]
		delete cleaned.reqheaders["X-Api-Key"]
	}

	// Remove request body (may contain prompts, API keys, etc.)
	if (cleaned.body) {
		delete cleaned.body
	}

	// Deep-sanitize response body for embedded secrets (S3 creds, tokens, etc.)
	if (cleaned.response !== undefined) {
		cleaned.response = sanitizeResponseValue(cleaned.response) as Definition["response"]
	}

	return cleaned
}

interface VcrConfig {
	mode: VcrMode
	cassettePath: string
	/** Only record/replay requests whose path includes this string. "" = no filter. */
	filter: string
}

function getVcrConfig(vcrMode: string | undefined): VcrConfig | null {
	if (!vcrMode) {
		return null
	}
	if (!process.env.CLINE_VCR_CASSETTE) {
		return null
	}

	if (vcrMode !== "record" && vcrMode !== "playback") {
		process.stderr.write(`[VCR] Invalid CLINE_VCR value: "${vcrMode}". Expected "record" or "playback".\n`)
		process.exit(1)
	}
	const cassettePath = path.resolve(process.env.CLINE_VCR_CASSETTE)
	const filter = process.env.CLINE_VCR_FILTER ?? ""

	return { mode: vcrMode, cassettePath, filter }
}

async function importNock(): Promise<typeof nock> {
	try {
		const mod = await import("nock")
		return mod.default as typeof nock
	} catch {
		process.stderr.write(
			"[VCR] nock is required for VCR mode but is not installed.\n" +
				"      Install it with: npm install -D nock\n" +
				"      (nock is a devDependency in the cli package)\n",
		)
		process.exit(1)
	}
}

async function startRecordingRequests(cassettePath: string, filter: string): Promise<void> {
	const nock = await importNock()

	// Start recording — requests pass through to real servers and are captured
	nock.recorder.rec({
		output_objects: true,
		dont_print: true,
		enable_reqheaders_recording: false,
	})

	const filterDesc = filter ? `matching path "*${filter}*"` : "all paths"
	process.stderr.write(`[VCR] Recording HTTP requests (${filterDesc}). Cassette will be saved to: ${cassettePath}\n`)

	// Save recordings on process exit (synchronous — required by 'exit' event)
	const saveRecordings = () => {
		let recordings = nock.recorder.play() as Definition[]

		// Filter to only matching paths if a filter is set
		if (filter) {
			recordings = recordings.filter((rec: Definition) => typeof rec.path === "string" && rec.path.includes(filter))
		}

		if (recordings.length === 0) {
			process.stderr.write(`[VCR] No HTTP requests matching "${filter}" were recorded.\n`)
			return
		}

		// Ensure output directory exists
		const dir = path.dirname(cassettePath)
		fs.mkdirSync(dir, { recursive: true })

		// Strip sensitive data from recorded interactions
		const sanitized = recordings.map(sanitizeRecording)

		fs.writeFileSync(cassettePath, JSON.stringify(sanitized, null, 2))
		process.stderr.write(`[VCR] Saved ${sanitized.length} recorded HTTP interaction(s) to ${cassettePath}\n`)
	}

	// The 'exit' handler fires for process.exit(), SIGINT default, etc.
	// It is synchronous-only, which is fine since we use writeFileSync.
	process.on("exit", saveRecordings)
	process.on("SIGTERM", saveRecordings)
}

async function startPlayingBackRequests(cassettePath: string, filter: string): Promise<void> {
	const nock = await importNock()

	if (!fs.existsSync(cassettePath)) {
		process.stderr.write(`[VCR] Cassette file not found: ${cassettePath}\n`)
		process.exit(1)
	}

	const recordings: Definition[] = JSON.parse(fs.readFileSync(cassettePath, "utf-8"))

	// In filtered playback, we do NOT block all network connections.
	// Only the recorded paths are intercepted; everything else (auth, S3, etc.)
	// hits real servers so those flows work normally.
	if (!filter) {
		// No filter: block all real connections to ensure full isolation
		nock.disableNetConnect()
		nock.enableNetConnect("127.0.0.1")
		nock.enableNetConnect("localhost")
	}

	// Define recorded interactions as nock interceptors
	const nocks = nock.define(recordings)

	const filterDesc = filter
		? `(only paths matching "*${filter}*", all other requests go through normally)`
		: "(all requests intercepted)"
	process.stderr.write(`[VCR] Playing back ${nocks.length} recorded HTTP interaction(s) from ${cassettePath} ${filterDesc}\n`)
}

/**
 * Initialize VCR mode based on environment variables.
 * Must be called early in the CLI startup, before HTTP requests are made.
 *
 * Does nothing if CLINE_VCR is not set.
 */
export async function initVcr(vcrMode: string | undefined): Promise<void> {
	const config = getVcrConfig(vcrMode)
	if (!config) {
		return
	}

	if (config.mode === "record") {
		await startRecordingRequests(config.cassettePath, config.filter)
	} else {
		await startPlayingBackRequests(config.cassettePath, config.filter)
	}
}
