// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("./vscode", () => ({
	getVsCodeApi: () => undefined,
	postToHost: vi.fn(),
}));
vi.mock("./components/Composer", () => ({ Composer: () => null }));
vi.mock("@/components/ai-elements/conversation", () => ({
	Conversation: ({ children }: { children: ReactNode }) => children,
	ConversationContent: ({ children }: { children: ReactNode }) => children,
	ConversationScrollButton: () => null,
}));
vi.mock("@/components/ai-elements/message", () => ({
	Message: ({ children }: { children: ReactNode }) =>
		createElement("article", null, children),
	MessageContent: ({ children }: { children: ReactNode }) => children,
	MessageResponse: ({ children }: { children: ReactNode }) =>
		createElement("span", { "data-response": true }, children),
}));

import Chat from "./Chat";

it("keeps batched abandoned and replacement output in separate Hub messages", async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const container = document.createElement("div");
	const root = createRoot(container);
	try {
		await act(async () => root.render(createElement(Chat)));
		await act(async () => {
			for (const data of [
				{ type: "assistant_delta", text: "abandoned" },
				{ type: "status", reason: "provider_error_retry", text: "retrying" },
				{ type: "assistant_delta", text: "replacement" },
			])
				window.dispatchEvent(new MessageEvent("message", { data }));
		});
		expect(
			[...container.querySelectorAll("[data-response]")].map(
				(row) => row.textContent,
			),
		).toEqual(["abandoned", "replacement"]);
		expect(container.textContent).toContain("retrying");
	} finally {
		await act(async () => root.unmount());
	}
});
