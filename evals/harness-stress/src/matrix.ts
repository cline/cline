#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type {
	AgentModelEvent,
	AgentToolDefinition,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { createOpenAICompatibleProvider } from "../../../sdk/packages/llms/src/providers/ai-sdk.ts";
import {
	profileSpecs,
	replayModel,
	replaySpecFromModel,
	requiresExtremeOptIn,
} from "./scenario-spec.mjs";
import { createHarnessServer } from "./server.mjs";

interface MatrixArguments {
	profile: "ci" | "large" | "extreme";
	allowExtreme: boolean;
	output?: string;
	timeoutMs: number;
	maxDurationMs: number;
	maxPeakRssBytes: number;
	failOnAlert: boolean;
}

interface ScenarioSpec {
	version: 1;
	scenario: string;
	seed: number;
	size: number;
	chunkBytes: number;
	delayMs: number;
	rounds: number;
	parallel: number;
}

interface MatrixResult {
	model: string;
	spec: ScenarioSpec;
	status: "passed" | "failed";
	durationMs: number;
	textBytes: number;
	toolCallCount: number;
	peakHeapDeltaBytes: number;
	peakRssDeltaBytes: number;
	endHeapDeltaWithResultBytes: number;
	endRssDeltaWithResultBytes: number;
	error?: string;
	alerts: string[];
	replayCommand: string;
}

interface ProviderScenarioOutput {
	finishReason?: string;
	textBytes: number;
	toolCalls: Array<Extract<AgentModelEvent, { type: "tool-call-delta" }>>;
}

const args = parseArguments(process.argv.slice(2));
if (args.profile === "extreme" && !args.allowExtreme && !args.model) {
	throw new Error(
		"The extreme profile can intentionally allocate and stream tens of MiB. Pass --allow-extreme explicitly.",
	);
}

const server = await createHarnessServer({
	port: 0,
	allowExtreme: args.allowExtreme,
	// The provider-only matrix parses callbacks but never executes them.
	allowUnreachableReplayCallbacks: true,
});
const results: MatrixResult[] = [];

try {
	const specs = args.model
		? [replaySpecFromModel(args.model) as ScenarioSpec | undefined]
		: (profileSpecs(args.profile) as ScenarioSpec[]);
	if (specs.some((spec) => spec === undefined)) {
		throw new Error(`--model must be a canonical harness/replay-... model ID`);
	}
	for (const spec of specs as ScenarioSpec[]) {
		if (spec.rounds !== 1) {
			throw new Error(
				`The provider-only matrix does not execute continuation rounds; replay ${spec.rounds} rounds through an IDE/CLI host instead`,
			);
		}
		const isExtreme = requiresExtremeOptIn(spec);
		if (isExtreme && !args.allowExtreme) {
			throw new Error(
				`Replay ${replayModel(spec)} requires --allow-extreme because of its resource profile`,
			);
		}
		const modelId = replayModel(spec);
		const replayCommand =
			`npm --prefix evals run harness:matrix -- --model ${modelId}` +
			(isExtreme ? " --allow-extreme" : "");
		const before = process.memoryUsage();
		let peakHeapUsed = before.heapUsed;
		let peakRss = before.rss;
		const memorySampler = setInterval(() => {
			const current = process.memoryUsage();
			peakHeapUsed = Math.max(peakHeapUsed, current.heapUsed);
			peakRss = Math.max(peakRss, current.rss);
		}, 10);
		const startedAt = performance.now();
		try {
			const events = await runProviderScenario(
				server.origin,
				modelId,
				spec,
				args.timeoutMs,
			);
			const measurement = assertScenario(events, spec);
			const after = process.memoryUsage();
			peakHeapUsed = Math.max(peakHeapUsed, after.heapUsed);
			peakRss = Math.max(peakRss, after.rss);
			const durationMs = round(performance.now() - startedAt);
			const peakRssDeltaBytes = peakRss - before.rss;
			const alerts = pressureAlerts({
				durationMs,
				peakRssDeltaBytes,
				maxDurationMs: args.maxDurationMs,
				maxPeakRssBytes: args.maxPeakRssBytes,
			});
			results.push({
				model: modelId,
				spec,
				status: "passed",
				durationMs,
				...measurement,
				peakHeapDeltaBytes: peakHeapUsed - before.heapUsed,
				peakRssDeltaBytes,
				endHeapDeltaWithResultBytes: after.heapUsed - before.heapUsed,
				endRssDeltaWithResultBytes: after.rss - before.rss,
				alerts,
				replayCommand,
			});
		} catch (error) {
			const after = process.memoryUsage();
			peakHeapUsed = Math.max(peakHeapUsed, after.heapUsed);
			peakRss = Math.max(peakRss, after.rss);
			results.push({
				model: modelId,
				spec,
				status: "failed",
				durationMs: round(performance.now() - startedAt),
				textBytes: 0,
				toolCallCount: 0,
				peakHeapDeltaBytes: peakHeapUsed - before.heapUsed,
				peakRssDeltaBytes: peakRss - before.rss,
				endHeapDeltaWithResultBytes: after.heapUsed - before.heapUsed,
				endRssDeltaWithResultBytes: after.rss - before.rss,
				error:
					error instanceof Error
						? (error.stack ?? error.message)
						: String(error),
				alerts: [],
				replayCommand,
			});
		} finally {
			clearInterval(memorySampler);
		}
		const result = results.at(-1);
		if (!result) throw new Error("Matrix scenario produced no result");
		printResult(result);
	}
} finally {
	await server.close();
}

const report = {
	version: 1,
	createdAt: new Date().toISOString(),
	profile: args.profile,
	runtime: {
		node: process.version,
		...(typeof Bun !== "undefined" ? { bun: Bun.version } : {}),
		platform: process.platform,
		arch: process.arch,
	},
	summary: {
		passed: results.filter((result) => result.status === "passed").length,
		failed: results.filter((result) => result.status === "failed").length,
		alerts: results.reduce((total, result) => total + result.alerts.length, 0),
	},
	results,
};

if (args.output) {
	await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report.summary)}\n`);
if (
	report.summary.failed > 0 ||
	(args.failOnAlert && report.summary.alerts > 0)
) {
	process.exitCode = 1;
}

async function runProviderScenario(
	origin: string,
	modelId: string,
	spec: ScenarioSpec,
	timeoutMs: number,
): Promise<ProviderScenarioOutput> {
	const config = {
		providerId: "openai-compatible",
		apiKey: "harness",
		baseUrl: `${origin}/v1`,
	};
	const model = { id: modelId, providerId: "openai-compatible", name: modelId };
	const context = {
		provider: {
			id: "openai-compatible",
			name: "OpenAI Compatible",
			defaultModelId: model.id,
			models: [model],
		},
		model,
		config,
	} as GatewayProviderContext;
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new Error(`Scenario exceeded ${timeoutMs}ms`)),
		timeoutMs,
	);
	try {
		const provider = await createOpenAICompatibleProvider(config);
		const request = {
			providerId: "openai-compatible",
			modelId,
			messages: [
				{
					id: "msg_user",
					role: "user",
					content: [
						{ type: "text", text: "Run deterministic pressure scenario" },
					],
					createdAt: new Date(0),
				},
			],
			tools: toolsForSpec(spec),
			signal: controller.signal,
		} as GatewayStreamRequest;
		const output: ProviderScenarioOutput = {
			textBytes: 0,
			toolCalls: [],
		};
		for await (const event of await provider.stream(request, context)) {
			if (event.type === "text-delta") {
				output.textBytes += Buffer.byteLength(event.text);
			} else if (
				event.type === "tool-call-delta" &&
				event.input !== undefined
			) {
				output.toolCalls.push(event);
			} else if (event.type === "finish") {
				output.finishReason = event.reason;
			}
		}
		return output;
	} finally {
		clearTimeout(timer);
	}
}

function toolsForSpec(spec: ScenarioSpec): AgentToolDefinition[] {
	if (spec.scenario === "editor-old-text") {
		return [
			{
				name: "editor",
				description: "Edit a deterministic fixture",
				inputSchema: {
					type: "object",
					properties: {
						path: { type: "string" },
						old_text: { type: "string" },
						new_text: { type: "string" },
					},
					required: ["path", "old_text", "new_text"],
				},
			},
		];
	}
	return [
		{
			name: "run_commands",
			description: "Run safe commands",
			inputSchema: {
				type: "object",
				properties: {
					commands: { type: "array", items: { type: "string" } },
					harness_padding: { type: "string" },
				},
				required: ["commands"],
			},
		},
	];
}

function assertScenario(output: ProviderScenarioOutput, spec: ScenarioSpec) {
	if (!output.finishReason) throw new Error("Provider emitted no finish event");
	if (spec.scenario === "text") {
		if (output.finishReason !== "stop") {
			throw new Error(`Text scenario finished with ${output.finishReason}`);
		}
		if (output.textBytes !== spec.size) {
			throw new Error(
				`Expected ${spec.size} text bytes, received ${output.textBytes}`,
			);
		}
		return { textBytes: output.textBytes, toolCallCount: 0 };
	}
	if (output.finishReason !== "tool-calls") {
		throw new Error(`Tool scenario finished with ${output.finishReason}`);
	}
	const calls = output.toolCalls;
	const expectedCalls = spec.scenario === "parallel-tools" ? spec.parallel : 1;
	if (calls.length !== expectedCalls) {
		throw new Error(
			`Expected ${expectedCalls} parsed tool calls, received ${calls.length}`,
		);
	}
	const expectedToolName =
		spec.scenario === "editor-old-text" ? "editor" : "run_commands";
	const callIds = new Set<string>();
	for (const call of calls) {
		if (call.toolName !== expectedToolName) {
			throw new Error(
				`Expected tool ${expectedToolName}, received ${String(call.toolName)}`,
			);
		}
		if (!call.toolCallId || callIds.has(call.toolCallId)) {
			throw new Error(
				`Tool call ID is missing or duplicated: ${String(call.toolCallId)}`,
			);
		}
		callIds.add(call.toolCallId);
	}
	if (spec.scenario === "tool-arguments") {
		const padding = (calls[0]?.input as { harness_padding?: unknown })
			?.harness_padding;
		if (
			typeof padding !== "string" ||
			Buffer.byteLength(padding) !== spec.size
		) {
			throw new Error(`Tool padding did not preserve ${spec.size} bytes`);
		}
	}
	if (spec.scenario === "editor-old-text") {
		const oldText = (calls[0]?.input as { old_text?: unknown })?.old_text;
		if (
			typeof oldText !== "string" ||
			Buffer.byteLength(oldText) !== spec.size
		) {
			throw new Error(`Editor old_text did not preserve ${spec.size} bytes`);
		}
		const input = calls[0]?.input as { path?: unknown; new_text?: unknown };
		if (
			input.path !== "deterministic-harness-fixture.txt" ||
			typeof input.new_text !== "string"
		) {
			throw new Error(
				"Editor input did not preserve the fixture path and replacement",
			);
		}
	} else {
		for (const call of calls) {
			const commands = (call.input as { commands?: unknown })?.commands;
			if (
				!Array.isArray(commands) ||
				commands.length !== 1 ||
				typeof commands[0] !== "string" ||
				!/^node -e "fetch\('http:\/\/127\.0\.0\.1:4319\/__harness\/marker\?/.test(
					commands[0],
				)
			) {
				throw new Error(
					"run_commands input did not preserve the fixed callback command",
				);
			}
		}
	}
	return { textBytes: 0, toolCallCount: calls.length };
}

function parseArguments(argv: string[]): MatrixArguments & { model?: string } {
	const result: MatrixArguments & { model?: string } = {
		profile: "ci",
		allowExtreme: false,
		timeoutMs: 30_000,
		maxDurationMs: 2_000,
		maxPeakRssBytes: 256 * 1024 * 1024,
		failOnAlert: false,
	};
	for (let index = 0; index < argv.length; index++) {
		const value = argv[index];
		if (value === "--profile") {
			result.profile = requiredValue(
				argv,
				++index,
				value,
			) as MatrixArguments["profile"];
		} else if (value === "--output") {
			result.output = requiredValue(argv, ++index, value);
		} else if (value === "--timeout-ms") {
			result.timeoutMs = positiveInteger(requiredValue(argv, ++index, value));
		} else if (value === "--allow-extreme") {
			result.allowExtreme = true;
		} else if (value === "--fail-on-alert") {
			result.failOnAlert = true;
		} else if (value === "--max-duration-ms") {
			result.maxDurationMs = positiveInteger(
				requiredValue(argv, ++index, value),
			);
		} else if (value === "--max-peak-rss-mib") {
			result.maxPeakRssBytes =
				positiveInteger(requiredValue(argv, ++index, value)) * 1024 * 1024;
		} else if (value === "--model") {
			result.model = requiredValue(argv, ++index, value);
		} else {
			throw new Error(`Unknown argument: ${value}`);
		}
	}
	return result;
}

function requiredValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function positiveInteger(value: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(
			`Expected a positive integer, received ${JSON.stringify(value)}`,
		);
	}
	return parsed;
}

function printResult(result: MatrixResult): void {
	process.stdout.write(
		`${result.status.toUpperCase()} ${result.spec.scenario} ${result.durationMs}ms ` +
			`peakRssDelta=${formatBytes(result.peakRssDeltaBytes)} replay=${result.model}\n`,
	);
	if (result.error) process.stderr.write(`${result.error}\n`);
	for (const alert of result.alerts) {
		process.stderr.write(
			`PRESSURE ALERT: ${alert}\nReplay: ${result.replayCommand}\n`,
		);
	}
}

function pressureAlerts(input: {
	durationMs: number;
	peakRssDeltaBytes: number;
	maxDurationMs: number;
	maxPeakRssBytes: number;
}): string[] {
	const alerts: string[] = [];
	if (input.durationMs > input.maxDurationMs) {
		alerts.push(
			`duration ${input.durationMs}ms exceeded ${input.maxDurationMs}ms`,
		);
	}
	if (input.peakRssDeltaBytes > input.maxPeakRssBytes) {
		alerts.push(
			`sampled peak RSS delta ${formatBytes(input.peakRssDeltaBytes)} exceeded ${formatBytes(input.maxPeakRssBytes)}`,
		);
	}
	return alerts;
}

function formatBytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)}MiB`;
}

function round(value: number): number {
	return Math.round(value * 1_000) / 1_000;
}
