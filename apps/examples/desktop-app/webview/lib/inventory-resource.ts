import { useSyncExternalStore } from "react";

type InventorySnapshot<T> = {
	data: T | null;
	loading: boolean;
	error: string | null;
};

/** Publish one read state for every consumer of an existing inventory cache. */
export function createInventoryResource<T>({
	getCached,
	fetch,
	subscribeInvalidation,
}: {
	getCached: () => T | null;
	fetch: (options: { force?: boolean }) => Promise<T>;
	subscribeInvalidation: (listener: () => void) => () => void;
}) {
	const cached = getCached();
	let snapshot: InventorySnapshot<T> = {
		data: cached,
		loading: !cached,
		error: null,
	};
	let revision = 0;
	const listeners = new Set<() => void>();
	let stopInvalidation: (() => void) | undefined;

	function publish(next: InventorySnapshot<T>) {
		if (
			next.data === snapshot.data &&
			next.loading === snapshot.loading &&
			next.error === snapshot.error
		)
			return;
		snapshot = next;
		for (const listener of listeners) listener();
	}

	/** Return only a successfully published response, so callers can run follow-up actions. */
	async function refresh(force = false): Promise<T | null> {
		const request = ++revision;
		const cached = getCached();
		publish({
			data: cached ?? snapshot.data,
			loading: !cached && !snapshot.data,
			error: null,
		});
		try {
			const data = await fetch({ force });
			if (request !== revision) return null;
			publish({ data, loading: false, error: null });
			return data;
		} catch (error) {
			if (request === revision)
				publish({
					data: snapshot.data,
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
			return null;
		}
	}

	function subscribe(listener: () => void) {
		listeners.add(listener);
		if (listeners.size === 1) {
			// Reconcile invalidations while no consumer was mounted.
			const data = getCached();
			publish({ data, loading: !data, error: null });
			stopInvalidation = subscribeInvalidation(() => {
				void refresh();
			});
			void refresh();
		}
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) {
				stopInvalidation?.();
				stopInvalidation = undefined;
				// An old request cannot publish into a later mounted session.
				revision += 1;
			}
		};
	}
	const getSnapshot = () => {
		// Reconcile before the first render as well as subscription. A page may
		// react to its initial response in an effect before the subscription's
		// replacement render, so it must not see a previous session's inventory.
		if (listeners.size === 0) {
			const data = getCached();
			if (data !== snapshot.data)
				snapshot = { data, loading: !data, error: null };
		}
		return snapshot;
	};
	function useSnapshot() {
		return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	}
	return { useSnapshot, refresh };
}
