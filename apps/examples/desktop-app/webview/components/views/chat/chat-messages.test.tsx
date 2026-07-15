// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { ChatMessages } from "./chat-messages";

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

async function renderMessages(messages: ChatMessage[]) {
	await act(async () => {
		root.render(
			<ChatMessages
				chatTransportState="connected"
				error={null}
				messages={messages}
				onAnswerAskQuestion={vi.fn()}
				onApproveToolApproval={vi.fn()}
				onRejectToolApproval={vi.fn()}
				pendingAskQuestions={[]}
				pendingToolApprovals={[]}
				sessionId="session-1"
				status="completed"
			/>,
		);
	});
}

describe("ChatMessages tool disclosures", () => {
	it("renders a detail-less tool summary as static text", async () => {
		await renderMessages([
			{
				id: "tool-static",
				sessionId: "session-1",
				role: "tool",
				content: "not-json",
				createdAt: 1,
				meta: { toolName: "search" },
			},
		]);

		const summary = [...container.querySelectorAll("span")].find((element) =>
			element.textContent?.includes("Explored"),
		);
		expect(summary).toBeDefined();
		expect(summary?.closest("button")).toBeNull();
	});

	it("exposes and toggles expandable tool details", async () => {
		await renderMessages([
			{
				id: "tool-expandable",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "search",
					input: { queries: ["workspace selector"] },
					result: {},
				}),
				createdAt: 1,
			},
		]);

		const trigger = [...container.querySelectorAll("button")].find((element) =>
			element.textContent?.includes("Explored 1 search"),
		);
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		const panelId = trigger?.getAttribute("aria-controls");
		expect(panelId).toBeTruthy();

		await act(async () => trigger?.click());
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(document.getElementById(panelId ?? "")?.textContent).toContain(
			"workspace selector",
		);
	});
});
