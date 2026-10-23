/**
 * Hub-side device allowlist.
 *
 * This is the lock that makes relay account auth insufficient to control a
 * machine: a connection is only authorised if it proves possession of a device
 * private key whose public key is in this registry and not revoked.
 *
 * Persistence is injected — the Node fs implementation lives in the CLI/core so
 * this package stays importable from React Native.
 */
import { base64UrlToBytes, bytesToBase64Url } from "./bytes.js";
import {
	DeviceRecordInvalidError,
	DeviceRevokedError,
	DeviceUnknownError,
	SessionReplayError,
} from "./errors.js";
import {
	deviceFingerprint,
	deviceIdFromPublicKey,
	encodePublicKey,
} from "./keys.js";
import { hash } from "./noise/primitives.js";

/**
 * Tiers a tool can fall into. Classification of a given tool into a tier is NOT
 * this package's job — it belongs to the app/session layer. The registry only
 * persists the per-device policy so the laptop stays the authority on what an
 * enrolled device may do unattended.
 *
 * IMPORTANT: any tool the session layer cannot classify MUST be treated as
 * `execute` (fail closed). Do not widen this.
 */
export type ApprovalTier = "read" | "write" | "execute";

/** X25519 public key length; records carrying anything else are rejected. */
export const DEVICE_PUBLIC_KEY_LENGTH = 32;

export type ApprovalDecision = "auto" | "ask";

export type ApprovalPolicy = Record<ApprovalTier, ApprovalDecision>;

/**
 * A freshly enrolled device is conservative: it may read without prompting, but
 * writing and executing always ask. The user opts a device up after pairing.
 */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = Object.freeze({
	read: "auto",
	write: "ask",
	execute: "ask",
});

/** Every tier asks. Used as the floor for revoked / unknown-policy devices. */
export const STRICTEST_APPROVAL_POLICY: ApprovalPolicy = Object.freeze({
	read: "ask",
	write: "ask",
	execute: "ask",
});

export function normalizeApprovalPolicy(
	policy: Partial<ApprovalPolicy> | undefined,
): ApprovalPolicy {
	return {
		read: policy?.read === "auto" ? "auto" : "ask",
		write: policy?.write === "auto" ? "auto" : "ask",
		execute: policy?.execute === "auto" ? "auto" : "ask",
	};
}

export interface PairedDeviceRecord {
	readonly deviceId: string;
	/** base64url X25519 static public key. */
	readonly publicKey: string;
	readonly label: string;
	readonly pairedAt: string;
	readonly lastSeenAt?: string;
	readonly revokedAt?: string;
	/**
	 * Per-device tiered approval policy. Absent means "never set / dropped", which
	 * `getApprovalPolicy` reports as the strictest policy rather than the default,
	 * so a dropped policy can never be more permissive than an explicit one.
	 */
	readonly approvalPolicy?: ApprovalPolicy;
}

/** Injectable persistence. Implementations must be atomic enough for a laptop. */
export interface DeviceStore {
	load(): Promise<PairedDeviceRecord[]>;
	save(records: readonly PairedDeviceRecord[]): Promise<void>;
	/**
	 * Optional change notification, used to enforce revocations written by another
	 * process (see `DeviceRegistry.startRevocationWatch`). Implementations should
	 * fire on any change to the backing storage, including their own writes;
	 * spurious notifications are harmless because the registry only ever reacts by
	 * re-reading and closing channels that are no longer authorised.
	 */
	watch?(onChange: () => void): () => void;
}

/** Anything the registry can terminate when a device is revoked. */
export interface TerminableChannel {
	close(): void;
	/** When present, lets the registry drop channels that already ended. */
	readonly closed?: boolean;
}

/**
 * A record is only meaningful if its id is derived from its own public key.
 * Otherwise a hostile store can display one identity (`deviceId`, which is what
 * the user sees and grants policy to) while authorising a different key at
 * handshake time, because lookups go through `deviceIdFromPublicKey`.
 */
export function assertRecordSelfConsistent(
	record: PairedDeviceRecord,
): PairedDeviceRecord {
	let publicKey: Uint8Array;
	try {
		publicKey = base64UrlToBytes(record.publicKey);
	} catch (error) {
		throw new DeviceRecordInvalidError(
			`device ${record.deviceId} has a malformed public key: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (publicKey.length !== DEVICE_PUBLIC_KEY_LENGTH) {
		throw new DeviceRecordInvalidError(
			`device ${record.deviceId} has a ${publicKey.length}-byte public key; expected ${DEVICE_PUBLIC_KEY_LENGTH}`,
		);
	}
	const derived = deviceIdFromPublicKey(publicKey);
	if (derived !== record.deviceId) {
		throw new DeviceRecordInvalidError(
			`device id ${record.deviceId} does not match its public key (expected ${derived})`,
		);
	}
	return record;
}

export function createInMemoryDeviceStore(
	initial: readonly PairedDeviceRecord[] = [],
): DeviceStore {
	let records: PairedDeviceRecord[] = [...initial];
	return {
		async load() {
			return [...records];
		},
		async save(next) {
			records = [...next];
		},
	};
}

/** How long an accepted session handshake message stays remembered. */
export const DEFAULT_SESSION_REPLAY_WINDOW_MS = 10 * 60 * 1000;
/** Cap on remembered handshakes, so a flood cannot grow the map without bound. */
export const MAX_REMEMBERED_SESSION_HANDSHAKES = 4096;

export interface DeviceRegistryOptions {
	readonly now?: () => number;
	/** Overrides `DEFAULT_SESSION_REPLAY_WINDOW_MS`. */
	readonly sessionReplayWindowMs?: number;
}

export class DeviceRegistry {
	private readonly store: DeviceStore;
	private readonly now: () => number;
	private records = new Map<string, PairedDeviceRecord>();
	/** Live channels per device, so `revoke` can kill sessions already running. */
	private readonly liveChannels = new Map<string, Set<TerminableChannel>>();
	/** Digest -> first-seen timestamp, for session handshake replay rejection. */
	private readonly seenSessionHandshakes = new Map<string, number>();
	private readonly sessionReplayWindowMs: number;

	private constructor(store: DeviceStore, options: DeviceRegistryOptions = {}) {
		this.store = store;
		this.now = options.now ?? (() => Date.now());
		this.sessionReplayWindowMs =
			options.sessionReplayWindowMs ?? DEFAULT_SESSION_REPLAY_WINDOW_MS;
	}

	static async open(
		store: DeviceStore,
		options: DeviceRegistryOptions = {},
	): Promise<DeviceRegistry> {
		const registry = new DeviceRegistry(store, options);
		await registry.reload();
		return registry;
	}

	async reload(): Promise<void> {
		const loaded = await this.store.load();
		this.records = new Map(
			loaded.map((record) => [
				assertRecordSelfConsistent(record).deviceId,
				record,
			]),
		);
	}

	/**
	 * Re-reads the store and terminates every bound channel whose device is no
	 * longer authorised. This is how a revocation performed by ANOTHER process
	 * (e.g. `cline hub devices revoke`) reaches channels this process owns: the
	 * revoking process cannot touch our in-memory state, so the owner of the
	 * channel must be the one to enforce it.
	 *
	 * Guarantee: after this resolves, no channel bound to a device that the store
	 * reports as revoked or absent is still open, and no new session for such a
	 * device can be authorised by this registry.
	 */
	async syncRevocations(): Promise<void> {
		const previousPolicies = new Map(
			[...this.records.entries()].map(([deviceId, record]) => [
				deviceId,
				JSON.stringify(normalizeApprovalPolicy(record.approvalPolicy)),
			]),
		);
		await this.reload();
		for (const deviceId of [...this.liveChannels.keys()]) {
			const current = this.records.get(deviceId);
			const policyChanged =
				previousPolicies.get(deviceId) !==
				JSON.stringify(normalizeApprovalPolicy(current?.approvalPolicy));
			if (!this.isAuthorized(deviceId) || policyChanged) {
				this.terminateChannels(deviceId);
			}
		}
	}

	/**
	 * Enforces store-level revocations continuously, for as long as the returned
	 * stop function is uncalled. Requires a `DeviceStore` that implements `watch`;
	 * without one this is a no-op and the owner must call `syncRevocations`
	 * itself (e.g. on a timer, or before honouring a privileged frame).
	 *
	 * A failed reload is swallowed on purpose: a store that is momentarily
	 * unreadable must not crash the hub, and the registry keeps its last known
	 * good state. The consequence is that a revocation only takes effect once it
	 * has been durably and readably persisted.
	 */
	startRevocationWatch(): () => void {
		const watch = this.store.watch?.bind(this.store);
		if (!watch) {
			return () => {};
		}
		let pending: Promise<void> = Promise.resolve();
		const stop = watch(() => {
			pending = pending.then(() =>
				this.syncRevocations().catch(() => undefined),
			);
		});
		return () => {
			stop();
		};
	}

	private async persist(): Promise<void> {
		await this.store.save([...this.records.values()]);
	}

	list(options: { includeRevoked?: boolean } = {}): PairedDeviceRecord[] {
		const all = [...this.records.values()];
		const filtered = options.includeRevoked
			? all
			: all.filter((record) => !record.revokedAt);
		return filtered.sort((left, right) =>
			left.pairedAt.localeCompare(right.pairedAt),
		);
	}

	get(deviceId: string): PairedDeviceRecord | undefined {
		return this.records.get(deviceId);
	}

	findByPublicKey(publicKey: Uint8Array): PairedDeviceRecord | undefined {
		return this.records.get(deviceIdFromPublicKey(publicKey));
	}

	fingerprintOf(record: PairedDeviceRecord): string {
		return deviceFingerprint(base64UrlToBytes(record.publicKey));
	}

	async add(input: {
		publicKey: Uint8Array;
		label: string;
		approvalPolicy?: Partial<ApprovalPolicy>;
		pairedAt?: string;
	}): Promise<PairedDeviceRecord> {
		const deviceId = deviceIdFromPublicKey(input.publicKey);
		// A fresh physical pairing replaces the record, but any older socket still
		// carries the policy snapshot from before that ceremony. Drop it before the
		// replacement is installed; the newly paired socket is bound afterwards.
		if (this.records.has(deviceId)) {
			this.terminateChannels(deviceId);
		}
		const record: PairedDeviceRecord = {
			deviceId,
			publicKey: encodePublicKey(input.publicKey),
			label: input.label,
			pairedAt: input.pairedAt ?? new Date(this.now()).toISOString(),
			approvalPolicy: input.approvalPolicy
				? normalizeApprovalPolicy(input.approvalPolicy)
				: { ...DEFAULT_APPROVAL_POLICY },
		};
		// Re-pairing the same key clears any previous revocation deliberately: the
		// user physically scanned a fresh QR on the laptop to get here.
		this.records.set(deviceId, record);
		await this.persist();
		return record;
	}

	/**
	 * Marks the device revoked and terminates every channel currently bound to
	 * it, so revocation takes effect on in-flight connections rather than only at
	 * the next handshake.
	 *
	 * The in-memory mark and the channel kill happen BEFORE the store write: a
	 * persistence failure must never be able to leave a revoked device still
	 * encrypting. It does mean a failed write leaves the process revoked while the
	 * file still says otherwise, which is the fail-closed direction; the throw
	 * tells the caller to retry so the revocation survives a restart.
	 */
	async revoke(deviceId: string): Promise<PairedDeviceRecord> {
		const existing = this.records.get(deviceId);
		if (!existing) {
			throw new DeviceUnknownError(deviceId);
		}
		// Revocation drops the policy along with access, so a later re-pair starts
		// from the conservative default rather than inheriting opted-up permissions.
		const { approvalPolicy: _dropped, ...withoutPolicy } = existing;
		const revoked: PairedDeviceRecord = {
			...withoutPolicy,
			revokedAt: new Date(this.now()).toISOString(),
		};
		this.records.set(deviceId, revoked);
		this.terminateChannels(deviceId);
		await this.persist();
		return revoked;
	}

	async touch(deviceId: string): Promise<void> {
		const existing = this.records.get(deviceId);
		if (!existing) {
			return;
		}
		this.records.set(deviceId, {
			...existing,
			lastSeenAt: new Date(this.now()).toISOString(),
		});
		await this.persist();
	}

	/**
	 * Per-device policy. A revoked device, an unknown device, or a device whose
	 * policy was dropped all report the strictest policy — never the default — so
	 * a missing field can never read as more permissive than an explicit one.
	 */
	getApprovalPolicy(deviceId: string): ApprovalPolicy {
		const record = this.records.get(deviceId);
		if (!record || record.revokedAt || !record.approvalPolicy) {
			return { ...STRICTEST_APPROVAL_POLICY };
		}
		return normalizeApprovalPolicy(record.approvalPolicy);
	}

	/** Opts a device up or down. Refuses to set a policy on a revoked device. */
	async setApprovalPolicy(
		deviceId: string,
		policy: Partial<ApprovalPolicy>,
	): Promise<ApprovalPolicy> {
		const record = this.assertAuthorized(deviceId);
		const normalized = normalizeApprovalPolicy(policy);
		const previous = normalizeApprovalPolicy(record.approvalPolicy);
		this.records.set(deviceId, { ...record, approvalPolicy: normalized });
		// Active connections carry a policy snapshot. Reconnect them so the change
		// takes effect immediately rather than at some future network drop.
		if (JSON.stringify(previous) !== JSON.stringify(normalized)) {
			this.terminateChannels(deviceId);
		}
		await this.persist();
		return normalized;
	}

	isAuthorized(deviceId: string): boolean {
		const record = this.records.get(deviceId);
		return !!record && !record.revokedAt;
	}

	/** Throws `DeviceUnknownError` / `DeviceRevokedError`. */
	assertAuthorized(deviceId: string): PairedDeviceRecord {
		const record = this.records.get(deviceId);
		if (!record) {
			throw new DeviceUnknownError(deviceId);
		}
		if (record.revokedAt) {
			throw new DeviceRevokedError(deviceId);
		}
		return record;
	}

	assertPublicKeyAuthorized(publicKey: Uint8Array): PairedDeviceRecord {
		return this.assertAuthorized(deviceIdFromPublicKey(publicKey));
	}

	/**
	 * Records a session handshake message and refuses one already seen.
	 *
	 * A Noise IK message 1 carries no timestamp or counter, so a captured one stays
	 * cryptographically valid forever. A replay cannot give the attacker a usable
	 * channel — deriving the transport keys needs the device's ephemeral private
	 * key, which never leaves the device — but it *can* make the hub mint sessions,
	 * so it is refused. The defence is a bounded dedup window
	 * (`sessionReplayWindowMs`, capped at `MAX_REMEMBERED_SESSION_HANDSHAKES`
	 * entries) rather than a permanent set, which would be unbounded memory: a
	 * replay held back longer than the window is accepted again, and callers that
	 * need more than that must rate-limit connections at the transport.
	 */
	assertFreshSessionHandshake(message: Uint8Array): void {
		const digest = bytesToBase64Url(hash(message));
		const now = this.now();
		for (const [seen, at] of this.seenSessionHandshakes) {
			if (now - at > this.sessionReplayWindowMs) {
				this.seenSessionHandshakes.delete(seen);
			} else {
				// Insertion-ordered, so the first live entry ends the sweep.
				break;
			}
		}
		if (this.seenSessionHandshakes.has(digest)) {
			throw new SessionReplayError();
		}
		while (
			this.seenSessionHandshakes.size >= MAX_REMEMBERED_SESSION_HANDSHAKES
		) {
			const oldest = this.seenSessionHandshakes.keys().next();
			if (oldest.done) {
				break;
			}
			this.seenSessionHandshakes.delete(oldest.value);
		}
		this.seenSessionHandshakes.set(digest, now);
	}

	/**
	 * Registers a live channel; returns an unbind function for clean disconnects.
	 * Binding is done for you by `acceptDeviceSession`, so revocation reaches a
	 * session whether or not the caller remembers to wire anything up.
	 */
	bindChannel(deviceId: string, channel: TerminableChannel): () => void {
		// A websocket can disappear while its asynchronous Noise/registry work is
		// completing. Never retain a channel that was already dead when it arrived.
		if (channel.closed === true) {
			return () => {};
		}
		let channels = this.liveChannels.get(deviceId);
		if (!channels) {
			channels = new Set();
			this.liveChannels.set(deviceId, channels);
		}
		// Reconnects bind a new channel each time; drop any that already ended so a
		// long-lived hub does not accumulate dead ones.
		for (const existing of channels) {
			if (existing.closed === true) {
				channels.delete(existing);
			}
		}
		channels.add(channel);
		return () => {
			const current = this.liveChannels.get(deviceId);
			current?.delete(channel);
			if (current && current.size === 0) {
				this.liveChannels.delete(deviceId);
			}
		};
	}

	/**
	 * Channels this registry instance currently holds for a device. Only ever
	 * non-zero in the process that authorised them, which is why a CLI `revoke`
	 * reports 0 and relies on the owning process to enforce.
	 */
	liveChannelCount(deviceId: string): number {
		return this.liveChannels.get(deviceId)?.size ?? 0;
	}

	private terminateChannels(deviceId: string): void {
		const channels = this.liveChannels.get(deviceId);
		if (!channels) {
			return;
		}
		for (const channel of channels) {
			channel.close();
		}
		this.liveChannels.delete(deviceId);
	}
}
