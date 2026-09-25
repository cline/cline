import type { AgentChangedFileEntry, AgentChangedFileStatus } from "@cline/ui";
import { countFileDiffChanges } from "@cline/ui/components/agent-chat/tool-diff";
import type { SessionFileDiff } from "./session-diff";

export type WorkspaceChangesScope = "turn" | "session" | "uncommitted";

export const WORKSPACE_CHANGES_SCOPES: {
	value: WorkspaceChangesScope;
	label: string;
	title: string;
}[] = [
	{
		value: "turn",
		label: "Last turn",
		title: "Files changed since the start of the most recent turn",
	},
	{
		value: "session",
		label: "Session",
		title: "Files changed since this session started",
	},
	{
		value: "uncommitted",
		label: "Uncommitted",
		title: "All uncommitted changes in the working tree (git)",
	},
];

/** One file from the sidecar's `get_workspace_changes` response. */
export type WorkspaceChangedFile = {
	path: string;
	status: AgentChangedFileStatus;
	oldText: string;
	newText: string;
	binary?: boolean;
	truncated?: boolean;
};

export type WorkspaceChangesResult = {
	scope: WorkspaceChangesScope;
	/** Repository root that `files[].path` entries are relative to. */
	root?: string;
	files: WorkspaceChangedFile[];
	base?: { label: string; runCount?: number };
	unavailableReason?: string;
	omittedFiles?: number;
};

export type WorkspaceDirectoryEntry = {
	name: string;
	path: string;
	kind: "file" | "directory";
};

export type WorkspaceFileContents = {
	path: string;
	text: string;
	size: number;
	binary?: boolean;
	truncated?: boolean;
};

/** A changed file as the rail renders it: list entry plus diff contents. */
export type RailChangedFile = AgentChangedFileEntry & {
	/** Omitted for created files so the diff renders as a whole new file. */
	oldText?: string;
	newText: string;
	binary?: boolean;
	truncated?: boolean;
	/**
	 * Set when the diff was reconstructed from tool events instead of git;
	 * `hunks` then carry fragments rather than whole-file contents.
	 */
	hunks?: SessionFileDiff["hunks"];
};

export function toRailChangedFiles(
	files: readonly WorkspaceChangedFile[],
): RailChangedFile[] {
	return files.map((file) => {
		const oldText = file.status === "added" ? undefined : file.oldText;
		const counts =
			file.binary || file.truncated
				? { additions: 0, deletions: 0 }
				: countFileDiffChanges(oldText, file.newText, file.path);
		return {
			path: file.path,
			status: file.status,
			...counts,
			oldText,
			newText: file.newText,
			...(file.binary ? { binary: true } : {}),
			...(file.truncated ? { truncated: true } : {}),
		};
	});
}

/**
 * Fallback for workspaces without git data (cloud sessions, plain folders,
 * sessions that predate checkpoints): the tool-event reconstruction that
 * powers the header badge.
 */
export function toRailFilesFromSessionDiffs(
	fileDiffs: readonly SessionFileDiff[],
): RailChangedFile[] {
	return fileDiffs.map((file) => ({
		path: file.path,
		status:
			file.deletions === 0 &&
			file.hunks.length > 0 &&
			file.hunks.every((hunk) => hunk.old.length === 0)
				? "added"
				: "modified",
		additions: file.additions,
		deletions: file.deletions,
		newText: "",
		hunks: file.hunks,
	}));
}

export function summarizeRailFiles(files: readonly RailChangedFile[]): {
	additions: number;
	deletions: number;
} {
	return files.reduce(
		(totals, file) => {
			totals.additions += file.additions;
			totals.deletions += file.deletions;
			return totals;
		},
		{ additions: 0, deletions: 0 },
	);
}
