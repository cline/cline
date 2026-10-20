import { describe, expect, it } from "vitest";

import { buildCardAnchorText, resolveColumnDot } from "./card-anchor";

describe("resolveColumnDot", () => {
	it("gives each column the colour the board gives it", () => {
		expect(resolveColumnDot("backlog")).toBe("⚪");
		expect(resolveColumnDot("in_progress")).toBe("🔵");
		expect(resolveColumnDot("review")).toBe("🟠");
		expect(resolveColumnDot("done")).toBe("🟢");
	});

	// The id is `trash` but the board titles that column "Done" and paints it green. Red said
	// the card had been thrown away, which is the opposite of what the board shows.
	it("treats the column the board calls Done as done, not as discarded", () => {
		expect(resolveColumnDot("trash")).toBe("🟢");
	});

	// A notification from an older build carries no column at all, and a board that grows a
	// column should not make the message unreadable.
	it("falls back to backlog for a column it does not know", () => {
		expect(resolveColumnDot(undefined)).toBe("⚪");
		expect(resolveColumnDot("someday")).toBe("⚪");
	});
});

describe("buildCardAnchorText", () => {
	it("leads with the column, the title and the card id", () => {
		expect(
			buildCardAnchorText({
				title: "Gravar PROVA.txt",
				taskId: "4d16f",
				column: "in_progress",
				detail: "kanban · Bash",
			}),
		).toBe("🔵 Gravar PROVA.txt · 4d16f\nkanban · Bash");
	});

	// A card in review is not doing anything, and an empty "doing" line is the kind of noise
	// that made five messages per card unreadable.
	it("drops the second line when there is nothing to report", () => {
		expect(
			buildCardAnchorText({
				title: "Gravar PROVA.txt",
				taskId: "4d16f",
				column: "review",
			}),
		).toBe("🟠 Gravar PROVA.txt · 4d16f");
	});

	// The headline has to stay one line on a phone, and a card's title is the first line of a
	// demand someone typed, which can be a paragraph.
	it("clips a long title at a word boundary", () => {
		const text = buildCardAnchorText({
			title: `${"palavra ".repeat(40)}fim`,
			taskId: "4d16f",
		});
		const headline = text.split("\n")[0] ?? "";
		expect(headline.length).toBeLessThanOrEqual(85);
		expect(headline).toContain("…");
		expect(headline).not.toMatch(/\s…/);
	});

	// A demand pasted from a terminal arrives with newlines in it; the headline is one line.
	it("flattens whitespace in the title", () => {
		const text = buildCardAnchorText({
			title: "duas\nlinhas",
			taskId: "4d16f",
		});
		expect(text.split("\n")[0]).toBe("⚪ duas linhas · 4d16f");
	});
});
