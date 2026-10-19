// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { formatChatMessageContent } from "../message-content";
import { TranscriptOutline } from "../transcript-outline";

const scroller = vi.hoisted(() => ({
	currentAnchorId: null as string | null,
	scrollToMessage: vi.fn(),
}));
vi.mock("@cline/ui/components/message-scroller", () => ({
	useMessageScroller: () => ({ scrollToMessage: scroller.scrollToMessage }),
	useMessageScrollerVisibility: () => ({
		currentAnchorId: scroller.currentAnchorId,
	}),
}));
vi.mock("../message-content", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../message-content")>();
	return {
		...actual,
		formatChatMessageContent: vi.fn(actual.formatChatMessageContent),
	};
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	scroller.currentAnchorId = null;
	vi.clearAllMocks();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});
async function render(messages: ChatMessage[]) {
	await act(async () => root.render(<TranscriptOutline messages={messages} />));
}
function user(index: number, content = `Prompt ${index}`): ChatMessage {
	return {
		id: `user-${index}`,
		sessionId: "session-1",
		role: "user",
		content,
		createdAt: index,
	};
}

describe("TranscriptOutline", () => {
	it("does not reformat unchanged prompts during streaming or reader-position changes", async () => {
		const prompts = Array.from({ length: 50 }, (_, index) =>
			user(
				index,
				`<user_input mode="act">${"large pasted prompt ".repeat(2500)}</user_input>`,
			),
		);
		await render(prompts);
		expect(formatChatMessageContent).toHaveBeenCalledTimes(50);
		vi.mocked(formatChatMessageContent).mockClear();
		for (let flush = 0; flush < 20; flush++) {
			await render([
				...prompts.map((prompt) => ({ ...prompt })),
				{
					id: "answer",
					sessionId: "session-1",
					role: "assistant",
					content: `stream ${flush}`,
					createdAt: 51,
				},
			]);
		}
		scroller.currentAnchorId = "user-25";
		await render(prompts);
		expect(formatChatMessageContent).not.toHaveBeenCalled();
		await render(
			prompts.map((prompt, index) =>
				index === 25
					? { ...prompt, content: "<user_input>Edited prompt</user_input>" }
					: prompt,
			),
		);
		expect(formatChatMessageContent).toHaveBeenCalledTimes(1);
		expect(
			container
				.querySelector('[aria-current="location"]')
				?.getAttribute("aria-label"),
		).toBe("Go to message 26: Edited prompt");
	});

	it("keeps the active button visible by scrolling only the outline", async () => {
		const prompts = Array.from({ length: 30 }, (_, index) => user(index));
		const transcript = document.createElement("div");
		document.body.appendChild(transcript);
		transcript.scrollTop = 600;
		vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				const outline = this.closest("nav");
				const index =
					Number(
						this.getAttribute("aria-label")?.match(/Go to message (\d+)/)?.[1],
					) - 1;
				const top = Number.isNaN(index)
					? 0
					: index * 16 - (outline?.scrollTop ?? 0);
				const height = this.tagName === "NAV" ? 100 : 16;
				return {
					top,
					bottom: top + height,
					height,
					left: 0,
					right: 28,
					width: 28,
					x: 0,
					y: top,
					toJSON() {},
				};
			},
		);
		try {
			scroller.currentAnchorId = "user-29";
			await render(prompts);
			const outline = container.querySelector("nav");
			expect(outline?.scrollTop).toBe(380);
			scroller.currentAnchorId = "user-0";
			await render(prompts);
			expect(outline?.scrollTop).toBe(0);
			// Keep manual outline scrolling when the current turn has not changed.
			if (outline) outline.scrollTop = 120;
			await render([...prompts]);
			expect(outline?.scrollTop).toBe(120);
			expect(transcript.scrollTop).toBe(600);
			expect(scroller.scrollToMessage).not.toHaveBeenCalled();
		} finally {
			transcript.remove();
		}
	});
});
