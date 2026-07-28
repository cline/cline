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

async function renderMessages(
	messages: ChatMessage[],
	overrides: Partial<Parameters<typeof ChatMessages>[0]> = {},
) {
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
				{...overrides}
			/>,
		);
	});
}

describe("ChatMessages tool disclosures", () => {
	it.each([
		["run_commands", "lucide-terminal"],
		["read_files", "lucide-files"],
		["search_codebase", "lucide-search-code"],
		["editor", "lucide-pencil"],
		["apply_patch", "lucide-pencil"],
		["ask_question", "lucide-message-circle-question-mark"],
		["fetch_web_content", "lucide-panels-top-left"],
		["skills", "lucide-library"],
		["mcp", "lucide-box"],
		["plugins", "lucide-blocks"],
		["submit_and_exit", "lucide-square-arrow-right"],
		["spawn_agent", "lucide-user"],
		["spawn-agent", "lucide-user"],
		["spawn_agent_tool", "lucide-user"],
		["subagent_subagent", "lucide-user"],
		["subagent_code_reviewer", "lucide-user"],
		["team_status", "lucide-users"],
		["bash", "lucide-terminal"],
		["file_read", "lucide-files"],
		["file-read", "lucide-files"],
		["edit", "lucide-pencil"],
		["edit_file", "lucide-pencil"],
		["apply-patch", "lucide-pencil"],
		["search", "lucide-search-code"],
		["web-fetch", "lucide-panels-top-left"],
		["web_fetch", "lucide-panels-top-left"],
		["unknown_tool", "lucide-wrench"],
	])("uses the expected icon for %s", async (toolName, iconClass) => {
		await renderMessages([
			{
				id: `tool-icon-${toolName}`,
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName,
					input: {},
					result: {},
				}),
				createdAt: 1,
			},
		]);

		const icon = container.querySelector(".cline-chat-tool-icon svg");
		expect(icon?.classList.contains(iconClass)).toBe(true);
	});

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
		expect(
			container.querySelector(".cline-chat-tool")?.classList.contains("my-0"),
		).toBe(true);
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

	it("groups consecutive tool calls and combines matching activity totals", async () => {
		const tools: ChatMessage[] = [
			{
				id: "read",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "read_files",
					input: { paths: ["one.ts", "two.ts"] },
					result: {},
				}),
				createdAt: 1,
			},
			...["one.ts", "two.ts", "three.ts", "four.ts"].map(
				(path, index): ChatMessage => ({
					id: `edit-${index}`,
					sessionId: "session-1",
					role: "tool",
					content: JSON.stringify({
						toolName: "editor",
						input: { path, old_text: "before", new_text: "after" },
						result: {},
					}),
					createdAt: index + 2,
				}),
			),
		];

		await renderMessages(tools);

		expect(container.textContent).toContain("Read 2 files. Edited 4 files");
		expect(container.textContent?.match(/Read 2 files/g)).toHaveLength(1);
	});

	it("preserves interleaved tool activity order", async () => {
		const read = (
			id: string,
			path: string,
			createdAt: number,
		): ChatMessage => ({
			id,
			sessionId: "session-1",
			role: "tool",
			content: JSON.stringify({
				toolName: "read_files",
				input: { paths: [path] },
				result: {},
			}),
			createdAt,
		});

		await renderMessages([
			read("read-before", "before.ts", 1),
			{
				id: "edit",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "editor",
					input: {
						path: "change.ts",
						old_text: "before",
						new_text: "after",
					},
					result: {},
				}),
				createdAt: 2,
			},
			read("read-after", "after.ts", 3),
		]);

		expect(container.textContent).toContain(
			"Read 1 file. Edited 1 file. Read 1 file",
		);
	});

	it("starts a new tool group after non-tool content", async () => {
		const tool = (id: string, createdAt: number): ChatMessage => ({
			id,
			sessionId: "session-1",
			role: "tool",
			content: JSON.stringify({
				toolName: "read_files",
				input: { paths: [`${id}.ts`] },
				result: {},
			}),
			createdAt,
		});

		await renderMessages([
			tool("first", 1),
			{
				id: "assistant",
				sessionId: "session-1",
				role: "assistant",
				content: "Between tools",
				createdAt: 2,
			},
			tool("second", 3),
		]);

		expect(container.textContent?.match(/Read 1 file/g)).toHaveLength(2);
	});

	it("normalizes payload-backed configured subagent names", async () => {
		await renderMessages([
			{
				id: "commands",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "run_commands",
					input: { commands: ["bun test", "bun run typecheck"] },
					result: {},
				}),
				createdAt: 1,
			},
			...[2, 3, 4].map(
				(createdAt): ChatMessage => ({
					id: `configured-subagent-${createdAt}`,
					sessionId: "session-1",
					role: "tool",
					content: JSON.stringify({
						toolName: "subagent_subagent",
						input: { prompt: "Investigate" },
						result: { text: "Done" },
					}),
					createdAt,
				}),
			),
		]);

		expect(container.textContent).toContain(
			"Ran 2 commands. spawn_agent. spawn_agent. spawn_agent",
		);
		expect(container.textContent).not.toContain("subagent_subagent");
	});

	it("does not render assistant actions without text content", async () => {
		await renderMessages([
			{
				id: "reasoning-only",
				sessionId: "session-1",
				role: "assistant",
				content: "",
				reasoning: "Internal reasoning",
				createdAt: 1,
			},
		]);

		expect(
			container.querySelector('button[aria-label="Copy assistant message"]'),
		).toBeNull();
	});

	it("positions hidden message actions outside the message layout", async () => {
		await renderMessages(
			[
				{
					id: "user-actions",
					sessionId: "session-1",
					role: "user",
					content: "User message",
					createdAt: 1,
				},
				{
					id: "assistant-actions",
					sessionId: "session-1",
					role: "assistant",
					content: "Assistant message",
					createdAt: 2,
				},
			],
			{ onForkSession: vi.fn() },
		);

		const userMessage = container.querySelector(
			'.cline-chat-message[data-role="user"]',
		);
		const userActions = userMessage?.querySelector(
			":scope > .cline-chat-message-actions",
		);
		const assistantMessage = container.querySelector(
			'.cline-chat-message[data-role="assistant"]',
		);
		const assistantActions = assistantMessage?.querySelector(
			":scope > .cline-chat-message-actions",
		);

		expect(userMessage?.classList.contains("relative")).toBe(true);
		expect(userActions?.classList.contains("absolute")).toBe(true);
		expect(userActions?.classList.contains("right-0")).toBe(true);
		expect(userActions?.classList.contains("top-full")).toBe(true);
		expect(userActions?.classList.contains("-translate-y-2")).toBe(true);
		expect(assistantMessage?.classList.contains("relative")).toBe(true);
		expect(assistantActions?.classList.contains("absolute")).toBe(true);
		expect(assistantActions?.classList.contains("left-0")).toBe(true);
		expect(assistantActions?.classList.contains("top-full")).toBe(true);
		expect(assistantActions?.classList.contains("-translate-y-2")).toBe(true);
		expect(assistantActions?.getAttribute("data-visible")).toBe("true");
		const userAction = userActions?.querySelector(".cline-chat-message-action");
		expect(userAction?.classList.contains("min-w-0")).toBe(true);
		expect(userAction?.classList.contains("p-0")).toBe(true);
		const assistantActionButtons = [
			...(assistantActions?.querySelectorAll(".cline-chat-message-action") ??
				[]),
		];
		expect(assistantActionButtons).toHaveLength(2);
		expect(
			assistantActionButtons.every(
				(action) =>
					action.classList.contains("min-w-0") &&
					action.classList.contains("p-0"),
			),
		).toBe(true);
		expect(userActions?.querySelector("time")?.getAttribute("datetime")).toBe(
			new Date(1).toISOString(),
		);
		expect(
			assistantActions?.querySelector("time")?.getAttribute("datetime"),
		).toBe(new Date(2).toISOString());
	});

	it("leaves vertical scrolling to the conversation viewport", async () => {
		await renderMessages([
			{
				id: "assistant-scroll",
				sessionId: "session-1",
				role: "assistant",
				content: "Assistant message",
				createdAt: 1,
			},
		]);

		const content = container.querySelector(".cline-chat-conversation-content");
		const messageList = content?.querySelector(":scope > div");

		expect(content?.classList.contains("overflow-x-hidden")).toBe(false);
		expect(messageList?.classList.contains("overflow-x-hidden")).toBe(false);
	});
});

describe("ChatMessages image attachments", () => {
	it("renders persisted image blocks in the user message", async () => {
		await renderMessages([
			{
				id: "user-image",
				sessionId: "session-1",
				role: "user",
				content: "Describe this",
				images: [
					{ id: "user-image-1", mediaType: "image/png", data: "aGVsbG8=" },
				],
				createdAt: 1,
			},
		]);

		const image = container.querySelector<HTMLImageElement>(
			'img[alt="Attachment 1"]',
		);
		expect(image?.src).toBe("data:image/png;base64,aGVsbG8=");
		expect(image?.className).toContain("max-h-56.25");
		expect(image?.className).toContain("max-w-56.25");
		expect(container.textContent).toContain("Describe this");
	});

	it("expands an attachment within the conversation and closes it", async () => {
		await renderMessages([
			{
				id: "user-image",
				sessionId: "session-1",
				role: "user",
				content: "Describe this",
				images: [
					{ id: "user-image-1", mediaType: "image/png", data: "aGVsbG8=" },
				],
				createdAt: 1,
			},
		]);

		const expand = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Expand attachment 1"]',
		);
		await act(async () => expand?.click());

		expect(
			container.querySelector(
				'[role="dialog"][aria-label="Expanded attachment"]',
			),
		).not.toBeNull();
		expect(
			container.querySelector<HTMLImageElement>(
				'img[alt="Expanded attachment"]',
			)?.src,
		).toBe("data:image/png;base64,aGVsbG8=");

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});
});

describe("ChatMessages reasoning disclosure", () => {
	it("shows elapsed thinking time with the border-left disclosure style", async () => {
		await renderMessages([
			{
				id: "user-before-reasoning",
				sessionId: "session-1",
				role: "user",
				content: "Solve this",
				createdAt: 1_000,
			},
			{
				id: "assistant-reasoning",
				sessionId: "session-1",
				role: "assistant",
				content: "Done",
				reasoning: "Carefully considered the request.",
				createdAt: 7_500,
			},
		]);

		const trigger = [...container.querySelectorAll("button")].find((element) =>
			element.textContent?.includes("Thought for 7s"),
		);
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		expect(trigger?.querySelector(".lucide-brain")).not.toBeNull();
		expect(trigger?.querySelector(".cline-chat-disclosure-icon")).toBeNull();
		expect(trigger?.classList.contains("text-sm")).toBe(true);
		expect(trigger?.classList.contains("text-xs")).toBe(false);

		await act(async () => trigger?.click());

		const content = container.querySelector(".cline-chat-reasoning-content");
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(content?.textContent).toContain("Carefully considered the request.");
		expect(content?.classList.contains("border-l")).toBe(true);
		expect(content?.classList.contains("pl-4")).toBe(true);
		expect(content?.classList.contains("rounded-none")).toBe(true);
		expect(content?.classList.contains("bg-transparent")).toBe(true);
	});

	it("combines consecutive assistant reasoning into one disclosure", async () => {
		await renderMessages([
			{
				id: "user-before-combined-reasoning",
				sessionId: "session-1",
				role: "user",
				content: "Investigate this",
				createdAt: 1_000,
			},
			{
				id: "assistant-reasoning-first",
				sessionId: "session-1",
				role: "assistant",
				content: "",
				reasoning: "First reasoning segment.",
				createdAt: 2_000,
			},
			{
				id: "assistant-reasoning-second",
				sessionId: "session-1",
				role: "assistant",
				content: "Investigation complete.",
				reasoning: "Second reasoning segment.",
				createdAt: 3_000,
			},
		]);

		const disclosures = container.querySelectorAll(".cline-chat-reasoning");
		expect(disclosures).toHaveLength(1);
		const trigger = disclosures[0]?.querySelector("button");
		expect(trigger?.textContent).toContain("Thought for 2s");

		await act(async () => trigger?.click());

		const content = disclosures[0]?.querySelector(
			".cline-chat-reasoning-content",
		);
		const contentText = content?.textContent ?? "";
		expect(contentText).toContain("First reasoning segment.");
		expect(contentText).toContain("Second reasoning segment.");
		expect(contentText.indexOf("First reasoning segment.")).toBeLessThan(
			contentText.indexOf("Second reasoning segment."),
		);
		expect(container.textContent).toContain("Investigation complete.");
	});

	it("keeps reasoning disclosures separate across tool activity", async () => {
		await renderMessages([
			{
				id: "user-before-separated-reasoning",
				sessionId: "session-1",
				role: "user",
				content: "Investigate this",
				createdAt: 1_000,
			},
			{
				id: "assistant-reasoning-before-tool",
				sessionId: "session-1",
				role: "assistant",
				content: "",
				reasoning: "Reasoning before the tool.",
				createdAt: 2_000,
			},
			{
				id: "tool-between-reasoning",
				sessionId: "session-1",
				role: "tool",
				content: "not-json",
				createdAt: 2_500,
				meta: { toolName: "search" },
			},
			{
				id: "assistant-reasoning-after-tool",
				sessionId: "session-1",
				role: "assistant",
				content: "Investigation complete.",
				reasoning: "Reasoning after the tool.",
				createdAt: 3_000,
			},
		]);

		expect(container.querySelectorAll(".cline-chat-reasoning")).toHaveLength(2);
	});

	it("falls back to Thinking when there is no previous timestamp", async () => {
		await renderMessages([
			{
				id: "first-reasoning",
				sessionId: "session-1",
				role: "assistant",
				content: "",
				reasoning: "Starting from scratch.",
				createdAt: 1_000,
			},
		]);

		expect(container.textContent).toContain("Thinking");
		expect(container.textContent).not.toContain("Thought for");
	});
});

describe("ChatMessages thinking indicator", () => {
	const userMessage: ChatMessage = {
		id: "user-1",
		sessionId: "session-1",
		role: "user",
		content: "Hello",
		createdAt: 1,
	};

	it("shows while starting", async () => {
		await renderMessages([userMessage], { status: "starting" });
		expect(container.textContent).toContain("Thinking...");
	});

	it("keeps showing while running until the first assistant output arrives", async () => {
		await renderMessages([userMessage], { status: "running" });
		expect(container.textContent).toContain("Thinking...");
	});

	it("ignores trailing status messages when deciding to show", async () => {
		await renderMessages(
			[
				userMessage,
				{
					id: "status-1",
					sessionId: "session-1",
					role: "status",
					content: "Session started: session-1",
					createdAt: 2,
				},
			],
			{ status: "running" },
		);

		expect(container.textContent).toContain("Thinking...");
	});

	it("hides once assistant output is streaming", async () => {
		await renderMessages(
			[
				userMessage,
				{
					id: "assistant-1",
					sessionId: "session-1",
					role: "assistant",
					content: "Working on it",
					createdAt: 2,
				},
			],
			{ status: "running", streamingMessageId: "assistant-1" },
		);

		expect(container.textContent).not.toContain("Thinking...");
	});

	it("hides while a tool runs", async () => {
		await renderMessages(
			[
				userMessage,
				{
					id: "tool-1",
					sessionId: "session-1",
					role: "tool",
					content: "not-json",
					createdAt: 2,
					meta: { toolName: "search" },
				},
			],
			{ status: "running" },
		);

		expect(container.textContent).not.toContain("Thinking...");
	});

	it("hides while a tool approval is pending", async () => {
		await renderMessages([userMessage], {
			status: "running",
			pendingToolApprovals: [
				{
					requestId: "req-1",
					sessionId: "session-1",
					createdAt: new Date(1).toISOString(),
					toolCallId: "call-1",
					toolName: "execute_command",
				},
			],
		});

		expect(container.textContent).not.toContain("Thinking...");
	});
});
