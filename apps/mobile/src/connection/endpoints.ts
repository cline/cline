/**
 * Where the app remembers *which* hub to talk to.
 *
 * A {@link ConnectionDescriptor} is the minimal, serialisable pointer at one hub:
 * a mode, a url and (for an authenticated hub) a token. The {@link
 * SavedEndpointsStore} keeps a small list of them so a returning user can
 * reconnect with one tap.
 *
 * Persistence is optional and injected. The default store is in-memory only, so
 * it is safe to construct in a test or on a server; a device build passes
 * {@link createExpoSecureStoreAdapter} to survive app restarts. The store never
 * imports `expo-secure-store` itself — the adapter does, lazily — so nothing here
 * drags a native module into a Node test.
 */

import { isReasoningChoice, type ReasoningChoice } from "@/session/reasoning";
export type ConnectionMode = "local" | "cloud";

export interface ConnectionDescriptor {
	mode: ConnectionMode;
	/** `ws(s)://` (local) or the sandbox `http(s)://` (cloud) endpoint. */
	url: string;
	/** Hub auth token, when the hub requires one. */
	authToken?: string;
	/** Optional human label for the saved-endpoints list. */
	label?: string;
	/** Model explicitly chosen when this app provisions a new Cloud workspace. */
	modelId?: string;
	reasoning?: ReasoningChoice;
	/** Display-only Cloud workspace context from the existing session API. */
	repoUrl?: string;
	branch?: string;
	/** Provider recorded for the inner Cline session, when known. */
	providerId?: string;
	/** The exact inner hub session represented by this row, when known. */
	hubSessionId?: string;
	/** Local only: title captured for the handed-off session. */
	sessionTitle?: string;
	/** Local only: direct legacy hub or account-routed E2E relay. */
	transport?: "direct" | "relay";
	/** Relay machine id derived from the pinned hub public key. */
	relayMachineId?: string;
	/** Base64url pinned X25519 hub public key, 32 bytes. */
	hubPublicKey?: string;
	/** Base64url device X25519 private key, persisted in Keychain/Keystore. */
	devicePrivateKey?: string;
	/**
	 * What this row authenticates with, so the controller never has to guess from
	 * which fields happen to be present.
	 *
	 * - `hub-token`: the hub's durable token, presented as a subprotocol. What the
	 *   Advanced manual-entry form saves, and what a hub the user typed in wants.
	 * - `pairing-secret`: a one-time offer secret. Never persisted — it is consumed
	 *   during pairing and the row is rewritten as `device-key`. Present in the
	 *   union so a stored row carrying it can be recognised (and refused) rather
	 *   than silently treated as a token.
	 * - `device-key`: this device's own X25519 key, pinned to `hubPublicKey`. No
	 *   token, no expiry, revocable from the machine.
	 *
	 * Absent means `hub-token`, which is what every row written before pairing was.
	 */
	credentialKind?: "hub-token" | "pairing-secret" | "device-key";
	/**
	 * Cloud only: core-api base for the REST sessions API + WS proxy. When
	 * omitted the controller falls back to the build-time `cloudEnv.apiBaseUrl`.
	 */
	apiBaseUrl?: string;
	/**
	 * Cloud only: the resolved remote (sandbox) session id. When omitted the
	 * controller connects the newest session from the gateway.
	 */
	remoteSessionId?: string;
	/** Cloud only: organization scope for listing/creating sessions. */
	organizationId?: string;
	/**
	 * Cloud only: first prompt retained until the newly-created workspace opens.
	 * Stored with the descriptor in Keychain/Keystore so an iOS process eviction
	 * after the server accepts creation does not silently discard the user's ask.
	 */
	pendingInitialMessage?: string;
	/** Only a workspace created here may initialize its canonical Hub session. */
	allowInitialCreate?: boolean;
}

/** Stable identity of a descriptor: two with the same key point at the same hub. */
export function descriptorKey(descriptor: ConnectionDescriptor): string {
	if (descriptor.mode !== "local") {
		return JSON.stringify([descriptor.mode, descriptor.url]);
	}
	const relayIdentity = descriptor.relayMachineId;
	if (relayIdentity) {
		return JSON.stringify([
			descriptor.mode,
			descriptor.url,
			relayIdentity,
			...(descriptor.hubSessionId ? [descriptor.hubSessionId] : []),
		]);
	}
	return descriptor.hubSessionId
		? JSON.stringify([descriptor.mode, descriptor.url, descriptor.hubSessionId])
		: JSON.stringify([descriptor.mode, descriptor.url]);
}

export interface ChatRouteParams extends Record<string, string | undefined> {
	endpointKey: string;
	newSession?: "1";
}

/** Route-safe connection intent. Credentials remain in the endpoint store. */
export function chatRouteParams(
	descriptor: ConnectionDescriptor,
	createNewSession = false,
): ChatRouteParams {
	return {
		endpointKey: descriptorKey(descriptor),
		...(createNewSession ? { newSession: "1" as const } : {}),
	};
}

/** Async key/value persistence. Mirrors the `expo-secure-store` surface we use. */
export interface EndpointPersistence {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	deleteItem(key: string): Promise<void>;
}

const STORAGE_KEY = "cline.mobile.savedEndpoints.v1";

function isDescriptor(value: unknown): value is ConnectionDescriptor {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		(record.mode === "local" || record.mode === "cloud") &&
		typeof record.url === "string" &&
		record.url.length > 0 &&
		(record.authToken === undefined || typeof record.authToken === "string") &&
		(record.label === undefined || typeof record.label === "string") &&
		(record.modelId === undefined || typeof record.modelId === "string") &&
		(record.reasoning === undefined || isReasoningChoice(record.reasoning)) &&
		(record.repoUrl === undefined || typeof record.repoUrl === "string") &&
		(record.branch === undefined || typeof record.branch === "string") &&
		(record.providerId === undefined ||
			typeof record.providerId === "string") &&
		(record.hubSessionId === undefined ||
			typeof record.hubSessionId === "string") &&
		(record.sessionTitle === undefined ||
			typeof record.sessionTitle === "string") &&
		(record.transport === undefined ||
			record.transport === "direct" ||
			record.transport === "relay") &&
		(record.relayMachineId === undefined ||
			typeof record.relayMachineId === "string") &&
		(record.hubPublicKey === undefined ||
			typeof record.hubPublicKey === "string") &&
		(record.devicePrivateKey === undefined ||
			typeof record.devicePrivateKey === "string") &&
		(record.credentialKind === undefined ||
			record.credentialKind === "hub-token" ||
			record.credentialKind === "pairing-secret" ||
			record.credentialKind === "device-key") &&
		(record.apiBaseUrl === undefined ||
			typeof record.apiBaseUrl === "string") &&
		(record.remoteSessionId === undefined ||
			typeof record.remoteSessionId === "string") &&
		(record.organizationId === undefined ||
			typeof record.organizationId === "string") &&
		(record.pendingInitialMessage === undefined ||
			typeof record.pendingInitialMessage === "string") &&
		(record.allowInitialCreate === undefined ||
			typeof record.allowInitialCreate === "boolean")
	);
}

/**
 * An in-memory list of saved hubs with optional write-through persistence.
 *
 * Most-recently-saved wins and moves to the front; re-saving the same hub (same
 * {@link descriptorKey}) updates it in place instead of duplicating it.
 */
export class SavedEndpointsStore {
	private endpoints: ConnectionDescriptor[] = [];
	private persistenceTail: Promise<void> = Promise.resolve();
	private submissionGeneration = 0;
	private pendingRetirements = 0;
	private readonly listeners = new Set<
		(endpoints: ConnectionDescriptor[]) => void
	>();

	constructor(private readonly persistence?: EndpointPersistence) {}

	/** Loads persisted endpoints, if a persistence adapter was provided. */
	async hydrate(): Promise<void> {
		if (!this.persistence) {
			return;
		}
		const generation = this.submissionGeneration;
		const retiring = this.pendingRetirements > 0;
		const raw = await this.persistence.getItem(STORAGE_KEY);
		if (!raw) {
			return;
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				const loaded = parsed.filter(isDescriptor);
				if (
					retiring ||
					this.pendingRetirements > 0 ||
					generation !== this.submissionGeneration
				) {
					this.mergeRetiredEndpoints(loaded);
					await this.persist();
				} else {
					this.endpoints = loaded;
				}
				this.emit();
			}
		} catch {
			// A corrupt blob is discarded rather than crashing startup.
		}
	}

	list(): ConnectionDescriptor[] {
		return [...this.endpoints];
	}

	get(key: string): ConnectionDescriptor | undefined {
		return this.endpoints.find((entry) => descriptorKey(entry) === key);
	}

	subscribe(listener: (endpoints: ConnectionDescriptor[]) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Adds or updates a hub, moving it to the front. Persists write-through. */
	async save(
		descriptor: ConnectionDescriptor,
		generation = this.submissionGeneration,
	): Promise<void> {
		if (generation !== this.submissionGeneration) {
			descriptor = this.withoutPendingMessage(descriptor);
		}
		const key = descriptorKey(descriptor);
		this.endpoints = [
			descriptor,
			...this.endpoints.filter((entry) => descriptorKey(entry) !== key),
		];
		this.emit();
		await this.persist();
	}

	/** Captured by route callbacks so a retired account cannot restore its prompt. */
	pendingSubmissionGeneration(): number {
		return this.submissionGeneration;
	}

	/** Retire unsent asks while preserving saved destinations and conversation ids. */
	async retirePendingInitialMessages(): Promise<void> {
		this.submissionGeneration++;
		this.pendingRetirements++;
		this.endpoints = this.endpoints.map((entry) =>
			this.withoutPendingMessage(entry),
		);
		this.emit();
		try {
			if (this.persistence) {
				// Also cover sign-out before provider hydration has finished. Merge with
				// current memory so this read cannot overwrite a newer route update.
				const raw = await this.persistence.getItem(STORAGE_KEY);
				if (raw) {
					try {
						const parsed: unknown = JSON.parse(raw);
						if (Array.isArray(parsed))
							this.mergeRetiredEndpoints(parsed.filter(isDescriptor));
					} catch {
						// Keep the known destinations if persisted data is corrupt.
					}
				}
			}
			this.emit();
			await this.persist();
		} finally {
			this.pendingRetirements--;
		}
	}

	private withoutPendingMessage(
		descriptor: ConnectionDescriptor,
	): ConnectionDescriptor {
		const next = { ...descriptor };
		delete next.pendingInitialMessage;
		return next;
	}

	private mergeRetiredEndpoints(loaded: ConnectionDescriptor[]): void {
		const currentKeys = new Set(this.endpoints.map(descriptorKey));
		this.endpoints = [
			...this.endpoints,
			...loaded
				.filter((entry) => !currentKeys.has(descriptorKey(entry)))
				.map((entry) => this.withoutPendingMessage(entry)),
		];
	}

	async remove(key: string): Promise<void> {
		const next = this.endpoints.filter((entry) => descriptorKey(entry) !== key);
		if (next.length === this.endpoints.length) {
			return;
		}
		this.endpoints = next;
		this.emit();
		await this.persist();
	}

	async clear(): Promise<void> {
		this.endpoints = [];
		this.emit();
		if (this.persistence) {
			await this.enqueuePersistence(() =>
				this.persistence?.deleteItem(STORAGE_KEY),
			);
		}
	}

	private emit(): void {
		const snapshot = this.list();
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
		const value = JSON.stringify(this.endpoints);
		await this.enqueuePersistence(() =>
			this.persistence?.setItem(STORAGE_KEY, value),
		);
	}

	private enqueuePersistence(operation: () => Promise<void> | undefined) {
		const write = this.persistenceTail.then(operation);
		// A failed write rejects its own caller but cannot stop later, newer state.
		this.persistenceTail = write.catch(() => {});
		return write;
	}
}

/**
 * An {@link EndpointPersistence} backed by `expo-secure-store`.
 *
 * `expo-secure-store` is a native module, so it is imported lazily here: a Node
 * test that never calls this function never loads it. It is already a dependency;
 * this only wires it up.
 */
export function createExpoSecureStoreAdapter(): EndpointPersistence {
	let modulePromise: Promise<typeof import("expo-secure-store")> | undefined;
	const load = (): Promise<typeof import("expo-secure-store")> => {
		modulePromise ??= import("expo-secure-store");
		return modulePromise;
	};
	return {
		async getItem(key) {
			const SecureStore = await load();
			return await SecureStore.getItemAsync(key);
		},
		async setItem(key, value) {
			const SecureStore = await load();
			await SecureStore.setItemAsync(key, value);
		},
		async deleteItem(key) {
			const SecureStore = await load();
			await SecureStore.deleteItemAsync(key);
		},
	};
}
