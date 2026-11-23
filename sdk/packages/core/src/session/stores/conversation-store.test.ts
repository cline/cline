import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { ConversationStore } from "./conversation-store";

const prompt: MessageWithMetadata = {
	id: "prompt",
	role: "user",
	content: "go",
};
const error: MessageWithMetadata = {
	id: "error",
	role: "assistant",
	content: "Provider unavailable",
	metadata: { displayOnly: true, displayRole: "error" },
};
const retry: MessageWithMetadata = {
	id: "retry",
	role: "user",
	content: "retry",
};

describe("ConversationStore display-only history", () => {
	it("keeps errors between turns across repeated agent snapshots", () => {
		const store = new ConversationStore([prompt, error, retry]);
		store.replaceMessages([prompt, retry]);
		store.replaceMessages([prompt, retry]);
		expect(store.getMessages()).toEqual([prompt, error, retry]);
		store.replaceMessages(store.getMessages());
		expect(store.getMessages()).toEqual([prompt, error, retry]);
	});

	it("retains errors when compaction removes their anchor, but clears on explicit restore", () => {
		const store = new ConversationStore([prompt, error, retry]);
		store.replaceMessages([retry]);
		expect(store.getMessages()).toEqual([error, retry]);
		store.restore([prompt]);
		expect(store.getMessages()).toEqual([prompt]);
	});
});
