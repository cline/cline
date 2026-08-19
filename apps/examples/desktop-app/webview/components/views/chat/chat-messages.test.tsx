// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { MAX_LIVE_COMMAND_OUTPUT_CHARS } from "@/lib/command-output";
import { ChatMessages } from "./chat-messages";

// @pierre/diffs' custom element adopts constructable stylesheets, which jsdom
// does not implement; without this the suite exits nonzero on an unhandled
// error even with every test passing.
CSSStyleSheet.prototype.replaceSync ??= function replaceSync() {} as never;

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
			element.textContent?.includes("Searched"),
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
			element.textContent?.includes("Searched workspace selector"),
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

	it("renders consecutive tool calls as individual rows", async () => {
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

		// One row per call — the multi-file read keeps its own count, and each
		// edit stands alone; nothing merges across calls.
		expect(container.querySelectorAll(".cline-chat-tool")).toHaveLength(5);
		expect(container.textContent).toContain("Read 2 files");
		for (const path of ["one.ts", "two.ts", "three.ts", "four.ts"]) {
			expect(container.textContent).toContain(`Edited file ${path}`);
		}
		expect(container.textContent).not.toContain("·");
	});

	it("leads a command row with the action and shows output on expand", async () => {
		await renderMessages([
			{
				id: "command",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "run_commands",
					input: { commands: ["bun run test"] },
					result: "45 tests passed",
				}),
				createdAt: 1,
			},
		]);

		const trigger = [...container.querySelectorAll("button")].find((element) =>
			element.textContent?.includes("Ran command bun run test"),
		);
		expect(trigger).toBeDefined();
		await act(async () => trigger?.click());
		expect(container.textContent).toContain("45 tests passed");
	});

	it("pre-expands tool groups that contain edit diffs", async () => {
		await renderMessages([
			{
				id: "edit-open",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "editor",
					input: { path: "open.ts", old_text: "before", new_text: "after" },
					result: {},
				}),
				createdAt: 1,
			},
			{
				id: "between",
				sessionId: "session-1",
				role: "assistant",
				content: "Splitting the groups",
				createdAt: 2,
			},
			{
				id: "read-closed",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "read_files",
					input: { paths: ["closed.ts"] },
					result: {},
				}),
				createdAt: 3,
			},
		]);

		const [editBlock, readBlock] = [
			...container.querySelectorAll(".cline-chat-tool"),
		];
		// The edit group's diff panel is visible without a click…
		expect(
			editBlock
				?.querySelector(".cline-chat-disclosure-content-motion")
				?.getAttribute("data-state"),
		).toBe("open");
		// …while the read group stays collapsed.
		expect(
			readBlock
				?.querySelector(".cline-chat-disclosure-content-motion")
				?.getAttribute("data-state"),
		).toBe("closed");
	});

	it("opens a streaming group when an edit diff arrives after mount", async () => {
		const read: ChatMessage = {
			id: "stream-read",
			sessionId: "session-1",
			role: "tool",
			content: JSON.stringify({
				toolName: "read_files",
				input: { paths: ["app.ts"] },
				result: {},
			}),
			createdAt: 1,
		};
		// The group mounts with only the read call, so it starts collapsed.
		await renderMessages([read]);
		expect(
			container
				.querySelector(".cline-chat-disclosure-content-motion")
				?.getAttribute("data-state"),
		).toBe("closed");

		// The edit call joins the same group mid-stream; the diff should
		// surface without a click.
		await renderMessages([
			read,
			{
				id: "stream-edit",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "editor",
					input: { path: "app.ts", old_text: "before", new_text: "after" },
					result: {},
				}),
				createdAt: 2,
			},
		]);
		expect(
			[
				...container.querySelectorAll(".cline-chat-disclosure-content-motion"),
			].some((panel) => panel.getAttribute("data-state") === "open"),
		).toBe(true);
	});

	it("summarizes spawned teammates and expands their agent IDs", async () => {
		await renderMessages(
			["reviewer", "tester", "writer"].map(
				(agentId, index): ChatMessage => ({
					id: `spawn-${agentId}`,
					sessionId: "session-1",
					role: "tool",
					content: JSON.stringify({
						toolName: "team_spawn_teammate",
						input: { agentId, rolePrompt: "Help the team" },
						result: { agentId, status: "spawned" },
					}),
					createdAt: index + 1,
				}),
			),
		);

		const triggers = [...container.querySelectorAll("button")].filter(
			(element) => element.textContent?.includes("Spawned 1 teammate"),
		);
		expect(triggers).toHaveLength(3);
		for (const trigger of triggers) {
			await act(async () => trigger.click());
		}
		expect(container.textContent).toContain("reviewer");
		expect(container.textContent).toContain("tester");
		expect(container.textContent).toContain("writer");
	});

	it("summarizes assigned team tasks with mode, agent, and status", async () => {
		await renderMessages(
			["reviewer", "tester"].map(
				(agentId, index): ChatMessage => ({
					id: `run-${agentId}`,
					sessionId: "session-1",
					role: "tool",
					content: JSON.stringify({
						toolName: "team_run_task",
						input: { agentId, runMode: "async", task: "Investigate" },
						result: { agentId, mode: "async", status: "queued" },
					}),
					createdAt: index + 1,
				}),
			),
		);

		const triggers = [...container.querySelectorAll("button")].filter(
			(element) => element.textContent?.includes("Assigned 1 team task"),
		);
		expect(triggers).toHaveLength(2);
		for (const trigger of triggers) {
			await act(async () => trigger.click());
		}
		expect(container.textContent).toContain("async reviewer queued");
		expect(container.textContent).toContain("async tester queued");
	});

	it("summarizes awaited teammate reports with their statuses", async () => {
		await renderMessages([
			{
				id: "await-runs",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "team_await_runs",
					input: {},
					result: [
						{ id: "run-1", agentId: "reviewer", status: "completed" },
						{ id: "run-2", agentId: "tester", status: "failed" },
					],
				}),
				createdAt: 1,
			},
		]);

		const trigger = [...container.querySelectorAll("button")].find((element) =>
			element.textContent?.includes("Waited for teammates"),
		);
		expect(trigger).toBeDefined();
		await act(async () => trigger?.click());
		expect(container.textContent).toContain("reviewer completed");
		expect(container.textContent).toContain("tester failed");
	});

	it("counts every returned task in team task list summaries", async () => {
		await renderMessages([
			{
				id: "list-team-tasks",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "team_task",
					input: { action: "list" },
					result: {
						action: "list",
						tasks: [
							{ id: "task-1", title: "Review", status: "pending" },
							{ id: "task-2", title: "Test", status: "in_progress" },
							{ id: "task-3", title: "Document", status: "completed" },
						],
					},
				}),
				createdAt: 1,
			},
		]);

		expect(container.textContent).toContain("Listed 3 team tasks");
	});

	it("uses failure-oriented labels for failed team tools", async () => {
		await renderMessages([
			{
				id: "failed-spawn",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "team_spawn_teammate",
					input: { agentId: "reviewer", rolePrompt: "Review" },
					result: { error: "already exists" },
					isError: true,
				}),
				createdAt: 1,
			},
		]);

		expect(container.textContent).toContain("Failed to spawn teammate");
		expect(container.textContent).not.toContain("Spawned 1 teammate");
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

		// Rows keep call order, each with its own specific label.
		const labels = [...container.querySelectorAll(".cline-chat-tool")].map(
			(row) => row.textContent ?? "",
		);
		expect(labels[0]).toContain("Read file before.ts");
		expect(labels[1]).toContain("Edited file change.ts");
		expect(labels[2]).toContain("Read file after.ts");
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

		expect(container.textContent).toContain("Read file first.ts");
		expect(container.textContent).toContain("Read file second.ts");
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

		expect(container.textContent).toContain("Ran 2 commands");
		expect(container.textContent?.match(/Spawned agent/g)).toHaveLength(3);
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
		// This narration-then-tool tail renders inside a tight run group,
		// which in turn sits in the gap-4 conversation list; the content column
		// keeps the gap-2 spacing between blocks within one message.
		const runGroup = message?.parentElement;
		const messageList = runGroup?.parentElement;
		const content = message?.querySelector(".cline-chat-message-content");

		expect(runGroup?.classList.contains("gap-1")).toBe(true);
		expect(messageList?.classList.contains("gap-4")).toBe(true);
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
		expect(userActions?.getAttribute("data-side")).toBe("end");
		expect(assistantMessage?.classList.contains("relative")).toBe(true);
		expect(assistantActions?.getAttribute("data-side")).toBe("start");
		expect(assistantActions?.getAttribute("data-visible")).toBe("true");
		const userAction = userActions?.querySelector(".cline-chat-message-action");
		expect(userAction?.getAttribute("data-slot")).toBe("icon-button");
		const assistantActionButtons = [
			...(assistantActions?.querySelectorAll(".cline-chat-message-action") ??
				[]),
		];
		expect(assistantActionButtons).toHaveLength(2);
		expect(
			assistantActionButtons.every(
				(action) => action.getAttribute("data-slot") === "icon-button",
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

	it("renders live ANSI command output and offers proceed while running", async () => {
		const onProceedWhileRunning = vi.fn(async () => undefined);
		await renderMessages(
			[
				{
					id: "tool-live-output",
					sessionId: "session-1",
					role: "tool",
					content: JSON.stringify({
						toolName: "run_commands",
						input: { commands: ["bun test"] },
						result: null,
					}),
					createdAt: 1,
					meta: {
						toolName: "run_commands",
						toolCallId: "call-live",
						toolOutput: "\u001b[31mfailed\u001b[0m\n",
						toolDetachable: true,
						hookEventName: "tool_call_start",
					},
				},
			],
			{ status: "running", onProceedWhileRunning },
		);

		const output = container.querySelector('[aria-label="Command output"]');
		expect(output?.textContent).toContain("failed");
		expect(output?.textContent).not.toContain("\u001b[31m");
		expect(output?.querySelector("span")?.getAttribute("style")).toContain(
			"color",
		);
		const proceedButton = [...container.querySelectorAll("button")].find(
			(button) => button.textContent?.includes("Proceed while running"),
		);
		expect(proceedButton).toBeDefined();
		await act(async () => proceedButton?.click());
		expect(onProceedWhileRunning).toHaveBeenCalledWith(
			"session-1",
			"call-live",
		);
	});

	it("renders persisted run command output after completion", async () => {
		await renderMessages([
			{
				id: "tool-final-output",
				sessionId: "session-1",
				role: "tool",
				content: JSON.stringify({
					toolName: "run_commands",
					input: { commands: ["bun test"] },
					result: [
						{ query: "bun test", result: "3 tests passed", success: true },
					],
				}),
				createdAt: 1,
				meta: {
					toolName: "run_commands",
					toolCallId: "call-final",
					hookEventName: "tool_call_end",
				},
			},
		]);

		const trigger = container.querySelector<HTMLButtonElement>(
			".cline-chat-tool-trigger",
		);
		await act(async () => trigger?.click());
		expect(
			container.querySelector('[aria-label="Command output"]')?.textContent,
		).toContain("3 tests passed");
	});

	it("caps command output without dropping the newest tail", async () => {
		const makeCommand = (id: string, output: string, createdAt: number) => ({
			id,
			sessionId: "session-1",
			role: "tool" as const,
			content: JSON.stringify({
				toolName: "run_commands",
				input: { commands: [`echo ${id}`] },
				result: [{ query: `echo ${id}`, result: output, success: true }],
			}),
			createdAt,
			meta: { toolName: "run_commands", hookEventName: "tool_call_end" },
		});
		await renderMessages([
			makeCommand("command", `${"a".repeat(60_000)}newest-tail`, 1),
		]);

		const trigger = container.querySelector<HTMLButtonElement>(
			".cline-chat-tool-trigger",
		);
		await act(async () => trigger?.click());
		const output = container.querySelector('[aria-label="Command output"]');
		expect(output?.textContent?.length).toBeLessThanOrEqual(
			MAX_LIVE_COMMAND_OUTPUT_CHARS,
		);
		expect(output?.textContent).toContain("newest-tail");
		expect(output?.textContent).toContain("Earlier command output truncated");
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
						sessionId: "session-1",
					},
				],
			},
		);

		const answer = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Continue"),
		);
		await act(async () => answer?.click());
		expect(onAnswerAskQuestion).not.toHaveBeenCalled();

		const submit = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Submit",
		);
		await act(async () => submit?.click());

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

	it("renders an image-only assistant response", async () => {
		await renderMessages([
			{
				id: "assistant-image",
				sessionId: "session-1",
				role: "assistant",
				content: "",
				images: [
					{
						id: "generated-image-1",
						mediaType: "image/webp",
						data: "aGVsbG8=",
					},
				],
				createdAt: 1,
			},
		]);

		expect(
			container.querySelector<HTMLImageElement>('img[alt="Generated result 1"]')
				?.src,
		).toBe("data:image/webp;base64,aGVsbG8=");
	});

	it("shows one generated image at a time and navigates the result set", async () => {
		await renderMessages([
			{
				id: "assistant-images",
				sessionId: "session-1",
				role: "assistant",
				content: "",
				images: [
					{
						id: "generated-image-1",
						mediaType: "image/png",
						data: "Zmlyc3Q=",
					},
					{
						id: "generated-image-2",
						mediaType: "image/png",
						data: "c2Vjb25k",
					},
				],
				createdAt: 1,
			},
		]);

		expect(
			container.querySelector<HTMLImageElement>('img[alt="Generated result 1"]')
				?.src,
		).toBe("data:image/png;base64,Zmlyc3Q=");
		expect(container.querySelector('img[alt="Generated result 2"]')).toBeNull();
		expect(container.textContent).toContain("1 / 2");

		const previous = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Previous generated image"]',
		);
		const next = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Next generated image"]',
		);
		expect(previous?.disabled).toBe(true);
		await act(async () => next?.click());

		expect(
			container.querySelector<HTMLImageElement>('img[alt="Generated result 2"]')
				?.src,
		).toBe("data:image/png;base64,c2Vjb25k");
		expect(container.textContent).toContain("2 / 2");
		expect(next?.disabled).toBe(true);

		await act(async () => previous?.click());
		expect(
			container.querySelector<HTMLImageElement>('img[alt="Generated result 1"]')
				?.src,
		).toBe("data:image/png;base64,Zmlyc3Q=");
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
		expect(trigger?.querySelector(".cline-chat-thinking-icon")).not.toBeNull();
		expect(trigger?.querySelector(".cline-chat-disclosure-icon")).toBeNull();

		await act(async () => trigger?.click());

		const content = container.querySelector(".cline-chat-reasoning-content");
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(content?.textContent).toContain("Carefully considered the request.");
		expect(content?.classList.contains("cline-chat-panel-rail")).toBe(true);
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
					// Two commands so the expanded panel renders detail rows (a
					// single untruncated command lives in the label alone).
					input: { commands: ["git status", "git diff"] },
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

		expect(reasoningContent?.classList.contains("cline-chat-panel-rail")).toBe(
			true,
		);
		expect(toolContent?.classList.contains("cline-chat-panel-rail")).toBe(true);

		// Reasoning remains capped and scrolls internally (the shared
		// cline-chat-thinking-content styling); tool output grows into the
		// conversation scroller.
		expect(
			reasoningContent?.classList.contains("cline-chat-thinking-content"),
		).toBe(true);
		expect(toolContent?.classList.contains("cline-chat-thinking-content")).toBe(
			false,
		);
		expect(toolContent?.classList.contains("overflow-auto")).toBe(false);

		// Detail rows use the shared wrapping behavior instead of horizontal scrolling.
		const details = toolContent?.querySelector(".cline-chat-tool-details");
		expect(details?.classList.contains("whitespace-pre")).toBe(false);
		expect(details?.classList.contains("whitespace-pre-wrap")).toBe(true);
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

		// The completed run's working rows collapse; expand them so both
		// disclosures render, proving they were never merged across the tool.
		const workTrigger = container.querySelector(
			"button.cline-chat-work-trigger",
		) as HTMLButtonElement | null;
		expect(workTrigger).not.toBeNull();
		await act(async () => workTrigger?.click());

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

describe("ChatMessages send auto-scroll", () => {
	const baseMessages: ChatMessage[] = [
		{
			id: "user-1",
			sessionId: "session-1",
			role: "user",
			content: "First",
			createdAt: 1_000,
		},
		{
			id: "assistant-1",
			sessionId: "session-1",
			role: "assistant",
			content: "Reply",
			createdAt: 2_000,
		},
	];

	it("scrolls to the bottom when a new user message lands, but not for assistant output", async () => {
		await renderMessages(baseMessages);
		const scrollTo = HTMLElement.prototype.scrollTo as ReturnType<typeof vi.fn>;
		scrollTo.mockClear();

		// Assistant output alone must not force the reader back down.
		await renderMessages([
			...baseMessages,
			{
				id: "assistant-2",
				sessionId: "session-1",
				role: "assistant",
				content: "More output",
				createdAt: 3_000,
			},
		]);
		expect(scrollTo).not.toHaveBeenCalledWith(
			expect.objectContaining({ behavior: "smooth" }),
		);

		await renderMessages([
			...baseMessages,
			{
				id: "user-2",
				sessionId: "session-1",
				role: "user",
				content: "Second",
				createdAt: 4_000,
			},
		]);
		expect(scrollTo).toHaveBeenCalledWith(
			expect.objectContaining({ behavior: "smooth" }),
		);
	});
});

describe("ChatMessages work collapse", () => {
	const completedRun: ChatMessage[] = [
		{
			id: "user-run",
			sessionId: "session-1",
			role: "user",
			content: "Fix the bug",
			createdAt: 1_000,
		},
		{
			id: "tool-run-1",
			sessionId: "session-1",
			role: "tool",
			content: JSON.stringify({
				toolName: "read_files",
				input: { paths: ["bug.ts"] },
				result: {},
			}),
			createdAt: 2_000,
		},
		{
			id: "tool-run-2",
			sessionId: "session-1",
			role: "tool",
			content: JSON.stringify({
				toolName: "editor",
				input: { path: "bug.ts", old_text: "before", new_text: "after" },
				result: {},
			}),
			createdAt: 3_000,
		},
		{
			id: "assistant-run",
			sessionId: "session-1",
			role: "assistant",
			content: "Fixed it.",
			createdAt: 5_000,
		},
	];

	it("folds a finished run into a work summary that expands back into rows", async () => {
		await renderMessages(completedRun);

		const trigger = container.querySelector(
			"button.cline-chat-work-trigger",
		) as HTMLButtonElement | null;
		expect(trigger?.textContent).toContain(
			"Worked for 4s and made 2 tool calls",
		);
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		// Collapsed content is lazy: the tool rows do not render until opened.
		expect(container.querySelector(".cline-chat-tool")).toBeNull();
		expect(container.textContent).toContain("Fixed it.");

		await act(async () => trigger?.click());
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(container.querySelectorAll(".cline-chat-tool")).toHaveLength(2);
	});

	it("keeps the live run's rows visible while the session is active", async () => {
		await renderMessages(completedRun, { status: "running" });

		expect(container.querySelector(".cline-chat-work")).toBeNull();
		expect(container.querySelectorAll(".cline-chat-tool")).toHaveLength(2);
	});

	it.each(["cancelled", "failed", "error"] as const)(
		"keeps an interrupted run's rows visible even with partial trailing text (%s)",
		async (status) => {
			// Stop can land mid-answer, leaving partial assistant text after the
			// tool calls; the run still must not fold into a summary.
			await renderMessages(completedRun, { status });

			expect(container.querySelector(".cline-chat-work")).toBeNull();
			expect(container.querySelectorAll(".cline-chat-tool")).toHaveLength(2);
		},
	);
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
					content: JSON.stringify({
						toolName: "read_files",
						input: { paths: ["pending.ts"] },
						result: null,
					}),
					createdAt: 2,
					meta: { hookEventName: "tool_call_start" },
				},
			],
			{ status: "running" },
		);

		expect(container.textContent).not.toContain("Thinking...");
	});

	it("shows between a finished tool and the next output", async () => {
		// The quiet stretch while the model composes its next step (e.g.
		// streams tool-call arguments) used to render nothing and look frozen.
		await renderMessages(
			[
				userMessage,
				{
					id: "tool-1",
					sessionId: "session-1",
					role: "tool",
					content: JSON.stringify({
						toolName: "read_files",
						input: { paths: ["done.ts"] },
						result: { content: "done" },
					}),
					createdAt: 2,
				},
			],
			{ status: "running" },
		);

		expect(container.textContent).toContain("Thinking...");
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
