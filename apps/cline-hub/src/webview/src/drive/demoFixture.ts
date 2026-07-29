import type {
	DirectorScript,
	StageCard,
	StagePin,
	StageState,
} from "@cline/shared";
import {
	projectStageCardsFromToolEvents,
	type StageToolEvent,
} from "./stageReducer";

/** Local UI fixture for Drive UX demos. No hub room writer. */
export type DriveDemoFixture = {
	room: { name: string; partnerName: string };
	roster: Array<{ id: string; displayName: string; role: "human" | "agent" }>;
	stageEvents: Array<{
		kind: "edit" | "command" | "test";
		summary: string;
		title: string;
	}>;
	addressSet: Array<"one" | "many" | "everyone" | "pack">;
	nowLabel: string;
	nextLabel: string;
	narration: string;
};

export const DRIVE_DEMO_FIXTURE: DriveDemoFixture = {
	room: { name: "router-fix", partnerName: "Adam" },
	roster: [
		{ id: "you", displayName: "You", role: "human" },
		{ id: "adam", displayName: "Adam", role: "agent" },
		{ id: "riley", displayName: "Riley", role: "agent" },
		{ id: "sam", displayName: "Sam", role: "agent" },
	],
	stageEvents: [
		{
			kind: "edit",
			title: "router.ts",
			summary: "Guard scheduleRetry when req.pending is already set.",
		},
		{
			kind: "command",
			title: "unit tests",
			summary: "bun -F @cline/core test:unit",
		},
		{
			kind: "test",
			title: "retry once",
			summary: "Router retries exactly once per timeout — green.",
		},
	],
	addressSet: ["everyone", "one", "many", "pack"],
	nowLabel: "running router unit tests",
	nextLabel: "explain the race, then commit",
	narration:
		"Found the race. Watch the spotlight — I will walk the pending-flag path.",
};

const FIXTURE_AT = "2026-07-25T17:00:00.000Z";

/** Last-event-wins StageCard list for DriveStagePanel demo mode. */
export function fixtureStageCards(
	fixture: DriveDemoFixture = DRIVE_DEMO_FIXTURE,
): StageCard[] {
	return fixture.stageEvents.map((event, index) => ({
		id: `demo_card_${event.kind}_${index}`,
		category: event.kind,
		title: event.title,
		summary: event.summary,
		updatedAt: FIXTURE_AT,
	}));
}

type ShareScreenDemoBeat = {
	beatId: string;
	narration: string;
	nowLabel: string;
	nextLabel: string;
	event?: StageToolEvent;
	planSummary?: string;
	humanTakesSpotlight?: boolean;
	humanPin?: StagePin;
	updatedAt: string;
};

export type ShareScreenDemoFixture = {
	roomName: string;
	agentLabel: string;
	humanLabel: string;
	directorScript: DirectorScript;
	beats: readonly ShareScreenDemoBeat[];
};

const DEMO_HUMAN_PIN: StagePin = {
	kind: "selection",
	label: "Human review note",
	ref: "Please keep the new join logic in App.tsx only and add tests for the bootstrap flag.",
};

function buildToolEvent(input: {
	id: string;
	updatedAt: string;
	name: StageToolEvent["name"];
	command?: string;
	path?: string;
	output?: unknown;
	newText?: string;
}): StageToolEvent {
	const eventInput =
		input.path && input.newText
			? { path: input.path, new_text: input.newText }
			: input.command
				? { command: input.command }
				: undefined;
	return {
		id: input.id,
		toolCallId: input.id,
		name: input.name,
		state: "output-available",
		input: eventInput,
		output: input.output,
		updatedAt: input.updatedAt,
	};
}

export const SHARE_SCREEN_DEMO_FIXTURE: ShareScreenDemoFixture = {
	roomName: "share-screen-simulated-live",
	agentLabel: "Adam (agent partner)",
	humanLabel: "You",
	directorScript: {
		scriptId: "script_share_screen_spotlight",
		ownerParticipantId: "drive:partner",
		title: "Share-screen scripted walkthrough",
		stickyShowIds: ["show_share_work_cards"],
		beats: [
			{
				beatId: "beat_plan",
				say: "Starting with a short plan, then I will edit, run commands, and test.",
				showItemId: "show_share_plan",
				sticky: { mode: "hold_until", beatId: "beat_human_spotlight" },
				advance: "auto_after_say",
			},
			{
				beatId: "beat_edit",
				say: "Applying the demo flag at the composition root.",
				showItemId: "show_share_work_cards",
				sticky: { mode: "replace" },
				advance: "on_tool",
			},
			{
				beatId: "beat_command",
				say: "Running hub checks so the cards reflect command output.",
				showItemId: "show_share_work_cards",
				sticky: { mode: "replace" },
				advance: "on_tool",
			},
			{
				beatId: "beat_test",
				say: "Tests passed, now I will hand spotlight to you for review.",
				showItemId: "show_share_work_cards",
				sticky: { mode: "replace" },
				advance: "on_tool",
			},
			{
				beatId: "beat_human_spotlight",
				say: "You are in the spotlight. The agent deck is still visible but dimmed.",
				showItemId: "show_human_pin",
				sticky: { mode: "hold" },
				advance: "on_human",
			},
		],
	},
	beats: [
		{
			beatId: "beat_plan",
			narration:
				"Plan first. I will add the demo route, mount Spotlight, then verify tests.",
			nowLabel: "announce the share-screen run plan",
			nextLabel: "apply the first code edit",
			planSummary:
				"1. Parse demoShareScreen query at bootstrap.\n2. Mount Spotlight demo on /drive.\n3. Verify with hub tests and screenshots.",
			updatedAt: "2026-07-29T06:50:00.000Z",
		},
		{
			beatId: "beat_edit",
			narration: "Edit card is live. Spotlight is showing file changes from the script.",
			nowLabel: "add share-screen fixture + route branch",
			nextLabel: "run a command check",
			event: buildToolEvent({
				id: "tool_edit_share_screen_demo",
				name: "edit",
				path: "apps/cline-hub/src/webview/src/App.tsx",
				newText: "Mount ShareScreenSpotlightDemo when demoShareScreen=1 on /drive.",
				output: { changed: true, files: 1 },
				updatedAt: "2026-07-29T06:51:00.000Z",
			}),
			updatedAt: "2026-07-29T06:51:00.000Z",
		},
		{
			beatId: "beat_command",
			narration: "Command card is live. This represents non-test shell work in Spotlight.",
			nowLabel: "run build preflight command",
			nextLabel: "run tests",
			event: buildToolEvent({
				id: "tool_command_build_sdk",
				name: "shell",
				command: "bun run build:sdk",
				output: "build:sdk completed successfully",
				updatedAt: "2026-07-29T06:52:00.000Z",
			}),
			updatedAt: "2026-07-29T06:52:00.000Z",
		},
		{
			beatId: "beat_test",
			narration: "Test card is live. The scripted loop now shows edit, command, and test.",
			nowLabel: "run hub webview tests",
			nextLabel: "handoff spotlight to human",
			event: buildToolEvent({
				id: "tool_test_hub",
				name: "shell",
				command: "bun --cwd apps/cline-hub test",
				output: "PASS apps/cline-hub webview tests",
				updatedAt: "2026-07-29T06:53:00.000Z",
			}),
			updatedAt: "2026-07-29T06:53:00.000Z",
		},
		{
			beatId: "beat_human_spotlight",
			narration:
				"Human takes the spotlight with a structured pin while the scripted agent deck stays in context.",
			nowLabel: "human review in spotlight",
			nextLabel: "return spotlight to agent",
			humanTakesSpotlight: true,
			humanPin: DEMO_HUMAN_PIN,
			updatedAt: "2026-07-29T06:54:00.000Z",
		},
	],
};

export type ShareScreenDemoProjection = {
	beatCursor: number;
	totalBeats: number;
	beatId: string;
	narration: string;
	nowLabel: string;
	nextLabel: string;
	stage: StageState;
};

export function projectShareScreenDemo(
	input?: {
		fixture?: ShareScreenDemoFixture;
		beatCursor?: number;
		spotlightOverride?: "fixture" | "human" | "agent";
	},
): ShareScreenDemoProjection {
	const fixture = input?.fixture ?? SHARE_SCREEN_DEMO_FIXTURE;
	const totalBeats = fixture.beats.length;
	const clampedCursor =
		totalBeats === 0
			? 0
			: Math.min(Math.max(input?.beatCursor ?? 0, 0), totalBeats - 1);
	const beat = fixture.beats[clampedCursor];
	const history = fixture.beats.slice(0, clampedCursor + 1);
	const cards = projectStageCardsFromToolEvents(
		history
			.map((entry) => entry.event)
			.filter((event): event is StageToolEvent => event != null),
		{ now: beat?.updatedAt ?? new Date().toISOString() },
	);
	const latestPlanBeat = [...history]
		.reverse()
		.find((entry) => entry.planSummary != null);
	if (latestPlanBeat?.planSummary) {
		cards.push({
			id: `demo_plan_${latestPlanBeat.beatId}`,
			category: "plan",
			title: "Share-screen demo plan",
			summary: latestPlanBeat.planSummary,
			updatedAt: latestPlanBeat.updatedAt,
		});
	}
	const humanSharing =
		input?.spotlightOverride === "human"
			? true
			: input?.spotlightOverride === "agent"
				? false
				: beat?.humanTakesSpotlight ?? false;
	const humanPin = humanSharing ? beat?.humanPin ?? DEMO_HUMAN_PIN : null;

	return {
		beatCursor: clampedCursor,
		totalBeats,
		beatId: beat?.beatId ?? "beat_none",
		narration: beat?.narration ?? "No scripted narration configured.",
		nowLabel: beat?.nowLabel ?? "idle",
		nextLabel: beat?.nextLabel ?? "idle",
		stage: {
			sharer: humanSharing
				? { kind: "human", participantId: "drive:human" }
				: { kind: "agent", participantId: "drive:partner" },
			pin: humanPin,
			cards,
		},
	};
}
