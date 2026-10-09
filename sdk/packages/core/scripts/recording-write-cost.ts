/**
 * Measures what session recording costs on a long session.
 *
 * Drives a SessionRecorder the way SessionRuntime does (wrapped model stream,
 * assistant-message link, runtime events, tool environment hooks) through N
 * iterations whose requests grow by one assistant message and one tool
 * result each, and compares wall time against the same loop unrecorded.
 *
 * Usage:
 *   bun packages/core/scripts/recording-write-cost.ts [iterations...] [--json]
 *   bun packages/core/scripts/recording-write-cost.ts 100 300 600
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
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
	AgentToolDefinition,
} from "@cline/shared";
import {
	describeRecordedProvider,
	SessionRecorder,
} from "../src/session/recording/session-recorder";

const SYSTEM_PROMPT_BYTES = 30_000;
const TOOL_COUNT = 20;
const TOOL_SCHEMA_BYTES = 1_200;
const TOOL_RESULT_BYTES = 4_000;
const ASSISTANT_TEXT_CHUNKS = 40;

function filler(bytes: number, seed: number): string {
	const word = `lorem${seed.toString(36)} `;
	return word.repeat(Math.ceil(bytes / word.length)).slice(0, bytes);
}

const SYSTEM_PROMPT = filler(SYSTEM_PROMPT_BYTES, 1);
const TOOLS: AgentToolDefinition[] = Array.from(
	{ length: TOOL_COUNT },
	(_, index) => ({
		name: index === 0 ? "read_files" : `tool_${index}`,
		description: filler(200, index),
		inputSchema: {
			type: "object",
			properties: {
				input: {
					type: "string",
					description: filler(TOOL_SCHEMA_BYTES, index),
				},
			},
		},
	}),
);

function responseEvents(iteration: number): AgentModelEvent[] {
	return [
		...Array.from(
			{ length: ASSISTANT_TEXT_CHUNKS },
			(_, chunk): AgentModelEvent => ({
				type: "text-delta",
				text: `chunk ${chunk} of ${iteration} `,
			}),
		),
		{
			type: "tool-call-delta",
			toolCallId: `call_${iteration}`,
			toolName: "read_files",
			inputText: JSON.stringify({ files: [{ path: "bench.txt" }] }),
		},
		{
			type: "usage",
			usage: { inputTokens: 1_000 * iteration, outputTokens: 200 },
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

const fakeModel: AgentModel = {
	stream: async function* (request: AgentModelRequest) {
		const iteration = Number(
			(request.options?.metadata as { iteration?: number }).iteration,
		);
		yield* responseEvents(iteration);
	},
};

function assistantMessage(iteration: number): AgentMessage {
	return {
		id: `msg_a_${iteration}`,
		role: "assistant",
		createdAt: iteration,
		content: [
			{
				type: "text",
				text: Array.from(
					{ length: ASSISTANT_TEXT_CHUNKS },
					(_, chunk) => `chunk ${chunk} of ${iteration} `,
				).join(""),
			},
			{
				type: "tool-call",
				toolCallId: `call_${iteration}`,
				toolName: "read_files",
				input: { files: [{ path: "bench.txt" }] },
			},
		],
	};
}

function toolMessage(iteration: number): AgentMessage {
	return {
		id: `msg_t_${iteration}`,
		role: "tool",
		createdAt: iteration,
		content: [
			{
				type: "tool-result",
				toolCallId: `call_${iteration}`,
				toolName: "read_files",
				output: filler(TOOL_RESULT_BYTES, iteration),
			},
		],
	};
}

/** The runtime rebuilds request messages with fresh ids for every call. */
function rebuild(messages: AgentMessage[], call: number): AgentMessage[] {
	return messages.map((message, index) => ({
		...message,
		id: `req_${call}_${index}`,
		createdAt: Date.now(),
	}));
}

function runtimeEvent(event: Record<string, unknown>): AgentRuntimeEvent {
	return {
		snapshot: { agentId: "agent_bench", runId: "run_bench" },
		...event,
	} as unknown as AgentRuntimeEvent;
}

const yieldToIo = () => new Promise((resolve) => setImmediate(resolve));

async function drain(stream: AsyncIterable<AgentModelEvent>): Promise<void> {
	for await (const _event of stream) {
		// consume
	}
}

interface RunResult {
	iterations: number;
	baselineMs: number;
	recordedMs: number;
	closeMs: number;
	recordMs: number;
	writeMs: number;
	recordMsFirst10Pct: number;
	recordMsLast10Pct: number;
	lastRequestBytes: number;
	fullRequestBytes: number;
	bytes: Record<string, number>;
	blobs: number;
	blobsDeduplicated: number;
}

async function runLoop(
	iterations: number,
	workdir: string,
	recorder?: SessionRecorder,
): Promise<{ ms: number; perCallRecordMs: number[] }> {
	const model = recorder
		? recorder.wrapModel(
				fakeModel,
				describeRecordedProvider({
					providerId: "anthropic",
					modelId: "bench-model",
				}),
			)
		: fakeModel;
	const benchFile = join(workdir, "bench.txt");
	writeFileSync(benchFile, filler(TOOL_RESULT_BYTES, 0));
	const conversation: AgentMessage[] = [
		{
			id: "msg_prompt",
			role: "user",
			createdAt: 0,
			content: [{ type: "text", text: "Benchmark the recorder." }],
		},
	];
	const perCallRecordMs: number[] = [];
	recorder?.onRuntimeEvent(runtimeEvent({ type: "run-started" }));
	const started = performance.now();
	for (let iteration = 1; iteration <= iterations; iteration += 1) {
		const before = recorder?.stats().recordMs ?? 0;
		recorder?.onRuntimeEvent(runtimeEvent({ type: "turn-started", iteration }));
		await drain(
			await model.stream({
				systemPrompt: SYSTEM_PROMPT,
				tools: TOOLS,
				messages: rebuild(conversation, iteration),
				options: {
					metadata: { agentId: "agent_bench", runId: "run_bench", iteration },
				},
			}),
		);
		const assistant = assistantMessage(iteration);
		recorder?.onAssistantMessageAssembled(assistant);
		recorder?.onRuntimeEvent(
			runtimeEvent({
				type: "assistant-message",
				iteration,
				message: assistant,
				finishReason: "tool-calls",
			}),
		);
		const toolCall = assistant.content[1] as AgentBeforeToolContext["toolCall"];
		recorder?.onRuntimeEvent(
			runtimeEvent({ type: "tool-started", iteration, toolCall }),
		);
		const tool = toolMessage(iteration);
		if (recorder) {
			const context = {
				snapshot: {},
				tool: { name: "read_files" },
				toolCall,
				input: { files: [{ path: benchFile }] },
				result: { output: "ok" },
			} as unknown as AgentBeforeToolContext & AgentAfterToolContext;
			await recorder.beforeTool(context);
			await recorder.afterTool(context);
			recorder.onRuntimeEvent(
				runtimeEvent({
					type: "tool-finished",
					iteration,
					toolCall,
					message: tool,
				}),
			);
		}
		conversation.push(assistant, tool);
		perCallRecordMs.push((recorder?.stats().recordMs ?? 0) - before);
		// Let buffered writes run between iterations, as they would while a
		// real tool or the next model call is awaited.
		await yieldToIo();
	}
	return { ms: performance.now() - started, perCallRecordMs };
}

function average(values: number[]): number {
	return values.length === 0
		? 0
		: values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fileBytes(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

async function measure(iterations: number): Promise<RunResult> {
	const workdir = mkdtempSync(join(tmpdir(), "recording-bench-"));
	try {
		const baseline = await runLoop(iterations, workdir);
		const dir = join(workdir, "session", "recording");
		const recorder = await SessionRecorder.open({
			sessionId: "bench",
			dir,
			cwd: workdir,
		});
		recorder.startSegment({
			leadAgentId: "agent_bench",
			initialMessageCount: 0,
			mode: "act",
		});
		const recorded = await runLoop(iterations, workdir, recorder);
		const closeStarted = performance.now();
		await recorder.close();
		const closeMs = performance.now() - closeStarted;
		const stats = recorder.stats();
		const tenth = Math.max(1, Math.floor(iterations / 10));
		const lastRequest = [
			SYSTEM_PROMPT,
			TOOLS,
			Array.from({ length: iterations - 1 }, (_, index) => [
				assistantMessage(index + 1),
				toolMessage(index + 1),
			]),
		];
		return {
			iterations,
			baselineMs: baseline.ms,
			recordedMs: recorded.ms,
			closeMs,
			recordMs: stats.recordMs,
			writeMs: stats.writeMs,
			recordMsFirst10Pct: average(recorded.perCallRecordMs.slice(0, tenth)),
			recordMsLast10Pct: average(recorded.perCallRecordMs.slice(-tenth)),
			lastRequestBytes: Buffer.byteLength(JSON.stringify(lastRequest)),
			fullRequestBytes: stats.fullRequestBytes,
			bytes: {
				"recording.json": fileBytes(join(dir, "recording.json")),
				"requests.jsonl": fileBytes(join(dir, "requests.jsonl")),
				"blobs.jsonl": fileBytes(join(dir, "blobs.jsonl")),
				"events.jsonl": fileBytes(join(dir, "events.jsonl")),
			},
			blobs: stats.blobs,
			blobsDeduplicated: stats.blobsDeduplicated,
		};
	} finally {
		rmSync(workdir, { recursive: true, force: true });
	}
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const ms = (value: number) => `${value.toFixed(1)} ms`;

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const json = args.includes("--json");
	const counts = args
		.filter((arg) => /^\d+$/.test(arg))
		.map((arg) => Number.parseInt(arg, 10));
	const results: RunResult[] = [];
	for (const iterations of counts.length > 0 ? counts : [100, 300, 600]) {
		results.push(await measure(iterations));
	}
	if (json) {
		console.log(JSON.stringify(results, null, 2));
		return;
	}
	console.log(
		`Synthetic session: ${SYSTEM_PROMPT_BYTES / 1000} KB system prompt, ${TOOL_COUNT} tools (~${Math.round(Buffer.byteLength(JSON.stringify(TOOLS)) / 1000)} KB), +1 assistant message and +1 ~${TOOL_RESULT_BYTES / 1000} KB tool result per iteration, ${ASSISTANT_TEXT_CHUNKS + 3} stream events per response.`,
	);
	for (const result of results) {
		const onDisk = Object.values(result.bytes).reduce((a, b) => a + b, 0);
		console.log(`\n${result.iterations} iterations`);
		console.log(
			`  wall: ${ms(result.baselineMs)} unrecorded vs ${ms(result.recordedMs)} recorded (+${ms((result.recordedMs - result.baselineMs) / result.iterations)} per call), close/flush ${ms(result.closeMs)}`,
		);
		console.log(
			`  recorder CPU (hash + serialize): ${ms(result.recordMs)} total, ${ms(result.recordMsFirst10Pct)}/call in the first 10%, ${ms(result.recordMsLast10Pct)}/call in the last 10%`,
		);
		const otherMs = result.recordedMs - result.baselineMs - result.recordMs;
		console.log(
			`  everything else (file writes, tool-file hashing, scheduling): ${ms(otherMs)} total, ${ms(otherMs / result.iterations)}/call; the async write chain was pending for ${ms(result.writeMs)} of wall time, overlapping the loop`,
		);
		console.log(
			`  on disk: ${mb(onDisk)} (${Object.entries(result.bytes)
				.map(([name, bytes]) => `${name} ${mb(bytes)}`)
				.join(", ")})`,
		);
		console.log(
			`  request bodies if stored whole: ${mb(result.fullRequestBytes)} (${(result.fullRequestBytes / Math.max(1, result.bytes["blobs.jsonl"] ?? 1)).toFixed(0)}x the blob store); last request ${mb(result.lastRequestBytes)}`,
		);
		console.log(
			`  blobs: ${result.blobs} stored, ${result.blobsDeduplicated} deduplicated references`,
		);
	}
}

await main();
