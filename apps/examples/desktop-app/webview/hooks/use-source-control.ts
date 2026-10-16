"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";

export type SourceControlStatus = "M" | "A" | "D" | "R" | "?" | "U";

export type SourceControlFile = {
	/** Repository-root-relative, forward slashes. */
	path: string;
	/** Previous path of a staged rename or copy; unstaging must cover both. */
	originalPath?: string;
	status: SourceControlStatus;
	additions: number | null;
	deletions: number | null;
};

/** A file as changed by a past commit. */
export type CommitFile = {
	path: string;
	originalPath?: string;
	status: SourceControlStatus;
	additions: number | null;
	deletions: number | null;
};

export type SourceControlCommit = {
	sha: string;
	shortSha: string;
	subject: string;
	relativeDate: string;
	pushed: boolean;
};

export type SourceControlState = {
	environmentId: string;
	root: string | null;
	branch: string | null;
	hasUpstream: boolean;
	ahead: number;
	behind: number;
	staged: SourceControlFile[];
	unstaged: SourceControlFile[];
	untracked: SourceControlFile[];
	commits: SourceControlCommit[];
};

export type SourceControlAction =
	| { type: "stage"; paths: string[] }
	| { type: "unstage"; paths: string[] }
	| { type: "discard"; paths: string[]; untrackedPaths: string[] }
	| { type: "fetch" };

// Over SSH every poll is a remote git invocation, so it runs less often.
const LOCAL_POLL_INTERVAL_MS = 5_000;
const REMOTE_POLL_INTERVAL_MS = 15_000;
// Fetching hits the network, so it runs far less often than status polls.
export const FETCH_INTERVAL_MS = 60_000;

/** Paths `git restore --staged` needs to fully undo staging these files. */
export function unstagePaths(files: SourceControlFile[]): string[] {
	const paths: string[] = [];
	for (const file of files) {
		paths.push(file.path);
		if (file.originalPath) paths.push(file.originalPath);
	}
	return paths;
}

/**
 * Repository state for the workspace panel. Refreshes on mount, on an
 * interval while the window is visible, on focus, and after every action;
 * callers can also bump `refreshKey` (e.g. when the agent edits files).
 *
 * While mounted, it also fetches the upstream once and then every minute so
 * the behind count reflects commits pushed elsewhere; unmounting (closing the
 * panel) stops it. Fetches are silent and never overlap a user action.
 */
export function useSourceControl({
	environmentId,
	cwd,
	enabled,
	refreshKey,
}: {
	environmentId: string;
	cwd: string;
	enabled: boolean;
	refreshKey?: string;
}) {
	const [state, setState] = useState<SourceControlState | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const requestRef = useRef(0);
	// The fetch in flight, so actions wait for it rather than contend for
	// git's ref locks (a pull fetches too).
	const fetchRef = useRef<Promise<void> | null>(null);
	const busyRef = useRef(false);

	// A refresh already in flight answers for later polls too; otherwise a
	// status read slower than the poll interval would be discarded forever.
	// Forced refreshes (after an action or an agent edit) must reflect what
	// just changed, so they queue one more read behind the pending one.
	const inFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(
		null,
	);
	const rerunRef = useRef(false);
	const refresh = useCallback(
		async (options?: { force?: boolean }) => {
			if (!enabled || !cwd) return;
			const key = `${environmentId}\0${cwd}`;
			const pending = inFlightRef.current;
			if (pending?.key === key) {
				if (options?.force) rerunRef.current = true;
				return pending.promise;
			}
			const start = (): Promise<void> => {
				const run = load().finally(() => {
					if (inFlightRef.current?.promise === run) inFlightRef.current = null;
					if (rerunRef.current) {
						rerunRef.current = false;
						void start();
					}
				});
				inFlightRef.current = { key, promise: run };
				return run;
			};
			return start();
			async function load() {
				const requestId = ++requestRef.current;
				setLoading(true);
				try {
					const next = await desktopClient.invoke<SourceControlState>(
						"get_source_control_state",
						{ environmentId, cwd },
					);
					if (requestId !== requestRef.current) return;
					setState(next);
					setError(null);
				} catch (caught) {
					if (requestId !== requestRef.current) return;
					setError(caught instanceof Error ? caught.message : String(caught));
				} finally {
					if (requestId === requestRef.current) setLoading(false);
				}
			}
		},
		[cwd, enabled, environmentId],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an explicit trigger
	useEffect(() => {
		void refresh({ force: true });
	}, [refresh, refreshKey]);

	useEffect(() => {
		if (!enabled) return;
		const refreshIfVisible = () => {
			if (document.visibilityState === "visible") void refresh();
		};
		const interval = window.setInterval(
			refreshIfVisible,
			environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID
				? LOCAL_POLL_INTERVAL_MS
				: REMOTE_POLL_INTERVAL_MS,
		);
		window.addEventListener("focus", refreshIfVisible);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", refreshIfVisible);
		};
	}, [enabled, refresh, environmentId]);

	const hasUpstream = Boolean(state?.root && state.hasUpstream);
	useEffect(() => {
		if (!enabled || !hasUpstream) return;
		let cancelled = false;
		const fetchUpstream = () => {
			if (fetchRef.current || busyRef.current) return;
			if (document.visibilityState !== "visible") return;
			const run = desktopClient
				.invoke("run_source_control_action", {
					environmentId,
					cwd,
					action: { type: "fetch" },
				})
				.then(
					() => {
						if (!cancelled) void refresh({ force: true });
					},
					() => {
						// Offline, no credentials, or no remote: the next tick retries.
					},
				)
				.finally(() => {
					if (fetchRef.current === run) fetchRef.current = null;
				});
			fetchRef.current = run;
		};
		fetchUpstream();
		const interval = window.setInterval(fetchUpstream, FETCH_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [cwd, enabled, environmentId, hasUpstream, refresh]);

	const runAction = useCallback(
		async (action: SourceControlAction): Promise<boolean> => {
			setBusy(true);
			busyRef.current = true;
			try {
				await fetchRef.current;
				await desktopClient.invoke("run_source_control_action", {
					environmentId,
					cwd,
					action,
				});
				return true;
			} catch (caught) {
				throw caught instanceof Error ? caught : new Error(String(caught));
			} finally {
				setBusy(false);
				busyRef.current = false;
				void refresh({ force: true });
			}
		},
		[cwd, environmentId, refresh],
	);

	return { state, loading, error, busy, refresh, runAction };
}
