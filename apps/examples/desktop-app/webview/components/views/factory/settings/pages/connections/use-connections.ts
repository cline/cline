"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
	type FactoryConnections,
	type FactoryMcpServers,
	type FactoryProviderCatalog,
	type FactorySettingsClient,
	factorySettingsErrorMessage,
	isUnavailable,
} from "@/lib/factory-settings-client";
import { FS_SHELL } from "@/lib/factory-settings-copy/shell";

export type ConnectionRead<T> = {
	status: "loading" | "ready" | "unavailable" | "error";
	data?: T;
	unavailable?: "build" | "hub";
	error?: string;
};

export type ConnectionsState = {
	/** `factory_get_connections`: gh, Linear, the Hub. */
	connections: ConnectionRead<FactoryConnections>;
	providers: ConnectionRead<FactoryProviderCatalog>;
	mcp: ConnectionRead<FactoryMcpServers>;
	/** A read is in flight (the first one, or Check again). */
	checking: boolean;
};

type Store = {
	state: ConnectionsState;
	listeners: Set<() => void>;
	/** Mounted readers; the first one to mount reads again. */
	readers: number;
	seq: number;
};

const LOADING: ConnectionsState = {
	connections: { status: "loading" },
	providers: { status: "loading" },
	mcp: { status: "loading" },
	checking: true,
};

/**
 * One read per client, shared by the Connections page, its nav count and the
 * Hub row on This computer, so the section list's count and the page agree
 * and opening a page does not probe gh again.
 */
const stores = new WeakMap<FactorySettingsClient, Store>();

function storeFor(client: FactorySettingsClient): Store {
	let store = stores.get(client);
	if (!store) {
		store = { state: LOADING, listeners: new Set(), readers: 0, seq: 0 };
		stores.set(client, store);
	}
	return store;
}

function settle<T>(result: PromiseSettledResult<T>): ConnectionRead<T> {
	if (result.status === "fulfilled")
		return { status: "ready", data: result.value };
	const cause = result.reason;
	return isUnavailable(cause)
		? { status: "unavailable", unavailable: cause.reason }
		: {
				status: "error",
				error: factorySettingsErrorMessage(cause, FS_SHELL.loadFailed),
			};
}

/** Reads every status; `refresh` makes the sidecar probe gh again. */
export async function loadConnections(
	client: FactorySettingsClient,
	refresh = false,
): Promise<void> {
	const store = storeFor(client);
	const seq = ++store.seq;
	const emit = (state: ConnectionsState) => {
		store.state = state;
		for (const listener of store.listeners) listener();
	};
	emit({ ...store.state, checking: true });
	const [connections, providers, mcp] = await Promise.allSettled([
		client.getConnections(refresh),
		client.listProviders(),
		client.listMcpServers(),
	]);
	if (seq !== store.seq) return;
	emit({
		connections: settle(connections),
		providers: settle(providers),
		mcp: settle(mcp),
		checking: false,
	});
}

export function useConnections(client: FactorySettingsClient) {
	const store = storeFor(client);
	const subscribe = useCallback(
		(listener: () => void) => {
			store.listeners.add(listener);
			return () => {
				store.listeners.delete(listener);
			};
		},
		[store],
	);
	const state = useSyncExternalStore(
		subscribe,
		() => store.state,
		() => store.state,
	);
	// Reopening settings reads again (the sidecar still caches gh for 5
	// minutes); a second reader on the same screen shares the first read.
	useEffect(() => {
		store.readers += 1;
		if (store.readers === 1) void loadConnections(client);
		return () => {
			store.readers -= 1;
		};
	}, [client, store]);
	return {
		...state,
		refresh: () => loadConnections(client, true),
	};
}
