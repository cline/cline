import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registerDisposableSpy, registerTelemetrySpy, telemetryStartSpy } =
	vi.hoisted(() => ({
		registerDisposableSpy: vi.fn(),
		registerTelemetrySpy: vi.fn(),
		telemetryStartSpy: vi.fn(),
	}));

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return {
		...actual,
		registerTelemetry: (
			...integrations: Parameters<typeof actual.registerTelemetry>
		) => {
			registerTelemetrySpy(...integrations);
			actual.registerTelemetry(...integrations);
		},
	};
});

vi.mock("@ai-sdk/otel", () => ({
	OpenTelemetry: class MockOpenTelemetry {
		onStart = telemetryStartSpy;
	},
}));

const { addSpanProcessorSpy, forceFlushSpy, shutdownSpy, getDelegateSpy } =
	vi.hoisted(() => ({
		addSpanProcessorSpy: vi.fn(),
		forceFlushSpy: vi.fn(async () => undefined),
		shutdownSpy: vi.fn(async () => undefined),
		getDelegateSpy: vi.fn(),
	}));

class MockNodeTracerProvider {
	register = vi.fn();
}

vi.mock("@cline/shared", () => ({
	registerDisposable: registerDisposableSpy,
}));

vi.mock("@langfuse/otel", () => ({
	LangfuseSpanProcessor: class MockLangfuseSpanProcessor {},
}));

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracerProvider: () => ({
			addSpanProcessor: addSpanProcessorSpy,
			getDelegate: getDelegateSpy,
		}),
	},
}));

vi.mock("@opentelemetry/sdk-trace-node", () => ({
	NodeTracerProvider: MockNodeTracerProvider,
}));

import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
	disposeLangfuseTelemetry,
	ensureLangfuseTelemetry,
	resetLangfuseTelemetryForTests,
} from "./langfuse-telemetry";

describe("langfuse telemetry", () => {
	beforeEach(() => {
		resetLangfuseTelemetryForTests();
		registerDisposableSpy.mockReset();
		registerTelemetrySpy.mockReset();
		telemetryStartSpy.mockReset();
		addSpanProcessorSpy.mockReset();
		forceFlushSpy.mockReset();
		forceFlushSpy.mockResolvedValue(undefined);
		shutdownSpy.mockReset();
		shutdownSpy.mockResolvedValue(undefined);
		getDelegateSpy.mockReset();
		getDelegateSpy.mockReturnValue({
			constructor: { name: "NodeTracerProvider" },
			forceFlush: forceFlushSpy,
			shutdown: shutdownSpy,
		});
		process.env.LANGFUSE_BASE_URL = "https://langfuse.example";
		process.env.LANGFUSE_PUBLIC_KEY = "public-key";
		process.env.LANGFUSE_SECRET_KEY = "secret-key";
	});

	afterEach(() => {
		delete process.env.LANGFUSE_BASE_URL;
		delete process.env.LANGFUSE_PUBLIC_KEY;
		delete process.env.LANGFUSE_SECRET_KEY;
		resetLangfuseTelemetryForTests();
	});

	it("enables telemetry for non-cline providers when langfuse config is available", async () => {
		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(true);
		await expect(ensureLangfuseTelemetry("cline")).resolves.toBe(true);

		expect(registerDisposableSpy).toHaveBeenCalledTimes(1);
		expect(addSpanProcessorSpy).toHaveBeenCalledTimes(1);
		expect(registerTelemetrySpy).toHaveBeenCalledTimes(1);
		expect(registerTelemetrySpy).toHaveBeenCalledWith(expect.any(Object));
	});

	it("flushes before shutdown during disposal", async () => {
		await disposeLangfuseTelemetry();

		expect(forceFlushSpy).toHaveBeenCalledTimes(1);
		expect(shutdownSpy).toHaveBeenCalledTimes(1);
		expect(forceFlushSpy.mock.invocationCallOrder[0]).toBeLessThan(
			shutdownSpy.mock.invocationCallOrder[0],
		);
	});

	it("connects an AI SDK call to the registered telemetry integration", async () => {
		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(true);

		await generateText({
			model: new MockLanguageModelV4({
				doGenerate: {
					content: [{ type: "text", text: "hello" }],
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
					warnings: [],
				},
			}),
			prompt: "say hello",
			experimental_telemetry: { isEnabled: true },
		});

		expect(telemetryStartSpy).toHaveBeenCalled();
	});
});
