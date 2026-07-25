import { describe, expect, it } from "vitest";
import { DRIVE_DEMO_FIXTURE, fixtureStageCards } from "./demoFixture";

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
