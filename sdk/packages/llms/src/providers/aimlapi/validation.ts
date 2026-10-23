import {
	AIMLAPI_DEFAULT_AMOUNT_USD_MINOR,
	AIMLAPI_MAX_AMOUNT_USD_MINOR,
	AIMLAPI_MIN_AMOUNT_USD_MINOR,
} from "./config";

export function parseAimlapiAmountUsd(amountUsd: string | undefined): number {
	if (!amountUsd?.trim()) return AIMLAPI_DEFAULT_AMOUNT_USD_MINOR;
	const dollars = Number(amountUsd);
	if (!Number.isFinite(dollars) || dollars <= 0) {
		throw new Error(
			`Invalid amount: "${amountUsd}". Pass a positive number of USD.`,
		);
	}
	const minor = Math.round(dollars * 100);
	if (minor < AIMLAPI_MIN_AMOUNT_USD_MINOR) {
		throw new Error(
			`Minimum top-up is $${AIMLAPI_MIN_AMOUNT_USD_MINOR / 100}.`,
		);
	}
	if (minor > AIMLAPI_MAX_AMOUNT_USD_MINOR) {
		throw new Error(
			`Maximum top-up is $${AIMLAPI_MAX_AMOUNT_USD_MINOR / 100}.`,
		);
	}
	return minor;
}

// Wallet balances come back from /v1/billing/balance as raw credits, where
// 2,000,000 credits = $1. Convert to USD only for display — the low-balance
// decision is made server-side.
export const AIMLAPI_CREDITS_PER_USD = 2_000_000;

export function aimlapiCreditsToUsd(credits: number): number {
	return credits / AIMLAPI_CREDITS_PER_USD;
}

export function isValidAimlapiEmail(value: string): boolean {
	const email = value.trim();
	const match = /^[^\s@]+@([^\s@]+)$/.exec(email);
	if (!match) return false;
	const domain = match[1];
	if (
		!domain ||
		domain.startsWith(".") ||
		domain.endsWith(".") ||
		domain.includes("..")
	) {
		return false;
	}
	const labels = domain.split(".");
	const tld = labels.at(-1) ?? "";
	return labels.length >= 2 && /^[A-Za-z]{2,}$/.test(tld);
}
