"use client";

import type { ClineAccountOrganization, ClineAccountUser } from "@cline/core";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { desktopClient } from "@/lib/desktop-client";

export const ACCOUNT_IDENTITY_STORAGE_KEY = "cline.code.account-identity.v1";

const SIGNED_OUT_ERROR_MARKERS = [
	"No Cline account auth token found",
	"no longer valid",
];

type AccountContextValue = {
	user: ClineAccountUser | null;
	organizations: ClineAccountOrganization[];
	activeOrganization: ClineAccountOrganization | null;
	refreshAccount: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue>({
	user: null,
	organizations: [],
	activeOrganization: null,
	refreshAccount: async () => undefined,
});

export function parseCachedAccountUser(
	raw: string | null,
): ClineAccountUser | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as { user?: ClineAccountUser | null };
		const user = parsed?.user;
		if (!user || typeof user !== "object") {
			return null;
		}
		if (
			typeof user.email !== "string" &&
			typeof user.displayName !== "string"
		) {
			return null;
		}
		return user;
	} catch {
		return null;
	}
}

function readCachedAccountUser(): ClineAccountUser | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return parseCachedAccountUser(
			window.localStorage.getItem(ACCOUNT_IDENTITY_STORAGE_KEY),
		);
	} catch {
		return null;
	}
}

function writeCachedAccountUser(user: ClineAccountUser | null): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		if (user) {
			window.localStorage.setItem(
				ACCOUNT_IDENTITY_STORAGE_KEY,
				JSON.stringify({ user }),
			);
		} else {
			window.localStorage.removeItem(ACCOUNT_IDENTITY_STORAGE_KEY);
		}
	} catch {
		// Account identity still works for this session without the cache.
	}
}

export function isSignedOutAccountError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return SIGNED_OUT_ERROR_MARKERS.some((marker) => message.includes(marker));
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<ClineAccountUser | null>(null);

	const refreshAccount = useCallback(async () => {
		try {
			const me = await desktopClient.invoke<ClineAccountUser>("cline_account", {
				action: "clineAccount",
				operation: "fetchMe",
			});
			setUser(me ?? null);
			writeCachedAccountUser(me ?? null);
		} catch (error) {
			if (isSignedOutAccountError(error)) {
				setUser(null);
				writeCachedAccountUser(null);
			}
			// Transient failures (offline, sidecar restarting) keep the cached
			// identity rather than flashing a signed-out state.
		}
	}, []);

	useEffect(() => {
		// Seed from the cached identity after mount so the signed-in name renders
		// without waiting on the network fetch, which revalidates it right after.
		// localStorage must not be read during the initial render: the server
		// renders the signed-out state, and a differing first client render would
		// be a hydration mismatch.
		setUser((current) => current ?? readCachedAccountUser());
		void refreshAccount();
	}, [refreshAccount]);

	const value = useMemo<AccountContextValue>(() => {
		const organizations = user?.organizations ?? [];
		return {
			user,
			organizations,
			activeOrganization:
				organizations.find((organization) => organization.active) ?? null,
			refreshAccount,
		};
	}, [refreshAccount, user]);

	return (
		<AccountContext.Provider value={value}>{children}</AccountContext.Provider>
	);
}

export function useAccount(): AccountContextValue {
	return useContext(AccountContext);
}
