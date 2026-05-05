import type { ITelemetryService } from "@clinebot/shared";
import {
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthStarted,
	captureAuthSucceeded,
	identifyAccount,
} from "../services/telemetry/core-events";
import { startLocalOAuthServer } from "./server";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthProviderInterface,
} from "./types";
import {
	isCredentialLikelyExpired,
	parseAuthorizationInput,
	parseOAuthError,
	resolveAuthorizationCodeInput,
	resolveUrl,
} from "./utils";

const DEFAULT_AUTH_ENDPOINTS = {
	authorize: "/api/v1/auth/authorize",
	token: "/api/v1/auth/token",
	register: "/api/v1/auth/register",
	refresh: "/api/v1/auth/refresh",
} as const;

const DEFAULT_WORKOS_ENDPOINTS = {
	deviceAuthorization: "/user_management/authorize/device",
	authenticate: "/user_management/authenticate",
} as const;

const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";
const DEFAULT_WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR";
const DEFAULT_CALLBACK_PATH = "/auth";
const DEFAULT_CALLBACK_PORTS = Array.from(
	{ length: 11 },
	(_, index) => 48801 + index,
);
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_RETRYABLE_TOKEN_GRACE_MS = 30 * 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 30 * 1000;
const DEFAULT_DEVICE_AUTH_EXPIRES_IN_SECONDS = 300;
const DEFAULT_DEVICE_AUTH_INTERVAL_SECONDS = 5;

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
	requestTimeoutMs?: number;
	telemetry?: ITelemetryService;
	useWorkOSDeviceAuth?: boolean;
	callbackPath?: string;
	callbackPorts?: number[];
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

function toSeconds(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.floor(value);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

type WorkOSDeviceAuthorizationResponse = {
	device_code?: string;
	user_code?: string;
	verification_uri?: string;
	verification_uri_complete?: string;
	expires_in?: number;
	interval?: number;
	error?: string;
	error_description?: string;
};

type WorkOSTokenResponse = {
	access_token?: string;
	refresh_token?: string;
	token_type?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
};

type WorkOSTokenSuccess = {
	accessToken: string;
	refreshToken: string;
	tokenType: string;
};

function requireClineTokenResponse(
	payload: ClineTokenResponse,
	message: string,
): ClineAuthResponseData {
	if (!payload.success || !payload.data?.accessToken) {
		throw new Error(message);
	}
	return payload.data;
}

async function requestWorkOSDeviceAuthorization(
	clientId: string,
	options?: { requestTimeoutMs?: number },
): Promise<{
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
}> {
	const response = await fetch(
		resolveUrl(
			DEFAULT_WORKOS_API_BASE_URL,
			DEFAULT_WORKOS_ENDPOINTS.deviceAuthorization,
		),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ client_id: clientId }),
			signal: AbortSignal.timeout(
				options?.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
			),
		},
	);

	const json = (await response
		.json()
		.catch(() => ({}))) as WorkOSDeviceAuthorizationResponse;
	if (!response.ok) {
		throw new ClineOAuthTokenError(
			`Device authorization failed: ${response.status}${json.error_description ? ` - ${json.error_description}` : ""}`,
			{ status: response.status, errorCode: json.error },
		);
	}
	if (!json.device_code || !json.user_code || !json.verification_uri) {
		throw new Error("Invalid WorkOS device authorization response");
	}

	return {
		deviceCode: json.device_code,
		userCode: json.user_code,
		verificationUri: json.verification_uri,
		verificationUriComplete: json.verification_uri_complete,
		expiresInSeconds: toSeconds(
			json.expires_in,
			DEFAULT_DEVICE_AUTH_EXPIRES_IN_SECONDS,
		),
		pollIntervalSeconds: toSeconds(
			json.interval,
			DEFAULT_DEVICE_AUTH_INTERVAL_SECONDS,
		),
	};
}

async function pollWorkOSTokens(options: {
	clientId: string;
	deviceCode: string;
	expiresInSeconds: number;
	initialPollIntervalSeconds: number;
	requestTimeoutMs: number;
	workosApiBaseUrl: string;
	onProgress?: OAuthLoginCallbacks["onProgress"];
}): Promise<WorkOSTokenSuccess> {
	const deadline = Date.now() + options.expiresInSeconds * 1000;
	let intervalSeconds = Math.max(1, options.initialPollIntervalSeconds);

	while (Date.now() <= deadline) {
		const response = await fetch(
			resolveUrl(
				options.workosApiBaseUrl,
				DEFAULT_WORKOS_ENDPOINTS.authenticate,
			),
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: options.deviceCode,
					client_id: options.clientId,
				}),
				signal: AbortSignal.timeout(options.requestTimeoutMs),
			},
		);
		const payload = (await response
			.json()
			.catch(() => ({}))) as WorkOSTokenResponse;
		if (response.ok) {
			if (!payload.access_token || !payload.refresh_token) {
				throw new Error("Invalid WorkOS token response");
			}
			return {
				accessToken: payload.access_token,
				refreshToken: payload.refresh_token,
				tokenType: payload.token_type ?? "Bearer",
			};
		}

		switch (payload.error) {
			case "authorization_pending": {
				await sleep(intervalSeconds * 1000);
				break;
			}
			case "slow_down": {
				intervalSeconds += 1;
				await sleep(intervalSeconds * 1000);
				break;
			}
			case "access_denied":
			case "expired_token":
			case "invalid_grant": {
				throw new ClineOAuthTokenError(
					payload.error_description || "WorkOS authorization failed",
					{
						status: response.status,
						errorCode: payload.error,
					},
				);
			}
			default: {
				throw new ClineOAuthTokenError(
					`WorkOS token polling failed: ${response.status}${payload.error_description ? ` - ${payload.error_description}` : ""}`,
					{
						status: response.status,
						errorCode: payload.error,
					},
				);
			}
		}

		options.onProgress?.("Waiting for browser authentication confirmation...");
	}

	throw new Error("WorkOS device authorization timed out");
}

async function registerWorkOSTokens(
	workosTokens: WorkOSTokenSuccess,
	options: ClineOAuthProviderOptions,
	provider?: string,
): Promise<ClineOAuthCredentials> {
	const body = {
		accessToken: workosTokens.accessToken,
		refreshToken: workosTokens.refreshToken,
	};

	const response = await fetch(
		resolveUrl(options.apiBaseUrl, DEFAULT_AUTH_ENDPOINTS.register),
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
			`Token registration failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{ status: response.status, errorCode: details.code },
		);
	}

	const json = (await response.json()) as ClineTokenResponse;
	return toClineCredentials(
		requireClineTokenResponse(json, "Invalid token exchange response"),
		provider ?? options.provider,
	);
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
	return toClineCredentials(
		requireClineTokenResponse(json, "Invalid token exchange response"),
		provider ?? options.provider,
	);
}

export async function loginClineOAuth(
	options: ClineOAuthProviderOptions & {
		callbacks: OAuthLoginCallbacks;
	},
): Promise<ClineOAuthCredentials> {
	captureAuthStarted(options.telemetry, options.provider ?? "cline");
	const useWorkOSDeviceAuth = options.useWorkOSDeviceAuth ?? true;
	const callbackPorts = options.callbackPorts?.length
		? options.callbackPorts
		: DEFAULT_CALLBACK_PORTS;
	const callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH;
	const localServer = useWorkOSDeviceAuth
		? null
		: await startLocalOAuthServer({
				ports: callbackPorts,
				callbackPath,
				onListening: options.callbacks.onServerListening,
				onClose: options.callbacks.onServerClose,
			});
	const callbackUrl =
		localServer?.callbackUrl ||
		`http://127.0.0.1:${callbackPorts[0] ?? DEFAULT_CALLBACK_PORTS[0]}${callbackPath}`;

	try {
		let credentials: ClineOAuthCredentials;
		if (useWorkOSDeviceAuth) {
			const clientId = DEFAULT_WORKOS_CLIENT_ID;
			const deviceAuthorization = await requestWorkOSDeviceAuthorization(
				clientId,
				options,
			);
			options.callbacks.onAuth({
				url:
					deviceAuthorization.verificationUriComplete ??
					deviceAuthorization.verificationUri,
				instructions: `Enter this code in your browser: ${deviceAuthorization.userCode}`,
			});

			const workosTokens = await pollWorkOSTokens({
				clientId,
				deviceCode: deviceAuthorization.deviceCode,
				expiresInSeconds: deviceAuthorization.expiresInSeconds,
				initialPollIntervalSeconds: deviceAuthorization.pollIntervalSeconds,
				requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
				workosApiBaseUrl: DEFAULT_WORKOS_API_BASE_URL,
				onProgress: options.callbacks.onProgress,
			});

			credentials = await registerWorkOSTokens(
				workosTokens,
				options,
				options.provider,
			);
		} else {
			const authUrl = new URL(
				resolveUrl(options.apiBaseUrl, DEFAULT_AUTH_ENDPOINTS.authorize),
			);
			authUrl.searchParams.set("client_type", "extension");
			authUrl.searchParams.set("callback_url", callbackUrl);
			authUrl.searchParams.set("redirect_uri", callbackUrl);
			options.callbacks.onAuth({
				url: authUrl.toString(),
				instructions: "Continue the authentication process in your browser.",
			});

			let code: string | undefined;
			let provider = options.provider;
			const authResult = await resolveAuthorizationCodeInput({
				waitForCallback: localServer?.waitForCallback ?? (async () => null),
				cancelWait: localServer?.cancelWait ?? (() => {}),
				onManualCodeInput: options.callbacks.onManualCodeInput,
				parseOptions: { includeProvider: true },
			});
			if (authResult.error) {
				throw new Error(`OAuth error: ${authResult.error}`);
			}
			code = authResult.code;
			provider = authResult.provider ?? provider;
			if (!code) {
				const input = await options.callbacks.onPrompt({
					message: "Paste the authorization code (or full redirect URL):",
				});
				const parsed = parseAuthorizationInput(input, {
					includeProvider: true,
				});
				code = parsed.code;
				provider = parsed.provider ?? provider;
			}
			if (!code) {
				throw new Error("Missing authorization code");
			}
			credentials = await exchangeAuthorizationCode(
				code,
				callbackUrl,
				options,
				provider,
			);
		}

		captureAuthSucceeded(options.telemetry, options.provider ?? "cline");
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: options.provider ?? "cline",
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
		localServer?.close();
	}
}

export async function startClineDeviceAuth(options?: {
	requestTimeoutMs?: number;
}): Promise<{
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
}> {
	return await requestWorkOSDeviceAuthorization(
		DEFAULT_WORKOS_CLIENT_ID,
		options,
	);
}

export async function completeClineDeviceAuth(options: {
	deviceCode: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
	apiBaseUrl: string;
	provider?: string;
	headers?: HeaderInput;
	requestTimeoutMs?: number;
	telemetry?: ITelemetryService;
}): Promise<ClineOAuthCredentials> {
	const providerName = options.provider ?? "cline";
	captureAuthStarted(options.telemetry, providerName);
	try {
		const workosTokens = await pollWorkOSTokens({
			clientId: DEFAULT_WORKOS_CLIENT_ID,
			deviceCode: options.deviceCode,
			expiresInSeconds: options.expiresInSeconds,
			initialPollIntervalSeconds: options.pollIntervalSeconds,
			requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
			workosApiBaseUrl: DEFAULT_WORKOS_API_BASE_URL,
		});
		const credentials = await registerWorkOSTokens(
			workosTokens,
			{
				apiBaseUrl: options.apiBaseUrl,
				headers: options.headers,
				requestTimeoutMs: options.requestTimeoutMs,
				provider: options.provider,
			},
			options.provider,
		);
		captureAuthSucceeded(options.telemetry, providerName);
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: providerName,
		});
		return credentials;
	} catch (error) {
		captureAuthFailed(
			options.telemetry,
			providerName,
			error instanceof Error ? error.message : String(error),
		);
		throw error;
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
	const provider =
		(current.metadata?.provider as string | undefined) ?? options.provider;
	return toClineCredentials(
		requireClineTokenResponse(json, "Invalid token refresh response"),
		provider,
		current,
	);
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
		usesCallbackServer: !(options.useWorkOSDeviceAuth ?? true),
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
