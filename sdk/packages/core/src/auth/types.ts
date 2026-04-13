import type { ITelemetryService } from "@clinebot/shared";
import type { OAuthServerCloseInfo, OAuthServerListeningInfo } from "./server";

export interface OAuthPrompt {
	message: string;
	defaultValue?: string;
}

export interface OAuthCredentials {
	access: string;
	refresh: string;
	/**
	 * Expiration timestamp in milliseconds since epoch.
	 */
	expires: number;
	/**
	 * Optional provider-specific account identifier.
	 */
	accountId?: string;
	/**
	 * Optional email for display/telemetry.
	 */
	email?: string;
	/**
	 * Provider-specific metadata (user info, provider hint, etc).
	 */
	metadata?: Record<string, unknown>;
}

export interface OAuthLoginCallbacks {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	/**
	 * Called when the local OAuth redirect server successfully binds to a port
	 * and is ready to receive the browser callback. The `info` object contains
	 * the host, the bound port number, and the full `callbackUrl`.
	 *
	 * Use this to:
	 * - Show a "waiting for OAuth callback on port N" status indicator in your UI.
	 * - Forward the port in remote-development environments (e.g. JetBrains
	 *   Gateway) from the remote machine to the machine running the browser.
	 *
	 * Paired with `onServerClose` for teardown.
	 *
	 * Only fired when the provider uses a local callback server
	 * (`OAuthProviderInterface.usesCallbackServer === true`).
	 */
	onServerListening?: (info: OAuthServerListeningInfo) => void | Promise<void>;
	/**
	 * Called when the local OAuth redirect server closes — either because the
	 * callback was received, the flow was cancelled, or the timeout elapsed.
	 *
	 * Use this to:
	 * - Clear any "waiting for callback" status UI shown in `onServerListening`.
	 * - Tear down port-forwards set up in `onServerListening`.
	 *
	 * Only fired when the provider uses a local callback server
	 * (`OAuthProviderInterface.usesCallbackServer === true`).
	 */
	onServerClose?: (info: OAuthServerCloseInfo) => void | Promise<void>;
}

export interface OAuthProviderInterface {
	id: string;
	name: string;
	usesCallbackServer: boolean;
	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
	refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
	getApiKey(credentials: OAuthCredentials): string;
}

export type OcaMode = "internal" | "external";

export interface OcaOAuthEnvironmentConfig {
	clientId: string;
	idcsUrl: string;
	scopes: string;
	baseUrl: string;
}

export interface OcaOAuthConfig {
	internal: OcaOAuthEnvironmentConfig;
	external: OcaOAuthEnvironmentConfig;
}

export interface OcaClientMetadata {
	client?: string;
	clientVersion?: string;
	clientIde?: string;
	clientIdeVersion?: string;
}

export interface OcaOAuthProviderOptions {
	config?: Partial<OcaOAuthConfig>;
	mode?: OcaMode | (() => OcaMode);
	callbackPath?: string;
	callbackPorts?: number[];
	requestTimeoutMs?: number;
	refreshBufferMs?: number;
	retryableTokenGraceMs?: number;
	telemetry?: ITelemetryService;
}

export interface OcaTokenResolution {
	forceRefresh?: boolean;
	refreshBufferMs?: number;
	retryableTokenGraceMs?: number;
}
