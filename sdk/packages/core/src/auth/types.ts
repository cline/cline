import type { ITelemetryService } from "@clinebot/shared";

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
