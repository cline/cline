import type { StatusState, StatusUpdate } from "@cline/shared";

const now = Date.now();

function demoUpdate(input: {
	subject: string;
	state: StatusState;
	headline: string;
	agentName: string;
	seq: number;
	minutesAgo: number;
	previousState?: StatusState;
}): StatusUpdate {
	const createdAt = new Date(now - input.minutesAgo * 60_000).toISOString();
	return {
		schemaVersion: 1,
		updateId: `demo-${input.subject}-${input.seq}`,
		seq: input.seq,
		subject: input.subject,
		state: input.state,
		headline: input.headline,
		detail: undefined,
		priority: input.state === "blocked" ? "high" : "normal",
		progress: input.state === "running" ? 0.45 : undefined,
		sessionId: "demo-session",
		agentId: input.agentName.toLowerCase().replace(/\s+/g, "-"),
		agentName: input.agentName,
		workspaceRoot: "/workspace",
		source: "sdk",
		tags: [],
		metadata: {},
		supersededAt: null,
		createdAt,
		previousState: input.previousState,
		historyCount: input.seq,
	};
}

/** Board rows for docs / TUI demos when no live status exists. */
export const STATUS_BOARD_DEMO_UPDATES: StatusUpdate[] = [
	demoUpdate({
		subject: "drive-room/pair",
		state: "blocked",
		headline: "Waiting on DATABASE_URL for integration suite",
		agentName: "Adam",
		seq: 12,
		minutesAgo: 4,
		previousState: "running",
	}),
	demoUpdate({
		subject: "migration/auth",
		state: "running",
		headline: "Applying auth schema migration",
		agentName: "Adam",
		seq: 11,
		minutesAgo: 2,
	}),
	demoUpdate({
		subject: "review/pr-42",
		state: "running",
		headline: "Reviewing Status Hub TUI parity",
		agentName: "Cline",
		seq: 10,
		minutesAgo: 8,
	}),
	demoUpdate({
		subject: "docs/readme",
		state: "queued",
		headline: "Refresh product README screenshots",
		agentName: "Cline",
		seq: 9,
		minutesAgo: 15,
	}),
	demoUpdate({
		subject: "drive/kernel",
		state: "done",
		headline: "Shipped @cline/drive kernel package",
		agentName: "Adam",
		seq: 8,
		minutesAgo: 90,
		previousState: "running",
	}),
];
