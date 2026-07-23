import { accessSync, constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
// Keep this import static so the VS Code extension bundle includes the SAP
// provider. Hiding it behind a computed dynamic import leaves the published
// extension trying to load @jerome-benoit/sap-ai-provider from node_modules at
// runtime, but VSIX packaging uses the bundled extension output.
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { createDifyProvider } from "dify-ai-provider";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

type SapModel = Record<PropertyKey, unknown>;
const SAP_SERVICE_KEY_METHODS = new Set<PropertyKey>([
	"doGenerate",
	"doStream",
	"doEmbed",
]);
let sapServiceKeyQueue: Promise<void> = Promise.resolve();

function readOptions(
	config: GatewayResolvedProviderConfig,
): Record<string, unknown> {
	return (config.options as Record<string, unknown> | undefined) ?? {};
}

function findExecutableOnPath(name: string): string | undefined {
	const extensions =
		process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const ext of extensions) {
			const candidate = join(dir, `${name}${ext}`);
			try {
				accessSync(candidate, fsConstants.X_OK);
				return candidate;
			} catch {
				// not here; keep looking
			}
		}
	}
	return undefined;
}

// The agent SDK spawns a `claude` executable shipped in per-platform optional
// packages (@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]). Those
// are no longer installed by default (~250MB), so resolve an explicit path:
// the bundled platform binary when present, otherwise a user-installed
// Claude Code from PATH. The SDK's own resolution cannot be relied on here:
// inside a Bun-compiled binary it anchors on the virtual bunfs, where
// node_modules lookups never see packages on disk.
function resolveClaudeExecutable(): string | undefined {
	const suffixes =
		process.platform === "linux"
			? [
					`${process.platform}-${process.arch}`,
					`${process.platform}-${process.arch}-musl`,
				]
			: [`${process.platform}-${process.arch}`];
	const executableName = process.platform === "win32" ? "claude.exe" : "claude";
	// Anchor on the real executable location first so resolution works from
	// compiled binaries; fall back to this module's location for plain node.
	const anchors = [
		join(dirname(process.execPath), "noop.js"),
		import.meta.url,
	];
	for (const anchor of anchors) {
		for (const suffix of suffixes) {
			try {
				const manifest = createRequire(anchor).resolve(
					`@anthropic-ai/claude-agent-sdk-${suffix}/package.json`,
				);
				const executable = join(dirname(manifest), executableName);
				accessSync(executable, fsConstants.X_OK);
				return executable;
			} catch {
				// keep looking
			}
		}
	}
	return findExecutableOnPath("claude");
}

export async function createClaudeCodeProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	// Dynamic import is intentional: ai-sdk-provider-claude-code is an
	// optional peer dependency so default installs skip its ~250MB
	// @anthropic-ai/claude-agent-sdk platform binary. It also runs
	// createClaudeCode() at module scope, so loading lazily contains that
	// side effect to actual Claude Code usage.
	let createClaudeCode: typeof import("ai-sdk-provider-claude-code").createClaudeCode;
	try {
		({ createClaudeCode } = await import("ai-sdk-provider-claude-code"));
	} catch (error) {
		throw new Error(
			"The Claude Code provider requires the optional 'ai-sdk-provider-claude-code' package. " +
				"Install it alongside @cline/llms to use this provider.",
			{ cause: error },
		);
	}
	const options = readOptions(config);
	const defaultSettings =
		(options.defaultSettings as Record<string, unknown> | undefined) ?? {};
	if (defaultSettings.pathToClaudeCodeExecutable === undefined) {
		const executable = resolveClaudeExecutable();
		if (executable !== undefined) {
			options.defaultSettings = {
				...defaultSettings,
				pathToClaudeCodeExecutable: executable,
			};
		}
	}
	const provider = createClaudeCode(options);
	return {
		model: (modelId) => provider(modelId),
	};
}

export async function createOpenAICodexProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	// Dynamic import is intentional: ai-sdk-provider-codex-cli is an optional
	// peer dependency so default installs skip its ~105MB @openai/codex
	// optional dependency. The provider itself degrades gracefully when the
	// bundled binary is absent (npx -y @openai/codex, then `codex` on PATH).
	let createCodexExec: typeof import("ai-sdk-provider-codex-cli").createCodexExec;
	try {
		({ createCodexExec } = await import("ai-sdk-provider-codex-cli"));
	} catch (error) {
		throw new Error(
			"The OpenAI Codex provider requires the optional 'ai-sdk-provider-codex-cli' package. " +
				"Install it alongside @cline/llms to use this provider.",
			{ cause: error },
		);
	}
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

function buildSapServiceKey(
	config: GatewayResolvedProviderConfig,
	options: Record<string, unknown>,
): string | undefined {
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
	return JSON.stringify({
		clientid: clientId,
		clientsecret: clientSecret,
		serviceurls: {
			AI_API_URL: baseUrl.replace(/\/+$/, ""),
		},
		url: normalizeSapTokenBaseUrl(tokenUrl),
	});
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

async function withSapServiceKey<T>(
	serviceKey: string | undefined,
	fn: () => T,
): Promise<Awaited<T>> {
	if (!serviceKey) {
		return await fn();
	}

	const previousQueue = sapServiceKeyQueue.catch(() => {});
	let releaseQueue!: () => void;
	sapServiceKeyQueue = new Promise<void>((resolve) => {
		releaseQueue = resolve;
	});

	await previousQueue;
	const previous = process.env.AICORE_SERVICE_KEY;
	process.env.AICORE_SERVICE_KEY = serviceKey;
	try {
		return await fn();
	} catch (error) {
		throw error;
	} finally {
		restoreSapServiceKey(previous);
		releaseQueue();
	}
}

function shouldWrapSapServiceKeyMethod(property: PropertyKey): boolean {
	return SAP_SERVICE_KEY_METHODS.has(property);
}

function restoreSapServiceKey(previous: string | undefined): void {
	if (previous === undefined) {
		delete process.env.AICORE_SERVICE_KEY;
		return;
	}
	process.env.AICORE_SERVICE_KEY = previous;
}

function wrapSapModelWithServiceKey(
	model: unknown,
	serviceKey: string | undefined,
): unknown {
	if (!serviceKey || !model || typeof model !== "object") {
		return model;
	}
	return new Proxy(model as SapModel, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (
				typeof value !== "function" ||
				!shouldWrapSapServiceKeyMethod(property)
			) {
				return value;
			}
			return (...args: unknown[]) =>
				withSapServiceKey(serviceKey, () => value.apply(target, args));
		},
	});
}

export async function createSapAiCoreProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const options = readOptions(config);
	const serviceKey = buildSapServiceKey(config, options);

	const deploymentId = readStringOption(options, "deploymentId");
	const provider = createSAPAIProvider({
		name: config.providerId,
		...(deploymentId
			? { deploymentId }
			: { resourceGroup: readStringOption(options, "resourceGroup") }),
		api: resolveSapApi(options),
		...(typeof options.defaultSettings === "object" &&
		options.defaultSettings !== null &&
		!Array.isArray(options.defaultSettings)
			? { defaultSettings: options.defaultSettings }
			: {}),
		requestConfig: {
			headers: { "ai-client-type": "Cline" },
			// Standard cline axios settings mirroring `getAxiosSettings()`
			adapter: "fetch",
			...(config.fetch ? { fetch: config.fetch } : {}),
			maxBodyLength: Number.POSITIVE_INFINITY,
			maxContentLength: Number.POSITIVE_INFINITY,
		},
	});
	return {
		model: (modelId) =>
			wrapSapModelWithServiceKey(provider(modelId), serviceKey),
	};
}
