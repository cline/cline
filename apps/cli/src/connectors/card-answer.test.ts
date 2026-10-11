import { describe, expect, it } from "vitest";

import { parseNotifiedOptions, resolveCardAnswer } from "./card-answer";

const BODY =
	"sonda do laço, terceira volta — kanban\n\nUsing AskUserQuestion: Qual fruta você prefere? — 1) Manga 2) Caju";

describe("parseNotifiedOptions", () => {
	it("reads the options out of the notification it delivered", () => {
		expect(parseNotifiedOptions(BODY)).toEqual(["Manga", "Caju"]);
	});

	it("keeps a label that contains a digit intact", () => {
		expect(parseNotifiedOptions("Qual? — 1) Node 22 2) Node 24")).toEqual([
			"Node 22",
			"Node 24",
		]);
	});

	it("finds nothing in a notification that offered no choices", () => {
		expect(parseNotifiedOptions("Ready for review\n\ncard — repo")).toEqual([]);
		expect(parseNotifiedOptions("")).toEqual([]);
	});

	it("ignores numbering that does not start at one or skips", () => {
		// A stray "2)" in prose is not an option list.
		expect(parseNotifiedOptions("veja o item 2) depois")).toEqual([]);
	});
});

describe("resolveCardAnswer", () => {
	const options = ["Manga", "Caju"];

	it("passes a number straight through", () => {
		expect(resolveCardAnswer("2", options)).toEqual({
			kind: "send",
			text: "2",
		});
	});

	it("turns the option's own name into its number", () => {
		// The person answered "Manga" and got "Passed to card ..." while the card sat waiting.
		// The connector showed those options, so it can place the answer.
		expect(resolveCardAnswer("Manga", options)).toEqual({
			kind: "send",
			text: "1",
		});
	});

	it("does not care about case or accents", () => {
		expect(resolveCardAnswer("  CAJÚ ", options)).toEqual({
			kind: "send",
			text: "2",
		});
	});

	it("accepts an unambiguous prefix", () => {
		expect(resolveCardAnswer("man", options)).toEqual({
			kind: "send",
			text: "1",
		});
	});

	it("refuses an ambiguous prefix instead of picking one", () => {
		const answer = resolveCardAnswer("ca", ["Caju", "Cacau"]);
		expect(answer.kind).toBe("ask");
	});

	it("refuses an answer it cannot place, and repeats the choices", () => {
		const answer = resolveCardAnswer("talvez", options);
		expect(answer).toEqual({
			kind: "ask",
			message:
				"That card is waiting on a choice, so I did not pass this on. Reply with: 1) Manga  2) Caju",
		});
	});

	it("refuses a number outside the choices", () => {
		expect(resolveCardAnswer("7", options).kind).toBe("ask");
		expect(resolveCardAnswer("0", options).kind).toBe("ask");
	});

	it("passes free text through when the prompt offered no choices", () => {
		// An idle agent waiting for its next instruction is the ordinary case.
		expect(resolveCardAnswer("segue com o plano", [])).toEqual({
			kind: "send",
			text: "segue com o plano",
		});
	});

	it("refuses an empty reply", () => {
		expect(resolveCardAnswer("   ", options).kind).toBe("ask");
		expect(resolveCardAnswer("   ", []).kind).toBe("ask");
	});
});
