import type { ITelemetryService } from "@cline/shared";
import {
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthRefreshSoftFailure,
	captureAuthStarted,
	captureAuthSucceeded,
	identifyAccount,
} from "../services/telemetry/core-events";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./types";
import { decodeJwtPayload, parseOAuthError } from "./utils";

export const XAI_SUBSCRIPTION_PROVIDER_ID = "xai-subscription";

export const XAI_OAUTH_CONFIG = {
	clientId: "b1a00492-073a-47ea-816f-4c329264a828",
	deviceAuthorizationEndpoint: "https://auth.x.ai/oauth2/device/code",
	tokenEndpoint: "https://auth.x.ai/oauth2/token",
	scopes: "openid profile email offline_access grok-cli:access api:access",
	referrer: "cline",
	deviceGrantType: "urn:ietf:params:oauth:grant-type:device_code",
	refreshBufferMs: 2 * 60 * 1000,
	retryableTokenGraceMs: 30 * 1000,
	requestTimeoutMs: 30 * 1000,
	defaultPollIntervalSeconds: 5,
	minimumPollIntervalSeconds: 1,
	slowDownIncrementSeconds: 5,
	pollingSafetyMarginSeconds: 3,
	defaultDeviceExpirySeconds: 5 * 60,
	defaultAccessTokenExpirySeconds: 60 * 60,
} as const;

export interface XaiOAuthProviderOptions {
	clientId?: string;
	deviceAuthorizationEndpoint?: string;
	tokenEndpoint?: string;
	scopes?: string;
	referrer?: string;
	requestTimeoutMs?: number;
	refreshBufferMs?: number;
	retryableTokenGraceMs?: number;
	sleep?: (milliseconds: number) => Promise<void>;
	now?: () => number;
	telemetry?: ITelemetryService;
}

export interface XaiTokenResolution {
	forceRefresh?: boolean;
	refreshBufferMs?: number;
	retryableTokenGraceMs?: number;
}

interface XaiDeviceAuthorizationResponse {
	device_code?: string;
	user_code?: string;
	verification_uri?: string;
	verification_uri_complete?: string;
	expires_in?: number;
	interval?: number;
	error?: string;
	error_description?: string;
}

interface XaiTokenResponse {
	access_token?: string;
	refresh_token?: string;
	id_token?: string;
	token_type?: string;
	expires_in?: number;
	scope?: string;
	error?: string;
	error_description?: string;
}

interface XaiDeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
}

class XaiOAuthTokenError extends Error {
	public readonly status?: number;
	public readonly errorCode?: string;

	constructor(
		message: string,
		options?: { status?: number; errorCode?: string },
	) {
		super(message);
		this.name = "XaiOAuthTokenError";
		this.status = options?.status;
		this.errorCode = options?.errorCode;
	}

	public isLikelyInvalidGrant(): boolean {
		if (
			this.errorCode &&
			/invalid_grant|invalid_token|unauthorized|access_denied/i.test(
				this.errorCode,
			)
		) {
			return true;
		}
		if (this.status === 401 || this.status === 403) {
			return true;
		}
		return (
			this.status === 400 &&
			/invalid_grant|revoked|expired|invalid refresh/i.test(this.message)
		);
	}
}

function now(options: XaiOAuthProviderOptions): number {
	return options.now?.() ?? Date.now();
}

async function sleep(
	milliseconds: number,
	options: XaiOAuthProviderOptions,
): Promise<void> {
	if (options.sleep) {
		await options.sleep(milliseconds);
		return;
	}
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveSeconds(value: unknown, fallback: number): number {
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0
		? Math.max(1, Math.floor(seconds))
		: fallback;
}

async function readJsonResponse<T>(
	response: Response,
): Promise<{ payload: T; raw: string }> {
	const raw = await response.text().catch(() => "");
	if (!raw) {
		return { payload: {} as T, raw };
	}
	try {
		return { payload: JSON.parse(raw) as T, raw };
	} catch {
		return { payload: {} as T, raw };
	}
}

function resolveExpiryEpochMs(
	response: XaiTokenResponse,
	options: XaiOAuthProviderOptions,
): number {
	const candidates: number[] = [];
	const expiresInSeconds = Number(response.expires_in);
	if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
		candidates.push(now(options) + expiresInSeconds * 1000);
	}

	const accessTokenExp = decodeJwtPayload(response.access_token)?.exp;
	if (typeof accessTokenExp === "number" && accessTokenExp > 0) {
		candidates.push(accessTokenExp * 1000);
	}
	if (candidates.length > 0) {
		return Math.min(...candidates);
	}

	return now(options) + XAI_OAUTH_CONFIG.defaultAccessTokenExpirySeconds * 1000;
}

function toXaiCredentials(
	response: XaiTokenResponse,
	options: XaiOAuthProviderOptions,
	fallback?: OAuthCredentials,
): OAuthCredentials {
	const accessToken = response.access_token?.trim();
	if (!accessToken) {
		throw new Error("xAI token response did not include an access token");
	}
	const refreshToken = response.refresh_token?.trim() || fallback?.refresh;
	if (!refreshToken) {
		throw new Error("xAI token response did not include a refresh token");
	}

	const idPayload = decodeJwtPayload(response.id_token);
	const accessPayload = decodeJwtPayload(accessToken);
	const accountId =
		(typeof idPayload?.sub === "string" ? idPayload.sub : undefined) ??
		(typeof accessPayload?.sub === "string" ? accessPayload.sub : undefined) ??
		fallback?.accountId;
	const email =
		(typeof idPayload?.email === "string" ? idPayload.email : undefined) ??
		(typeof accessPayload?.email === "string"
			? accessPayload.email
			: undefined) ??
		fallback?.email;

	return {
		access: accessToken,
		refresh: refreshToken,
		expires: resolveExpiryEpochMs(response, options),
		accountId,
		email,
		metadata: {
			...(fallback?.metadata ?? {}),
			provider: XAI_SUBSCRIPTION_PROVIDER_ID,
			tokenType: response.token_type,
			scope: response.scope,
		},
	};
}

async function requestDeviceAuthorization(
	options: XaiOAuthProviderOptions,
): Promise<XaiDeviceAuthorization> {
	const body = new URLSearchParams({
		client_id: options.clientId ?? XAI_OAUTH_CONFIG.clientId,
		scope: options.scopes ?? XAI_OAUTH_CONFIG.scopes,
		referrer: options.referrer ?? XAI_OAUTH_CONFIG.referrer,
	});
	const response = await fetch(
		options.deviceAuthorizationEndpoint ??
			XAI_OAUTH_CONFIG.deviceAuthorizationEndpoint,
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
			signal: AbortSignal.timeout(
				options.requestTimeoutMs ?? XAI_OAUTH_CONFIG.requestTimeoutMs,
			),
		},
	);
	const { payload, raw } =
		await readJsonResponse<XaiDeviceAuthorizationResponse>(response);
	if (!response.ok) {
		throw new XaiOAuthTokenError(
			`xAI device authorization failed: ${response.status}${payload.error_description ? ` - ${payload.error_description}` : raw ? ` - ${raw}` : ""}`,
			{ status: response.status, errorCode: payload.error },
		);
	}
	if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
		throw new Error(
			"xAI device authorization response is missing device_code, user_code, or verification_uri",
		);
	}

	return {
		deviceCode: payload.device_code,
		userCode: payload.user_code,
		verificationUri: payload.verification_uri,
		verificationUriComplete: payload.verification_uri_complete,
		expiresInSeconds: positiveSeconds(
			payload.expires_in,
			XAI_OAUTH_CONFIG.defaultDeviceExpirySeconds,
		),
		pollIntervalSeconds: Math.max(
			positiveSeconds(
				payload.interval,
				XAI_OAUTH_CONFIG.defaultPollIntervalSeconds,
			),
			XAI_OAUTH_CONFIG.minimumPollIntervalSeconds,
		),
	};
}

async function pollDeviceToken(
	device: XaiDeviceAuthorization,
	options: XaiOAuthProviderOptions & {
		onProgress?: OAuthLoginCallbacks["onProgress"];
	},
): Promise<XaiTokenResponse> {
	const deadline = now(options) + device.expiresInSeconds * 1000;
	let pollIntervalSeconds = device.pollIntervalSeconds;

	while (now(options) < deadline) {
		const response = await fetch(
			options.tokenEndpoint ?? XAI_OAUTH_CONFIG.tokenEndpoint,
			{
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: XAI_OAUTH_CONFIG.deviceGrantType,
					client_id: options.clientId ?? XAI_OAUTH_CONFIG.clientId,
					device_code: device.deviceCode,
				}),
				signal: AbortSignal.timeout(
					options.requestTimeoutMs ?? XAI_OAUTH_CONFIG.requestTimeoutMs,
				),
			},
		);
		const { payload, raw } = await readJsonResponse<XaiTokenResponse>(response);
		if (response.ok) {
			return payload;
		}

		if (
			payload.error === "authorization_pending" ||
			payload.error === "slow_down"
		) {
			if (payload.error === "slow_down") {
				pollIntervalSeconds += XAI_OAUTH_CONFIG.slowDownIncrementSeconds;
			}
			options.onProgress?.("Waiting for xAI authorization confirmation...");
			const remainingMs = Math.max(0, deadline - now(options));
			const waitMs = Math.min(
				(pollIntervalSeconds + XAI_OAUTH_CONFIG.pollingSafetyMarginSeconds) *
					1000,
				remainingMs,
			);
			if (waitMs <= 0) {
				break;
			}
			await sleep(waitMs, options);
			continue;
		}

		if (
			payload.error === "access_denied" ||
			payload.error === "authorization_denied"
		) {
			throw new Error("xAI device authorization was denied");
		}
		if (payload.error === "expired_token") {
			throw new Error("xAI device code expired; start authentication again");
		}

		throw new XaiOAuthTokenError(
			`xAI device token exchange failed: ${response.status}${payload.error_description ? ` - ${payload.error_description}` : raw ? ` - ${raw}` : ""}`,
			{ status: response.status, errorCode: payload.error },
		);
	}

	throw new Error("xAI device authorization timed out");
}

export async function loginXaiOAuth(
	options: XaiOAuthProviderOptions & { callbacks: OAuthLoginCallbacks },
): Promise<OAuthCredentials> {
	captureAuthStarted(options.telemetry, XAI_SUBSCRIPTION_PROVIDER_ID);
	try {
		const device = await requestDeviceAuthorization(options);
		options.callbacks.onAuth({
			url: device.verificationUriComplete ?? device.verificationUri,
			instructions: `Open ${device.verificationUri} and enter code: ${device.userCode}`,
		});
		const tokenResponse = await pollDeviceToken(device, {
			...options,
			onProgress: options.callbacks.onProgress,
		});
		const credentials = toXaiCredentials(tokenResponse, options);
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: XAI_SUBSCRIPTION_PROVIDER_ID,
		});
		captureAuthSucceeded(options.telemetry, XAI_SUBSCRIPTION_PROVIDER_ID);
		return credentials;
	} catch (error) {
		captureAuthFailed(
			options.telemetry,
			XAI_SUBSCRIPTION_PROVIDER_ID,
			error instanceof Error ? error.message : String(error),
		);
		throw error;
	}
}

export async function refreshXaiToken(
	credentials: OAuthCredentials,
	options: XaiOAuthProviderOptions = {},
): Promise<OAuthCredentials> {
	const response = await fetch(
		options.tokenEndpoint ?? XAI_OAUTH_CONFIG.tokenEndpoint,
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: credentials.refresh,
				client_id: options.clientId ?? XAI_OAUTH_CONFIG.clientId,
			}),
			signal: AbortSignal.timeout(
				options.requestTimeoutMs ?? XAI_OAUTH_CONFIG.requestTimeoutMs,
			),
		},
	);
	const { payload, raw } = await readJsonResponse<XaiTokenResponse>(response);
	if (!response.ok) {
		const parsed = parseOAuthError(raw);
		throw new XaiOAuthTokenError(
			`xAI token refresh failed: ${response.status}${parsed.message ? ` - ${parsed.message}` : raw ? ` - ${raw}` : ""}`,
			{
				status: response.status,
				errorCode: parsed.code ?? payload.error,
			},
		);
	}
	return toXaiCredentials(payload, options, credentials);
}

export async function getValidXaiCredentials(
	currentCredentials: OAuthCredentials | null,
	options: XaiOAuthProviderOptions & XaiTokenResolution = {},
): Promise<OAuthCredentials | null> {
	if (!currentCredentials) {
		return null;
	}

	const refreshBufferMs =
		options.refreshBufferMs ?? XAI_OAUTH_CONFIG.refreshBufferMs;
	const retryableTokenGraceMs =
		options.retryableTokenGraceMs ?? XAI_OAUTH_CONFIG.retryableTokenGraceMs;
	if (
		options.forceRefresh !== true &&
		now(options) < currentCredentials.expires - refreshBufferMs
	) {
		return currentCredentials;
	}

	try {
		return await refreshXaiToken(currentCredentials, options);
	} catch (error) {
		const failureDetails = {
			status: error instanceof XaiOAuthTokenError ? error.status : undefined,
			errorCode:
				error instanceof XaiOAuthTokenError ? error.errorCode : undefined,
			errorName: error instanceof Error ? error.name : undefined,
		};
		if (error instanceof XaiOAuthTokenError && error.isLikelyInvalidGrant()) {
			captureAuthLoggedOut(
				options.telemetry,
				XAI_SUBSCRIPTION_PROVIDER_ID,
				"invalid_grant",
				{ status: error.status, errorCode: error.errorCode },
			);
			return null;
		}

		const tokenExpired =
			currentCredentials.expires - now(options) <= retryableTokenGraceMs;
		captureAuthRefreshSoftFailure(
			options.telemetry,
			XAI_SUBSCRIPTION_PROVIDER_ID,
			{ ...failureDetails, tokenExpired },
		);
		if (!tokenExpired && options.forceRefresh !== true) {
			return currentCredentials;
		}
		throw error;
	}
}
