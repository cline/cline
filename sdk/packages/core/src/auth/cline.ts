import {
	CLINE_ENVIRONMENTS,
	type ClineEnvironmentConfig,
	decodeJwtPayload,
	getClineEnvironmentConfig,
	type ITelemetryService,
} from "@cline/shared";
import { sdkDebug } from "../logging/early-logger";
import {
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthRefreshSoftFailure,
	captureAuthStarted,
	captureAuthSucceeded,
	identifyAccount,
} from "../services/telemetry/core-events";
import { startLocalOAuthServer } from "./server";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./types";
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
// A device-authorization response is attacker-influenced input (hostile or merely
// malformed): an absurd `expires_in`/`interval` would otherwise keep the poll loop
// alive — and the sign-in UI pinned — for as long as it liked.
const MIN_DEVICE_AUTH_SECONDS = 1;
const MAX_DEVICE_AUTH_EXPIRES_IN_SECONDS = 30 * 60;
const MAX_DEVICE_AUTH_INTERVAL_SECONDS = 60;
/** RFC 8628 §3.5: back off by 5s each time the server answers `slow_down`. */
const DEVICE_AUTH_SLOW_DOWN_INCREMENT_SECONDS = 5;

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

type AuthTokenTelemetryClaims = {
	sessionId?: string;
};

type AuthCredentialTelemetryProperties = {
	sessionDurationMs?: number;
};

type AuthTelemetryDetails = AuthTokenTelemetryClaims &
	AuthCredentialTelemetryProperties;

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
	public readonly requestId?: string;

	constructor(
		message: string,
		opts?: { status?: number; errorCode?: string; requestId?: string },
	) {
		super(message);
		this.name = "ClineOAuthTokenError";
		this.status = opts?.status;
		this.errorCode = opts?.errorCode;
		this.requestId = opts?.requestId;
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

/**
 * Thrown when a device-auth call would pair a WorkOS client id with an api base
 * from a *different* Cline environment.
 */
export class ClineAuthEnvironmentMismatchError extends Error {
	constructor(
		readonly clientEnvironment: string,
		readonly apiEnvironment: string,
	) {
		super(
			`Cline device auth environment mismatch: WorkOS client id belongs to "${clientEnvironment}" but apiBaseUrl belongs to "${apiEnvironment}". Pass a client id and api base from the same environment.`,
		);
		this.name = "ClineAuthEnvironmentMismatchError";
	}
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim().replace(/\/+$/, "");
	return trimmed ? trimmed.toLowerCase() : undefined;
}

/** The known Cline environment owning this api base, when it is one of ours. */
function findEnvironmentByApiBaseUrl(
	apiBaseUrl: string | undefined,
): ClineEnvironmentConfig | undefined {
	const normalized = normalizeBaseUrl(apiBaseUrl);
	if (!normalized) {
		return undefined;
	}
	return Object.values(CLINE_ENVIRONMENTS).find(
		(config) => normalizeBaseUrl(config.apiBaseUrl) === normalized,
	);
}

/** The known Cline environment owning this WorkOS client id, if any. */
function findEnvironmentByClientId(
	clientId: string | undefined,
): ClineEnvironmentConfig | undefined {
	if (!clientId) {
		return undefined;
	}
	return Object.values(CLINE_ENVIRONMENTS).find(
		(config) => config.workOsClientId === clientId,
	);
}

/**
 * Resolve the WorkOS client id for a device-auth call from ONE environment.
 *
 * The old fallback read `getClineEnvironmentConfig()`, whose default is
 * `production`, independently of the `apiBaseUrl` the caller passes — so a host
 * that selects its environment outside Node env vars (the mobile app defaults to
 * staging) silently paired a PROD WorkOS client with a STAGING api base, and the
 * WorkOS tokens were then registered against the wrong backend.
 *
 * Two rules keep that impossible:
 *  1. when the api base is a known Cline host, the client id is derived from
 *     THAT environment rather than from ambient env vars, and
 *  2. an explicit client id from a different known environment than a known api
 *     base is rejected outright.
 */
function resolveDeviceAuthClientId(options: {
	apiBaseUrl?: string;
	workOsClientId?: string;
}): string {
	const apiEnvironment = findEnvironmentByApiBaseUrl(options.apiBaseUrl);
	const clientEnvironment = findEnvironmentByClientId(options.workOsClientId);
	if (
		apiEnvironment &&
		clientEnvironment &&
		apiEnvironment.environment !== clientEnvironment.environment
	) {
		throw new ClineAuthEnvironmentMismatchError(
			clientEnvironment.environment,
			apiEnvironment.environment,
		);
	}
	if (options.workOsClientId) {
		return options.workOsClientId;
	}
	// No explicit id: prefer the environment the api base names, and only then
	// the ambient (env-var driven, production-by-default) configuration.
	return (apiEnvironment ?? getClineEnvironmentConfig()).workOsClientId;
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
	const metadata: Record<string, unknown> = {
		...(fallback.metadata ?? {}),
		provider,
		tokenType: responseData.tokenType,
		userInfo: responseData.userInfo,
	};
	delete metadata.startedAt;

	return {
		access: responseData.accessToken,
		refresh: refreshToken,
		expires: toEpochMs(responseData.expiresAt),
		accountId: accountId ?? undefined,
		email: responseData.userInfo.email || fallback.email,
		metadata,
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

/** Clamp an attacker-influenced duration into a range we are willing to wait. */
function clampSeconds(value: number, max: number): number {
	if (!Number.isFinite(value)) {
		return max;
	}
	return Math.min(Math.max(Math.floor(value), MIN_DEVICE_AUTH_SECONDS), max);
}

function clampDeviceAuthExpiresIn(value: unknown): number {
	return clampSeconds(
		toSeconds(value, DEFAULT_DEVICE_AUTH_EXPIRES_IN_SECONDS),
		MAX_DEVICE_AUTH_EXPIRES_IN_SECONDS,
	);
}

function clampDeviceAuthInterval(value: unknown): number {
	return clampSeconds(
		toSeconds(value, DEFAULT_DEVICE_AUTH_INTERVAL_SECONDS),
		MAX_DEVICE_AUTH_INTERVAL_SECONDS,
	);
}

function asNonEmptyString(value: unknown): string | undefined {
	return (typeof value === "string" && value.trim()) || undefined;
}

function getAuthTokenTelemetryClaims(token: string): AuthTokenTelemetryClaims {
	const payload = decodeJwtPayload(token);
	if (!payload) {
		return {};
	}

	return {
		sessionId: asNonEmptyString(payload.sid),
	};
}

function getAuthCredentialTelemetryProperties(
	credentials: ClineOAuthCredentials,
): AuthCredentialTelemetryProperties {
	const authProperties: AuthCredentialTelemetryProperties = {};

	const sessionStartedAtMs = credentials.metadata?.sessionStartedAtMs;

	if (
		typeof sessionStartedAtMs === "number" &&
		Number.isFinite(sessionStartedAtMs) &&
		sessionStartedAtMs > 0
	) {
		authProperties.sessionDurationMs = Date.now() - sessionStartedAtMs;
	}

	return authProperties;
}

function getAuthTelemetryDetails(
	credentials: ClineOAuthCredentials,
): AuthTelemetryDetails {
	return {
		...getAuthTokenTelemetryClaims(credentials.access),
		...getAuthCredentialTelemetryProperties(credentials),
	};
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
	options?: { requestTimeoutMs?: number; workOsBaseUrl?: string },
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
			options?.workOsBaseUrl?.trim() || DEFAULT_WORKOS_API_BASE_URL,
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
			{
				status: response.status,
				errorCode: json.error,
				requestId: response.headers.get("x-request-id") ?? undefined,
			},
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
		expiresInSeconds: clampDeviceAuthExpiresIn(json.expires_in),
		pollIntervalSeconds: clampDeviceAuthInterval(json.interval),
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
	// Clamp again here, not only where the authorization response is parsed: these
	// values cross a public API boundary, so a host may hand back whatever it was
	// told (or persisted) between the two calls.
	const deadline =
		Date.now() + clampDeviceAuthExpiresIn(options.expiresInSeconds) * 1000;
	let intervalSeconds = clampDeviceAuthInterval(
		options.initialPollIntervalSeconds,
	);

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
				intervalSeconds = clampSeconds(
					intervalSeconds + DEVICE_AUTH_SLOW_DOWN_INCREMENT_SECONDS,
					MAX_DEVICE_AUTH_INTERVAL_SECONDS,
				);
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
						requestId: response.headers.get("x-request-id") ?? undefined,
					},
				);
			}
			default: {
				throw new ClineOAuthTokenError(
					`WorkOS token polling failed: ${response.status}${payload.error_description ? ` - ${payload.error_description}` : ""}`,
					{
						status: response.status,
						errorCode: payload.error,
						requestId: response.headers.get("x-request-id") ?? undefined,
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
			{
				status: response.status,
				errorCode: details.code,
				requestId: response.headers.get("x-request-id") ?? undefined,
			},
		);
	}

	const json = (await response.json()) as ClineTokenResponse;
	return toClineCredentials(
		requireClineTokenResponse(json, "Invalid token exchange response"),
		provider ?? options.provider,
		{ metadata: { sessionStartedAtMs: Date.now() } },
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
			{
				status: response.status,
				errorCode: details.code,
				requestId: response.headers.get("x-request-id") ?? undefined,
			},
		);
	}

	const json = (await response.json()) as ClineTokenResponse;
	return toClineCredentials(
		requireClineTokenResponse(json, "Invalid token exchange response"),
		provider ?? options.provider,
		{ metadata: { sessionStartedAtMs: Date.now() } },
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
			const clientId = getClineEnvironmentConfig().workOsClientId;
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

		captureAuthSucceeded(
			options.telemetry,
			options.provider ?? "cline",
			getAuthTelemetryDetails(credentials),
		);
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
			{
				requestId:
					error instanceof ClineOAuthTokenError ? error.requestId : undefined,
			},
		);
		throw error;
	} finally {
		localServer?.close();
	}
}

export async function startClineDeviceAuth(options?: {
	requestTimeoutMs?: number;
	/** Host override for runtimes whose environment is selected outside Node env vars. */
	workOsClientId?: string;
	/**
	 * The api base the resulting device code will be registered against. Pass it
	 * whenever the host selects its environment outside Node env vars: the client
	 * id is then derived from the SAME environment instead of the
	 * production-by-default ambient config. See {@link resolveDeviceAuthClientId}.
	 */
	apiBaseUrl?: string;
	/** WorkOS API base override; defaults to `https://api.workos.com`. */
	workOsBaseUrl?: string;
}): Promise<{
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
}> {
	return await requestWorkOSDeviceAuthorization(
		resolveDeviceAuthClientId({
			apiBaseUrl: options?.apiBaseUrl,
			workOsClientId: options?.workOsClientId,
		}),
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
	/** Host override for runtimes whose environment is selected outside Node env vars. */
	workOsClientId?: string;
	/** WorkOS API base override; defaults to `https://api.workos.com`. */
	workOsBaseUrl?: string;
}): Promise<ClineOAuthCredentials> {
	const providerName = options.provider ?? "cline";
	captureAuthStarted(options.telemetry, providerName);
	try {
		const workosTokens = await pollWorkOSTokens({
			// Client id and api base come from ONE resolved environment: a staging
			// api base can never be paired with the production WorkOS client.
			clientId: resolveDeviceAuthClientId({
				apiBaseUrl: options.apiBaseUrl,
				workOsClientId: options.workOsClientId,
			}),
			deviceCode: options.deviceCode,
			expiresInSeconds: options.expiresInSeconds,
			initialPollIntervalSeconds: options.pollIntervalSeconds,
			requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
			workosApiBaseUrl:
				options.workOsBaseUrl?.trim() || DEFAULT_WORKOS_API_BASE_URL,
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
		captureAuthSucceeded(
			options.telemetry,
			providerName,
			getAuthTelemetryDetails(credentials),
		);
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
			{
				requestId:
					error instanceof ClineOAuthTokenError ? error.requestId : undefined,
			},
		);
		throw error;
	}
}

export async function refreshClineToken(
	current: ClineOAuthCredentials,
	options: ClineOAuthProviderOptions,
): Promise<ClineOAuthCredentials> {
	const refreshUrl = resolveUrl(
		options.apiBaseUrl,
		DEFAULT_AUTH_ENDPOINTS.refresh,
	);
	sdkDebug(`cline.refresh.request url=${refreshUrl}`);
	const response = await fetch(refreshUrl, {
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
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		const details = parseOAuthError(text);
		const requestId = response.headers.get("x-request-id") ?? undefined;
		sdkDebug(
			`cline.refresh.error status=${response.status} errorCode=${details.code ?? "none"} message=${details.message ?? "none"} requestId=${requestId ?? "none"}`,
		);
		throw new ClineOAuthTokenError(
			`Token refresh failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{ status: response.status, errorCode: details.code, requestId },
		);
	}

	const json = (await response.json()) as ClineTokenResponse;
	const provider =
		(current.metadata?.provider as string | undefined) ?? options.provider;
	const result = toClineCredentials(
		requireClineTokenResponse(json, "Invalid token refresh response"),
		provider,
		current,
	);
	sdkDebug(`cline.refresh.success expires=${result.expires}`);
	return result;
}

/**
 * Resolve valid Cline credentials, refreshing when needed.
 *
 * Contract: returns refreshed/current credentials when usable; returns `null`
 * ONLY when the refresh token was rejected (invalid grant — re-auth required);
 * THROWS on transient failures (network, timeout, 5xx) so callers can leave
 * stored credentials untouched and retry later.
 */
export async function getValidClineCredentials(
	currentCredentials: ClineOAuthCredentials | null,
	providerOptions: ClineOAuthProviderOptions,
	options?: ClineTokenResolution,
): Promise<ClineOAuthCredentials | null> {
	if (!currentCredentials) {
		sdkDebug("cline.getCredentials outcome=no_current_credentials");
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
		sdkDebug(
			`cline.getCredentials outcome=still_valid forceRefresh=${forceRefresh}`,
		);
		return currentCredentials;
	}

	sdkDebug(
		`cline.getCredentials outcome=needs_refresh forceRefresh=${forceRefresh}`,
	);

	try {
		return await refreshClineToken(currentCredentials, providerOptions);
	} catch (error) {
		const authTelemetryDetails = getAuthTelemetryDetails(currentCredentials);
		const requestIdDetails =
			error instanceof ClineOAuthTokenError && error.requestId
				? { request_id: error.requestId }
				: {};
		const failureDetails = {
			status: error instanceof ClineOAuthTokenError ? error.status : undefined,
			errorCode:
				error instanceof ClineOAuthTokenError ? error.errorCode : undefined,
			...requestIdDetails,
			...authTelemetryDetails,
			errorName: error instanceof Error ? error.name : undefined,
		};
		if (error instanceof ClineOAuthTokenError && error.isLikelyInvalidGrant()) {
			sdkDebug(
				`cline.getCredentials outcome=invalid_grant status=${error.status} errorCode=${error.errorCode ?? "none"}`,
			);
			// This is the single owner of the involuntary-logout event for the
			// Cline provider — callers observing the `null` return must NOT
			// emit their own user.auth_logged_out. `token_invalid` matches the
			// legacy extension's LogoutReason vocabulary so warehouse queries
			// cover both bundles; the raw OAuth code stays in `errorCode`.
			captureAuthLoggedOut(
				providerOptions.telemetry,
				providerOptions.provider ?? "cline",
				"token_invalid",
				{
					status: error.status,
					errorCode: error.errorCode,
					...requestIdDetails,
					...authTelemetryDetails,
				},
			);
			return null;
		}
		if (currentCredentials.expires - Date.now() > retryableTokenGraceMs) {
			// Keep current token on transient refresh failures while still valid.
			sdkDebug(
				`cline.getCredentials outcome=transient_failure_kept_current error=${error instanceof Error ? error.message : String(error)}`,
			);
			captureAuthRefreshSoftFailure(
				providerOptions.telemetry,
				providerOptions.provider ?? "cline",
				{ ...failureDetails, tokenExpired: false },
			);
			return currentCredentials;
		}
		// Transient failure with an already-expired token: rethrow instead of
		// returning null. A null from this function means the refresh token was
		// REJECTED (re-auth required); a network blip that happens to land after
		// expiry must not be mistaken for that — callers were wiping stored
		// credentials over it, logging out every Cline process on the machine.
		sdkDebug(
			`cline.getCredentials outcome=transient_failure_rethrown error=${error instanceof Error ? error.message : String(error)}`,
		);
		// Every one of these events was a hard logout before the
		// transient-vs-invalid_grant fix — the "prevented logout" counter.
		captureAuthRefreshSoftFailure(
			providerOptions.telemetry,
			providerOptions.provider ?? "cline",
			{ ...failureDetails, tokenExpired: true },
		);
		throw error;
	}
}
