"use client";

import { type RefObject, useEffect, useRef } from "react";
import type { ProcessContext } from "@/hooks/chat-session/types";
import { desktopClient } from "@/lib/desktop-client";
import {
	type RemoteWorkspaceEnvironment,
	remoteWorkspaceEnvironmentFromContext,
} from "@/lib/workspace-environment";

/**
 * Reads the remote environment the sidecar is connected to. The app is hidden
 * with Activity while the Hub restarts, and showing it again re-runs this
 * effect, so `isFirstLoad` lets the caller refresh the environment on every
 * load but only bootstrap navigation once.
 */
export function useRemoteEnvironmentBootstrap(
	selectionRevision: RefObject<number>,
	onLoad: (
		environment: RemoteWorkspaceEnvironment | null,
		isFirstLoad: boolean,
	) => void,
): void {
	const loadedRef = useRef(false);
	useEffect(() => {
		let cancelled = false;
		const revision = selectionRevision.current;
		desktopClient
			.invoke<ProcessContext>("get_process_context")
			.then((context) => {
				if (cancelled || revision !== selectionRevision.current) return;
				const isFirstLoad = !loadedRef.current;
				loadedRef.current = true;
				onLoad(remoteWorkspaceEnvironmentFromContext(context), isFirstLoad);
			})
			.catch(() => {
				// The chat bootstrap reports backend availability separately.
			});
		return () => {
			cancelled = true;
		};
	}, [selectionRevision, onLoad]);
}
