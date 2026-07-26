import { describe, expect, it } from "vitest";
import { buildHumanPinDefaults, lastCardOfCategory } from "./pinDefaults";
import type { StageCard } from "@cline/shared";

const cards: StageCard[] = [
	{
		id: "c1",
		category: "edit",
		title: "router.ts",
		summary: "src/router.ts\nexport {}",
		updatedAt: "2026-07-26T12:00:00.000Z",
	},
	{
		id: "c2",
		category: "command",
		title: "bun test",
		summary: "ok",
		updatedAt: "2026-07-26T12:01:00.000Z",
	},
];

describe("pinDefaults", () => {
	it("builds file/terminal defaults from stage cards", () => {
		const defaults = buildHumanPinDefaults(cards);
		expect(defaults.file.label).toBe("router.ts");
		expect(defaults.file.ref).toContain("src/router.ts");
		expect(defaults.terminal.label).toBe("bun test");
		expect(defaults.terminal.ref).toBe("ok");
		expect(defaults.selection.kind).toBe("selection");
	});

	it("lastCardOfCategory finds the latest matching card", () => {
		expect(lastCardOfCategory(cards, "edit")?.id).toBe("c1");
		expect(lastCardOfCategory(cards, "test")).toBeUndefined();
	});
});

/** Stage source-of-truth switch used by Chat (room vs local vs fixture). */
export function resolveStageCards(input: {
	demo: boolean;
	liveRoom: boolean;
	roomCards: readonly StageCard[];
	localCards: readonly StageCard[];
	fixtureCards: readonly StageCard[];
}): readonly StageCard[] {
	const useFixture =
		input.demo &&
		!input.liveRoom &&
		input.roomCards.length === 0 &&
		input.localCards.length === 0;
	if (useFixture) {
		return input.fixtureCards;
	}
	if (input.liveRoom) {
		return input.roomCards;
	}
	return input.localCards;
}

describe("resolveStageCards", () => {
	const fixture: StageCard[] = [
		{
			id: "fix",
			category: "edit",
			title: "fixture.ts",
			updatedAt: "2026-07-26T12:00:00.000Z",
		},
	];
	const room: StageCard[] = [
		{
			id: "room",
			category: "command",
			title: "ls",
			updatedAt: "2026-07-26T12:00:00.000Z",
		},
	];
	const local: StageCard[] = [
		{
			id: "local",
			category: "test",
			title: "vitest",
			updatedAt: "2026-07-26T12:00:00.000Z",
		},
	];

	it("prefers room cards when live room is attached", () => {
		expect(
			resolveStageCards({
				demo: true,
				liveRoom: true,
				roomCards: room,
				localCards: local,
				fixtureCards: fixture,
			}),
		).toEqual(room);
	});

	it("uses fixture only offline with empty local/room", () => {
		expect(
			resolveStageCards({
				demo: true,
				liveRoom: false,
				roomCards: [],
				localCards: [],
				fixtureCards: fixture,
			}),
		).toEqual(fixture);
	});

	it("uses local projection when not in a live room", () => {
		expect(
			resolveStageCards({
				demo: false,
				liveRoom: false,
				roomCards: [],
				localCards: local,
				fixtureCards: fixture,
			}),
		).toEqual(local);
	});
});
