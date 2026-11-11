import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { desktopClient } from "./desktop-client";
import {
	invalidateExtensionInventoryCache,
	subscribeToExtensionInventoryInvalidation,
} from "./extension-inventory";
import {
	fetchMarketplaceCatalog,
	getCachedMarketplaceCatalog,
	type MarketplaceCatalog,
	type MarketplaceEntry,
} from "./marketplace";
import { marketplaceEntryKey } from "./marketplace-entry";
import {
	fetchMarketplaceInstalledEntries,
	getCachedMarketplaceInstalledEntries,
	updateCachedMarketplaceEntry,
} from "./marketplace-installed";

export type EntryActionState =
	| { status: "idle" }
	| { status: "installing" }
	| { status: "uninstalling" }
	| { status: "installed"; message: string }
	| { status: "uninstalled"; message: string }
	| {
			status: "failed";
			operation: "install" | "uninstall";
			message: string;
	  };

function useMarketplaceActionState() {
	const [actionStates, setActionStates] = useState<
		Map<string, EntryActionState>
	>(() => new Map());
	const pendingActions = useRef(new Set<string>());
	return useMemo(
		() => ({ actionStates, setActionStates, pendingActions }),
		[actionStates],
	);
}

const MarketplaceActionsContext = createContext<ReturnType<
	typeof useMarketplaceActionState
> | null>(null);

/** Keep in-progress actions and feedback stable while navigating Customize. */
export function MarketplaceActionsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const actions = useMarketplaceActionState();
	return (
		<MarketplaceActionsContext.Provider value={actions}>
			{children}
		</MarketplaceActionsContext.Provider>
	);
}

type MarketplaceInstallResult = {
	status: "installed" | "uninstalled";
	message: string;
};

export type MarketplaceDirectory = {
	catalog: MarketplaceCatalog | null;
	errorMessage: string | null;
	loading: boolean;
	tagLabels: Map<string, string>;
	installedKeys: Set<string>;
	installedReady: boolean;
	installedLoading: boolean;
	installedError: string | null;
	actionStates: Map<string, EntryActionState>;
	install: (entry: MarketplaceEntry) => Promise<void>;
	uninstall: (entry: MarketplaceEntry) => Promise<void>;
	removeInstalledKeys: (keys: readonly string[]) => void;
};

/** Catalog, installed status, and mutations shared by Browse, Manage, and details. */
export function useMarketplaceDirectory(
	onInventoryChanged?: () => void | Promise<void>,
	installedItemsSignature?: string,
): MarketplaceDirectory {
	const [catalog, setCatalog] = useState(getCachedMarketplaceCatalog);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [installedKeys, setInstalledKeys] = useState<Set<string>>(
		() => new Set(getCachedMarketplaceInstalledEntries(catalog)?.installedKeys),
	);
	const [installedReady, setInstalledReady] = useState(
		() => getCachedMarketplaceInstalledEntries(catalog) !== null,
	);
	const [installedLoading, setInstalledLoading] = useState(
		() => getCachedMarketplaceInstalledEntries(catalog) === null,
	);
	const [installedError, setInstalledError] = useState<string | null>(null);
	const installedRevision = useRef(0);
	const previousItemsSignature = useRef(installedItemsSignature);
	const sharedActions = useContext(MarketplaceActionsContext);
	const localActions = useMarketplaceActionState();
	const { actionStates, setActionStates, pendingActions } =
		sharedActions ?? localActions;

	useEffect(() => {
		let cancelled = false;
		void fetchMarketplaceCatalog().then(
			(nextCatalog) => {
				if (cancelled) return;
				setCatalog(nextCatalog);
				setErrorMessage(null);
			},
			(error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : String(error));
				setInstalledReady(true);
				setInstalledLoading(false);
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!catalog) return;
		let cancelled = false;
		const force = previousItemsSignature.current !== installedItemsSignature;
		previousItemsSignature.current = installedItemsSignature;
		const refresh = async () => {
			const revision = ++installedRevision.current;
			setInstalledLoading(!getCachedMarketplaceInstalledEntries(catalog));
			setInstalledError(null);
			try {
				const response = await fetchMarketplaceInstalledEntries(catalog, {
					force,
				});
				if (!cancelled && revision === installedRevision.current) {
					setInstalledKeys(new Set(response.installedKeys));
				}
			} catch (error) {
				if (!cancelled && revision === installedRevision.current) {
					setInstalledError(
						error instanceof Error ? error.message : String(error),
					);
				}
			} finally {
				if (!cancelled && revision === installedRevision.current) {
					setInstalledReady(true);
					setInstalledLoading(false);
				}
			}
		};
		void refresh();
		const unsubscribe = subscribeToExtensionInventoryInvalidation(
			() => void refresh(),
		);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [catalog, installedItemsSignature]);

	const tagLabels = useMemo(
		() => new Map(catalog?.tags.map((tag) => [tag.id, tag.label]) ?? []),
		[catalog?.tags],
	);

	// Local inventory can prove an entry disappeared before its async recheck.
	const removeInstalledKeys = useCallback((keys: readonly string[]) => {
		installedRevision.current += 1;
		setInstalledKeys((current) => {
			const next = new Set(current);
			for (const key of keys) next.delete(key);
			return next;
		});
		setInstalledLoading(false);
	}, []);

	const mutate = async (entry: MarketplaceEntry, installed: boolean) => {
		const key = marketplaceEntryKey(entry);
		if (pendingActions.current.has(key)) return;
		pendingActions.current.add(key);
		const setState = (state: EntryActionState) => {
			setActionStates((current) => new Map(current).set(key, state));
		};
		setState({ status: installed ? "installing" : "uninstalling" });
		try {
			const result = await desktopClient.invoke<MarketplaceInstallResult>(
				installed ? "install_marketplace_entry" : "uninstall_marketplace_entry",
				{ entry },
				// The hub queues MCP changes, so they have no client deadline.
				{ timeoutMs: entry.type === "mcp" ? null : 300_000 },
			);
			installedRevision.current += 1;
			setState({
				status: installed ? "installed" : "uninstalled",
				message: result.message,
			});
			setInstalledKeys((current) => {
				const next = new Set(current);
				if (installed) next.add(key);
				else next.delete(key);
				return next;
			});
			invalidateExtensionInventoryCache();
			// Supersede refreshes triggered by invalidation with the completed mutation.
			updateCachedMarketplaceEntry(entry, installed);
			await onInventoryChanged?.();
		} catch (error) {
			setState({
				status: "failed",
				operation: installed ? "install" : "uninstall",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			pendingActions.current.delete(key);
		}
	};

	return {
		catalog,
		errorMessage,
		loading: !catalog && !errorMessage,
		tagLabels,
		installedKeys,
		installedReady,
		installedLoading,
		installedError,
		actionStates,
		install: (entry) => mutate(entry, true),
		uninstall: (entry) => mutate(entry, false),
		removeInstalledKeys,
	};
}
