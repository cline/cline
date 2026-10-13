import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AgentExtension, AgentTool, BasicLogger } from "@cline/shared";
import {
	createTool,
	FeatureFlag,
	getClineEnvironmentConfig,
} from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "../../runtime/orchestration/runtime-oauth-token-manager";
import { isClineAccountFeatureEnabled } from "../../services/feature-flags/cline-account-feature-flags";
import { resolveLocalClineAuthToken } from "../../services/providers/local-provider-service";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import {
	type ConnectorsRequest,
	createComposioMetaToolSession,
	executeComposioMetaTool,
} from "./composio-meta-tools";

/**
 * Registers Composio's search/connect/execute meta tools in host sessions.
 * App schemas are discovered through search results and executed through
 * multi-execute; saved desktop connection state never supplies model tools.
 * Local executions recheck account identity and beta access. Hosts supplying
 * a request callback own authentication without accessing local credentials.
 * The Cline API proxy scopes the tool-router session to the caller.
 */
const COMPOSIO_TOOL_TIMEOUT_MS = 120_000;

export function resolveComposioConnectionStatePath(accountId: string): string {
	const key = createHash("sha256").update(accountId).digest("hex");
	return join(resolveClineDataDir(), "settings", "composio", `${key}.json`);
}

function getAccountId(): string | undefined {
	return (
		new ProviderSettingsManager()
			.getProviderSettings("cline")
			?.auth?.accountId?.trim() || undefined
	);
}

/**
 * Resolves the Cline account bearer token and API base URL for the proxy.
 * Uses the refresh-aware OAuth manager (tokens expire between launches) and
 * falls back to the persisted token on transient failures. Managers coordinate
 * single-use refresh tokens through a lock shared across processes.
 */
let sharedTokenManager: RuntimeOAuthTokenManager | undefined;

async function resolveConnectorsAuth(
	accountId: string,
): Promise<{ baseUrl: string; token: string } | undefined> {
	const manager = new ProviderSettingsManager();
	let token: string | undefined;
	try {
		sharedTokenManager ??= new RuntimeOAuthTokenManager();
		const resolution = await sharedTokenManager.resolveProviderApiKey({
			providerId: "cline",
		});
		token = resolution?.apiKey ?? undefined;
	} catch (error) {
		if (error instanceof OAuthReauthRequiredError) return undefined;
		// Fall back to the persisted token below.
	}
	token ??= resolveLocalClineAuthToken(manager.getProviderSettings("cline"));
	if (!token || getAccountId() !== accountId) {
		return undefined;
	}
	const settings = manager.getProviderSettings("cline");
	const baseUrl = (
		settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl
	).replace(/\/+$/, "");
	return { baseUrl, token };
}

/**
 * Rechecks account identity and beta access before any connector execution,
 * returning the proxy auth or the structured error to hand back to the agent.
 */
async function authorizeExecution(
	accountId: string,
): Promise<
	| { auth: { baseUrl: string; token: string } }
	| { error: { successful: false; error: string } }
> {
	if (getAccountId() !== accountId) {
		return {
			error: {
				successful: false,
				error:
					"The Cline account changed. Start a new session to use connector tools.",
			},
		};
	}
	if (!(await isClineAccountFeatureEnabled(FeatureFlag.CLINE_COMPOSIO_BETA))) {
		return {
			error: {
				successful: false,
				error: "Composio connectors are not enabled for this account.",
			},
		};
	}
	const auth = await resolveConnectorsAuth(accountId);
	if (!auth) {
		return {
			error: {
				successful: false,
				error:
					"Sign in to your Cline account to use connector tools (no account token available).",
			},
		};
	}
	return { auth };
}

function authenticatedRequest(auth: {
	baseUrl: string;
	token: string;
}): ConnectorsRequest {
	return (path, init) => {
		const headers = new Headers(init.headers);
		headers.set("authorization", `Bearer ${auth.token}`);
		return fetch(`${auth.baseUrl}${path}`, { ...init, headers });
	};
}

/** Builds the meta-tool extension independently of saved connections. */
export async function createComposioToolsExtension(options?: {
	request?: ConnectorsRequest;
	logger?: BasicLogger;
}): Promise<AgentExtension | undefined> {
	const hostRequest = options?.request;
	const accountId = hostRequest ? undefined : getAccountId();
	let request: ConnectorsRequest;
	let resolveExecutionRequest: () => Promise<
		| { request: ConnectorsRequest }
		| { error: { successful: false; error: string } }
	>;
	if (hostRequest) {
		request = hostRequest;
		resolveExecutionRequest = async () => ({ request: hostRequest });
	} else {
		if (!accountId) return undefined;
		if (
			!(await isClineAccountFeatureEnabled(FeatureFlag.CLINE_COMPOSIO_BETA))
		) {
			return undefined;
		}
		if (getAccountId() !== accountId) return undefined;
		const auth = await resolveConnectorsAuth(accountId);
		if (!auth) return undefined;
		request = authenticatedRequest(auth);
		resolveExecutionRequest = async () => {
			const authorized = await authorizeExecution(accountId);
			if ("error" in authorized) return authorized;
			return { request: authenticatedRequest(authorized.auth) };
		};
	}
	const metaSession = await createComposioMetaToolSession(request, {
		log: (message) => options?.logger?.log?.(message),
	});
	if (!metaSession?.tools.length) {
		return undefined;
	}
	// Validate the entire flow before registering anything: a rejected search
	// or execution schema must not leave the other meta tools exposed alone.
	let tools: AgentTool[];
	try {
		tools = metaSession.tools.map((tool) =>
			createTool({
				name: tool.slug.toLowerCase(),
				resultPolicy: "cache-oversized",
				description: tool.description || tool.name || tool.slug,
				inputSchema: (tool.input_parameters ?? {
					type: "object",
					properties: {},
				}) as never,
				timeoutMs: COMPOSIO_TOOL_TIMEOUT_MS,
				// Multi-execute runs app tools with side effects; never auto-retry.
				retryable: false,
				execute: async (input: unknown) => {
					const authorized = await resolveExecutionRequest();
					if ("error" in authorized) return authorized.error;
					return executeComposioMetaTool(
						authorized.request,
						metaSession.sessionId,
						tool.slug,
						input,
					);
				},
			}),
		);
	} catch (error) {
		options?.logger?.log?.(
			`composio-tools: invalid meta-tool schemas: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
	return {
		name: "composio-tools",
		manifest: { capabilities: ["tools"] },
		setup(api) {
			if (!hostRequest && getAccountId() !== accountId) return;
			for (const tool of tools) api.registerTool(tool);
			options?.logger?.log?.(
				`composio-tools: registered ${tools.length} meta tool(s) for this session`,
			);
		},
	};
}
