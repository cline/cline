import { describe, expect, it } from "vitest";

import {
	buildCardActionId,
	buildQuestionCard,
	parseCardActionId,
} from "./card-question-message";

describe("buildCardActionId / parseCardActionId", () => {
	it("round-trips the card and the choice", () => {
		expect(parseCardActionId(buildCardActionId("198f5", 2))).toEqual({
			taskId: "198f5",
			optionIndex: 2,
		});
	});

	it("stays well inside Telegram's 64-byte callback budget", () => {
		// The id travels as callback_data, which Telegram caps. A task id is five characters,
		// so this is comfortable -- the test exists so a future, chattier format is noticed.
		expect(buildCardActionId("198f5", 1).length).toBeLessThan(32);
	});

	it("refuses anything that is not one of our buttons", () => {
		expect(parseCardActionId(undefined)).toBeUndefined();
		expect(parseCardActionId("")).toBeUndefined();
		expect(parseCardActionId("other:198f5:1")).toBeUndefined();
		expect(parseCardActionId("kbq:198f5")).toBeUndefined();
		expect(parseCardActionId("kbq::1")).toBeUndefined();
		expect(parseCardActionId("kbq:198f5:zero")).toBeUndefined();
		expect(parseCardActionId("kbq:198f5:0")).toBeUndefined();
	});
});

describe("buildQuestionCard", () => {
	it("makes one button per choice, each carrying its own answer", () => {
		const card = buildQuestionCard({
			text: "Qual fruta você prefere?",
			taskId: "198f5",
			options: ["Manga", "Caju"],
		}) as unknown as {
			type: string;
			children: Array<{ type: string; children: unknown[] }>;
		};

		expect(card.type).toBe("card");
		const actions = card.children.find((child) => child.type === "actions");
		expect(actions?.children).toEqual([
			{ type: "button", id: "kbq:198f5:1", label: "Manga" },
			{ type: "button", id: "kbq:198f5:2", label: "Caju" },
		]);
	});

	it("keeps the notification text above the buttons", () => {
		const card = buildQuestionCard({
			text: "Qual fruta?",
			taskId: "198f5",
			options: ["Manga"],
		}) as unknown as { children: Array<{ type: string; children: unknown[] }> };
		const section = card.children.find((child) => child.type === "section");
		expect(JSON.stringify(section)).toContain("Qual fruta?");
	});

	it("builds nothing when there is nothing to choose", () => {
		// An announcement is not a question; an empty card would only be harder to read.
		expect(
			buildQuestionCard({
				text: "Ready for review",
				taskId: "198f5",
				options: [],
			}),
		).toBeUndefined();
	});
});
