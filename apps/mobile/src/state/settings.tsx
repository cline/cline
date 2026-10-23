/**
 * App-wide access to the auto-approve policy.
 *
 * The Settings screen writes tiers here; the chat route reads the policy back and
 * hands it to `useSessionConnection`, so a toggle taken in Settings changes what
 * the live session answers on its own. A single {@link ApprovalPolicyStore} is
 * shared through React context, mirroring `state/endpoints.tsx`.
 *
 * The context default is an in-memory store (no persistence), which keeps render
 * tests from ever touching `expo-secure-store`. The real {@link SettingsProvider}
 * at the app root swaps in a secure-store-backed store and hydrates it on mount.
 *
 * Consumers must wait for hydration before starting sessions so saved approval
 * choices take precedence over the new-install default.
 */

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { createExpoSecureStoreAdapter } from "@/connection";
import type {
	ApprovalPolicy,
	ApprovalTier,
	ApprovalTierSetting,
} from "@/session";
import { ApprovalPolicyStore } from "./approval-policy-store";

interface SettingsContextValue {
	store: ApprovalPolicyStore;
	hydrated: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
	store: new ApprovalPolicyStore(),
	hydrated: true,
});

/** Lazily-built singleton so the secure-store adapter is created once per app. */
let deviceStore: ApprovalPolicyStore | undefined;
function getDeviceStore(): ApprovalPolicyStore {
	deviceStore ??= new ApprovalPolicyStore(createExpoSecureStoreAdapter());
	return deviceStore;
}

export function SettingsProvider({
	children,
	store,
}: {
	children: ReactNode;
	/** Injectable for tests; defaults to the persistent device store. */
	store?: ApprovalPolicyStore;
}) {
	const [value] = useState(() => store ?? getDeviceStore());
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		// `hydrate` swallows a missing/corrupt blob and a rejected read; the catch
		// is belt-and-braces so startup can never be blocked on it.
		void value
			.hydrate()
			.catch(() => {})
			.finally(() => setHydrated(true));
	}, [value]);
	return (
		<SettingsContext.Provider value={{ store: value, hydrated }}>
			{children}
		</SettingsContext.Provider>
	);
}

export interface UseApprovalPolicy {
	policy: ApprovalPolicy;
	hydrated: boolean;
	setTier(tier: ApprovalTier, value: ApprovalTierSetting): Promise<void>;
	reset(): Promise<void>;
	store: ApprovalPolicyStore;
}

/** Subscribe to the shared auto-approve policy. */
export function useApprovalPolicy(): UseApprovalPolicy {
	const { store, hydrated } = useContext(SettingsContext);
	const [policy, setPolicy] = useState<ApprovalPolicy>(() => store.get());
	useEffect(() => {
		setPolicy(store.get());
		return store.subscribe(setPolicy);
	}, [store]);
	return {
		policy,
		hydrated,
		setTier: (tier, value) => store.setTier(tier, value),
		reset: () => store.reset(),
		store,
	};
}
