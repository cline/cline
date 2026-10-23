import type { AimlapiEndpoints } from "./config";

export type AimlapiCheckoutStatus =
	| "pending_auth"
	| "pending_payment"
	| "paid"
	| "exchanging"
	| "exchanged"
	| "cancelled"
	| "expired"
	| "failed";

export interface AimlapiCheckoutSession {
	id: string;
	sessionToken: string;
	partnerId: string;
	partnerName: string | null;
	userId: number | null;
	amountUsdMinor: number | null;
	status: AimlapiCheckoutStatus;
	issuedKeyId: string | null;
	returnUrl: string | null;
}

export interface AimlapiBalanceResult {
	balance: number;
	lowBalance: boolean;
	lowBalanceThreshold: number;
}

export type AimlapiAccountCheckResult = {
	action: "sign-in" | "sign-up";
	provider?: string | null;
};
export type AimlapiAuthResult = { token: string; exp: number };
export type AimlapiCreatedKey = { key: string; id: string };
export type AimlapiExchangeResult = { apiKey: string; apiKeyId: string };
export type AimlapiTopUpByKeyResult = {
	checkout: { providerSessionId: string; payUrl: string | null };
};

const REQUEST_TIMEOUT_MS = 60_000;

export class AimlapiApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: string,
	) {
		super(message);
		this.name = "AimlapiApiError";
	}
}

function combineWithTimeout(signal?: AbortSignal): {
	signal: AbortSignal;
	cleanup: () => void;
} {
	const controller = new AbortController();
	const onAbort = () => controller.abort(signal?.reason);
	signal?.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(
		() =>
			controller.abort(new DOMException("Request timed out.", "TimeoutError")),
		REQUEST_TIMEOUT_MS,
	);
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		},
	};
}

export class AimlapiClient {
	constructor(private readonly endpoints: AimlapiEndpoints) {}

	checkAccount(email: string, signal?: AbortSignal) {
		return this.request<AimlapiAccountCheckResult>(
			`${this.endpoints.authBaseUrl}/v1/auth/account`,
			{ method: "PATCH", body: { email }, signal },
		);
	}

	async sendSignInCode(email: string, signal?: AbortSignal): Promise<void> {
		await this.request<void>(
			`${this.endpoints.authBaseUrl}/v1/auth/sign-in/code`,
			{ method: "POST", body: { email }, signal },
		);
	}

	verifySignInCode(email: string, code: string, signal?: AbortSignal) {
		return this.request<AimlapiAuthResult>(
			`${this.endpoints.authBaseUrl}/v1/auth/sign-in/code/verify`,
			{ method: "POST", body: { email, code }, signal },
		);
	}

	createPasswordlessAccount(email: string, signal?: AbortSignal) {
		return this.request<AimlapiAuthResult>(
			`${this.endpoints.authBaseUrl}/v1/auth/account/passwordless`,
			{ method: "POST", body: { email }, signal },
		);
	}

	async createKey(bearer: string, name: string, signal?: AbortSignal) {
		const result = await this.request<AimlapiCreatedKey>(
			`${this.endpoints.appBaseUrl}/v1/keys`,
			{
				method: "POST",
				bearer,
				body: name.trim() ? { name: name.trim() } : {},
				signal,
			},
		);
		if (!result.key?.trim()) {
			throw new Error("aimlapi.com did not return an API key.");
		}
		return result;
	}

	getBalance(apiKey: string, signal?: AbortSignal) {
		return this.request<AimlapiBalanceResult>(
			`${this.endpoints.inferenceBaseUrl.replace(/\/+$/, "")}/billing/balance`,
			{ method: "GET", bearer: apiKey, signal },
		);
	}

	createSession(
		input: { partnerId: string; partnerName?: string; returnUrl?: string },
		signal?: AbortSignal,
	) {
		return this.request<AimlapiCheckoutSession>(
			`${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions`,
			{
				method: "POST",
				body: {
					partnerId: input.partnerId,
					...(input.partnerName ? { partnerName: input.partnerName } : {}),
					...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
				},
				signal,
			},
		);
	}

	getSession(sessionToken: string, signal?: AbortSignal) {
		return this.request<AimlapiCheckoutSession>(
			`${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}`,
			{ method: "GET", signal },
		);
	}

	pay(
		bearer: string,
		sessionToken: string,
		input: {
			amountUsdMinor: number;
			successUrl?: string;
			cancelUrl?: string;
			autoTopUp?: boolean;
		},
		signal?: AbortSignal,
	) {
		return this.request<{
			checkout: { providerSessionId: string; payUrl: string | null };
			partnerCheckout: AimlapiCheckoutSession;
		}>(
			`${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/pay`,
			{
				method: "POST",
				bearer,
				body: {
					amountUsdMinor: input.amountUsdMinor,
					method: "card",
					...(input.successUrl ? { successUrl: input.successUrl } : {}),
					...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
					...(input.autoTopUp ? { autoTopUp: true } : {}),
				},
				signal,
			},
		);
	}

	exchange(bearer: string, sessionToken: string, signal?: AbortSignal) {
		return this.request<AimlapiExchangeResult>(
			`${this.endpoints.appBaseUrl}/v3/partner-checkout/sessions/${encodeURIComponent(sessionToken)}/exchange`,
			{ method: "POST", bearer, signal },
		);
	}

	// topUpByKey funds a checkout session using the raw API key that owns the
	// account, returning the hosted checkout. The session is bound to the key's
	// account server-side, so no email session is needed and no key is exchanged.
	// paymentSessionId makes a retry idempotent (same id → same checkout, never a
	// second charge).
	topUpByKey(
		apiKey: string,
		input: {
			sessionToken: string;
			amountUsdMinor: number;
			paymentSessionId: string;
			successUrl?: string;
			cancelUrl?: string;
			autoTopUp?: boolean;
		},
		signal?: AbortSignal,
	) {
		return this.request<AimlapiTopUpByKeyResult>(
			this.billingV2Url("/billing/topup"),
			{
				method: "POST",
				bearer: apiKey,
				body: {
					sessionToken: input.sessionToken,
					amountUsdMinor: input.amountUsdMinor,
					paymentSessionId: input.paymentSessionId,
					...(input.successUrl ? { successUrl: input.successUrl } : {}),
					...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
					...(input.autoTopUp ? { autoTopUp: true } : {}),
				},
				signal,
			},
		);
	}

	// billingV2Url builds a v2 billing API URL from the inference base. The top-up
	// endpoint lives next to the balance endpoint on the API gateway, one version
	// up (".../v1" → ".../v2/billing/..."), so it re-anchors the version while
	// keeping any host/prefix an override supplied.
	private billingV2Url(path: string): string {
		const base = this.endpoints.inferenceBaseUrl
			.trim()
			.replace(/\/+$/, "")
			.replace(/\/v1$/, "")
			.replace(/\/+$/, "");
		return `${base}/v2${path}`;
	}

	private async request<T>(
		url: string,
		options: {
			method: "GET" | "POST" | "PATCH";
			body?: unknown;
			bearer?: string;
			signal?: AbortSignal;
		},
	): Promise<T> {
		const headers: Record<string, string> = { Accept: "application/json" };
		if (options.body !== undefined)
			headers["Content-Type"] = "application/json";
		if (options.bearer)
			headers.Authorization = `Bearer ${options.bearer.trim()}`;
		const combined = combineWithTimeout(options.signal);
		let response: Response;
		let text: string;
		try {
			response = await fetch(url, {
				method: options.method,
				headers,
				signal: combined.signal,
				...(options.body !== undefined
					? { body: JSON.stringify(options.body) }
					: {}),
			});
			text = await response.text();
		} catch (error) {
			if (options.signal?.aborted) throw error;
			const reason = error instanceof Error ? error.message : String(error);
			throw new AimlapiApiError(
				`Network request to ${url} failed: ${reason}`,
				0,
				"",
			);
		} finally {
			combined.cleanup();
		}

		if (!response.ok) {
			throw new AimlapiApiError(
				`${options.method} ${url} -> ${response.status}`,
				response.status,
				text,
			);
		}
		if (!text) return undefined as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			throw new AimlapiApiError(
				`${options.method} ${url} returned non-JSON body`,
				response.status,
				text,
			);
		}
	}
}
