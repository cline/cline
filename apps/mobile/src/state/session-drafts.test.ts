import { beforeEach, describe, expect, it } from "vitest";
import {
	clearAllSessionDrafts,
	clearSessionDraft,
	MAX_DRAFT_IMAGE_CHARACTERS,
	readSessionDraft,
	readSessionDraftImages,
	writeSessionDraft,
	writeSessionDraftImages,
} from "./session-drafts";

describe("session drafts", () => {
	beforeEach(clearAllSessionDrafts);

	it("keeps independent drafts for independent chat routes", () => {
		writeSessionDraft("one", "first");
		writeSessionDraft("two", "second");
		expect(readSessionDraft("one")).toBe("first");
		expect(readSessionDraft("two")).toBe("second");
	});

	it("clears only the accepted route draft", () => {
		writeSessionDraft("one", "first");
		writeSessionDraft("two", "second");
		clearSessionDraft("one");
		expect(readSessionDraft("one")).toBeUndefined();
		expect(readSessionDraft("two")).toBe("second");
	});

	it("treats an empty write as a clear", () => {
		writeSessionDraft("one", "first");
		writeSessionDraft("one", "");
		expect(readSessionDraft("one")).toBeUndefined();
	});

	it("retains image drafts independently from caption text", () => {
		writeSessionDraftImages("image", ["data:image/jpeg;base64,/9j/"]);
		writeSessionDraft("image", "Edited caption");
		expect(readSessionDraft("image")).toBe("Edited caption");
		expect(readSessionDraftImages("image")).toEqual([
			"data:image/jpeg;base64,/9j/",
		]);
		writeSessionDraftImages("image", []);
		expect(readSessionDraft("image")).toBe("Edited caption");
		expect(readSessionDraftImages("image")).toBeUndefined();
	});

	it("evicts oldest image bytes while retaining its text draft", () => {
		const justOverHalfTheBudget = "a".repeat(
			Math.floor(MAX_DRAFT_IMAGE_CHARACTERS / 2) + 1,
		);
		writeSessionDraft("old", "Keep this caption");
		writeSessionDraftImages("old", [justOverHalfTheBudget]);
		writeSessionDraft("new", "Keep this too");
		writeSessionDraftImages("new", [justOverHalfTheBudget]);

		expect(readSessionDraft("old")).toBe("Keep this caption");
		expect(readSessionDraftImages("old")).toBeUndefined();
		expect(readSessionDraft("new")).toBe("Keep this too");
		expect(readSessionDraftImages("new")).toEqual([justOverHalfTheBudget]);
	});
});
