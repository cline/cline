import { randomUUID } from "node:crypto";

const DEEP_LINK_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

export type DeepLinkOAuthTransaction = {
	providerId: string;
	redirectUri: string;
	expiresAt: number;
};

export class DeepLinkOAuthTransactionStore {
	private readonly pending = new Map<string, DeepLinkOAuthTransaction>();

	constructor(
		private readonly now: () => number = Date.now,
		private readonly createState: () => string = randomUUID,
	) {}

	begin(providerId: string): {
		state: string;
		transaction: DeepLinkOAuthTransaction;
	} {
		this.deleteExpired();
		const state = this.createState();
		const redirect = new URL("cline://auth");
		redirect.searchParams.set("state", state);
		const transaction = {
			providerId,
			redirectUri: redirect.toString(),
			expiresAt: this.now() + DEEP_LINK_OAUTH_TRANSACTION_TTL_MS,
		};
		this.pending.set(state, transaction);
		return { state, transaction };
	}

	consume(callback: URL): DeepLinkOAuthTransaction {
		const state = callback.searchParams.get("state")?.trim();
		if (!state) {
			throw new Error("OAuth callback is missing transaction state.");
		}
		const transaction = this.pending.get(state);
		// Consume before any asynchronous exchange so callbacks are single-use,
		// including when the exchange itself fails.
		this.pending.delete(state);
		if (!transaction) {
			throw new Error("OAuth callback does not match a pending login.");
		}
		if (transaction.expiresAt <= this.now()) {
			throw new Error("OAuth login has expired. Start sign-in again.");
		}
		return transaction;
	}

	private deleteExpired(): void {
		const now = this.now();
		for (const [state, transaction] of this.pending) {
			if (transaction.expiresAt <= now) this.pending.delete(state);
		}
	}
}
