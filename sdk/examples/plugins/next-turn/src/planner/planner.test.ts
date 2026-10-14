import { describe, expect, test } from "bun:test";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import type { Manifest } from "../context/manifest";
import { EMPTY_BACKLOG } from "./backlog";
import { REVIEW_PROMPT, suggestion, type TurnFacts } from "./candidates";
import { buildPlannerInput, plannerSystemPrompt, unreadSources } from "./input";
import { CORE_KINDS, offerableKinds } from "./kinds";
import { buildModelSet, parsePlannerOutput } from "./output";
import { deriveTurn, editedPaths, lastPersonMessage } from "./turn";

let ids = 0;
function message(
	role: AgentMessage["role"],
	content: AgentMessage["content"],
	extra: Partial<AgentMessage> = {},
): AgentMessage {
	ids += 1;
	return { id: `m${ids}`, role, content, createdAt: ids, ...extra };
}

function run(
	messages: AgentMessage[],
	status: AgentRunResult["status"] = "completed",
	outputText = "Done: fixed the test.",
): AgentRunResult {
	return {
		agentId: "a",
		runId: "run_si9HsPkJ",
		status,
		iterations: 1,
		outputText,
		messages,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	};
}

describe("the turn, from the run result", () => {
	const earlier = [
		message("user", [{ type: "text", text: "First request" }]),
		message("assistant", [{ type: "text", text: "ok" }]),
	];

	test("facts and context come only from after the person's last message", () => {
		const user = message("user", [
			{ type: "text", text: "Fix the failing test in users.test.ts" },
		]);
		const messages = [
			...earlier,
			message("assistant", [
				{
					type: "tool-call",
					toolCallId: "old",
					toolName: "editor",
					input: { path: "old.ts" },
				},
			]),
			user,
			message(
				"user",
				[{ type: "text", text: "<hook_context>injected</hook_context>" }],
				{ metadata: { userRunSpan: 0, displayRole: "system" } },
			),
			message(
				"assistant",
				[
					{
						type: "tool-call",
						toolCallId: "c1",
						toolName: "editor",
						input: { path: "src/users.ts" },
					},
					{
						type: "tool-call",
						toolCallId: "c2",
						toolName: "apply_patch",
						input: { input: "*** Update File: a.ts\n*** Add File: b.ts\n" },
					},
					{
						type: "tool-call",
						toolCallId: "c3",
						toolName: "run_commands",
						input: { command: "git push -u origin feature" },
					},
				],
				{ modelInfo: { id: "claude-sonnet-5-5", provider: "anthropic" } },
			),
			message("tool", [
				{
					type: "tool-result",
					toolCallId: "c1",
					toolName: "editor",
					output: "ok",
				},
				{
					type: "tool-result",
					toolCallId: "c3",
					toolName: "run_commands",
					output: { error: "token=abcdefghijklmnopqr rejected" },
					isError: true,
				},
			]),
		];
		const turn = deriveTurn("s1", run(messages));
		expect(turn).toMatchObject({
			runId: "run_si9HsPkJ",
			userMessageId: user.id,
			runCount: 2,
			turnKey: "s1:2",
			facts: { status: "completed", filesEdited: 3, toolErrored: true },
			pushed: true,
			chat: { providerId: "anthropic", modelId: "claude-sonnet-5-5" },
		});
		expect(turn?.context.request).toBe("Fix the failing test in users.test.ts");
		expect(turn?.context.editedPaths).toEqual(["src/users.ts", "a.ts", "b.ts"]);
		expect(turn?.context.tools).toEqual([
			{ name: "editor", failed: false },
			{
				name: "run_commands",
				failed: true,
				error: "token=abcdefghijklmnopqr rejected",
			},
		]);
	});

	test("an aborted run is a stopped turn, a failed run a failed one; no message is no turn", () => {
		const user = message("user", [{ type: "text", text: "Go" }]);
		expect(deriveTurn("s", run([user], "aborted"))?.facts.status).toBe(
			"cancelled",
		);
		expect(deriveTurn("s", run([user], "failed"))?.facts.status).toBe("failed");
		expect(deriveTurn("s", run([]))).toBeNull();
		expect(
			lastPersonMessage([
				user,
				message("user", [{ type: "text", text: "<hook_context>x" }]),
			]),
		).toEqual({ id: user.id, text: "Go" });
		expect(editedPaths({ filePath: " x.ts " })).toEqual(["x.ts"]);
	});
});

function manifestOf(
	sources: Manifest["sources"],
	capabilities: string[] = [],
	mode: Manifest["mode"] = "act",
): Manifest {
	return { client: "cline-cli", mode, sources, capabilities };
}

const turn: TurnFacts = {
	status: "completed",
	filesEdited: 1,
	toolErrored: false,
};
const context = {
	request: "Add a retry. My key is sk-ant-0123456789abcdefghij",
	reply: "Added it.",
	tools: [],
	editedPaths: ["src/retry.ts"],
};

describe("the planner's input", () => {
	test("a stock install hears nothing about sources it does not have", () => {
		const manifest = manifestOf({
			turn: "present",
			git: "present",
			status: "absent",
			tasks: "absent",
			plan: "absent",
			history: "off",
		});
		const input = buildPlannerInput({
			turn,
			context,
			backlog: EMPTY_BACKLOG,
			manifest,
			facts: {},
			kinds: CORE_KINDS,
			excluded: [],
		});
		expect(input.user).not.toMatch(
			/Status Hub|agenda|plan bank|Could not read|other chats/,
		);
		expect(input.user).toContain("[redacted]");
		expect(input.user).not.toContain("0123456789abcdefghij");
	});

	test("present sources say none when empty; unknown ones are named; facts keep their headings", () => {
		const manifest = manifestOf(
			{
				turn: "present",
				status: "present",
				tasks: "present",
				history: "present",
				repo: "present",
				plan: "unknown",
			},
			["github", "remote:github", "mcp:sentry"],
		);
		const facts = {
			history: "unknown" as const,
			repo: {
				heading: "This repository's commands",
				lines: ["bun run check (password=hunter22222)"],
			},
		};
		const input = buildPlannerInput({
			turn,
			context,
			backlog: EMPTY_BACKLOG,
			manifest,
			facts,
			kinds: offerableKinds(manifest),
			excluded: ["Run the tests."],
		});
		expect(input.user).toContain(
			"## This chat on the Status Hub\nNothing reported for this chat.",
		);
		expect(input.user).toContain("## Tasks on the agenda\nNo open tasks.");
		expect(input.user).toContain(
			"## This repository's commands\n- bun run check (password=[redacted]",
		);
		expect(input.user).toContain(
			"## Connected services the agent can use (names only)\ngithub, mcp:sentry",
		);
		expect(input.user).toContain(
			"- The plan and the plan bank — treat as unknown, not empty.",
		);
		expect(input.user).toContain(
			"- Your other chats — treat as unknown, not empty.",
		);
		expect(input.user).toContain("- Run the tests.");
		expect(unreadSources(manifest, facts)).toEqual(["history", "plan"]);
		expect(input.system).toContain(
			"kind is one of: fix_failure, continue, next_step, verify, review_diff, wrap_up, commit, check_ci, reply_review.",
		);
		expect(input.system).toContain(
			"reply_review: ask the agent to answer review comments on the pull request; the person reads it before it is sent",
		);
	});

	test("plan mode asks for planning prompts", () => {
		expect(plannerSystemPrompt(CORE_KINDS, "plan")).toContain(
			"The chat is in plan mode",
		);
		expect(plannerSystemPrompt(CORE_KINDS, "act")).not.toContain("plan mode");
	});
});

describe("the planner's output", () => {
	test("keeps good rows, drops kinds this environment does not offer, and marks outward ones", () => {
		const text = `Sure! {"suggestions":[
			{"kind":"verify","source":"turn","prompt":"Run   bun test src/retry.test.ts","why":"retry.ts changed"},
			{"kind":"check_ci","source":"connector","prompt":"Check CI on the PR for this branch.","why":"pushed"},
			{"kind":"reply_review","source":"connector","prompt":"Reply to the review on the retry PR.","why":"review waiting"},
			{"kind":"delete_everything","prompt":"rm -rf the repo please","why":"x"},
			{"kind":"verify","prompt":"short"},
			{"kind":"continue","source":"tasks","prompt":"Do the next task: Ship it","ref":"t1","why":"approved"}
		]}`;
		const stock = parsePlannerOutput(text, CORE_KINDS);
		expect(stock?.map((row) => row.kind)).toEqual(["verify", "continue"]);
		expect(stock?.[0]?.prompt).toBe("Run bun test src/retry.test.ts");
		expect(stock?.[1]).toMatchObject({ source: "tasks", ref: "t1" });
		const github = parsePlannerOutput(
			text,
			offerableKinds({ capabilities: ["github"] }),
		);
		expect(github?.find((row) => row.kind === "reply_review")?.outward).toBe(
			true,
		);
		expect(
			github?.find((row) => row.kind === "check_ci")?.outward,
		).toBeUndefined();
		expect(parsePlannerOutput("no json here", CORE_KINDS)).toBeNull();
		expect(parsePlannerOutput('{"suggestions":[]}', CORE_KINDS)).toBeNull();
	});

	test("blocking rows lead, a failed turn's fix comes next on the first set only, then the model, then the rules", () => {
		const blocking = suggestion(
			"fix_failure",
			"status",
			"Unblock auth: schema",
			"blocked",
			{ ref: "auth" },
		);
		const review = suggestion("review_diff", "turn", REVIEW_PROMPT, "changed");
		const pool = [
			suggestion("verify", "model", "Run the retry tests.", "changed"),
			suggestion("wrap_up", "model", "Summarize the retry work.", "done"),
		];
		const failed: TurnFacts = {
			status: "completed",
			filesEdited: 1,
			toolErrored: true,
		};
		const first = buildModelSet({
			pool,
			rules: [blocking, review],
			turn: failed,
			excluded: [],
		});
		expect(first.map((row) => row.prompt)).toEqual([
			"Unblock auth: schema",
			"Fix the failure from the last turn and run it again.",
			"Run the retry tests.",
		]);
		const later = buildModelSet({
			pool,
			rules: [blocking, review],
			turn: failed,
			excluded: ["Run the retry tests."],
		});
		expect(later.map((row) => row.prompt)).toEqual([
			"Unblock auth: schema",
			"Summarize the retry work.",
			REVIEW_PROMPT,
		]);
	});
});
