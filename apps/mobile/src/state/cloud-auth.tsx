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
import { useEndpoints } from "./endpoints";
import { clearAllPendingHomeSubmissions } from "./pending-home-message";
import { clearAllSessionDrafts } from "./session-drafts";

export type CloudAccountState =
	/** Storage has not been read yet. */
	| { phase: "loading" }
	| { phase: "signed-out" }
	/** `email` is absent when the stored token carried no identity. */
	| { phase: "signed-in"; email?: string; name?: string };

const CloudAuthContext = createContext<ClineAuthStore>(
	new ClineAuthStore({ storage: createInMemoryAuthStorage() }),
);

const privateRetirements = new WeakMap<
	ClineAuthStore,
	{
		version: number;
		pending: Promise<void>;
	}
>();
function retirePrivateInput(
	store: ClineAuthStore,
	endpoints: { retirePendingInitialMessages(): Promise<void> },
): Promise<void> {
	const version = store.identityVersion;
	const existing = privateRetirements.get(store);
	if (existing?.version === version) return existing.pending;
	clearAllSessionDrafts();
	clearAllPendingHomeSubmissions();
	const pending = endpoints.retirePendingInitialMessages();
	privateRetirements.set(store, { version, pending });
	return pending;
}

export interface CloudAccountScope {
	organizationId?: string;
	/** Display metadata from the same accepted discovery/selection, never routing authority. */
	accountName?: string;
}
interface CloudAccountSelection {
	(scope: CloudAccountScope): boolean;
	fail(): boolean;
	cancel(): boolean;
}
export const ACCOUNT_SELECTION_ERROR =
	"Account could not be changed. Your previous account is still selected.";
const CloudAccountScopeContext = createContext<{
	scope: CloudAccountScope | undefined;
	selectionPending: boolean;
	selectionError?: string;
	isSelectionPending(): boolean;
	isScopeCurrent(scope: CloudAccountScope | undefined): boolean;
	selectScope(scope: CloudAccountScope | undefined): void;
	beginRefresh(): (scope: CloudAccountScope) => void;
	beginSelection(): CloudAccountSelection;
}>({
	scope: undefined,
	selectionPending: false,
	isSelectionPending: () => false,
	isScopeCurrent: (scope) => scope === undefined,
	selectScope: () => {},
	beginRefresh: () => () => {},
	beginSelection: () =>
		Object.assign(() => false, { fail: () => false, cancel: () => false }),
});

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
	const { store: endpointsStore } = useEndpoints();
	const [scope, setScope] = useState<CloudAccountScope>();
	const scopeAuthority = useRef<CloudAccountScope | undefined>(undefined);
	const isScopeCurrent = useCallback(
		(expected: CloudAccountScope | undefined) =>
			(expected === undefined) === (scopeAuthority.current === undefined) &&
			expected?.organizationId === scopeAuthority.current?.organizationId,
		[],
	);
	const [selection, setSelection] = useState<{
		pending: boolean;
		error?: string;
	}>({ pending: false });
	const pendingSelection = useRef<number | undefined>(undefined);
	const isSelectionPending = useCallback(
		() => pendingSelection.current !== undefined,
		[],
	);
	const revision = useRef(0);
	const selectScope = useCallback((next: CloudAccountScope | undefined) => {
		revision.current += 1;
		scopeAuthority.current = next;
		pendingSelection.current = undefined;
		setSelection({ pending: false });
		setScope(next);
	}, []);
	useEffect(() => {
		return value.subscribeIdentity((credentials, previous) => {
			selectScope(undefined);
			if (
				!credentials ||
				(previous &&
					(!previous.accountId || previous.accountId !== credentials.accountId))
			) {
				// Same-owner reauthentication must keep failed starts for explicit Retry.
				cloudStartStore.clear();
				// Token resolution can sign out without calling the Settings hook.
				// Also retire private input before a different person signs in.
				void retirePrivateInput(value, endpointsStore).catch(() => {});
			}
		});
	}, [value, selectScope, endpointsStore]);
	const beginSelection = useCallback(() => {
		// Starting a newer selection retires older switches/discovery. Publishing
		// increments again so discovery begun during the RPC cannot undo success.
		const started = ++revision.current;
		pendingSelection.current = started;
		setSelection({ pending: true });
		const owned = () =>
			revision.current === started && pendingSelection.current === started;
		const finish = (next: CloudAccountScope) => {
			if (!owned()) return false;
			selectScope(next);
			return true;
		};
		const retire = (error?: string) => {
			if (!owned()) return false;
			revision.current += 1;
			pendingSelection.current = undefined;
			setSelection({ pending: false, ...(error ? { error } : {}) });
			return true;
		};
		return Object.assign(finish, {
			fail: () => retire(ACCOUNT_SELECTION_ERROR),
			cancel: () => retire(),
		});
	}, [selectScope]);
	const beginRefresh = useCallback(() => {
		const started = revision.current;
		const allowed = pendingSelection.current === undefined;
		return (next: CloudAccountScope) => {
			// Discovery started before a Settings switch must not restore the old account.
			if (
				allowed &&
				pendingSelection.current === undefined &&
				revision.current === started
			) {
				scopeAuthority.current = next;
				setSelection({ pending: false });
				setScope((current) =>
					current &&
					current.organizationId === next.organizationId &&
					current.accountName === next.accountName
						? current
						: next,
				);
			}
		};
	}, []);
	return (
		<CloudAuthContext.Provider value={value}>
			<CloudAccountScopeContext.Provider
				value={{
					scope,
					selectionPending: selection.pending,
					selectionError: selection.error,
					isSelectionPending,
					isScopeCurrent,
					selectScope,
					beginRefresh,
					beginSelection,
				}}
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
	const { store: endpointsStore } = useEndpoints();
	const [account, setAccount] = useState<CloudAccountState>({
		phase: "loading",
	});

	useEffect(() => {
		let active = true;
		const identityVersion = store.identityVersion;
		const unsubscribe = store.subscribeIdentity((credentials) => {
			if (active) setAccount(toAccountState(credentials));
		});
		setAccount({ phase: "loading" });
		void store
			.getCredentials()
			.then((credentials) => {
				if (active && store.identityVersion === identityVersion) {
					setAccount(toAccountState(credentials));
				}
			})
			.catch(() => {
				// An unreadable Keychain entry is indistinguishable from none.
				if (active && store.identityVersion === identityVersion) {
					setAccount({ phase: "signed-out" });
				}
			});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [store]);

	const signOut = useCallback(async () => {
		selectScope(undefined);
		cloudStartStore.clear();
		// Invalidate credential cache/generation immediately; endpoint storage may be
		// slow, and must not leave the old account usable while cleanup waits.
		const credentialSignOut = store.signOut();
		// The identity observer and explicit Sign out share one retirement. Also
		// cover consumers rendered without the app-wide provider.
		const privateRetirement = retirePrivateInput(store, endpointsStore);
		await Promise.allSettled([credentialSignOut, privateRetirement]);
		// The store's synchronous identity notification already retired every consumer.
		// A newer sign-in during storage cleanup must not be overwritten here.
	}, [store, selectScope, endpointsStore]);

	return { account, signOut, store };
}
