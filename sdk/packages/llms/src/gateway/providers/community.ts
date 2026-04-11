import type { GatewayResolvedProviderConfig } from "@clinebot/shared";
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { createCodexExec } from "ai-sdk-provider-codex-cli";
import { createOpencode } from "ai-sdk-provider-opencode-sdk";
import { createDifyProvider } from "dify-ai-provider";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

function readOptions(
	config: GatewayResolvedProviderConfig,
): Record<string, unknown> {
	return (config.options as Record<string, unknown> | undefined) ?? {};
}

export async function createClaudeCodeProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const provider = createClaudeCode(readOptions(config));
	return {
		model: (modelId) => provider(modelId),
	};
}

export async function createOpenAICodexProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const provider = createCodexExec(readOptions(config));
	return {
		model: (modelId) => provider(modelId),
	};
}

// ai-sdk-provider-opencode-sdk registers process.once("SIGINT") and
// process.once("SIGTERM") handlers that call process.exit() immediately.
// Libraries must never hijack process lifecycle -- that is the host
// application's responsibility. These handlers prevent host apps (like
// Kanban) from performing graceful shutdown (e.g. persisting state,
// cleaning up worktrees) because the opencode handler fires first and
// force-exits the process.
//
// Workaround: snapshot listeners before provider creation, then remove
// any new SIGINT/SIGTERM listeners the library added.
//
// TODO: remove once ai-sdk-provider-opencode-sdk stops calling
// process.exit() from signal handlers.
function stripRogueSignalHandlers<T>(fn: () => T): T {
	const signals = ["SIGINT", "SIGTERM"] as const;
	const before = new Map(
		signals.map((sig) => [sig, new Set(process.listeners(sig))]),
	);
	const result = fn();
	for (const sig of signals) {
		for (const listener of process.listeners(sig)) {
			if (!before.get(sig)?.has(listener)) {
				process.removeListener(sig, listener);
			}
		}
	}
	return result;
}

export async function createOpenCodeProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const provider = stripRogueSignalHandlers(() =>
		createOpencode(readOptions(config)),
	);
	return {
		model: (modelId) => provider(modelId),
	};
}

export async function createDifyProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const provider = createDifyProvider({
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
		...readOptions(config),
	});
	return {
		model: (modelId) =>
			provider(modelId, {
				apiKey,
			}),
	};
}
