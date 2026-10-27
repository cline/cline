/**
 * App-wide access to the Cline Cloud account.
 *
 * Settings reads the signed-in identity from here and signs out through it, so
 * cloud credentials can be removed from the device. A single
 * {@link ClineAuthStore} is shared through React context, mirroring
 * `state/settings.tsx` and `state/endpoints.tsx`.
 *
 * The context default is an in-memory store, which keeps render tests from ever
 * touching `expo-secure-store`; the real {@link CloudAuthProvider} at the app
 * root swaps in the device-wide Keychain-backed store.
 */

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	ClineAuthStore,
	type ClineOAuthCredentials,
	cloudAuthStore,
	createInMemoryAuthStorage,
} from "@/cloud";
import { cloudStartStore } from "./cloud-starts";

export type CloudAccountState =
	/** Storage has not been read yet. */
	| { phase: "loading" }
	| { phase: "signed-out" }
	/** `email` is absent when the stored token carried no identity. */
	| { phase: "signed-in"; email?: string; name?: string };

const CloudAuthContext = createContext<ClineAuthStore>(
	new ClineAuthStore({ storage: createInMemoryAuthStorage() }),
);

export interface CloudAccountScope {
	organizationId?: string;
}
const CloudAccountScopeContext = createContext<{
	scope: CloudAccountScope | undefined;
	selectScope(scope: CloudAccountScope | undefined): void;
	beginRefresh(): (scope: CloudAccountScope) => void;
}>({ scope: undefined, selectScope: () => {}, beginRefresh: () => () => {} });

export function useCloudAccountScope() {
	return useContext(CloudAccountScopeContext);
}

function toAccountState(
	credentials: ClineOAuthCredentials | null,
): CloudAccountState {
	if (!credentials) {
		return { phase: "signed-out" };
	}
	const email =
		credentials.email?.trim() ||
		credentials.metadata?.userInfo?.email?.trim() ||
		undefined;
	const name = credentials.metadata?.userInfo?.name?.trim() || undefined;
	return {
		phase: "signed-in",
		...(email ? { email } : {}),
		...(name ? { name } : {}),
	};
}

export function CloudAuthProvider({
	children,
	store,
}: {
	children: ReactNode;
	/** Injectable for tests; defaults to the device credential store. */
	store?: ClineAuthStore;
}) {
	const [value] = useState(() => store ?? cloudAuthStore);
	const [scope, setScope] = useState<CloudAccountScope>();
	const revision = useRef(0);
	const selectScope = useCallback((next: CloudAccountScope | undefined) => {
		revision.current += 1;
		setScope(next);
	}, []);
	const beginRefresh = useCallback(() => {
		const started = revision.current;
		return (next: CloudAccountScope) => {
			// Discovery started before a Settings switch must not restore the old account.
			if (revision.current === started)
				setScope((current) =>
					current && current.organizationId === next.organizationId
						? current
						: next,
				);
		};
	}, []);
	return (
		<CloudAuthContext.Provider value={value}>
			<CloudAccountScopeContext.Provider
				value={{ scope, selectScope, beginRefresh }}
			>
				{children}
			</CloudAccountScopeContext.Provider>
		</CloudAuthContext.Provider>
	);
}

export interface UseCloudAuth {
	account: CloudAccountState;
	/** Wipes the device's credentials. Never throws. */
	signOut(): Promise<void>;
	store: ClineAuthStore;
}

/** Read the stored Cline Cloud identity and sign out of it. */
export function useCloudAuth(): UseCloudAuth {
	const store = useContext(CloudAuthContext);
	const { selectScope } = useCloudAccountScope();
	const [account, setAccount] = useState<CloudAccountState>({
		phase: "loading",
	});

	useEffect(() => {
		let active = true;
		setAccount({ phase: "loading" });
		void store
			.getCredentials()
			.then((credentials) => {
				if (active) {
					setAccount(toAccountState(credentials));
				}
			})
			.catch(() => {
				// An unreadable Keychain entry is indistinguishable from none.
				if (active) {
					setAccount({ phase: "signed-out" });
				}
			});
		return () => {
			active = false;
		};
	}, [store]);

	const signOut = useCallback(async () => {
		selectScope(undefined);
		cloudStartStore.clear();
		await store.signOut().catch(() => {});
		setAccount({ phase: "signed-out" });
	}, [store, selectScope]);

	return { account, signOut, store };
}
