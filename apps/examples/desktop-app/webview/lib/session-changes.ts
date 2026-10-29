import { useEffect, useRef, useState } from "react";
import { desktopClient } from "./desktop-client";

/** One file from the sidecar's `get_session_changes`. */
export type SessionChangeFile = {
	/** Repository-root-relative, forward slashes. */
	path: string;
	status: "A" | "M" | "D";
	/** Null for binary files. */
	additions: number | null;
	deletions: number | null;
	oldOid?: string;
	newOid?: string;
};

export type SessionChangeSet = {
	files: SessionChangeFile[];
	omitted: number;
};

export type SessionChanges = {
	root?: string;
	session?: SessionChangeSet;
	/** The latest turn, identified by its run count. */
	lastTurn?: SessionChangeSet & { runCount: number };
	/** Set when the workspace has no git checkpoints to compare. */
	unavailableReason?: string;
};

export type SessionChangeContents = {
	oldText?: string;
	newText: string;
	binary: boolean;
	truncated: boolean;
};

export type ChangesScope = "last-turn" | "session";

export function sumChanges(files: readonly SessionChangeFile[]): {
	additions: number;
	deletions: number;
} {
	return files.reduce(
		(totals, file) => ({
			additions: totals.additions + (file.additions ?? 0),
			deletions: totals.deletions + (file.deletions ?? 0),
		}),
		{ additions: 0, deletions: 0 },
	);
}

const REFRESH_DEBOUNCE_MS = 400;

/**
 * Last-turn and whole-session changes for a local session, refetched whenever
 * `refreshKey` changes (tool edits and turn boundaries). Errors, such as an
 * untrusted connection, read as unavailable so hosts fall back to the
 * tool-event reconstruction. `current` is false until the fetch for the
 * latest `refreshKey` lands, so hosts can hold back views that must not show
 * the previous turn's changes.
 */
export function useSessionChanges({
	enabled,
	environmentId,
	sessionId,
	cwd,
	refreshKey,
}: {
	enabled: boolean;
	environmentId: string;
	sessionId: string | null;
	cwd: string;
	refreshKey: string;
}): { changes: SessionChanges | null; current: boolean } {
	const [result, setResult] = useState<{
		key: string;
		changes: SessionChanges;
	} | null>(null);
	const requestRef = useRef(0);

	// A different session never shows the previous one's changes.
	useEffect(() => {
		void sessionId;
		void cwd;
		setResult(null);
	}, [sessionId, cwd]);

	useEffect(() => {
		if (!enabled || !sessionId || !cwd) return;
		const request = ++requestRef.current;
		const timer = window.setTimeout(() => {
			desktopClient
				.invoke<SessionChanges>("get_session_changes", {
					environmentId,
					sessionId,
					cwd,
				})
				.catch((error: unknown) => ({
					unavailableReason:
						error instanceof Error ? error.message : String(error),
				}))
				.then((next) => {
					if (request === requestRef.current) {
						setResult({ key: refreshKey, changes: next });
					}
				});
		}, REFRESH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [enabled, environmentId, sessionId, cwd, refreshKey]);

	return {
		changes: result?.changes ?? null,
		current: result?.key === refreshKey,
	};
}
