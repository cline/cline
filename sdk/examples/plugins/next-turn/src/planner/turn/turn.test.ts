import { describe, expect, test } from "bun:test";
import {
	Agent,
	countUserRunMessages as coreCount,
	getUserRunSpan as coreSpan,
} from "@cline/core";
import type {
	AgentMessage,
	MessageWithMetadata,
	ToolResultContent,
} from "@cline/shared";
import {
	editingModel,
	editorTool,
	message,
	runResult,
} from "../../test-support/agent-runs";
import { fnv1a32 } from "../candidates";
import { lastPersonMessage } from "./run-count";
import { deriveTurn, deriveTurnFromTranscript } from "./turn";
import {
	ACT_APPROVAL,
	HOOK_BLOCK,
	IMAGE,
	RESUME,
} from "./user-messages.fixtures";

/** The turn, held to the acceptance rule: its run count is core's count of the same transcript. */
function turnOf(messages: AgentMessage[], sessionId = "s") {
	const turn = deriveTurn(sessionId, runResult(messages));
	expect(turn?.runCount).toBe(coreCount(messages));
	return turn;
}

describe("the turn's identity is core's run count", () => {
	test("a compaction summary counts the runs it folded (span 3)", () => {
		const summary = message(
			"user",
			"Context summary:\n\nThe person asked for three fixes.",
			{
				metadata: {
					kind: "compaction_summary",
					displayRole: "system",
					userRunSpan: 3,
				},
			},
		);
		const prompt = message("user", "Now add the tests");
		const turn = turnOf([
			summary,
			message("assistant", "Fixed."),
			prompt,
			message("assistant", "Added."),
		]);
		expect(coreSpan(summary)).toBe(3);
		expect(turn).toMatchObject({
			runCount: 4,
			turnKey: "s:4",
			userMessageId: prompt.id,
			context: { request: "Now add the tests" },
		});
	});

	test("a steer and a [SYSTEM] reminder, as the runtime writes them, open no run (span 0)", async () => {
		const scripted = editingModel("src/flaky.ts");
		let reminded = false;
		const agent = new Agent({
			model: scripted.model,
			tools: [editorTool],
			consumePendingUserMessage: () =>
				scripted.calls() === 1 ? "also keep the old name" : undefined,
			completionPolicy: {
				completionGuard: () => {
					if (reminded) return undefined;
					reminded = true;
					return "[SYSTEM] Finish the checklist before you stop.";
				},
			},
		});
		const first = await agent.run("Fix the flaky test");
		const users = first.messages.filter((item) => item.role === "user");
		expect(users.map((item) => [textOfParts(item), coreSpan(item)])).toEqual([
			["Fix the flaky test", 1],
			["also keep the old name", 0],
			["[SYSTEM] Finish the checklist before you stop.", 0],
		]);
		const turn = turnOf([...first.messages]);
		expect(turn).toMatchObject({
			runCount: 1,
			turnKey: "s:1",
			userMessageId: users[0]?.id,
			facts: { filesEdited: 1 },
		});
		expect(lastPersonMessage(first.messages)?.text).toBe("Fix the flaky test");
		const second = await agent.run("Now update the docs");
		expect(turnOf([...second.messages])).toMatchObject({
			runCount: 2,
			turnKey: "s:2",
			context: { request: "Now update the docs" },
		});
	});

	test("a [TASK RESUMPTION] prompt carries the person's run on, so the turn and its message stay the same", () => {
		const ask = message("user", "Migrate the config");
		const messages = [
			ask,
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "c1",
					toolName: "editor",
					input: { path: "config.ts" },
				},
			]),
			message("tool", [
				{
					type: "tool-result",
					toolCallId: "c1",
					toolName: "editor",
					output: "ok",
				},
			]),
			message("user", RESUME),
			message("user", ACT_APPROVAL),
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "c2",
					toolName: "editor",
					input: { path: "config.test.ts" },
				},
			]),
		];
		const turn = turnOf(messages);
		expect(turn).toMatchObject({
			runCount: 1,
			userMessageId: ask.id,
			facts: { filesEdited: 2 },
		});
		expect(lastPersonMessage(messages)?.id).toBe(ask.id);
	});

	test("hook context is never the person's message, with or without the span core now writes", () => {
		const ask = message("user", "Fix it");
		const marked = message("user", HOOK_BLOCK, {
			metadata: { userRunSpan: 0, displayRole: "system" },
		});
		expect(turnOf([ask, marked])).toMatchObject({
			runCount: 1,
			userMessageId: ask.id,
			context: { request: "Fix it" },
		});
		const unmarked = message("user", HOOK_BLOCK);
		const bare = message("user", "<hook_context>injected</hook_context>");
		expect(turnOf([ask, unmarked, bare])).toMatchObject({
			runCount: 3,
			userMessageId: ask.id,
			context: { request: "Fix it" },
		});
	});

	test("an image-only message is the person's, with an empty request", () => {
		const image = message("user", [IMAGE]);
		const messages = [
			message("user", "Match this mock"),
			message("assistant", "Which one?"),
			image,
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "c1",
					toolName: "editor",
					input: { path: "src/card.tsx" },
				},
			]),
		];
		expect(turnOf(messages)).toMatchObject({
			runCount: 2,
			turnKey: "s:2",
			userMessageId: image.id,
			facts: { filesEdited: 1 },
			context: { request: "" },
		});
		expect(lastPersonMessage(messages)).toEqual({ id: image.id, text: "" });
	});

	test("the revision names the chat position, never a message id", () => {
		const one = deriveTurn("s", runResult([message("user", "One")]));
		const again = deriveTurn("s", runResult([message("user", "One")]));
		expect(one?.revision).toBe(fnv1a32("s:1"));
		expect(again?.revision).toBe(one?.revision);
		expect(
			deriveTurn("t", runResult([message("user", "One")]))?.revision,
		).not.toBe(one?.revision);
		expect(
			deriveTurn(
				"s",
				runResult([message("user", "One"), message("user", "Two")]),
			)?.revision,
		).toBe(fnv1a32("s:2"));
	});

	test("deriveTurnFromTranscript extracts turn facts, tools, edited paths, push state and modelInfo without a runId", () => {
		const user = message("user", "Fix the retry logic", {
			metadata: { runId: "run_from_meta" },
		});
		const assistant = {
			role: "assistant" as const,
			content: [
				{ type: "text", text: "Updated retry.ts." },
				{
					type: "tool-call",
					toolCallId: "tc1",
					toolName: "editor",
					input: { path: "src/retry.ts" },
				},
				{
					type: "tool-call",
					toolCallId: "tc2",
					toolName: "run_commands",
					input: { command: "git push origin main" },
				},
			],
			modelInfo: { provider: "anthropic", id: "claude-sonnet-4-5" },
		};
		const toolResult = {
			role: "tool" as const,
			content: [
				{
					type: "tool-result",
					toolCallId: "tc1",
					toolName: "editor",
					output: "ok",
				},
				{
					type: "tool-result",
					toolCallId: "tc2",
					toolName: "run_commands",
					output: { error: "permission denied" },
					isError: true,
				},
			],
		};
		const turn = deriveTurnFromTranscript(
			"sess_tx",
			[user, assistant, toolResult],
			"failed",
		);
		expect(turn).toMatchObject({
			runId: "run_from_meta",
			userMessageId: user.id,
			runCount: 1,
			turnKey: "sess_tx:1",
			revision: fnv1a32("sess_tx:1"),
			facts: { status: "failed", filesEdited: 1, toolErrored: true },
			pushed: false,
			chat: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
		});
		expect(turn?.context.request).toBe("Fix the retry logic");
		expect(turn?.context.reply).toBe("Updated retry.ts.");
		expect(turn?.context.editedPaths).toEqual(["src/retry.ts"]);
		expect(turn?.context.tools).toEqual([
			{ name: "editor", failed: false },
			{ name: "run_commands", failed: true, error: "permission denied" },
		]);
		expect(
			deriveTurnFromTranscript("sess_tx", [
				{ role: "assistant", content: "hi" },
			]),
		).toBeNull();
	});

	test("deriveTurnFromTranscript reads the provider blocks the hub's session.messages returns, with the same success filtering", () => {
		const operation = (fields: Record<string, unknown>) =>
			JSON.stringify({ result: "", ...fields });
		const stored: MessageWithMetadata[] = [
			{ id: "u1", role: "user", content: "Fix the retry and push" },
			{
				id: "a1",
				role: "assistant",
				content: [
					{ type: "text", text: "Fixed the retry and pushed." },
					{
						type: "tool_use",
						id: "written",
						name: "editor",
						input: { path: "src/retry.ts", old_text: "a", new_text: "b" },
					},
					{
						type: "tool_use",
						id: "not_found",
						name: "editor",
						input: { path: "src/client.ts", old_text: "a", new_text: "b" },
					},
					{
						type: "tool_use",
						id: "denied",
						name: "editor",
						input: { path: "src/config.ts", old_text: "a", new_text: "b" },
					},
					{
						type: "tool_use",
						id: "push",
						name: "run_commands",
						input: { commands: ["npm test", "git push"] },
					},
				],
				modelInfo: { provider: "anthropic", id: "claude-sonnet-4-5" },
			},
			{
				id: "r1",
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "written",
						name: "editor",
						content: operation({ query: "edit:src/retry.ts", success: true }),
					},
					{
						type: "tool_result",
						tool_use_id: "not_found",
						name: "editor",
						content: operation({
							query: "edit:src/client.ts",
							error: "old_text was not found in src/client.ts",
							success: false,
						}),
					},
					{
						type: "tool_result",
						tool_use_id: "denied",
						name: "editor",
						content: JSON.stringify({
							error: "The user denied this operation.",
						}),
						is_error: true,
					},
					{
						type: "tool_result",
						tool_use_id: "push",
						name: "run_commands",
						// Core stores a list of results as the list itself, not its JSON.
						content: [
							{ query: "npm test", result: "1 failing", success: false },
							{ query: "git push", result: "", success: true },
						] as unknown as ToolResultContent["content"],
					},
				],
			},
		];
		const turn = deriveTurnFromTranscript("sess_tx", stored, "completed");
		expect(turn?.runCount).toBe(coreCount(stored));
		expect(turn).toMatchObject({
			runCount: 1,
			facts: { filesEdited: 1, toolErrored: true },
			pushed: true,
			chat: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
			context: {
				request: "Fix the retry and push",
				reply: "Fixed the retry and pushed.",
				editedPaths: ["src/retry.ts"],
			},
		});
		expect(turn?.context.tools).toEqual([
			{ name: "editor", failed: false },
			{ name: "editor", failed: false },
			{
				name: "editor",
				failed: true,
				error: "The user denied this operation.",
			},
			{ name: "run_commands", failed: false },
		]);
	});

	test("a push is a git push or a PR opened, merged or readied, read from the tool call's input", () => {
		const pushedBy = (input: unknown) =>
			deriveTurnFromTranscript("sess_push", [
				message("user", "Ship it"),
				{
					role: "assistant",
					content: [
						{
							type: "tool-call",
							toolCallId: "tc",
							toolName: "run_commands",
							input,
						},
					],
				},
			])?.pushed;
		expect(pushedBy("git push -u origin HEAD")).toBe(true);
		expect(pushedBy({ commands: ["gh pr create --fill"] })).toBe(true);
		expect(pushedBy("git pushd")).toBe(false);
		expect(pushedBy(undefined)).toBe(false);
	});
});

function textOfParts(item: AgentMessage): string {
	return item.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n");
}
