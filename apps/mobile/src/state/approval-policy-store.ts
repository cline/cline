/**
 * Where the device remembers the user's auto-approve tiers.
 *
 * Deliberately shaped like {@link import("@/connection").SavedEndpointsStore}: a
 * pure in-memory value with optional write-through persistence that is *injected*,
 * so the store is safe to construct in a Node test and never imports
 * `expo-secure-store` itself (the adapter does, lazily).
 *
 * Reads are validated tier by tier. Missing settings use the new-install default;
 * unreadable saved choices ask rather than expanding unattended execution.
 */

import {
	APPROVAL_TIERS,
	type ApprovalPolicy,
	type ApprovalTier,
	type ApprovalTierSetting,
	DEFAULT_APPROVAL_POLICY,
} from "@/session";

/**
 * Async key/value persistence. Structurally identical to the connection layer's
 * `EndpointPersistence`, so `createExpoSecureStoreAdapter()` satisfies it.
 */
export interface SettingsPersistence {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	deleteItem(key: string): Promise<void>;
}

export const APPROVAL_POLICY_STORAGE_KEY = "cline.mobile.approvalPolicy.v1";

const UNREADABLE_POLICY: ApprovalPolicy = {
	read: "ask",
	write: "ask",
	execute: "ask",
};

function isTierSetting(value: unknown): value is ApprovalTierSetting {
	return value === "auto" || value === "ask";
}

/** Preserve valid choices; unreadable saved tiers ask. */
function parsePolicy(raw: string): ApprovalPolicy {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...UNREADABLE_POLICY };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ...UNREADABLE_POLICY };
	}
	const record = parsed as Record<string, unknown>;
	const policy = { ...UNREADABLE_POLICY };
	for (const tier of APPROVAL_TIERS) {
		const value = record[tier];
		if (isTierSetting(value)) {
			policy[tier] = value;
		}
	}
	return policy;
}

export class ApprovalPolicyStore {
	private policy: ApprovalPolicy = { ...DEFAULT_APPROVAL_POLICY };
	private readonly listeners = new Set<(policy: ApprovalPolicy) => void>();

	constructor(private readonly persistence?: SettingsPersistence) {}

	/** Loads the persisted policy, if any. Never throws. */
	async hydrate(): Promise<void> {
		if (!this.persistence) {
			return;
		}
		let raw: string | null = null;
		try {
			raw = await this.persistence.getItem(APPROVAL_POLICY_STORAGE_KEY);
		} catch {
			this.policy = { ...UNREADABLE_POLICY };
			this.emit();
			return;
		}
		if (raw === null) {
			return;
		}
		this.policy = parsePolicy(raw);
		this.emit();
	}

	get(): ApprovalPolicy {
		return this.policy;
	}

	subscribe(listener: (policy: ApprovalPolicy) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Flip one tier. Emits a fresh object so React re-renders. */
	async setTier(tier: ApprovalTier, value: ApprovalTierSetting): Promise<void> {
		await this.setPolicy({ ...this.policy, [tier]: value });
	}

	async setPolicy(policy: ApprovalPolicy): Promise<void> {
		this.policy = { ...policy };
		this.emit();
		await this.persist();
	}

	/** Back to the shipped default, forgetting the stored blob. */
	async reset(): Promise<void> {
		this.policy = { ...DEFAULT_APPROVAL_POLICY };
		this.emit();
		try {
			await this.persistence?.deleteItem(APPROVAL_POLICY_STORAGE_KEY);
		} catch {
			// A failed delete leaves a stale blob; the in-memory reset still stands.
		}
	}

	private emit(): void {
		const snapshot = this.policy;
		for (const listener of [...this.listeners]) {
			try {
				listener(snapshot);
			} catch {
				// A listener fault must not break the store.
			}
		}
	}

	private async persist(): Promise<void> {
		if (!this.persistence) {
			return;
		}
		try {
			await this.persistence.setItem(
				APPROVAL_POLICY_STORAGE_KEY,
				JSON.stringify(this.policy),
			);
		} catch {
			// Losing the write means the choice does not survive a restart; failing
			// the tap would be worse.
		}
	}
}
