// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
	ConversationViewport,
	Message,
	MessageContent,
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
	ToolActivity,
	ToolActivityContent,
	ToolActivityTrigger,
} from "../components/agent-chat";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollTo = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function render(element: React.ReactNode) {
	await act(async () => root.render(element));
}

describe("@cline/ui agent chat primitives", () => {
	it("marks message roles without requiring a runtime message schema", async () => {
		await render(
			<Message from="assistant">
				<MessageContent>Hello from Cline</MessageContent>
			</Message>,
		);

		const message = container.querySelector(".cline-chat-message");
		expect(message?.getAttribute("data-role")).toBe("assistant");
		expect(message?.textContent).toContain("Hello from Cline");
	});

	it("gives the scrollable conversation log accessible defaults", async () => {
		await render(
			<Conversation>
				<ConversationViewport>
					<ConversationContent />
				</ConversationViewport>
			</Conversation>,
		);

		const viewport = container.querySelector(
			".cline-chat-conversation-viewport",
		);
		expect(viewport?.getAttribute("aria-label")).toBe("Agent conversation");
		expect(viewport?.getAttribute("role")).toBe("log");
		expect(viewport?.getAttribute("tabindex")).toBe("0");
	});

	it("exposes an accessible reasoning disclosure", async () => {
		await render(
			<Reasoning>
				<ReasoningTrigger />
				<ReasoningContent>Inspect the shared contract</ReasoningContent>
			</Reasoning>,
		);

		const trigger = container.querySelector("button");
		const panelId = trigger?.getAttribute("aria-controls");
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		expect(document.getElementById(panelId ?? "")).toBeNull();

		await act(async () => trigger?.click());
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(document.getElementById(panelId ?? "")?.textContent).toContain(
			"Inspect the shared contract",
		);
	});

	it("renders non-expandable tool activity as static content", async () => {
		await render(
			<ToolActivity expandable={false}>
				<ToolActivityTrigger label="Explored workspace" />
			</ToolActivity>,
		);

		const summary = container.querySelector(".cline-chat-tool-trigger");
		expect(summary?.tagName).toBe("DIV");
		expect(summary?.closest("button")).toBeNull();
	});

	it("toggles expandable tool details", async () => {
		await render(
			<ToolActivity>
				<ToolActivityTrigger label="Edited 2 files" />
				<ToolActivityContent>theme.css</ToolActivityContent>
			</ToolActivity>,
		);

		const trigger = container.querySelector("button");
		const panelId = trigger?.getAttribute("aria-controls");
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		expect(document.getElementById(panelId ?? "")).toBeNull();

		await act(async () => trigger?.click());
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(document.getElementById(panelId ?? "")?.textContent).toContain(
			"theme.css",
		);
	});

	it("offers a scroll-to-latest action after the reader moves away", async () => {
		await render(
			<Conversation>
				<ConversationViewport>
					<ConversationContent>Long conversation</ConversationContent>
				</ConversationViewport>
				<ConversationScrollButton />
			</Conversation>,
		);

		const viewport = container.querySelector(
			".cline-chat-conversation-viewport",
		) as HTMLDivElement;
		const scrollTo = vi.fn();
		Object.defineProperties(viewport, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 500 },
			scrollTop: { configurable: true, value: 0, writable: true },
			scrollTo: { configurable: true, value: scrollTo },
		});

		await act(async () => viewport.dispatchEvent(new Event("scroll")));
		const button = container.querySelector(
			'button[aria-label="Scroll to latest message"]',
		) as HTMLButtonElement;
		expect(button).not.toBeNull();

		await act(async () => button.click());
		expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 500 });

		viewport.scrollTop = 300;
		await act(async () => viewport.dispatchEvent(new Event("scroll")));
		expect(
			container.querySelector('button[aria-label="Scroll to latest message"]'),
		).toBeNull();

		viewport.scrollTop = 100;
		await act(async () => viewport.dispatchEvent(new Event("scroll")));
		expect(
			container.querySelector('button[aria-label="Scroll to latest message"]'),
		).not.toBeNull();
	});

	it("resets conversation state when its React key changes", async () => {
		const transcript = (conversationKey: string) => (
			<Conversation key={conversationKey}>
				<ConversationViewport>
					<ConversationContent>
						Conversation {conversationKey}
					</ConversationContent>
				</ConversationViewport>
				<ConversationScrollButton />
			</Conversation>
		);
		await render(transcript("session-a"));

		const firstViewport = container.querySelector(
			".cline-chat-conversation-viewport",
		) as HTMLDivElement;
		Object.defineProperties(firstViewport, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 500 },
			scrollTop: { configurable: true, value: 0, writable: true },
		});

		await act(async () => firstViewport.dispatchEvent(new Event("scroll")));
		expect(
			container.querySelector('button[aria-label="Scroll to latest message"]'),
		).not.toBeNull();

		await render(transcript("session-b"));

		const nextViewport = container.querySelector(
			".cline-chat-conversation-viewport",
		);
		expect(nextViewport).not.toBe(firstViewport);
		expect(
			container.querySelector('button[aria-label="Scroll to latest message"]'),
		).toBeNull();
	});
});
