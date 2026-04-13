import type { ITelemetryService } from "@clinebot/shared";
import { nanoid } from "nanoid";
import {
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthStarted,
	captureAuthSucceeded,
	identifyAccount,
} from "../telemetry/core-events";
import { BoundedTtlCache } from "./bounded-ttl-cache";
import { startLocalOAuthServer } from "./server";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthProviderInterface,
	OcaClientMetadata,
	OcaMode,
	OcaOAuthConfig,
	OcaOAuthProviderOptions,
	OcaTokenResolution,
} from "./types";
import {
	decodeJwtPayload,
	getProofKey,
	isCredentialLikelyExpired,
	normalizeBaseUrl,
	resolveAuthorizationCodeInput,
} from "./utils";

export const DEFAULT_INTERNAL_IDCS_CLIENT_ID =
	"a8331954c0cf48ba99b5dd223a14c6ea";
export const DEFAULT_INTERNAL_IDCS_URL =
	"https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com";
export const DEFAULT_INTERNAL_IDCS_SCOPES = "openid offline_access";
export const DEFAULT_INTERNAL_OCA_BASE_URL =
	"https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";

export const DEFAULT_EXTERNAL_IDCS_CLIENT_ID =
	"c1aba3deed5740659981a752714eba33";
export const DEFAULT_EXTERNAL_IDCS_URL =
	"https://login-ext.identity.oraclecloud.com";
export const DEFAULT_EXTERNAL_IDCS_SCOPES = "openid offline_access";
export const DEFAULT_EXTERNAL_OCA_BASE_URL =
	"https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";

export const OCI_HEADER_OPC_REQUEST_ID = "opc-request-id";

const DEFAULT_CALLBACK_PATH = "/auth/oca";
const DEFAULT_CALLBACK_PORTS = Array.from(
	{ length: 11 },
	(_, index) => 48801 + index,
);
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_RETRYABLE_TOKEN_GRACE_MS = 30 * 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 30 * 1000;
const PKCE_STATE_TTL_MS = 10 * 60 * 1000;

type OcaTokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	id_token?: string;
	error?: string;
	error_description?: string;
};

type OcaDiscoveryDocument = {
	token_endpoint?: string;
};

type OcaAuthFlowState = {
	verifier: string;
	nonce: string;
	mode: OcaMode;
	redirectUri: string;
	createdAt: number;
};

class OcaOAuthTokenError extends Error {
	public readonly status?: number;
	public readonly errorCode?: string;

	constructor(message: string, opts?: { status?: number; errorCode?: string }) {
		super(message);
		this.name = "OcaOAuthTokenError";
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
		return this.status === 400 || this.status === 401 || this.status === 403;
	}
}

const OCA_CONFIG_DEFAULTS: OcaOAuthConfig = {
	internal: {
		clientId: DEFAULT_INTERNAL_IDCS_CLIENT_ID,
		idcsUrl: DEFAULT_INTERNAL_IDCS_URL,
		scopes: DEFAULT_INTERNAL_IDCS_SCOPES,
		baseUrl: DEFAULT_INTERNAL_OCA_BASE_URL,
	},
	external: {
		clientId: DEFAULT_EXTERNAL_IDCS_CLIENT_ID,
		idcsUrl: DEFAULT_EXTERNAL_IDCS_URL,
		scopes: DEFAULT_EXTERNAL_IDCS_SCOPES,
		baseUrl: DEFAULT_EXTERNAL_OCA_BASE_URL,
	},
};

const OCA_FLOW_STATE = new Map<string, OcaAuthFlowState>();
/** OpenID discovery documents change rarely; bound memory in long-lived processes. */
const DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DISCOVERY_ERROR_FALLBACK_TTL_MS = 5 * 60 * 1000;
const DISCOVERY_CACHE_MAX_ENTRIES = 32;
const discoveryEndpointCache = new BoundedTtlCache(
	DISCOVERY_CACHE_TTL_MS,
	DISCOVERY_CACHE_MAX_ENTRIES,
);

function resolveMode(mode?: OcaMode | (() => OcaMode)): OcaMode {
	if (typeof mode === "function") {
		return mode();
	}
	return mode ?? "internal";
}

function resolveConfig(config?: Partial<OcaOAuthConfig>): OcaOAuthConfig {
	return {
		internal: {
			clientId:
				config?.internal?.clientId ?? OCA_CONFIG_DEFAULTS.internal.clientId,
			idcsUrl:
				config?.internal?.idcsUrl ?? OCA_CONFIG_DEFAULTS.internal.idcsUrl,
			scopes: config?.internal?.scopes ?? OCA_CONFIG_DEFAULTS.internal.scopes,
			baseUrl:
				config?.internal?.baseUrl ?? OCA_CONFIG_DEFAULTS.internal.baseUrl,
		},
		external: {
			clientId:
				config?.external?.clientId ?? OCA_CONFIG_DEFAULTS.external.clientId,
			idcsUrl:
				config?.external?.idcsUrl ?? OCA_CONFIG_DEFAULTS.external.idcsUrl,
			scopes: config?.external?.scopes ?? OCA_CONFIG_DEFAULTS.external.scopes,
			baseUrl:
				config?.external?.baseUrl ?? OCA_CONFIG_DEFAULTS.external.baseUrl,
		},
	};
}

function cleanupFlowState(now = Date.now()): void {
	const cutoff = now - PKCE_STATE_TTL_MS;
	for (const [state, value] of OCA_FLOW_STATE.entries()) {
		if (value.createdAt < cutoff) {
			OCA_FLOW_STATE.delete(state);
		}
	}
}

function resolveExpiryEpochMs(
	response: OcaTokenResponse,
	accessToken?: string,
	idToken?: string,
): number {
	if (typeof response.expires_in === "number" && response.expires_in > 0) {
		return Date.now() + response.expires_in * 1000;
	}
	const accessPayload = decodeJwtPayload(accessToken);
	const accessExp = accessPayload?.exp;
	if (typeof accessExp === "number" && accessExp > 0) {
		return accessExp * 1000;
	}
	const idPayload = decodeJwtPayload(idToken);
	const idExp = idPayload?.exp;
	if (typeof idExp === "number" && idExp > 0) {
		return idExp * 1000;
	}
	return Date.now() + 60 * 60 * 1000;
}

function toOcaCredentials(
	response: OcaTokenResponse,
	mode: OcaMode,
	fallback?: OAuthCredentials,
): OAuthCredentials {
	const accessToken = response.access_token;
	if (!accessToken) {
		throw new Error("Token response did not include an access token");
	}
	const refreshToken = response.refresh_token ?? fallback?.refresh;
	if (!refreshToken) {
		throw new Error("Token response did not include a refresh token");
	}

	const idPayload = decodeJwtPayload(response.id_token);
	const accessPayload = decodeJwtPayload(accessToken);
	const sub =
		(idPayload?.sub as string | undefined) ??
		(accessPayload?.sub as string | undefined);
	const email =
		(idPayload?.email as string | undefined) ??
		(accessPayload?.email as string | undefined);

	return {
		access: accessToken,
		refresh: refreshToken,
		expires: resolveExpiryEpochMs(response, accessToken, response.id_token),
		accountId: sub ?? fallback?.accountId,
		email: email ?? fallback?.email,
		metadata: {
			...(fallback?.metadata ?? {}),
			provider: "oca",
			mode,
			subject: sub,
			idToken: response.id_token,
		},
	};
}

async function discoverTokenEndpoint(
	idcsUrl: string,
	requestTimeoutMs: number,
): Promise<string> {
	const normalizedIdcsUrl = normalizeBaseUrl(idcsUrl);
	const cached = discoveryEndpointCache.get(normalizedIdcsUrl);
	if (cached) {
		return cached;
	}

	const discoveryUrl = `${normalizedIdcsUrl}/.well-known/openid-configuration`;
	const response = await fetch(discoveryUrl, {
		method: "GET",
		signal: AbortSignal.timeout(requestTimeoutMs),
	});

	if (!response.ok) {
		const fallback = `${normalizedIdcsUrl}/oauth2/v1/token`;
		discoveryEndpointCache.set(
			normalizedIdcsUrl,
			fallback,
			Date.now(),
			DISCOVERY_ERROR_FALLBACK_TTL_MS,
		);
		return fallback;
	}

	const discovery = (await response.json()) as OcaDiscoveryDocument;
	const endpoint =
		discovery.token_endpoint || `${normalizedIdcsUrl}/oauth2/v1/token`;
	discoveryEndpointCache.set(normalizedIdcsUrl, endpoint);
	return endpoint;
}

function parseOAuthErrorPayload(payload: OcaTokenResponse): {
	code?: string;
	message?: string;
} {
	return {
		code: payload.error,
		message: payload.error_description,
	};
}

async function exchangeAuthorizationCode(input: {
	code: string;
	state: string;
	mode: OcaMode;
	config: OcaOAuthConfig;
	requestTimeoutMs: number;
}): Promise<OAuthCredentials> {
	const flowState = OCA_FLOW_STATE.get(input.state);
	if (!flowState) {
		throw new Error("No PKCE verifier found for this state");
	}
	OCA_FLOW_STATE.delete(input.state);

	const envConfig =
		input.mode === "external" ? input.config.external : input.config.internal;
	const tokenEndpoint = await discoverTokenEndpoint(
		envConfig.idcsUrl,
		input.requestTimeoutMs,
	);

	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code: input.code,
		redirect_uri: flowState.redirectUri,
		client_id: envConfig.clientId,
		code_verifier: flowState.verifier,
	});

	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
		signal: AbortSignal.timeout(input.requestTimeoutMs),
	});

	const tokenPayload = (await response.json()) as OcaTokenResponse;
	if (!response.ok) {
		const details = parseOAuthErrorPayload(tokenPayload);
		throw new OcaOAuthTokenError(
			`Token exchange failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{ status: response.status, errorCode: details.code },
		);
	}

	const idPayload = decodeJwtPayload(tokenPayload.id_token);
	if (!tokenPayload.id_token || !idPayload) {
		throw new Error("No ID token received from OCA");
	}
	if (idPayload.nonce !== flowState.nonce) {
		throw new Error("OIDC nonce verification failed");
	}

	return toOcaCredentials(tokenPayload, input.mode);
}

function buildAuthorizationUrl(input: {
	callbackUrl: string;
	mode: OcaMode;
	state: string;
	nonce: string;
	challenge: string;
	config: OcaOAuthConfig;
}): string {
	const envConfig =
		input.mode === "external" ? input.config.external : input.config.internal;
	const authorizeUrl = new URL(
		`${normalizeBaseUrl(envConfig.idcsUrl)}/oauth2/v1/authorize`,
	);
	authorizeUrl.searchParams.set("client_id", envConfig.clientId);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("scope", envConfig.scopes);
	authorizeUrl.searchParams.set("code_challenge", input.challenge);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");
	authorizeUrl.searchParams.set("redirect_uri", input.callbackUrl);
	authorizeUrl.searchParams.set("state", input.state);
	authorizeUrl.searchParams.set("nonce", input.nonce);
	return authorizeUrl.toString();
}

export async function loginOcaOAuth(
	options: OcaOAuthProviderOptions & {
		callbacks: OAuthLoginCallbacks;
		telemetry?: ITelemetryService;
	},
): Promise<OAuthCredentials> {
	captureAuthStarted(options.telemetry, "oca");
	const config = resolveConfig(options.config);
	const mode = resolveMode(options.mode);
	const callbackPorts = options.callbackPorts?.length
		? options.callbackPorts
		: DEFAULT_CALLBACK_PORTS;
	const callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH;
	const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

	const localServer = await startLocalOAuthServer({
		ports: callbackPorts,
		callbackPath,
		onListening: options.callbacks.onServerListening,
		onClose: options.callbacks.onServerClose,
	});
	const callbackUrl = localServer.callbackUrl;
	if (!callbackUrl) {
		throw new Error("Unable to bind local OAuth callback server");
	}

	const state = nanoid(16);
	const nonce = nanoid(16);
	const { verifier, challenge } = await getProofKey();
	cleanupFlowState();
	OCA_FLOW_STATE.set(state, {
		verifier,
		nonce,
		mode,
		redirectUri: callbackUrl,
		createdAt: Date.now(),
	});

	const authUrl = buildAuthorizationUrl({
		callbackUrl,
		mode,
		state,
		nonce,
		challenge,
		config,
	});
	options.callbacks.onAuth({
		url: authUrl,
		instructions: "Continue the authentication process in your browser.",
	});

	try {
		const authResult = await resolveAuthorizationCodeInput({
			waitForCallback: localServer.waitForCallback,
			cancelWait: localServer.cancelWait,
			onManualCodeInput: options.callbacks.onManualCodeInput,
		});
		const code = authResult.code;
		const returnedState = authResult.state;
		if (authResult.error) {
			throw new Error(`OAuth error: ${authResult.error}`);
		}

		if (!code) {
			if (!options.callbacks.onManualCodeInput) {
				throw new Error("Timed out waiting for OCA callback");
			}
			throw new Error("Missing authorization code");
		}
		if (!returnedState || returnedState !== state) {
			throw new Error("State mismatch");
		}

		const credentials = await exchangeAuthorizationCode({
			code,
			state: returnedState,
			mode,
			config,
			requestTimeoutMs,
		});
		captureAuthSucceeded(options.telemetry, "oca");
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: "oca",
		});
		return credentials;
	} catch (error) {
		captureAuthFailed(
			options.telemetry,
			"oca",
			error instanceof Error ? error.message : String(error),
		);
		throw error;
	} finally {
		localServer.close();
	}
}

export async function refreshOcaToken(
	credentials: OAuthCredentials,
	options: OcaOAuthProviderOptions = {},
): Promise<OAuthCredentials> {
	const config = resolveConfig(options.config);
	const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
	const metadataMode = credentials.metadata?.mode;
	const mode: OcaMode =
		metadataMode === "internal" || metadataMode === "external"
			? metadataMode
			: resolveMode(options.mode);
	const envConfig = mode === "external" ? config.external : config.internal;
	const tokenEndpoint = await discoverTokenEndpoint(
		envConfig.idcsUrl,
		requestTimeoutMs,
	);

	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: credentials.refresh,
		client_id: envConfig.clientId,
	});

	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
		signal: AbortSignal.timeout(requestTimeoutMs),
	});

	const tokenPayload = (await response.json()) as OcaTokenResponse;
	if (!response.ok) {
		const details = parseOAuthErrorPayload(tokenPayload);
		throw new OcaOAuthTokenError(
			`Token refresh failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{ status: response.status, errorCode: details.code },
		);
	}

	return toOcaCredentials(tokenPayload, mode, credentials);
}

export async function getValidOcaCredentials(
	currentCredentials: OAuthCredentials | null,
	options?: OcaTokenResolution & { telemetry?: ITelemetryService },
	providerOptions?: OcaOAuthProviderOptions & { telemetry?: ITelemetryService },
): Promise<OAuthCredentials | null> {
	if (!currentCredentials) {
		return null;
	}

	const refreshBufferMs =
		options?.refreshBufferMs ??
		providerOptions?.refreshBufferMs ??
		DEFAULT_REFRESH_BUFFER_MS;
	const retryableTokenGraceMs =
		options?.retryableTokenGraceMs ??
		providerOptions?.retryableTokenGraceMs ??
		DEFAULT_RETRYABLE_TOKEN_GRACE_MS;
	const forceRefresh = options?.forceRefresh === true;

	if (
		!forceRefresh &&
		!isCredentialLikelyExpired(currentCredentials, refreshBufferMs)
	) {
		return currentCredentials;
	}

	try {
		return await refreshOcaToken(currentCredentials, providerOptions);
	} catch (error) {
		if (error instanceof OcaOAuthTokenError && error.isLikelyInvalidGrant()) {
			captureAuthLoggedOut(providerOptions?.telemetry, "oca", "invalid_grant");
			return null;
		}
		if (currentCredentials.expires - Date.now() > retryableTokenGraceMs) {
			return currentCredentials;
		}
		return null;
	}
}

export function createOcaOAuthProvider(
	options: OcaOAuthProviderOptions = {},
): OAuthProviderInterface {
	return {
		id: "oca",
		name: "Oracle Code Assist",
		usesCallbackServer: true,
		async login(callbacks) {
			return loginOcaOAuth({ ...options, callbacks });
		},
		async refreshToken(credentials) {
			return refreshOcaToken(credentials, options);
		},
		getApiKey(credentials) {
			return credentials.access;
		},
	};
}

export async function generateOcaOpcRequestId(
	taskId: string,
	token: string,
): Promise<string> {
	const encoder = new TextEncoder();
	const hash8 = async (value: string): Promise<string> => {
		const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
		return Array.from(new Uint8Array(digest).slice(0, 4), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
	};

	const [tokenHex, taskHex] = await Promise.all([hash8(token), hash8(taskId)]);
	const timestampHex = Math.floor(Date.now() / 1000)
		.toString(16)
		.padStart(8, "0");
	const randomPart = new Uint32Array(1);
	crypto.getRandomValues(randomPart);
	const randomHex = (randomPart[0] ?? 0).toString(16).padStart(8, "0");
	return tokenHex + taskHex + timestampHex + randomHex;
}

export async function createOcaRequestHeaders(input: {
	accessToken: string;
	taskId: string;
	metadata?: OcaClientMetadata;
}): Promise<Record<string, string>> {
	const opcRequestId = await generateOcaOpcRequestId(
		input.taskId,
		input.accessToken,
	);
	return {
		Authorization: `Bearer ${input.accessToken}`,
		"Content-Type": "application/json",
		client: input.metadata?.client ?? "Cline",
		"client-version": input.metadata?.clientVersion ?? "unknown",
		"client-ide": input.metadata?.clientIde ?? "unknown",
		"client-ide-version": input.metadata?.clientIdeVersion ?? "unknown",
		[OCI_HEADER_OPC_REQUEST_ID]: opcRequestId,
	};
}
