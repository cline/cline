import { randomUUID } from "node:crypto";
import type {
	OAuthClientProvider,
	OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	SSEClientTransport,
	SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	type OAuthServerCloseInfo,
	type OAuthServerListeningInfo,
	startLocalOAuthServer,
} from "../../auth/server";
import {
	getMcpServerOAuthState,
	McpOAuthClientChangedError,
	McpOAuthTransportChangedError,
	normalizeMcpServerOAuthState,
	resolveDefaultMcpSettingsPath,
	updateMcpServerOAuthStateAsync,
} from "./config-loader";
import { createMcpOAuthClientPolicyBinding } from "./oauth-client-policy-binding";
import {
	areMcpOAuthScopePoliciesEqual,
	assertMcpOAuthScopesAllowed,
	createMcpOAuthScopePolicyFetch,
	normalizeMcpOAuthAllowedScopes,
} from "./oauth-scope-policy";
import {
	createMcpOAuthTransportBinding,
	isMcpOAuthTransportBinding,
} from "./oauth-transport-binding";
import { augmentMcpTimeoutError, resolveMcpRequestTimeoutMs } from "./timeout";
import type {
	McpOAuthLoopbackHostname,
	McpServerOAuthClientConfig,
	McpServerOAuthState,
	McpServerRegistration,
} from "./types";

const DEFAULT_MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
const DEFAULT_MCP_OAUTH_CALLBACK_PORT = 1456;
const DEFAULT_MCP_OAUTH_CALLBACK_PORTS = [
	DEFAULT_MCP_OAUTH_CALLBACK_PORT,
	1457,
	1458,
];
const DEFAULT_MCP_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export const DEFAULT_MCP_OAUTH_LOOPBACK_HOSTNAME = "127.0.0.1" as const;

export function resolveMcpOAuthLoopbackHostname(
	value: McpOAuthLoopbackHostname | undefined,
): McpOAuthLoopbackHostname {
	return value ?? DEFAULT_MCP_OAUTH_LOOPBACK_HOSTNAME;
}

export function buildMcpOAuthCallbackUrl(
	hostname: McpOAuthLoopbackHostname,
	port = DEFAULT_MCP_OAUTH_CALLBACK_PORT,
	path = DEFAULT_MCP_OAUTH_CALLBACK_PATH,
): string {
	return `http://${hostname}:${port}${path}`;
}

export type McpSdkAuthCapableTransport =
	| SSEClientTransport
	| StreamableHTTPClientTransport;

export interface CreateMcpOAuthProviderContextOptions {
	settingsPath?: string;
	serverName: string;
	redirectUrl: string;
	onAuthorizationUrl?: (url: string) => void | Promise<void>;
	clientInformation?: OAuthClientInformationMixed;
	allowedScopes?: readonly string[];
	loopbackHostname?: McpOAuthLoopbackHostname;
	/**
	 * Set false only for a legacy dynamic flow whose callbackHost is not one of
	 * the supported persisted loopback identities. Its exact redirect URL still
	 * binds the dynamically registered client without mislabeling the host.
	 */
	persistLoopbackHostname?: boolean;
	/** SHA-256 binding for the remote transport allowed to reuse OAuth state. */
	transportBinding: string;
}

export interface McpOAuthProviderContext {
	provider: OAuthClientProvider;
	getLastAuthorizationUrl(): string | undefined;
	getLastOAuthState(): string | undefined;
	resetInteractiveState(): Promise<void>;
	markError(errorMessage: string): Promise<void>;
	markConnectionError(errorMessage: string): Promise<void>;
	markAuthorizationRequired(errorMessage: string): Promise<void>;
	clearError(): Promise<void>;
}

export interface AuthorizeMcpServerOAuthOptions {
	serverName: string;
	filePath?: string;
	clientName?: string;
	clientVersion?: string;
	fetch?: FetchLike;
	openUrl?: (url: string) => void | Promise<void>;
	callbackHost?: string;
	callbackPorts?: number[];
	callbackPath?: string;
	timeoutMs?: number;
	successHtml?: string;
	onServerListening?: (info: OAuthServerListeningInfo) => void | Promise<void>;
	onServerClose?: (info: OAuthServerCloseInfo) => void | Promise<void>;
	signal?: AbortSignal;
}

export interface AuthorizeMcpServerOAuthResult {
	serverName: string;
	authorized: true;
	message: string;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	return String(error);
}

function createOAuthClientMetadata(
	redirectUrl: string,
	allowedScopes: readonly string[] | undefined,
): OAuthClientMetadata {
	return {
		client_name: "Cline",
		redirect_uris: [redirectUrl],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
		...(allowedScopes ? { scope: allowedScopes.join(" ") } : {}),
	};
}

export function createMcpOAuthClientInformation(
	config: McpServerOAuthClientConfig | undefined,
): OAuthClientInformationMixed | undefined {
	return config
		? {
				client_id: config.clientId,
				...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
			}
		: undefined;
}

function isSameOAuthClient(
	left: OAuthClientInformationMixed | undefined,
	right: OAuthClientInformationMixed | undefined,
): boolean {
	return (
		left?.client_id === right?.client_id &&
		left?.client_secret === right?.client_secret
	);
}

function assertOAuthClientUnchanged(
	serverName: string,
	current: McpServerOAuthState,
	expected: OAuthClientInformationMixed | undefined,
): void {
	if (
		!isSameOAuthClient(
			current.clientInformation as OAuthClientInformationMixed | undefined,
			expected,
		)
	) {
		throw new McpOAuthClientChangedError(serverName);
	}
}

export function createMcpOAuthProviderContext(
	options: CreateMcpOAuthProviderContextOptions,
): McpOAuthProviderContext {
	if (!isMcpOAuthTransportBinding(options.transportBinding)) {
		throw new Error("MCP OAuth transport binding must be a SHA-256 digest.");
	}
	const transportBinding = options.transportBinding;
	const allowedScopes = normalizeMcpOAuthAllowedScopes(options.allowedScopes);
	const hasConfiguredLoopbackHostname = options.loopbackHostname !== undefined;
	const persistLoopbackHostname = options.persistLoopbackHostname !== false;
	const loopbackHostname = resolveMcpOAuthLoopbackHostname(
		options.loopbackHostname,
	);
	const expectedOAuthClient: McpServerOAuthClientConfig | null =
		options.clientInformation
			? {
					clientId: options.clientInformation.client_id,
					...(options.clientInformation.client_secret
						? { clientSecret: options.clientInformation.client_secret }
						: {}),
					...(allowedScopes ? { allowedScopes } : {}),
					...(loopbackHostname !== DEFAULT_MCP_OAUTH_LOOPBACK_HOSTNAME
						? { loopbackHostname }
						: {}),
				}
			: null;
	const clientPolicyBinding = createMcpOAuthClientPolicyBinding(
		expectedOAuthClient ?? undefined,
	);
	let state: McpServerOAuthState = {};
	let refreshFromSettings = true;
	const refreshState = (): void => {
		if (!refreshFromSettings) {
			return;
		}
		try {
			state =
				getMcpServerOAuthState(options.serverName, {
					filePath: options.settingsPath,
				}) ?? {};
		} catch {
			state = {};
		}
	};
	refreshState();
	let lastAuthorizationUrl: string | undefined;
	let lastOAuthState: string | undefined;
	const stateMatchesTransport = () =>
		state.transportBinding === transportBinding;
	const stateMatchesClientPolicy = () =>
		state.clientPolicyBinding === clientPolicyBinding;
	const stateMatchesScopePolicy = () =>
		areMcpOAuthScopePoliciesEqual(allowedScopes, state.scopePolicy);
	const stateMatchesLoopbackHostname = () => {
		if (!persistLoopbackHostname) {
			return state.loopbackHostname === undefined;
		}
		// A dynamically registered client has no registration-level hostname to
		// compare on a later passive connection. Its persisted, transport-bound
		// callback identity remains authoritative. Interactive flows supply the
		// actual supported callback hostname and therefore still compare exactly.
		if (!options.clientInformation && !hasConfiguredLoopbackHostname) {
			return (
				state.loopbackHostname === undefined ||
				state.loopbackHostname === DEFAULT_MCP_OAUTH_LOOPBACK_HOSTNAME ||
				state.loopbackHostname === "localhost"
			);
		}
		return state.loopbackHostname === undefined
			? loopbackHostname === DEFAULT_MCP_OAUTH_LOOPBACK_HOSTNAME
			: state.loopbackHostname === loopbackHostname;
	};
	const stateMatchesConfiguredClient = () =>
		options.clientInformation === undefined ||
		isSameOAuthClient(
			state.clientInformation as OAuthClientInformationMixed | undefined,
			options.clientInformation,
		);
	const stateMatchesProviderConfiguration = () =>
		stateMatchesTransport() &&
		stateMatchesClientPolicy() &&
		stateMatchesScopePolicy() &&
		stateMatchesLoopbackHostname() &&
		stateMatchesConfiguredClient();
	let expectedClientInformation = stateMatchesProviderConfiguration()
		? (state.clientInformation as OAuthClientInformationMixed | undefined)
		: undefined;
	const currentClientInformationFromState = () =>
		options.clientInformation ??
		(stateMatchesProviderConfiguration()
			? (state.clientInformation as OAuthClientInformationMixed | undefined)
			: undefined);
	const currentClientInformation = () => {
		refreshState();
		const clientInformation = currentClientInformationFromState();
		expectedClientInformation = clientInformation;
		return clientInformation;
	};
	const patch = async (
		updater: (current: McpServerOAuthState) => McpServerOAuthState,
	): Promise<void> => {
		try {
			state = await updateMcpServerOAuthStateAsync(
				options.serverName,
				updater,
				{
					filePath: options.settingsPath,
					expectedOAuthClient,
					expectedTransportBinding: transportBinding,
				},
			);
		} catch (error) {
			if (
				options.settingsPath ||
				error instanceof McpOAuthClientChangedError ||
				error instanceof McpOAuthTransportChangedError
			) {
				throw error;
			}
			// Programmatically supplied registrations may not have a settings file.
			// They still need a functional in-memory provider context.
			refreshFromSettings = false;
			const current =
				stateMatchesTransport() && stateMatchesClientPolicy()
					? state
					: { transportBinding, clientPolicyBinding };
			state =
				normalizeMcpServerOAuthState({
					...updater(current),
					transportBinding,
					clientPolicyBinding,
				}) ?? {};
		}
	};

	const provider: OAuthClientProvider = {
		get redirectUrl() {
			refreshState();
			return (
				(stateMatchesProviderConfiguration() ? state.redirectUrl : undefined) ??
				options.redirectUrl
			);
		},
		get clientMetadata() {
			refreshState();
			return createOAuthClientMetadata(
				(stateMatchesProviderConfiguration() ? state.redirectUrl : undefined) ??
					options.redirectUrl,
				allowedScopes,
			);
		},
		state: () => {
			lastOAuthState = randomUUID();
			return lastOAuthState;
		},
		clientInformation: currentClientInformation,
		saveClientInformation: async (clientInformation) => {
			await patch((current) => {
				assertOAuthClientUnchanged(
					options.serverName,
					current,
					expectedClientInformation,
				);
				const clientChanged = !isSameOAuthClient(
					current.clientInformation as OAuthClientInformationMixed | undefined,
					clientInformation,
				);
				return {
					...current,
					clientInformation: clientInformation as Record<string, unknown>,
					...(clientChanged
						? {
								tokens: undefined,
								scopePolicy: undefined,
								lastAuthenticatedAt: undefined,
							}
						: {}),
					redirectUrl: options.redirectUrl,
					loopbackHostname: persistLoopbackHostname
						? loopbackHostname
						: undefined,
					lastError: undefined,
				};
			});
			expectedClientInformation = clientInformation;
		},
		tokens: () => {
			refreshState();
			const tokens = state.tokens as OAuthTokens | undefined;
			const clientInformation = currentClientInformationFromState();
			if (
				!stateMatchesProviderConfiguration() ||
				!clientInformation?.client_id ||
				!isSameOAuthClient(
					state.clientInformation as OAuthClientInformationMixed | undefined,
					clientInformation,
				)
			) {
				return undefined;
			}
			assertMcpOAuthScopesAllowed(
				tokens?.scope,
				allowedScopes,
				"persisted token",
			);
			expectedClientInformation = clientInformation;
			return tokens;
		},
		saveTokens: async (tokens) => {
			assertMcpOAuthScopesAllowed(
				tokens.scope,
				allowedScopes,
				"token response",
			);
			const lastAuthenticatedAt = Date.now();
			const clientInformation =
				options.clientInformation ?? expectedClientInformation;
			if (!clientInformation?.client_id) {
				throw new Error("Cannot save MCP OAuth tokens without a client ID.");
			}
			await patch((current) => {
				// A pre-registered client is already bound by the guarded oauthClient
				// setting, so its first token write may establish clientInformation.
				// Dynamically registered clients must already be persisted and match.
				if (current.clientInformation || !options.clientInformation) {
					assertOAuthClientUnchanged(
						options.serverName,
						current,
						clientInformation,
					);
				}
				return {
					...current,
					tokens: tokens as Record<string, unknown>,
					scopePolicy: allowedScopes ? [...allowedScopes] : undefined,
					clientInformation: clientInformation as Record<string, unknown>,
					redirectUrl: options.redirectUrl,
					loopbackHostname: persistLoopbackHostname
						? loopbackHostname
						: undefined,
					lastError: undefined,
					lastAuthenticatedAt,
				};
			});
		},
		redirectToAuthorization: async (authorizationUrl) => {
			lastAuthorizationUrl = authorizationUrl.toString();
			await options.onAuthorizationUrl?.(lastAuthorizationUrl);
		},
		saveCodeVerifier: async (codeVerifier) => {
			const clientInformation =
				options.clientInformation ?? expectedClientInformation;
			await patch((current) => {
				assertOAuthClientUnchanged(
					options.serverName,
					current,
					clientInformation,
				);
				return {
					...current,
					codeVerifier,
					redirectUrl: options.redirectUrl,
					loopbackHostname: persistLoopbackHostname
						? loopbackHostname
						: undefined,
				};
			});
		},
		codeVerifier: () => {
			refreshState();
			if (!stateMatchesProviderConfiguration() || !state.codeVerifier) {
				throw new Error(
					`Missing OAuth code verifier for MCP server "${options.serverName}".`,
				);
			}
			return state.codeVerifier;
		},
		invalidateCredentials: async (scope) => {
			const clientInformation =
				options.clientInformation ?? expectedClientInformation;
			await patch((current) => {
				assertOAuthClientUnchanged(
					options.serverName,
					current,
					clientInformation,
				);
				if (scope === "all") {
					return {
						lastError: current.lastError,
						redirectUrl: current.redirectUrl,
						loopbackHostname: current.loopbackHostname,
					};
				}
				return {
					...current,
					...(scope === "client" ? { clientInformation: undefined } : {}),
					...(scope === "tokens"
						? {
								tokens: undefined,
								scopePolicy: undefined,
								lastAuthenticatedAt: undefined,
							}
						: {}),
					...(scope === "verifier" ? { codeVerifier: undefined } : {}),
					...(scope === "discovery" ? { discoveryState: undefined } : {}),
				};
			});
		},
		saveDiscoveryState: async (discoveryState) => {
			const clientInformation =
				options.clientInformation ?? expectedClientInformation;
			await patch((current) => {
				assertOAuthClientUnchanged(
					options.serverName,
					current,
					clientInformation,
				);
				return {
					...current,
					discoveryState: discoveryState as unknown as Record<string, unknown>,
				};
			});
		},
		discoveryState: () => {
			refreshState();
			return stateMatchesProviderConfiguration()
				? (state.discoveryState as OAuthDiscoveryState | undefined)
				: undefined;
		},
	};

	return {
		provider,
		getLastAuthorizationUrl: () => lastAuthorizationUrl,
		getLastOAuthState: () => lastOAuthState,
		resetInteractiveState: async () => {
			await patch((current) => {
				const configuredClientInformation = options.clientInformation;
				const dynamicRedirectChanged =
					configuredClientInformation === undefined &&
					current.clientInformation !== undefined &&
					current.redirectUrl !== options.redirectUrl;
				const configuredClientChanged =
					configuredClientInformation !== undefined &&
					!isSameOAuthClient(
						current.clientInformation as
							| OAuthClientInformationMixed
							| undefined,
						configuredClientInformation,
					);
				const scopePolicyChanged = !areMcpOAuthScopePoliciesEqual(
					allowedScopes,
					current.scopePolicy,
				);
				const loopbackHostnameChanged = persistLoopbackHostname
					? current.loopbackHostname === undefined
						? loopbackHostname !== DEFAULT_MCP_OAUTH_LOOPBACK_HOSTNAME
						: current.loopbackHostname !== loopbackHostname
					: current.loopbackHostname !== undefined;
				return {
					...current,
					...(dynamicRedirectChanged ? { clientInformation: undefined } : {}),
					...(configuredClientInformation
						? {
								clientInformation: configuredClientInformation as Record<
									string,
									unknown
								>,
							}
						: {}),
					...(dynamicRedirectChanged ||
					configuredClientChanged ||
					scopePolicyChanged ||
					loopbackHostnameChanged
						? { tokens: undefined, lastAuthenticatedAt: undefined }
						: {}),
					scopePolicy: allowedScopes ? [...allowedScopes] : undefined,
					loopbackHostname: persistLoopbackHostname
						? loopbackHostname
						: undefined,
					codeVerifier: undefined,
					discoveryState: undefined,
					lastError: undefined,
					redirectUrl: options.redirectUrl,
				};
			});
			expectedClientInformation = currentClientInformationFromState();
		},
		markError: async (errorMessage) => {
			await patch((current) => ({
				...current,
				lastError: errorMessage,
			}));
		},
		markConnectionError: async (errorMessage) => {
			await patch((current) => ({
				...current,
				lastError: errorMessage,
				authorizationRequired: undefined,
			}));
		},
		markAuthorizationRequired: async (errorMessage) => {
			await patch((current) => ({
				...current,
				lastError: errorMessage,
				authorizationRequired: true,
			}));
		},
		clearError: async () => {
			await patch((current) => ({
				...current,
				lastError: undefined,
				authorizationRequired: undefined,
			}));
		},
	};
}

export function createMcpSdkTransport(input: {
	registration: McpServerRegistration;
	oauthProvider?: OAuthClientProvider;
	fetch?: FetchLike;
}): McpSdkAuthCapableTransport {
	const transport = input.registration.transport;
	if (transport.type === "stdio") {
		throw new Error(
			`MCP server "${input.registration.name}" uses stdio transport and does not support OAuth browser flow.`,
		);
	}

	const requestInit = transport.headers
		? {
				headers: transport.headers,
			}
		: undefined;
	const oauthFetch = input.oauthProvider
		? createMcpOAuthScopePolicyFetch(
				input.fetch,
				input.registration.oauthClient?.allowedScopes,
			)
		: input.fetch;
	// The upstream transports only surface a typed UnauthorizedError for a 401
	// when an OAuth provider is present. For passive connections without stored
	// tokens, translate the response at the fetch boundary so callers can show
	// an explicit sign-in action without starting discovery/registration/PKCE.
	const transportFetch: FetchLike | undefined = input.oauthProvider
		? oauthFetch
		: async (url, init) => {
				const response = await (oauthFetch ?? globalThis.fetch)(url, init);
				if (response.status === 401) {
					await response.body?.cancel().catch(() => undefined);
					throw new UnauthorizedError("MCP server requires authorization");
				}
				return response;
			};
	if (transport.type === "sse") {
		return new SSEClientTransport(new URL(transport.url), {
			authProvider: input.oauthProvider,
			requestInit,
			// The stream request must see the raw response: EventSource flattens
			// a thrown fetch error into a status-less error event, while a
			// passed-through 401 fails the connection with an SseError carrying
			// the HTTP code that isMcpUnauthorizedError recognizes.
			eventSourceInit: {
				fetch: (url, init) => (oauthFetch ?? globalThis.fetch)(url, init),
			},
			fetch: transportFetch,
		});
	}

	return new StreamableHTTPClientTransport(new URL(transport.url), {
		authProvider: input.oauthProvider,
		requestInit,
		fetch: transportFetch,
	});
}

/**
 * Recognizes a 401 from a remote MCP server across transports. The streamable
 * HTTP transport (and SSE message POSTs) reject with the typed
 * UnauthorizedError raised at the fetch boundary, but the SSE stream request
 * runs inside EventSource, which consumes the response and reports the HTTP
 * status only through SseError's code.
 */
export function isMcpUnauthorizedError(error: unknown): boolean {
	return (
		error instanceof UnauthorizedError ||
		(error instanceof SseError && error.code === 401)
	);
}

function buildClient(input: {
	clientName?: string;
	clientVersion?: string;
}): Client {
	return new Client({
		name: input.clientName?.trim() || "@cline/core",
		version: input.clientVersion?.trim() || "0.0.0",
	});
}

export async function authorizeMcpServerOAuth(
	options: AuthorizeMcpServerOAuthOptions,
): Promise<AuthorizeMcpServerOAuthResult> {
	const serverName = options.serverName.trim();
	if (!serverName) {
		throw new Error("MCP server name cannot be empty.");
	}
	if (options.signal?.aborted) {
		throw new Error(
			`MCP server "${serverName}" OAuth authorization was cancelled.`,
		);
	}

	const { resolveMcpServerRegistration } = await import("./config-loader");
	const settingsPath = options.filePath ?? resolveDefaultMcpSettingsPath();
	const registration = resolveMcpServerRegistration(serverName, {
		filePath: settingsPath,
	});
	if (!registration) {
		throw new Error(`MCP server "${serverName}" is not configured.`);
	}
	if (registration.transport.type === "stdio") {
		throw new Error(
			`MCP server "${serverName}" uses stdio transport and does not support OAuth browser flow.`,
		);
	}
	if (
		Object.keys(registration.transport.headers ?? {}).some(
			(name) => name.toLowerCase() === "authorization",
		)
	) {
		throw new Error(
			`MCP server "${serverName}" has a static Authorization header. Remove it before starting OAuth.`,
		);
	}
	const transportBinding = createMcpOAuthTransportBinding(
		registration.transport,
	);
	const requestTimeoutMs = resolveMcpRequestTimeoutMs(
		registration.timeoutSeconds,
	);
	const configuredLoopbackHostname = registration.oauthClient?.loopbackHostname;
	const resolvedConfiguredLoopbackHostname = resolveMcpOAuthLoopbackHostname(
		configuredLoopbackHostname,
	);
	const hasExplicitCallbackHost = options.callbackHost !== undefined;
	if (
		registration.oauthClient !== undefined &&
		hasExplicitCallbackHost &&
		options.callbackHost !== resolvedConfiguredLoopbackHostname
	) {
		throw new Error(
			`MCP server "${serverName}" resolves oauthClient.loopbackHostname to "${resolvedConfiguredLoopbackHostname}"; callbackHost must match it when supplied.`,
		);
	}

	const callbackServer = await startLocalOAuthServer({
		host: options.callbackHost,
		...(hasExplicitCallbackHost
			? {}
			: {
					callbackHostname: resolvedConfiguredLoopbackHostname,
				}),
		ports: options.callbackPorts?.length
			? options.callbackPorts
			: DEFAULT_MCP_OAUTH_CALLBACK_PORTS,
		callbackPath: options.callbackPath ?? DEFAULT_MCP_OAUTH_CALLBACK_PATH,
		timeoutMs: options.timeoutMs ?? DEFAULT_MCP_OAUTH_TIMEOUT_MS,
		requireExpectedState: true,
		successHtml: options.successHtml,
		onListening: options.onServerListening,
		onClose: options.onServerClose,
	});
	if (!callbackServer.callbackUrl) {
		throw new Error("Unable to bind local MCP OAuth callback server.");
	}
	const actualCallbackHostname = new URL(callbackServer.callbackUrl).hostname;
	// Legacy dynamic callers may bind an arbitrary callbackHost. Keep that API
	// behavior, while recording an exact identity whenever the host is one of the
	// supported persisted loopback values. The exact redirectUrl still binds an
	// arbitrary legacy host to its dynamically registered client.
	const effectiveLoopbackHostname =
		actualCallbackHostname === "127.0.0.1" ||
		actualCallbackHostname === "localhost"
			? actualCallbackHostname
			: configuredLoopbackHostname;
	const persistLoopbackHostname =
		actualCallbackHostname === "127.0.0.1" ||
		actualCallbackHostname === "localhost";
	const cancelCallbackWait = () => callbackServer.cancelWait();
	options.signal?.addEventListener("abort", cancelCallbackWait, { once: true });
	if (options.signal?.aborted) {
		cancelCallbackWait();
	}

	let oauthContext: McpOAuthProviderContext;
	oauthContext = createMcpOAuthProviderContext({
		settingsPath,
		serverName,
		redirectUrl: callbackServer.callbackUrl,
		clientInformation: createMcpOAuthClientInformation(
			registration.oauthClient,
		),
		allowedScopes: registration.oauthClient?.allowedScopes,
		loopbackHostname: effectiveLoopbackHostname,
		persistLoopbackHostname,
		transportBinding,
		onAuthorizationUrl: async (url) => {
			const expectedState = oauthContext.getLastOAuthState();
			const authorizationState = new URL(url).searchParams.get("state");
			if (!expectedState || authorizationState !== expectedState) {
				throw new Error(
					`MCP server "${serverName}" did not produce a valid OAuth stateful authorization URL.`,
				);
			}
			callbackServer.setExpectedState(expectedState);
			await options.openUrl?.(url);
		},
	});

	const client = buildClient(options);
	let retryClient: Client | undefined;
	try {
		await oauthContext.resetInteractiveState();
		const transport = createMcpSdkTransport({
			registration,
			oauthProvider: oauthContext.provider,
			fetch: options.fetch,
		});
		try {
			await client.connect(transport, {
				timeout: requestTimeoutMs,
				signal: options.signal,
			});
			await client.listTools(undefined, {
				timeout: requestTimeoutMs,
				signal: options.signal,
			});
			await oauthContext.clearError();
			return {
				serverName,
				authorized: true,
				message: `MCP server "${serverName}" is already authorized.`,
			};
		} catch (error) {
			if (!isMcpUnauthorizedError(error)) {
				throw error;
			}
			await oauthContext.markAuthorizationRequired(
				`MCP server "${serverName}" requires OAuth authorization.`,
			);
			const authUrl = oauthContext.getLastAuthorizationUrl();
			if (!authUrl) {
				throw new Error(
					`MCP server "${serverName}" did not provide an authorization URL.`,
				);
			}
			const callback = await callbackServer.waitForCallback();
			if (!callback) {
				if (options.signal?.aborted) {
					throw new Error(
						`MCP server "${serverName}" OAuth authorization was cancelled.`,
					);
				}
				throw new Error(
					"Timed out waiting for MCP OAuth authorization callback.",
				);
			}
			if (callback.error) {
				throw new Error(`OAuth authorization failed: ${callback.error}`);
			}
			if (!callback.code) {
				throw new Error(
					"OAuth callback did not include an authorization code.",
				);
			}
			const expectedState = oauthContext.getLastOAuthState();
			if (!expectedState) {
				throw new Error(
					`MCP server "${serverName}" did not start an OAuth stateful authorization flow.`,
				);
			}
			if (callback.state !== expectedState) {
				throw new Error("OAuth authorization failed: state mismatch.");
			}

			await transport.finishAuth(callback.code);
			retryClient = buildClient(options);
			const retryTransport = createMcpSdkTransport({
				registration,
				oauthProvider: oauthContext.provider,
				fetch: options.fetch,
			});
			await retryClient.connect(retryTransport, {
				timeout: requestTimeoutMs,
				signal: options.signal,
			});
			await retryClient.listTools(undefined, {
				timeout: requestTimeoutMs,
				signal: options.signal,
			});
			await oauthContext.clearError();
			return {
				serverName,
				authorized: true,
				message: `MCP server "${serverName}" OAuth authorization completed.`,
			};
		}
	} catch (error) {
		const cancelled = options.signal?.aborted === true;
		const message = cancelled
			? `MCP server "${serverName}" OAuth authorization was cancelled.`
			: toErrorMessage(
					augmentMcpTimeoutError(error, serverName, requestTimeoutMs),
				);
		if (!cancelled) {
			await oauthContext.markError(message);
		}
		throw new Error(message);
	} finally {
		options.signal?.removeEventListener("abort", cancelCallbackWait);
		await client.close().catch(() => undefined);
		await retryClient?.close().catch(() => undefined);
		callbackServer.close();
	}
}
