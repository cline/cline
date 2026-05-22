import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disposeAll, initVcr } from "@cline/shared";
import { resolveProviderSettingsPath } from "@cline/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import { createHandlerAsync, type ProviderConfig } from "../providers";

const fixturesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"provider-vcr",
);
const RECORD_MODE = process.env.LLMS_PROVIDER_VCR_RECORD === "1";
const TARGET_FILTER =
	process.env.LLMS_PROVIDER_VCR_TARGET?.trim().toLowerCase();
const PROVIDER_SETTINGS_PATH_ENV = "LLMS_PROVIDER_VCR_SETTINGS_PATH";
const SYSTEM_PROMPT = "You are a concise assistant.";
const USER_PROMPT = "Reply with the single word OK.";
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;
let activeCassettePath: string | undefined;
let activeCassetteOriginalContents: string | undefined;
let activeCassetteSucceeded = false;

interface ProviderVcrTarget {
	label: string;
	providerId: string;
	modelId: string;
	playbackConfig: ProviderConfig;
	cassetteName: string;
}

interface StoredProviderSettingsEntryLike {
	settings?: unknown;
}

interface StoredProviderSettingsLike {
	providers?: Record<string, StoredProviderSettingsEntryLike>;
}

const targets: ProviderVcrTarget[] = [
	{
		label: "Cline provider",
		providerId: "cline",
		modelId: "anthropic/claude-sonnet-4.6",
		playbackConfig: {
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "workos:test-token",
		},
		cassetteName: "cline-anthropic-sonnet.json",
	},
	{
		label: "ChatGPT OAuth provider",
		providerId: "openai-codex",
		modelId: "gpt-5.4",
		playbackConfig: {
			providerId: "openai-codex",
			modelId: "gpt-5.4",
			apiKey: "test-token",
			headers: {
				"ChatGPT-Account-Id": "acct_test",
			},
		},
		cassetteName: "openai-codex-gpt-5-4.json",
	},
	{
		label: "Anthropic provider",
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		playbackConfig: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "test-key",
		},
		cassetteName: "anthropic-claude-sonnet-4-6.json",
	},
	{
		label: "OpenAI Compatible provider",
		providerId: "openai-compatible",
		modelId: "deepseek/deepseek-v4-pro",
		playbackConfig: {
			providerId: "openai-compatible",
			modelId: "deepseek/deepseek-v4-pro",
			apiKey: "test-key",
			baseUrl: "https://openrouter.ai/api/v1",
		},
		cassetteName: "openai-compatible-deepseek-v4-pro.json",
	},
];

function matchesTargetFilter(target: ProviderVcrTarget): boolean {
	if (!TARGET_FILTER) {
		return true;
	}
	return [
		target.providerId,
		target.cassetteName.replace(/\.json$/, ""),
		target.label,
	]
		.map((value) => value.toLowerCase())
		.some((value) => value.includes(TARGET_FILTER));
}

const selectedTargets = targets.filter(matchesTargetFilter);

function readObject(input: unknown): Record<string, unknown> {
	return input && typeof input === "object" && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: {};
}

function readString(input: unknown): string | undefined {
	return typeof input === "string" && input.trim().length > 0
		? input.trim()
		: undefined;
}

function readStringRecord(input: unknown): Record<string, string> | undefined {
	const entries = Object.entries(readObject(input)).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readProviderSettingsFile(): StoredProviderSettingsLike | undefined {
	const filePath =
		readString(process.env[PROVIDER_SETTINGS_PATH_ENV]) ??
		resolveProviderSettingsPath();
	if (!existsSync(filePath)) {
		return undefined;
	}
	return JSON.parse(
		readFileSync(filePath, "utf8"),
	) as StoredProviderSettingsLike;
}

function readStoredSettings(providerId: string): Record<string, unknown> {
	const stored = readProviderSettingsFile();
	const settings = stored?.providers?.[providerId]?.settings;
	return readObject(settings);
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		const text = readString(value);
		if (text) {
			return text;
		}
	}
	return undefined;
}

function readEnvironmentApiKey(providerId: string): string | undefined {
	switch (providerId) {
		case "anthropic":
			return readString(process.env.ANTHROPIC_API_KEY);
		case "cline":
			return readString(process.env.CLINE_API_KEY);
		default:
			return undefined;
	}
}

function formatApiKey(providerId: string, apiKey: string): string {
	if (providerId === "cline" && !apiKey.startsWith("workos:")) {
		return `workos:${apiKey}`;
	}
	return apiKey;
}

function createRecordingConfig(target: ProviderVcrTarget): ProviderConfig {
	const settings = readStoredSettings(target.providerId);
	const auth = readObject(settings.auth);
	const apiKey = firstString(
		auth.accessToken,
		settings.apiKey,
		auth.apiKey,
		readEnvironmentApiKey(target.providerId),
	);
	if (!apiKey) {
		throw new Error(
			`Provider VCR record mode needs saved settings or env credentials for ${target.providerId}`,
		);
	}
	const headers = readStringRecord(settings.headers) ?? {};
	const accountId = readString(auth.accountId);
	if (
		target.providerId === "openai-codex" &&
		accountId &&
		!headers["ChatGPT-Account-Id"]
	) {
		headers["ChatGPT-Account-Id"] = accountId;
	}
	return {
		providerId: target.providerId,
		modelId: target.modelId,
		apiKey: formatApiKey(target.providerId, apiKey),
		baseUrl: readString(settings.baseUrl),
		headers: Object.keys(headers).length > 0 ? headers : undefined,
	};
}

function createProviderConfig(target: ProviderVcrTarget): ProviderConfig {
	return RECORD_MODE ? createRecordingConfig(target) : target.playbackConfig;
}

async function runProviderSmoke(config: ProviderConfig): Promise<{
	text: string;
	doneSeen: boolean;
	usageSeen: boolean;
}> {
	const handler = await createHandlerAsync(config);
	let text = "";
	let doneSeen = false;
	let usageSeen = false;

	for await (const chunk of handler.createMessage(SYSTEM_PROMPT, [
		{ role: "user", content: USER_PROMPT },
	])) {
		if (chunk.type === "text") {
			text += chunk.text;
		}
		if (chunk.type === "usage") {
			usageSeen = true;
		}
		if (chunk.type === "done") {
			doneSeen = true;
			expect(chunk.success).toBe(true);
		}
	}

	return { text, doneSeen, usageSeen };
}

function configureVcr(cassettePath: string): void {
	activeCassettePath = cassettePath;
	activeCassetteOriginalContents =
		RECORD_MODE && existsSync(cassettePath)
			? readFileSync(cassettePath, "utf8")
			: undefined;
	activeCassetteSucceeded = false;
	assertPlaybackCassetteHasRequestContracts(cassettePath);
	process.env.CLINE_VCR = RECORD_MODE ? "record" : "playback";
	process.env.CLINE_VCR_CASSETTE = cassettePath;
	process.env.CLINE_VCR_INCLUDE_REQUEST_BODY = "1";
	process.env.CLINE_VCR_FILTER = "";
	initVcr(process.env.CLINE_VCR);
}

function keepRecordedCassette(): void {
	activeCassetteSucceeded = true;
}

interface MutableVcrRecording {
	requestBody?: unknown;
	response?: unknown;
	[key: string]: unknown;
}

function toMutableRecording(input: unknown): MutableVcrRecording | undefined {
	return input && typeof input === "object" && !Array.isArray(input)
		? (input as MutableVcrRecording)
		: undefined;
}

function readCassette(cassettePath: string): unknown[] {
	const parsed = JSON.parse(readFileSync(cassettePath, "utf8")) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error(`Provider VCR cassette must be an array: ${cassettePath}`);
	}
	return parsed;
}

function assertPlaybackCassetteHasRequestContracts(cassettePath: string): void {
	if (RECORD_MODE) {
		return;
	}
	const recordings = readCassette(cassettePath);
	for (const [index, input] of recordings.entries()) {
		const recording = toMutableRecording(input);
		if (typeof recording?.requestBody !== "string") {
			throw new Error(
				`Provider VCR cassette entry ${index} is missing requestBody: ${cassettePath}`,
			);
		}
	}
}

const PROVIDER_RESPONSE_ID_KEYS = new Set([
	"id",
	"item_id",
	"response_id",
	"call_id",
	"previous_response_id",
	"generationId",
	"providerRequestId",
	"providerResponseId",
]);

const PROVIDER_RESPONSE_REDACTED_KEYS = new Set([
	"encrypted_content",
	"safety_identifier",
	"prompt_cache_key",
	"obfuscation",
	"system_fingerprint",
	"planningReasoning",
]);

const PROVIDER_RESPONSE_ZEROED_KEYS = new Set([
	"created",
	"created_at",
	"completed_at",
	"startTime",
	"endTime",
]);

function sanitizeProviderResponseValue(input: unknown): unknown {
	if (Array.isArray(input)) {
		return input.map(sanitizeProviderResponseValue);
	}
	if (!input || typeof input !== "object") {
		return input;
	}

	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (PROVIDER_RESPONSE_ID_KEYS.has(key)) {
			output[key] = "ID_REDACTED";
			continue;
		}
		if (PROVIDER_RESPONSE_REDACTED_KEYS.has(key)) {
			output[key] = "REDACTED";
			continue;
		}
		if (PROVIDER_RESPONSE_ZEROED_KEYS.has(key) && typeof value === "number") {
			output[key] = 0;
			continue;
		}
		output[key] = sanitizeProviderResponseValue(value);
	}
	return output;
}

function sanitizeProviderResponseEventLine(input: string): string {
	const prefix = "data: ";
	if (!input.startsWith(prefix)) {
		return input;
	}
	const body = input.slice(prefix.length);
	if (body === "[DONE]") {
		return input;
	}
	try {
		return `${prefix}${JSON.stringify(
			sanitizeProviderResponseValue(JSON.parse(body) as unknown),
		)}`;
	} catch {
		return input;
	}
}

function sanitizeProviderResponseEvents(input: string): string {
	return input.split("\n").map(sanitizeProviderResponseEventLine).join("\n");
}

function sanitizeProviderResponseText(input: string): string {
	const normalizedText = input
		.replaceAll(
			/"encrypted_content":"[^"]*"/g,
			'"encrypted_content":"REDACTED"',
		)
		.replaceAll(
			/"safety_identifier":"[^"]*"/g,
			'"safety_identifier":"REDACTED"',
		)
		.replaceAll(/"prompt_cache_key":"[^"]*"/g, '"prompt_cache_key":"REDACTED"')
		.replaceAll(/"obfuscation":"[^"]*"/g, '"obfuscation":"REDACTED"')
		.replaceAll(/"id":"[^"]*"/g, '"id":"ID_REDACTED"')
		.replaceAll(/"item_id":"[^"]*"/g, '"item_id":"ID_REDACTED"')
		.replaceAll(/"response_id":"[^"]*"/g, '"response_id":"ID_REDACTED"')
		.replaceAll(/"call_id":"[^"]*"/g, '"call_id":"ID_REDACTED"')
		.replaceAll(
			/"system_fingerprint":"[^"]*"/g,
			'"system_fingerprint":"REDACTED"',
		)
		.replaceAll(/"generationId":"[^"]*"/g, '"generationId":"ID_REDACTED"')
		.replaceAll(
			/"providerRequestId":"[^"]*"/g,
			'"providerRequestId":"ID_REDACTED"',
		)
		.replaceAll(
			/"providerResponseId":"[^"]*"/g,
			'"providerResponseId":"ID_REDACTED"',
		)
		.replaceAll(
			/"planningReasoning":"[^"]*"/g,
			'"planningReasoning":"REDACTED"',
		)
		.replaceAll(
			/"previous_response_id":"[^"]*"/g,
			'"previous_response_id":"ID_REDACTED"',
		)
		.replaceAll(/"created":\d+/g, '"created":0')
		.replaceAll(/"created_at":\d+/g, '"created_at":0')
		.replaceAll(/"completed_at":\d+/g, '"completed_at":0')
		.replaceAll(/"startTime":\d+/g, '"startTime":0')
		.replaceAll(/"endTime":\d+/g, '"endTime":0');
	return sanitizeProviderResponseEvents(normalizedText);
}

function scrubRecordedCassette(cassettePath: string): void {
	if (!RECORD_MODE || !existsSync(cassettePath)) {
		return;
	}
	const recordings = readCassette(cassettePath).map((input) => {
		const recording = toMutableRecording(input);
		if (!recording || typeof recording.response !== "string") {
			return input;
		}
		return {
			...recording,
			response: sanitizeProviderResponseText(recording.response),
		};
	});
	writeFileSync(cassettePath, `${JSON.stringify(recordings, null, 2)}\n`);
}

afterEach(async () => {
	const cassettePath = activeCassettePath;
	const originalContents = activeCassetteOriginalContents;
	const shouldKeepCassette = activeCassetteSucceeded;
	try {
		await disposeAll();
	} finally {
		if (cassettePath && RECORD_MODE) {
			if (shouldKeepCassette) {
				scrubRecordedCassette(cassettePath);
			} else if (originalContents !== undefined) {
				writeFileSync(cassettePath, originalContents);
			}
		}
		activeCassettePath = undefined;
		activeCassetteOriginalContents = undefined;
		activeCassetteSucceeded = false;
		process.env = { ...ORIGINAL_ENV };
		globalThis.fetch = ORIGINAL_FETCH;
	}
});

describe.sequential("provider VCR smoke tests", () => {
	if (selectedTargets.length === 0) {
		it("has a selected provider target", () => {
			throw new Error(
				`No provider VCR target matches LLMS_PROVIDER_VCR_TARGET=${TARGET_FILTER}`,
			);
		});
	}

	for (const target of selectedTargets) {
		it(
			`replays ${target.label}`,
			async () => {
				const cassettePath = join(fixturesDir, target.cassetteName);
				configureVcr(cassettePath);

				const result = await runProviderSmoke(createProviderConfig(target));

				expect(result.text).toBe("OK");
				expect(result.usageSeen).toBe(true);
				expect(result.doneSeen).toBe(true);
				keepRecordedCassette();
			},
			RECORD_MODE ? 120_000 : 15_000,
		);
	}
});
