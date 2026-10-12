import { describe, expect, it } from "vitest";

import {
	buildAnsweredQuestionText,
	buildCardActionId,
	buildQuestionButtons,
	buildQuestionCard,
	formatQuestionBody,
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
			buttons: buildQuestionButtons("198f5", ["Manga", "Caju"]),
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
			buttons: buildQuestionButtons("198f5", ["Manga"]),
		}) as unknown as { children: Array<{ type: string; children: unknown[] }> };
		const section = card.children.find((child) => child.type === "section");
		expect(JSON.stringify(section)).toContain("Qual fruta?");
	});

	it("builds nothing when there is nothing to choose", () => {
		// An announcement is not a question; an empty card would only be harder to read.
		expect(
			buildQuestionCard({
				text: "Ready for review",
				buttons: [],
			}),
		).toBeUndefined();
	});
});

describe("buildAnsweredQuestionText", () => {
	it("marks the chosen option under the question", () => {
		expect(
			buildAnsweredQuestionText(
				"Gravar?\n\n1) Gravar 2) Descartar",
				"Descartar",
			),
		).toBe("Gravar?\n\n1) Gravar 2) Descartar\n\n✅ Descartar");
	});

	// The question keeps its text: someone reading the thread later needs to see what was
	// asked, not only what was picked.
	it("keeps the question itself", () => {
		const answered = buildAnsweredQuestionText("Gravar PROVA.txt?", "Gravar");
		expect(answered).toContain("Gravar PROVA.txt?");
	});

	it("does not leave a blank gap when the question ends in whitespace", () => {
		expect(buildAnsweredQuestionText("Gravar?\n\n", "Gravar")).toBe(
			"Gravar?\n\n✅ Gravar",
		);
	});
});

describe("formatQuestionBody", () => {
	// With buttons on screen the numbered list is the same choices written twice, and the
	// tool's name is not something the person can act on.
	it("replaces the tool name with a question mark and drops the numbers", () => {
		expect(
			formatQuestionBody(
				"[alta] sonda — kanban\n\nUsing AskUserQuestion: Gravar? — 1) Gravar  2) Descartar",
				{ hasChoices: true },
			),
		).toBe("[alta] sonda — kanban\n\n❓ Gravar?");
	});

	// Without buttons the numbers are the only way to answer; removing them would leave a
	// question that cannot be replied to.
	it("keeps the numbers when there is nothing to tap", () => {
		expect(
			formatQuestionBody("AskUserQuestion: Gravar? — 1) Gravar  2) Descartar", {
				hasChoices: false,
			}),
		).toBe("❓ Gravar? — 1) Gravar  2) Descartar");
	});

	// A question that happens to contain an enumeration of its own is not an options list.
	it("leaves an enumeration inside the question alone", () => {
		expect(
			formatQuestionBody("AskUserQuestion: Qual item 1) ou 2) seguimos?", {
				hasChoices: true,
			}),
		).toBe("❓ Qual item 1) ou 2) seguimos?");
	});

	it("leaves a message that is not a question untouched", () => {
		expect(
			formatQuestionBody("Ready for review\n\nkanban", { hasChoices: false }),
		).toBe("Ready for review\n\nkanban");
	});
});
