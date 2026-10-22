"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	cancelComposioConnect,
	connectComposioIntegration,
	disconnectComposioIntegration,
	fetchComposioStatus,
} from "./composio";
import type {
	ComposioStatusResponse,
	ComposioToolkitSlug,
} from "./composio-types";

const CONNECT_POLL_INTERVAL_MS = 3_000;

/**
 * Shared state machine for Composio connections, used by both the Customize >
 * Connectors tab and the Marketplace connector browser.
 *
 * The OAuth flow finishes in the external browser, which cannot navigate the
 * app back, so while a connection is pending this hook polls the sidecar
 * until the connection lands — the same pattern as the GitHub App install
 * step in onboarding.
 */
export function useComposioConnections({
	onChanged,
}: {
	onChanged?: () => void;
} = {}) {
	const [status, setStatus] = useState<ComposioStatusResponse | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	// Scoped to the toolkit the failed action targeted, so one connector's
	// failure is never rendered as another connector's error.
	const [actionError, setActionError] = useState<{
		toolkit: ComposioToolkitSlug;
		message: string;
	} | null>(null);
	const [busyToolkit, setBusyToolkit] = useState<ComposioToolkitSlug | null>(
		null,
	);

	const onChangedRef = useRef(onChanged);
	useEffect(() => {
		onChangedRef.current = onChanged;
	}, [onChanged]);

	// Bumped by every status write so a slow refresh that started before a
	// connect/disconnect cannot land afterwards and resurrect the old state.
	const statusVersionRef = useRef(0);
	const applyStatus = useCallback((next: ComposioStatusResponse) => {
		statusVersionRef.current += 1;
		setStatus(next);
		onChangedRef.current?.();
	}, []);

	const [refreshing, setRefreshing] = useState(false);
	// Reconciles against Composio (connections can be revoked from the
	// Composio dashboard without this app knowing). Runs on mount and from
	// the tab's refresh button.
	const refresh = useCallback(async () => {
		const version = statusVersionRef.current;
		setRefreshing(true);
		try {
			const next = await fetchComposioStatus({ refresh: true });
			if (statusVersionRef.current !== version) return;
			applyStatus(next);
			setLoadError(null);
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error));
		} finally {
			setRefreshing(false);
		}
	}, [applyStatus]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const hasPending = useMemo(
		() =>
			status?.integrations.some(
				(integration) => integration.status === "pending",
			) ?? false,
		[status],
	);

	useEffect(() => {
		if (!hasPending) {
			return;
		}
		let cancelled = false;
		let inFlight = false;
		const interval = setInterval(() => {
			if (inFlight) {
				return;
			}
			inFlight = true;
			void fetchComposioStatus()
				.then((next) => {
					if (!cancelled) {
						applyStatus(next);
					}
				})
				.catch(() => {
					// Transient failures keep polling; the user can cancel.
				})
				.finally(() => {
					inFlight = false;
				});
		}, CONNECT_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [hasPending, applyStatus]);

	const connect = useCallback(
		async (toolkit: ComposioToolkitSlug) => {
			setBusyToolkit(toolkit);
			setActionError(null);
			try {
				const result = await connectComposioIntegration(toolkit);
				applyStatus(result.status);
			} catch (error) {
				setActionError({
					toolkit,
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setBusyToolkit(null);
			}
		},
		[applyStatus],
	);

	const cancelConnect = useCallback(
		async (toolkit: ComposioToolkitSlug) => {
			try {
				applyStatus(await cancelComposioConnect(toolkit));
			} catch {
				// Cancel is best-effort; the poll loop will settle the state.
			}
		},
		[applyStatus],
	);

	const disconnect = useCallback(
		async (toolkit: ComposioToolkitSlug) => {
			setBusyToolkit(toolkit);
			setActionError(null);
			try {
				applyStatus(await disconnectComposioIntegration(toolkit));
			} catch (error) {
				setActionError({
					toolkit,
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setBusyToolkit(null);
			}
		},
		[applyStatus],
	);

	const statusBySlug = useMemo(() => {
		const map = new Map<
			string,
			ComposioStatusResponse["integrations"][number]
		>();
		for (const integration of status?.integrations ?? []) {
			map.set(integration.toolkit, integration);
		}
		return map;
	}, [status]);

	return {
		status,
		statusBySlug,
		configured: status?.configured ?? false,
		loadError,
		actionError,
		busyToolkit,
		refreshing,
		refresh,
		connect,
		cancelConnect,
		disconnect,
	};
}
