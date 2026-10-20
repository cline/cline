import type { SessionThread } from "@/hooks/use-session-history";
import type { SessionHistoryStatus } from "@/lib/session-history";
import { TITLE } from "./team-script";

/*
 * Sidebar history shown while the team demo is open, so the recording is not
 * framed by whatever test sessions the machine happens to have. The titles are
 * the kind of work the Tidepool board's own cards describe.
 */

export const DEMO_SESSION_ID = "team-demo/lead";

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

export function demoSidebarThreads(
	status: SessionHistoryStatus,
): SessionThread[] {
	return [
		thread(DEMO_SESSION_ID, TITLE, "now", status),
		...HISTORY.map(([title, time], index) =>
			thread(`team-demo/history-${index}`, title, time, "completed"),
		),
	];
}
