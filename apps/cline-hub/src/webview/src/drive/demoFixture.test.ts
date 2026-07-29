import { describe, expect, it } from "vitest";
import {
	DRIVE_DEMO_FIXTURE,
	fixtureStageCards,
	projectShareScreenDemo,
	SHARE_SCREEN_DEMO_FIXTURE,
} from "./demoFixture";

describe("fixtureStageCards", () => {
	it("projects last-event-wins cards from the demo fixture", () => {
		const cards = fixtureStageCards();
		expect(cards).toHaveLength(DRIVE_DEMO_FIXTURE.stageEvents.length);
		expect(cards.map((card) => card.category)).toEqual([
			"edit",
			"command",
			"test",
		]);
		expect(cards[0]?.title).toBe("router.ts");
		expect(cards.every((card) => card.updatedAt.endsWith("Z"))).toBe(true);
	});
});

describe("projectShareScreenDemo", () => {
	it("projects scripted stage cards and keeps the plan card", () => {
		const projection = projectShareScreenDemo({ beatCursor: 3 });
		expect(projection.totalBeats).toBe(SHARE_SCREEN_DEMO_FIXTURE.beats.length);
		expect(projection.stage.sharer?.kind).toBe("agent");
		expect(projection.stage.cards.map((card) => card.category)).toEqual([
			"edit",
			"command",
			"test",
			"plan",
		]);
		expect(projection.narration).toContain("scripted loop");
	});

	it("shows a structured pin when the human takes spotlight", () => {
		const projection = projectShareScreenDemo({ beatCursor: 4 });
		expect(projection.stage.sharer).toEqual({
			kind: "human",
			participantId: "drive:human",
		});
		expect(projection.stage.pin?.kind).toBe("selection");
		expect(projection.stage.pin?.label).toContain("Human review");
		expect(projection.stage.cards.length).toBeGreaterThanOrEqual(4);
	});

	it("supports spotlight override controls", () => {
		const projection = projectShareScreenDemo({
			beatCursor: 0,
			spotlightOverride: "agent",
		});
		expect(projection.stage.sharer?.kind).toBe("agent");
		expect(projection.stage.pin).toBeNull();
	});
});
