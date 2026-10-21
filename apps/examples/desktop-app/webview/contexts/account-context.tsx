"use client";

import type { ClineAccountOrganization, ClineAccountUser } from "@cline/core";
import { getClinePrivacySettingsUrl } from "@cline/shared/browser";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { isClineAccountNotAuthenticatedResult } from "@/lib/cline-account-state";
import { desktopClient } from "@/lib/desktop-client";

export const ACCOUNT_IDENTITY_STORAGE_KEY = "cline.code.account-identity.v1";

const SIGNED_OUT_ERROR_MARKERS = [
	"No Cline account auth token found",
	"no longer valid",
];

type AccountContextValue = {
	user: ClineAccountUser | null;
	/** False until the first identity lookup has finished, so a `null` user
	 * can be told apart from "still loading". */
	accountReady: boolean;
	organizations: ClineAccountOrganization[];
	activeOrganization: ClineAccountOrganization | null;
	clineAppBaseUrl: string | undefined;
	privacySettingsUrl: string | undefined;
	/** Publishes a user another view just fetched, so the values derived here
	 * follow the freshest response instead of the mount-time fetch. */
	applyAccountUser: (user: ClineAccountUser) => void;
	refreshAccount: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue>({
	user: null,
	accountReady: false,
	organizations: [],
	activeOrganization: null,
	clineAppBaseUrl: undefined,
	privacySettingsUrl: undefined,
	applyAccountUser: () => undefined,
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
	const [accountReady, setAccountReady] = useState(false);
	const [clineAppBaseUrl, setClineAppBaseUrl] = useState<string>();

	const refreshAccount = useCallback(async () => {
		try {
			const me = await desktopClient.invoke<ClineAccountUser>("cline_account", {
				action: "clineAccount",
				operation: "fetchMe",
			});
			// Signed out arrives as a typed result, not an error: an expected
			// state that clears the cached identity without any error handling.
			if (isClineAccountNotAuthenticatedResult(me)) {
				setUser(null);
				writeCachedAccountUser(null);
				return;
			}
			setUser(me ?? null);
			writeCachedAccountUser(me ?? null);
		} catch (error) {
			if (isSignedOutAccountError(error)) {
				setUser(null);
				writeCachedAccountUser(null);
			}
			// Transient failures (offline, sidecar restarting) keep the cached
			// identity rather than flashing a signed-out state.
		} finally {
			setAccountReady(true);
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

	useEffect(
		() =>
			desktopClient.subscribeTransportState((state) => {
				if (state !== "connected") return;
				desktopClient
					.invoke<string>("get_cline_app_base_url")
					.then(setClineAppBaseUrl, () => undefined);
			}),
		[],
	);

	const applyAccountUser = useCallback((next: ClineAccountUser) => {
		setUser(next);
		writeCachedAccountUser(next);
	}, []);

	const value = useMemo<AccountContextValue>(() => {
		const organizations = user?.organizations ?? [];
		return {
			user,
			accountReady,
			organizations,
			activeOrganization:
				organizations.find((organization) => organization.active) ?? null,
			clineAppBaseUrl,
			privacySettingsUrl: clineAppBaseUrl
				? getClinePrivacySettingsUrl(
						user?.dataPrivacyPath,
						clineAppBaseUrl,
						"desktop",
					)
				: undefined,
			applyAccountUser,
			refreshAccount,
		};
	}, [accountReady, applyAccountUser, clineAppBaseUrl, refreshAccount, user]);

	return (
		<AccountContext.Provider value={value}>{children}</AccountContext.Provider>
	);
}

export function useAccount(): AccountContextValue {
	return useContext(AccountContext);
}
