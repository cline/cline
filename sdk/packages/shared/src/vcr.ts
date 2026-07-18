/**
 * VCR (Video Cassette Recorder) for HTTP requests.
 *
 * Patches `globalThis.fetch` to record and replay HTTP interactions,
 * enabling deterministic testing without making real API calls.
 *
 * Unlike nock (which patches Node's `http` module), this works by wrapping
 * `globalThis.fetch` directly, catching all HTTP traffic in this codebase
 * including calls made through the OpenAI, Anthropic, Gemini, and Vercel AI
 * SDKs (all of which delegate to the global fetch).
 *
 * Environment variables:
 *   CLINE_VCR           - "record" to record HTTP requests, "playback" to replay them
 *   CLINE_VCR_CASSETTE  - Path to the cassette file (default: ./vcr-cassette.json)
 *   CLINE_VCR_FILTER    - Substring to filter recorded/replayed request paths.
 *                         When set to a non-empty string, only requests whose path
 *                         contains this substring are recorded/replayed; all other
 *                         requests pass through to the real network.
 *                         When empty or unset, ALL requests are intercepted (no filter).
 *   CLINE_VCR_INCLUDE_REQUEST_BODY - "1" to save sanitized request bodies and
 *                         assert them during playback.
 *   CLINE_VCR_SSE_DELAY - Milliseconds between SSE chunks during playback (default: 100).
 *                         Set to 0 for instant delivery.
 *
 * Usage:
 *   # Record only inference requests
 *   CLINE_VCR=record CLINE_VCR_CASSETTE=./fixtures/my-test.json cline task "hello"
 *
 *   # Replay: auth/S3/etc. requests go through normally, only inference is mocked
 *   CLINE_VCR=playback CLINE_VCR_CASSETTE=./fixtures/my-test.json cline task "hello"
 *
 *   # Record everything (no filter)
 *   CLINE_VCR=record CLINE_VCR_FILTER="" CLINE_VCR_CASSETTE=./fixtures/all.json cline task "hello"
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { registerDisposable } from "./dispose";
import type { VcrRecording } from "./types/vcr";

// ── Types ───────────────────────────────────────────────────────────────

type VcrMode = "record" | "playback";

interface VcrConfig {
	mode: VcrMode;
	cassettePath: string;
	includeRequestBody: boolean;
	/**
	 * Only record/replay requests whose path includes this substring.
	 * Empty string ("") means no filtering, so ALL requests are intercepted.
	 * A non-empty string enables selective mode where only matching requests
	 * are intercepted and non-matching requests pass through to the real network.
	 */
	filter: string;
}

interface InternalVcrRecording extends VcrRecording {
	requestContentType?: string;
}

// ── Sensitive data sanitization ─────────────────────────────────────────

/**
 * Sanitization is key-based: any JSON key whose name matches a rule gets
 * its value redacted. This is more robust than regex-matching values,
 * because it works regardless of the value format.
 *
 * Three categories of keys are redacted:
 *
 * 1. Exact key names (case-insensitive): secrets, tokens, credentials.
 * 2. Key name patterns (substring/suffix): catches ID fields, PII, etc.
 * 3. Value-level regex patterns: for values embedded in plain strings
 *    (e.g. filesystem paths, AWS key IDs in URLs).
 *
 * To add new sanitization rules, just add entries to the sets/arrays below.
 */

/** Keys whose values are always fully redacted (case-insensitive exact match). */
const REDACT_KEYS_EXACT = new Set([
	// Secrets & tokens
	// Exact keys are compared after lowercasing, so accessToken matches accesstoken.
	"accesskeyid",
	"secretaccesskey",
	"idtoken",
	"refreshtoken",
	"accesstoken",
	"access_token",
	"refresh_token",
	"apikey",
	"api_key",
	"authorization",
	"password",
	"privatekey",
	"private_key",
	"private-key",
	"secret",
	"token",
	// PII
	"email",
	"displayname",
	"display_name",
	"userinfo",
]);

/**
 * Keys whose values are redacted if the key name ends with or contains
 * one of these substrings (case-insensitive). Catches fields like
 * "userId", "organizationId", "memberId", "sessionId", etc.
 */
const REDACT_KEY_SUFFIXES = [
	"id", // matches *Id and *_id, covering most entity identifiers
	"balance",
	"cost",
	"secret",
];

/** Check whether a key name should have its value redacted. */
function shouldRedactKey(key: string): boolean {
	const lower = key.toLowerCase();
	if (REDACT_KEYS_EXACT.has(lower)) {
		return true;
	}
	for (const suffix of REDACT_KEY_SUFFIXES) {
		// Match "userId", "user_id", "id" but not "video" or "valid"
		if (lower === suffix) {
			return true;
		}
		// camelCase: ends with "Id", "Balance", etc.
		if (lower.endsWith(suffix) && lower.length > suffix.length) {
			const charBefore = lower[lower.length - suffix.length - 1];
			// Must be preceded by a word boundary character (_, -, or uppercase transition)
			if (charBefore === "_" || charBefore === "-") {
				return true;
			}
			// camelCase: the suffix starts with lowercase but original key has uppercase
			const originalChar = key[key.length - suffix.length];
			if (
				originalChar &&
				originalChar === originalChar.toUpperCase() &&
				originalChar !== originalChar.toLowerCase()
			) {
				return true;
			}
		}
		// snake_case: ends with "_id", "_balance", etc.
		if (lower.endsWith(`_${suffix}`)) {
			return true;
		}
	}
	return false;
}

/** Regex patterns applied to plain string values (not key-based). */
const SENSITIVE_VALUE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
	// AWS access key IDs
	{ pattern: /AKIA[A-Z0-9]{16}/g, replacement: "AKIA_REDACTED" },
	// Filesystem paths with usernames
	{ pattern: /\/Users\/[A-Za-z0-9._-]+/g, replacement: "/Users/REDACTED_USER" },
	{ pattern: /\/home\/[A-Za-z0-9._-]+/g, replacement: "/home/REDACTED_USER" },
];

/** Apply value-level regex sanitization to a plain string. */
function sanitizeStringValue(input: string): string {
	let result = input;
	for (const { pattern, replacement } of SENSITIVE_VALUE_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJsonValue);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => compareCodeUnits(a, b))
			.map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
	);
}

function compareCodeUnits(a: string, b: string): number {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
}

function canonicalStringify(value: unknown): string {
	return JSON.stringify(sortJsonValue(value));
}

/**
 * Path-level patterns for normalizing request paths in recordings.
 * These replace dynamic path segments with stable test values so that
 * playback matching works across different environments/users.
 *
 * Patterns are applied in order. More specific patterns should come first.
 */
const PATH_NORMALIZATION_PATTERNS: { pattern: RegExp; replacement: string }[] =
	[
		// S3-style task artifact paths: /tasks/<userId>/<taskId>/api_conversation_history.json
		{
			pattern:
				/tasks\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/api_conversation_history/g,
			replacement: "tasks/usr-test/taskid/api_conversation_history",
		},
		// Prefixed entity IDs in path segments (org-XXX, usr-XXX, mbr-XXX, ses-XXX, etc.)
		// Matches common Cline ID formats: prefix + ULID/UUID-like suffix
		{
			pattern:
				/\/(org|usr|mbr|ses|gen|req|msg|tsk|sch|exe|srv|cli|wkr|evt|sub|tkn)-[A-Za-z0-9]{10,}(?=[/?#]|$)/g,
			replacement: "/$1-REDACTED",
		},
	];

/** Normalize a request path for stable matching. */
function normalizePath(input: string): string {
	let result = input;
	for (const { pattern, replacement } of PATH_NORMALIZATION_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}

/**
 * Deep-sanitize a value, redacting sensitive keys and patterns.
 * Handles objects, arrays, plain strings, and JSON-encoded strings.
 */
function sanitizeValue(obj: unknown): unknown {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (typeof obj === "string") {
		// Try to parse as JSON and sanitize recursively
		try {
			const parsed = JSON.parse(obj);
			if (typeof parsed === "object" && parsed !== null) {
				return JSON.stringify(sanitizeValue(parsed));
			}
		} catch {
			// Not JSON, so apply string-level patterns
		}
		return sanitizeStringValue(obj);
	}

	if (Array.isArray(obj)) {
		return obj.map(sanitizeValue);
	}

	if (typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			if (
				shouldRedactKey(key) &&
				(typeof value === "string" || typeof value === "number")
			) {
				result[key] = "REDACTED";
			} else {
				result[key] = sanitizeValue(value);
			}
		}
		return result;
	}

	return obj;
}

function parseUrlEncodedBody(
	input: string,
): Record<string, unknown> | undefined {
	const params = new URLSearchParams(input);
	const entries = Array.from(params.entries());
	if (entries.length === 0 || entries.some(([key]) => key.length === 0)) {
		return undefined;
	}
	const output: Record<string, unknown> = {};
	for (const [key, value] of entries) {
		const existing = output[key];
		if (existing === undefined) {
			output[key] = value;
		} else if (Array.isArray(existing)) {
			existing.push(value);
		} else {
			output[key] = [existing, value];
		}
	}
	return output;
}

function isUrlEncodedContentType(contentType: string | undefined): boolean {
	return (
		contentType?.toLowerCase().split(";")[0]?.trim() ===
		"application/x-www-form-urlencoded"
	);
}

function sanitizeSerializedRequestBody(
	input: string,
	contentType?: string,
): string {
	try {
		return canonicalStringify(sanitizeValue(JSON.parse(input)));
	} catch {
		if (isUrlEncodedContentType(contentType)) {
			const formBody = parseUrlEncodedBody(input);
			if (formBody) {
				return canonicalStringify(sanitizeValue(formBody));
			}
		}
		return sanitizeStringValue(input);
	}
}

/** Sanitize a single recorded interaction, stripping sensitive data. */
function sanitizeRecording(
	rec: InternalVcrRecording,
	includeRequestBody: boolean,
): VcrRecording {
	const cleaned = { ...rec };
	const requestBody =
		includeRequestBody && rec.body !== undefined
			? sanitizeSerializedRequestBody(rec.body, rec.requestContentType)
			: undefined;

	// Remove request body (may contain prompts, API keys, etc.)
	delete cleaned.body;
	delete cleaned.requestContentType;
	if (requestBody !== undefined) {
		cleaned.requestBody = requestBody;
	}

	// Normalize the request path for stable matching
	if (typeof cleaned.path === "string") {
		cleaned.path = normalizePath(cleaned.path);
	}

	// Deep-sanitize response body
	if (cleaned.response !== undefined) {
		cleaned.response = sanitizeValue(cleaned.response);
	}

	return cleaned;
}

// ── URL helpers ─────────────────────────────────────────────────────────

function parseScope(url: string): { scope: string; path: string } {
	try {
		const parsed = new URL(url);
		const scope = `${parsed.protocol}//${parsed.host}`;
		const path = parsed.pathname + parsed.search;
		return { scope, path };
	} catch {
		return { scope: "", path: url };
	}
}

function resolveRequestUrl(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	if (input && typeof (input as Request).url === "string") {
		return (input as Request).url;
	}
	return String(input);
}

function resolveRequestMethod(
	input: string | URL | Request,
	init?: RequestInit,
): string {
	if (init?.method) {
		return init.method.toUpperCase();
	}
	if (input && typeof (input as Request).method === "string") {
		return (input as Request).method.toUpperCase();
	}
	return "GET";
}

function readHeadersContentType(
	headers: RequestInit["headers"] | undefined,
): string | undefined {
	if (!headers) {
		return undefined;
	}
	return new Headers(headers).get("content-type") ?? undefined;
}

function readRequestContentType(
	input: string | URL | Request,
	init?: RequestInit,
): string | undefined {
	const initContentType = readHeadersContentType(init?.headers);
	if (initContentType) {
		return initContentType;
	}
	if (init?.body instanceof URLSearchParams) {
		return "application/x-www-form-urlencoded;charset=UTF-8";
	}
	if (input instanceof Request) {
		return input.headers.get("content-type") ?? undefined;
	}
	return undefined;
}

async function readRequestBody(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<string | undefined> {
	if (init?.body) {
		if (typeof init.body === "string") {
			return init.body;
		}
		if (init.body instanceof URLSearchParams) {
			return init.body.toString();
		}
		if (init.body instanceof ArrayBuffer) {
			return new TextDecoder().decode(init.body);
		}
		if (ArrayBuffer.isView(init.body)) {
			return new TextDecoder().decode(
				new Uint8Array(
					init.body.buffer,
					init.body.byteOffset,
					init.body.byteLength,
				),
			);
		}
		return undefined;
	}
	if (input instanceof Request) {
		try {
			return await input.clone().text();
		} catch {
			return undefined;
		}
	}
	return undefined;
}

// ── Config resolution ───────────────────────────────────────────────────

function getVcrConfig(vcrMode: string | undefined): VcrConfig | null {
	if (!vcrMode) {
		return null;
	}

	if (!process.env.CLINE_VCR_CASSETTE) {
		process.stderr.write(
			"[VCR] No CLINE_VCR_CASSETTE: requests will not be recorded or played back.\n",
		);
		return null;
	}

	if (vcrMode !== "record" && vcrMode !== "playback") {
		process.stderr.write(
			`[VCR] Invalid CLINE_VCR value: "${vcrMode}". Expected "record" or "playback".\n`,
		);
		process.exit(1);
	}

	const cassettePath = resolve(process.env.CLINE_VCR_CASSETTE);
	const filter = process.env.CLINE_VCR_FILTER ?? "";
	const includeRequestBody =
		process.env.CLINE_VCR_INCLUDE_REQUEST_BODY === "1" ||
		process.env.CLINE_VCR_INCLUDE_REQUEST_BODY === "true";

	return { mode: vcrMode, cassettePath, filter, includeRequestBody };
}

// ── Record mode ─────────────────────────────────────────────────────────

/** An in-progress stream capture that can be finalized synchronously. */
interface InFlightCapture {
	scope: string;
	method: string;
	path: string;
	body: string;
	requestContentType?: string;
	status: number;
	contentType: string | undefined;
	chunks: Uint8Array[];
	finalized: boolean;
}

function startRecordingRequests(
	cassettePath: string,
	filter: string,
	includeRequestBody: boolean,
): void {
	const recordings: InternalVcrRecording[] = [];
	/** Streams still being consumed, finalized on flush or on process exit. */
	const inFlight: InFlightCapture[] = [];
	const originalFetch = globalThis.fetch;

	/** Convert accumulated chunks into a recording entry. */
	function finalizeCapture(capture: InFlightCapture): void {
		if (capture.finalized) {
			return;
		}
		capture.finalized = true;

		const decoder = new TextDecoder();
		const bodyText =
			capture.chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
			decoder.decode();

		let responseBody: unknown;
		try {
			responseBody = JSON.parse(bodyText);
		} catch {
			responseBody = bodyText;
		}

		recordings.push({
			scope: capture.scope,
			method: capture.method,
			path: capture.path,
			body: capture.body,
			requestContentType: capture.requestContentType,
			status: capture.status,
			response: responseBody,
			responseIsBinary: false,
			contentType: capture.contentType,
		});
	}

	globalThis.fetch = Object.assign(
		async (
			input: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			const url = resolveRequestUrl(input);
			const method = resolveRequestMethod(input, init);
			const { scope, path } = parseScope(url);

			const requestBody = await readRequestBody(input, init);
			const requestContentType = readRequestContentType(input, init);

			// Call real fetch
			const response = await originalFetch(input, init);

			// Check filter
			if (filter && !path.includes(filter)) {
				return response;
			}

			// Capture content-type from the real response
			const contentType = response.headers.get("content-type") ?? undefined;

			// No body, so record immediately
			if (!response.body) {
				recordings.push({
					scope,
					method,
					path,
					body: requestBody ?? "",
					requestContentType,
					status: response.status,
					response: "",
					responseIsBinary: false,
					contentType,
				});
				return response;
			}

			// Wrap the response body with a TransformStream that captures
			// chunks as the caller consumes them. The capture is tracked in
			// `inFlight` so the exit handler can finalize it even if the
			// stream hasn't completed (e.g. process.exit() during SSE).
			const capture: InFlightCapture = {
				scope,
				method,
				path,
				body: requestBody ?? "",
				requestContentType,
				status: response.status,
				contentType,
				chunks: [],
				finalized: false,
			};
			inFlight.push(capture);

			const originalBody = response.body;
			const transform = new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					capture.chunks.push(chunk);
					controller.enqueue(chunk);
				},
				flush() {
					finalizeCapture(capture);
				},
			});

			const wrappedBody = originalBody.pipeThrough(transform);

			return new Response(wrappedBody, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
		},
		{ preconnect: (_url: string | URL) => {} },
	);

	const filterDesc = filter ? `matching path "*${filter}*"` : "all paths";
	process.stderr.write(
		`[VCR] Recording HTTP requests (${filterDesc}). Cassette will be saved to: ${cassettePath}\n`,
	);

	// Save recordings, finalizing any in-flight stream captures first
	let saved = false;
	const saveRecordings = () => {
		if (saved) {
			return;
		}
		saved = true;

		// Restore original fetch
		globalThis.fetch = originalFetch;

		// Finalize any in-flight stream captures with whatever data
		// has been received so far (critical for SSE streams that may
		// still be open when process.exit() is called).
		for (const capture of inFlight) {
			finalizeCapture(capture);
		}

		if (recordings.length === 0) {
			process.stderr.write(
				`[VCR] No HTTP requests${filter ? ` matching "${filter}"` : ""} were recorded.\n`,
			);
			return;
		}

		const dir = dirname(cassettePath);
		mkdirSync(dir, { recursive: true });

		const sanitized = recordings.map((recording) =>
			sanitizeRecording(recording, includeRequestBody),
		);
		writeFileSync(cassettePath, JSON.stringify(sanitized, null, 2));
		process.stderr.write(
			`[VCR] Saved ${sanitized.length} recorded HTTP interaction(s) to ${cassettePath}\n`,
		);
	};

	registerDisposable(saveRecordings);
}

// ── Playback mode ───────────────────────────────────────────────────────

/**
 * Split an SSE response body into individual event chunks.
 * Each chunk is a complete "data: ...\n\n" segment.
 */
function splitSseChunks(body: string): string[] {
	// Split on double-newline boundaries that separate SSE events
	const chunks: string[] = [];
	const parts = body.split(/\n\n/);
	for (const part of parts) {
		const trimmed = part.trim();
		if (trimmed) {
			chunks.push(`${trimmed}\n\n`);
		}
	}
	return chunks;
}

/**
 * Create a ReadableStream that delivers SSE chunks with a delay between each.
 */
function createDelayedSseStream(
	chunks: string[],
	delayMs: number,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let index = 0;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (index >= chunks.length) {
				controller.close();
				return;
			}
			if (index > 0 && delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
			const chunk = chunks[index];
			if (chunk === undefined) {
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(chunk));
			index += 1;
		},
	});
}

async function assertRequestBodyMatches(input: {
	recording: VcrRecording;
	requestInput: string | URL | Request;
	requestInit?: RequestInit;
	method: string;
	path: string;
}): Promise<void> {
	if (input.recording.requestBody === undefined) {
		return;
	}
	const requestBody = await readRequestBody(
		input.requestInput,
		input.requestInit,
	);
	const requestContentType = readRequestContentType(
		input.requestInput,
		input.requestInit,
	);
	const actualBody = sanitizeSerializedRequestBody(
		requestBody ?? "",
		requestContentType,
	);
	if (actualBody !== input.recording.requestBody) {
		throw new Error(
			`[VCR] Request body mismatch for ${input.method} ${input.path}.\n` +
				`  expected: ${input.recording.requestBody}\n` +
				`  actual:   ${actualBody}\n` +
				"Re-record the cassette if the request change is intentional.",
		);
	}
}

function startPlayingBackRequests(cassettePath: string, filter: string): void {
	if (!existsSync(cassettePath)) {
		process.stderr.write(`[VCR] Cassette file not found: ${cassettePath}\n`);
		process.exit(1);
	}

	const recordings: VcrRecording[] = JSON.parse(
		readFileSync(cassettePath, "utf-8"),
	);

	const sseDelayMs = Number.parseInt(
		process.env.CLINE_VCR_SSE_DELAY ?? "100",
		10,
	);

	// Track which recordings have been consumed (each can be used once)
	const consumed = new Array<boolean>(recordings.length).fill(false);
	const originalFetch = globalThis.fetch;

	globalThis.fetch = Object.assign(
		async (
			input: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			const url = resolveRequestUrl(input);
			const method = resolveRequestMethod(input, init);
			const { path } = parseScope(url);
			const normalizedPath = normalizePath(path);

			// Check filter: if filter is set and path doesn't match, passthrough
			if (filter && !path.includes(filter)) {
				return originalFetch(input, init);
			}

			// Find a matching unconsumed recording
			const matchIndex = recordings.findIndex((rec, index) => {
				if (consumed[index]) {
					return false;
				}
				// Match on method + normalized path. Scope is checked loosely
				// (hostname may differ between record and playback environments).
				const recNormalizedPath = normalizePath(rec.path);
				return (
					rec.method.toUpperCase() === method &&
					recNormalizedPath === normalizedPath
				);
			});

			if (matchIndex >= 0) {
				const rec = recordings[matchIndex];
				if (!rec) {
					return originalFetch(input, init);
				}
				await assertRequestBodyMatches({
					recording: rec,
					requestInput: input,
					requestInit: init,
					method,
					path: normalizedPath,
				});
				consumed[matchIndex] = true;

				// Build response body
				const body =
					typeof rec.response === "string"
						? rec.response
						: JSON.stringify(rec.response);

				// Use recorded content-type if available, otherwise infer from response shape
				const headers = new Headers();
				if (rec.contentType) {
					headers.set("content-type", rec.contentType);
				} else {
					// Fallback heuristic for cassettes recorded before contentType was captured
					const isSSE =
						typeof rec.response === "string" &&
						rec.response.trimStart().startsWith("data:");
					if (isSSE) {
						headers.set("content-type", "text/event-stream");
					} else if (typeof rec.response === "object") {
						headers.set("content-type", "application/json");
					}
				}

				const isSSEResponse =
					headers.get("content-type")?.includes("text/event-stream") ?? false;

				// SSE responses need streaming-friendly headers
				if (isSSEResponse) {
					headers.set("cache-control", "no-cache");
					headers.set("connection", "keep-alive");
				}

				// For SSE responses, stream chunks with a delay to simulate
				// real-time delivery (controlled by CLINE_VCR_SSE_DELAY).
				if (isSSEResponse && typeof rec.response === "string") {
					const chunks = splitSseChunks(rec.response);
					if (chunks.length > 1) {
						const stream = createDelayedSseStream(chunks, sseDelayMs);
						return new Response(stream, {
							status: rec.status,
							headers,
						});
					}
				}

				return new Response(body, {
					status: rec.status,
					headers,
				});
			}

			// No match found
			if (!filter) {
				// Full isolation mode, so no filter means nothing should leak
				throw new Error(
					`[VCR] No matching recording for ${method} ${url} (path: ${normalizedPath}). ` +
						`${recordings.length} recording(s) loaded from ${cassettePath}.`,
				);
			}

			// Filtered mode, passthrough non-matching requests
			return originalFetch(input, init);
		},
		{ preconnect: (_url: string | URL) => {} },
	);

	const filterDesc = filter
		? `(only paths matching "*${filter}*", all other requests go through normally)`
		: "(all requests intercepted)";
	process.stderr.write(
		`[VCR] Playing back ${recordings.length} recorded HTTP interaction(s) from ${cassettePath} ${filterDesc}\n`,
	);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Initialize VCR mode based on environment variables.
 * Must be called early in startup, before HTTP requests are made.
 *
 * Does nothing if `CLINE_VCR` is not set.
 */
export function initVcr(vcrMode: string | undefined): void {
	const config = getVcrConfig(vcrMode);
	if (!config) {
		return;
	}

	if (config.mode === "record") {
		startRecordingRequests(
			config.cassettePath,
			config.filter,
			config.includeRequestBody,
		);
	} else {
		startPlayingBackRequests(config.cassettePath, config.filter);
	}
}
