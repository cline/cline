import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import * as LlmsProviders from "../providers";
import { toLiveProviderConfig } from "./provider-live-config";

type ProviderConfig = import("../providers").ProviderConfig;

interface StoredProviderSettingsEntryLike {
	settings?: unknown;
}

interface StoredProviderSettingsLike {
	providers?: Record<string, unknown>;
}

interface ProviderTarget {
	label: string;
	config: ProviderConfig;
	systemPrompt: string;
	userPrompt: string;
	runs: number;
	expectations: LiveExpectations;
}

const LIVE_TEST_ENABLED = process.env.LLMS_LIVE_TESTS === "1";
const PROVIDERS_FILE_ENV = "LLMS_LIVE_PROVIDERS_PATH";
const PROVIDER_TIMEOUT_MS = Number(
	process.env.LLMS_LIVE_PROVIDER_TIMEOUT_MS ?? "90000",
);
const PROVIDER_RETRIES = Number(process.env.LLMS_LIVE_PROVIDER_RETRIES ?? "2");
const PROVIDER_ATTEMPTS = Number.isFinite(PROVIDER_RETRIES)
	? Math.max(1, Math.floor(PROVIDER_RETRIES) + 1)
	: 1;
const DEFAULT_SYSTEM_PROMPT = "You are a concise assistant.";
const DEFAULT_USER_PROMPT = "Reply with the single word OK.";
const DEFAULT_CACHE_PROBE_PROMPT = [
	"Answer with one word: OK.",
	"Use only the provided context below; do not call tools.",
	"Context:",
	// Keep this comfortably above Gemini's implicit-cache floor to avoid
	// provider-side cache misses making the live cache assertion flaky.
	"Section A: ".repeat(1600),
	"Section B: ".repeat(1600),
].join("\n");

interface LiveExpectations {
	requireUsage?: boolean;
	requireReasoningChunk?: boolean;
	requireCacheReadTokens?: boolean;
	minInputTokens?: number;
	minOutputTokens?: number;
	minCacheReadTokens?: number;
}

interface LiveProviderEntryLike {
	settings?: unknown;
	expectations?: unknown;
	systemPrompt?: unknown;
	userPrompt?: unknown;
	prompt?: unknown;
	runs?: unknown;
}

interface LiveRunMetrics {
	usageSeen: boolean;
	reasoningChunkCount: number;
	cacheReadTokensMax: number;
	cacheWriteTokensMax: number;
	inputTokensMax: number;
	outputTokensMax: number;
}

function parseExpectations(input: unknown): LiveExpectations {
	if (!input || typeof input !== "object") {
		return {};
	}
	const value = input as Record<string, unknown>;
	return {
		requireUsage:
			typeof value.requireUsage === "boolean" ? value.requireUsage : undefined,
		requireReasoningChunk:
			typeof value.requireReasoningChunk === "boolean"
				? value.requireReasoningChunk
				: undefined,
		requireCacheReadTokens:
			typeof value.requireCacheReadTokens === "boolean"
				? value.requireCacheReadTokens
				: undefined,
		minInputTokens:
			typeof value.minInputTokens === "number"
				? value.minInputTokens
				: undefined,
		minOutputTokens:
			typeof value.minOutputTokens === "number"
				? value.minOutputTokens
				: undefined,
		minCacheReadTokens:
			typeof value.minCacheReadTokens === "number"
				? value.minCacheReadTokens
				: undefined,
	};
}

function toTarget(
	label: string,
	settingsInput: unknown,
	entry?: LiveProviderEntryLike,
): ProviderTarget {
	const config = toLiveProviderConfig(settingsInput);
	const runsCandidate = entry?.runs;
	let runs =
		typeof runsCandidate === "number" &&
		Number.isFinite(runsCandidate) &&
		runsCandidate > 0
			? Math.floor(runsCandidate)
			: 1;
	const expectations = parseExpectations(entry?.expectations);
	const requiresCacheProbe =
		expectations.requireCacheReadTokens ||
		typeof expectations.minCacheReadTokens === "number";
	if (requiresCacheProbe && runs < 2) {
		runs = 2;
	}
	const promptCandidate =
		typeof entry?.userPrompt === "string"
			? entry.userPrompt
			: typeof entry?.prompt === "string"
				? entry.prompt
				: undefined;
	return {
		label: `${label} (${config.providerId})`,
		config,
		systemPrompt:
			typeof entry?.systemPrompt === "string"
				? entry.systemPrompt
				: DEFAULT_SYSTEM_PROMPT,
		userPrompt:
			promptCandidate ??
			(requiresCacheProbe ? DEFAULT_CACHE_PROBE_PROMPT : DEFAULT_USER_PROMPT),
		runs,
		expectations,
	};
}

function requireProvidersFilePath(): string {
	const filePath = process.env[PROVIDERS_FILE_ENV];
	if (!filePath) {
		throw new Error(
			`Set ${PROVIDERS_FILE_ENV} to a LlmsProviders.json file path before running live provider tests.`,
		);
	}
	return path.resolve(filePath);
}

function toTargetsFromStoredFormat(
	json: StoredProviderSettingsLike,
): ProviderTarget[] {
	const entries = Object.entries(json.providers ?? {});
	return entries.map(([entryKey, entryValue]) => {
		const maybeEntry = entryValue as LiveProviderEntryLike &
			StoredProviderSettingsEntryLike;
		const rawSettings = maybeEntry.settings ?? entryValue;
		return toTarget(entryKey, rawSettings, maybeEntry);
	});
}

function loadProviderTargets(filePath: string): ProviderTarget[] {
	const raw = readFileSync(filePath, "utf8");
	const parsed = JSON.parse(raw) as unknown;

	if (Array.isArray(parsed)) {
		return parsed.map((entry, index) => {
			if (entry && typeof entry === "object" && "settings" in entry) {
				const wrapped = entry as LiveProviderEntryLike;
				return toTarget(`index:${index}`, wrapped.settings, wrapped);
			}
			return toTarget(`index:${index}`, entry);
		});
	}

	const maybeStored = parsed as StoredProviderSettingsLike;
	return toTargetsFromStoredFormat(maybeStored);
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timeout = setTimeout(() => {
			reject(new Error(`Timed out after ${timeoutMs}ms: ${label}`));
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

function assertTargetExpectations(
	target: ProviderTarget,
	metrics: LiveRunMetrics,
): void {
	const errors: string[] = [];
	const expectations = target.expectations;
	if (expectations.requireUsage !== false && !metrics.usageSeen) {
		errors.push("expected at least one usage chunk");
	}
	if (expectations.requireReasoningChunk && metrics.reasoningChunkCount <= 0) {
		errors.push("expected at least one reasoning chunk");
	}
	if (expectations.requireCacheReadTokens && metrics.cacheReadTokensMax <= 0) {
		errors.push("expected cacheReadTokens > 0");
	}
	if (
		typeof expectations.minInputTokens === "number" &&
		metrics.inputTokensMax < expectations.minInputTokens
	) {
		errors.push(
			`expected inputTokens >= ${expectations.minInputTokens}, got ${metrics.inputTokensMax}`,
		);
	}
	if (
		typeof expectations.minOutputTokens === "number" &&
		metrics.outputTokensMax < expectations.minOutputTokens
	) {
		errors.push(
			`expected outputTokens >= ${expectations.minOutputTokens}, got ${metrics.outputTokensMax}`,
		);
	}
	if (
		typeof expectations.minCacheReadTokens === "number" &&
		metrics.cacheReadTokensMax < expectations.minCacheReadTokens
	) {
		errors.push(
			`expected cacheReadTokens >= ${expectations.minCacheReadTokens}, got ${metrics.cacheReadTokensMax}`,
		);
	}
	if (errors.length > 0) {
		throw new Error(errors.join("; "));
	}
}

async function runPrompt(target: ProviderTarget): Promise<void> {
	const handler = await LlmsProviders.createHandlerAsync(target.config);
	const metrics: LiveRunMetrics = {
		usageSeen: false,
		reasoningChunkCount: 0,
		cacheReadTokensMax: 0,
		cacheWriteTokensMax: 0,
		inputTokensMax: 0,
		outputTokensMax: 0,
	};
	for (let run = 0; run < target.runs; run++) {
		const stream = handler.createMessage(target.systemPrompt, [
			{ role: "user", content: target.userPrompt },
		]);
		for await (const chunk of stream) {
			if (chunk.type === "reasoning") {
				metrics.reasoningChunkCount += 1;
				continue;
			}
			if (chunk.type === "usage") {
				metrics.usageSeen = true;
				metrics.inputTokensMax = Math.max(
					metrics.inputTokensMax,
					chunk.inputTokens ?? 0,
				);
				metrics.outputTokensMax = Math.max(
					metrics.outputTokensMax,
					chunk.outputTokens ?? 0,
				);
				metrics.cacheReadTokensMax = Math.max(
					metrics.cacheReadTokensMax,
					chunk.cacheReadTokens ?? 0,
				);
				metrics.cacheWriteTokensMax = Math.max(
					metrics.cacheWriteTokensMax,
					chunk.cacheWriteTokens ?? 0,
				);
				continue;
			}
			if (chunk.type === "done" && !chunk.success) {
				throw new Error(chunk.error ?? "done chunk reported success=false");
			}
		}
	}
	assertTargetExpectations(target, metrics);
}

describe("live provider smoke test", () => {
	const runLive = LIVE_TEST_ENABLED ? it : it.skip;
	runLive(
		"reads configured providers from json and reports providers with failed responses",
		async () => {
			const filePath = requireProvidersFilePath();
			const targets = loadProviderTargets(filePath);

			if (!targets.length) {
				throw new Error(`No providers found in ${filePath}.`);
			}

			const failures: string[] = [];

			for (const target of targets) {
				let success = false;
				let lastError: unknown;
				for (let attempt = 1; attempt <= PROVIDER_ATTEMPTS; attempt++) {
					try {
						await withTimeout(
							runPrompt(target),
							PROVIDER_TIMEOUT_MS,
							target.label,
						);
						success = true;
						break;
					} catch (error) {
						lastError = error;
					}
				}
				if (!success) {
					const message =
						lastError instanceof Error ? lastError.message : String(lastError);
					failures.push(`${target.label}: ${message}`);
				}
			}

			if (failures.length > 0) {
				throw new Error(
					`Providers with error responses (${failures.length}):\n${failures.join("\n")}`,
				);
			}
		},
		300_000,
	);
});
