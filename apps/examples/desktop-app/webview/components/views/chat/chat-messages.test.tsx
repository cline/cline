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
