/**
 * React Native persistence for the existing Cline account credentials.
 *
 * The authentication protocol and refresh policy live in
 * `@cline/core/auth/cline-device`, exactly as they do for the CLI/TUI. This
 * module only replaces the TUI's `providers.json` persistence with iOS
 * Keychain / Android Keystore storage.
 */

import {
	type ClineOAuthCredentials,
	type ClineOAuthProviderOptions,
	type ClineTokenResolution,
	getValidClineCredentials,
} from "@cline/core/auth/cline-device";
import { cloudEnv } from "../../config/env";

export interface AuthStorage {
	load(): Promise<ClineOAuthCredentials | null>;
	save(credentials: ClineOAuthCredentials): Promise<void>;
	clear(): Promise<void>;
}

const DEFAULT_STORAGE_KEY = "cline.mobile.cloudAuth.v1";

function isCredentials(value: unknown): value is ClineOAuthCredentials {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.access === "string" &&
		typeof record.refresh === "string" &&
		typeof record.expires === "number"
	);
}

export function createInMemoryAuthStorage(
	initial: ClineOAuthCredentials | null = null,
): AuthStorage {
	let current = initial;
	return {
		async load() {
			return current;
		},
		async save(credentials) {
			current = credentials;
		},
		async clear() {
			current = null;
		},
	};
}

export function createSecureAuthStorage(
	key: string = DEFAULT_STORAGE_KEY,
): AuthStorage {
	let modulePromise: Promise<typeof import("expo-secure-store")> | undefined;
	const load = (): Promise<typeof import("expo-secure-store")> => {
		modulePromise ??= import("expo-secure-store");
		return modulePromise;
	};
	return {
		async load() {
			const SecureStore = await load();
			const raw = await SecureStore.getItemAsync(key);
			if (!raw) {
				return null;
			}
			try {
				const parsed: unknown = JSON.parse(raw);
				return isCredentials(parsed) ? parsed : null;
			} catch {
				return null;
			}
		},
		async save(credentials) {
			const SecureStore = await load();
			await SecureStore.setItemAsync(key, JSON.stringify(credentials));
		},
		async clear() {
			const SecureStore = await load();
			await SecureStore.deleteItemAsync(key);
		},
	};
}

type CredentialResolver = (
	current: ClineOAuthCredentials | null,
	providerOptions: ClineOAuthProviderOptions,
	resolution?: ClineTokenResolution,
) => Promise<ClineOAuthCredentials | null>;

export interface ClineAuthStoreOptions {
	storage: AuthStorage;
	apiBaseUrl?: string;
	/** Test seam; production uses the SDK's existing credential resolver. */
	resolveCredentials?: CredentialResolver;
}

export class ClineAuthStore {
	private readonly apiBaseUrl: string;
	private readonly resolveCredentials: CredentialResolver;
	/** `undefined` means storage has not been read yet. */
	private cached: ClineOAuthCredentials | null | undefined;
	private refreshInFlight: Promise<ClineOAuthCredentials | null> | undefined;
	/** Explicit sign-in/sign-out retires reads and refreshes for the prior identity. */
	private generation = 0;
	private readonly identityListeners = new Set<
		(
			credentials: ClineOAuthCredentials | null,
			previous?: ClineOAuthCredentials | null,
		) => void
	>();
	private pendingWrite: Promise<void> = Promise.resolve();

	/** Explicit identity changes retire UI work; ordinary token refresh does not. */
	get identityVersion(): number {
		return this.generation;
	}

	subscribeIdentity(
		listener: (
			credentials: ClineOAuthCredentials | null,
			previous?: ClineOAuthCredentials | null,
		) => void,
	): () => void {
		this.identityListeners.add(listener);
		return () => {
			this.identityListeners.delete(listener);
		};
	}

	private publishIdentity(
		credentials: ClineOAuthCredentials | null,
		previous?: ClineOAuthCredentials | null,
	): void {
		for (const listener of [...this.identityListeners]) {
			try {
				listener(credentials, previous);
			} catch {
				/* UI observers cannot prevent credential retirement. */
			}
		}
	}

	constructor(private readonly options: ClineAuthStoreOptions) {
		this.apiBaseUrl = options.apiBaseUrl ?? cloudEnv.apiBaseUrl;
		this.resolveCredentials =
			options.resolveCredentials ?? getValidClineCredentials;
	}

	async getCredentials(): Promise<ClineOAuthCredentials | null> {
		if (this.cached === undefined) {
			const generation = this.generation;
			const loaded = await this.options.storage.load();
			if (generation !== this.generation) return null;
			if (this.cached === undefined) this.cached = loaded;
		}
		return this.cached;
	}

	async setCredentials(credentials: ClineOAuthCredentials): Promise<void> {
		const previous = this.cached;
		this.generation += 1;
		this.refreshInFlight = undefined;
		// Enqueue the write before notifying observers, preserving reentrant write order.
		const persisted = this.persist(credentials, this.generation);
		this.publishIdentity(credentials, previous);
		await persisted;
	}

	private async persist(
		credentials: ClineOAuthCredentials,
		generation: number,
	): Promise<boolean> {
		if (generation !== this.generation) {
			return false;
		}
		this.cached = credentials;
		await this.write(() => this.options.storage.save(credentials));
		return generation === this.generation;
	}

	async isSignedIn(): Promise<boolean> {
		return (await this.getCredentials()) !== null;
	}

	/** Resolve and persist the same valid Cline JWT used by the CLI/TUI. */
	async getValidAccessToken(): Promise<string | null> {
		const generation = this.generation;
		const current = await this.getCredentials();
		if (!current || generation !== this.generation) {
			return null;
		}
		const credentials = await this.refreshOnce(current);
		return generation === this.generation
			? (credentials?.access ?? null)
			: null;
	}

	/**
	 * Local sign-out only: the shared Cline auth API has no revocation endpoint.
	 * WorkOS revocation requires a server API key, which cannot ship in the app.
	 */
	async signOut(): Promise<void> {
		this.generation += 1;
		this.cached = null;
		this.refreshInFlight = undefined;
		const cleared = this.write(() => this.options.storage.clear());
		this.publishIdentity(null);
		await cleared;
	}

	/** Saves and clears keep invocation order, including across account changes. */
	private write(operation: () => Promise<void>): Promise<void> {
		const write = this.pendingWrite.then(operation);
		this.pendingWrite = write.catch(() => {});
		return write;
	}

	private refreshOnce(
		current: ClineOAuthCredentials,
	): Promise<ClineOAuthCredentials | null> {
		const generation = this.generation;
		this.refreshInFlight ??= this.runCredentialResolution(
			current,
			generation,
		).finally(() => {
			if (generation === this.generation) this.refreshInFlight = undefined;
		});
		return this.refreshInFlight;
	}

	private async runCredentialResolution(
		current: ClineOAuthCredentials,
		generation: number,
	): Promise<ClineOAuthCredentials | null> {
		const next = await this.resolveCredentials(current, {
			apiBaseUrl: this.apiBaseUrl,
			provider: "cline",
		});
		if (generation !== this.generation) {
			// Signed out while this was in flight: the result belongs to an account
			// the user has already removed from the device.
			return null;
		}
		if (!next) {
			await this.signOut();
			return null;
		}
		if (next !== current && !(await this.persist(next, generation))) {
			return null;
		}
		return next;
	}
}
