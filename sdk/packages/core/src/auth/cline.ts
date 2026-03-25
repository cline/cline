import type { ITelemetryService } from "@clinebot/shared";
import {
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthStarted,
	captureAuthSucceeded,
	identifyAccount,
} from "../telemetry/core-events";
import { startLocalOAuthServer } from "./server.js";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthProviderInterface,
} from "./types.js";
import {
	isCredentialLikelyExpired,
	parseAuthorizationInput,
	parseOAuthError,
	resolveAuthorizationCodeInput,
	resolveUrl,
} from "./utils.js";

const DEFAULT_AUTH_ENDPOINTS = {
	authorize: "/api/v1/auth/authorize",
	token: "/api/v1/auth/token",
	refresh: "/api/v1/auth/refresh",
} as const;

const DEFAULT_CALLBACK_PATH = "/auth";
const DEFAULT_CALLBACK_PORTS = Array.from(
	{ length: 11 },
	(_, index) => 48801 + index,
);
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_RETRYABLE_TOKEN_GRACE_MS = 30 * 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 30 * 1000;

export type ClineTokenResolution = {
	forceRefresh?: boolean;
	refreshBufferMs?: number;
	retryableTokenGraceMs?: number;
};

interface ClineAuthApiUser {
	subject: string | null;
	email: string;
	name: string;
	clineUserId: string | null;
	accounts: string[] | null;
}

interface ClineAuthResponseData {
	accessToken: string;
	refreshToken?: string;
	tokenType: string;
	expiresAt: string;
	userInfo: ClineAuthApiUser;
}

type ClineTokenResponse = {
	success: boolean;
	data: ClineAuthResponseData;
};

type HeaderMap = Record<string, string>;
type HeaderInput = HeaderMap | (() => Promise<HeaderMap> | HeaderMap);

export interface ClineOAuthProviderOptions {
	apiBaseUrl: string;
	headers?: HeaderInput;
	callbackPath?: string;
	callbackPorts?: number[];
	requestTimeoutMs?: number;
	telemetry?: ITelemetryService;
	/**
	 * Optional identity provider name for token exchange.
	 */
	provider?: string;
}

export interface ClineOAuthCredentials extends OAuthCredentials {
	metadata?: {
		provider?: string;
		tokenType?: string;
		userInfo?: ClineAuthApiUser;
		[key: string]: unknown;
	};
}

class ClineOAuthTokenError extends Error {
	public readonly status?: number;
	public readonly errorCode?: string;

	constructor(message: string, opts?: { status?: number; errorCode?: string }) {
		super(message);
		this.name = "ClineOAuthTokenError";
		this.status = opts?.status;
		this.errorCode = opts?.errorCode;
	}

	public isLikelyInvalidGrant(): boolean {
		if (
			this.errorCode &&
			/invalid_grant|invalid_token|unauthorized/i.test(this.errorCode)
		) {
			return true;
		}
		if (this.status === 400 || this.status === 401 || this.status === 403) {
			return /invalid|expired|revoked|unauthorized/i.test(this.message);
		}
		return false;
	}
}

function createState(): string {
	const cryptoApi = globalThis.crypto;
	if (!cryptoApi) {
		return Math.random().toString(16).slice(2);
	}
	const bytes = new Uint8Array(16);
	cryptoApi.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function toEpochMs(isoDateTime: string): number {
	const epoch = Date.parse(isoDateTime);
	if (Number.isNaN(epoch)) {
		throw new Error(`Invalid expiresAt value: ${isoDateTime}`);
	}
	return epoch;
}

function toClineCredentials(
	responseData: ClineAuthResponseData,
	provider: string | undefined,
	fallback: Partial<ClineOAuthCredentials> = {},
): ClineOAuthCredentials {
	const accountId = responseData.userInfo.clineUserId ?? fallback.accountId;
	const refreshToken = responseData.refreshToken ?? fallback.refresh;

	if (!refreshToken) {
		throw new Error("Token response did not include a refresh token");
	}

	return {
		access: responseData.accessToken,
		refresh: refreshToken,
		expires: toEpochMs(responseData.expiresAt),
		accountId: accountId ?? undefined,
		email: responseData.userInfo.email || fallback.email,
		metadata: {
			provider,
			tokenType: responseData.tokenType,
			userInfo: responseData.userInfo,
		},
	};
}

async function resolveHeaders(input?: HeaderInput): Promise<HeaderMap> {
	if (!input) {
		return {};
	}
	return typeof input === "function" ? await input() : input;
}

async function requestAuthorizationUrl(
	options: ClineOAuthProviderOptions,
	params: {
		callbackUrl: string;
		state: string;
	},
): Promise<string> {
	const authUrl = new URL(
		resolveUrl(options.apiBaseUrl, DEFAULT_AUTH_ENDPOINTS.authorize),
	);
	authUrl.searchParams.set("client_type", "extension");
	authUrl.searchParams.set("callback_url", params.callbackUrl);
	authUrl.searchParams.set("redirect_uri", params.callbackUrl);
	authUrl.searchParams.set("state", params.state);

	return authUrl.toString();
}

async function exchangeAuthorizationCode(
	code: string,
	callbackUrl: string,
	options: ClineOAuthProviderOptions,
	provider?: string,
): Promise<ClineOAuthCredentials> {
	const body = {
		grant_type: "authorization_code",
		code,
		client_type: "extension",
		redirect_uri: callbackUrl,
		provider: provider ?? options.provider,
	};

	const response = await fetch(
		resolveUrl(options.apiBaseUrl, DEFAULT_AUTH_ENDPOINTS.token),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(await resolveHeaders(options.headers)),
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(
				options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
			),
		},
	);

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		const details = parseOAuthError(text);
		throw new ClineOAuthTokenError(
			`Token exchange failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{ status: response.status, errorCode: details.code },
		);
	}

	const json = (await response.json()) as ClineTokenResponse;
	if (!json.success || !json.data?.accessToken) {
		throw new Error("Invalid token exchange response");
	}

	return toClineCredentials(json.data, provider ?? options.provider);
}

export async function loginClineOAuth(
	options: ClineOAuthProviderOptions & {
		callbacks: OAuthLoginCallbacks;
	},
): Promise<ClineOAuthCredentials> {
	captureAuthStarted(options.telemetry, options.provider ?? "cline");
	const callbackPorts = options.callbackPorts?.length
		? options.callbackPorts
		: DEFAULT_CALLBACK_PORTS;
	const callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH;
	const state = createState();

	const localServer = await startLocalOAuthServer({
		ports: callbackPorts,
		callbackPath,
	});

	const callbackUrl =
		localServer.callbackUrl ||
		`http://127.0.0.1:${callbackPorts[0] ?? DEFAULT_CALLBACK_PORTS[0]}${callbackPath}`;

	const authUrl = await requestAuthorizationUrl(options, {
		callbackUrl,
		state,
	});
	options.callbacks.onAuth({
		url: authUrl,
		instructions: "Continue the authentication process in your browser.",
	});

	try {
		let code: string | undefined;
		let provider = options.provider;

		const authResult = await resolveAuthorizationCodeInput({
			waitForCallback: localServer.waitForCallback,
			cancelWait: localServer.cancelWait,
			onManualCodeInput: options.callbacks.onManualCodeInput,
			parseOptions: { includeProvider: true },
		});
		if (authResult.error) {
			throw new Error(`OAuth error: ${authResult.error}`);
		}
		if (authResult.state && authResult.state !== state) {
			throw new Error("State mismatch");
		}
		code = authResult.code;
		provider = authResult.provider ?? provider;

		if (!code) {
			const input = await options.callbacks.onPrompt({
				message: "Paste the authorization code (or full redirect URL):",
			});
			const parsed = parseAuthorizationInput(input, { includeProvider: true });
			if (parsed.state && parsed.state !== state) {
				throw new Error("State mismatch");
			}
			code = parsed.code;
			provider = parsed.provider ?? provider;
		}

		if (!code) {
			throw new Error("Missing authorization code");
		}

		const credentials = await exchangeAuthorizationCode(
			code,
			callbackUrl,
			options,
			provider,
		);
		captureAuthSucceeded(options.telemetry, provider ?? "cline");
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: provider ?? "cline",
		});
		return credentials;
	} catch (error) {
		captureAuthFailed(
			options.telemetry,
			options.provider ?? "cline",
			error instanceof Error ? error.message : String(error),
		);
		throw error;
	} finally {
		localServer.close();
	}
}

export async function refreshClineToken(
	current: ClineOAuthCredentials,
	options: ClineOAuthProviderOptions,
): Promise<ClineOAuthCredentials> {
	const response = await fetch(
		resolveUrl(options.apiBaseUrl, DEFAULT_AUTH_ENDPOINTS.refresh),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(await resolveHeaders(options.headers)),
			},
			body: JSON.stringify({
				refreshToken: current.refresh,
				grantType: "refresh_token",
			}),
			signal: AbortSignal.timeout(
				options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
			),
		},
	);

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		const details = parseOAuthError(text);
		throw new ClineOAuthTokenError(
			`Token refresh failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{ status: response.status, errorCode: details.code },
		);
	}

	const json = (await response.json()) as ClineTokenResponse;
	if (!json.success || !json.data?.accessToken) {
		throw new Error("Invalid token refresh response");
	}

	const provider =
		(current.metadata?.provider as string | undefined) ?? options.provider;
	return toClineCredentials(json.data, provider, current);
}

export async function getValidClineCredentials(
	currentCredentials: ClineOAuthCredentials | null,
	providerOptions: ClineOAuthProviderOptions,
	options?: ClineTokenResolution,
): Promise<ClineOAuthCredentials | null> {
	if (!currentCredentials) {
		return null;
	}

	const refreshBufferMs = options?.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS;
	const retryableTokenGraceMs =
		options?.retryableTokenGraceMs ?? DEFAULT_RETRYABLE_TOKEN_GRACE_MS;
	const forceRefresh = options?.forceRefresh === true;

	if (
		!forceRefresh &&
		!isCredentialLikelyExpired(currentCredentials, refreshBufferMs)
	) {
		return currentCredentials;
	}

	try {
		return await refreshClineToken(currentCredentials, providerOptions);
	} catch (error) {
		if (error instanceof ClineOAuthTokenError && error.isLikelyInvalidGrant()) {
			captureAuthLoggedOut(
				providerOptions.telemetry,
				providerOptions.provider ?? "cline",
				"invalid_grant",
			);
			return null;
		}
		if (currentCredentials.expires - Date.now() > retryableTokenGraceMs) {
			// Keep current token on transient refresh failures while still valid.
			return currentCredentials;
		}
		return null;
	}
}

export function createClineOAuthProvider(
	options: ClineOAuthProviderOptions,
): OAuthProviderInterface {
	return {
		id: "cline",
		name: "Cline Account",
		usesCallbackServer: true,
		async login(callbacks) {
			return loginClineOAuth({ ...options, callbacks });
		},
		async refreshToken(credentials) {
			return refreshClineToken(credentials as ClineOAuthCredentials, options);
		},
		getApiKey(credentials) {
			return `workos:${credentials.access}`;
		},
	};
}
