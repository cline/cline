import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import * as LlmsProviders from "./providers";

type ProviderConfig = import("./providers").ProviderConfig;

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
	requireUsage: boolean;
	requireReasoningSignal: boolean;
}

const LIVE_TEST_ENABLED = process.env.LLMS_LIVE_REASONING_TESTS === "1";
const PROVIDERS_FILE_ENV = "LLMS_LIVE_REASONING_PROVIDERS_PATH";
const PROVIDER_TIMEOUT_MS = Number(
	process.env.LLMS_LIVE_PROVIDER_TIMEOUT_MS ?? "90000",
);
const PROVIDER_RETRIES = Number(process.env.LLMS_LIVE_PROVIDER_RETRIES ?? "2");
const PROVIDER_ATTEMPTS = Number.isFinite(PROVIDER_RETRIES)
	? Math.max(1, Math.floor(PROVIDER_RETRIES) + 1)
	: 1;
const DEFAULT_SYSTEM_PROMPT = "You are a concise assistant.";
const DEFAULT_USER_PROMPT =
	"Solve briefly: what is 47*83? Then give one short sentence.";

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
	thoughtsTokenCountMax: number;
}

function toProviderConfig(settingsInput: unknown): ProviderConfig {
	const settings =
		settingsInput && typeof settingsInput === "object"
			? (settingsInput as Record<string, unknown>)
			: {};
	const provider = settings.provider;
	if (typeof provider !== "string" || provider.trim().length === 0) {
		throw new Error("live provider entry must include a provider string");
	}
	const config: ProviderConfig = {
		providerId: provider,
	};
	if (typeof settings.model === "string") {
		config.modelId = settings.model;
	}
	if (typeof settings.apiKey === "string") {
		config.apiKey = settings.apiKey;
	}
	if (typeof settings.baseUrl === "string") {
		config.baseUrl = settings.baseUrl;
	}
	if (
		settings.reasoning &&
		typeof settings.reasoning === "object" &&
		!Array.isArray(settings.reasoning)
	) {
		const reasoning = settings.reasoning as Record<string, unknown>;
		if (typeof reasoning.enabled === "boolean") {
			config.thinking = reasoning.enabled;
		}
		if (typeof reasoning.effort === "string" && reasoning.effort !== "none") {
			config.reasoningEffort = reasoning.effort as
				| "low"
				| "medium"
				| "high"
				| "xhigh";
		}
		if (typeof reasoning.budgetTokens === "number") {
			config.thinkingBudgetTokens = reasoning.budgetTokens;
		}
	}
	return config;
}

function toTarget(
	label: string,
	settingsInput: unknown,
	entry?: LiveProviderEntryLike,
): ProviderTarget {
	const config = toProviderConfig(settingsInput);
	const runsCandidate = entry?.runs;
	const runs =
		typeof runsCandidate === "number" &&
		Number.isFinite(runsCandidate) &&
		runsCandidate > 0
			? Math.floor(runsCandidate)
			: 1;
	const expectations =
		entry?.expectations && typeof entry.expectations === "object"
			? (entry.expectations as Record<string, unknown>)
			: {};

	return {
		label: `${label} (${config.providerId})`,
		config,
		systemPrompt:
			typeof entry?.systemPrompt === "string"
				? entry.systemPrompt
				: DEFAULT_SYSTEM_PROMPT,
		userPrompt:
			typeof entry?.userPrompt === "string"
				? entry.userPrompt
				: typeof entry?.prompt === "string"
					? entry.prompt
					: DEFAULT_USER_PROMPT,
		runs,
		requireUsage: expectations.requireUsage !== false,
		requireReasoningSignal: expectations.requireReasoningSignal === true,
	};
}

function requireProvidersFilePath(): string {
	const filePath = process.env[PROVIDERS_FILE_ENV];
	if (!filePath) {
		throw new Error(
			`Set ${PROVIDERS_FILE_ENV} to a provider json path before running live reasoning tests.`,
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

	return toTargetsFromStoredFormat(parsed as StoredProviderSettingsLike);
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
	if (target.requireUsage && !metrics.usageSeen) {
		errors.push("expected at least one usage chunk");
	}
	if (
		target.requireReasoningSignal &&
		metrics.reasoningChunkCount <= 0 &&
		metrics.thoughtsTokenCountMax <= 0
	) {
		errors.push(
			"expected reasoning signal (reasoning chunk or thoughts tokens)",
		);
	}
	if (errors.length > 0) {
		throw new Error(errors.join("; "));
	}
}

async function runReasoningPrompt(target: ProviderTarget): Promise<void> {
	const handler = await LlmsProviders.createHandlerAsync(target.config);
	const metrics: LiveRunMetrics = {
		usageSeen: false,
		reasoningChunkCount: 0,
		thoughtsTokenCountMax: 0,
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
				metrics.thoughtsTokenCountMax = Math.max(
					metrics.thoughtsTokenCountMax,
					chunk.thoughtsTokenCount ?? 0,
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

describe("live provider reasoning smoke test", () => {
	const runLive = LIVE_TEST_ENABLED ? it : it.skip;
	runLive(
		"runs reasoning-enabled provider configs and reports failures",
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
							runReasoningPrompt(target),
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
