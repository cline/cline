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
	normalizeMcpServerOAuthState,
	resolveDefaultMcpSettingsPath,
	updateMcpServerOAuthStateAsync,
} from "./config-loader";
import { augmentMcpTimeoutError, resolveMcpRequestTimeoutMs } from "./timeout";
import type {
	McpServerOAuthClientConfig,
	McpServerOAuthState,
	McpServerRegistration,
} from "./types";

const DEFAULT_MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
const DEFAULT_MCP_OAUTH_CALLBACK_PORTS = [1456, 1457, 1458];
const DEFAULT_MCP_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export type McpSdkAuthCapableTransport =
	| SSEClientTransport
	| StreamableHTTPClientTransport;

export interface CreateMcpOAuthProviderContextOptions {
	settingsPath?: string;
	serverName: string;
	redirectUrl: string;
	onAuthorizationUrl?: (url: string) => void | Promise<void>;
	clientInformation?: OAuthClientInformationMixed;
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

function createOAuthClientMetadata(redirectUrl: string): OAuthClientMetadata {
	return {
		client_name: "Cline",
		redirect_uris: [redirectUrl],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
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
	let state: McpServerOAuthState = {};
	try {
		state =
			getMcpServerOAuthState(options.serverName, {
				filePath: options.settingsPath,
			}) ?? {};
	} catch {
		state = {};
	}
	let lastAuthorizationUrl: string | undefined;
	let lastOAuthState: string | undefined;
	const currentClientInformation = () =>
		options.clientInformation ??
		(state.clientInformation as OAuthClientInformationMixed | undefined);
	const expectedOAuthClient = options.clientInformation
		? {
				clientId: options.clientInformation.client_id,
				...(options.clientInformation.client_secret
					? { clientSecret: options.clientInformation.client_secret }
					: {}),
			}
		: null;

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
				},
			);
		} catch (error) {
			if (options.settingsPath || error instanceof McpOAuthClientChangedError) {
				throw error;
			}
			// Programmatically supplied registrations may not have a settings file.
			// They still need a functional in-memory provider context.
			state = normalizeMcpServerOAuthState(updater(state)) ?? {};
		}
	};

	const provider: OAuthClientProvider = {
		get redirectUrl() {
			return state.redirectUrl ?? options.redirectUrl;
		},
		get clientMetadata() {
			return createOAuthClientMetadata(
				state.redirectUrl ?? options.redirectUrl,
			);
		},
		state: () => {
			lastOAuthState = randomUUID();
			return lastOAuthState;
		},
		clientInformation: currentClientInformation,
		saveClientInformation: async (clientInformation) => {
			const previousClientInformation = state.clientInformation as
				| OAuthClientInformationMixed
				| undefined;
			await patch((current) => {
				assertOAuthClientUnchanged(
					options.serverName,
					current,
					previousClientInformation,
				);
				const clientChanged = !isSameOAuthClient(
					current.clientInformation as OAuthClientInformationMixed | undefined,
					clientInformation,
				);
				return {
					...current,
					clientInformation: clientInformation as Record<string, unknown>,
					...(clientChanged
						? { tokens: undefined, lastAuthenticatedAt: undefined }
						: {}),
					redirectUrl: options.redirectUrl,
					lastError: undefined,
				};
			});
		},
		tokens: () =>
			currentClientInformation()?.client_id &&
			isSameOAuthClient(
				state.clientInformation as OAuthClientInformationMixed | undefined,
				currentClientInformation(),
			)
				? (state.tokens as OAuthTokens | undefined)
				: undefined,
		saveTokens: async (tokens) => {
			const lastAuthenticatedAt = Date.now();
			const clientInformation = currentClientInformation();
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
					clientInformation: clientInformation as Record<string, unknown>,
					redirectUrl: options.redirectUrl,
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
			const clientInformation = currentClientInformation();
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
				};
			});
		},
		codeVerifier: () => {
			if (!state.codeVerifier) {
				throw new Error(
					`Missing OAuth code verifier for MCP server "${options.serverName}".`,
				);
			}
			return state.codeVerifier;
		},
		invalidateCredentials: async (scope) => {
			const clientInformation = state.clientInformation as
				| OAuthClientInformationMixed
				| undefined;
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
					};
				}
				return {
					...current,
					...(scope === "client" ? { clientInformation: undefined } : {}),
					...(scope === "tokens"
						? {
								tokens: undefined,
								lastAuthenticatedAt: undefined,
							}
						: {}),
					...(scope === "verifier" ? { codeVerifier: undefined } : {}),
					...(scope === "discovery" ? { discoveryState: undefined } : {}),
				};
			});
		},
		saveDiscoveryState: async (discoveryState) => {
			const clientInformation = state.clientInformation as
				| OAuthClientInformationMixed
				| undefined;
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
		discoveryState: () =>
			state.discoveryState as OAuthDiscoveryState | undefined,
	};

	return {
		provider,
		getLastAuthorizationUrl: () => lastAuthorizationUrl,
		getLastOAuthState: () => lastOAuthState,
		resetInteractiveState: async () => {
			await patch((current) => {
				const configuredClientInformation = options.clientInformation;
				const configuredClientChanged =
					configuredClientInformation !== undefined &&
					!isSameOAuthClient(
						current.clientInformation as
							| OAuthClientInformationMixed
							| undefined,
						configuredClientInformation,
					);
				return {
					...current,
					...(configuredClientInformation
						? {
								clientInformation: configuredClientInformation as Record<
									string,
									unknown
								>,
							}
						: {}),
					...(configuredClientChanged
						? { tokens: undefined, lastAuthenticatedAt: undefined }
						: {}),
					codeVerifier: undefined,
					discoveryState: undefined,
					lastError: undefined,
					redirectUrl: options.redirectUrl,
				};
			});
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
	// The upstream transports only surface a typed UnauthorizedError for a 401
	// when an OAuth provider is present. For passive connections without stored
	// tokens, translate the response at the fetch boundary so callers can show
	// an explicit sign-in action without starting discovery/registration/PKCE.
	const transportFetch: FetchLike | undefined = input.oauthProvider
		? input.fetch
		: async (url, init) => {
				const response = await (input.fetch ?? globalThis.fetch)(url, init);
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
				fetch: (url, init) => (input.fetch ?? globalThis.fetch)(url, init),
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
	const requestTimeoutMs = resolveMcpRequestTimeoutMs(
		registration.timeoutSeconds,
	);

	const callbackServer = await startLocalOAuthServer({
		host: options.callbackHost,
		ports: options.callbackPorts?.length
			? options.callbackPorts
			: DEFAULT_MCP_OAUTH_CALLBACK_PORTS,
		callbackPath: options.callbackPath ?? DEFAULT_MCP_OAUTH_CALLBACK_PATH,
		timeoutMs: options.timeoutMs ?? DEFAULT_MCP_OAUTH_TIMEOUT_MS,
		successHtml: options.successHtml,
		onListening: options.onServerListening,
		onClose: options.onServerClose,
	});
	if (!callbackServer.callbackUrl) {
		throw new Error("Unable to bind local MCP OAuth callback server.");
	}
	const cancelCallbackWait = () => callbackServer.cancelWait();
	options.signal?.addEventListener("abort", cancelCallbackWait, { once: true });
	if (options.signal?.aborted) {
		cancelCallbackWait();
	}

	const oauthContext = createMcpOAuthProviderContext({
		settingsPath,
		serverName,
		redirectUrl: callbackServer.callbackUrl,
		clientInformation: createMcpOAuthClientInformation(
			registration.oauthClient,
		),
		onAuthorizationUrl: async (url) => {
			await options.openUrl?.(url);
		},
	});
	await oauthContext.resetInteractiveState();

	const client = buildClient(options);
	let retryClient: Client | undefined;
	try {
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
