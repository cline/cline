import { expect, test } from "bun:test";
import type { AgentExtensionCommand, AgentMessage } from "@cline/shared";
import {
	createNextTurnPlugin,
	factsOf,
	type NextTurnCandidate,
	pool,
} from "./next-turn";

const msg = (parts: unknown[]): AgentMessage =>
	({
		id: "m",
		role: "assistant",
		content: parts,
		createdAt: 0,
	}) as AgentMessage;

const user = (text: string, metadata?: Record<string, unknown>): AgentMessage =>
	({
		id: "u",
		role: "user",
		content: [{ type: "text", text }],
		createdAt: 0,
		metadata,
	}) as AgentMessage;

const said = (text: string) => msg([{ type: "text", text }]);
const run = (
	status: "completed" | "aborted" | "failed",
	messages: AgentMessage[] = [],
) =>
	({
		status,
		messages,
		agentId: "a",
		runId: "r",
		iterations: 1,
		outputText: "",
		usage: {},
	}) as never;

const edited = msg([
	{
		type: "tool-call",
		toolCallId: "1",
		toolName: "write_to_file",
		input: { path: "a.ts" },
	},
	{
		type: "tool-result",
		toolCallId: "1",
		toolName: "write_to_file",
		output: "ok",
	},
]);
const errored = msg([
	{
		type: "tool-result",
		toolCallId: "1",
		toolName: "write_to_file",
		output: "nope",
		isError: true,
	},
]);
const failedEdit = msg([
	{
		type: "tool-call",
		toolCallId: "1",
		toolName: "editor",
		input: { path: "a.ts" },
	},
	{
		type: "tool-result",
		toolCallId: "1",
		toolName: "editor",
		output: {
			query: "edit:a.ts",
			result: "",
			error: "old_text not found",
			success: false,
		},
	},
]);
const failedCommand = msg([
	{
		type: "tool-call",
		toolCallId: "2",
		toolName: "run_commands",
		input: { commands: ["bun test"] },
	},
	{
		type: "tool-result",
		toolCallId: "2",
		toolName: "run_commands",
		output: [{ query: "bun test", result: "exit 1", success: false }],
	},
]);

function kinds(facts: Parameters<typeof pool>[0]) {
	return pool(facts).map((candidate) => candidate.kind);
}

test("facts count successful edits only and only from the finished turn", () => {
	expect(factsOf([edited], run("completed"))).toEqual({
		status: "completed",
		filesEdited: 1,
		toolErrored: false,
	});
	expect(factsOf([edited, errored], run("completed"))).toMatchObject({
		filesEdited: 0,
		toolErrored: true,
	});
	const later = factsOf(
		[user("edit a.ts"), edited, errored, user("thanks"), said("welcome")],
		run("completed"),
	);
	expect(later).toMatchObject({ filesEdited: 0, toolErrored: false });
});

test("structured editor and command failures lead to a fix, not successful edits", () => {
	const facts = factsOf([failedEdit, failedCommand], run("completed"));
	expect(facts).toMatchObject({ filesEdited: 0, toolErrored: true });
	expect(kinds(facts)[0]).toBe("fix_failure");
});

test("mid-run system messages stay inside the turn", () => {
	const facts = factsOf(
		[user("edit"), edited, user("continue", { userRunSpan: 0 }), said("done")],
		run("completed"),
	);
	expect(facts.filesEdited).toBe(1);
});

test("rules rank resume, repair, verification, review, and wrap-up appropriately", () => {
	expect(kinds(factsOf([], run("aborted")))).toEqual(["continue", "next_step"]);
	expect(kinds(factsOf([], run("failed")))).toEqual([
		"fix_failure",
		"next_step",
	]);
	expect(kinds(factsOf([edited], run("completed")))).toEqual([
		"verify",
		"review_diff",
		"wrap_up",
		"next_step",
	]);
	expect(kinds(factsOf([edited, errored], run("completed")))[0]).toBe(
		"fix_failure",
	);
});

type Harness = {
	afterRun(
		result: ReturnType<typeof run>,
		parentAgentId?: string,
	): Promise<void>;
	beforeRun(parentAgentId?: string): Promise<void>;
	resetup(): void;
	suggestions(): Promise<string[]>;
	next(input?: string): Promise<unknown>;
};

function connect(): Harness {
	const plugin = createNextTurnPlugin();
	let command: AgentExtensionCommand | undefined;
	plugin.setup?.(
		{
			registerCommand: (value: AgentExtensionCommand) => (command = value),
		} as never,
		{} as never,
	);
	const runCommand = async (input: string) => await command?.handler?.(input);
	return {
		afterRun: (result, parentAgentId) =>
			Promise.resolve(
				plugin.hooks?.afterRun?.({
					snapshot: { parentAgentId },
					result,
				} as never),
			),
		beforeRun: async (parentAgentId) => {
			await plugin.hooks?.beforeRun?.({
				snapshot: { parentAgentId },
			} as never);
		},
		resetup: () => {
			plugin.setup?.({ registerCommand: () => {} } as never, {} as never);
		},
		suggestions: async () => {
			const result = (await runCommand("--format=json")) as {
				reply: string;
			};
			return JSON.parse(result.reply).suggestions;
		},
		next: (input = "") => runCommand(input),
	};
}

test("the command returns at most the best three prompts and submits the best", async () => {
	const tray = connect();
	await tray.afterRun(run("completed", [edited]));
	const expected = pool(factsOf([edited], run("completed")))
		.slice(0, 3)
		.map((candidate: NextTurnCandidate) => candidate.prompt);
	expect(await tray.suggestions()).toEqual(expected);
	expect(await tray.next()).toEqual({ submitPrompt: expected[0] });
});

test("a new root run clears the old set, but subagent runs leave it alone", async () => {
	const tray = connect();
	await tray.afterRun(run("completed", [edited]));
	await tray.beforeRun("subagent");
	expect((await tray.suggestions()).length).toBeGreaterThan(0);
	await tray.afterRun(run("failed"), "subagent");
	expect((await tray.suggestions()).length).toBeGreaterThan(0);
	await tray.beforeRun();
	expect(await tray.suggestions()).toEqual([]);
});

test("setup is idempotent and the plugin is root-only", async () => {
	const tray = connect();
	expect(createNextTurnPlugin().manifest.rootOnly).toBe(true);
	await tray.afterRun(run("completed", [edited]));
	const before = await tray.suggestions();
	tray.resetup();
	expect(await tray.suggestions()).toEqual(before);
});

test("an empty plugin returns no candidates and a useful manual reply", async () => {
	const tray = connect();
	expect(await tray.suggestions()).toEqual([]);
	expect(await tray.next()).toEqual({
		reply: "No next-turn suggestion is available yet.",
	});
});
