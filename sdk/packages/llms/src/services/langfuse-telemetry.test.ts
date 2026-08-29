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

vi.mock("@langfuse/vercel-ai-sdk", () => ({
	LangfuseVercelAiSdkIntegration: class MockLangfuseVercelAiSdkIntegration {
		onStart = telemetryStartSpy;
	},
}));

const {
	addSpanProcessorSpy,
	forceFlushSpy,
	shutdownSpy,
	getDelegateSpy,
	getTracerProviderSpy,
	registeredGlobalProvider,
} = vi.hoisted(() => ({
	addSpanProcessorSpy: vi.fn(),
	forceFlushSpy: vi.fn(async () => undefined),
	shutdownSpy: vi.fn(async () => undefined),
	getDelegateSpy: vi.fn(),
	getTracerProviderSpy: vi.fn(),
	registeredGlobalProvider: { current: undefined as unknown },
}));

class MockNodeTracerProvider {
	// Mirrors OpenTelemetry's registerGlobal semantics: the first
	// registration wins and later ones are silently ignored.
	register = vi.fn(() => {
		registeredGlobalProvider.current ??= this;
	});
}

vi.mock("@cline/shared", () => ({
	registerDisposable: registerDisposableSpy,
}));

vi.mock("@langfuse/otel", () => ({
	LangfuseSpanProcessor: class MockLangfuseSpanProcessor {},
}));

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracerProvider: getTracerProviderSpy,
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
		registeredGlobalProvider.current = undefined;
		getTracerProviderSpy.mockReturnValue({
			addSpanProcessor: addSpanProcessorSpy,
			getDelegate: getDelegateSpy,
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

	it("recognizes a directly registered tracer provider", async () => {
		getTracerProviderSpy.mockReturnValue({
			addSpanProcessor: addSpanProcessorSpy,
		});

		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(true);
		expect(addSpanProcessorSpy).toHaveBeenCalledTimes(1);
		expect(registerTelemetrySpy).toHaveBeenCalledTimes(1);
	});

	it("registers its own provider when minification renames the proxy provider", async () => {
		// Simulates the compiled release binary: the ProxyTracerProvider and
		// its no-op delegate carry mangled constructor names, expose no
		// addSpanProcessor, and only reflect a registration through
		// getDelegate.
		getTracerProviderSpy.mockReturnValue({
			constructor: { name: "Zt" },
			getDelegate: () =>
				registeredGlobalProvider.current ?? { constructor: { name: "Qn" } },
		});

		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(true);
		expect(registeredGlobalProvider.current).toBeInstanceOf(
			MockNodeTracerProvider,
		);
		expect(registerTelemetrySpy).toHaveBeenCalledTimes(1);
	});

	it("attaches to an already registered tracer provider through its delegate", async () => {
		getTracerProviderSpy.mockReturnValue({
			getDelegate: () => ({ addSpanProcessor: addSpanProcessorSpy }),
		});

		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(true);
		expect(addSpanProcessorSpy).toHaveBeenCalledTimes(1);
		expect(registerTelemetrySpy).toHaveBeenCalledTimes(1);
	});

	it("disables telemetry when a foreign provider owns the slot and accepts no processors", async () => {
		getTracerProviderSpy.mockReturnValue({
			getDelegate: () => ({
				forceFlush: forceFlushSpy,
				shutdown: shutdownSpy,
			}),
		});

		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(false);
		expect(registerTelemetrySpy).not.toHaveBeenCalled();
	});

	it("disables telemetry when the global slot rejects the registration", async () => {
		// The delegate never reflects the attempted registration, matching an
		// API whose global slot is stuck with an inert owner.
		getTracerProviderSpy.mockReturnValue({
			getDelegate: () => ({ constructor: { name: "SomethingInert" } }),
		});

		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(false);
		expect(registerTelemetrySpy).not.toHaveBeenCalled();
	});

	it("connects an AI SDK 7 call to the registered telemetry integration", async () => {
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
			telemetry: { isEnabled: true },
		});

		expect(telemetryStartSpy).toHaveBeenCalled();
	});
});
