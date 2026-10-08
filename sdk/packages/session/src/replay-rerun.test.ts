import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentResult,
	ClineCoreStartInput,
	CoreSessionEvent,
	StartSessionResult,
} from "@cline/core";
import type {
	AgentEvent,
	MessageWithMetadata,
	ToolApprovalRequest,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FIXTURE_STEPS,
	type FixtureStep,
	recordFixtureSession,
} from "./replay.fixtures";
import {
	collectSessionReplayRerunTurns,
	createSessionReplayRerun,
	parseSessionReplayDivergenceKinds,
	resolveSessionReplayRerunKinds,
	type SessionReplayRerun,
	type SessionReplayRerunCore,
	SessionReplayRerunOptionError,
} from "./replay-rerun";

const READ_DIFFERENT: FixtureStep = {
	text: "Reading notes.",
	toolCalls: [
		{
			id: "call_read",
			name: "read_files",
			input: { paths: ["todo.txt"] },
			result: "nothing here",
		},
	],
};

/**
 * A ClineCore stand-in: writes a real recording of `steps` where the hub
 * would, then emits the agent events a hub client sees for them and asks
 * for approval of `run_commands` calls, honouring abort between events.
 */
function fakeCore(input: {
	steps: readonly FixtureStep[];
	sessionsDir: string;
	rerun: () => SessionReplayRerun;
}): SessionReplayRerunCore & {
	aborted: boolean;
	emitted: AgentEvent[];
	started: ClineCoreStartInput[];
} {
	const listeners = new Set<(event: CoreSessionEvent) => void>();
	let messages: MessageWithMetadata[] = [];
	const core = {
		aborted: false,
		emitted: [] as AgentEvent[],
		started: [] as ClineCoreStartInput[],
		subscribe(listener: (event: CoreSessionEvent) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async readMessages() {
			return messages;
		},
		async abort() {
			core.aborted = true;
		},
		async send(): Promise<AgentResult | undefined> {
			throw new Error("not used");
		},
		async start(start: ClineCoreStartInput): Promise<StartSessionResult> {
			core.started.push(start);
			const sessionId = start.config.sessionId ?? "sess_live";
			const recorded = await recordFixtureSession(input.steps, {
				sessionId,
				sessionDir: join(input.sessionsDir, sessionId),
			});
			messages = recorded.transcript.messages;
			const emit = (event: AgentEvent) => {
				core.emitted.push(event);
				for (const listener of listeners) {
					listener({ type: "agent_event", payload: { sessionId, event } });
				}
			};
			let finishReason = "completed";
			run: for (const [position, step] of input.steps.entries()) {
				emit({ type: "iteration_start", iteration: position + 1 });
				for (const call of step.toolCalls ?? []) {
					if (core.aborted) break run;
					if (call.name === "run_commands") {
						await input.rerun().requestToolApproval({
							sessionId,
							agentId: "agent_1",
							conversationId: "conv_1",
							iteration: position + 1,
							toolCallId: call.id,
							toolName: call.name,
							input: call.input,
							policy: { autoApprove: false },
						} as ToolApprovalRequest);
					}
					emit({
						type: "content_start",
						contentType: "tool",
						toolCallId: call.id,
						toolName: call.name,
						input: call.input,
					});
				}
				if (core.aborted) break;
				emit({
					type: "iteration_end",
					iteration: position + 1,
					hadToolCalls: (step.toolCalls?.length ?? 0) > 0,
					toolCallCount: step.toolCalls?.length ?? 0,
				});
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			if (core.aborted) finishReason = "aborted";
			return {
				sessionId,
				manifest: {} as StartSessionResult["manifest"],
				manifestPath: "",
				messagesPath: "",
				result: { finishReason } as AgentResult,
			};
		},
	};
	return core;
}

describe("session replay rerun", () => {
	let sessionsDir: string;

	beforeEach(() => {
		sessionsDir = mkdtempSync(join(tmpdir(), "replay-rerun-"));
	});

	afterEach(() => {
		rmSync(sessionsDir, { recursive: true, force: true });
	});

	async function rerunWith(
		liveSteps: readonly FixtureStep[],
		options: {
			untilDivergence?: boolean;
			decideApproval?: Parameters<
				typeof createSessionReplayRerun
			>[0]["decideApproval"];
			recordedSteps?: readonly FixtureStep[];
		} = {},
	) {
		const recorded = await recordFixtureSession(
			options.recordedSteps ?? FIXTURE_STEPS,
		);
		const rerun = createSessionReplayRerun({
			recorded,
			...(options.untilDivergence ? { untilDivergence: true } : {}),
			...(options.decideApproval
				? { decideApproval: options.decideApproval }
				: {}),
		});
		const core = fakeCore({
			steps: liveSteps,
			sessionsDir,
			rerun: () => rerun,
		});
		const progress: string[] = [];
		const result = await rerun.run({
			core,
			start: {
				config: {
					providerId: "openai-compatible",
					modelId: "fake-model",
					cwd: "/w",
					systemPrompt: recorded.transcript.systemPrompt,
				} as ClineCoreStartInput["config"],
			},
			sessionsDir,
			pollMs: 10,
			flushTimeoutMs: 2_000,
			onProgress: (event) =>
				progress.push(
					event.type === "iteration"
						? `iteration ${event.iteration}${event.counted ? " diverged" : ""}`
						: event.type === "stopped"
							? `stopped ${event.iteration} ${event.divergence.kind}`
							: event.type,
				),
		});
		return { result, core, progress };
	}

	it("reports no divergence when the live run repeats the recording", async () => {
		const { result, core, progress } = await rerunWith(FIXTURE_STEPS);
		expect(result.comparison.divergences.filter((d) => d.counted)).toEqual([]);
		expect(result.comparison.diverged).toBe(false);
		expect(result.comparison.iterations).toEqual({ recorded: 3, live: 3 });
		expect(result.stopped).toBeNull();
		expect(result.turns).toEqual({ recorded: 1, sent: 1 });
		expect(result.finishReason).toBe("completed");
		expect(result.matches.map((match) => match.match)).toEqual([
			"exact",
			"exact",
			"exact",
		]);
		expect(result.approvals).toEqual([
			{
				iteration: 1,
				toolName: "run_commands",
				toolCallId: "call_ls",
				approved: true,
				source: "recording",
				recordedSeq: expect.any(Number),
			},
		]);
		expect(progress).toContain("iteration 3");
		expect(progress).not.toContain("stopped");
		const [started] = core.started;
		expect(started?.config.recording).toEqual({ enabled: true });
		expect(started?.prompt).toBe("List the files and read notes.txt");
		expect(started?.interactive).toBe(false);
		expect(core.aborted).toBe(false);
	});

	it("stops at the first differing tool call with untilDivergence", async () => {
		const { result, core, progress } = await rerunWith(
			[
				FIXTURE_STEPS[0] as FixtureStep,
				READ_DIFFERENT,
				FIXTURE_STEPS[2] as FixtureStep,
			],
			{ untilDivergence: true },
		);
		expect(core.aborted).toBe(true);
		expect(result.stopped).toEqual({
			reason: "until-divergence",
			iteration: 2,
			kind: "tool-calls",
		});
		expect(result.finishReason).toBe("aborted");
		expect(result.comparison.first).toMatchObject({
			kind: "tool-calls",
			iteration: 2,
			counted: true,
		});
		expect(result.comparison.first?.entries[0]).toMatchObject({
			label: "tool call 1 (read_files)",
			path: "input.paths[0]",
		});
		expect(result.comparison.perIteration.map((row) => row.iteration)).toEqual([
			1, 2,
		]);
		expect(progress).toContain("stopped 2 tool-calls");
		expect(
			core.emitted.filter((event) => event.type === "iteration_start"),
		).toHaveLength(2);
	});

	it("runs to the end by default and reports every iteration", async () => {
		const { result, core } = await rerunWith([
			FIXTURE_STEPS[0] as FixtureStep,
			READ_DIFFERENT,
			FIXTURE_STEPS[2] as FixtureStep,
		]);
		expect(core.aborted).toBe(false);
		expect(result.stopped).toBeNull();
		expect(result.comparison.first).toMatchObject({
			kind: "tool-calls",
			iteration: 2,
		});
		const counted = result.comparison.divergences.filter((d) => d.counted);
		expect(counted.map((d) => `${d.iteration}:${d.kind}`)).toEqual([
			"2:tool-calls",
			"2:tool-results",
		]);
		expect(result.comparison.failed).toBe(true);
	});

	it("counts a live iteration beyond the recording", async () => {
		const { result } = await rerunWith(
			[...FIXTURE_STEPS, { text: "One more thing." }],
			{ untilDivergence: true },
		);
		expect(result.stopped).toMatchObject({
			iteration: 4,
			kind: "iteration-count",
		});
		expect(result.comparison.first?.kind).toBe("iteration-count");
	});

	it("denies an approval the recording does not have", async () => {
		const recordedSteps = FIXTURE_STEPS.map((step) => ({
			...step,
			decisionsAfter: [],
		}));
		const { result } = await rerunWith(FIXTURE_STEPS, { recordedSteps });
		expect(result.approvals).toMatchObject([
			{ toolName: "run_commands", approved: false, source: "no-recording" },
		]);
	});

	it("asks instead of answering from the recording with decideApproval", async () => {
		const asked: unknown[] = [];
		const { result } = await rerunWith(FIXTURE_STEPS, {
			decideApproval: async (prompt) => {
				asked.push(prompt.recorded);
				return { approved: false, reason: "no" };
			},
		});
		expect(asked).toEqual([{ approved: true, iteration: 1 }]);
		expect(result.approvals).toMatchObject([
			{ approved: false, reason: "no", source: "interactive" },
		]);
	});
});

describe("collectSessionReplayRerunTurns", () => {
	it("pairs each user turn with its recorded delivery", async () => {
		const recorded = await recordFixtureSession([
			...FIXTURE_STEPS,
			{
				prompt: '<user_input mode="plan">Now plan the cleanup</user_input>',
				text: "Planning.",
				decisionsBefore: [
					{
						name: "prompt_delivered",
						payload: { delivery: "immediate", source: "send", mode: "plan" },
					},
				],
			},
		]);
		const { turns, warnings } = collectSessionReplayRerunTurns(recorded);
		expect(turns).toEqual([
			{
				iteration: 1,
				prompt: "List the files and read notes.txt",
				source: "start",
				attachments: 0,
			},
			{
				iteration: 4,
				prompt: '<user_input mode="plan">Now plan the cleanup</user_input>',
				source: "send",
				mode: "plan",
				attachments: 0,
			},
		]);
		expect(warnings).toEqual([]);
	});

	it("sends a mode only when the recorded delivery carried one", async () => {
		const recorded = await recordFixtureSession([
			{
				...(FIXTURE_STEPS[0] as FixtureStep),
				prompt: '<user_input mode="yolo">Run echo for me</user_input>',
				decisionsBefore: [
					{
						name: "prompt_delivered",
						payload: { delivery: "immediate", source: "send" },
					},
				],
			},
		]);
		const [turn] = collectSessionReplayRerunTurns(recorded).turns;
		expect(turn).toMatchObject({ source: "send" });
		expect(turn?.mode).toBeUndefined();
	});

	it("warns about steered prompts it does not replay", async () => {
		const recorded = await recordFixtureSession([
			{
				...(FIXTURE_STEPS[0] as FixtureStep),
				decisionsAfter: [
					{ name: "prompt_delivered", payload: { delivery: "steer" } },
				],
			},
		]);
		expect(collectSessionReplayRerunTurns(recorded).warnings[0]).toMatch(
			/1 steered prompt was not replayed/,
		);
	});
});

describe("rerun divergence kinds", () => {
	it("defaults to every kind but assistant text", () => {
		const { kinds, requestMatching } = resolveSessionReplayRerunKinds();
		expect(requestMatching).toBe("strict");
		expect(kinds).toContain("request-model");
		expect(kinds).toContain("tool-calls");
		expect(kinds).not.toContain("assistant-text");
	});

	it("relaxes request matching to messages and tools for a model override", () => {
		const { kinds, requestMatching } = resolveSessionReplayRerunKinds({
			modelOverride: true,
		});
		expect(requestMatching).toBe("relaxed");
		expect(kinds).not.toContain("request-model");
		expect(kinds).not.toContain("request-system-prompt");
		expect(kinds).toContain("request-tools");
		expect(kinds).toContain("request-messages");
	});

	it("stops counting request kinds when lenient", () => {
		const { kinds, requestMatching } = resolveSessionReplayRerunKinds({
			lenient: true,
		});
		expect(requestMatching).toBe("lenient");
		expect(kinds).toEqual([
			"tool-calls",
			"tool-results",
			"decisions",
			"iteration-count",
		]);
	});

	it("applies --ignore and --count, with --count winning over relaxations", () => {
		const { kinds } = resolveSessionReplayRerunKinds({
			ignore: "decisions,tool-results",
			count: "assistant-text,request-system-prompt",
			modelOverride: true,
		});
		expect(kinds).toEqual([
			"request-system-prompt",
			"request-tools",
			"request-messages",
			"assistant-text",
			"tool-calls",
			"iteration-count",
		]);
	});

	it("rejects unknown kinds and kinds both ignored and counted", () => {
		expect(() =>
			parseSessionReplayDivergenceKinds("tools", "--ignore"),
		).toThrow(/Unknown divergence kind "tools" in --ignore/);
		expect(parseSessionReplayDivergenceKinds(" request ,", "--ignore")).toEqual(
			[
				"request-model",
				"request-system-prompt",
				"request-tools",
				"request-messages",
			],
		);
		expect(() =>
			resolveSessionReplayRerunKinds({
				ignore: "tool-calls",
				count: "tool-calls",
			}),
		).toThrow(SessionReplayRerunOptionError);
	});
});
