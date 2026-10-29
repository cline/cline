// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ToolMessageBlock } from "./tool-message-block";
import { groupChatMessages, collapseCompletedWork } from "./group-messages";
import type { ChatMessage } from "@/lib/chat-schema";
const report = {
	kind: "ux_verification",
	version: 1,
	title: "UX checklist",
	subtitle: "Local browser",
	checks: [
		{
			id: "auth",
			title: "Sign in needed",
			subtitle: "Waiting for the user",
			status: "blocked",
		},
	],
};
function message(
	result: unknown,
	hookEventName = "tool_call_end",
): ChatMessage {
	return {
		id: "ux",
		sessionId: "test",
		role: "tool",
		content: JSON.stringify({ toolName: "ux_verifier", result }),
		createdAt: 1,
		meta: { toolName: "ux_verifier", hookEventName },
	};
}
it.each([
	report,
	JSON.stringify(report),
])("renders live and persisted reports through the desktop tool renderer", async (result) => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.matchMedia = vi
		.fn()
		.mockImplementation((query: string) => ({
			matches: false,
			media: query,
			addEventListener() {},
			removeEventListener() {},
		}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () =>
			root.render(
				<ToolMessageBlock
					messages={[message(result)]}
					isRunActive={false}
					onExpandImage={vi.fn()}
				/>,
			),
		);
		expect(container.textContent).toContain("UX checklist");
		expect(container.textContent).toContain("0/1 checks passed");
		expect(
			container.querySelectorAll('[data-slot="cline-ui-ux-verifier"]'),
		).toHaveLength(1);
	} finally {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	}
});
it("isolates verification reports from collapsed routine tools", () => {
	const tool: ChatMessage = {
		...message({ ok: true }),
		id: "read",
		meta: { toolName: "read_files" },
		content: JSON.stringify({ toolName: "read_files", result: "done" }),
	};
	const answer: ChatMessage = {
		...message(null),
		id: "answer",
		role: "assistant",
		content: "Done",
		meta: undefined,
	};
	const result = collapseCompletedWork(
		groupChatMessages([tool, message(report), tool, answer]),
		{ collapseTrailingRun: true },
	);
	const verifier = result.find(
		(item) => item.type === "tools" && item.messages.some((m) => m.id === "ux"),
	);
	expect(verifier).toMatchObject({ type: "tools", messages: [{ id: "ux" }] });
});
