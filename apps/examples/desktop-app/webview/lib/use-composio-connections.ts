"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	cancelComposioConnect,
	connectComposioIntegration,
	disconnectComposioIntegration,
} from "./composio";
import type {
	ComposioStatusResponse,
	ComposioToolkitSlug,
} from "./composio-types";
import { useComposioStatus } from "./use-composio-status";

export type ComposioConnectionAction = "connect" | "cancel" | "disconnect";

/**
 * Shared state machine for Composio connections, used by both the Customize >
 * Connectors tab and the Marketplace connector browser.
 *
 * Status, errors, and pending OAuth polling belong to the shared status store;
 * action feedback remains scoped to the control that started the request.
 */
export function useComposioConnections({
	onChanged,
}: {
	onChanged?: () => void;
} = {}) {
	const {
		status,
		loading: refreshing,
		error: loadError,
		refresh,
	} = useComposioStatus();
	// Scoped to the toolkit the failed action targeted, so one connector's
	// failure is never rendered as another connector's error.
	const [actionError, setActionError] = useState<{
		toolkit: ComposioToolkitSlug;
		operation: ComposioConnectionAction;
		message: string;
	} | null>(null);
	const [busyToolkit, setBusyToolkit] = useState<ComposioToolkitSlug | null>(
		null,
	);

	const onChangedRef = useRef(onChanged);
	useEffect(() => {
		onChangedRef.current = onChanged;
	}, [onChanged]);

	useEffect(() => {
		if (status) onChangedRef.current?.();
	}, [status]);

	const connect = useCallback(async (toolkit: ComposioToolkitSlug) => {
		setBusyToolkit(toolkit);
		setActionError(null);
		try {
			await connectComposioIntegration(toolkit);
		} catch (error) {
			setActionError({
				toolkit,
				operation: "connect",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusyToolkit(null);
		}
	}, []);

	const cancelConnect = useCallback(async (toolkit: ComposioToolkitSlug) => {
		setBusyToolkit(toolkit);
		setActionError(null);
		try {
			await cancelComposioConnect(toolkit);
		} catch (error) {
			setActionError({
				toolkit,
				operation: "cancel",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusyToolkit(null);
		}
	}, []);

	const disconnect = useCallback(async (toolkit: ComposioToolkitSlug) => {
		setBusyToolkit(toolkit);
		setActionError(null);
		try {
			await disconnectComposioIntegration(toolkit);
		} catch (error) {
			setActionError({
				toolkit,
				operation: "disconnect",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusyToolkit(null);
		}
	}, []);

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
