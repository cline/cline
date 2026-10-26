import { expect, test } from "bun:test";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import {
	createNextTurnPlugin,
	factsOf,
	NEXT_TURN_SUGGESTIONS_EVENT,
	pool,
} from "./plugin";

const message = (role: "user" | "assistant", parts: unknown[]): AgentMessage =>
	({ id: role, role, content: parts, createdAt: 0 }) as AgentMessage;
const edited = message("assistant", [
	{
		type: "tool-call",
		toolCallId: "edit-1",
		toolName: "write_to_file",
		input: { path: "a.ts" },
	},
	{
		type: "tool-result",
		toolCallId: "edit-1",
		toolName: "write_to_file",
		output: "ok",
	},
]);
const run = (
	status: "completed" | "aborted" | "failed",
	messages: AgentMessage[] = [],
) =>
	({
		agentId: "agent-1",
		runId: "run-1",
		status,
		iterations: 1,
		outputText: "",
		messages,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	}) as AgentRunResult;

test("a completed edit produces verify and review suggestions", () => {
	const facts = factsOf(
		[message("user", [{ type: "text", text: "edit a.ts" }]), edited],
		run("completed"),
	);
	expect(facts).toEqual({
		status: "completed",
		filesEdited: 1,
		toolErrored: false,
	});
	expect(
		pool(facts)
			.slice(0, 3)
			.map((row) => row.kind),
	).toEqual(["verify", "review_diff", "wrap_up"]);
});

test("afterRun emits a bounded backend suggestion event for the root run", async () => {
	const events: Array<{ name: string; payload: unknown }> = [];
	const plugin = createNextTurnPlugin();
	plugin.setup?.(
		{} as never,
		{
			session: { sessionId: "session-1" },
			emitEvent: (name: string, payload: unknown) =>
				events.push({ name, payload }),
		} as never,
	);
	await plugin.hooks?.afterRun?.({
		snapshot: {},
		result: run("completed", [
			message("user", [{ type: "text", text: "edit a.ts" }]),
			edited,
		]),
	} as never);
	expect(events).toHaveLength(1);
	expect(events[0]?.name).toBe(NEXT_TURN_SUGGESTIONS_EVENT);
	expect(events[0]?.payload).toMatchObject({
		sessionId: "session-1",
		runId: "run-1",
		status: "completed",
	});
	expect(
		(events[0]?.payload as { suggestions: unknown[] }).suggestions,
	).toHaveLength(3);
});

test("failed runs lead with a fix and subagent runs stay silent", async () => {
	const events: unknown[] = [];
	const plugin = createNextTurnPlugin();
	plugin.setup?.(
		{} as never,
		{
			emitEvent: (name: string, payload: unknown) =>
				events.push({ name, payload }),
		} as never,
	);
	await plugin.hooks?.afterRun?.({
		snapshot: {},
		result: run("failed"),
	} as never);
	expect(
		(events[0] as { payload: { suggestions: Array<{ kind: string }> } }).payload
			.suggestions[0]?.kind,
	).toBe("fix_failure");
	await plugin.hooks?.afterRun?.({
		snapshot: { parentAgentId: "parent" },
		result: run("completed"),
	} as never);
	expect(events).toHaveLength(1);
});
