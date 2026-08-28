import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	registerDisposableSpy,
	spanProcessorConfigSpy,
	integrationOptionsSpy,
	telemetryStartSpy,
	globalGetTracerSpy,
	getDelegateSpy,
	setGlobalContextManagerSpy,
	tracerProviderInstances,
} = vi.hoisted(() => ({
	registerDisposableSpy: vi.fn(),
	spanProcessorConfigSpy: vi.fn(),
	integrationOptionsSpy: vi.fn(),
	telemetryStartSpy: vi.fn(),
	globalGetTracerSpy: vi.fn(() => ({ name: "managed-global-tracer" })),
	getDelegateSpy: vi.fn(),
	setGlobalContextManagerSpy: vi.fn(() => true),
	tracerProviderInstances: [] as Array<{
		forceFlush: ReturnType<typeof vi.fn>;
		shutdown: ReturnType<typeof vi.fn>;
		getTracer: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("@cline/shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/shared")>()),
	registerDisposable: registerDisposableSpy,
}));

vi.mock("@langfuse/otel", () => ({
	LangfuseSpanProcessor: class MockLangfuseSpanProcessor {
		constructor(config: unknown) {
			spanProcessorConfigSpy(config);
		}
	},
}));

vi.mock("@langfuse/vercel-ai-sdk", () => ({
	LangfuseVercelAiSdkIntegration: class MockLangfuseVercelAiSdkIntegration {
		onStart = telemetryStartSpy;

		constructor(options: unknown) {
			integrationOptionsSpy(options);
		}
	},
}));

class MockNodeTracerProvider {
	forceFlush = vi.fn(async () => undefined);
	shutdown = vi.fn(async () => undefined);
	getTracer = vi.fn(() => ({ name: "direct-langfuse-tracer" }));

	constructor(_options: unknown) {
		tracerProviderInstances.push(this);
	}
}

vi.mock("@opentelemetry/sdk-trace-node", () => ({
	NodeTracerProvider: MockNodeTracerProvider,
}));

vi.mock("@opentelemetry/api", () => ({
	context: {
		setGlobalContextManager: setGlobalContextManagerSpy,
	},
	trace: {
		getTracer: globalGetTracerSpy,
		getTracerProvider: () => ({
			constructor: { name: "ProxyTracerProvider" },
			getDelegate: getDelegateSpy,
		}),
	},
}));

vi.mock("@opentelemetry/context-async-hooks", () => ({
	AsyncLocalStorageContextManager: class MockContextManager {
		enable() {
			return this;
		}
		disable() {}
	},
}));

import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
	disposeLangfuseTelemetry,
	ensureLangfuseTelemetry,
	resetLangfuseTelemetryForTests,
} from "./langfuse-telemetry";

const ENV_KEYS = [
	"LANGFUSE_BASE_URL",
	"LANGFUSE_PUBLIC_KEY",
	"LANGFUSE_SECRET_KEY",
	"CLINE_PROVIDER_LANGFUSE_ENABLED",
	"OTEL_SERVICE_NAME",
] as const;

const genericConfig = {
	baseUrl: "https://generic.langfuse.example",
	publicKey: "generic-public-key",
	secretKey: "generic-secret-key",
};

let originalEnvironment: Partial<Record<(typeof ENV_KEYS)[number], string>>;

function setGenericEnvironment(): void {
	process.env.LANGFUSE_BASE_URL = genericConfig.baseUrl;
	process.env.LANGFUSE_PUBLIC_KEY = genericConfig.publicKey;
	process.env.LANGFUSE_SECRET_KEY = genericConfig.secretKey;
}

function enableManagedBuild(): void {
	process.env.CLINE_PROVIDER_LANGFUSE_ENABLED = "true";
}

describe("langfuse telemetry", () => {
	beforeEach(() => {
		originalEnvironment = {};
		for (const key of ENV_KEYS) {
			const value = process.env[key];
			if (value !== undefined) originalEnvironment[key] = value;
			delete process.env[key];
		}
		resetLangfuseTelemetryForTests();
		registerDisposableSpy.mockReset();
		spanProcessorConfigSpy.mockReset();
		integrationOptionsSpy.mockReset();
		telemetryStartSpy.mockReset();
		globalGetTracerSpy.mockClear();
		getDelegateSpy.mockReset();
		getDelegateSpy.mockReturnValue({
			constructor: { name: "NodeTracerProvider" },
		});
		setGlobalContextManagerSpy.mockClear();
		tracerProviderInstances.length = 0;
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			const value = originalEnvironment[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetLangfuseTelemetryForTests();
	});

	it.each([
		"cline",
		"cline-pass",
	])("uses the existing global OTLP tracer without Langfuse credentials for %s", async (providerId) => {
		enableManagedBuild();
		setGenericEnvironment();

		await expect(
			ensureLangfuseTelemetry(providerId, { langfuse: true }),
		).resolves.toBeDefined();

		expect(globalGetTracerSpy).toHaveBeenCalledWith("cline-provider-langfuse");
		expect(integrationOptionsSpy).toHaveBeenCalledWith({
			tracer: { name: "managed-global-tracer" },
		});
		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
		expect(tracerProviderInstances).toHaveLength(0);
		expect(registerDisposableSpy).not.toHaveBeenCalled();
	});

	it("requires both the boolean rollout and the non-secret build capability", async () => {
		setGenericEnvironment();

		await expect(
			ensureLangfuseTelemetry("cline", { langfuse: true }),
		).resolves.toBeUndefined();

		expect(integrationOptionsSpy).not.toHaveBeenCalled();
		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
	});

	it("respects a host telemetry opt-out without falling back to direct credentials", async () => {
		enableManagedBuild();
		setGenericEnvironment();

		await expect(
			ensureLangfuseTelemetry("cline", { langfuse: true }, false),
		).resolves.toBeUndefined();

		expect(globalGetTracerSpy).not.toHaveBeenCalled();
		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
	});

	it("fails closed when managed telemetry is requested before a global tracer is active", async () => {
		enableManagedBuild();
		setGenericEnvironment();
		getDelegateSpy.mockReturnValue(undefined);

		await expect(
			ensureLangfuseTelemetry("cline", { langfuse: true }),
		).resolves.toBeUndefined();

		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
		expect(integrationOptionsSpy).not.toHaveBeenCalled();
	});

	it("ignores managed routing for third-party providers", async () => {
		enableManagedBuild();
		setGenericEnvironment();

		await expect(
			ensureLangfuseTelemetry("openrouter", { langfuse: true }),
		).resolves.toBeDefined();

		expect(spanProcessorConfigSpy).toHaveBeenCalledWith(genericConfig);
		expect(tracerProviderInstances).toHaveLength(1);
		expect(globalGetTracerSpy).not.toHaveBeenCalled();
	});

	it.each([
		"cline",
		"cline-pass",
	])("falls back to direct LANGFUSE_* configuration for %s when managed routing is absent", async (providerId) => {
		setGenericEnvironment();

		await expect(ensureLangfuseTelemetry(providerId)).resolves.toBeDefined();

		expect(spanProcessorConfigSpy).toHaveBeenCalledWith(genericConfig);
		expect(registerDisposableSpy).toHaveBeenCalledOnce();
	});

	it("reuses a single managed integration for Cline and ClinePass", async () => {
		enableManagedBuild();

		const first = await ensureLangfuseTelemetry("cline", { langfuse: true });
		const second = await ensureLangfuseTelemetry("cline-pass", {
			langfuse: true,
		});

		expect(first).toBe(second);
		expect(integrationOptionsSpy).toHaveBeenCalledOnce();
	});

	it("reuses one isolated exporter for direct providers with the same configuration", async () => {
		setGenericEnvironment();

		const first = await ensureLangfuseTelemetry("openrouter");
		const second = await ensureLangfuseTelemetry("cline");

		expect(first).toBe(second);
		expect(tracerProviderInstances).toHaveLength(1);
		expect(registerDisposableSpy).toHaveBeenCalledOnce();
	});

	it("flushes and shuts down only the isolated direct exporters", async () => {
		enableManagedBuild();
		setGenericEnvironment();
		await ensureLangfuseTelemetry("cline", { langfuse: true });
		await ensureLangfuseTelemetry("openrouter");

		await disposeLangfuseTelemetry();

		expect(tracerProviderInstances).toHaveLength(1);
		expect(tracerProviderInstances[0]?.forceFlush).toHaveBeenCalledOnce();
		expect(tracerProviderInstances[0]?.shutdown).toHaveBeenCalledOnce();
		expect(
			tracerProviderInstances[0]?.forceFlush.mock.invocationCallOrder[0],
		).toBeLessThan(
			tracerProviderInstances[0]?.shutdown.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("connects an AI SDK 7 call to the selected per-call integration", async () => {
		setGenericEnvironment();
		const integration = await ensureLangfuseTelemetry("openrouter");
		expect(integration).toBeDefined();

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
			telemetry: {
				isEnabled: true,
				integrations: integration,
			},
		});

		expect(telemetryStartSpy).toHaveBeenCalled();
	});

	it("disables direct telemetry when the unprefixed environment is incomplete", async () => {
		process.env.LANGFUSE_BASE_URL = genericConfig.baseUrl;
		process.env.LANGFUSE_PUBLIC_KEY = genericConfig.publicKey;

		await expect(
			ensureLangfuseTelemetry("openrouter"),
		).resolves.toBeUndefined();

		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
	});
});
