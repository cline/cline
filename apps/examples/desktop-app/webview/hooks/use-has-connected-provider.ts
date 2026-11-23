"use client";

import { useEffect, useState } from "react";
import { isProviderConnected } from "@/lib/provider-connection";
import {
	fetchProviderCatalog,
	subscribeToProviderCatalogInvalidation,
} from "@/lib/provider-model-catalog";

/**
 * Whether at least one model provider is connected (usable for turns).
 * Returns null while unknown so callers can avoid flashing a disabled state
 * before the catalog loads. Stays current across credential changes via the
 * shared catalog invalidation channel.
 */
export function useHasConnectedProvider(): boolean | null {
	const [hasConnectedProvider, setHasConnectedProvider] = useState<
		boolean | null
	>(null);

	useEffect(() => {
		let cancelled = false;
		const load = () => {
			// Failures (including an unavailable transport) keep the last known
			// value; the catalog fetch is retried on the next invalidation.
			try {
				void Promise.resolve(fetchProviderCatalog())
					.then((payload) => {
						if (cancelled) return;
						setHasConnectedProvider(
							(payload?.providers ?? []).some(isProviderConnected),
						);
					})
					.catch(() => {});
			} catch {}
		};
		load();
		const unsubscribe = subscribeToProviderCatalogInvalidation(load);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	return hasConnectedProvider;
}
