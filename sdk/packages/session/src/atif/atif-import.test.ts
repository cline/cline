import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readSessionReplayBundle,
	validateSessionReplayBundle,
} from "../bundle-io";
import { buildSessionReplayIterations } from "../bundle-iterations";
import {
	ATIF_IMPORT_REPORT_FILE,
	AtifImportError,
	importAtifTrajectory,
	importAtifTrajectoryToBundle,
} from "./atif-import";
import type { AtifStep, AtifTrajectory } from "./atif-types";

const NOW = new Date("2026-02-01T00:00:00.000Z");

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "atif-import-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function trajectory(
	steps: AtifStep[],
	overrides: Partial<AtifTrajectory> = {},
): AtifTrajectory {
	return {
		schema_version: "ATIF-v1.7",
		session_id: "foreign-session",
		agent: { name: "other-agent", version: "1.2.3", model_name: "gpt-x" },
		steps,
		...overrides,
	};
}

function importSteps(value: AtifTrajectory) {
	return importAtifTrajectory(value, { now: () => NOW });
}

function texts(message: MessageWithMetadata | undefined): string[] {
	if (!message || typeof message.content === "string") {
		return message ? [message.content as string] : [];
	}
	return message.content.flatMap((block) =>
		block.type === "text" ? [block.text] : [],
	);
}

describe("importAtifTrajectory from a foreign trajectory", () => {
	it("maps system, user and agent steps to a replayable session", async () => {
		const value = trajectory([
			{
				step_id: 1,
				source: "system",
				timestamp: "2026-01-05T10:00:00Z",
				message: "You are a careful agent.",
			},
			{
				step_id: 2,
				source: "user",
				timestamp: "2026-01-05T10:00:01Z",
				message: "Create hello.txt",
			},
			{
				step_id: 3,
				source: "agent",
				timestamp: "2026-01-05T10:00:03Z",
				model_name: "gpt-x-mini",
				message: "Creating the file.",
				reasoning_content: "A single command does it.",
				tool_calls: [
					{
						tool_call_id: "call_1",
						function_name: "bash",
						arguments: { command: "echo hi > hello.txt" },
					},
				],
				observation: {
					results: [{ source_call_id: "call_1", content: "" }],
				},
				metrics: {
					prompt_tokens: 120,
					completion_tokens: 15,
					cached_tokens: 100,
					cost_usd: 0.002,
					extra: { cache_creation_input_tokens: 7 },
				},
			},
			{
				step_id: 4,
				source: "agent",
				timestamp: "2026-01-05T10:00:04Z",
				message: "Done.",
				metrics: { prompt_tokens: 140, completion_tokens: 3 },
			},
		]);
		const { bundle, report } = importSteps(value);

		expect(report).toMatchObject({
			format: "cline.atif-import-report",
			schemaVersion: "ATIF-v1.7",
			rootSessionId: "foreign-session",
			agent: { name: "other-agent", version: "1.2.3" },
			restored: "steps",
			unmapped: [],
			assumptions: [],
			warnings: [],
			sessions: [
				{
					sessionId: "foreign-session",
					parentSessionId: null,
					steps: 4,
					messages: 4,
				},
			],
		});
		expect(bundle.rootSessionId).toBe("foreign-session");
		expect(bundle.producer.name).toBe("@cline/session");
		expect(bundle.createdAt).toBe(NOW.toISOString());
		expect(bundle.redaction.enabled).toBe(false);
		expect(bundle.redaction.notCovered.at(-1)).toContain(
			"Imported from an ATIF trajectory",
		);
		const [session] = bundle.sessions;
		expect(session?.entry).toMatchObject({
			sessionId: "foreign-session",
			role: "root",
			parentSessionId: null,
			source: "atif-import",
			status: "completed",
			startedAt: "2026-01-05T10:00:00.000Z",
			endedAt: "2026-01-05T10:00:04.000Z",
			provider: "",
			model: "gpt-x",
			eventsSource: "none",
			recording: null,
			metadata: {
				atif: {
					schemaVersion: "ATIF-v1.7",
					sessionId: "foreign-session",
					agent: { name: "other-agent", version: "1.2.3" },
				},
			},
		});
		expect(session?.events).toEqual([]);
		expect(session?.transcript.systemPrompt).toBe("You are a careful agent.");
		const messages = session?.transcript.messages ?? [];
		expect(
			messages.map((message) => [
				message.id,
				message.role,
				message.iteration,
				message.ts,
			]),
		).toEqual([
			["foreign-session:step-2", "user", 1, Date.parse("2026-01-05T10:00:01Z")],
			[
				"foreign-session:step-3",
				"assistant",
				1,
				Date.parse("2026-01-05T10:00:03Z"),
			],
			[
				"foreign-session:step-3:observation",
				"user",
				1,
				Date.parse("2026-01-05T10:00:03Z"),
			],
			[
				"foreign-session:step-4",
				"assistant",
				2,
				Date.parse("2026-01-05T10:00:04Z"),
			],
		]);
		expect(messages[1]).toMatchObject({
			content: [
				{ type: "thinking", thinking: "A single command does it." },
				{ type: "text", text: "Creating the file." },
				{
					type: "tool_use",
					id: "call_1",
					name: "bash",
					input: { command: "echo hi > hello.txt" },
				},
			],
			modelInfo: { id: "gpt-x-mini", provider: "other-agent" },
			metrics: {
				inputTokens: 120,
				outputTokens: 15,
				cacheReadTokens: 100,
				cacheWriteTokens: 7,
				cost: 0.002,
			},
			metadata: { atif: { stepId: 3, source: "agent" } },
		});
		expect(messages[2]).toMatchObject({
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_1",
					name: "bash",
					content: "",
				},
			],
			metadata: { kind: "atif_observation", userRunSpan: 0 },
		});
		expect(messages[3]?.modelInfo).toEqual({
			id: "gpt-x",
			provider: "other-agent",
		});

		const iterations = buildSessionReplayIterations({
			transcript: session?.transcript ?? { sessionId: "", messages: [] },
		});
		expect(iterations.map((iteration) => iteration.index)).toEqual([1, 2]);
		expect(iterations[0]).toMatchObject({
			turn: 1,
			prompt: { text: "Create hello.txt" },
			assistant: {
				text: "Creating the file.",
				reasoning: "A single command does it.",
			},
			toolCalls: [{ id: "call_1", name: "bash", result: { isError: false } }],
			usage: { inputTokens: 120, outputTokens: 15 },
		});

		const dir = join(root, "bundle");
		const written = await importAtifTrajectoryToBundle(value, dir, {
			now: () => NOW,
		});
		expect(written.warnings).toEqual([]);
		const loaded = await readSessionReplayBundle(dir);
		expect(loaded.manifest.sessions[0]?.counts).toEqual({
			messages: 4,
			iterations: 2,
			events: 0,
		});
		expect(
			JSON.parse(await readFile(join(dir, ATIF_IMPORT_REPORT_FILE), "utf8")),
		).toEqual(written.report);
	});

	it("rebuilds subagent trajectories as linked child sessions", async () => {
		const child = trajectory(
			[
				{ step_id: 1, source: "user", message: "Read a.txt" },
				{
					step_id: 2,
					source: "agent",
					message: "It says hi.",
					metrics: { prompt_tokens: 30, completion_tokens: 4 },
				},
			],
			{ session_id: "foreign-session", trajectory_id: "child-1" },
		);
		const unreferenced = trajectory(
			[{ step_id: 1, source: "user", message: "Side task" }],
			{ session_id: "side", trajectory_id: "child-2" },
		);
		const value = trajectory(
			[
				{ step_id: 1, source: "user", message: "Delegate reading a.txt" },
				{
					step_id: 2,
					source: "agent",
					message: "Delegating.",
					tool_calls: [
						{
							tool_call_id: "spawn_1",
							function_name: "delegate",
							arguments: { task: "Read a.txt" },
						},
					],
					observation: {
						results: [
							{
								source_call_id: "spawn_1",
								content: "It says hi.",
								subagent_trajectory_ref: [{ trajectory_id: "child-1" }],
							},
							{
								subagent_trajectory_ref: [
									{ trajectory_path: "elsewhere/child.json" },
								],
							},
						],
					},
				},
			],
			{ subagent_trajectories: [child, unreferenced] },
		);
		const { bundle, report } = importSteps(value);
		expect(
			bundle.sessions.map((session) => [
				session.entry.sessionId,
				session.entry.role,
				session.entry.parentSessionId,
			]),
		).toEqual([
			["foreign-session", "root", null],
			["foreign-session__2", "subagent", "foreign-session"],
			["side", "subagent", "foreign-session"],
		]);
		const spawn = bundle.sessions[0]?.transcript.messages[1];
		expect(spawn?.childSessions).toEqual([
			{
				toolCallId: "spawn_1",
				sessionId: "foreign-session__2",
				kind: "subagent",
			},
		]);
		expect(bundle.sessions[1]?.transcript.messages.map(texts)).toEqual([
			["Read a.txt"],
			["It says hi."],
		]);
		expect(report.unmapped).toEqual([
			{
				sessionId: "foreign-session",
				field: "subagent_trajectory_ref[].trajectory_path",
				reason: "Subagent trajectories in separate files are not loaded.",
				count: 1,
				stepIds: [2],
			},
			{
				sessionId: "foreign-session",
				field: "subagent_trajectories (not referenced)",
				reason:
					"No step references this subagent trajectory; it is linked to the session without a tool call.",
				count: 1,
			},
		]);

		const dir = join(root, "tree");
		await importAtifTrajectoryToBundle(value, dir, { now: () => NOW });
		expect((await validateSessionReplayBundle(dir)).errors).toEqual([]);
	});

	it("keeps parallel tool calls in one assistant message and matches results by call id", () => {
		const { bundle } = importSteps(
			trajectory([
				{ step_id: 1, source: "user", message: "Read both files" },
				{
					step_id: 2,
					source: "agent",
					message: "",
					tool_calls: [
						{
							tool_call_id: "a",
							function_name: "read",
							arguments: { path: "a.txt" },
						},
						{
							tool_call_id: "b",
							function_name: "read",
							arguments: { path: "b.txt" },
						},
					],
					observation: {
						results: [
							{ source_call_id: "b", content: "bee" },
							{ source_call_id: "a", content: "ay" },
						],
					},
				},
			]),
		);
		const messages = bundle.sessions[0]?.transcript.messages ?? [];
		expect(messages[1]?.content).toEqual([
			{ type: "tool_use", id: "a", name: "read", input: { path: "a.txt" } },
			{ type: "tool_use", id: "b", name: "read", input: { path: "b.txt" } },
		]);
		expect(messages[2]?.content).toEqual([
			{ type: "tool_result", tool_use_id: "b", name: "read", content: "bee" },
			{ type: "tool_result", tool_use_id: "a", name: "read", content: "ay" },
		]);
		const [iteration] = buildSessionReplayIterations({
			transcript: bundle.sessions[0]?.transcript ?? {
				sessionId: "",
				messages: [],
			},
		});
		expect(
			iteration?.toolCalls.map((call) => [call.id, call.result?.text]),
		).toEqual([
			["a", "ay"],
			["b", "bee"],
		]);
	});

	it("marks error results, keeps unattributed results as text and reports calls without results", () => {
		const { bundle, report } = importSteps(
			trajectory([
				{ step_id: 1, source: "user", message: "Try things" },
				{
					step_id: 2,
					source: "agent",
					message: "Trying.",
					tool_calls: [
						{ tool_call_id: "x", function_name: "run", arguments: {} },
						{ tool_call_id: "y", function_name: "run", arguments: {} },
					],
					observation: {
						results: [
							{
								source_call_id: "x",
								content: "permission denied",
								extra: { is_error: true },
							},
							{ content: "stray output" },
						],
					},
				},
				{
					step_id: 3,
					source: "agent",
					message: "Running the terminal.",
					tool_calls: [
						{
							tool_call_id: "t",
							function_name: "keystrokes",
							arguments: { keys: "ls\n" },
						},
					],
					observation: { results: [{ content: "a.txt b.txt" }] },
				},
				{
					step_id: 4,
					source: "system",
					message: "The harness restarted the terminal.",
				},
				{ step_id: 5, source: "agent", message: "Done." },
			]),
		);
		const messages = bundle.sessions[0]?.transcript.messages ?? [];
		expect(messages[2]?.content).toEqual([
			{
				type: "tool_result",
				tool_use_id: "x",
				name: "run",
				content: "permission denied",
				is_error: true,
			},
			{ type: "text", text: "stray output" },
		]);
		expect(messages[4]?.content).toEqual([
			{
				type: "tool_result",
				tool_use_id: "t",
				name: "keystrokes",
				content: "a.txt b.txt",
			},
		]);
		expect(messages[5]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "The harness restarted the terminal." }],
			metadata: { kind: "atif_system_step", userRunSpan: 0 },
		});
		expect(report.unmapped.map((item) => [item.field, item.stepIds])).toEqual([
			["steps[].tool_calls (without a result)", [2]],
		]);
		expect(report.assumptions).toEqual([
			{
				sessionId: "foreign-session",
				field: "observation.results[] without source_call_id",
				reason: "Attached to the step's only tool call as its result.",
				count: 1,
				stepIds: [3],
			},
		]);
		const iterations = buildSessionReplayIterations({
			transcript: bundle.sessions[0]?.transcript ?? {
				sessionId: "",
				messages: [],
			},
		});
		expect(iterations.map((iteration) => iteration.turn)).toEqual([1, 1, 1]);
		expect(iterations[2]?.injected?.map((note) => note.text)).toEqual([
			"The harness restarted the terminal.",
		]);
		expect(iterations[0]?.toolCalls[0]?.result?.isError).toBe(true);
	});

	it("replaces images with placeholders and reports values a bundle cannot hold", () => {
		const { bundle, report } = importSteps(
			trajectory(
				[
					{
						step_id: 1,
						source: "user",
						message: [
							{ type: "text", text: "What is in this picture?" },
							{
								type: "image",
								source: { media_type: "image/png", path: "images/cat.png" },
							},
						],
					},
					{
						step_id: 2,
						source: "agent",
						message: "A cat.",
						llm_call_count: 2,
						metrics: {
							prompt_tokens: 10,
							completion_tokens: 2,
							logprobs: [-0.1, -0.2],
						},
					},
				],
				{
					agent: {
						name: "other-agent",
						version: "1",
						tool_definitions: [
							{ type: "function", function: { name: "look" } },
						],
					},
					final_metrics: { total_prompt_tokens: 10 },
				},
			),
		);
		expect(bundle.sessions[0]?.transcript.messages[0]?.content).toEqual([
			{ type: "text", text: "What is in this picture?" },
			{ type: "text", text: "[image image/png: images/cat.png]" },
		]);
		expect(report.unmapped.map((item) => item.field)).toEqual([
			"image content",
			"steps[].llm_call_count",
			"steps[].metrics.logprobs",
			"agent.tool_definitions",
		]);
		expect(report.warnings).toEqual([
			"4 ATIF value(s) could not be carried into the bundle; see the import report.",
		]);
	});

	it("rejects input that is not a valid ATIF trajectory", async () => {
		expect(() => importAtifTrajectory([])).toThrow(AtifImportError);
		expect(() => importAtifTrajectory([])).toThrow(
			/The input is not a valid ATIF trajectory:\n {2}- \(root\): expected object, got array/,
		);
		try {
			importAtifTrajectory({
				schema_version: "ATIF-v9",
				agent: { name: "x", version: "1" },
				steps: [{ step_id: 2, source: "robot", message: "hi" }],
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(AtifImportError);
			expect((error as AtifImportError).issues.join("\n")).toMatch(
				/schema_version/,
			);
			expect((error as AtifImportError).issues.join("\n")).toMatch(/source/);
		}
		await expect(
			importAtifTrajectoryToBundle({ steps: [] }, join(root, "never")),
		).rejects.toBeInstanceOf(AtifImportError);
	});
});
