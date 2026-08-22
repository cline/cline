import { getClineEnvironmentConfig } from "@cline/shared";

const WORKOS_DEVICE_AUTHORIZATION_PATH = "/user_management/authorize/device";
const WORKOS_AUTHENTICATE_PATH = "/user_management/authenticate";
const CLINE_REGISTER_PATH = "/api/v1/auth/register";
const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_DEVICE_AUTH_EXPIRES_IN_SECONDS = 300;
const DEFAULT_DEVICE_AUTH_INTERVAL_SECONDS = 5;

export type GatewayClineOAuthErrorCode =
	| "already_in_progress"
	| "authorization_failed"
	| "cancelled"
	| "invalid_response"
	| "timed_out";

export class GatewayClineOAuthError extends Error {
	constructor(
		public readonly code: GatewayClineOAuthErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "GatewayClineOAuthError";
	}
}

export interface GatewayClineOAuthCredentials {
	readonly access: string;
	readonly refresh: string;
	readonly expires: number;
	readonly accountId?: string;
	readonly email?: string;
	readonly metadata: Readonly<Record<string, unknown>>;
}

export interface GatewayClineOAuthLoginInput {
	readonly actor: string;
	readonly providerId: string;
	readonly openExternalUrl: (url: string, signal: AbortSignal) => Promise<void>;
	/** Persist through the Gateway provider-settings authority before success. */
	readonly persistCredentials: (
		credentials: GatewayClineOAuthCredentials,
	) => Promise<void> | void;
}

export interface GatewayClineOAuthPort {
	login(input: GatewayClineOAuthLoginInput): Promise<void>;
	cancel(providerId: string, actor?: string): boolean;
	cancelActor(actor: string): number;
}

type FetchImplementation = typeof fetch;

export interface GatewayClineOAuthServiceOptions {
	readonly fetchImpl?: FetchImplementation;
	readonly requestTimeoutMs?: number;
	readonly workosApiBaseUrl?: string;
	readonly apiBaseUrl?: string;
	readonly workOsClientId?: string;
	readonly now?: () => number;
	readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface ActiveLogin {
	readonly actor: string;
	readonly controller: AbortController;
}

interface DeviceAuthorization {
	readonly deviceCode: string;
	readonly userCode: string;
	readonly verificationUrl: string;
	readonly expiresInSeconds: number;
	readonly pollIntervalSeconds: number;
}

interface WorkOSTokens {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly tokenType: string;
}

function withTrailingSlash(value: string): string {
	return value.endsWith("/") ? value : `${value}/`;
}

function positiveSeconds(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: fallback;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultSleep(
	milliseconds: number,
	signal: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
			return;
		}
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, milliseconds);
		const onAbort = () => {
			clearTimeout(timeout);
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function cancellationError(cause?: unknown): GatewayClineOAuthError {
	return new GatewayClineOAuthError(
		"cancelled",
		"Cline sign-in was cancelled. Start sign-in again when you are ready.",
		cause === undefined ? undefined : { cause },
	);
}

function isAbort(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && error.name === "AbortError")
	);
}

/**
 * Gateway-owned Cline WorkOS device authorization.
 *
 * Credentials exist only inside this service and the Gateway provider store;
 * the connected host receives only the verification URL it must open.
 */
export class GatewayClineOAuthService implements GatewayClineOAuthPort {
	private readonly fetchImpl: FetchImplementation;
	private readonly requestTimeoutMs: number;
	private readonly workosApiBaseUrl: string;
	private readonly apiBaseUrl: string;
	private readonly workOsClientId: string;
	private readonly now: () => number;
	private readonly sleep: NonNullable<GatewayClineOAuthServiceOptions["sleep"]>;
	private readonly active = new Map<string, ActiveLogin>();

	constructor(options: GatewayClineOAuthServiceOptions = {}) {
		const environment = getClineEnvironmentConfig();
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.workosApiBaseUrl =
			options.workosApiBaseUrl ?? DEFAULT_WORKOS_API_BASE_URL;
		this.apiBaseUrl = options.apiBaseUrl ?? environment.apiBaseUrl;
		this.workOsClientId = options.workOsClientId ?? environment.workOsClientId;
		this.now = options.now ?? Date.now;
		this.sleep = options.sleep ?? defaultSleep;
	}

	async login(input: GatewayClineOAuthLoginInput): Promise<void> {
		const providerId = input.providerId.trim();
		if (providerId !== "cline") {
			throw new GatewayClineOAuthError(
				"authorization_failed",
				`Gateway OAuth sign-in is not available for provider "${providerId}".`,
			);
		}
		if (this.active.has(providerId)) {
			throw new GatewayClineOAuthError(
				"already_in_progress",
				"Cline sign-in is already in progress. Finish it in the browser or cancel it before retrying.",
			);
		}

		const controller = new AbortController();
		this.active.set(providerId, { actor: input.actor, controller });
		try {
			const authorization = await this.requestDeviceAuthorization(
				controller.signal,
			);
			await input.openExternalUrl(
				authorization.verificationUrl,
				controller.signal,
			);
			if (controller.signal.aborted) throw cancellationError();
			const workosTokens = await this.pollForTokens(
				authorization,
				controller.signal,
			);
			const credentials = await this.registerTokens(
				workosTokens,
				controller.signal,
			);
			if (controller.signal.aborted) throw cancellationError();
			await input.persistCredentials(credentials);
			if (controller.signal.aborted) throw cancellationError();
		} catch (error) {
			if (error instanceof GatewayClineOAuthError) throw error;
			if (controller.signal.aborted || isAbort(error)) {
				throw cancellationError(error);
			}
			throw new GatewayClineOAuthError(
				"authorization_failed",
				`Cline sign-in failed: ${error instanceof Error ? error.message : String(error)}. Retry sign-in; if it continues, check your network connection.`,
				{ cause: error },
			);
		} finally {
			if (this.active.get(providerId)?.controller === controller) {
				this.active.delete(providerId);
			}
		}
	}

	cancel(providerId: string, actor?: string): boolean {
		const active = this.active.get(providerId.trim());
		if (!active || (actor !== undefined && active.actor !== actor))
			return false;
		active.controller.abort(cancellationError());
		return true;
	}

	cancelActor(actor: string): number {
		let cancelled = 0;
		for (const [providerId, active] of this.active) {
			if (active.actor !== actor) continue;
			active.controller.abort(cancellationError());
			this.active.delete(providerId);
			cancelled += 1;
		}
		return cancelled;
	}

	private async request(
		url: URL,
		init: RequestInit,
		signal: AbortSignal,
	): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(new DOMException("Timed out", "TimeoutError")),
			this.requestTimeoutMs,
		);
		const onAbort = () => controller.abort(signal.reason);
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		try {
			return await this.fetchImpl(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timeout);
			signal.removeEventListener("abort", onAbort);
		}
	}

	private async requestDeviceAuthorization(
		signal: AbortSignal,
	): Promise<DeviceAuthorization> {
		const response = await this.request(
			new URL(
				WORKOS_DEVICE_AUTHORIZATION_PATH,
				withTrailingSlash(this.workosApiBaseUrl),
			),
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ client_id: this.workOsClientId }),
			},
			signal,
		);
		const payload = (await response.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		if (!response.ok) {
			throw new GatewayClineOAuthError(
				"authorization_failed",
				`Cline sign-in could not start (HTTP ${response.status})${nonEmptyString(payload.error_description) ? `: ${nonEmptyString(payload.error_description)}` : ""}. Retry sign-in.`,
			);
		}
		const deviceCode = nonEmptyString(payload.device_code);
		const userCode = nonEmptyString(payload.user_code);
		const verificationUri = nonEmptyString(payload.verification_uri);
		if (!deviceCode || !userCode || !verificationUri) {
			throw new GatewayClineOAuthError(
				"invalid_response",
				"Cline sign-in returned an invalid device authorization response. Retry sign-in.",
			);
		}
		return {
			deviceCode,
			userCode,
			verificationUrl:
				nonEmptyString(payload.verification_uri_complete) ?? verificationUri,
			expiresInSeconds: positiveSeconds(
				payload.expires_in,
				DEFAULT_DEVICE_AUTH_EXPIRES_IN_SECONDS,
			),
			pollIntervalSeconds: positiveSeconds(
				payload.interval,
				DEFAULT_DEVICE_AUTH_INTERVAL_SECONDS,
			),
		};
	}

	private async pollForTokens(
		authorization: DeviceAuthorization,
		signal: AbortSignal,
	): Promise<WorkOSTokens> {
		const deadline = this.now() + authorization.expiresInSeconds * 1_000;
		let pollIntervalSeconds = Math.max(1, authorization.pollIntervalSeconds);
		while (this.now() <= deadline) {
			if (signal.aborted) throw cancellationError();
			const response = await this.request(
				new URL(
					WORKOS_AUTHENTICATE_PATH,
					withTrailingSlash(this.workosApiBaseUrl),
				),
				{
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "urn:ietf:params:oauth:grant-type:device_code",
						device_code: authorization.deviceCode,
						client_id: this.workOsClientId,
					}),
				},
				signal,
			);
			const payload = (await response.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			if (response.ok) {
				const accessToken = nonEmptyString(payload.access_token);
				const refreshToken = nonEmptyString(payload.refresh_token);
				if (!accessToken || !refreshToken) {
					throw new GatewayClineOAuthError(
						"invalid_response",
						"Cline sign-in returned an invalid token response. Retry sign-in.",
					);
				}
				return {
					accessToken,
					refreshToken,
					tokenType: nonEmptyString(payload.token_type) ?? "Bearer",
				};
			}

			const code = nonEmptyString(payload.error);
			if (code === "authorization_pending" || code === "slow_down") {
				if (code === "slow_down") pollIntervalSeconds += 1;
				await this.sleep(pollIntervalSeconds * 1_000, signal);
				continue;
			}
			if (
				code === "access_denied" ||
				code === "expired_token" ||
				code === "invalid_grant"
			) {
				throw new GatewayClineOAuthError(
					"authorization_failed",
					nonEmptyString(payload.error_description) ??
						"Cline sign-in was not authorized. Start sign-in again.",
				);
			}
			throw new GatewayClineOAuthError(
				"authorization_failed",
				`Cline sign-in polling failed (HTTP ${response.status})${nonEmptyString(payload.error_description) ? `: ${nonEmptyString(payload.error_description)}` : ""}. Retry sign-in.`,
			);
		}
		throw new GatewayClineOAuthError(
			"timed_out",
			"Cline sign-in timed out before browser authorization completed. Start sign-in again.",
		);
	}

	private async registerTokens(
		tokens: WorkOSTokens,
		signal: AbortSignal,
	): Promise<GatewayClineOAuthCredentials> {
		const response = await this.request(
			new URL(CLINE_REGISTER_PATH, withTrailingSlash(this.apiBaseUrl)),
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					accessToken: tokens.accessToken,
					refreshToken: tokens.refreshToken,
				}),
			},
			signal,
		);
		const payload = (await response.json().catch(() => ({}))) as {
			success?: boolean;
			error?: string;
			data?: {
				accessToken?: string;
				refreshToken?: string;
				tokenType?: string;
				expiresAt?: string;
				userInfo?: Record<string, unknown> & {
					clineUserId?: string | null;
					email?: string;
				};
			};
		};
		if (!response.ok) {
			throw new GatewayClineOAuthError(
				"authorization_failed",
				`Cline sign-in token registration failed (HTTP ${response.status})${nonEmptyString(payload.error) ? `: ${nonEmptyString(payload.error)}` : ""}. Retry sign-in.`,
			);
		}
		const data = payload.data;
		const access = nonEmptyString(data?.accessToken);
		const refresh = nonEmptyString(data?.refreshToken) ?? tokens.refreshToken;
		const expires = Date.parse(data?.expiresAt ?? "");
		if (
			!payload.success ||
			!access ||
			!data?.userInfo ||
			Number.isNaN(expires)
		) {
			throw new GatewayClineOAuthError(
				"invalid_response",
				"Cline sign-in returned an invalid registration response. Retry sign-in.",
			);
		}
		return {
			access,
			refresh,
			expires,
			accountId: nonEmptyString(data.userInfo.clineUserId),
			email: nonEmptyString(data.userInfo.email),
			metadata: {
				provider: "cline",
				tokenType: nonEmptyString(data.tokenType) ?? tokens.tokenType,
				userInfo: data.userInfo,
				sessionStartedAtMs: this.now(),
			},
		};
	}
}
