"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	cancelComposioConnect,
	clearComposioApiKey,
	connectComposioIntegration,
	disconnectComposioIntegration,
	fetchComposioStatus,
	saveComposioApiKey,
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
	const [actionError, setActionError] = useState<string | null>(null);
	const [busyToolkit, setBusyToolkit] = useState<ComposioToolkitSlug | null>(
		null,
	);
	const [savingKey, setSavingKey] = useState(false);

	const onChangedRef = useRef(onChanged);
	useEffect(() => {
		onChangedRef.current = onChanged;
	}, [onChanged]);

	const applyStatus = useCallback((next: ComposioStatusResponse) => {
		setStatus(next);
		onChangedRef.current?.();
	}, []);

	// Initial load reconciles against Composio (connections can be revoked
	// from the Composio dashboard without this app knowing).
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const initial = await fetchComposioStatus({ refresh: true });
				if (!cancelled) {
					setStatus(initial);
				}
			} catch (error) {
				if (!cancelled) {
					setLoadError(error instanceof Error ? error.message : String(error));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

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

	const saveKey = useCallback(
		async (apiKey: string): Promise<boolean> => {
			const trimmed = apiKey.trim();
			if (!trimmed) {
				return false;
			}
			setSavingKey(true);
			setActionError(null);
			try {
				applyStatus(await saveComposioApiKey(trimmed));
				return true;
			} catch (error) {
				setActionError(error instanceof Error ? error.message : String(error));
				return false;
			} finally {
				setSavingKey(false);
			}
		},
		[applyStatus],
	);

	const removeKey = useCallback(async () => {
		setSavingKey(true);
		setActionError(null);
		try {
			applyStatus(await clearComposioApiKey());
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSavingKey(false);
		}
	}, [applyStatus]);

	const connect = useCallback(
		async (toolkit: ComposioToolkitSlug) => {
			setBusyToolkit(toolkit);
			setActionError(null);
			try {
				const result = await connectComposioIntegration(toolkit);
				applyStatus(result.status);
			} catch (error) {
				setActionError(error instanceof Error ? error.message : String(error));
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
				setActionError(error instanceof Error ? error.message : String(error));
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
		savingKey,
		saveKey,
		removeKey,
		connect,
		cancelConnect,
		disconnect,
	};
}
