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

	it("shimmers a tool title only while its result is pending", async () => {
		const pendingTool: ChatMessage = {
			id: "tool-pending",
			sessionId: "session-1",
			role: "tool",
			content: JSON.stringify({
				toolName: "read_files",
				input: { paths: ["pending.ts"] },
				result: null,
			}),
			createdAt: 1,
		};
		await renderMessages([pendingTool]);

		const pendingTitle = container.querySelector(
			".cline-chat-tool-label > span",
		);
		expect(pendingTitle?.classList.contains("cline-chat-streaming-title")).toBe(
			true,
		);

		await renderMessages([
			{
				...pendingTool,
				content: JSON.stringify({
					toolName: "read_files",
					input: { paths: ["pending.ts"] },
					result: { content: "done" },
				}),
			},
		]);

		const completedTitle = container.querySelector(
			".cline-chat-tool-label > span",
		);
		expect(
			completedTitle?.classList.contains("cline-chat-streaming-title"),
		).toBe(false);
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

	it("spaces reasoning, content, and tool blocks with a single gap-2", async () => {
		await renderMessages([
			{
				id: "assistant-reasoning",
				sessionId: "session-1",
				role: "assistant",
				content: "Assistant message",
				reasoning: "Thinking about it",
				createdAt: 2,
			},
			{
				id: "tool-after",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "run_commands",
					input: { commands: ["ls"] },
					result: {},
				}),
				createdAt: 3,
			},
		]);

		const message = container.querySelector(
			'.cline-chat-message[data-role="assistant"]',
		);
		const messageList = message?.parentElement;
		const content = message?.querySelector(".cline-chat-message-content");

		// The list and the content column each own their spacing via gap-2...
		expect(messageList?.classList.contains("gap-2")).toBe(true);
		expect(content?.classList.contains("flex")).toBe(true);
		expect(content?.classList.contains("flex-col")).toBe(true);
		expect(content?.classList.contains("gap-2")).toBe(true);

		// ...so no block may contribute vertical margins of its own.
		for (const element of [
			message,
			content?.querySelector(".cline-chat-reasoning"),
			content?.lastElementChild,
			container.querySelector(".cline-chat-tool"),
		]) {
			const classes = [...(element?.classList ?? [])];
			expect(classes.some((name) => /^-?m[ytb]-[1-9]/.test(name))).toBe(false);
		}
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

	it("confirms before restoring a checkpoint", async () => {
		const onRestoreCheckpoint = vi.fn(async () => undefined);
		await renderMessages(
			[
				{
					id: "checkpoint-user",
					sessionId: "session-1",
					role: "user",
					content: "Change the implementation",
					createdAt: 1,
					meta: {
						runCount: 2,
						checkpoint: {
							ref: "checkpoint-ref",
							createdAt: 1,
							runCount: 2,
						},
					},
				},
			],
			{ onRestoreCheckpoint },
		);

		const restoreButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Restore checkpoint"]',
		);
		await act(async () => restoreButton?.click());

		expect(onRestoreCheckpoint).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Revert to this checkpoint?");

		const confirmButton = [...document.body.querySelectorAll("button")].find(
			(button) => button.textContent === "Revert",
		);
		await act(async () => confirmButton?.click());

		expect(onRestoreCheckpoint).toHaveBeenCalledOnce();
		expect(onRestoreCheckpoint).toHaveBeenCalledWith(2);
	});

	it("edits a user message by restarting before its user run", async () => {
		const onEditMessage = vi.fn(async () => undefined);
		await renderMessages(
			[
				{
					id: "earlier-user",
					sessionId: "session-1",
					role: "user",
					content: "Earlier prompt",
					createdAt: 1,
				},
				{
					id: "earlier-assistant",
					sessionId: "session-1",
					role: "assistant",
					content: "Earlier response",
					createdAt: 2,
				},
				{
					id: "editable-user",
					sessionId: "session-1",
					role: "user",
					content: '<user_input mode="act">Original prompt</user_input>',
					createdAt: 3,
				},
			],
			{ onEditMessage },
		);

		const editButton = container.querySelectorAll<HTMLButtonElement>(
			'button[aria-label="Edit user message"]',
		)[1];
		await act(async () => editButton?.click());

		expect(onEditMessage).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Edit and restart from here?");

		const continueButton = [...document.body.querySelectorAll("button")].find(
			(button) => button.textContent === "Continue",
		);
		await act(async () => continueButton?.click());

		expect(onEditMessage).toHaveBeenCalledOnce();
		expect(onEditMessage).toHaveBeenCalledWith(
			"editable-user",
			"Original prompt",
			2,
		);
	});

	it("counts folded system-displayed runs before an editable user message", async () => {
		const onEditMessage = vi.fn(async () => undefined);
		await renderMessages(
			[
				{
					id: "compacted-history",
					sessionId: "session-1",
					role: "system",
					content: "Compacted context",
					createdAt: 1,
					meta: {
						messageKind: "compaction",
						userRunSpan: 3,
					},
				},
				{
					id: "post-compaction-user",
					sessionId: "session-1",
					role: "user",
					content: "Fourth prompt",
					createdAt: 2,
				},
			],
			{ onEditMessage },
		);

		const editButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Edit user message"]',
		);
		await act(async () => editButton?.click());
		const continueButton = [...document.body.querySelectorAll("button")].find(
			(button) => button.textContent === "Continue",
		);
		await act(async () => continueButton?.click());

		expect(onEditMessage).toHaveBeenCalledWith(
			"post-compaction-user",
			"Fourth prompt",
			4,
		);
	});

	it("continues from a non-user run anchor in a truncated history", async () => {
		const onEditMessage = vi.fn(async () => undefined);
		await renderMessages(
			[
				{
					id: "truncated-assistant",
					sessionId: "session-1",
					role: "assistant",
					content: "Most recent response",
					createdAt: 1,
					meta: { runCount: 3 },
				},
				{
					id: "optimistic-user",
					sessionId: "session-1",
					role: "user",
					content: "Next prompt",
					createdAt: 2,
				},
			],
			{ onEditMessage },
		);

		const editButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Edit user message"]',
		);
		await act(async () => editButton?.click());
		const continueButton = [...document.body.querySelectorAll("button")].find(
			(button) => button.textContent === "Continue",
		);
		await act(async () => continueButton?.click());

		expect(onEditMessage).toHaveBeenCalledWith(
			"optimistic-user",
			"Next prompt",
			4,
		);
	});

	it("does not offer editing for a message that represents multiple runs", async () => {
		await renderMessages(
			[
				{
					id: "folded-user-runs",
					sessionId: "session-1",
					role: "user",
					content: "Merged prompts",
					createdAt: 1,
					meta: { userRunSpan: 2 },
				},
			],
			{ onEditMessage: vi.fn(async () => undefined) },
		);

		expect(
			container.querySelector('button[aria-label="Edit user message"]'),
		).toBeNull();
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

describe("ChatMessages follow-up questions", () => {
	it("forwards answers from the shared question panel", async () => {
		const onAnswerAskQuestion = vi.fn();
		await renderMessages(
			[
				{
					content: "Help me choose",
					createdAt: 1,
					id: "user-1",
					role: "user",
					sessionId: "session-1",
				},
			],
			{
				onAnswerAskQuestion,
				pendingAskQuestions: [
					{
						createdAt: "2026-07-31T00:00:00.000Z",
						options: ["Continue", "Stop"],
						question: "Continue this task?",
						requestId: "request-1",
					},
				],
			},
		);

		const answer = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Continue",
		);
		await act(async () => answer?.click());

		expect(onAnswerAskQuestion).toHaveBeenCalledWith("request-1", "Continue");
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
	it("shimmers the thinking title only while reasoning is streaming", async () => {
		const messages: ChatMessage[] = [
			{
				id: "user-before-streaming-reasoning",
				sessionId: "session-1",
				role: "user",
				content: "Think this through",
				createdAt: 1_000,
			},
			{
				id: "streaming-reasoning",
				sessionId: "session-1",
				role: "assistant",
				content: "",
				reasoning: "Still considering the answer.",
				createdAt: 2_000,
			},
		];
		await renderMessages(messages, {
			status: "running",
			streamingMessageId: "streaming-reasoning",
		});

		const streamingTitle = container.querySelector(
			".cline-chat-reasoning-trigger > span",
		);
		expect(
			streamingTitle?.classList.contains("cline-chat-streaming-title"),
		).toBe(true);

		await renderMessages(messages, {
			status: "completed",
			streamingMessageId: null,
		});

		const completedTitle = container.querySelector(
			".cline-chat-reasoning-trigger > span",
		);
		expect(
			completedTitle?.classList.contains("cline-chat-streaming-title"),
		).toBe(false);
	});

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
		expect(content?.classList.contains("rounded-none")).toBe(true);
		expect(content?.classList.contains("bg-transparent")).toBe(true);
		// Inset off the rail, without pinning the exact step — the shared-rail
		// test owns the specific values.
		expect(
			[...(content?.classList ?? [])].some((name) => /^p[lx]-/.test(name)),
		).toBe(true);
	});

	it("hangs expanded reasoning and tool panels off the same left rail", async () => {
		await renderMessages([
			{
				id: "assistant-rail-reasoning",
				sessionId: "session-1",
				role: "assistant",
				content: "Done",
				reasoning: "Considered the request.",
				createdAt: 2_000,
			},
			{
				id: "tool-rail",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "run_commands",
					input: { commands: ["git status"] },
					result: {},
				}),
				createdAt: 3_000,
			},
		]);

		const reasoningTrigger = container.querySelector(
			".cline-chat-reasoning-trigger",
		) as HTMLButtonElement | null;
		const toolTrigger = container.querySelector(
			".cline-chat-tool-trigger",
		) as HTMLButtonElement | null;
		await act(async () => {
			reasoningTrigger?.click();
			toolTrigger?.click();
		});

		const reasoningContent = container.querySelector(
			".cline-chat-reasoning-content",
		);
		const toolContent = container.querySelector(".cline-chat-tool-content");
		expect(reasoningContent).not.toBeNull();
		expect(toolContent).not.toBeNull();

		// Compared as sets rather than pinned to literals, so retuning the rail
		// stays a one-line change but can never drift between the two panels.
		const railClasses = (element: Element | null) =>
			[...(element?.classList ?? [])]
				.filter((name) =>
					/^(-?m[a-z]?|p[a-z]?|border|rounded|bg|max)-/.test(name),
				)
				.sort();
		expect(railClasses(reasoningContent).length).toBeGreaterThan(0);
		expect(railClasses(toolContent)).toEqual(railClasses(reasoningContent));

		// Both panels are capped on both axes so neither can stretch the column.
		for (const panel of [reasoningContent, toolContent]) {
			const classes = [...(panel?.classList ?? [])];
			expect(classes.some((name) => name.startsWith("max-h-"))).toBe(true);
			expect(classes.some((name) => name.startsWith("max-w-"))).toBe(true);
		}

		// Reasoning wraps, so it scrolls Y only; tool output scrolls both axes.
		expect(reasoningContent?.classList.contains("overflow-y-auto")).toBe(true);
		expect(reasoningContent?.classList.contains("overflow-x-hidden")).toBe(
			true,
		);
		expect(reasoningContent?.classList.contains("overflow-auto")).toBe(false);
		expect(toolContent?.classList.contains("overflow-auto")).toBe(true);
		expect(toolContent?.classList.contains("overflow-x-hidden")).toBe(false);

		// The X axis is only reachable if the detail rows keep their lines intact.
		const details = toolContent?.querySelector(".cline-chat-tool-details");
		expect(details?.classList.contains("whitespace-pre")).toBe(true);

		// The X axis stays live but loses its bar; reasoning has no X bar to hide.
		expect(toolContent?.classList.contains("cline-chat-scroll-x-bare")).toBe(
			true,
		);
		expect(
			reasoningContent?.classList.contains("cline-chat-scroll-x-bare"),
		).toBe(false);
	});

	it("keeps the reasoning panel inside the shape the hover-suppress rule targets", async () => {
		await renderMessages([
			{
				id: "assistant-hover-scope",
				sessionId: "session-1",
				role: "assistant",
				content: "Answer body",
				reasoning: "Weighed the options.",
				createdAt: 2_000,
			},
			// A trailing message keeps the assistant row off the always-visible
			// last-message path, so its actions are genuinely hover-driven.
			{
				id: "user-after-hover-scope",
				sessionId: "session-1",
				role: "user",
				content: "Follow-up",
				createdAt: 3_000,
			},
		]);

		const message = container.querySelector(
			'.cline-chat-message[data-role="assistant"]',
		);
		const actions = message?.querySelector(
			":scope > .cline-chat-message-actions",
		);
		expect(actions).not.toBeNull();

		// globals.css suppresses the hover reveal via this selector plus `:hover`.
		// jsdom has no pointer state, so assert the structural half: if the DOM is
		// ever reshaped, the rule stops matching and the reveal silently returns.
		expect(
			actions?.matches(
				".cline-chat-message:has(> .cline-chat-message-content .cline-chat-reasoning) > .cline-chat-message-actions:not([data-visible='true'])",
			),
		).toBe(true);

		// The reveal itself must stay opt-out-able, i.e. driven by hover, not by a
		// pinned data-visible that would defeat the suppression.
		expect(actions?.getAttribute("data-visible")).toBeNull();
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
		expect(
			[...container.querySelectorAll("span")]
				.find((element) => element.textContent === "Thinking...")
				?.classList.contains("cline-chat-streaming-title"),
		).toBe(true);
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

describe("ChatMessages tool approvals", () => {
	it("renders the shared card and forwards its decisions", async () => {
		const onApprove = vi.fn();
		const onReject = vi.fn();
		await renderMessages(
			[
				{
					id: "user-1",
					sessionId: "session-1",
					role: "user",
					content: "Run pwd",
					createdAt: 1,
				},
			],
			{
				onApproveToolApproval: onApprove,
				onRejectToolApproval: onReject,
				pendingToolApprovals: [
					{
						requestId: "req-1",
						sessionId: "session-1",
						createdAt: new Date(1).toISOString(),
						toolCallId: "call-1",
						toolName: "execute_command",
						input: { command: "pwd" },
					},
				],
			},
		);

		const card = container.querySelector(".cline-ui-agent-approval-card");
		expect(card?.textContent).toContain("execute_command");
		expect(card?.textContent).toContain('"command": "pwd"');

		const [approve, reject] = card?.querySelectorAll("button") ?? [];
		await act(async () => approve?.click());
		expect(onApprove).toHaveBeenCalledWith("req-1");

		await act(async () => reject?.click());
		expect(onReject).toHaveBeenCalledWith("req-1");
	});
});
