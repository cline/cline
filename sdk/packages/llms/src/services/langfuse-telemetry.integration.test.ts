import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { APICallError } from "@ai-sdk/provider";
import { markOtlpTraceRelayProvider } from "@cline/shared";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { jsonSchema, streamText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	disposeLangfuseTelemetry,
	resetLangfuseTelemetryForTests,
	resolveAiSdkTelemetry,
} from "./langfuse-telemetry";
import { createStreamErrorTelemetry } from "./stream-error-telemetry";

const { settingsPath, directExporters } = vi.hoisted(() => ({
	settingsPath: { current: "" },
	directExporters: [] as InMemorySpanExporter[],
}));
vi.mock("@cline/shared/storage", () => ({
	resolveGlobalSettingsPath: () => settingsPath.current,
}));
// Keep the real AI SDK, Langfuse integration and OTel runtime. Replace only
// the network exporter so credentialed direct-path tests cannot send data.
vi.mock("@langfuse/otel", async () => {
	const { InMemorySpanExporter, SimpleSpanProcessor } = await import(
		"@opentelemetry/sdk-trace-node"
	);
	return {
		LangfuseSpanProcessor: class extends SimpleSpanProcessor {
			constructor() {
				const exporter = new InMemorySpanExporter();
				super(exporter);
				directExporters.push(exporter);
			}
		},
	};
});
let settingsDir: string;

let provider: NodeTracerProvider;
let exporter: InMemorySpanExporter;

beforeEach(() => {
	settingsDir = mkdtempSync(path.join(tmpdir(), "cline-relay-"));
	settingsPath.current = path.join(settingsDir, "settings.json");
	directExporters.length = 0;
	vi.stubEnv("OTEL_SERVICE_NAME", "");
	vi.stubEnv("LANGFUSE_BASE_URL", "");
	vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
	vi.stubEnv("LANGFUSE_SECRET_KEY", "");
	vi.stubEnv("CLINE_TRACE_SAMPLE_PERCENT", "100");
	vi.stubEnv("CLINE_TRACE_RECORD_CONTENT", "false");
	trace.disable();
	context.disable();
	resetLangfuseTelemetryForTests();
	exporter = new InMemorySpanExporter();
	provider = new NodeTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	markOtlpTraceRelayProvider(provider);
	provider.register();
});

afterEach(async () => {
	await disposeLangfuseTelemetry();
	rmSync(settingsDir, { recursive: true, force: true });
	await provider.shutdown();
	trace.disable();
	context.disable();
	resetLangfuseTelemetryForTests();
	vi.unstubAllEnvs();
});

it.each([
	["relay", "error part"],
	["relay", "reader rejection"],
	["direct", "error part"],
	["direct", "reader rejection"],
	["relay", "timeout abort"],
	["relay", "caller abort"],
	["direct", "timeout abort"],
	["direct", "caller abort"],
])("exports %s %s with the correct Langfuse observation status", async (route, failure) => {
	if (route === "direct") {
		trace.disable();
		context.disable();
		vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example");
		vi.stubEnv("LANGFUSE_PUBLIC_KEY", "public-key");
		vi.stubEnv("LANGFUSE_SECRET_KEY", "secret-key");
	}
	const error = failure.endsWith("abort")
		? new DOMException(
				"test abort",
				failure === "timeout abort" ? "TimeoutError" : "AbortError",
			)
		: Object.assign(
				new Error("The socket connection was closed unexpectedly"),
				{
					code: "ConnectionClosed",
				},
			);
	const { telemetry, recordError } = createStreamErrorTelemetry(
		await resolveAiSdkTelemetry("cline", "socket-test"),
	);
	let index = 0;
	const abortController = new AbortController();
	const result = streamText({
		model: new MockLanguageModelV4({
			provider: "cline",
			modelId: "socket-test",
			doStream: async () => ({
				stream: new ReadableStream({
					pull(controller) {
						switch (index++) {
							case 0:
								controller.enqueue({ type: "stream-start", warnings: [] });
								break;
							case 1:
								controller.enqueue({ type: "text-start", id: "text" });
								break;
							case 2:
								controller.enqueue({
									type: "text-delta",
									id: "text",
									delta: "partial output",
								});
								break;
							default:
								if (failure.endsWith("abort")) {
									abortController.abort(error);
									controller.enqueue({
										type: "text-delta",
										id: "text",
										delta: "discarded",
									});
								} else if (failure === "reader rejection")
									controller.error(error);
								else {
									controller.enqueue({ type: "error", error });
									controller.close();
								}
						}
					},
				}),
			}),
		}),
		prompt: "test",
		abortSignal: abortController.signal,
		telemetry,
		onError: ({ error }) => recordError(error),
	});
	// A failed stream also rejects its result promises.
	for (const promise of [
		result.usage,
		result.totalUsage,
		result.finishReason,
		result.steps,
		result.text,
		result.response,
	]) {
		promise.catch(() => {});
	}
	try {
		for await (const part of result.fullStream) {
			if (part.type === "error") await recordError(part.error);
		}
	} catch (error) {
		await recordError(error);
	}
	await provider.forceFlush();
	const errorExporter = route === "direct" ? directExporters[0] : exporter;
	expect(errorExporter).toBeDefined();
	const spans = errorExporter?.getFinishedSpans() ?? [];
	expect(spans.length).toBeGreaterThan(0);
	expect(
		spans.every(
			(span) =>
				span.status.code ===
				(failure === "caller abort"
					? SpanStatusCode.UNSET
					: SpanStatusCode.ERROR),
		),
	).toBe(true);
	expect(
		spans.some((span) =>
			span.events.some(
				(event) =>
					event.name === "exception" &&
					event.attributes?.["exception.message"] === error.message,
			),
		),
	).toBe(failure !== "caller abort");
	const count = spans.length;
	await recordError(error);
	await provider.forceFlush();
	expect(errorExporter?.getFinishedSpans()).toHaveLength(count);
});

it.each([
	["relay", "AbortError"],
	["direct", "AbortError"],
	["relay", "TimeoutError"],
	["direct", "TimeoutError"],
] as const)("handles %s %s while the provider request is opening", async (route, name) => {
	if (route === "direct") {
		trace.disable();
		context.disable();
		vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example");
		vi.stubEnv("LANGFUSE_PUBLIC_KEY", "public-key");
		vi.stubEnv("LANGFUSE_SECRET_KEY", "secret-key");
	}
	const controller = new AbortController();
	const reason = new DOMException("request stopped before response", name);
	const { telemetry, recordError } = createStreamErrorTelemetry(
		await resolveAiSdkTelemetry("cline", "opening-request"),
	);
	let calls = 0;
	const result = streamText({
		model: new MockLanguageModelV4({
			provider: "cline",
			modelId: "opening-request",
			doStream: ({ abortSignal }) => {
				calls++;
				return new Promise((_, reject) => {
					abortSignal?.addEventListener(
						"abort",
						() => reject(abortSignal.reason),
						{ once: true },
					);
					queueMicrotask(() => controller.abort(reason));
				});
			},
		}),
		prompt: "test",
		abortSignal: controller.signal,
		maxRetries: 3,
		telemetry,
		onError: ({ error }) => recordError(error),
	});
	for (const promise of [
		result.text,
		result.usage,
		result.totalUsage,
		result.finishReason,
		result.steps,
		result.response,
	])
		promise.catch(() => {});
	await result.consumeStream();
	await provider.forceFlush();
	expect(calls).toBe(1);
	const spans = (
		route === "direct" ? directExporters[0] : exporter
	).getFinishedSpans();
	expect(spans.some((span) => span.name === "chat opening-request")).toBe(true);
	expect(spans.some((span) => !span.parentSpanContext)).toBe(true);
	for (const span of spans) {
		expect(span.status.code).toBe(
			name === "AbortError" ? SpanStatusCode.UNSET : SpanStatusCode.ERROR,
		);
		expect(span.events.some((event) => event.name === "exception")).toBe(
			name === "TimeoutError",
		);
	}
});

it.each([
	["relay", 2, true],
	["relay", 4, true],
	["relay", 2, false],
	["relay", 4, false],
	["direct", 2, true],
	["direct", 4, true],
	["direct", 2, false],
	["direct", 4, false],
] as const)("exports %s attempts after %s failures (finish event: %s)", async (route, failures, hasFinish) => {
	if (route === "direct") {
		trace.disable();
		context.disable();
		vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example");
		vi.stubEnv("LANGFUSE_PUBLIC_KEY", "public-key");
		vi.stubEnv("LANGFUSE_SECRET_KEY", "secret-key");
	}
	let calls = 0;
	const streamTelemetry = createStreamErrorTelemetry(
		await resolveAiSdkTelemetry("cline", "retry-test"),
	);
	const result = streamText({
		model: new MockLanguageModelV4({
			provider: "cline",
			modelId: "retry-test",
			doStream: async () => {
				// Every earlier attempt must already be exported before issuing a retry.
				const completed = (route === "direct" ? directExporters[0] : exporter)
					.getFinishedSpans()
					.filter((span) => span.name === "chat retry-test");
				expect(completed).toHaveLength(calls);
				const fail = calls++ < failures;
				return {
					stream: new ReadableStream({
						start(controller) {
							controller.enqueue({ type: "stream-start", warnings: [] });
							if (fail)
								controller.enqueue({
									type: "error",
									error: {
										message: "upstream timeout",
										type: "timeout_error",
										code: "504",
									},
								});
							else {
								controller.enqueue({ type: "text-start", id: "text" });
								controller.enqueue({
									type: "text-delta",
									id: "text",
									delta: "recovered",
								});
								controller.enqueue({ type: "text-end", id: "text" });
							}
							if (!fail || hasFinish)
								controller.enqueue({
									type: "finish",
									finishReason: {
										unified: fail ? "error" : "stop",
										raw: undefined,
									},
									usage: {
										inputTokens: {
											total: 1,
											noCache: 1,
											cacheRead: 0,
											cacheWrite: 0,
										},
										outputTokens: { total: 1, text: 1, reasoning: 0 },
									},
								});
							controller.close();
						},
					}),
				};
			},
		}),
		prompt: "test",
		streamRetries: 3,
		maxRetries: 0,
		telemetry: streamTelemetry.telemetry,
		onError: async ({ error }) => {
			// The SDK may read the finish event ahead of a slower error consumer.
			await new Promise<void>((resolve) => setImmediate(resolve));
			streamTelemetry.captureError(error);
		},
	});
	for (const promise of [
		result.usage,
		result.totalUsage,
		result.finishReason,
		result.steps,
		result.text,
		result.response,
	])
		promise.catch(() => {});
	// Let the producer complete before the event consumer reports errors.
	await result.text.catch(() => {});
	expect(streamTelemetry.getCallId()).toEqual(expect.any(String));
	const errors: unknown[] = [];
	for await (const part of result.fullStream) {
		if (part.type === "error") {
			errors.push(part.error);
			await streamTelemetry.recordError(part.error);
		}
	}
	await provider.forceFlush();
	expect(calls).toBe(failures === 2 ? 3 : 4);
	expect(errors).toHaveLength(failures === 2 ? 0 : 1);
	const spans = (
		route === "direct" ? directExporters[0] : exporter
	).getFinishedSpans();
	const attempts = spans.filter((span) => span.name === "chat retry-test");
	expect(attempts).toHaveLength(calls);
	expect(
		attempts.filter((span) => span.status.code === SpanStatusCode.ERROR),
	).toHaveLength(Math.min(failures, 4));
	const roots = spans.filter((span) => !span.parentSpanContext);
	expect(roots).toHaveLength(1);
	expect(roots[0]?.status.code).toBe(
		failures === 2 ? SpanStatusCode.UNSET : SpanStatusCode.ERROR,
	);
});

it.each([
	["relay", 2],
	["relay", 4],
	["direct", 2],
	["direct", 4],
] as const)("exports %s request-start errors before retrying (%s failures)", async (route, failures) => {
	if (route === "direct") {
		trace.disable();
		context.disable();
		vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example");
		vi.stubEnv("LANGFUSE_PUBLIC_KEY", "public-key");
		vi.stubEnv("LANGFUSE_SECRET_KEY", "secret-key");
	}
	const spanExporter = () =>
		route === "direct" ? directExporters[0] : exporter;
	const attempts = () =>
		spanExporter()
			.getFinishedSpans()
			.filter((span) => span.name === "chat request-retry-test");
	const socketError = new APICallError({
		message:
			"Cannot connect to API: The socket connection was closed unexpectedly",
		url: "https://provider.example/chat",
		requestBodyValues: {},
		isRetryable: true,
		responseHeaders: { "retry-after-ms": "0" },
	});
	let calls = 0;
	const telemetry = createStreamErrorTelemetry(
		await resolveAiSdkTelemetry("cline", "request-retry-test"),
	);
	const result = streamText({
		model: new MockLanguageModelV4({
			provider: "cline",
			modelId: "request-retry-test",
			doStream: async () => {
				// Failed attempts must be exported before the next provider call.
				expect(attempts()).toHaveLength(calls);
				if (calls++ < failures) throw socketError;
				return {
					stream: new ReadableStream({
						start(controller) {
							controller.enqueue({ type: "text-start", id: "text" });
							controller.enqueue({
								type: "text-delta",
								id: "text",
								delta: "recovered",
							});
							controller.enqueue({ type: "text-end", id: "text" });
							controller.enqueue({
								type: "finish",
								finishReason: { unified: "stop", raw: undefined },
								usage: {
									inputTokens: {
										total: 1,
										noCache: 1,
										cacheRead: 0,
										cacheWrite: 0,
									},
									outputTokens: { total: 1, text: 1, reasoning: 0 },
								},
							});
							controller.close();
						},
					}),
				};
			},
		}),
		prompt: "test",
		maxRetries: 3,
		telemetry: telemetry.telemetry,
		onError: () => {},
	});
	for (const promise of [
		result.text,
		result.usage,
		result.totalUsage,
		result.finishReason,
		result.steps,
		result.response,
	])
		promise.catch(() => {});
	const errors: unknown[] = [];
	for await (const part of result.fullStream)
		if (part.type === "error") errors.push(part.error);
	await provider.forceFlush();
	expect(calls).toBe(failures === 2 ? 3 : 4);
	expect(errors).toHaveLength(failures === 2 ? 0 : 1);
	const failedAttempts = attempts().filter(
		(span) => span.status.code === SpanStatusCode.ERROR,
	);
	expect(failedAttempts).toHaveLength(failures);
	for (const span of failedAttempts) {
		expect(span.status.message).toBe(socketError.message);
		expect(
			span.events.filter((event) => event.name === "exception"),
		).toHaveLength(1);
	}
	const roots = spanExporter()
		.getFinishedSpans()
		.filter((span) => !span.parentSpanContext);
	expect(roots).toHaveLength(1);
	expect(roots[0]?.status.code).toBe(
		failures === 2 ? SpanStatusCode.UNSET : SpanStatusCode.ERROR,
	);
	if (failures === 2) expect(await result.text).toBe("recovered");
});

async function runStream(
	telemetry = { isEnabled: true } as Awaited<
		ReturnType<typeof resolveAiSdkTelemetry>
	>,
	withTool = false,
) {
	const result = streamText({
		model: new MockLanguageModelV4({
			provider: "cline",
			modelId: "test-model",
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] });
						if (withTool) {
							controller.enqueue({
								type: "tool-call",
								toolCallId: "synthetic-call",
								toolName: "synthetic_tool",
								input: "{}",
							});
						}
						controller.enqueue({ type: "text-start", id: "text-1" });
						controller.enqueue({
							type: "text-delta",
							id: "text-1",
							delta: "private completion",
						});
						controller.enqueue({ type: "text-end", id: "text-1" });
						controller.enqueue({
							type: "finish",
							finishReason: { unified: "stop", raw: "stop" },
							usage: {
								inputTokens: {
									total: 1,
									noCache: 1,
									cacheRead: 0,
									cacheWrite: 0,
								},
								outputTokens: { total: 1, text: 1, reasoning: 0 },
							},
						});
						controller.close();
					},
				}),
			}),
		}),
		prompt: "private prompt",
		tools: withTool
			? {
					synthetic_tool: tool({
						inputSchema: jsonSchema<Record<string, never>>({
							type: "object",
							properties: {},
							additionalProperties: false,
						}),
						execute: async () => "synthetic result",
					}),
				}
			: undefined,
		telemetry,
	});
	await result.consumeStream();
	expect(await result.text).toBe("private completion");
}

it("preserves the collector scope contract on generation, step, and tool children", async () => {
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"), true);
	await provider.forceFlush();
	const spans = exporter.getFinishedSpans();
	expect(spans.some((span) => span.name.startsWith("chat "))).toBe(true);
	expect(spans.some((span) => span.name.startsWith("step "))).toBe(true);
	expect(spans.some((span) => span.name.includes("synthetic_tool"))).toBe(true);
	expect(
		spans.every(
			(span) => span.instrumentationScope.name === "cline-provider-langfuse",
		),
	).toBe(true);
	expect(
		spans.every((span) => span.attributes["ai.model.provider"] === undefined),
	).toBe(true);
	expect(
		spans.some((span) => span.attributes["gen_ai.provider.name"] === "cline"),
	).toBe(true);
	expect(
		spans.some((span) => span.attributes["gen_ai.provider.name"] === undefined),
	).toBe(true);
	const ids = new Set(spans.map((span) => span.spanContext().spanId));
	expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(1);
	for (const span of spans) {
		if (span.parentSpanContext)
			expect(ids.has(span.parentSpanContext.spanId)).toBe(true);
	}

	// Opt-in fixture regeneration for cline/infra; ordinary tests never write files.
	// These spans contain synthetic data only. Keep IDs, scope and child structure.
	const fixturePath = process.env.CLINE_RELAY_FIXTURE_PATH;
	if (fixturePath) {
		const nanos = ([seconds, fraction]: [number, number]) =>
			(BigInt(seconds) * 1_000_000_000n + BigInt(fraction)).toString();
		const fixture = {
			resourceSpans: [
				{
					resource: {},
					scopeSpans: [
						{
							scope: { name: "cline-provider-langfuse" },
							spans: spans.map((span) => ({
								traceId: span.spanContext().traceId,
								spanId: span.spanContext().spanId,
								...(span.parentSpanContext
									? { parentSpanId: span.parentSpanContext.spanId }
									: {}),
								name: span.name,
								kind: span.kind + 1,
								startTimeUnixNano: nanos(span.startTime),
								endTimeUnixNano: nanos(span.endTime),
								attributes: Object.entries(span.attributes)
									.filter(
										(entry): entry is [string, string] =>
											typeof entry[1] === "string",
									)
									.map(([key, value]) => ({
										key,
										value: { stringValue: value },
									})),
							})),
						},
					],
				},
			],
		};
		writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
	}
});

it("exports AI SDK 7 stream spans through the host relay without Langfuse credentials", async () => {
	const telemetry = await resolveAiSdkTelemetry("cline", "task-a");
	expect(telemetry.isEnabled).toBe(true);
	await runStream(telemetry);
	await provider.forceFlush();
	const spans = exporter.getFinishedSpans();
	expect(spans.length).toBeGreaterThan(0);
	expect(
		spans.some((span) => span.attributes["gen_ai.provider.name"] === "cline"),
	).toBe(true);
	expect(
		spans.every(
			(span) => span.instrumentationScope.name === "cline-provider-langfuse",
		),
	).toBe(true);
	const attributes = JSON.stringify(spans.map((span) => span.attributes));
	expect(attributes).not.toContain("private prompt");
	expect(attributes).not.toContain("private completion");
});

it("records prompt and completion only when the content flag is enabled", async () => {
	vi.stubEnv("CLINE_TRACE_RECORD_CONTENT", "true");
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"));
	await provider.forceFlush();
	const attributes = JSON.stringify(
		exporter.getFinishedSpans().map((span) => span.attributes),
	);
	expect(attributes).toContain("private prompt");
	expect(attributes).toContain("private completion");
});

it("stops emitting after a mid-session opt-out", async () => {
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"));
	await provider.forceFlush();
	const initialCount = exporter.getFinishedSpans().length;
	expect(initialCount).toBeGreaterThan(0);
	writeFileSync(
		settingsPath.current,
		JSON.stringify({ telemetryOptOut: true }),
	);
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"));
	await provider.forceFlush();
	expect(exporter.getFinishedSpans()).toHaveLength(initialCount);
});

it("emits no spans for an excluded provider or a sampled-out task", async () => {
	await runStream(await resolveAiSdkTelemetry("openrouter", "task-a"));
	vi.stubEnv("CLINE_TRACE_SAMPLE_PERCENT", "50");
	await runStream(await resolveAiSdkTelemetry("cline", "task-c"));
	await provider.forceFlush();
	expect(exporter.getFinishedSpans()).toHaveLength(0);
});

it("reacquires the host tracer after provider replacement", async () => {
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"));
	await provider.forceFlush();
	expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
	const oldExporter = exporter;
	await provider.shutdown();
	trace.disable();
	exporter = new InMemorySpanExporter();
	provider = new NodeTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	markOtlpTraceRelayProvider(provider);
	provider.register();
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"));
	await provider.forceFlush();
	expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
	expect(oldExporter.getFinishedSpans()).toHaveLength(0);
});

it("exports directly without claiming or shutting down a non-relay host tracer", async () => {
	delete (provider as unknown as Record<string, unknown>)._clineOtlpTraceRelay;
	vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example");
	vi.stubEnv("LANGFUSE_PUBLIC_KEY", "public-key");
	vi.stubEnv("LANGFUSE_SECRET_KEY", "secret-key");
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"));
	expect(directExporters).toHaveLength(1);
	expect(directExporters[0]?.getFinishedSpans().length).toBeGreaterThan(0);
	expect(exporter.getFinishedSpans()).toHaveLength(0);
	// A different AI SDK caller must not inherit our direct integration.
	const directCount = directExporters[0]?.getFinishedSpans().length;
	await runStream();
	expect(directExporters[0]?.getFinishedSpans()).toHaveLength(directCount ?? 0);
	await disposeLangfuseTelemetry();
	trace.getTracer("host").startSpan("host still alive").end();
	await provider.forceFlush();
	expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
		"host still alive",
	]);
});

it("chooses only the host relay when direct credentials are also present", async () => {
	vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example");
	vi.stubEnv("LANGFUSE_PUBLIC_KEY", "public-key");
	vi.stubEnv("LANGFUSE_SECRET_KEY", "secret-key");
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"));
	await provider.forceFlush();
	expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
	expect(directExporters).toHaveLength(0);
});

it("keeps direct stream spans in one trace without a preinstalled host context manager", async () => {
	trace.disable();
	context.disable();
	vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example");
	vi.stubEnv("LANGFUSE_PUBLIC_KEY", "public-key");
	vi.stubEnv("LANGFUSE_SECRET_KEY", "secret-key");
	await runStream(await resolveAiSdkTelemetry("cline", "task-a"));
	const spans = directExporters[0]?.getFinishedSpans() ?? [];
	expect(spans.length).toBeGreaterThan(1);
	expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(1);
	expect(
		trace.getTracer("unrelated").startSpan("unrelated").isRecording(),
	).toBe(false);
});
