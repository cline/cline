import type { SessionCompactionState } from "@cline/core";
import type {
	MessageWithMetadata,
	SessionRecordedModelCall,
	SessionReplayEvent,
	SessionReplayRequestBlob,
	SessionReplaySessionEntry,
} from "@cline/shared";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import {
	FIXTURE_CHILD_SESSION_ID,
	FIXTURE_SESSION_ID,
	fixtureChildMessages,
	fixtureMessages,
	fixtureTreeMessages,
} from "../bundle.fixtures";
import type { LoadedSessionReplaySession } from "../bundle-io";
import { recordFixtureSession } from "../replay.fixtures";
import {
	type AtifExportBundle,
	exportSessionReplayBundleToAtif,
} from "./atif-export";
import type { AtifStep, AtifTrajectory } from "./atif-types";
import schema from "./atif-v1.7.schema.json";
import { validateAtifTrajectory } from "./atif-validate";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const ajvValidate = new Ajv2020({ allErrors: true, strict: true }).compile(
	schema,
);

interface SessionInput {
	entry?: Partial<SessionReplaySessionEntry>;
	messages: MessageWithMetadata[];
	systemPrompt?: string;
	events?: SessionReplayEvent[];
	compaction?: SessionCompactionState;
	requests?: SessionRecordedModelCall[];
	blobs?: Map<string, SessionReplayRequestBlob>;
}

function session(input: SessionInput): LoadedSessionReplaySession {
	const sessionId = input.entry?.sessionId ?? FIXTURE_SESSION_ID;
	return {
		entry: {
			sessionId,
			role: "root",
			parentSessionId: null,
			agentId: null,
			parentAgentId: null,
			conversationId: null,
			source: "cli",
			status: "completed",
			exitCode: 0,
			startedAt: "2026-01-01T00:00:00.000Z",
			endedAt: "2026-01-01T00:00:10.000Z",
			interactive: false,
			provider: "openai-compatible",
			model: "fake-model",
			cwd: "/w",
			workspaceRoot: "/w",
			team: null,
			checkpoints: [],
			eventsSource: "none",
			counts: { messages: input.messages.length, iterations: 0, events: 0 },
			recording: null,
			...input.entry,
		},
		transcript: {
			sessionId,
			...(input.systemPrompt !== undefined
				? { systemPrompt: input.systemPrompt }
				: {}),
			messages: input.messages,
		},
		events: input.events ?? [],
		...(input.compaction ? { compaction: input.compaction } : {}),
		requests: input.requests ?? [],
		blobs: input.blobs ?? new Map(),
	};
}

function bundle(
	sessions: LoadedSessionReplaySession[],
	options: { redacted?: boolean } = {},
): AtifExportBundle {
	return {
		manifest: {
			format: "cline.session-replay-bundle",
			schemaVersion: 2,
			createdAt: "2026-01-01T00:01:00.000Z",
			producer: {
				name: "@cline/core",
				version: "0.0.0-test",
				host: "cli",
				hostVersion: "3.0.0-test",
			},
			rootSessionId: sessions[0]?.entry.sessionId ?? FIXTURE_SESSION_ID,
			sessions: sessions.map((item) => item.entry),
			files: [],
			redaction: {
				enabled: options.redacted !== false,
				removedCount: 0,
				report: "redaction.json",
			},
		},
		sessions,
		redaction: {
			enabled: options.redacted !== false,
			ruleset: "vcr-sanitizer",
			rules: { keysExact: [], keySuffixes: [], valuePatterns: [] },
			covered: [],
			notCovered: [],
			redactions: [],
		},
		sourceSchemaVersion: 2,
	};
}

function exportValid(input: AtifExportBundle) {
	const result = exportSessionReplayBundleToAtif(input);
	const validation = validateAtifTrajectory(result.trajectory);
	expect(validation.errors).toEqual([]);
	expect(ajvValidate(result.trajectory)).toBe(true);
	return result;
}

function cline(
	step: AtifStep | AtifTrajectory | undefined,
): Record<string, unknown> {
	return ((step?.extra as { cline?: Record<string, unknown> } | undefined)
		?.cline ?? {}) as Record<string, unknown>;
}

function stripNewFields(
	messages: MessageWithMetadata[],
): MessageWithMetadata[] {
	return messages.map(
		({
			id: _id,
			ts: _ts,
			iteration: _iteration,
			childSessions: _links,
			...rest
		}) => rest,
	);
}

describe("exportSessionReplayBundleToAtif", () => {
	it("groups each model call with its tool calls and their results", () => {
		const { trajectory, warnings } = exportValid(
			bundle([
				session({ messages: fixtureMessages(), systemPrompt: "Be brief." }),
			]),
		);
		expect(warnings).toEqual([]);
		expect(trajectory).toMatchObject({
			schema_version: "ATIF-v1.7",
			session_id: FIXTURE_SESSION_ID,
			trajectory_id: FIXTURE_SESSION_ID,
			agent: { name: "cline", version: "3.0.0-test", model_name: "fake-model" },
		});
		expect(trajectory.steps.map((step) => [step.step_id, step.source])).toEqual(
			[
				[1, "system"],
				[2, "user"],
				[3, "agent"],
				[4, "agent"],
			],
		);
		const [system, user, first, second] = trajectory.steps;
		expect(system).toMatchObject({
			message: "Be brief.",
			timestamp: "2026-01-01T00:00:00.000Z",
		});
		expect(user).toMatchObject({
			message: "<user_input>List the files</user_input>",
			timestamp: "2026-01-01T00:00:00.000Z",
		});
		expect(cline(user)).toEqual({
			messageId: "m1",
			displayText: "List the files",
		});
		expect(first).toMatchObject({
			timestamp: "2026-01-01T00:00:01.000Z",
			model_name: "fake-model",
			message: "Running ls.",
			reasoning_content: "I should run ls.",
			tool_calls: [
				{
					tool_call_id: "call_1",
					function_name: "run_commands",
					arguments: { commands: ["ls"] },
				},
			],
			observation: {
				results: [
					{
						source_call_id: "call_1",
						content: "a.txt\nb.txt",
						extra: { cline: { toolName: "run_commands", messageId: "m3" } },
					},
				],
			},
			metrics: { prompt_tokens: 100, completion_tokens: 20, cost_usd: 0.001 },
			llm_call_count: 1,
		});
		expect(cline(first)).toMatchObject({
			messageId: "m2",
			iteration: 1,
			turn: 1,
			provider: "openai-compatible",
		});
		expect(second).toMatchObject({ message: "There are two files." });
		expect(second?.tool_calls).toBeUndefined();
		expect(trajectory.final_metrics).toEqual({
			total_prompt_tokens: 230,
			total_completion_tokens: 28,
			total_cost_usd: 0.0015,
			total_steps: 4,
		});
		expect(cline(trajectory)).toMatchObject({
			session: { sessionId: FIXTURE_SESSION_ID, role: "root" },
			bundle: { schemaVersion: 2, redaction: { enabled: true } },
		});
	});

	it("keeps parallel tool calls in one step with one result per call", () => {
		const messages: MessageWithMetadata[] = [
			{ id: "u1", role: "user", content: "Check both", ts: T0 },
			{
				id: "a1",
				role: "assistant",
				ts: T0 + 1_000,
				content: [
					{
						type: "tool_use",
						id: "call_a",
						name: "read_files",
						input: { paths: ["a"] },
					},
					{
						type: "tool_use",
						id: "call_b",
						name: "read_files",
						input: { paths: ["b"] },
					},
					{
						type: "tool_use",
						id: "call_c",
						name: "run_commands",
						input: { commands: ["x"] },
					},
				],
				metrics: {
					inputTokens: 1_000,
					outputTokens: 50,
					cacheReadTokens: 800,
					cacheWriteTokens: 150,
				},
			},
			{
				id: "t1",
				role: "user",
				ts: T0 + 1_200,
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_b",
						name: "read_files",
						content: "B",
					},
					{
						type: "tool_result",
						tool_use_id: "call_a",
						name: "read_files",
						content: [{ type: "text", text: "missing file" }],
						is_error: true,
					},
				],
			},
		];
		const { trajectory } = exportValid(bundle([session({ messages })]));
		const step = trajectory.steps[1];
		expect(step?.tool_calls?.map((call) => call.tool_call_id)).toEqual([
			"call_a",
			"call_b",
			"call_c",
		]);
		expect(step?.observation?.results).toEqual([
			{
				source_call_id: "call_b",
				content: "B",
				extra: { cline: { toolName: "read_files", messageId: "t1" } },
			},
			{
				source_call_id: "call_a",
				content: "missing file",
				extra: {
					cline: { toolName: "read_files", isError: true, messageId: "t1" },
				},
			},
		]);
		expect(step?.metrics).toEqual({
			prompt_tokens: 1_000,
			completion_tokens: 50,
			cached_tokens: 800,
			extra: { cache_creation_input_tokens: 150 },
		});
		expect(trajectory.final_metrics).toEqual({
			total_prompt_tokens: 1_000,
			total_completion_tokens: 50,
			total_cached_tokens: 800,
			total_steps: 2,
			extra: { cache_creation_input_tokens: 150 },
		});
	});

	it("maps injected messages, notices and images to system steps and placeholders", () => {
		const messages: MessageWithMetadata[] = [
			{
				id: "u1",
				role: "user",
				ts: T0,
				content: [
					{ type: "text", text: "What is in this picture?" },
					{ type: "image", data: "aGk=", mediaType: "image/png" },
				],
			},
			{
				id: "a1",
				role: "assistant",
				ts: T0 + 1_000,
				content: [{ type: "text", text: "A cat." }],
			},
			{
				id: "n1",
				role: "assistant",
				ts: T0 + 1_100,
				content: "Provider returned 529, retrying.",
				metadata: { displayOnly: true, displayRole: "error" },
			},
			{
				id: "r1",
				role: "user",
				ts: T0 + 1_200,
				content: "You have not completed the task.",
				metadata: { kind: "recovery_notice" },
			},
			{
				id: "a2",
				role: "assistant",
				ts: T0 + 2_000,
				content: [{ type: "text", text: "Done." }],
			},
		];
		const { trajectory, warnings } = exportValid(
			bundle([session({ messages })]),
		);
		expect(trajectory.steps.map((step) => step.source)).toEqual([
			"user",
			"agent",
			"system",
			"system",
			"agent",
		]);
		expect(trajectory.steps[0]?.message).toBe(
			"What is in this picture?\n[image omitted: image/png]",
		);
		expect(cline(trajectory.steps[2])).toMatchObject({
			role: "assistant",
			displayRole: "error",
			displayOnly: true,
		});
		expect(cline(trajectory.steps[3])).toMatchObject({
			role: "user",
			kind: "recovery_notice",
		});
		expect(warnings.join("\n")).toMatch(/1 image\(s\) were replaced/);
		expect(trajectory.notes).toMatch(/1 image\(s\) were replaced/);
	});

	it("nests a linked subagent and references it from the spawning tool call", () => {
		const { trajectory, warnings } = exportValid(
			bundle([
				session({
					messages: fixtureTreeMessages(),
					entry: { agentId: "agent_root" },
				}),
				session({
					messages: fixtureChildMessages(),
					entry: {
						sessionId: FIXTURE_CHILD_SESSION_ID,
						role: "subagent",
						parentSessionId: FIXTURE_SESSION_ID,
						agentId: "agent_child",
						parentAgentId: "agent_root",
						startedAt: "2026-01-01T00:00:01.050Z",
					},
				}),
			]),
		);
		expect(warnings).toEqual([]);
		const spawn = trajectory.steps[1];
		expect(spawn?.observation?.results[0]).toMatchObject({
			source_call_id: "call_spawn",
			content: '{"text":"a.txt says hi"}',
			subagent_trajectory_ref: [
				{
					trajectory_id: FIXTURE_CHILD_SESSION_ID,
					session_id: FIXTURE_CHILD_SESSION_ID,
					extra: { cline: { kind: "subagent", linkedBy: "message" } },
				},
			],
		});
		const child = trajectory.subagent_trajectories?.[0];
		expect(child).toMatchObject({
			trajectory_id: FIXTURE_CHILD_SESSION_ID,
			agent: { name: "cline" },
			final_metrics: { total_cost_usd: 0.0003, total_steps: 3 },
		});
		expect(child?.steps.map((step) => step.source)).toEqual([
			"user",
			"agent",
			"agent",
		]);
		expect(trajectory.final_metrics?.total_cost_usd).toBe(0.0018);
		expect(trajectory.final_metrics?.extra).toEqual({
			own_cost_usd: 0.0015,
			subagent_cost_usd: 0.0003,
		});
	});

	it("matches children of old bundles by task text and timing", () => {
		const child = session({
			messages: stripNewFields(fixtureChildMessages()),
			entry: {
				sessionId: FIXTURE_CHILD_SESSION_ID,
				role: "subagent",
				parentSessionId: FIXTURE_SESSION_ID,
				agentId: "agent_child",
				parentAgentId: "agent_root",
				startedAt: "2026-01-01T00:00:01.050Z",
			},
		});
		const orphan = session({
			messages: [{ role: "user", content: "Unrelated work" }],
			entry: {
				sessionId: `${FIXTURE_SESSION_ID}__agent_orphan`,
				role: "subagent",
				parentSessionId: FIXTURE_SESSION_ID,
				agentId: "agent_orphan",
				parentAgentId: "agent_root",
				startedAt: "2026-01-01T00:00:06.000Z",
			},
		});
		const root = session({
			messages: stripNewFields(fixtureTreeMessages({ linked: false })),
			entry: { agentId: "agent_root" },
		});
		const { trajectory, warnings } = exportValid(bundle([root, child, orphan]));
		expect(trajectory.steps.slice(0, -1).map((step) => step.timestamp)).toEqual(
			[undefined, undefined, undefined],
		);
		const spawn = trajectory.steps.find((step) => step.tool_calls);
		expect(spawn?.observation?.results[0]?.subagent_trajectory_ref).toEqual([
			{
				trajectory_id: FIXTURE_CHILD_SESSION_ID,
				session_id: FIXTURE_CHILD_SESSION_ID,
				extra: { cline: { kind: "subagent", linkedBy: "inferred" } },
			},
		]);
		const started = trajectory.steps.at(-1);
		expect(started).toMatchObject({
			source: "system",
			timestamp: "2026-01-01T00:00:06.000Z",
			message: `Started subagent session ${FIXTURE_SESSION_ID}__agent_orphan.`,
			observation: {
				results: [
					{
						subagent_trajectory_ref: [
							{
								trajectory_id: `${FIXTURE_SESSION_ID}__agent_orphan`,
								extra: { cline: { linkedBy: "parent" } },
							},
						],
					},
				],
			},
		});
		expect(
			trajectory.subagent_trajectories?.map((sub) => sub.trajectory_id),
		).toEqual([
			FIXTURE_CHILD_SESSION_ID,
			`${FIXTURE_SESSION_ID}__agent_orphan`,
		]);
		expect(warnings.join("\n")).toMatch(/Matched 1 child session\(s\)/);
		expect(warnings.join("\n")).toMatch(
			/__agent_orphan could not be matched to a tool call/,
		);
	});

	it("matches an old bundle's child by the time window when task texts differ", () => {
		const root = fixtureTreeMessages({ linked: false });
		const spawn = root[1]?.content;
		if (Array.isArray(spawn) && spawn[0]?.type === "tool_use") {
			spawn[0].input = { systemPrompt: "x", task: "Something else entirely" };
		}
		const { trajectory } = exportValid(
			bundle([
				session({ messages: root, entry: { agentId: "agent_root" } }),
				session({
					messages: fixtureChildMessages(),
					entry: {
						sessionId: FIXTURE_CHILD_SESSION_ID,
						role: "subagent",
						parentSessionId: FIXTURE_SESSION_ID,
						agentId: "agent_child",
						parentAgentId: "agent_root",
						startedAt: "2026-01-01T00:00:01.050Z",
					},
				}),
			]),
		);
		expect(
			trajectory.steps[1]?.observation?.results[0]?.subagent_trajectory_ref?.[0]
				?.trajectory_id,
		).toBe(FIXTURE_CHILD_SESSION_ID);
	});

	it("nests a teammate's own subagent under the teammate and notes children missing from the bundle", () => {
		const teammateId = `${FIXTURE_SESSION_ID}__teamtask__writer__abc123`;
		const grandchildId = `${FIXTURE_SESSION_ID}__helper`;
		const root = session({
			entry: { agentId: "lead" },
			messages: [
				{ id: "u1", role: "user", content: "Write it", ts: T0 },
				{
					id: "a1",
					role: "assistant",
					ts: T0 + 1_000,
					content: [
						{
							type: "tool_use",
							id: "call_team",
							name: "team_run_task",
							input: {
								agentId: "writer",
								task: "Write the doc",
								runMode: "sync",
							},
						},
						{
							type: "tool_use",
							id: "call_gone",
							name: "spawn_agent",
							input: { task: "Lost work" },
						},
					],
					childSessions: [
						{
							toolCallId: "call_team",
							sessionId: teammateId,
							kind: "teammate",
						},
						{
							toolCallId: "call_gone",
							sessionId: `${FIXTURE_SESSION_ID}__gone`,
							kind: "subagent",
						},
					],
					metrics: { cost: 0.01 },
				},
				{
					id: "t1",
					role: "user",
					ts: T0 + 5_000,
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_team",
							name: "team_run_task",
							content: "done",
						},
					],
				},
			],
		});
		const teammate = session({
			entry: {
				sessionId: teammateId,
				role: "teammate",
				parentSessionId: FIXTURE_SESSION_ID,
				agentId: "writer",
				parentAgentId: "lead",
				startedAt: "2026-01-01T00:00:01.100Z",
			},
			messages: [
				{ id: "w1", role: "user", content: "Write the doc", ts: T0 + 1_100 },
				{
					id: "w2",
					role: "assistant",
					ts: T0 + 2_000,
					content: [
						{
							type: "tool_use",
							id: "call_help",
							name: "spawn_agent",
							input: { task: "Help" },
						},
					],
					childSessions: [
						{
							toolCallId: "call_help",
							sessionId: grandchildId,
							kind: "subagent",
						},
					],
					metrics: { cost: 0.02 },
				},
			],
		});
		const grandchild = session({
			entry: {
				sessionId: grandchildId,
				role: "subagent",
				parentSessionId: FIXTURE_SESSION_ID,
				agentId: "helper",
				parentAgentId: "writer",
				startedAt: "2026-01-01T00:00:02.100Z",
			},
			messages: [
				{ id: "h1", role: "user", content: "Help", ts: T0 + 2_100 },
				{
					id: "h2",
					role: "assistant",
					ts: T0 + 3_000,
					content: "Helped.",
					metrics: { cost: 0.04 },
				},
			],
		});
		const { trajectory, warnings } = exportValid(
			bundle([root, teammate, grandchild]),
		);
		expect(
			trajectory.subagent_trajectories?.map((sub) => sub.trajectory_id),
		).toEqual([teammateId]);
		const nested = trajectory.subagent_trajectories?.[0];
		expect(
			nested?.subagent_trajectories?.map((sub) => sub.trajectory_id),
		).toEqual([grandchildId]);
		expect(nested?.final_metrics?.total_cost_usd).toBe(0.06);
		expect(trajectory.final_metrics?.total_cost_usd).toBe(0.07);
		const results = trajectory.steps[1]?.observation?.results ?? [];
		expect(results[0]).toMatchObject({
			source_call_id: "call_team",
			subagent_trajectory_ref: [
				{ trajectory_id: teammateId, extra: { cline: { kind: "teammate" } } },
			],
		});
		expect(results[1]).toEqual({
			source_call_id: "call_gone",
			extra: {
				cline: {
					resultMissing: true,
					childSessions: [
						{
							sessionId: `${FIXTURE_SESSION_ID}__gone`,
							kind: "subagent",
							inBundle: false,
						},
					],
				},
			},
		});
		expect(warnings).toEqual([
			`Tool call call_gone in session ${FIXTURE_SESSION_ID} started subagent session ${FIXTURE_SESSION_ID}__gone, which is not in the bundle.`,
		]);
	});

	it("marks compactions with the context management convention", () => {
		const messages: MessageWithMetadata[] = [
			{
				id: "s0",
				role: "user",
				ts: T0,
				content: "Summary of the earlier work.",
				metadata: { kind: "compaction_summary", displayRole: "system" },
				compactionSummary: true,
			},
			{ id: "u1", role: "user", content: "First", ts: T0 + 1_000 },
			{ id: "a1", role: "assistant", content: "One", ts: T0 + 2_000 },
			{
				id: "x1",
				role: "assistant",
				content: "Compacting",
				ts: T0 + 2_100,
				metadata: { displayOnly: true, displayRole: "status" },
			},
			{
				id: "u2",
				role: "user",
				content: "Second",
				ts: T0 + 3_000,
				metadata: {
					kind: "compaction",
					messagesRemoved: 4,
					reason: "auto_compaction",
				},
			},
			{ id: "a2", role: "assistant", content: "Two", ts: T0 + 4_000 },
			{ id: "u3", role: "user", content: "Third", ts: T0 + 5_000 },
			{ id: "a3", role: "assistant", content: "Three", ts: T0 + 6_000 },
		];
		const compaction: SessionCompactionState = {
			version: 1,
			updated_at: "2026-01-01T00:00:04.500Z",
			source_message_count: 6,
			source_prefix_hash: "sha256:latest",
			messages: [
				{
					role: "user",
					content: "Latest summary.",
					metadata: { kind: "compaction_summary" },
				},
			],
		};
		const requests = [
			{ callIndex: 0, compaction: null },
			{
				callIndex: 1,
				compaction: {
					id: "sha256:earlier",
					sourceMessageCount: 3,
					updatedAt: "2026-01-01T00:00:02.500Z",
				},
			},
			{
				callIndex: 2,
				compaction: {
					id: "sha256:latest",
					sourceMessageCount: 6,
					updatedAt: "2026-01-01T00:00:04.500Z",
				},
			},
		].map(
			(partial, index) =>
				({
					...partial,
					seq: index,
					sessionId: FIXTURE_SESSION_ID,
					agentId: "agent_1",
					runId: "run_1",
					iteration: index + 1,
					attempt: 0,
					startedAt: "2026-01-01T00:00:00.000Z",
					finishedAt: "2026-01-01T00:00:00.000Z",
					durationMs: 1,
					request: {
						matchKey: "0".repeat(64),
						systemPromptSha256: null,
						toolsSha256: "1".repeat(64),
						modelToolsSha256: null,
						messageCount: 1,
						messagePrefix: null,
						messageSha256s: [],
						options: null,
						provider: {},
					},
					response: {
						outcome: "completed",
						finishReason: "stop",
						requestId: null,
						error: null,
						messageId: ["a1", "a2", "a3"][index] ?? null,
						toolCallIds: [],
						usage: null,
						events: [],
					},
				}) satisfies SessionRecordedModelCall,
		);
		const { trajectory } = exportValid(
			bundle([session({ messages, compaction, requests })]),
		);
		const summary = (step: AtifStep) =>
			[
				step.source,
				(step.extra?.context_management as { type?: string } | undefined)
					?.type ?? "",
				typeof step.message === "string" ? step.message.slice(0, 12) : "",
			].join(":");
		expect(trajectory.steps.map(summary)).toEqual([
			"system:compaction:Context comp",
			"user::First",
			"agent::One",
			"system::Compacting",
			"system:compaction:Context comp",
			"system:pruning:Context comp",
			"user::Second",
			"agent::Two",
			"user::Third",
			"system:compaction:Context comp",
			"agent::Three",
		]);
		const [transcriptSummary] = trajectory.steps;
		expect(transcriptSummary?.observation?.results).toEqual([
			{ content: "Summary of the earlier work." },
		]);
		expect(trajectory.steps[4]?.extra).toEqual({
			context_management: { type: "compaction" },
			cline: {
				source: "recorded-request",
				stateId: "sha256:earlier",
				sourceMessageCount: 3,
				updatedAt: "2026-01-01T00:00:02.500Z",
				firstCallIndex: 1,
			},
		});
		expect(trajectory.steps[5]?.extra).toMatchObject({
			context_management: { type: "pruning", boundary: "truncate" },
			cline: { messagesRemoved: 4, reason: "auto_compaction" },
		});
		expect(trajectory.steps[9]).toMatchObject({
			timestamp: "2026-01-01T00:00:04.500Z",
			observation: {
				results: [
					{
						content: "Latest summary.",
						extra: { cline: { role: "user", compactionSummary: true } },
					},
				],
			},
			extra: {
				context_management: { type: "compaction", boundary: "replace" },
				cline: { source: "compaction-state", sourceMessageCount: 6 },
			},
		});
	});

	it("carries recorded tool definitions, model calls and decisions", async () => {
		const recorded = await recordFixtureSession([
			{
				prompt: "List the files",
				text: "Listing.",
				toolCalls: [
					{
						id: "call_ls",
						name: "run_commands",
						input: { commands: ["ls"] },
						result: "notes.txt",
						environment: { version: 1, commands: { cwd: "/w" } },
					},
				],
				failedAttempts: 1,
				decisionsAfter: [
					{
						name: "approval_resolved",
						toolCallId: "call_ls",
						payload: { toolName: "run_commands", approved: true, waitMs: 5 },
					},
				],
			},
			{ text: "Found notes.txt." },
		]);
		const { trajectory } = exportValid(
			bundle([
				session({
					messages: recorded.transcript.messages,
					systemPrompt: recorded.transcript.systemPrompt,
					events: recorded.events,
					requests: recorded.requests,
					blobs: recorded.blobs,
					entry: { sessionId: recorded.transcript.sessionId },
				}),
			]),
		);
		expect(trajectory.agent.tool_definitions).toEqual([
			{
				type: "function",
				function: {
					name: "read_files",
					description: "Read files from the workspace.",
					parameters: {
						type: "object",
						properties: { paths: { type: "array", items: { type: "string" } } },
					},
				},
			},
			{
				type: "function",
				function: {
					name: "run_commands",
					description: "Run shell commands.",
					parameters: {
						type: "object",
						properties: {
							commands: { type: "array", items: { type: "string" } },
						},
					},
				},
			},
		]);
		const first = trajectory.steps.find((step) => step.source === "agent");
		const extra = cline(first);
		const modelCalls = extra.modelCalls as Array<Record<string, unknown>>;
		expect(modelCalls.map((call) => [call.attempt, call.outcome])).toEqual([
			[0, "error"],
			[1, "completed"],
		]);
		expect(modelCalls[1]?.matchKey).toMatch(/^[0-9a-f]{64}$/);
		const events = extra.events as Array<Record<string, unknown>>;
		expect(
			events.find((event) => event.name === "approval_resolved"),
		).toMatchObject({
			kind: "decision",
			toolCallId: "call_ls",
			payload: { approved: true, toolName: "run_commands" },
		});
		expect(first?.observation?.results[0]?.extra).toMatchObject({
			cline: { environment: { version: 1, commands: { cwd: "/w" } } },
		});
	});

	it("exports a session without messages and warns about unredacted bundles", () => {
		const { trajectory, warnings } = exportValid(
			bundle([session({ messages: [] })], { redacted: false }),
		);
		expect(trajectory.steps).toEqual([
			{
				step_id: 1,
				source: "system",
				timestamp: "2026-01-01T00:00:00.000Z",
				message: "The session has no messages.",
			},
		]);
		expect(trajectory.final_metrics).toEqual({ total_steps: 1 });
		expect(warnings[0]).toMatch(/without redaction/);
	});

	it("rejects a bundle whose root session is missing", () => {
		const input = bundle([session({ messages: [] })]);
		input.manifest.rootSessionId = "sess_missing";
		expect(() => exportSessionReplayBundleToAtif(input)).toThrow(
			/root session sess_missing is not in the bundle/,
		);
	});
});
