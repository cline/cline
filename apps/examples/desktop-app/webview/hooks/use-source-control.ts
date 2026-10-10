"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

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
	| { type: "commit"; message: string; push: boolean }
	| { type: "push" }
	| { type: "pull" };

const POLL_INTERVAL_MS = 10_000;

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

	const refresh = useCallback(async () => {
		if (!enabled || !cwd) return;
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
	}, [cwd, enabled, environmentId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an explicit trigger
	useEffect(() => {
		void refresh();
	}, [refresh, refreshKey]);

	useEffect(() => {
		if (!enabled) return;
		const refreshIfVisible = () => {
			if (document.visibilityState === "visible") void refresh();
		};
		const interval = window.setInterval(refreshIfVisible, POLL_INTERVAL_MS);
		window.addEventListener("focus", refreshIfVisible);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", refreshIfVisible);
		};
	}, [enabled, refresh]);

	const runAction = useCallback(
		async (action: SourceControlAction): Promise<boolean> => {
			setBusy(true);
			try {
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
				void refresh();
			}
		},
		[cwd, environmentId, refresh],
	);

	return { state, loading, error, busy, refresh, runAction };
}
