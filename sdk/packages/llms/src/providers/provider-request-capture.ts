import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { GatewayStreamRequest } from "@cline/shared";
import { estimateTokens } from "@cline/shared";

type CaptureMode = "off" | "summary" | "full";
type CaptureStage = "ai_sdk_prompt" | "wire_request";

const DEFAULT_MAX_PREVIEW_BYTES = 64 * 1024;
const CAPTURE_FILE_EXTENSION = ".provider-request.json";
const CAPTURE_TMP_EXTENSION = ".tmp";
const CLEANUP_TTL_MS = 24 * 60 * 60 * 1000;
const cleanupDirs = new Set<string>();
const attemptCounters = new Map<string, number>();

function readCaptureMode(): CaptureMode {
	const raw = process.env.CLINE_CAPTURE_PROVIDER_REQUEST?.trim().toLowerCase();
	if (raw === "summary" || raw === "full") {
		return raw;
	}
	return "off";
}

function isWireCaptureEnabled(): boolean {
	return process.env.CLINE_CAPTURE_WIRE?.trim().toLowerCase() === "true";
}

function readMaxPreviewBytes(): number {
	const parsed = Number(process.env.CLINE_CAPTURE_MAX_PREVIEW_BYTES);
	return Number.isFinite(parsed) && parsed > 0
		? Math.floor(parsed)
		: DEFAULT_MAX_PREVIEW_BYTES;
}

function isCleanupEnabled(): boolean {
	return process.env.CLINE_CAPTURE_CLEANUP?.trim().toLowerCase() !== "off";
}

function resolveCaptureDir(): string | undefined {
	const explicit = process.env.CLINE_CAPTURE_DIR?.trim();
	if (explicit) {
		return resolve(explicit);
	}
	const dataDir = process.env.CLINE_DATA_DIR?.trim();
	if (dataDir) {
		return resolve(dataDir, "provider-request-captures");
	}
	return undefined;
}

function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	try {
		return (
			JSON.stringify(value, (_key, nestedValue: unknown) => {
				if (typeof nestedValue === "bigint") {
					return nestedValue.toString();
				}
				if (typeof nestedValue !== "object" || nestedValue === null) {
					return nestedValue;
				}
				if (seen.has(nestedValue)) {
					return "[Circular]";
				}
				seen.add(nestedValue);
				return nestedValue;
			}) ?? ""
		);
	} catch {
		return String(value ?? "");
	}
}

function hashString(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function previewValue(
	value: unknown,
	maxBytes = DEFAULT_MAX_PREVIEW_BYTES,
): unknown {
	const serialized = safeStringify(value);
	if (byteLength(serialized) <= maxBytes) {
		return value;
	}
	const previewBuffer = Buffer.from(serialized, "utf8").subarray(0, maxBytes);
	let preview = previewBuffer.toString("utf8");
	while (byteLength(preview) > maxBytes) {
		preview = preview.slice(0, -1);
	}
	return {
		truncated: true,
		bytes: byteLength(serialized),
		sha256: hashString(serialized),
		preview,
	};
}

function summarizeContent(value: unknown): {
	bytes: number;
	estimatedTokens: number;
	sha256: string;
	kind: string;
} {
	const serialized = typeof value === "string" ? value : safeStringify(value);
	return {
		bytes: byteLength(serialized),
		estimatedTokens: estimateTokens(byteLength(serialized)),
		sha256: hashString(serialized),
		kind: Array.isArray(value) ? "array" : typeof value,
	};
}

function summarizeMessages(messages: unknown): Record<string, unknown> {
	if (!Array.isArray(messages)) {
		return summarizeContent(messages);
	}

	const roleCounts: Record<string, number> = {};
	let reasoningBlockCount = 0;
	let toolResultCount = 0;
	const messageSummaries = messages.map((message, index) => {
		const record =
			message && typeof message === "object"
				? (message as Record<string, unknown>)
				: {};
		const role = typeof record.role === "string" ? record.role : "unknown";
		roleCounts[role] = (roleCounts[role] ?? 0) + 1;
		const content = record.content;
		const contentArray = Array.isArray(content) ? content : [content];
		for (const part of contentArray) {
			if (!part || typeof part !== "object") continue;
			const type = (part as Record<string, unknown>).type;
			if (type === "reasoning") reasoningBlockCount += 1;
			if (type === "tool-result" || role === "tool") toolResultCount += 1;
		}
		const contentSummary = summarizeContent(content);
		return {
			index,
			role,
			contentParts: contentArray.length,
			contentBytes: contentSummary.bytes,
			estimatedTokens: contentSummary.estimatedTokens,
			sha256: contentSummary.sha256,
		};
	});

	const largestMessages = [...messageSummaries]
		.sort((a, b) => b.contentBytes - a.contentBytes)
		.slice(0, 5)
		.map((message) => ({ ...message }));
	const serialized = safeStringify(messages);
	return {
		messageCount: messages.length,
		roleCounts,
		totalBytes: byteLength(serialized),
		estimatedTokens: estimateTokens(byteLength(serialized)),
		sha256: hashString(serialized),
		reasoningBlockCount,
		toolResultCount,
		largestMessages,
		messages: messageSummaries,
	};
}

function parseJsonString(value: unknown): unknown {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function extractProviderMessages(
	payloadRecord: Record<string, unknown>,
): unknown {
	if ("messages" in payloadRecord) return payloadRecord.messages;
	const body = payloadRecord.body;
	const parsedBody = parseJsonString(body);
	if (parsedBody && typeof parsedBody === "object") {
		const bodyRecord = parsedBody as Record<string, unknown>;
		if ("messages" in bodyRecord) return bodyRecord.messages;
		if ("prompt" in bodyRecord) return bodyRecord.prompt;
		if ("contents" in bodyRecord) return bodyRecord.contents;
	}
	return undefined;
}

function captureCorrelation(
	request: GatewayStreamRequest,
): Record<string, unknown> {
	const metadata =
		request.metadata && typeof request.metadata === "object"
			? request.metadata
			: {};
	return {
		...metadata,
		providerId: request.providerId,
		modelId: request.modelId,
	};
}

function safeFilePart(value: unknown): string | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const raw = String(value).trim();
	if (!raw) return undefined;
	const safe = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return safe || undefined;
}

function captureIdForCorrelation(correlation: Record<string, unknown>): string {
	const explicit = safeFilePart(correlation.captureId);
	if (explicit) return explicit;
	const hash = hashString(safeStringify(correlation)).slice(0, 16);
	const runId = safeFilePart(correlation.runId);
	const iteration = safeFilePart(correlation.iteration);
	return ["cap", runId, iteration, hash].filter(Boolean).join("_");
}

function nextAttempt(captureId: string, stage: CaptureStage): number {
	const key = `${captureId}:${stage}`;
	const next = (attemptCounters.get(key) ?? 0) + 1;
	attemptCounters.set(key, next);
	return next;
}

function cleanupOldCaptures(dir: string): void {
	if (!isCleanupEnabled() || cleanupDirs.has(dir)) return;
	cleanupDirs.add(dir);
	try {
		const cutoff = Date.now() - CLEANUP_TTL_MS;
		for (const file of readdirSync(dir)) {
			if (
				!file.endsWith(CAPTURE_FILE_EXTENSION) &&
				!(
					file.includes(CAPTURE_FILE_EXTENSION) &&
					file.endsWith(CAPTURE_TMP_EXTENSION)
				)
			) {
				continue;
			}
			const path = join(dir, file);
			const stat = statSync(path);
			if (stat.mtimeMs < cutoff) {
				rmSync(path, { force: true });
			}
		}
	} catch {
		// Capture cleanup must never affect model execution.
	}
}

function writeCapture(record: Record<string, unknown>): void {
	try {
		const dir = resolveCaptureDir();
		if (!dir) return;
		mkdirSync(dir, { recursive: true });
		cleanupOldCaptures(dir);
		const correlation =
			record.correlation && typeof record.correlation === "object"
				? (record.correlation as Record<string, unknown>)
				: {};
		const captureId = captureIdForCorrelation(correlation);
		const stage =
			record.captureStage === "ai_sdk_prompt" ||
			record.captureStage === "wire_request"
				? record.captureStage
				: "ai_sdk_prompt";
		const attempt = nextAttempt(captureId, stage);
		const finalPath = join(
			dir,
			`${captureId}.${stage}.${attempt}${CAPTURE_FILE_EXTENSION}`,
		);
		const tmpPath = `${finalPath}.${process.pid}.${Date.now()}${CAPTURE_TMP_EXTENSION}`;
		writeFileSync(tmpPath, `${safeStringify({ ...record, attempt })}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(tmpPath, finalPath);
		if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
	} catch {
		// Provider-request capture must never affect model execution.
	}
}

export function recordProviderRequestCapture(input: {
	stage: CaptureStage;
	request: GatewayStreamRequest;
	payload: unknown;
}): void {
	try {
		const mode = readCaptureMode();
		if (mode === "off") return;
		const payloadRecord =
			input.payload && typeof input.payload === "object"
				? (input.payload as Record<string, unknown>)
				: { value: input.payload };
		const messages = extractProviderMessages(payloadRecord);
		const serializedPayload = safeStringify(input.payload);
		writeCapture({
			timestamp: new Date().toISOString(),
			captureStage: input.stage,
			mode,
			correlation: captureCorrelation(input.request),
			summary: {
				payloadBytes: byteLength(serializedPayload),
				estimatedTokens: estimateTokens(byteLength(serializedPayload)),
				sha256: hashString(serializedPayload),
				messages: summarizeMessages(messages),
			},
			...(mode === "full"
				? { payload: previewValue(input.payload, readMaxPreviewBytes()) }
				: {}),
		});
	} catch {
		// Provider-request capture must never affect model execution.
	}
}

async function readRequestBody(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): Promise<unknown> {
	const body = init?.body;
	if (body !== undefined && body !== null) {
		if (typeof body === "string") return body;
		if (body instanceof URLSearchParams) return body.toString();
		if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
		if (ArrayBuffer.isView(body)) {
			return Buffer.from(
				body.buffer,
				body.byteOffset,
				body.byteLength,
			).toString("utf8");
		}
		return { type: body.constructor?.name ?? typeof body };
	}
	if (input instanceof Request) {
		try {
			return await input.clone().text();
		} catch {
			return { type: "Request", bodyReadable: false };
		}
	}
	return undefined;
}

export function wrapFetchForProviderRequestCapture(
	baseFetch: typeof fetch | undefined,
	request: GatewayStreamRequest,
): typeof fetch | undefined {
	if (!isWireCaptureEnabled()) {
		return baseFetch;
	}
	const delegate = baseFetch ?? globalThis.fetch;
	if (!delegate) {
		return baseFetch;
	}
	const captureFetch = (async (input, init) => {
		void readRequestBody(input, init)
			.then((body) => {
				recordProviderRequestCapture({
					stage: "wire_request",
					request,
					payload: {
						url: input instanceof Request ? input.url : String(input),
						method:
							init?.method ??
							(input instanceof Request ? input.method : undefined) ??
							"GET",
						body,
					},
				});
			})
			.catch(() => {
				// Provider-request capture must never affect model execution.
			});
		return delegate(input, init);
	}) as typeof fetch;
	const delegateWithPreconnect = delegate as typeof fetch & {
		preconnect?: (...args: unknown[]) => unknown;
	};
	if (typeof delegateWithPreconnect.preconnect === "function") {
		(
			captureFetch as typeof fetch & {
				preconnect?: (...args: unknown[]) => unknown;
			}
		).preconnect = delegateWithPreconnect.preconnect.bind(delegate);
	}
	return captureFetch;
}
