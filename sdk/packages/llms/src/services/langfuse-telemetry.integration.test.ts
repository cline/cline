import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { markOtlpTraceRelayProvider } from "@cline/shared";
import { context, trace } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	disposeLangfuseTelemetry,
	resetLangfuseTelemetryForTests,
	resolveAiSdkTelemetry,
} from "./langfuse-telemetry";

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

async function runStream(
	telemetry = { isEnabled: true } as Awaited<
		ReturnType<typeof resolveAiSdkTelemetry>
	>,
) {
	const result = streamText({
		model: new MockLanguageModelV4({
			provider: "cline",
			modelId: "test-model",
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] });
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
		telemetry,
	});
	await result.consumeStream();
	expect(await result.text).toBe("private completion");
}

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
