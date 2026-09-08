import { accessSync, existsSync, constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { DeploymentApi } from "@sap-ai-sdk/ai-api";
import { createDifyProvider } from "dify-ai-provider";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

type SapModel = Record<PropertyKey, unknown>;
const SAP_SERVICE_KEY_METHODS = new Set<PropertyKey>([
	"doGenerate",
	"doStream",
	"doEmbed",
]);
let sapServiceKeyQueue: Promise<void> = Promise.resolve();

// Set CLINE_SAP_DEBUG=1 to get the verbose per-request SAP AI Core tracing
// that used to be unconditional. Kept off by default so normal usage doesn't
// spam stdout/the output channel with client IDs, masked secrets, etc.
const SAP_DEBUG =
	process.env.CLINE_SAP_DEBUG === "1" ||
	process.env.CLINE_SAP_DEBUG?.toLowerCase() === "true";

function sapDebug(...args: unknown[]): void {
	if (SAP_DEBUG) {
		console.log("[SAP AI Core]", ...args);
	}
}

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
	const anchors = [join(dirname(process.execPath), "noop.js"), import.meta.url];
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
	const { cwd: workspaceCwd, ...options } = readOptions(config);
	const defaultSettings: Record<string, unknown> = {
		...((options.defaultSettings as Record<string, unknown> | undefined) ?? {}),
	};
	if (defaultSettings.pathToClaudeCodeExecutable === undefined) {
		const executable = resolveClaudeExecutable();
		if (executable !== undefined) {
			defaultSettings.pathToClaudeCodeExecutable = executable;
		}
	}
	// Hosts forward the workspace root as a top-level `cwd` option (e.g.
	// @cline/core's buildGatewayProviderOptions). Anchor the spawned agent
	// session there; otherwise it inherits the host process cwd (`/` in GUI
	// extension hosts) and refuses writes outside it. Guard on existence:
	// the provider hard-fails settings validation for missing directories.
	if (
		defaultSettings.cwd === undefined &&
		typeof workspaceCwd === "string" &&
		workspaceCwd.length > 0 &&
		existsSync(workspaceCwd)
	) {
		defaultSettings.cwd = workspaceCwd;
	}
	// The provider defaults settingSources to [] — the session would read
	// neither ~/.claude/settings.json nor project .claude/settings.json, so
	// user-configured permission rules silently never apply.
	if (defaultSettings.settingSources === undefined) {
		defaultSettings.settingSources = ["user", "project"];
	}
	// Cline has no interactive permission prompt wired into the CLI session
	// (no canUseTool), so anything not pre-approved is denied outright. In
	// default mode that means every file write fails. acceptEdits
	// auto-approves file edits under cwd while leaving command execution
	// gated by the user's own Claude settings (loaded via settingSources).
	if (defaultSettings.permissionMode === undefined) {
		defaultSettings.permissionMode = "acceptEdits";
	}
	const provider = createClaudeCode({ ...options, defaultSettings });
	return {
		operations: { language: (modelId) => provider(modelId) },
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
		operations: { language: (modelId) => provider(modelId) },
	};
}

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
		operations: { language: (modelId) => provider(modelId) },
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
		operations: {
			language: (modelId) =>
				provider(modelId, {
					apiKey,
				}),
		},
	};
}

/**
 * Reads a string option from the provided options object, trimming whitespace and returning undefined for empty strings.
 * @param options The options object containing the key-value pairs.
 * @param key The key of the option to read.
 * @returns The trimmed string value if present and non-empty, otherwise undefined.
 */
function readStringOption(
	options: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = options[key];
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

/**
 * Normalizes a SAP AI Core token URL by removing any trailing slashes and the "/oauth/token" suffix if present.
 * @param tokenUrl The token URL to normalize.
 * @returns The normalized token URL without trailing slashes or the "/oauth/token" suffix.
 */
function normalizeSapTokenBaseUrl(tokenUrl: string): string {
	const trimmed = tokenUrl.replace(/\/+$/, "");
	return trimmed.replace(/\/oauth\/token$/i, "");
}

/**
 * Determines whether the SAP AI Core provider has any explicit connection configuration
 * provided in the resolved provider config or options.
 * @param config The resolved provider configuration.
 * @param options The provider options containing SAP AI Core connection details.
 * @returns True if any explicit connection configuration is present, false otherwise.
 */
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

/**
 * Builds a SAP AI Core service key JSON string from the provided configuration and options.
 * @param config The resolved provider configuration.
 * @param options The provider options containing SAP AI Core connection details.
 * @returns A JSON string representing the SAP AI Core service key, or undefined if required configuration is missing.
 */
function buildSapServiceKey(
	config: GatewayResolvedProviderConfig,
	options: Record<string, unknown>,
): string | undefined {
	const clientId = readStringOption(options, "clientId");
	const clientSecret =
		readStringOption(options, "clientSecret") ?? config.apiKey?.trim();
	const tokenUrl = readStringOption(options, "tokenUrl");
	const baseUrl = config.baseUrl?.trim();

	sapDebug("Building service key options:", {
		clientId,
		clientSecret: clientSecret
			? `${clientSecret.slice(0, 5)}... [length: ${clientSecret.length}]`
			: undefined,
		tokenUrl,
		baseUrl,
		proxyEnv: {
			http_proxy: process.env.http_proxy || process.env.HTTP_PROXY,
			https_proxy: process.env.https_proxy || process.env.HTTPS_PROXY,
		},
	});

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

	let identityzone = "";
	let uaadomain = "";
	try {
		const parsedUrl = new URL(tokenUrl);
		const parts = parsedUrl.hostname.split(".");
		identityzone = parts[0];
		uaadomain = parts.slice(1).join(".");
	} catch (e) {
		console.error(
			"[SAP AI Core] Failed to parse tokenUrl for identityzone/uaadomain:",
			e,
		);
	}

	const xsappname = clientId.includes("|") ? clientId.split("|")[0] : clientId;

	const serviceKey = JSON.stringify({
		clientid: clientId,
		clientsecret: clientSecret,
		url: normalizeSapTokenBaseUrl(tokenUrl),
		identityzone,
		identityzoneid: identityzone,
		uaadomain,
		xsappname,
		tenantmode: "dedicated",
		serviceurls: {
			AI_API_URL: baseUrl.replace(/\/+$/, ""),
		},
	});
	sapDebug("Built service key JSON string (masked secret):", {
		clientid: clientId,
		url: normalizeSapTokenBaseUrl(tokenUrl),
		identityzone,
		uaadomain,
		xsappname,
		AI_API_URL: baseUrl.replace(/\/+$/, ""),
	});
	return serviceKey;
}

/**
 * Determines which SAP AI Core API to use based on the provided options.
 * @param options The provider options containing the API selection.
 * @returns The resolved API string, either "orchestration" or "foundation-models".
 */
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

/**
 * Ensures that the global fetch dispatcher is configured to route requests through
 * the HTTP(S)_PROXY environment variable if it is set. This is necessary for the
 * SAP AI Core provider to work correctly in environments with a corporate proxy.
 *
 * This function is idempotent and will only configure the dispatcher once.
 */
async function withSapServiceKey<T>(
	serviceKey: string | undefined,
	fn: () => T,
): Promise<Awaited<T>> {
	if (!serviceKey) {
		sapDebug("withSapServiceKey called without serviceKey");
		return await fn();
	}

	// The SDK reads AICORE_SERVICE_KEY internally and then makes its own
	// OAuth token request via @sap/xssec's native fetch (see
	// ensureSapProxyDispatcher for why that request needs the global undici
	// proxy dispatcher, not `config.fetch`, to reach a corporate network).
	ensureSapProxyDispatcher();

	const previousQueue = sapServiceKeyQueue.catch(() => {});
	let releaseQueue!: () => void;
	sapServiceKeyQueue = new Promise<void>((resolve) => {
		releaseQueue = resolve;
	});

	await previousQueue;
	const previous = process.env.AICORE_SERVICE_KEY;

	process.env.AICORE_SERVICE_KEY = serviceKey;

	sapDebug("entering withSapServiceKey");
	try {
		const result = await fn();
		sapDebug("withSapServiceKey call succeeded");
		return result;
	} catch (error: any) {
		console.error(
			`[SAP AI Core] withSapServiceKey call failed: ` +
				`Message: ${error?.message || error}, ` +
				`Code: ${error?.code}, ` +
				`Cause: ${error?.cause?.message || error?.cause || (error?.cause && JSON.stringify(error.cause))}` +
				(SAP_DEBUG ? `, Stack: ${error?.stack}` : ""),
		);
		throw error;
	} finally {
		restoreSapServiceKey(previous);
		releaseQueue();
	}
}

/**
 * Determines whether a given property key corresponds to a method of the SAP AI Core model that requires the AICORE_SERVICE_KEY environment variable to be set.
 * @param property The property key to check.
 * @returns True if the property is a method that requires the service key, false otherwise.
 */
function shouldWrapSapServiceKeyMethod(property: PropertyKey): boolean {
	return SAP_SERVICE_KEY_METHODS.has(property);
}

/**
 * Restores the AICORE_SERVICE_KEY environment variable to its previous value.
 * If the previous value was undefined, the environment variable is deleted.
 * @param previous The previous value of the AICORE_SERVICE_KEY environment variable.
 */
function restoreSapServiceKey(previous: string | undefined): void {
	if (previous === undefined) {
		delete process.env.AICORE_SERVICE_KEY;
		return;
	}
	process.env.AICORE_SERVICE_KEY = previous;
}

/**
 * Wraps a SAP AI Core model instance with a proxy that sets the AICORE_SERVICE_KEY
 * environment variable for each method call that requires it. This ensures that
 * concurrent requests with different service keys do not interfere with each other.
 * @param model The SAP AI Core model instance to wrap.
 * @param serviceKey The service key to set in the AICORE_SERVICE_KEY environment variable.
 * @returns A proxied SAP AI Core model instance that sets the service key for relevant method calls.
 */
function wrapSapModelWithServiceKey(
	model: unknown,
	serviceKey: string | undefined,
	ensureValidToken?: () => Promise<void>,
): unknown {
	if (
		!model ||
		typeof model !== "object" ||
		(!serviceKey && !ensureValidToken)
	) {
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
			return (...args: unknown[]) => {
				const executeCall = () => value.apply(target, args);
				const runWithServiceKey = () =>
					withSapServiceKey(serviceKey, executeCall);

				if (ensureValidToken) {
					return ensureValidToken().then(runWithServiceKey);
				}
				return runWithServiceKey();
			};
		},
	});
}

/**
 * Fetches the orchestration deployment ID from the SAP AI Core API.
 * @param clientId The client ID for OAuth2 client credentials.
 * @param clientSecret The client secret for OAuth2 client credentials.
 * @param tokenUrl The token URL for OAuth2 client credentials.
 * @param baseUrl The base URL of the SAP AI Core API.
 * @param resourceGroup The resource group to query for deployments.
 * @returns A promise that resolves to the orchestration deployment ID, or undefined if not found.
 */
async function getOrchestrationDeploymentIdFromApi(
	clientId: string,
	clientSecret: string,
	tokenUrl: string,
	baseUrl: string,
	resourceGroup: string,
): Promise<string | undefined> {
	let cleanedBaseUrl = baseUrl.replace(/\/+$/, "");
	if (cleanedBaseUrl.endsWith("/v2")) {
		cleanedBaseUrl = cleanedBaseUrl.slice(0, -3).replace(/\/+$/, "");
	}

	// 1. Fetch access token manually to bypass destination service
	const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
	const oauthUrl = tokenUrl.endsWith("/oauth/token")
		? tokenUrl
		: `${tokenUrl.replace(/\/+$/, "")}/oauth/token`;

	const tokenResponse = await fetch(oauthUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: authHeader,
		},
		body: "grant_type=client_credentials",
	});

	if (!tokenResponse.ok) {
		const errorText = await tokenResponse.text().catch(() => "");
		throw new Error(
			`Failed to fetch access token from SAP AI Core auth URL: status ${tokenResponse.status} ${tokenResponse.statusText}. Details: ${errorText}`,
		);
	}

	const tokenData = (await tokenResponse.json()) as { access_token: string };
	const accessToken = tokenData.access_token;

	if (!accessToken) {
		throw new Error("Access token is missing from token response");
	}

	// 2. Build the manual destination with pre-populated authTokens
	const destination = {
		url: cleanedBaseUrl,
		authentication: "OAuth2ClientCredentials" as const,
		authTokens: [
			{
				type: "Bearer",
				value: accessToken,
				error: null,
				expiresIn: "3600",
				http_header: {
					key: "Authorization",
					value: `Bearer ${accessToken}`,
				},
			},
		],
	};

	const response = await DeploymentApi.deploymentQuery(
		{},
		{
			"AI-Resource-Group": resourceGroup || "default",
		},
	).execute(destination);

	const resources = response.resources || [];
	const runningOrchestration = resources.find(
		(d: any) =>
			d.targetStatus === "RUNNING" && d.scenarioId === "orchestration",
	);
	return runningOrchestration?.id;
}

let sapProxyDispatcherConfigured = false;

/**
 * Ensures that the global fetch dispatcher is configured to route requests through
 * the HTTP(S)_PROXY environment variable if it is set. This is necessary for the
 * SAP AI Core provider to work correctly in environments with a corporate proxy.
 *
 * This function is idempotent and will only configure the dispatcher once.
 * @returns
 */
function ensureSapProxyDispatcher(): void {
	if (sapProxyDispatcherConfigured) {
		return;
	}
	sapProxyDispatcherConfigured = true;

	const hasProxyEnv = Boolean(
		process.env.HTTPS_PROXY ||
			process.env.https_proxy ||
			process.env.HTTP_PROXY ||
			process.env.http_proxy,
	);
	if (!hasProxyEnv) {
		sapDebug(
			"No HTTP(S)_PROXY env var set; leaving Node's default (unproxied) fetch dispatcher in place",
		);
		return;
	}

	try {
		setGlobalDispatcher(new EnvHttpProxyAgent());
		sapDebug(
			"Configured global fetch dispatcher to route native fetch (including @sap/xssec's OAuth token request) through HTTP(S)_PROXY",
		);
	} catch (e: any) {
		console.error(
			"[SAP AI Core] Failed to configure proxy-aware global fetch dispatcher:",
			e?.message || e,
		);
	}
}

/**
 * Creates a SAP AI Core provider module that can be used with the Cline SDK.
 * @param config The resolved provider configuration.
 * @returns A promise that resolves to a ProviderFactoryResult containing the operations for the SAP AI Core provider.
 */
export async function createSapAiCoreProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	// Must run before anything below triggers the SDK's internal OAuth
	// token exchange (see ensureSapProxyDispatcher for why).
	ensureSapProxyDispatcher();

	const options = readOptions(config);
	const serviceKey = buildSapServiceKey(config, options);

	let deploymentId = readStringOption(options, "deploymentId");
	const resourceGroup = readStringOption(options, "resourceGroup");
	const api = resolveSapApi(options);

	const clientId = readStringOption(options, "clientId");
	const clientSecret =
		readStringOption(options, "clientSecret") ?? config.apiKey?.trim();
	const tokenUrl = readStringOption(options, "tokenUrl");
	const baseUrl = config.baseUrl?.trim();

	let ensureValidToken: (() => Promise<void>) | undefined;
	let destination: any;

	if (clientId && clientSecret && tokenUrl && baseUrl) {
		let cleanedBaseUrl = baseUrl.replace(/\/+$/, "");
		if (cleanedBaseUrl.endsWith("/v2")) {
			cleanedBaseUrl = cleanedBaseUrl.slice(0, -3).replace(/\/+$/, "");
		}

		destination = {
			url: cleanedBaseUrl,
			authentication: "OAuth2ClientCredentials" as const,
			authTokens: [
				{
					type: "Bearer",
					value: "",
					error: null,
					expiresIn: "3600",
					http_header: {
						key: "Authorization",
						value: "",
					},
				},
			],
		};

		let cachedToken: string | undefined;
		let tokenExpiryTime = 0;

		ensureValidToken = async () => {
			if (cachedToken && Date.now() < tokenExpiryTime - 5 * 60 * 1000) {
				return;
			}

			sapDebug("Fetching fresh access token from SAP AI Core auth URL...");
			const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
			const oauthUrl = tokenUrl.endsWith("/oauth/token")
				? tokenUrl
				: `${tokenUrl.replace(/\/+$/, "")}/oauth/token`;

			const tokenResponse = await fetch(oauthUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: authHeader,
				},
				body: "grant_type=client_credentials",
			});

			if (!tokenResponse.ok) {
				const errorText = await tokenResponse.text().catch(() => "");
				throw new Error(
					`Failed to fetch access token from SAP AI Core auth URL: status ${tokenResponse.status} ${tokenResponse.statusText}. Details: ${errorText}`,
				);
			}

			const tokenData = (await tokenResponse.json()) as {
				access_token: string;
				expires_in?: number;
			};
			const accessToken = tokenData.access_token;

			if (!accessToken) {
				throw new Error("Access token is missing from token response");
			}

			cachedToken = accessToken;
			const expiresIn = tokenData.expires_in ?? 3600;
			tokenExpiryTime = Date.now() + expiresIn * 1000;

			sapDebug("Successfully retrieved and cached new access token");

			destination.authTokens[0].value = accessToken;
			destination.authTokens[0].http_header.value = `Bearer ${accessToken}`;
		};

		// Fetch the first token eagerly
		try {
			await ensureValidToken();
		} catch (e: any) {
			console.error("[SAP AI Core] Eager token fetch failed:", e?.message || e);
		}
	}

	if (!deploymentId && api === "orchestration") {
		if (clientId && clientSecret && tokenUrl && baseUrl) {
			try {
				sapDebug("Auto-discovering orchestration deployment ID...");
				deploymentId = await getOrchestrationDeploymentIdFromApi(
					clientId,
					clientSecret,
					tokenUrl,
					baseUrl,
					resourceGroup || "default",
				);
				sapDebug("Discovered orchestration deployment ID:", deploymentId);
			} catch (e: any) {
				console.error(
					"[SAP AI Core] Orchestration deployment auto-discovery failed:",
					e?.message || e,
				);
			}
		}
	}

	// The SAP AI Core provider SDK reads the service key from the AICORE_SERVICE_KEY environment variable.
	// Wrap the provider with a proxy that sets this variable for each request, so multiple concurrent requests with different service keys don't interfere with each other.
	const provider = createSAPAIProvider({
		name: config.providerId,
		...(destination ? { destination } : {}),
		...(deploymentId ? { deploymentId } : {}),
		...(resourceGroup ? { resourceGroup } : {}),
		api,
		...(typeof options.defaultSettings === "object" &&
		options.defaultSettings !== null &&
		!Array.isArray(options.defaultSettings)
			? { defaultSettings: options.defaultSettings }
			: {}),
		requestConfig: {
			headers: { "ai-client-type": "Cline" },
			// Standard cline axios settings mirroring `getAxiosSettings()`
			adapter: "fetch",
			...(config.fetch
				? { fetch: config.fetch, env: { fetch: config.fetch } }
				: {}),
			maxBodyLength: Number.POSITIVE_INFINITY,
			maxContentLength: Number.POSITIVE_INFINITY,
		},
	});
	return {
		operations: {
			language: (modelId) =>
				wrapSapModelWithServiceKey(
					provider(modelId),
					serviceKey,
					ensureValidToken,
				),
		},
	};
}
