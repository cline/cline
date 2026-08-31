// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ChatImageLightbox,
	type ChatMarkdownProps,
	type ChatMessage,
	MessageBubble,
	MessageImageCarousel,
	ToolApprovalPanel,
} from "../components/agent-chat/messages/index.js";
import { ToolMessageBlock } from "../components/agent-chat/messages/tool-message-block.js";

// @pierre/diffs' custom element adopts constructable stylesheets, which jsdom
// does not implement.
CSSStyleSheet.prototype.replaceSync ??= function replaceSync() {} as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function StubMarkdown({ content, streaming }: ChatMarkdownProps) {
	return (
		<div data-streaming={streaming ? "true" : undefined} data-testid="markdown">
			{content}
		</div>
	);
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: "m1",
		sessionId: "session-1",
		role: "assistant",
		content: "Hello **world**",
		createdAt: Date.UTC(2026, 0, 1, 12, 0, 0),
		...overrides,
	};
}

const IMAGE: ChatMessage["images"] = [
	{ id: "img-1", mediaType: "image/png", data: "aGVsbG8=" },
];

describe("MessageBubble", () => {
	it("renders content through the host-provided markdown component", async () => {
		await act(async () => {
			root.render(
				<MessageBubble
					agentRole="assistant"
					markdown={StubMarkdown}
					message={makeMessage()}
					reasoningContent=""
					reasoningRedacted={false}
				/>,
			);
		});
		const markdown = container.querySelector('[data-testid="markdown"]');
		expect(markdown?.textContent).toBe("Hello **world**");
	});

	it("routes reasoning through the same markdown renderer", async () => {
		await act(async () => {
			root.render(
				<MessageBubble
					agentRole="assistant"
					markdown={StubMarkdown}
					message={makeMessage({ content: "" })}
					reasoningContent="thinking it through"
					reasoningRedacted={false}
				/>,
			);
		});
		const trigger = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Thinking"),
		);
		await act(async () => {
			trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(container.textContent).toContain("thinking it through");
	});

	it("hides system steering user messages entirely", async () => {
		await act(async () => {
			root.render(
				<MessageBubble
					agentRole="user"
					markdown={StubMarkdown}
					message={makeMessage({
						role: "user",
						content: "[SYSTEM] finish up",
						meta: { userRunSpan: 0 },
					})}
					reasoningContent=""
					reasoningRedacted={false}
				/>,
			);
		});
		expect(container.textContent).toBe("");
	});
});

describe("ToolMessageBlock", () => {
	it("renders a tool row with the shared summary label and lucide icon", async () => {
		const message = makeMessage({
			role: "tool",
			content: JSON.stringify({
				toolName: "read_files",
				input: { paths: ["a.ts"] },
				result: { ok: true },
			}),
		});
		await act(async () => {
			root.render(
				<ToolMessageBlock markdown={StubMarkdown} messages={[message]} />,
			);
		});
		expect(container.textContent).toContain("Read file a.ts");
		expect(container.querySelector(".lucide-files")).not.toBeNull();
	});

	it("renders raw input only when the host opts in", async () => {
		const message = makeMessage({
			role: "tool",
			content: JSON.stringify({
				toolName: "read_files",
				input: { paths: ["a.ts"] },
				result: { ok: true },
			}),
		});
		await act(async () => {
			root.render(
				<ToolMessageBlock
					markdown={StubMarkdown}
					messages={[message]}
					showRawInput
				/>,
			);
		});
		const trigger = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Read file a.ts"),
		);
		await act(async () => {
			trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(container.textContent).toContain('"paths"');
	});
});

describe("ToolApprovalPanel", () => {
	it("submits approve decisions for pending requests", async () => {
		const onApprove = vi.fn();
		await act(async () => {
			root.render(
				<ToolApprovalPanel
					items={[
						{
							requestId: "req-1",
							sessionId: "session-1",
							createdAt: new Date().toISOString(),
							toolCallId: "call-1",
							toolName: "run_commands",
							input: { commands: ["ls"] },
						},
					]}
					onApprove={onApprove}
					onReject={vi.fn()}
					pendingActions={{}}
					requestErrors={{}}
				/>,
			);
		});
		const approve = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Approve"),
		);
		expect(approve).toBeDefined();
		await act(async () => {
			approve?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onApprove).toHaveBeenCalledWith("req-1");
	});
});

describe("image viewers", () => {
	it("expands carousel images through the host callback", async () => {
		const onExpandImage = vi.fn();
		await act(async () => {
			root.render(
				<MessageImageCarousel images={IMAGE} onExpandImage={onExpandImage} />,
			);
		});
		const expand = container.querySelector("button");
		await act(async () => {
			expand?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onExpandImage).toHaveBeenCalledWith(IMAGE[0]);
	});

	it("closes the lightbox through the host callback", async () => {
		const onClose = vi.fn();
		await act(async () => {
			root.render(<ChatImageLightbox image={IMAGE[0]} onClose={onClose} />);
		});
		const close = container.querySelector(
			'button[aria-label="Close image viewer"]',
		);
		await act(async () => {
			close?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
