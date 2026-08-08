// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { resolveRetryTurnPayload } from "./retry-failed-turn";

describe("resolveRetryTurnPayload", () => {
	it("re-sends the original prompt text and attachments from the last send", () => {
		const image = new File([new Uint8Array([1, 2, 3])], "diagram.png", {
			type: "image/png",
		});
		const doc = new File(["notes"], "notes.txt", { type: "text/plain" });

		const payload = resolveRetryTurnPayload(
			{ prompt: "Describe these files", attachments: [image, doc] },
			// Transcript shows only a display label for attachments — retry must
			// not send this reconstructed text or drop the files.
			"Describe these files\n\n[attached 2 files]",
		);

		expect(payload?.prompt).toBe("Describe these files");
		expect(payload?.attachments).toEqual([image, doc]);
	});

	it("copies the attachment list so a retry cannot mutate the retained payload", () => {
		const image = new File([new Uint8Array([1])], "a.png", {
			type: "image/png",
		});
		const lastSent = { prompt: "Look at this", attachments: [image] };

		const payload = resolveRetryTurnPayload(lastSent, "Look at this");
		payload?.attachments.pop();

		expect(lastSent.attachments).toEqual([image]);
	});

	it("falls back to the transcript prompt without attachments when no send was recorded", () => {
		const payload = resolveRetryTurnPayload(null, "  Summarize the repo  ");

		expect(payload).toEqual({ prompt: "Summarize the repo", attachments: [] });
	});

	it("returns null when there is nothing to retry", () => {
		expect(resolveRetryTurnPayload(null, "   ")).toBeNull();
	});
});
