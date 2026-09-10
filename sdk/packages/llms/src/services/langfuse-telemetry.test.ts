import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	registerDisposable: vi.fn(),
	registerTelemetry: vi.fn(),
	telemetryStart: vi.fn(),
	setTracerProvider: vi.fn(),
	forceFlush: vi.fn(async () => undefined),
	shutdown: vi.fn(async () => undefined),
	processorConstructor: vi.fn(),
	providerConstructor: vi.fn(),
}));

vi.mock("@cline/shared", () => ({
	registerDisposable: mocks.registerDisposable,
}));

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return {
		...actual,
		registerTelemetry: (...integrations: unknown[]) => {
			mocks.registerTelemetry(...integrations);
			actual.registerTelemetry(...(integrations as never));
		},
	};
});

vi.mock("@langfuse/otel", () => ({
	LangfuseSpanProcessor: class MockLangfuseSpanProcessor {
		constructor(config: unknown) {
			mocks.processorConstructor(config);
		}
	},
}));

vi.mock("@langfuse/tracing", () => ({
	propagateAttributes: async (_attributes: unknown, callback: () => unknown) =>
		await callback(),
	setLangfuseTracerProvider: mocks.setTracerProvider,
}));

vi.mock("@langfuse/vercel-ai-sdk", () => ({
	LangfuseVercelAiSdkIntegration: class MockIntegration {
		onStart = mocks.telemetryStart;
	},
}));

vi.mock("@opentelemetry/sdk-trace-node", () => ({
	NodeTracerProvider: class MockNodeTracerProvider {
		forceFlush = mocks.forceFlush;
		shutdown = mocks.shutdown;
		constructor(config: unknown) {
			mocks.providerConstructor(config);
		}
	},
}));

import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
	activateLangfuseTelemetry,
	createLangfuseTelemetryIntegration,
	disableLangfuseTelemetry,
	disposeLangfuseTelemetry,
	ensureLangfuseTelemetry,
	resetLangfuseTelemetryForTests,
} from "./langfuse-telemetry";

describe("langfuse telemetry", () => {
	beforeEach(() => {
		resetLangfuseTelemetryForTests();
		for (const mock of Object.values(mocks)) mock.mockClear();
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

	it("creates a processor for a host-owned provider without creating a provider", () => {
		const integration = createLangfuseTelemetryIntegration();
		expect(integration?.spanProcessor).toBeDefined();
		expect(mocks.processorConstructor).toHaveBeenCalledWith({
			baseUrl: "https://langfuse.example",
			publicKey: "public-key",
			secretKey: "secret-key",
		});
		expect(mocks.providerConstructor).not.toHaveBeenCalled();
	});

	it("activates shared-provider AI SDK telemetry only once", () => {
		activateLangfuseTelemetry();
		activateLangfuseTelemetry();
		expect(mocks.registerTelemetry).toHaveBeenCalledTimes(1);
	});

	it("creates and owns an isolated provider for standalone use", async () => {
		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(true);
		expect(mocks.providerConstructor).toHaveBeenCalledTimes(1);
		expect(mocks.setTracerProvider).toHaveBeenCalledWith(expect.any(Object));
		expect(mocks.registerDisposable).toHaveBeenCalledTimes(1);

		await disposeLangfuseTelemetry();
		expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
		expect(mocks.shutdown).toHaveBeenCalledTimes(1);
		expect(mocks.setTracerProvider).toHaveBeenLastCalledWith(null);
	});

	it("does not use the standalone fallback after a host disables telemetry", async () => {
		disableLangfuseTelemetry();
		await expect(ensureLangfuseTelemetry("cline")).resolves.toBe(false);
		expect(mocks.providerConstructor).not.toHaveBeenCalled();
		expect(mocks.registerTelemetry).not.toHaveBeenCalled();
	});

	it("does not dispose a host-owned provider", async () => {
		activateLangfuseTelemetry();
		await disposeLangfuseTelemetry();
		expect(mocks.forceFlush).not.toHaveBeenCalled();
		expect(mocks.shutdown).not.toHaveBeenCalled();
	});

	it("connects an AI SDK 7 call to the registered integration", async () => {
		activateLangfuseTelemetry();
		await generateText({
			model: new MockLanguageModelV4({
				doGenerate: {
					content: [{ type: "text", text: "hello" }],
					finishReason: { unified: "stop", raw: "stop" },
					usage: {
						inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 1, text: 1, reasoning: 0 },
					},
					warnings: [],
				},
			}),
			prompt: "say hello",
			telemetry: { isEnabled: true },
		});
		expect(mocks.telemetryStart).toHaveBeenCalled();
	});
});
