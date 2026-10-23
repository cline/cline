/**
 * When this device last opened each session.
 *
 * The session list is ordered newest-first, and for a cloud session the REST API
 * supplies `updatedAt`. A local machine supplies nothing: the saved-endpoint
 * store keeps no timestamps, and the phone cannot know when work last happened on
 * someone's laptop without connecting to it. So rather than invent a time, this
 * records the one fact the device genuinely observes — "you opened this session at
 * T" — and the list says exactly that ("Opened 5m ago", never "Updated 5m ago").
 *
 * Shaped like {@link import("@/connection").SavedEndpointsStore} and
 * {@link import("./approval-policy-store").ApprovalPolicyStore}: an in-memory map
 * with optional injected write-through persistence, so it is safe to construct in
 * a Node test and never imports `expo-secure-store` itself.
 */

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { createExpoSecureStoreAdapter } from "@/connection";

/** Async key/value persistence. `createExpoSecureStoreAdapter()` satisfies it. */
export interface LastOpenedPersistence {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	deleteItem(key: string): Promise<void>;
}

export const LAST_OPENED_STORAGE_KEY = "cline.mobile.lastOpened.v1";

/** Bounded so a long-lived device cannot grow this blob without limit. */
export const LAST_OPENED_MAX_ENTRIES = 50;

export type LastOpenedMap = Readonly<Record<string, number>>;

/** Descriptor key -> epoch ms this device last opened it. */
export class LastOpenedStore {
	private opened = new Map<string, number>();
	private readonly listeners = new Set<(value: LastOpenedMap) => void>();

	constructor(private readonly persistence?: LastOpenedPersistence) {}

	async hydrate(): Promise<void> {
		if (!this.persistence) {
			return;
		}
		const raw = await this.persistence.getItem(LAST_OPENED_STORAGE_KEY);
		if (!raw) {
			return;
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null) {
				return;
			}
			for (const [key, value] of Object.entries(parsed)) {
				// A corrupt entry is dropped, not guessed at: a bad timestamp would
				// silently reorder the list.
				if (typeof value === "number" && Number.isSafeInteger(value)) {
					this.opened.set(key, value);
				}
			}
			this.emit();
		} catch {
			// A corrupt blob is discarded rather than crashing startup.
		}
	}

	get(key: string): number | undefined {
		return this.opened.get(key);
	}

	snapshot(): LastOpenedMap {
		return Object.fromEntries(this.opened);
	}

	subscribe(listener: (value: LastOpenedMap) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Records an open. Later opens win; earlier ones never move a row back up. */
	async touch(key: string, at: number = Date.now()): Promise<void> {
		const previous = this.opened.get(key);
		if (previous !== undefined && previous >= at) {
			return;
		}
		this.opened.set(key, at);
		this.prune();
		this.emit();
		await this.persist();
	}

	async forget(key: string): Promise<void> {
		if (!this.opened.delete(key)) {
			return;
		}
		this.emit();
		await this.persist();
	}

	async clear(): Promise<void> {
		this.opened.clear();
		this.emit();
		await this.persistence?.deleteItem(LAST_OPENED_STORAGE_KEY);
	}

	private prune(): void {
		if (this.opened.size <= LAST_OPENED_MAX_ENTRIES) {
			return;
		}
		const newestFirst = [...this.opened.entries()].sort((a, b) => b[1] - a[1]);
		this.opened = new Map(newestFirst.slice(0, LAST_OPENED_MAX_ENTRIES));
	}

	private emit(): void {
		const value = this.snapshot();
		for (const listener of [...this.listeners]) {
			try {
				listener(value);
			} catch {
				// A listener fault must not break the store.
			}
		}
	}

	private async persist(): Promise<void> {
		if (!this.persistence) {
			return;
		}
		await this.persistence.setItem(
			LAST_OPENED_STORAGE_KEY,
			JSON.stringify(this.snapshot()),
		);
	}
}

interface LastOpenedContextValue {
	store: LastOpenedStore;
	hydrated: boolean;
}

const LastOpenedContext = createContext<LastOpenedContextValue>({
	store: new LastOpenedStore(),
	hydrated: true,
});

/** Lazily-built singleton so the secure-store adapter is created once per app. */
let deviceStore: LastOpenedStore | undefined;
function getDeviceStore(): LastOpenedStore {
	deviceStore ??= new LastOpenedStore(createExpoSecureStoreAdapter());
	return deviceStore;
}

export function LastOpenedProvider({
	children,
	store,
}: {
	children: ReactNode;
	/** Injectable for tests; defaults to the persistent device store. */
	store?: LastOpenedStore;
}) {
	const [value] = useState(() => store ?? getDeviceStore());
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		void value
			.hydrate()
			.catch(() => {})
			.finally(() => setHydrated(true));
	}, [value]);
	return (
		<LastOpenedContext.Provider value={{ store: value, hydrated }}>
			{children}
		</LastOpenedContext.Provider>
	);
}

export interface UseLastOpened {
	lastOpened: LastOpenedMap;
	hydrated: boolean;
	touch(key: string, at?: number): Promise<void>;
	forget(key: string): Promise<void>;
	store: LastOpenedStore;
}

/** Subscribe to the shared "when did I last open this" map. */
export function useLastOpened(): UseLastOpened {
	const { store, hydrated } = useContext(LastOpenedContext);
	const [lastOpened, setLastOpened] = useState<LastOpenedMap>(() =>
		store.snapshot(),
	);
	useEffect(() => {
		setLastOpened(store.snapshot());
		return store.subscribe(setLastOpened);
	}, [store]);
	return {
		lastOpened,
		hydrated,
		touch: (key, at) => store.touch(key, at),
		forget: (key) => store.forget(key),
		store,
	};
}
