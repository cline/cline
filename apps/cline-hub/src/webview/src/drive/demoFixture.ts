import type { StageCard } from "@cline/shared";

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
