import { randomUUID } from "node:crypto";
import type {
	OAuthClientProvider,
	OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
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
	normalizeMcpServerOAuthState,
	updateMcpServerOAuthState,
} from "./config-loader";
import type { McpServerOAuthState, McpServerRegistration } from "./types";

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
}

export interface McpOAuthProviderContext {
	provider: OAuthClientProvider;
	getLastAuthorizationUrl(): string | undefined;
	getLastOAuthState(): string | undefined;
	resetInteractiveState(): Promise<void>;
	markError(errorMessage: string): Promise<void>;
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

	const patch = async (
		updater: (current: McpServerOAuthState) => McpServerOAuthState,
	): Promise<void> => {
		const nextState = normalizeMcpServerOAuthState(updater(state)) ?? {};
		try {
			state = updateMcpServerOAuthState(options.serverName, () => nextState, {
				filePath: options.settingsPath,
			});
		} catch {
			state = nextState;
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
		clientInformation: () =>
			state.clientInformation as OAuthClientInformationMixed | undefined,
		saveClientInformation: async (clientInformation) => {
			await patch((current) => ({
				...current,
				clientInformation: clientInformation as Record<string, unknown>,
				redirectUrl: options.redirectUrl,
				lastError: undefined,
			}));
		},
		tokens: () => state.tokens as OAuthTokens | undefined,
		saveTokens: async (tokens) => {
			await patch((current) => ({
				...current,
				tokens: tokens as Record<string, unknown>,
				redirectUrl: options.redirectUrl,
				lastError: undefined,
				lastAuthenticatedAt: Date.now(),
			}));
		},
		redirectToAuthorization: async (authorizationUrl) => {
			lastAuthorizationUrl = authorizationUrl.toString();
			await options.onAuthorizationUrl?.(lastAuthorizationUrl);
		},
		saveCodeVerifier: async (codeVerifier) => {
			await patch((current) => ({
				...current,
				codeVerifier,
				redirectUrl: options.redirectUrl,
			}));
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
			await patch((current) => {
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
						? { tokens: undefined, lastAuthenticatedAt: undefined }
						: {}),
					...(scope === "verifier" ? { codeVerifier: undefined } : {}),
					...(scope === "discovery" ? { discoveryState: undefined } : {}),
				};
			});
		},
		saveDiscoveryState: async (discoveryState) => {
			await patch((current) => ({
				...current,
				discoveryState: discoveryState as unknown as Record<string, unknown>,
			}));
		},
		discoveryState: () =>
			state.discoveryState as OAuthDiscoveryState | undefined,
	};

	return {
		provider,
		getLastAuthorizationUrl: () => lastAuthorizationUrl,
		getLastOAuthState: () => lastOAuthState,
		resetInteractiveState: async () => {
			await patch((current) => ({
				...current,
				clientInformation: undefined,
				codeVerifier: undefined,
				discoveryState: undefined,
				lastError: undefined,
				redirectUrl: options.redirectUrl,
			}));
		},
		markError: async (errorMessage) => {
			await patch((current) => ({
				...current,
				lastError: errorMessage,
			}));
		},
		clearError: async () => {
			await patch((current) => ({
				...current,
				lastError: undefined,
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
	if (transport.type === "sse") {
		return new SSEClientTransport(new URL(transport.url), {
			authProvider: input.oauthProvider,
			requestInit,
			fetch: input.fetch,
		});
	}

	return new StreamableHTTPClientTransport(new URL(transport.url), {
		authProvider: input.oauthProvider,
		requestInit,
		fetch: input.fetch,
	});
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

	const { resolveMcpServerRegistrations } = await import("./config-loader");
	const registration = resolveMcpServerRegistrations({
		filePath: options.filePath,
	}).find((entry) => entry.name === serverName);
	if (!registration) {
		throw new Error(`MCP server "${serverName}" is not configured.`);
	}
	if (registration.disabled) {
		throw new Error(
			`MCP server "${serverName}" is disabled. Enable it before running OAuth.`,
		);
	}
	if (registration.transport.type === "stdio") {
		throw new Error(
			`MCP server "${serverName}" uses stdio transport and does not support OAuth browser flow.`,
		);
	}

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

	const oauthContext = createMcpOAuthProviderContext({
		settingsPath: options.filePath,
		serverName,
		redirectUrl: callbackServer.callbackUrl,
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
			await client.connect(transport);
			await client.listTools();
			await oauthContext.clearError();
			return {
				serverName,
				authorized: true,
				message: `MCP server "${serverName}" is already authorized.`,
			};
		} catch (error) {
			if (!(error instanceof UnauthorizedError)) {
				throw error;
			}
			const authUrl = oauthContext.getLastAuthorizationUrl();
			if (!authUrl) {
				throw new Error(
					`MCP server "${serverName}" did not provide an authorization URL.`,
				);
			}
			const callback = await callbackServer.waitForCallback();
			if (!callback) {
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
			await retryClient.connect(retryTransport);
			await retryClient.listTools();
			await oauthContext.clearError();
			return {
				serverName,
				authorized: true,
				message: `MCP server "${serverName}" OAuth authorization completed.`,
			};
		}
	} catch (error) {
		const message = toErrorMessage(error);
		await oauthContext.markError(message);
		throw new Error(message);
	} finally {
		await client.close().catch(() => undefined);
		await retryClient?.close().catch(() => undefined);
		callbackServer.close();
	}
}
