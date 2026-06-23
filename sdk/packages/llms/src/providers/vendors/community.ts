import type { GatewayResolvedProviderConfig } from "@cline/shared";
import type { SAPAIProviderSettings } from "@jerome-benoit/sap-ai-provider";
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { createCodexExec } from "ai-sdk-provider-codex-cli";
import { createDifyProvider } from "dify-ai-provider";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

type SapAiProviderModule = typeof import("@jerome-benoit/sap-ai-provider");
type SapDestination = NonNullable<SAPAIProviderSettings["destination"]>;
const SAP_AI_PROVIDER_PACKAGE = "@jerome-benoit/sap-ai-provider";

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
async function stripRogueSignalHandlers<T>(fn: () => Promise<T>): Promise<T> {
	const signals = ["SIGINT", "SIGTERM"] as const;
	const before = new Map(
		signals.map((sig) => [sig, new Set(process.listeners(sig))]),
	);
	const result = await fn();
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
	// Dynamic import is intentional: ai-sdk-provider-opencode-sdk runs
	// `var opencode = createOpencode()` at module scope, which registers
	// process.once("SIGINT") / process.once("SIGTERM") handlers that call
	// process.exit(0). Importing it inside stripRogueSignalHandlers ensures
	// both the module side effect and the explicit createOpencode() call are
	// captured, so the rogue handlers get removed.
	// TODO: switch back to a static import once the upstream package stops
	// calling process.exit() from signal handlers.
	const provider = await stripRogueSignalHandlers(async () => {
		const { createOpencode } = await import("ai-sdk-provider-opencode-sdk");
		return createOpencode(readOptions(config));
	});
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

function readStringOption(
	options: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = options[key];
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function normalizeSapTokenBaseUrl(tokenUrl: string): string {
	const trimmed = tokenUrl.replace(/\/+$/, "");
	return trimmed.replace(/\/oauth\/token$/i, "");
}

function hasExplicitSapConnectionConfig(
	config: GatewayResolvedProviderConfig,
	options: Record<string, unknown>,
): boolean {
	return Boolean(
		config.apiKey?.trim() ||
			config.baseUrl?.trim() ||
			readStringOption(options, "clientId") ||
			readStringOption(options, "clientSecret") ||
			readStringOption(options, "tokenUrl"),
	);
}

function buildSapDestination(
	config: GatewayResolvedProviderConfig,
	options: Record<string, unknown>,
): SapDestination | undefined {
	const clientId = readStringOption(options, "clientId");
	const clientSecret =
		readStringOption(options, "clientSecret") ?? config.apiKey?.trim();
	const tokenUrl = readStringOption(options, "tokenUrl");
	const baseUrl = config.baseUrl?.trim();
	if (!clientId || !clientSecret || !tokenUrl || !baseUrl) {
		if (!hasExplicitSapConnectionConfig(config, options)) {
			return undefined;
		}
		const missing = [
			!clientId ? "sap.clientId" : undefined,
			!clientSecret ? "sap.clientSecret" : undefined,
			!tokenUrl ? "sap.tokenUrl" : undefined,
			!baseUrl ? "baseUrl" : undefined,
		].filter(Boolean);
		throw new Error(
			`SAP AI Core provider is missing required configuration: ${missing.join(
				", ",
			)}.`,
		);
	}
	// SAP Cloud SDK accepts service-binding fetch options at runtime
	// (`isDestinationFetchOptions()` checks for `service`), but its exported
	// XOR type makes the `service` branch unrepresentable by also requiring
	// `destinationName`. Keep the cast at this dependency boundary.
	return {
		service: {
			credentials: {
				clientid: clientId,
				clientsecret: clientSecret,
				serviceurls: {
					AI_API_URL: baseUrl.replace(/\/+$/, ""),
				},
				url: normalizeSapTokenBaseUrl(tokenUrl),
			},
			label: "aicore",
			name: config.providerId,
			tags: ["aicore"],
		},
	} as unknown as SapDestination;
}

function resolveSapApi(options: Record<string, unknown>) {
	const api = options.api;
	if (api === "orchestration" || api === "foundation-models") {
		return api;
	}
	if (options.useOrchestrationMode === false) {
		return "foundation-models";
	}
	return "orchestration";
}

async function importSapAiProvider(): Promise<SapAiProviderModule> {
	const specifier: string = SAP_AI_PROVIDER_PACKAGE;
	return import(specifier) as Promise<SapAiProviderModule>;
}

export async function createSapAiCoreProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const options = readOptions(config);
	const destination = buildSapDestination(config, options);

	const { createSAPAIProvider } = await importSapAiProvider();
	const deploymentId = readStringOption(options, "deploymentId");
	const provider = createSAPAIProvider({
		name: config.providerId,
		...(deploymentId
			? { deploymentId }
			: { resourceGroup: readStringOption(options, "resourceGroup") }),
		api: resolveSapApi(options),
		...(destination ? { destination } : {}),
		...(typeof options.defaultSettings === "object" &&
		options.defaultSettings !== null &&
		!Array.isArray(options.defaultSettings)
			? { defaultSettings: options.defaultSettings }
			: {}),
	});
	return {
		model: (modelId) => provider(modelId),
	};
}
