/**
 * Billing plan shape surfaced to UIs (e.g. ClinePass upsell cards). The
 * canonical source is the Cline account API; hosts fetch plans and hand
 * them to presentation layers as plain data.
 */
export interface ClineSubscriptionPlan {
	displayName?: string;
	features?: {
		included?: string[];
		[key: string]: unknown;
	};
	id?: string;
	interval?: string;
	name?: string;
	pricePerSeatCents?: number;
	type?: string;
	[key: string]: unknown;
}
