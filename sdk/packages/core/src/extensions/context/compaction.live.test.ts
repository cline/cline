import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ProviderConfig } from "@cline/llms";
import { resolveProviderSettingsPath } from "@cline/shared/storage";
import { describe, expect, it } from "vitest";
import { createContextCompactionPrepareTurn } from "./compaction";

interface StoredProviderSettingsLike {
	providers?: Record<
		string,
		{
			settings?: {
				auth?: {
					accessToken?: string;
					accountId?: string;
				};
				apiKey?: string;
			};
		}
	>;
}

interface LiveProviderEntryLike {
	settings?: unknown;
}

interface ProviderTarget {
	label: string;
	config: ProviderConfig;
}

const LIVE_TEST_ENABLED = process.env.CORE_LIVE_COMPACTION_TESTS === "1";
const PROVIDERS_FILE_ENV =
	process.env.CORE_LIVE_COMPACTION_PROVIDERS_PATH ??
	process.env.LLMS_LIVE_PROVIDERS_PATH;
const PROVIDER_TIMEOUT_MS = Number(
	process.env.CORE_LIVE_COMPACTION_TIMEOUT_MS ??
		process.env.LLMS_LIVE_PROVIDER_TIMEOUT_MS ??
		"120000",
);
const HUGE_TOOL_OUTPUT_CHARS = Number(
	process.env.CORE_LIVE_COMPACTION_TOOL_OUTPUT_CHARS ?? "1100000",
);

function requireProvidersFilePath(): string {
	if (!PROVIDERS_FILE_ENV) {
		throw new Error(
			"Set CORE_LIVE_COMPACTION_PROVIDERS_PATH or LLMS_LIVE_PROVIDERS_PATH before running live compaction tests.",
		);
	}
	return path.resolve(PROVIDERS_FILE_ENV);
}

function readObject(input: unknown): Record<string, unknown> {
	return input && typeof input === "object" && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: {};
}

function readEnvValue(envName: unknown, label: string): string | undefined {
	if (typeof envName !== "string" || envName.trim().length === 0) {
		return undefined;
	}
	const value = process.env[envName]?.trim();
	if (!value) {
		throw new Error(
			`${label} references unset or empty environment variable ${envName}`,
		);
	}
	return value;
}

function readStringHeaders(input: unknown): Record<string, string> {
	return Object.fromEntries(
		Object.entries(readObject(input)).filter(
			([, value]) => typeof value === "string",
		),
	) as Record<string, string>;
}

function readSavedOpenAICodexSettings():
	| { accessToken?: string; accountId?: string }
	| undefined {
	const filePath = resolveProviderSettingsPath();
	if (!existsSync(filePath)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(
			readFileSync(filePath, "utf8"),
		) as StoredProviderSettingsLike;
		const settings = parsed.providers?.["openai-codex"]?.settings;
		return {
			accessToken:
				settings?.auth?.accessToken?.trim() || settings?.apiKey?.trim(),
			accountId: settings?.auth?.accountId?.trim(),
		};
	} catch {
		return undefined;
	}
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const payload = token.split(".")[1];
	if (!payload) {
		return undefined;
	}
	try {
		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64.padEnd(
			base64.length + ((4 - (base64.length % 4)) % 4),
			"=",
		);
		return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		return undefined;
	}
}

function deriveOpenAICodexAccountId(
	accessToken: string | undefined,
): string | undefined {
	if (!accessToken) {
		return undefined;
	}
	const payload = decodeJwtPayload(accessToken);
	const auth = readObject(payload?.["https://api.openai.com/auth"]);
	const authAccountId = auth.chatgpt_account_id;
	if (typeof authAccountId === "string" && authAccountId.length > 0) {
		return authAccountId;
	}
	return undefined;
}

function toLiveProviderConfig(settingsInput: unknown): ProviderConfig {
	const settings = readObject(settingsInput);
	const provider = settings.provider;
	if (typeof provider !== "string" || provider.trim().length === 0) {
		throw new Error("live provider entry must include a provider string");
	}

	const savedCodex =
		provider === "openai-codex" ? readSavedOpenAICodexSettings() : undefined;
	const apiKey =
		typeof settings.apiKey === "string"
			? settings.apiKey
			: (readEnvValue(settings.apiKeyEnv, "apiKeyEnv") ??
				savedCodex?.accessToken);
	const headers = readStringHeaders(settings.headers);
	const codexAccountId =
		savedCodex?.accountId || deriveOpenAICodexAccountId(apiKey);
	if (
		provider === "openai-codex" &&
		codexAccountId &&
		!headers["ChatGPT-Account-Id"]
	) {
		headers["ChatGPT-Account-Id"] = codexAccountId;
	}

	return {
		providerId: provider,
		modelId: typeof settings.model === "string" ? settings.model : "default",
		...(apiKey ? { apiKey } : {}),
		...(typeof settings.baseUrl === "string"
			? { baseUrl: settings.baseUrl }
			: {}),
		...(Object.keys(headers).length > 0 ? { headers } : {}),
	};
}

function toTarget(label: string, settingsInput: unknown): ProviderTarget {
	const config = toLiveProviderConfig(settingsInput);
	return {
		label: `${label} (${config.providerId})`,
		config,
	};
}

function loadProviderTargets(filePath: string): ProviderTarget[] {
	const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;

	if (Array.isArray(parsed)) {
		return parsed.map((entry, index) => {
			if (entry && typeof entry === "object" && "settings" in entry) {
				return toTarget(
					`index:${index}`,
					(entry as LiveProviderEntryLike).settings,
				);
			}
			return toTarget(`index:${index}`, entry);
		});
	}

	const stored = parsed as StoredProviderSettingsLike;
	return Object.entries(stored.providers ?? {}).map(
		([entryKey, entryValue]) => {
			const maybeEntry = entryValue as LiveProviderEntryLike;
			return toTarget(entryKey, maybeEntry.settings ?? entryValue);
		},
	);
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

async function runOversizedToolResultCompaction(
	target: ProviderTarget,
): Promise<void> {
	const omittedTail = "LIVE_COMPACTION_TOOL_RESULT_TAIL_MUST_NOT_SURVIVE";
	const hugeToolOutput = "x".repeat(HUGE_TOOL_OUTPUT_CHARS) + omittedTail;
	const messages = [
		{
			role: "user" as const,
			content: "Inspect the generated report and keep only what matters.",
		},
		{
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "tool-live-report",
					name: "custom_reporter",
					input: { path: "/tmp/oversized-report.txt" },
				},
			],
		},
		{
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "tool-live-report",
					content: [{ type: "text" as const, text: hugeToolOutput }],
				},
			],
		},
		{
			role: "assistant" as const,
			content: "I reviewed the report and will continue from the useful bits.",
		},
		{
			role: "user" as const,
			content: "Continue from the compacted context.",
		},
	];
	const prepareTurn = createContextCompactionPrepareTurn(
		{
			providerId: target.config.providerId,
			modelId: target.config.modelId,
			providerConfig: target.config,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
				maxInputTokens: 16_000,
			},
		},
		{ mode: "manual", manualTargetRatio: 0.1 },
	);
	if (!prepareTurn) {
		throw new Error("expected compaction prepareTurn to be configured");
	}

	const result = await prepareTurn({
		agentId: "agent-live",
		conversationId: "conv-live",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		emitStatusNotice: undefined,
		systemPrompt: "You are a concise coding assistant.",
		tools: [],
		messages,
		apiMessages: messages,
		model: {
			id: target.config.modelId,
			provider: target.config.providerId,
			info: { id: target.config.modelId, maxInputTokens: 16_000 },
		},
	});

	expect(result?.messages.length).toBeGreaterThan(0);
	expect(JSON.stringify(result?.messages)).not.toContain(omittedTail);
	expect(result?.messages[0]).toMatchObject({
		role: "user",
		metadata: expect.objectContaining({ kind: "compaction_summary" }),
	});
}

describe("live agentic compaction", () => {
	const runLive = LIVE_TEST_ENABLED ? it : it.skip;

	runLive(
		"summarizes oversized arbitrary tool results with a real provider",
		async () => {
			const targets = loadProviderTargets(requireProvidersFilePath());
			if (!targets.length) {
				throw new Error("No providers found for live compaction test.");
			}

			const failures: string[] = [];
			for (const target of targets) {
				try {
					await withTimeout(
						runOversizedToolResultCompaction(target),
						PROVIDER_TIMEOUT_MS,
						target.label,
					);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					failures.push(`${target.label}: ${message}`);
				}
			}

			if (failures.length > 0) {
				throw new Error(
					`Live compaction providers failed (${failures.length}):\n${failures.join("\n")}`,
				);
			}
		},
		300_000,
	);
});
