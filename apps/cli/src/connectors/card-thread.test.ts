import { describe, expect, it, vi } from "vitest";

import { postCardMessage } from "./card-thread";

function thread(overrides: { replyFails?: boolean } = {}) {
	const post = vi.fn(async () => ({ id: "posted" }));
	const reply = vi.fn(async () => {
		if (overrides.replyFails) {
			throw new Error("message to reply not found");
		}
		return { id: "replied" };
	});
	return { post, reply };
}

describe("postCardMessage", () => {
	it("hangs the message off the card's anchor", async () => {
		const t = thread();
		const sent = await postCardMessage({
			thread: t,
			anchor: { id: "100" },
			text: "Ready for review",
		});

		expect(sent.id).toBe("replied");
		expect(t.reply).toHaveBeenCalledWith("100", { raw: "Ready for review" });
		expect(t.post).not.toHaveBeenCalled();
	});

	// A card whose anchor was never posted -- a question arriving before any progress -- still
	// has to reach the person.
	it("posts on its own when there is no anchor", async () => {
		const t = thread();
		const sent = await postCardMessage({ thread: t, text: "Ready for review" });

		expect(sent.id).toBe("posted");
		expect(t.reply).not.toHaveBeenCalled();
	});

	// Losing a question because the anchor was deleted by hand would leave the card waiting
	// forever on an answer nobody was ever asked for.
	it("falls back to a plain post when the anchor is gone", async () => {
		const t = thread({ replyFails: true });
		const sent = await postCardMessage({
			thread: t,
			anchor: { id: "100" },
			text: "Gravar?",
		});

		expect(sent.id).toBe("posted");
		expect(t.post).toHaveBeenCalledWith({ raw: "Gravar?" });
	});

	it("carries the card and its fallback text when there are choices", async () => {
		const t = thread();
		await postCardMessage({
			thread: t,
			anchor: { id: "100" },
			card: { kind: "question" },
			text: "Gravar?",
		});

		expect(t.reply).toHaveBeenCalledWith("100", {
			card: { kind: "question" },
			fallbackText: "Gravar?",
		});
	});
});
