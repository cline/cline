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

function connectionSignature(status: ComposioStatusResponse) {
	return JSON.stringify([
		status.configured,
		status.integrations
			.filter(({ status }) => status === "connected")
			.map(({ toolkit }) => toolkit)
			.sort(),
	]);
}

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
		message: string;
	} | null>(null);
	const [busyToolkit, setBusyToolkit] = useState<ComposioToolkitSlug | null>(
		null,
	);
	const actionQueueRef = useRef<Promise<void>>(Promise.resolve());

	const onChangedRef = useRef(onChanged);
	useEffect(() => {
		onChangedRef.current = onChanged;
	}, [onChanged]);

	const previousConnectionSignature = useRef<string | null>(null);
	useEffect(() => {
		if (!status) {
			previousConnectionSignature.current = null;
			return;
		}
		const signature = connectionSignature(status);
		const previous = previousConnectionSignature.current;
		previousConnectionSignature.current = signature;
		if (previous !== null && previous !== signature) {
			onChangedRef.current?.();
		}
	}, [status]);

	const runAction = useCallback(
		(toolkit: ComposioToolkitSlug, action: () => Promise<unknown>) => {
			const run = async () => {
				// Connector mutations return complete status snapshots. Serialize them so
				// an older response cannot replace a newer mutation's shared snapshot.
				setBusyToolkit(toolkit);
				setActionError(null);
				try {
					await action();
				} catch (error) {
					setActionError({
						toolkit,
						message: error instanceof Error ? error.message : String(error),
					});
				} finally {
					setBusyToolkit(null);
				}
			};
			const pending = actionQueueRef.current.then(run, run);
			actionQueueRef.current = pending;
			return pending;
		},
		[],
	);

	const connect = useCallback(
		(toolkit: ComposioToolkitSlug) => {
			return runAction(toolkit, () => connectComposioIntegration(toolkit));
		},
		[runAction],
	);

	const cancelConnect = useCallback(
		(toolkit: ComposioToolkitSlug) => {
			return runAction(toolkit, () => cancelComposioConnect(toolkit));
		},
		[runAction],
	);

	const disconnect = useCallback(
		(toolkit: ComposioToolkitSlug) => {
			return runAction(toolkit, () => disconnectComposioIntegration(toolkit));
		},
		[runAction],
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
