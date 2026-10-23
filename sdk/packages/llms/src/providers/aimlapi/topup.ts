import {
	AimlapiApiError,
	type AimlapiCheckoutSession,
	AimlapiClient,
} from "./client";
import {
	AIMLAPI_DEFAULT_MODEL,
	buildAimlapiCheckoutReturnUrls,
	buildAimlapiReturnUrl,
	resolveAimlapiEndpoints,
	resolveAimlapiPartner,
} from "./config";
import { parseAimlapiAmountUsd } from "./validation";

export type AimlapiTopUpStatus =
	| "creating-session"
	| "opening-checkout"
	| "waiting-payment"
	| "provisioning-key";

export interface AimlapiProvisionedKey {
	apiKey: string;
	apiKeyId: string;
	baseUrl: string;
	model: string;
}

export interface ProvisionAimlapiKeyOptions {
	sessionToken: string;
	exchange: boolean;
	existingApiKey?: string;
	existingApiKeyId?: string;
	amountUsd?: string;
	autoTopUp?: boolean;
	model?: string;
	partnerId?: string;
	partnerName?: string;
	openCheckout: (url: string) => Promise<void> | void;
	onStatus?: (status: AimlapiTopUpStatus, detail?: string) => void;
	signal?: AbortSignal;
}

export interface ProvisionAimlapiKeyByKeyOptions {
	apiKey: string;
	amountUsd?: string;
	autoTopUp?: boolean;
	model?: string;
	partnerId?: string;
	partnerName?: string;
	openCheckout: (url: string) => Promise<void> | void;
	onStatus?: (status: AimlapiTopUpStatus, detail?: string) => void;
	signal?: AbortSignal;
}

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 20 * 60 * 1_000;

function abortError(signal?: AbortSignal): unknown {
	return (
		signal?.reason ??
		new DOMException("The operation was aborted.", "AbortError")
	);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw abortError(signal);
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => signal?.removeEventListener("abort", onAbort);
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			cleanup();
			reject(abortError(signal));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function pollAimlapiCheckoutUntilPaid(
	client: AimlapiClient,
	sessionToken: string,
	signal?: AbortSignal,
): Promise<AimlapiCheckoutSession> {
	const deadline = Date.now() + POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (signal?.aborted) throw abortError(signal);
		try {
			const session = await client.getSession(sessionToken, signal);
			switch (session.status) {
				case "paid":
				case "exchanging":
					return session;
				case "exchanged":
					throw new Error(
						"Session was already exchanged. Rotate the key from the aimlapi.com dashboard.",
					);
				case "cancelled":
				case "expired":
				case "failed":
					throw new Error(`Payment ${session.status}. Try the top-up again.`);
				default:
					await sleep(POLL_INTERVAL_MS, signal);
			}
		} catch (error) {
			if (signal?.aborted) throw abortError(signal);
			if (
				error instanceof AimlapiApiError &&
				(error.status === 0 || error.status >= 500)
			) {
				await sleep(POLL_INTERVAL_MS, signal);
				continue;
			}
			throw error;
		}
	}
	throw new Error("Timed out waiting for payment.");
}

export async function provisionAimlapiKey(
	options: ProvisionAimlapiKeyOptions,
): Promise<AimlapiProvisionedKey> {
	if (!options.sessionToken.trim()) {
		throw new Error("An aimlapi.com session is required to top up.");
	}
	const endpoints = resolveAimlapiEndpoints();
	const partner = resolveAimlapiPartner();
	const client = new AimlapiClient(endpoints);

	options.onStatus?.("creating-session");
	const session = await client.createSession(
		{
			partnerId: options.partnerId?.trim() || partner.id,
			partnerName: options.partnerName?.trim() || partner.name,
			returnUrl: buildAimlapiReturnUrl(endpoints.verificationBaseUrl),
		},
		options.signal,
	);
	const returnUrls = buildAimlapiCheckoutReturnUrls(
		endpoints.payBaseUrl,
		session.sessionToken,
	);
	const { checkout } = await client.pay(
		options.sessionToken,
		session.sessionToken,
		{
			amountUsdMinor: parseAimlapiAmountUsd(options.amountUsd),
			...returnUrls,
			autoTopUp: options.autoTopUp,
		},
		options.signal,
	);
	const checkoutUrl = checkout.payUrl?.trim();
	if (!checkoutUrl) {
		throw new Error("Payment provider did not return a checkout URL.");
	}
	options.onStatus?.("opening-checkout", checkoutUrl);
	await options.openCheckout(checkoutUrl);
	options.onStatus?.("waiting-payment");
	const paid = await pollAimlapiCheckoutUntilPaid(
		client,
		session.sessionToken,
		options.signal,
	);

	let apiKey = options.existingApiKey?.trim() || "";
	let apiKeyId = options.existingApiKeyId?.trim() || "";
	if (options.exchange) {
		options.onStatus?.("provisioning-key");
		const exchanged = await client.exchange(
			options.sessionToken,
			paid.sessionToken,
			options.signal,
		);
		apiKey = exchanged.apiKey?.trim();
		apiKeyId = exchanged.apiKeyId?.trim();
	}
	if (!apiKey) throw new Error("aimlapi.com did not return an API key.");
	return {
		apiKey,
		apiKeyId,
		baseUrl: endpoints.inferenceBaseUrl,
		model: options.model?.trim() || AIMLAPI_DEFAULT_MODEL,
	};
}

// newAimlapiPaymentSessionId returns a random UUIDv4-shaped idempotency id for a
// by-key top-up. Retries carrying the same id are coalesced onto the same
// checkout instead of charging twice.
function newAimlapiPaymentSessionId(): string {
	const webCrypto = globalThis.crypto;
	if (webCrypto?.randomUUID) return webCrypto.randomUUID();
	const bytes = new Uint8Array(16);
	if (webCrypto?.getRandomValues) {
		webCrypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// provisionAimlapiKeyByKey funds the account behind an existing API key via the
// hosted checkout, without an email session and without minting a new key. It
// runs create-session → pay-by-key → wait-for-payment and returns the same key
// unchanged — only the balance grows.
export async function provisionAimlapiKeyByKey(
	options: ProvisionAimlapiKeyByKeyOptions,
): Promise<AimlapiProvisionedKey> {
	const apiKey = options.apiKey.trim();
	if (!apiKey) {
		throw new Error("An aimlapi.com API key is required to top up.");
	}
	const endpoints = resolveAimlapiEndpoints();
	const partner = resolveAimlapiPartner();
	const client = new AimlapiClient(endpoints);

	options.onStatus?.("creating-session");
	const session = await client.createSession(
		{
			partnerId: options.partnerId?.trim() || partner.id,
			partnerName: options.partnerName?.trim() || partner.name,
			returnUrl: buildAimlapiReturnUrl(endpoints.verificationBaseUrl),
		},
		options.signal,
	);
	const returnUrls = buildAimlapiCheckoutReturnUrls(
		endpoints.payBaseUrl,
		session.sessionToken,
	);
	const { checkout } = await client.topUpByKey(
		apiKey,
		{
			sessionToken: session.sessionToken,
			amountUsdMinor: parseAimlapiAmountUsd(options.amountUsd),
			paymentSessionId: newAimlapiPaymentSessionId(),
			...returnUrls,
			autoTopUp: options.autoTopUp,
		},
		options.signal,
	);
	const checkoutUrl = checkout.payUrl?.trim();
	if (!checkoutUrl) {
		throw new Error("Payment provider did not return a checkout URL.");
	}
	options.onStatus?.("opening-checkout", checkoutUrl);
	await options.openCheckout(checkoutUrl);
	options.onStatus?.("waiting-payment");
	await pollAimlapiCheckoutUntilPaid(
		client,
		session.sessionToken,
		options.signal,
	);

	// No exchange: the account is funded and the caller keeps its existing key.
	return {
		apiKey,
		apiKeyId: "",
		baseUrl: endpoints.inferenceBaseUrl,
		model: options.model?.trim() || AIMLAPI_DEFAULT_MODEL,
	};
}
