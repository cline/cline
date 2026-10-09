import { describe, expect, it } from "vitest";
import {
	FIXTURE_STEPS,
	FIXTURE_TOOLS,
	type FixtureStep,
	recordFixtureSession,
} from "./replay.fixtures";
import {
	assertNoSessionReplayDivergence,
	buildSessionReplayComparableIterations,
	compareSessionReplaySessions,
	formatSessionReplayDivergence,
	SESSION_REPLAY_RERUN_DIVERGENCE_KINDS,
	SessionReplayDivergenceError,
} from "./replay-compare";

function steps(edit: (copy: FixtureStep[]) => void): FixtureStep[] {
	const copy = structuredClone(FIXTURE_STEPS);
	edit(copy);
	return copy;
}

function kindsByIteration(
	report: ReturnType<typeof compareSessionReplaySessions>,
) {
	return report.divergences.map((divergence) => [
		divergence.iteration,
		divergence.kind,
	]);
}

describe("buildSessionReplayComparableIterations", () => {
	it("projects requests, outputs and decisions around each model call", async () => {
		const session = await recordFixtureSession();
		const iterations = buildSessionReplayComparableIterations(session);
		expect(iterations).toHaveLength(3);
		const [first] = iterations;
		expect(first).toMatchObject({
			index: 1,
			modelCall: { callIndex: 0, iteration: 1, attempt: 0 },
			assistantText: "Listing files.",
			toolCalls: [
				{ id: "call_ls", name: "run_commands", input: { commands: ["ls"] } },
			],
			toolResults: [{ toolCallId: "call_ls", content: "notes.txt" }],
		});
		expect(first?.request).toMatchObject({
			model: "fake-model",
			systemPrompt: "You are a test agent.",
			messages: [{ role: "user" }],
		});
		expect(first?.request?.tools?.map((tool) => tool.name)).toEqual([
			"read_files",
			"run_commands",
		]);
		expect(
			first?.decisions.beforeModelCall.map((decision) => decision.name),
		).toEqual(["prompt_delivered"]);
		expect(first?.decisions.afterModelCall).toEqual([
			expect.objectContaining({
				name: "approval_resolved",
				fields: {
					toolName: "run_commands",
					approved: true,
					decidedBy: { kind: "client" },
				},
			}),
		]);
		expect(iterations[2]?.request?.messages.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"assistant",
			"tool",
		]);
	});
});

describe("compareSessionReplaySessions", () => {
	it("reports no divergence for identical recordings", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(FIXTURE_STEPS, {
			sessionId: "sess_other",
		});
		const report = compareSessionReplaySessions(recorded, live);
		expect(report).toMatchObject({
			strictness: "strict",
			iterations: { recorded: 3, live: 3 },
			divergences: [],
			first: null,
			diverged: false,
			failed: false,
			warnings: [],
		});
		expect(report.perIteration).toEqual([
			{ iteration: 1, kinds: [], counted: false },
			{ iteration: 2, kinds: [], counted: false },
			{ iteration: 3, kinds: [], counted: false },
		]);
		expect(() => assertNoSessionReplayDivergence(report)).not.toThrow();
	});

	it("reports a changed system prompt with its position and excerpts", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(FIXTURE_STEPS, {
			systemPrompt: "You are a test agent.\nAlways answer in French.",
		});
		const report = compareSessionReplaySessions(recorded, live);
		expect(kindsByIteration(report)).toEqual([
			[1, "request-system-prompt"],
			[2, "request-system-prompt"],
			[3, "request-system-prompt"],
		]);
		expect(report.first).toMatchObject({
			kind: "request-system-prompt",
			iteration: 1,
			counted: true,
			summary: "system prompt differs at line 1, column 22",
			entries: [
				{
					label: "system prompt",
					change: "changed",
					recorded: {
						sha256: recorded.requests[0]?.request.systemPromptSha256,
						excerpt: "You are a test agent.",
					},
					live: { excerpt: "You are a test agent. Always answer in French." },
				},
			],
		});
		expect(report.failed).toBe(true);
	});

	it("reports changed, added and removed tool definitions", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(FIXTURE_STEPS, {
			tools: [
				{
					...(FIXTURE_TOOLS[1] as (typeof FIXTURE_TOOLS)[number]),
					description: "Run shell commands in a sandbox.",
				},
				{ name: "web_fetch", description: "Fetch a URL.", inputSchema: {} },
			],
		});
		const report = compareSessionReplaySessions(recorded, live);
		expect(report.first?.kind).toBe("request-tools");
		expect(report.first?.iteration).toBe(1);
		expect(
			report.first?.entries.map((entry) => [
				entry.label,
				entry.change,
				entry.path,
			]),
		).toEqual([
			["tool read_files", "removed", undefined],
			["tool run_commands", "changed", "description"],
			["tool web_fetch", "added", undefined],
		]);
		expect(report.first?.entries[1]?.live?.excerpt).toBe(
			"Run shell commands in a sandbox.",
		);
	});

	it("reports a changed model id", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(FIXTURE_STEPS, {
			model: "other-model",
		});
		const report = compareSessionReplaySessions(recorded, live);
		expect(report.first).toMatchObject({
			kind: "request-model",
			iteration: 1,
			summary: "model differs: recorded fake-model, live other-model",
		});
	});

	it("reports a changed user message at the first differing path", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(
			steps((copy) => {
				if (copy[0]) copy[0].prompt = "List the files and read todo.txt";
			}),
		);
		const report = compareSessionReplaySessions(recorded, live);
		expect(report.first).toMatchObject({
			kind: "request-messages",
			iteration: 1,
			entries: [
				{
					label: "message 1 (user)",
					change: "changed",
					path: "content[0].text",
					inherited: false,
					recorded: { excerpt: "List the files and read notes.txt" },
					live: { excerpt: "List the files and read todo.txt" },
				},
			],
		});
		expect(report.first?.entries[0]?.recorded?.sha256).toMatch(
			/^[0-9a-f]{64}$/,
		);
	});

	it("reports assistant text once, without resurfacing it in later requests", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(
			steps((copy) => {
				if (copy[0]) copy[0].text = "Let me list the files.";
			}),
		);
		const report = compareSessionReplaySessions(recorded, live);
		expect(kindsByIteration(report)).toEqual([[1, "assistant-text"]]);
		expect(report.first?.summary).toBe(
			"assistant text differs at line 1, column 2",
		);

		const withInherited = compareSessionReplaySessions(recorded, live, {
			includeInheritedMessages: true,
		});
		expect(kindsByIteration(withInherited)).toEqual([
			[1, "assistant-text"],
			[2, "request-messages"],
			[3, "request-messages"],
		]);
		expect(withInherited.divergences[1]?.entries).toMatchObject([
			{ label: "message 2 (assistant)", change: "changed", inherited: true },
		]);
	});

	it("lets the caller choose which kinds count", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(
			steps((copy) => {
				if (copy[2]) copy[2].text = "Your notes mention milk.";
			}),
		);
		const tolerant = compareSessionReplaySessions(recorded, live, {
			kinds: SESSION_REPLAY_RERUN_DIVERGENCE_KINDS,
		});
		expect(tolerant).toMatchObject({
			diverged: false,
			failed: false,
			first: null,
			divergences: [{ kind: "assistant-text", iteration: 3, counted: false }],
		});
		expect(tolerant.kinds).not.toContain("assistant-text");
		expect(tolerant.perIteration[2]).toEqual({
			iteration: 3,
			kinds: ["assistant-text"],
			counted: false,
		});
		const strict = compareSessionReplaySessions(recorded, live);
		expect(strict.failed).toBe(true);
	});

	it("reports tool call names and arguments by position", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(
			steps((copy) => {
				const call = copy[0]?.toolCalls?.[0];
				if (call) call.input = { commands: ["ls -la"] };
			}),
		);
		const report = compareSessionReplaySessions(recorded, live);
		expect(report.first).toMatchObject({
			kind: "tool-calls",
			iteration: 1,
			summary:
				"tool calls differ: tool call 1 (run_commands) changed at input.commands[0]",
			entries: [
				{
					label: "tool call 1 (run_commands)",
					path: "input.commands[0]",
					recorded: { excerpt: '"ls"' },
					live: { excerpt: '"ls -la"' },
				},
			],
		});
	});

	it("ignores field order in tool call arguments", async () => {
		const input = { paths: ["a"], limit: 5 };
		const reordered = { limit: 5, paths: ["a"] };
		const call = { id: "c1", name: "read_files", result: "x" };
		const recorded = await recordFixtureSession([
			{ text: "Read.", toolCalls: [{ ...call, input }] },
			{ text: "Done." },
		]);
		const live = await recordFixtureSession([
			{ text: "Read.", toolCalls: [{ ...call, input: reordered }] },
			{ text: "Done." },
		]);
		expect(recorded.requests[1]?.request.matchKey).not.toBe(
			live.requests[1]?.request.matchKey,
		);
		expect(compareSessionReplaySessions(recorded, live).divergences).toEqual(
			[],
		);
	});

	it("reports tool result content and error flags", async () => {
		const recorded = await recordFixtureSession();
		const changedContent = await recordFixtureSession(
			steps((copy) => {
				const call = copy[1]?.toolCalls?.[0];
				if (call) call.result = "remember the eggs";
			}),
		);
		const content = compareSessionReplaySessions(recorded, changedContent);
		expect(content.first).toMatchObject({
			kind: "tool-results",
			iteration: 2,
			entries: [
				{
					label: "tool result 1 (read_files)",
					path: "content",
					recorded: { excerpt: "remember the milk" },
					live: { excerpt: "remember the eggs" },
				},
			],
		});

		const failed = await recordFixtureSession(
			steps((copy) => {
				const call = copy[0]?.toolCalls?.[0];
				if (call) call.isError = true;
			}),
		);
		const flag = compareSessionReplaySessions(recorded, failed);
		expect(flag.first).toMatchObject({
			kind: "tool-results",
			iteration: 1,
			entries: [{ path: "isError", live: { excerpt: "error: notes.txt" } }],
		});
	});

	it("reports decisions and ignores their timing and ids", async () => {
		const recorded = await recordFixtureSession();
		const slower = await recordFixtureSession(
			steps((copy) => {
				const decision = copy[0]?.decisionsAfter?.[0];
				if (decision?.payload) {
					decision.payload.waitMs = 9_000;
					decision.payload.decidedBy = { kind: "client", id: "client_2" };
				}
			}),
		);
		expect(compareSessionReplaySessions(recorded, slower).divergences).toEqual(
			[],
		);
		const denied = await recordFixtureSession(
			steps((copy) => {
				const decision = copy[0]?.decisionsAfter?.[0];
				if (decision?.payload) decision.payload.approved = false;
			}),
		);
		const report = compareSessionReplaySessions(recorded, denied);
		expect(report.first).toMatchObject({
			kind: "decisions",
			iteration: 1,
			phase: "after-model-call",
			entries: [
				{
					label: "decision 1 (approval_resolved)",
					path: "payload.approved",
					recorded: { excerpt: "approved run_commands by client after 120ms" },
					live: { excerpt: "denied run_commands by client after 120ms" },
				},
			],
		});
	});

	it("reports a different number of iterations", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession([
			...FIXTURE_STEPS,
			{ prompt: "Anything else?", text: "No." },
		]);
		const report = compareSessionReplaySessions(recorded, live);
		expect(kindsByIteration(report)).toEqual([[4, "iteration-count"]]);
		expect(report.first?.summary).toBe("recorded has 3 iterations, live has 4");
		expect(report.perIteration.at(-1)).toEqual({
			iteration: 4,
			kinds: ["iteration-count"],
			counted: true,
		});
	});

	it("never fails in lenient mode, and throws for strict reports", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(FIXTURE_STEPS, {
			systemPrompt: "Changed.",
		});
		const lenient = compareSessionReplaySessions(recorded, live, {
			strictness: "lenient",
		});
		expect(lenient).toMatchObject({ diverged: true, failed: false });
		expect(() => assertNoSessionReplayDivergence(lenient)).not.toThrow();
		const strict = compareSessionReplaySessions(recorded, live);
		expect(() => assertNoSessionReplayDivergence(strict)).toThrow(
			SessionReplayDivergenceError,
		);
		expect(() => assertNoSessionReplayDivergence(strict)).toThrow(
			/Replay diverged from the recording at iteration 1 \(request-system-prompt\)/,
		);
	});

	it("skips request kinds with a warning when a side was not recorded", async () => {
		const recorded = await recordFixtureSession();
		const unrecorded = {
			...(await recordFixtureSession(FIXTURE_STEPS, {
				systemPrompt: "Changed.",
			})),
			requests: [],
			blobs: new Map(),
		};
		const report = compareSessionReplaySessions(recorded, unrecorded);
		expect(report.divergences).toEqual([]);
		expect(report.warnings).toEqual([
			"request comparison skipped for 3 of 3 iterations: no recorded request on one side (record sessions with --record-session)",
		]);
	});

	it("skips decisions with a warning when a side recorded none", async () => {
		const denied = await recordFixtureSession(
			steps((copy) => {
				const decision = copy[0]?.decisionsAfter?.[0];
				if (decision?.payload) decision.payload.approved = false;
			}),
		);
		const unrecorded = {
			...(await recordFixtureSession()),
			requests: [],
			blobs: new Map(),
			events: [],
		};
		expect(
			buildSessionReplayComparableIterations(unrecorded)[0]?.decisionsRecorded,
		).toBe(false);
		expect(
			buildSessionReplayComparableIterations(denied)[0],
		).not.toHaveProperty("decisionsRecorded");
		const report = compareSessionReplaySessions(denied, unrecorded);
		expect(report.divergences).toEqual([]);
		expect(report.warnings).toEqual([
			"request comparison skipped for 3 of 3 iterations: no recorded request on one side (record sessions with --record-session)",
			"decision comparison skipped for 3 of 3 iterations: no recorded decisions on one side (record sessions with --record-session)",
		]);
	});

	it("compares tool results by text when a side was imported from ATIF", async () => {
		const recorded = await recordFixtureSession();
		const asTextBlocks = (
			session: typeof recorded,
			edit: (text: string) => string = (text) => text,
		) => ({
			...session,
			transcript: {
				...session.transcript,
				messages: session.transcript.messages.map((message) =>
					Array.isArray(message.content)
						? {
								...message,
								content: message.content.map((block) =>
									block.type === "tool_result" &&
									typeof block.content === "string"
										? {
												...block,
												content: [
													{ type: "text" as const, text: edit(block.content) },
												],
											}
										: block,
								),
							}
						: message,
				),
			},
		});
		const structured = asTextBlocks(recorded);
		expect(
			kindsByIteration(compareSessionReplaySessions(recorded, structured)),
		).toEqual([
			[1, "tool-results"],
			[2, "tool-results"],
		]);

		const imported = { ...recorded, entry: { source: "atif-import" } };
		expect(
			buildSessionReplayComparableIterations(imported)[0]?.toolResultsAs,
		).toBe("text");
		const byText = compareSessionReplaySessions(imported, structured);
		expect(byText.divergences).toEqual([]);
		expect(byText.warnings).toContain(
			"tool results compared by text: one side was imported from a trajectory that keeps only their text",
		);

		const changed = asTextBlocks(recorded, (text) =>
			text === "remember the milk" ? "remember the eggs" : text,
		);
		expect(compareSessionReplaySessions(imported, changed).first).toMatchObject(
			{
				kind: "tool-results",
				iteration: 2,
				entries: [
					{
						path: "text",
						recorded: { excerpt: "remember the milk" },
						live: { excerpt: "remember the eggs" },
					},
				],
			},
		);
	});
});

describe("formatSessionReplayDivergence", () => {
	it("prints the location, short hashes and excerpts", async () => {
		const recorded = await recordFixtureSession();
		const live = await recordFixtureSession(FIXTURE_STEPS, {
			systemPrompt: "You are a changed test agent.",
		});
		const report = compareSessionReplaySessions(recorded, live);
		const lines = formatSessionReplayDivergence(
			report.first as NonNullable<typeof report.first>,
		);
		const recordedSha = recorded.requests[0]?.request.systemPromptSha256;
		const liveSha = live.requests[0]?.request.systemPromptSha256;
		expect(lines).toEqual([
			"iteration 1 · request-system-prompt · system prompt differs at line 1, column 11",
			"  system prompt changed",
			`    - recorded ${recordedSha?.slice(0, 12)} You are a test agent.`,
			`    + live     ${liveSha?.slice(0, 12)} You are a changed test agent.`,
		]);
	});
});
