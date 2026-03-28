/**
 * OpenAI Codex (ChatGPT OAuth) flow
 *
 * NOTE: This module uses Node.js crypto and http for the OAuth callback.
 * It is only intended for CLI use, not browser environments.
 */

import type { ITelemetryService } from "@clinebot/shared";
import { nanoid } from "nanoid";
import {
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthStarted,
	captureAuthSucceeded,
	identifyAccount,
} from "../telemetry/core-events";
import { startLocalOAuthServer } from "./server";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthPrompt,
	OAuthProviderInterface,
} from "./types";
import {
	decodeJwtPayload,
	getProofKey,
	isCredentialLikelyExpired,
	parseAuthorizationInput,
	parseOAuthError,
	resolveAuthorizationCodeInput,
} from "./utils";

export const OPENAI_CODEX_OAUTH_CONFIG = {
	authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
	tokenEndpoint: "https://auth.openai.com/oauth/token",
	clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
	redirectUri: "http://localhost:1455/auth/callback",
	scopes: "openid profile email offline_access",
	callbackPort: 1455,
	jwtClaimPath: "https://api.openai.com/auth",
	refreshBufferMs: 5 * 60 * 1000,
	retryableTokenGraceMs: 30 * 1000,
	httpTimeoutMs: 30 * 1000,
} as const;

type CodexTokenSuccess = {
	type: "success";
	access: string;
	refresh: string;
	expires: number;
	email?: string;
	idToken?: string;
};
type CodexTokenFailure = { type: "failed" };
type CodexTokenResult = CodexTokenSuccess | CodexTokenFailure;
export type RefreshTokenResolution = {
	forceRefresh?: boolean;
	refreshBufferMs?: number;
	retryableTokenGraceMs?: number;
};

type JwtPayload = {
	[OPENAI_CODEX_OAUTH_CONFIG.jwtClaimPath]?: {
		chatgpt_account_id?: string;
	};
	[key: string]: unknown;
};

class OpenAICodexOAuthTokenError extends Error {
	public readonly status?: number;
	public readonly errorCode?: string;

	constructor(message: string, opts?: { status?: number; errorCode?: string }) {
		super(message);
		this.name = "OpenAICodexOAuthTokenError";
		this.status = opts?.status;
		this.errorCode = opts?.errorCode;
	}

	public isLikelyInvalidGrant(): boolean {
		if (this.errorCode && /invalid_grant/i.test(this.errorCode)) {
			return true;
		}
		if (this.status === 400 || this.status === 401 || this.status === 403) {
			return /invalid_grant|revoked|expired|invalid refresh/i.test(
				this.message,
			);
		}
		return false;
	}
}

async function exchangeAuthorizationCode(
	code: string,
	verifier: string,
	redirectUri: string = OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
): Promise<CodexTokenResult> {
	const response = await fetch(OPENAI_CODEX_OAUTH_CONFIG.tokenEndpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
		signal: AbortSignal.timeout(OPENAI_CODEX_OAUTH_CONFIG.httpTimeoutMs),
	});

	if (!response.ok) {
		return { type: "failed" };
	}

	const json = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		email?: string;
		id_token?: string;
	};

	if (
		!json.access_token ||
		!json.refresh_token ||
		typeof json.expires_in !== "number"
	) {
		return { type: "failed" };
	}

	return {
		type: "success",
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
		email: json.email,
		idToken: json.id_token,
	};
}

async function refreshAccessToken(
	refreshToken: string,
): Promise<CodexTokenResult> {
	try {
		const response = await fetch(OPENAI_CODEX_OAUTH_CONFIG.tokenEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
			}),
			signal: AbortSignal.timeout(OPENAI_CODEX_OAUTH_CONFIG.httpTimeoutMs),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			const details = parseOAuthError(text);
			throw new OpenAICodexOAuthTokenError(
				`Token refresh failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
				{ status: response.status, errorCode: details.code },
			);
		}

		const json = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
			email?: string;
			id_token?: string;
		};

		if (
			!json.access_token ||
			!json.refresh_token ||
			typeof json.expires_in !== "number"
		) {
			return { type: "failed" };
		}

		return {
			type: "success",
			access: json.access_token,
			refresh: json.refresh_token,
			expires: Date.now() + json.expires_in * 1000,
			email: json.email,
			idToken: json.id_token,
		};
	} catch (error) {
		if (error instanceof OpenAICodexOAuthTokenError) {
			throw error;
		}
		return { type: "failed" };
	}
}

async function createAuthorizationFlow(
	originator = "pi",
): Promise<{ verifier: string; state: string; url: string }> {
	const { verifier, challenge } = await getProofKey();
	const state = nanoid(32);

	const url = new URL(OPENAI_CODEX_OAUTH_CONFIG.authorizationEndpoint);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", OPENAI_CODEX_OAUTH_CONFIG.clientId);
	url.searchParams.set("redirect_uri", OPENAI_CODEX_OAUTH_CONFIG.redirectUri);
	url.searchParams.set("scope", OPENAI_CODEX_OAUTH_CONFIG.scopes);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", originator);

	return { verifier, state, url: url.toString() };
}

function resolveCallbackServerConfig(): {
	host: string;
	port: number;
	callbackPath: string;
	redirectUri: string;
} {
	try {
		const redirect = new URL(OPENAI_CODEX_OAUTH_CONFIG.redirectUri);
		const parsedPort =
			redirect.port.length > 0
				? Number.parseInt(redirect.port, 10)
				: OPENAI_CODEX_OAUTH_CONFIG.callbackPort;
		return {
			host: redirect.hostname || "localhost",
			port: Number.isFinite(parsedPort)
				? parsedPort
				: OPENAI_CODEX_OAUTH_CONFIG.callbackPort,
			callbackPath: redirect.pathname || "/auth/callback",
			redirectUri: redirect.toString(),
		};
	} catch {
		return {
			host: "localhost",
			port: OPENAI_CODEX_OAUTH_CONFIG.callbackPort,
			callbackPath: "/auth/callback",
			redirectUri: OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
		};
	}
}

function getAccountId(accessToken: string, idToken?: string): string | null {
	const payload = (
		idToken ? decodeJwtPayload(idToken) : decodeJwtPayload(accessToken)
	) as JwtPayload | null;
	const fallback = (
		payload ? payload : decodeJwtPayload(accessToken)
	) as JwtPayload | null;
	const auth = fallback?.[OPENAI_CODEX_OAUTH_CONFIG.jwtClaimPath];
	const accountId = auth?.chatgpt_account_id;
	if (typeof accountId === "string" && accountId.length > 0) {
		return accountId;
	}

	const organizations = fallback?.organizations;
	if (Array.isArray(organizations) && organizations.length > 0) {
		const first = organizations[0] as { id?: unknown } | undefined;
		if (typeof first?.id === "string" && first.id.length > 0) {
			return first.id;
		}
	}

	const rootAccountId = fallback?.chatgpt_account_id;
	if (typeof rootAccountId === "string" && rootAccountId.length > 0) {
		return rootAccountId;
	}

	return null;
}

function toCodexCredentials(
	result: CodexTokenSuccess,
	fallback?: OAuthCredentials,
): OAuthCredentials {
	const accountId =
		getAccountId(result.access, result.idToken) ?? fallback?.accountId;
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}

	return {
		access: result.access,
		refresh: result.refresh || fallback?.refresh || "",
		expires: result.expires,
		accountId,
		email: result.email ?? fallback?.email,
		metadata: {
			...(fallback?.metadata ?? {}),
			provider: "openai-codex",
		},
	};
}

export async function loginOpenAICodex(options: {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	originator?: string;
	telemetry?: ITelemetryService;
}): Promise<OAuthCredentials> {
	captureAuthStarted(options.telemetry, "openai-codex");
	const callbackConfig = resolveCallbackServerConfig();
	const { verifier, state, url } = await createAuthorizationFlow(
		options.originator,
	);
	const server = await startLocalOAuthServer({
		host: callbackConfig.host,
		ports: [callbackConfig.port],
		callbackPath: callbackConfig.callbackPath,
		expectedState: state,
	});

	options.onAuth({
		url,
		instructions: "Continue the authentication process in your browser.",
	});

	let code: string | undefined;
	try {
		const authResult = await resolveAuthorizationCodeInput({
			waitForCallback: server.waitForCallback,
			cancelWait: server.cancelWait,
			onManualCodeInput: options.onManualCodeInput,
			parseOptions: { allowHashCodeState: true },
		});
		if (authResult.state && authResult.state !== state) {
			throw new Error("State mismatch");
		}
		code = authResult.code;

		// Fallback to onPrompt if still no code
		if (!code) {
			const input = await options.onPrompt({
				message: "Paste the authorization code (or full redirect URL):",
			});
			const parsed = parseAuthorizationInput(input, {
				allowHashCodeState: true,
			});
			if (parsed.state && parsed.state !== state) {
				throw new Error("State mismatch");
			}
			code = parsed.code;
		}

		if (!code) {
			throw new Error("Missing authorization code");
		}

		const tokenResult = await exchangeAuthorizationCode(
			code,
			verifier,
			callbackConfig.redirectUri,
		);
		if (tokenResult.type !== "success") {
			throw new Error("Token exchange failed");
		}

		const credentials = toCodexCredentials(tokenResult);
		captureAuthSucceeded(options.telemetry, "openai-codex");
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: "openai-codex",
		});
		return credentials;
	} catch (error) {
		captureAuthFailed(
			options.telemetry,
			"openai-codex",
			error instanceof Error ? error.message : String(error),
		);
		throw error;
	} finally {
		server.close();
	}
}

export async function refreshOpenAICodexToken(
	refreshToken: string,
	fallback?: OAuthCredentials,
): Promise<OAuthCredentials> {
	const result = await refreshAccessToken(refreshToken);
	if (result.type !== "success") {
		throw new Error("Failed to refresh OpenAI Codex token");
	}

	const normalized = toCodexCredentials(result, fallback);
	if (!normalized.refresh) {
		throw new Error(
			"Failed to refresh OpenAI Codex token: missing refresh token",
		);
	}
	return normalized;
}

export async function getValidOpenAICodexCredentials(
	currentCredentials: OAuthCredentials | null,
	options?: RefreshTokenResolution & { telemetry?: ITelemetryService },
): Promise<OAuthCredentials | null> {
	if (!currentCredentials) {
		return null;
	}

	const refreshBufferMs =
		options?.refreshBufferMs ?? OPENAI_CODEX_OAUTH_CONFIG.refreshBufferMs;
	const retryableTokenGraceMs =
		options?.retryableTokenGraceMs ??
		OPENAI_CODEX_OAUTH_CONFIG.retryableTokenGraceMs;
	const forceRefresh = options?.forceRefresh === true;

	if (
		!forceRefresh &&
		!isCredentialLikelyExpired(currentCredentials, refreshBufferMs)
	) {
		return currentCredentials;
	}

	try {
		const refreshed = await refreshOpenAICodexToken(
			currentCredentials.refresh,
			currentCredentials,
		);
		return refreshed;
	} catch (error) {
		if (
			error instanceof OpenAICodexOAuthTokenError &&
			error.isLikelyInvalidGrant()
		) {
			captureAuthLoggedOut(options?.telemetry, "openai-codex", "invalid_grant");
			return null;
		}
		if (currentCredentials.expires - Date.now() > retryableTokenGraceMs) {
			return currentCredentials;
		}
		return null;
	}
}

export function isOpenAICodexTokenExpired(
	credentials: OAuthCredentials,
	refreshBufferMs: number = OPENAI_CODEX_OAUTH_CONFIG.refreshBufferMs,
): boolean {
	return isCredentialLikelyExpired(credentials, refreshBufferMs);
}

export function normalizeOpenAICodexCredentials(
	credentials: OAuthCredentials,
): OAuthCredentials {
	const accountId = credentials.accountId ?? getAccountId(credentials.access);
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}
	return {
		...credentials,
		accountId,
		metadata: {
			...(credentials.metadata ?? {}),
			provider: "openai-codex",
		},
	};
}

export const openaiCodexOAuthProvider: OAuthProviderInterface = {
	id: "openai-codex",
	name: "ChatGPT Plus/Pro (ChatGPT Subscription)",
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginOpenAICodex({
			onAuth: callbacks.onAuth,
			onPrompt: callbacks.onPrompt,
			onProgress: callbacks.onProgress,
			onManualCodeInput: callbacks.onManualCodeInput,
		});
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshOpenAICodexToken(credentials.refresh, credentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
