import type { SessionThread } from "@/hooks/use-session-history";
import type { SessionHistoryStatus } from "@/lib/session-history";

/*
 * Sidebar history shown while a dev demo is open, so recordings are not framed
 * by whatever test sessions the machine happens to have. The titles are the
 * kind of work the Tidepool board's own cards describe.
 */

const WORKSPACE = "~/code/tidepool";

const HISTORY: Array<[title: string, time: string]> = [
	["Fix flaky drag-and-drop test in BoardColumn", "38m"],
	["Add keyboard shortcuts cheat sheet", "2h"],
	["Migrate card attachments to R2", "4h"],
	["Investigate slow board load for large workspaces", "1d"],
	["Rate-limit the public webhooks endpoint", "1d"],
	["Fix timezone drift in due dates", "2d"],
	["Add bulk archive endpoint", "3d"],
	["Upgrade to Vite 6 and fix build warnings", "4d"],
	["Board-level permissions for guests", "6d"],
	["Audit empty states across the board", "8d"],
];

const thread = (
	id: string,
	title: string,
	time: string,
	status: SessionHistoryStatus,
): SessionThread => ({
	id,
	title,
	time,
	status,
	codebase: "tidepool",
	workspacePath: WORKSPACE,
	provider: "cline",
	model: "anthropic/claude-sonnet-4.5",
	isScheduled: false,
});

/** The demo's own session first, then recent history. */
export function demoSidebarThreads(session: {
	id: string;
	title: string;
	status: SessionHistoryStatus;
}): SessionThread[] {
	return [
		thread(session.id, session.title, "now", session.status),
		...HISTORY.map(([title, time], index) =>
			thread(`demo-history-${index}`, title, time, "completed"),
		),
	];
}
