/**
 * App-wide access to the saved-hub list.
 *
 * The Connect screen writes a hub here after a successful connect; the Sessions
 * screen reads it back to offer one-tap reconnect. A single {@link
 * SavedEndpointsStore} is shared through React context so both screens see the
 * same list without prop-drilling.
 *
 * The context default is an in-memory store (no persistence), which keeps render
 * tests from ever touching `expo-secure-store`. The real {@link
 * EndpointsProvider} at the app root swaps in a secure-store-backed store and
 * hydrates it on mount.
 */

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { COMPUTER_CONNECTIONS_ENABLED } from "@/config/features";
import {
	type ConnectionDescriptor,
	createExpoSecureStoreAdapter,
	SavedEndpointsStore,
} from "@/connection";

interface EndpointsContextValue {
	store: SavedEndpointsStore;
	hydrated: boolean;
}

const EndpointsContext = createContext<EndpointsContextValue>({
	store: new SavedEndpointsStore(),
	hydrated: true,
});

/** Lazily-built singleton so the secure-store adapter is created once per app. */
let deviceStore: SavedEndpointsStore | undefined;
function getDeviceStore(): SavedEndpointsStore {
	deviceStore ??= new SavedEndpointsStore(createExpoSecureStoreAdapter());
	return deviceStore;
}

export function EndpointsProvider({
	children,
	store,
}: {
	children: ReactNode;
	/** Injectable for tests; defaults to the persistent device store. */
	store?: SavedEndpointsStore;
}) {
	const [value] = useState(() => store ?? getDeviceStore());
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		// A missing/corrupt blob is swallowed inside `hydrate`; this only guards a
		// rejected secure-store read on platforms without it.
		void value
			.hydrate()
			.catch(() => {})
			.finally(() => setHydrated(true));
	}, [value]);
	return (
		<EndpointsContext.Provider value={{ store: value, hydrated }}>
			{children}
		</EndpointsContext.Provider>
	);
}

export interface UseEndpoints {
	endpoints: ConnectionDescriptor[];
	hydrated: boolean;
	save(descriptor: ConnectionDescriptor): Promise<void>;
	remove(key: string): Promise<void>;
	store: SavedEndpointsStore;
}

/** Subscribe to the shared saved-hub list. */
export function useEndpoints(): UseEndpoints {
	const { store, hydrated } = useContext(EndpointsContext);
	const [endpoints, setEndpoints] = useState<ConnectionDescriptor[]>(() =>
		store.list(),
	);
	useEffect(() => {
		setEndpoints(store.list());
		return store.subscribe(setEndpoints);
	}, [store]);
	const availableEndpoints = useMemo(
		() =>
			COMPUTER_CONNECTIONS_ENABLED
				? endpoints
				: endpoints.filter((endpoint) => endpoint.mode === "cloud"),
		[endpoints],
	);
	return {
		endpoints: availableEndpoints,
		hydrated,
		save: (descriptor) => store.save(descriptor),
		remove: (key) => store.remove(key),
		store,
	};
}
