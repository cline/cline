import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentAfterToolContext,
	AgentBeforeToolContext,
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	SessionRecordedBlob,
	SessionRecordedEvent,
	SessionRecordedModelCall,
	SessionRecordingHeader,
} from "./recording-schema";
import {
	computeRecordedRequestMatchKey,
	describeRecordedProvider,
	recordedMessageContentSha256,
	resolveSessionRecording,
	SessionRecorder,
} from "./session-recorder";
import { TOOL_ENVIRONMENT_METADATA_KEY } from "./tool-environment";

let createdAt = 1_000;

function text(role: AgentMessage["role"], value: string): AgentMessage {
	createdAt += 1;
	return {
		id: `msg_${createdAt}`,
		role,
		content: [{ type: "text", text: value }],
		createdAt,
	};
}

function model(events: AgentModelEvent[] | Error): AgentModel {
	return {
		stream: async function* () {
			if (events instanceof Error) throw events;
			yield* events;
		},
	};
}

async function drain(stream: AsyncIterable<AgentModelEvent>) {
	for await (const _event of stream) {
		// consume
	}
}

function request(
	messages: AgentMessage[],
	metadata: Record<string, unknown> = {},
): AgentModelRequest {
	return {
		systemPrompt: "You are a test agent.",
		messages,
		tools: [{ name: "read_files", description: "Read", inputSchema: {} }],
		options: { metadata: { agentId: "agent_1", ...metadata } },
	};
}

function readLines<T>(file: string): T[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

function runtimeEvent(event: Record<string, unknown>): AgentRuntimeEvent {
	return {
		snapshot: { agentId: "agent_1", runId: "run_1" },
		...event,
	} as unknown as AgentRuntimeEvent;
}

const PROVIDER = describeRecordedProvider({
	providerId: "openai-compatible",
	modelId: "fake-model",
	baseUrl: "https://user:secret-pass@llm.example.com/v1",
	headers: { Authorization: "Bearer sk-header-secret", "X-Org": "org" },
	maxTokensPerTurn: 1024,
});

describe("resolveSessionRecording", () => {
	it("prefers explicit config over the environment", () => {
		expect(resolveSessionRecording({ enabled: true }, {})).toBe("config");
		expect(
			resolveSessionRecording(
				{ enabled: false },
				{ CLINE_RECORD_SESSIONS: "1" },
			),
		).toBeUndefined();
		for (const value of ["1", "true", "YES", " true "]) {
			expect(
				resolveSessionRecording(undefined, { CLINE_RECORD_SESSIONS: value }),
			).toBe("env");
		}
		expect(
			resolveSessionRecording(undefined, { CLINE_RECORD_SESSIONS: "0" }),
		).toBeUndefined();
		expect(resolveSessionRecording(undefined, {})).toBeUndefined();
	});
});

describe("SessionRecorder", () => {
	let root: string;
	let dir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "session-recorder-"));
		dir = join(root, "sess_1", "recording");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const open = () =>
		SessionRecorder.open({
			sessionId: "sess_1",
			dir,
			enabledBy: "config",
			cwd: root,
		});

	it("writes nothing for a session that never records anything", async () => {
		const recorder = await open();
		recorder.startSegment({
			leadAgentId: "agent_1",
			initialMessageCount: 0,
			mode: "act",
		});
		await recorder.close();
		expect(existsSync(dir)).toBe(false);
	});

	it("records model calls with deduplicated blobs and a stable match key", async () => {
		const recorder = await open();
		recorder.startSegment({
			leadAgentId: "agent_1",
			initialMessageCount: 0,
			mode: "act",
		});
		recorder.onRuntimeEvent(runtimeEvent({ type: "run-started" }));
		recorder.onRuntimeEvent(
			runtimeEvent({ type: "turn-started", iteration: 1 }),
		);
		const prompt = text("user", "hello");
		await drain(
			await recorder
				.wrapModel(
					model([
						{ type: "text-delta", text: "Reading." },
						{
							type: "tool-call-delta",
							toolCallId: "call_1",
							toolName: "read_files",
						},
						{ type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
						{ type: "finish", reason: "tool-calls", requestId: "req_1" },
					]),
					PROVIDER,
				)
				.stream(request([prompt], { runId: "run_1", iteration: 1 })),
		);
		recorder.onAssistantMessageAssembled({
			id: "msg_assistant",
			role: "assistant",
			content: [
				{ type: "text", text: "Reading." },
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "read_files",
					input: {},
				},
			],
			createdAt: 1,
		});
		// The runtime rebuilds request messages with fresh ids per call.
		const sameContent = { ...prompt, id: "msg_rebuilt", createdAt: 99_999 };
		await expect(
			drain(
				await recorder
					.wrapModel(model(new Error("rate limited")), PROVIDER)
					.stream(
						request([sameContent, text("user", "more")], {
							runId: "run_1",
							iteration: 2,
						}),
					),
			),
		).rejects.toThrow("rate limited");
		await recorder.close();

		const records = readLines<SessionRecordedModelCall>(
			join(dir, "requests.jsonl"),
		);
		const blobs = readLines<SessionRecordedBlob>(join(dir, "blobs.jsonl"));
		const events = readLines<SessionRecordedEvent>(join(dir, "events.jsonl"));
		expect(records).toHaveLength(2);
		const [first, second] = records;
		expect(first).toMatchObject({
			callIndex: 0,
			runId: "run_1",
			iteration: 1,
			attempt: 0,
			agentId: "agent_1",
			response: {
				outcome: "completed",
				finishReason: "tool-calls",
				requestId: "req_1",
				messageId: "msg_assistant",
				toolCallIds: ["call_1"],
				usage: { inputTokens: 10, outputTokens: 2 },
			},
		});
		expect(first?.response.events.map((entry) => entry.event.type)).toEqual([
			"text-delta",
			"tool-call-delta",
			"usage",
			"finish",
		]);
		expect(second).toMatchObject({
			callIndex: 1,
			iteration: 2,
			response: { outcome: "error", error: "rate limited", messageId: null },
		});

		// Same system prompt, tools and first message: one blob each.
		expect(blobs.map((blob) => blob.kind).sort()).toEqual([
			"message",
			"message",
			"system-prompt",
			"tools",
		]);
		expect(second?.request.messageSha256s[0]).toBe(
			first?.request.messageSha256s[0],
		);
		const promptBlob = blobs.find(
			(blob) => blob.sha256 === first?.request.messageSha256s[0],
		);
		expect(promptBlob?.value).toEqual({
			role: "user",
			content: [{ type: "text", text: "hello" }],
		});
		expect(promptBlob?.contentSha256).toBe(
			recordedMessageContentSha256(prompt),
		);
		for (const blob of blobs) {
			expect(blob.sha256).toBe(
				createHash("sha256").update(JSON.stringify(blob.value)).digest("hex"),
			);
		}
		expect(first?.request.matchKey).toBe(
			computeRecordedRequestMatchKey({
				systemPromptSha256: first?.request.systemPromptSha256 ?? null,
				toolsSha256: first?.request.toolsSha256 ?? "",
				messageContentSha256s: [recordedMessageContentSha256(prompt)],
			}),
		);

		// Connection settings without credentials.
		expect(first?.request.provider).toEqual({
			provider: "openai-compatible",
			model: "fake-model",
			baseUrl: "https://llm.example.com/v1",
			headerNames: ["Authorization", "X-Org"],
			maxOutputTokens: 1024,
		});
		const raw = readFileSync(join(dir, "requests.jsonl"), "utf8");
		expect(raw).not.toContain("secret");

		// Each record shares its seq with its model_finished event.
		for (const record of records) {
			const finished = events.find(
				(event) =>
					event.name === "model_finished" &&
					event.refs?.modelCallIndex === record.callIndex,
			);
			expect(finished?.seq).toBe(record.seq);
		}
		const seqs = events.map((event) => event.seq);
		expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

		const stats = recorder.stats();
		expect(stats.modelCalls).toBe(2);
		expect(stats.blobsDeduplicated).toBe(3);
		expect(stats.fullRequestBytes).toBeGreaterThan(0);
	});

	it("counts attempts per run and iteration and flushes unlinked calls", async () => {
		const recorder = await open();
		recorder.startSegment({ leadAgentId: "agent_1", initialMessageCount: 0 });
		const wrapped = recorder.wrapModel(
			model([{ type: "finish", reason: "stop" }]),
			PROVIDER,
		);
		const metadata = { runId: "run_1", iteration: 1 };
		await drain(await wrapped.stream(request([text("user", "a")], metadata)));
		await drain(await wrapped.stream(request([text("user", "a")], metadata)));
		recorder.onRuntimeEvent(
			runtimeEvent({
				type: "run-finished",
				result: { status: "completed", iterations: 1 },
			}),
		);
		await recorder.close();
		const records = readLines<SessionRecordedModelCall>(
			join(dir, "requests.jsonl"),
		);
		expect(
			records.map((record) => [record.attempt, record.response.messageId]),
		).toEqual([
			[0, null],
			[1, null],
		]);
	});

	it("continues seq, call index and blobs across host starts", async () => {
		const first = await open();
		first.startSegment({
			leadAgentId: "agent_1",
			initialMessageCount: 0,
			mode: "act",
		});
		const prompt = text("user", "hello");
		await drain(
			await first
				.wrapModel(model([{ type: "finish", reason: "stop" }]), PROVIDER)
				.stream(request([prompt])),
		);
		await first.close();
		const lastSeq = Math.max(
			...readLines<SessionRecordedEvent>(join(dir, "events.jsonl")).map(
				(event) => event.seq,
			),
		);

		const second = await open();
		second.startSegment({
			leadAgentId: "agent_2",
			initialMessageCount: 2,
			mode: "plan",
		});
		await drain(
			await second
				.wrapModel(model([{ type: "finish", reason: "stop" }]), PROVIDER)
				.stream(request([prompt, text("user", "again")])),
		);
		await second.close();

		const header = JSON.parse(
			readFileSync(join(dir, "recording.json"), "utf8"),
		) as SessionRecordingHeader;
		expect(header.segments.map((segment) => segment.leadAgentId)).toEqual([
			"agent_1",
			"agent_2",
		]);
		expect(header.segments[1]?.firstSeq).toBe(lastSeq + 1);
		const events = readLines<SessionRecordedEvent>(join(dir, "events.jsonl"));
		expect(
			events.find((event) => event.name === "mode_switched"),
		).toMatchObject({
			seq: lastSeq + 1,
			kind: "decision",
			payload: { from: "act", to: "plan", source: "session_restart" },
		});
		expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
		const records = readLines<SessionRecordedModelCall>(
			join(dir, "requests.jsonl"),
		);
		expect(records.map((record) => record.callIndex)).toEqual([0, 1]);
		const blobs = readLines<SessionRecordedBlob>(join(dir, "blobs.jsonl"));
		expect(blobs.filter((blob) => blob.kind === "system-prompt")).toHaveLength(
			1,
		);
		expect(blobs.filter((blob) => blob.kind === "message")).toHaveLength(2);
	});

	it("records mode switches from turns and steers only on change", async () => {
		const recorder = await open();
		recorder.startSegment({
			leadAgentId: "agent_1",
			initialMessageCount: 0,
			mode: "act",
		});
		recorder.noteMode("act", "turn");
		recorder.noteMode(undefined, "turn");
		recorder.noteMode("plan", "steer", { agentId: "agent_1", iteration: 3 });
		recorder.noteMode("plan", "turn");
		recorder.noteMode("act", "turn");
		await recorder.close();
		const events = readLines<SessionRecordedEvent>(join(dir, "events.jsonl"));
		expect(
			events.map((event) => [
				event.name,
				event.payload.from,
				event.payload.to,
				event.payload.source,
				event.iteration,
			]),
		).toEqual([
			["mode_switched", "act", "plan", "steer", 3],
			["mode_switched", "plan", "act", "turn", undefined],
		]);
	});

	it("attaches tool environment facts to tool results", async () => {
		const recorder = await open();
		const file = join(root, "c.txt");
		writeFileSync(file, "before\n");
		const sha = (value: string) =>
			createHash("sha256").update(value).digest("hex");
		const context = (
			toolName: string,
			input: unknown,
			output: unknown = "ok",
		) =>
			({
				snapshot: {},
				tool: { name: toolName },
				toolCall: { type: "tool-call", toolCallId: `call_${toolName}` },
				input,
				result: { output, metadata: { existing: true } },
			}) as unknown as AgentBeforeToolContext & AgentAfterToolContext;

		const edit = context("editor", { path: "c.txt" });
		await recorder.beforeTool(edit);
		writeFileSync(file, "after\n");
		const edited = await recorder.afterTool(edit);
		expect(edited?.metadata).toMatchObject({
			existing: true,
			[TOOL_ENVIRONMENT_METADATA_KEY]: {
				version: 1,
				preImage: [{ path: file, exists: true, sha256: sha("before\n") }],
				postImage: [{ path: file, exists: true, sha256: sha("after\n") }],
			},
		});

		const read = await recorder.afterTool(
			context("read_files", { files: [{ path: file }] }),
		);
		expect(read?.metadata?.[TOOL_ENVIRONMENT_METADATA_KEY]).toEqual({
			version: 1,
			read: [{ path: file, exists: true, bytes: 6, sha256: sha("after\n") }],
		});

		const command = await recorder.afterTool(
			context("run_commands", { commands: ["true"] }, [
				{ query: "true", result: "", success: true },
			]),
		);
		expect(command?.metadata?.[TOOL_ENVIRONMENT_METADATA_KEY]).toEqual({
			version: 1,
			commands: {
				cwd: root,
				envSha256: recorder.envSha256,
				results: [{ command: "true", exitCode: 0 }],
			},
		});

		expect(
			await recorder.afterTool(context("search_codebase", {})),
		).toBeUndefined();
		expect(await recorder.afterTool(context("read_files", {}))).toBeUndefined();
	});
});
