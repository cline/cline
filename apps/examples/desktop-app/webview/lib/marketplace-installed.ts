import { desktopClient } from "./desktop-client";
import { subscribeToExtensionInventoryInvalidation } from "./extension-inventory";
import type { MarketplaceCatalog, MarketplaceEntry } from "./marketplace";

type InstalledEntries = { installedKeys: string[] };
const INSTALLED_CACHE_TTL_MS = 60_000;
let snapshot: {
	key: string;
	value: InstalledEntries;
	fetchedAt: number;
} | null = null;
let pending: { key: string; promise: Promise<InstalledEntries> } | null = null;
let revision = 0;
let observing = false;

function catalogKey(catalog: MarketplaceCatalog) {
	return JSON.stringify(
		catalog.entries.map(({ type, id, install }) => [type, id, install.args]),
	);
}

/** Keep the last result visible while revalidating, but discard older reads. */
export function invalidateMarketplaceInstalledEntries() {
	revision++;
	pending = null;
	if (snapshot) snapshot.fetchedAt = 0;
}

export function clearMarketplaceInstalledEntries() {
	invalidateMarketplaceInstalledEntries();
	snapshot = null;
}

function observeInventory() {
	if (observing) return;
	observing = true;
	subscribeToExtensionInventoryInvalidation((reason) => {
		if (reason === "settings") clearMarketplaceInstalledEntries();
		else invalidateMarketplaceInstalledEntries();
	});
}

export function getCachedMarketplaceInstalledEntries(
	catalog: MarketplaceCatalog | null,
): InstalledEntries | null {
	return catalog && snapshot?.key === catalogKey(catalog)
		? snapshot.value
		: null;
}

export function fetchMarketplaceInstalledEntries(
	catalog: MarketplaceCatalog,
	{ force = false } = {},
): Promise<InstalledEntries> {
	observeInventory();
	const key = catalogKey(catalog);
	if (pending?.key === key) return pending.promise;
	if (
		!force &&
		snapshot?.key === key &&
		Date.now() - snapshot.fetchedAt < INSTALLED_CACHE_TTL_MS
	) {
		return Promise.resolve(snapshot.value);
	}
	const version = revision;
	const promise = desktopClient
		.invoke<InstalledEntries>("list_marketplace_installed_entries", {
			entries: catalog.entries,
		})
		.then(
			(value) => {
				if (version !== revision)
					return fetchMarketplaceInstalledEntries(catalog);
				snapshot = { key, value, fetchedAt: Date.now() };
				return value;
			},
			(error) => {
				if (version !== revision)
					return fetchMarketplaceInstalledEntries(catalog);
				throw error;
			},
		)
		.finally(() => {
			if (pending?.promise === promise) pending = null;
		});
	pending = { key, promise };
	return promise;
}

/** Publish completed mutations even if their originating view was unmounted. */
export function updateCachedMarketplaceEntry(
	entry: MarketplaceEntry,
	installed: boolean,
) {
	invalidateMarketplaceInstalledEntries();
	if (!snapshot) return;
	const key = `${entry.type}:${entry.id}`;
	const keys = new Set(snapshot.value.installedKeys);
	if (installed) keys.add(key);
	else keys.delete(key);
	snapshot.value = { installedKeys: [...keys] };
	snapshot.fetchedAt = Date.now();
}
