import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	registerDisposableSpy,
	spanProcessorConfigSpy,
	integrationOptionsSpy,
	telemetryStartSpy,
	tracerProviderInstances,
} = vi.hoisted(() => ({
	registerDisposableSpy: vi.fn(),
	spanProcessorConfigSpy: vi.fn(),
	integrationOptionsSpy: vi.fn(),
	telemetryStartSpy: vi.fn(),
	tracerProviderInstances: [] as Array<{
		forceFlush: ReturnType<typeof vi.fn>;
		shutdown: ReturnType<typeof vi.fn>;
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
	getTracer = vi.fn(() => ({ name: "mock-langfuse-tracer" }));

	constructor(_options: unknown) {
		tracerProviderInstances.push(this);
	}
}

vi.mock("@opentelemetry/sdk-trace-node", () => ({
	NodeTracerProvider: MockNodeTracerProvider,
}));

import {
	DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL,
	type LangfuseTelemetryConfig,
} from "@cline/shared";
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
	"CLINE_PROVIDER_LANGFUSE_PUBLIC_KEY",
	"CLINE_PROVIDER_LANGFUSE_SECRET_KEY",
	"OTEL_SERVICE_NAME",
] as const;

const genericConfig: LangfuseTelemetryConfig = {
	baseUrl: "https://generic.langfuse.example",
	publicKey: "generic-public-key",
	secretKey: "generic-secret-key",
};
const clineProviderConfig: LangfuseTelemetryConfig = {
	baseUrl: DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL,
	publicKey: "cline-public-key",
	secretKey: "cline-secret-key",
};
const featureFlagConfig: LangfuseTelemetryConfig = {
	baseUrl: "https://us.cloud.langfuse.com",
	publicKey: "flag-public-key",
	secretKey: "flag-secret-key",
};
const untrustedClineRuntimeConfig: LangfuseTelemetryConfig = {
	baseUrl: "http://untrusted-langfuse.example",
	publicKey: "runtime-public-key",
	secretKey: "runtime-secret-key",
};

let originalEnvironment: Partial<Record<(typeof ENV_KEYS)[number], string>>;

function setGenericEnvironment(): void {
	process.env.LANGFUSE_BASE_URL = genericConfig.baseUrl;
	process.env.LANGFUSE_PUBLIC_KEY = genericConfig.publicKey;
	process.env.LANGFUSE_SECRET_KEY = genericConfig.secretKey;
}

function setClineProviderEnvironment(): void {
	process.env.CLINE_PROVIDER_LANGFUSE_PUBLIC_KEY =
		clineProviderConfig.publicKey;
	process.env.CLINE_PROVIDER_LANGFUSE_SECRET_KEY =
		clineProviderConfig.secretKey;
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

	it("uses only the unprefixed environment for third-party providers", async () => {
		setGenericEnvironment();
		setClineProviderEnvironment();

		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBeDefined();

		expect(spanProcessorConfigSpy).toHaveBeenCalledOnce();
		expect(spanProcessorConfigSpy).toHaveBeenCalledWith(genericConfig);
	});

	it.each([
		"cline",
		"cline-pass",
	])("uses the Cline-provider credential pair at the fixed endpoint for %s", async (providerId) => {
		setGenericEnvironment();
		setClineProviderEnvironment();

		await expect(ensureLangfuseTelemetry(providerId)).resolves.toBeDefined();

		expect(spanProcessorConfigSpy).toHaveBeenCalledWith(clineProviderConfig);
	});

	it.each([
		"cline",
		"cline-pass",
	])("falls back to the unprefixed environment for %s when no prefixed variables are set", async (providerId) => {
		setGenericEnvironment();

		await expect(ensureLangfuseTelemetry(providerId)).resolves.toBeDefined();

		expect(spanProcessorConfigSpy).toHaveBeenCalledWith(genericConfig);
	});

	it.each([
		["CLINE_PROVIDER_LANGFUSE_PUBLIC_KEY", "partial-public-key"],
		["CLINE_PROVIDER_LANGFUSE_SECRET_KEY", "partial-secret-key"],
	] as const)("fails closed when only %s is configured", async (key, value) => {
		setGenericEnvironment();
		process.env[key] = value;

		await expect(ensureLangfuseTelemetry("cline")).resolves.toBeUndefined();

		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
	});

	it("uses in-memory feature-flag credentials ahead of either environment", async () => {
		setGenericEnvironment();
		setClineProviderEnvironment();

		await expect(
			ensureLangfuseTelemetry("cline", featureFlagConfig),
		).resolves.toBeDefined();

		expect(spanProcessorConfigSpy).toHaveBeenCalledWith(featureFlagConfig);
	});

	it.each([
		"cline",
		"cline-pass",
	])("pins caller-supplied configs to the fixed HTTPS endpoint for %s", async (providerId) => {
		setGenericEnvironment();

		await expect(
			ensureLangfuseTelemetry(providerId, untrustedClineRuntimeConfig),
		).resolves.toBeDefined();

		expect(spanProcessorConfigSpy).toHaveBeenCalledWith({
			...untrustedClineRuntimeConfig,
			baseUrl: DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL,
		});
	});

	it("ignores Cline feature-flag credentials for third-party providers", async () => {
		setGenericEnvironment();

		await expect(
			ensureLangfuseTelemetry("openrouter", featureFlagConfig),
		).resolves.toBeDefined();

		expect(spanProcessorConfigSpy).toHaveBeenCalledWith(genericConfig);
	});

	it.each([
		["cline", "openrouter"],
		["openrouter", "cline"],
	])("isolates generic and Cline-provider exporters when initialized as %s then %s", async (firstProvider, secondProvider) => {
		setGenericEnvironment();
		setClineProviderEnvironment();

		const first = await ensureLangfuseTelemetry(firstProvider);
		const second = await ensureLangfuseTelemetry(secondProvider);

		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(first).not.toBe(second);
		expect(spanProcessorConfigSpy.mock.calls.map(([config]) => config)).toEqual(
			expect.arrayContaining([genericConfig, clineProviderConfig]),
		);
		expect(tracerProviderInstances).toHaveLength(2);
		expect(registerDisposableSpy).toHaveBeenCalledOnce();
	});

	it("reuses one isolated exporter when providers resolve to the same config", async () => {
		setGenericEnvironment();

		const clineIntegration = await ensureLangfuseTelemetry("cline");
		const thirdPartyIntegration = await ensureLangfuseTelemetry("openrouter");

		expect(clineIntegration).toBe(thirdPartyIntegration);
		expect(tracerProviderInstances).toHaveLength(1);
	});

	it("deduplicates concurrent initialization for one credential set", async () => {
		setGenericEnvironment();

		const [first, second] = await Promise.all([
			ensureLangfuseTelemetry("cline"),
			ensureLangfuseTelemetry("openrouter"),
		]);

		expect(first).toBe(second);
		expect(tracerProviderInstances).toHaveLength(1);
		expect(registerDisposableSpy).toHaveBeenCalledOnce();
	});

	it("flushes every exporter before shutting any exporter down", async () => {
		setGenericEnvironment();
		setClineProviderEnvironment();
		await ensureLangfuseTelemetry("cline");
		await ensureLangfuseTelemetry("openrouter");

		await disposeLangfuseTelemetry();

		for (const provider of tracerProviderInstances) {
			expect(provider.forceFlush).toHaveBeenCalledOnce();
			expect(provider.shutdown).toHaveBeenCalledOnce();
		}
		const lastFlushOrder = Math.max(
			...tracerProviderInstances.map(
				(provider) => provider.forceFlush.mock.invocationCallOrder[0] ?? 0,
			),
		);
		const firstShutdownOrder = Math.min(
			...tracerProviderInstances.map(
				(provider) => provider.shutdown.mock.invocationCallOrder[0] ?? 0,
			),
		);
		expect(lastFlushOrder).toBeLessThan(firstShutdownOrder);
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

		expect(integrationOptionsSpy).toHaveBeenCalledWith({
			tracer: { name: "mock-langfuse-tracer" },
		});
		expect(telemetryStartSpy).toHaveBeenCalled();
	});

	it("disables telemetry when the unprefixed environment is incomplete", async () => {
		process.env.LANGFUSE_BASE_URL = genericConfig.baseUrl;
		process.env.LANGFUSE_PUBLIC_KEY = genericConfig.publicKey;

		await expect(
			ensureLangfuseTelemetry("openrouter"),
		).resolves.toBeUndefined();

		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
	});
});
