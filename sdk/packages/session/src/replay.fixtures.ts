import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeRecordedProvider, SessionRecorder } from "@cline/core";
import {
	type AgentMessage,
	type AgentModelEvent,
	type AgentModelRequest,
	type AgentRuntimeEvent,
	type AgentToolDefinition,
	type MessageWithMetadata,
	type SessionReplayRequestBlob,
	TOOL_ENVIRONMENT_METADATA_KEY,
} from "@cline/shared";
import {
	mergeSessionReplayEvents,
	readSessionRecording,
	toSessionReplayRecordedEvents,
} from "./bundle-recording";
import type { SessionReplaySessionData } from "./replay-compare";

export interface FixtureToolCall {
	id: string;
	name: string;
	input: unknown;
	result: unknown;
	isError?: boolean;
	environment?: Record<string, unknown>;
}

export interface FixtureDecision {
	name: string;
	payload?: Record<string, unknown>;
	toolCallId?: string;
}

export interface FixtureStep {
	/** User prompt submitted before this iteration's model call. */
	prompt?: string;
	text: string;
	toolCalls?: FixtureToolCall[];
	/** Failed attempts of the same request recorded before the one that answered. */
	failedAttempts?: number;
	decisionsBefore?: FixtureDecision[];
	decisionsAfter?: FixtureDecision[];
}

export interface FixtureSessionOptions {
	sessionId?: string;
	systemPrompt?: string;
	tools?: AgentToolDefinition[];
	model?: string;
	/** Keep the recording at `<sessionDir>/recording/` instead of a removed temp dir. */
	sessionDir?: string;
}

export const FIXTURE_TOOLS: AgentToolDefinition[] = [
	{
		name: "read_files",
		description: "Read files from the workspace.",
		inputSchema: {
			type: "object",
			properties: { paths: { type: "array", items: { type: "string" } } },
		},
	},
	{
		name: "run_commands",
		description: "Run shell commands.",
		inputSchema: {
			type: "object",
			properties: { commands: { type: "array", items: { type: "string" } } },
		},
	},
];

export const FIXTURE_STEPS: FixtureStep[] = [
	{
		prompt: "List the files and read notes.txt",
		text: "Listing files.",
		toolCalls: [
			{
				id: "call_ls",
				name: "run_commands",
				input: { commands: ["ls"] },
				result: "notes.txt",
				environment: { version: 1, commands: { cwd: "/w" } },
			},
		],
		decisionsBefore: [
			{
				name: "prompt_delivered",
				payload: { delivery: "immediate", source: "start" },
			},
		],
		decisionsAfter: [
			{
				name: "approval_resolved",
				toolCallId: "call_ls",
				payload: {
					toolName: "run_commands",
					approved: true,
					waitMs: 120,
					decidedBy: { kind: "client", id: "client_1" },
				},
			},
		],
	},
	{
		text: "Reading notes.",
		toolCalls: [
			{
				id: "call_read",
				name: "read_files",
				input: { paths: ["notes.txt"] },
				result: "remember the milk",
			},
		],
	},
	{ text: "The notes say: remember the milk." },
];

/**
 * Drives a real {@link SessionRecorder} through a scripted conversation and
 * returns the session as a bundle would load it: transcript, merged events,
 * request records and blobs.
 */
export async function recordFixtureSession(
	steps: readonly FixtureStep[] = FIXTURE_STEPS,
	options: FixtureSessionOptions = {},
): Promise<SessionReplaySessionData & { sent: AgentModelRequest[] }> {
	const sessionId = options.sessionId ?? "sess_replay";
	const tools = options.tools ?? FIXTURE_TOOLS;
	const systemPrompt = options.systemPrompt ?? "You are a test agent.";
	const dir =
		options.sessionDir ?? (await mkdtemp(join(tmpdir(), "replay-fixture-")));
	try {
		let now = Date.parse("2026-01-01T00:00:00.000Z");
		const recorder = await SessionRecorder.open({
			sessionId,
			dir: join(dir, "recording"),
			cwd: "/w",
			now: () => now,
		});
		recorder.startSegment({ leadAgentId: "agent_1", initialMessageCount: 0 });
		const provider = describeRecordedProvider({
			providerId: "openai-compatible",
			modelId: options.model ?? "fake-model",
		});
		const runtime = (event: Record<string, unknown>) =>
			recorder.onRuntimeEvent({
				snapshot: { agentId: "agent_1", runId: "run_1" },
				...event,
			} as unknown as AgentRuntimeEvent);
		const history: AgentMessage[] = [];
		const transcript: MessageWithMetadata[] = [];
		const sent: AgentModelRequest[] = [];
		runtime({ type: "run-started" });
		for (const [position, step] of steps.entries()) {
			const iteration = position + 1;
			now += 1_000;
			if (step.prompt) {
				history.push({
					id: `user_${iteration}`,
					role: "user",
					content: [{ type: "text", text: step.prompt }],
					createdAt: now,
				});
				transcript.push({
					id: `user_${iteration}`,
					role: "user",
					content: [{ type: "text", text: step.prompt }],
					ts: now,
					metadata: { userRunSpan: 1 },
				});
			}
			for (const decision of step.decisionsBefore ?? []) {
				recorder.recordDecision(decision.name, {
					agentId: "agent_1",
					payload: decision.payload ?? {},
				});
			}
			runtime({ type: "turn-started", iteration });
			const request: AgentModelRequest = {
				systemPrompt,
				messages: history.map((message) => ({
					...message,
					id: `${message.id}_req${iteration}`,
				})),
				tools,
				options: {
					metadata: { agentId: "agent_1", runId: "run_1", iteration },
				},
			};
			for (
				let attempt = 0;
				attempt < (step.failedAttempts ?? 0);
				attempt += 1
			) {
				sent.push(request);
				const failing = recorder.wrapModel(
					{
						stream: async () => {
							throw new Error("rate limited");
						},
					},
					provider,
				);
				try {
					await failing.stream(request);
				} catch {}
			}
			const toolCalls = step.toolCalls ?? [];
			const events: AgentModelEvent[] = [
				{ type: "text-delta", text: step.text },
				...toolCalls.map(
					(call): AgentModelEvent => ({
						type: "tool-call-delta",
						toolCallId: call.id,
						toolName: call.name,
						input: call.input,
					}),
				),
				{
					type: "usage",
					usage: { inputTokens: 100 * iteration, outputTokens: 10 },
				},
				{
					type: "finish",
					reason: toolCalls.length > 0 ? "tool-calls" : "stop",
				},
			];
			const model = recorder.wrapModel(
				{
					stream: async function* () {
						yield* events;
					},
				},
				provider,
			);
			sent.push(request);
			for await (const _event of await model.stream(request)) {
				now += 5;
			}
			const assistant: AgentMessage = {
				id: `assistant_${iteration}`,
				role: "assistant",
				content: [
					{ type: "text", text: step.text },
					...toolCalls.map((call) => ({
						type: "tool-call" as const,
						toolCallId: call.id,
						toolName: call.name,
						input: call.input,
					})),
				],
				createdAt: now,
			};
			recorder.onAssistantMessageAssembled(assistant);
			history.push(assistant);
			transcript.push({
				id: assistant.id,
				role: "assistant",
				content: [
					{ type: "text", text: step.text },
					...toolCalls.map((call) => ({
						type: "tool_use" as const,
						id: call.id,
						name: call.name,
						input: call.input as Record<string, unknown>,
					})),
				],
				ts: now,
				modelInfo: {
					id: options.model ?? "fake-model",
					provider: "openai-compatible",
				},
			});
			for (const decision of step.decisionsAfter ?? []) {
				recorder.recordDecision(decision.name, {
					agentId: "agent_1",
					iteration,
					...(decision.toolCallId ? { toolCallId: decision.toolCallId } : {}),
					payload: decision.payload ?? {},
				});
			}
			for (const call of toolCalls) {
				now += 10;
				const message: AgentMessage = {
					id: `tool_${call.id}_${iteration}`,
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: call.id,
							toolName: call.name,
							output: call.result,
							...(call.isError ? { isError: true } : {}),
						},
					],
					createdAt: now,
				};
				runtime({
					type: "tool-started",
					iteration,
					toolCall: { toolCallId: call.id, toolName: call.name },
				});
				runtime({
					type: "tool-finished",
					iteration,
					toolCall: { toolCallId: call.id, toolName: call.name },
					message,
				});
				history.push(message);
				transcript.push({
					id: message.id,
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: call.id,
							name: call.name,
							content:
								typeof call.result === "string"
									? call.result
									: JSON.stringify(call.result),
							...(call.isError ? { is_error: true } : {}),
						},
					],
					ts: now,
					...(call.environment
						? {
								metadata: {
									[TOOL_ENVIRONMENT_METADATA_KEY]: call.environment,
								},
							}
						: {}),
				});
			}
		}
		runtime({
			type: "run-finished",
			result: { status: "completed", iterations: steps.length },
		});
		await recorder.close();
		const recording = await readSessionRecording(dir);
		if (!recording) throw new Error("fixture recording was not written");
		const blobs = new Map<string, SessionReplayRequestBlob>(
			recording.blobs.map((blob) => [blob.sha256, blob]),
		);
		return {
			transcript: { sessionId, systemPrompt, messages: transcript },
			events: mergeSessionReplayEvents(
				toSessionReplayRecordedEvents(recording.events),
			),
			requests: recording.requests,
			blobs,
			sent,
		};
	} finally {
		if (!options.sessionDir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
}
