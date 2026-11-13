import { useEffect, useSyncExternalStore } from "react";
import {
	fetchComposioToolkitCatalog,
	getComposioCatalogSnapshot,
	getServerComposioCatalogSnapshot,
	subscribeComposioCatalog,
} from "./composio";

async function refresh() {
	await fetchComposioToolkitCatalog().catch(() => {});
}

export function useComposioCatalog(configured: boolean) {
	const snapshot = useSyncExternalStore(
		subscribeComposioCatalog,
		getComposioCatalogSnapshot,
		getServerComposioCatalogSnapshot,
	);
	useEffect(() => {
		if (configured) void refresh();
	}, [configured]);
	useEffect(() => {
		// An account invalidation can finish its status reload in the same render
		// batch, so catalog replacement cannot depend only on configured changing.
		if (configured && !snapshot.catalog && !snapshot.loading && !snapshot.error)
			void refresh();
	}, [configured, snapshot.catalog, snapshot.loading, snapshot.error]);
	return {
		...(configured ? snapshot : getServerComposioCatalogSnapshot()),
		refresh,
	};
}
