/** Cline account balances arrive in millionths of a dollar. */
export function normalizeCreditBalance(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return value / 1_000_000;
}

export function formatCreditBalance(value: number, decimalPlaces = 2): string {
	if (!Number.isFinite(value)) {
		return "$0.00";
	}
	return `$${value.toLocaleString("en-US", {
		minimumFractionDigits: decimalPlaces,
		maximumFractionDigits: decimalPlaces,
	})}`;
}

/** Display form of a raw Cline account credit balance. */
export function formatClineCredits(value: number): string {
	return formatCreditBalance(normalizeCreditBalance(value));
}
