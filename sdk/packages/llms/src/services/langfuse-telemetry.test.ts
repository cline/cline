import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	registerDisposableSpy,
	spanProcessorConfigSpy,
	integrationOptionsSpy,
	telemetryStartSpy,
	globalGetTracerSpy,
	getDelegateSpy,
	getTracerProviderSpy,
	forceFlushSpy,
	shutdownSpy,
	setGlobalContextManagerSpy,
	tracerProviderInstances,
} = vi.hoisted(() => ({
	registerDisposableSpy: vi.fn(),
	spanProcessorConfigSpy: vi.fn(),
	integrationOptionsSpy: vi.fn(),
	telemetryStartSpy: vi.fn(),
	globalGetTracerSpy: vi.fn(() => ({ name: "managed-global-tracer" })),
	getDelegateSpy: vi.fn(),
	getTracerProviderSpy: vi.fn(),
	forceFlushSpy: vi.fn(),
	shutdownSpy: vi.fn(),
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
		getTracerProvider: getTracerProviderSpy,
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

const { globalSettingsPathRef } = vi.hoisted(() => ({
	globalSettingsPathRef: { current: "/nonexistent/cline-global-settings.json" },
}));
vi.mock("@cline/shared/storage", () => ({
	resolveGlobalSettingsPath: () => globalSettingsPathRef.current,
}));

import {
	disposeLangfuseTelemetry,
	resetLangfuseTelemetryForTests,
	resolveAiSdkTelemetry,
} from "./langfuse-telemetry";

const genericConfig = {
	baseUrl: "https://langfuse.example",
	publicKey: "public-key",
	secretKey: "secret-key",
};

describe("langfuse telemetry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetLangfuseTelemetryForTests();
		tracerProviderInstances.length = 0;
		getDelegateSpy.mockReturnValue(undefined);
		getTracerProviderSpy.mockReturnValue({ getDelegate: getDelegateSpy });
		vi.stubEnv("LANGFUSE_BASE_URL", genericConfig.baseUrl);
		vi.stubEnv("LANGFUSE_PUBLIC_KEY", genericConfig.publicKey);
		vi.stubEnv("LANGFUSE_SECRET_KEY", genericConfig.secretKey);
		vi.stubEnv("CLINE_TRACE_SAMPLE_PERCENT", "");
		vi.stubEnv("CLINE_TRACE_RECORD_CONTENT", "");
		vi.stubEnv("OTEL_SERVICE_NAME", "");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		globalSettingsPathRef.current = "/nonexistent/cline-global-settings.json";
		resetLangfuseTelemetryForTests();
	});

	it("keeps third-party providers disabled before and after direct initialization", async () => {
		await expect(resolveAiSdkTelemetry("openrouter")).resolves.toEqual({
			isEnabled: false,
		});
		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
		await expect(resolveAiSdkTelemetry("cline")).resolves.toEqual({
			isEnabled: true,
			integrations: expect.any(Object),
		});
		await expect(resolveAiSdkTelemetry("openrouter")).resolves.toEqual({
			isEnabled: false,
		});
		expect(spanProcessorConfigSpy).toHaveBeenCalledOnce();
	});

	it("shares one isolated exporter between concurrent Cline backend requests", async () => {
		const [first, second] = await Promise.all([
			resolveAiSdkTelemetry("cline"),
			resolveAiSdkTelemetry("cline-pass"),
		]);
		expect(first.integrations).toBeDefined();
		expect(first.integrations).toBe(second.integrations);
		expect(tracerProviderInstances).toHaveLength(1);
		expect(spanProcessorConfigSpy).toHaveBeenCalledWith(genericConfig);
		expect(registerDisposableSpy).toHaveBeenCalledOnce();
	});

	it("uses direct credentials even when a non-relay host owns an immutable tracer", async () => {
		getDelegateSpy.mockReturnValue({
			forceFlush: forceFlushSpy,
			shutdown: shutdownSpy,
		});
		const decision = await resolveAiSdkTelemetry("cline");
		expect(decision.isEnabled).toBe(true);
		expect(integrationOptionsSpy).toHaveBeenCalledWith({
			tracer: { name: "direct-langfuse-tracer" },
		});
		await disposeLangfuseTelemetry();
		expect(forceFlushSpy).not.toHaveBeenCalled();
		expect(shutdownSpy).not.toHaveBeenCalled();
		expect(tracerProviderInstances[0]?.forceFlush).toHaveBeenCalledOnce();
		expect(tracerProviderInstances[0]?.shutdown).toHaveBeenCalledOnce();
		expect(
			tracerProviderInstances[0]?.forceFlush.mock.invocationCallOrder[0],
		).toBeLessThan(
			tracerProviderInstances[0]?.shutdown.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("never registers cleanup or touches the host when direct export is declined", async () => {
		getDelegateSpy.mockReturnValue({
			_clineOtlpTraceRelay: true,
			forceFlush: forceFlushSpy,
			shutdown: shutdownSpy,
		});
		await resolveAiSdkTelemetry("cline");
		await resolveAiSdkTelemetry("cline");
		await disposeLangfuseTelemetry();
		expect(registerDisposableSpy).not.toHaveBeenCalled();
		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
		expect(forceFlushSpy).not.toHaveBeenCalled();
		expect(shutdownSpy).not.toHaveBeenCalled();
	});

	it("takes the relay path even after direct integration has been cached", async () => {
		const direct = await resolveAiSdkTelemetry("cline");
		getDelegateSpy.mockReturnValue({ _clineOtlpTraceRelay: true });
		const relay = await resolveAiSdkTelemetry("cline");
		expect(relay.integrations).not.toBe(direct.integrations);
		expect(relay.recordInputs).toBe(false);
		expect(integrationOptionsSpy).toHaveBeenLastCalledWith({
			tracer: { name: "managed-global-tracer" },
		});
	});

	it.each([
		{
			policy: "sampling disabled",
			sample: "0",
			optedOut: false,
			enabled: false,
		},
		{ policy: "user opted out", sample: "100", optedOut: true, enabled: false },
		{ policy: "metadata only", sample: "100", optedOut: false, enabled: true },
	])("honors $policy when a relay registers during direct initialization", async ({
		sample,
		optedOut,
		enabled,
	}) => {
		const directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "lf-relay-race-"),
		);
		try {
			globalSettingsPathRef.current = path.join(directory, "settings.json");
			await fs.writeFile(
				globalSettingsPathRef.current,
				JSON.stringify({ telemetryOptOut: optedOut }),
			);
			vi.stubEnv("CLINE_TRACE_SAMPLE_PERCENT", sample);
			vi.stubEnv("CLINE_TRACE_RECORD_CONTENT", "false");
			// Register the host while the awaited direct runtime is still being
			// constructed, before its promise resolves back to the caller.
			integrationOptionsSpy.mockImplementationOnce(() => {
				getDelegateSpy.mockReturnValue({ _clineOtlpTraceRelay: true });
			});
			const decision = await resolveAiSdkTelemetry("cline", "task-a");
			expect(tracerProviderInstances).toHaveLength(1);
			if (enabled) {
				expect(decision).toEqual({
					isEnabled: true,
					integrations: expect.any(Object),
					recordInputs: false,
					recordOutputs: false,
				});
				expect(integrationOptionsSpy).toHaveBeenLastCalledWith({
					tracer: { name: "managed-global-tracer" },
				});
			} else {
				expect(decision).toEqual({ isEnabled: false });
			}
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	});

	it("does not initialize direct export with incomplete credentials", async () => {
		vi.stubEnv("LANGFUSE_SECRET_KEY", "");
		await expect(resolveAiSdkTelemetry("cline")).resolves.toEqual({
			isEnabled: false,
		});
		expect(spanProcessorConfigSpy).not.toHaveBeenCalled();
	});

	it("recreates a direct runtime after disposal", async () => {
		const first = await resolveAiSdkTelemetry("cline");
		await disposeLangfuseTelemetry();
		const second = await resolveAiSdkTelemetry("cline");
		expect(second.integrations).not.toBe(first.integrations);
		expect(tracerProviderInstances).toHaveLength(2);
	});

	describe("resolveAiSdkTelemetry (collector relay path)", () => {
		function clearLangfuseEnv() {
			delete process.env.LANGFUSE_BASE_URL;
			delete process.env.LANGFUSE_PUBLIC_KEY;
			delete process.env.LANGFUSE_SECRET_KEY;
		}

		/** Simulates a host whose telemetry service registered the OTLP relay. */
		function mockHostOtlpTracer() {
			getTracerProviderSpy.mockReturnValue({
				getDelegate: () => ({
					forceFlush: forceFlushSpy,
					shutdown: shutdownSpy,
					_clineOtlpTraceRelay: true,
				}),
			});
		}

		it("keeps the direct Langfuse path unchanged: enabled with content recording untouched", async () => {
			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision).toEqual({
				isEnabled: true,
				integrations: expect.any(Object),
			});
		});

		it("defaults to full sampling when the host registered a tracer and no rate is set", async () => {
			clearLangfuseEnv();
			mockHostOtlpTracer();

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision).toEqual({
				isEnabled: true,
				integrations: expect.any(Object),
				recordInputs: false,
				recordOutputs: false,
			});
		});

		it("stays disabled when the sample rate is explicitly zero", async () => {
			clearLangfuseEnv();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "0";

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision.isEnabled).toBe(false);
		});

		it("stays disabled for non-cline providers even with a sample rate", async () => {
			clearLangfuseEnv();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";

			const decision = await resolveAiSdkTelemetry("openrouter", "task-a");

			expect(decision.isEnabled).toBe(false);
		});

		it("enables metadata-only telemetry at 100% when the host registered a tracer", async () => {
			clearLangfuseEnv();
			mockHostOtlpTracer();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision).toEqual({
				isEnabled: true,
				integrations: expect.any(Object),
				recordInputs: false,
				recordOutputs: false,
			});
		});

		it("records content only when CLINE_TRACE_RECORD_CONTENT is set", async () => {
			clearLangfuseEnv();
			mockHostOtlpTracer();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";
			process.env.CLINE_TRACE_RECORD_CONTENT = "true";

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision).toEqual({
				isEnabled: true,
				integrations: expect.any(Object),
				recordInputs: true,
				recordOutputs: true,
			});
		});

		it("samples deterministically by key", async () => {
			clearLangfuseEnv();
			mockHostOtlpTracer();
			// FNV-1a buckets: task-b=7, task-c=88. A 50% rate keeps the low
			// bucket and drops the high one — on every call.
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "50";

			for (let i = 0; i < 2; i++) {
				const kept = await resolveAiSdkTelemetry("cline", "task-b");
				const dropped = await resolveAiSdkTelemetry("cline", "task-c");
				expect(kept.isEnabled).toBe(true);
				expect(dropped.isEnabled).toBe(false);
			}
		});

		it("stays disabled below 100% without a sampling key", async () => {
			clearLangfuseEnv();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "50";

			const decision = await resolveAiSdkTelemetry("cline", undefined);

			expect(decision.isEnabled).toBe(false);
		});

		it("respects the global telemetry opt-out", async () => {
			clearLangfuseEnv();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";
			const settingsPath = path.join(
				await fs.mkdtemp(path.join(os.tmpdir(), "lf-optout-")),
				"settings.json",
			);
			await fs.writeFile(
				settingsPath,
				JSON.stringify({ telemetryOptOut: true }),
			);
			globalSettingsPathRef.current = settingsPath;

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision.isEnabled).toBe(false);
		});

		it("fails closed when the settings file is malformed", async () => {
			clearLangfuseEnv();
			mockHostOtlpTracer();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";
			process.env.CLINE_TRACE_RECORD_CONTENT = "true";
			const settingsPath = path.join(
				await fs.mkdtemp(path.join(os.tmpdir(), "lf-torn-")),
				"settings.json",
			);
			// A torn read of the non-atomic settings writer: truncated JSON.
			await fs.writeFile(settingsPath, '{"telemetryOptOut":tr');
			globalSettingsPathRef.current = settingsPath;

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision.isEnabled).toBe(false);
		});

		it("fails closed when the settings file exists but cannot be read", async () => {
			clearLangfuseEnv();
			mockHostOtlpTracer();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";
			// A directory at the settings path raises EISDIR, not ENOENT.
			globalSettingsPathRef.current = await fs.mkdtemp(
				path.join(os.tmpdir(), "lf-unreadable-"),
			);

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision.isEnabled).toBe(false);
		});

		it("stays enabled when the settings file records no opt-out", async () => {
			clearLangfuseEnv();
			mockHostOtlpTracer();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";
			const settingsPath = path.join(
				await fs.mkdtemp(path.join(os.tmpdir(), "lf-optin-")),
				"settings.json",
			);
			await fs.writeFile(
				settingsPath,
				JSON.stringify({ telemetryOptOut: false }),
			);
			globalSettingsPathRef.current = settingsPath;

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision.isEnabled).toBe(true);
		});

		it("leaves the credentialed direct Langfuse path unaffected by the opt-out", async () => {
			const settingsPath = path.join(
				await fs.mkdtemp(path.join(os.tmpdir(), "lf-direct-")),
				"settings.json",
			);
			await fs.writeFile(
				settingsPath,
				JSON.stringify({ telemetryOptOut: true }),
			);
			globalSettingsPathRef.current = settingsPath;

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision).toEqual({
				isEnabled: true,
				integrations: expect.any(Object),
			});
		});

		it("does not treat a console-only tracer as the relay", async () => {
			clearLangfuseEnv();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";
			// Recording provider without the relay marker — e.g. the SDK's
			// console traces exporter.
			getTracerProviderSpy.mockReturnValue({
				getDelegate: () => ({
					forceFlush: forceFlushSpy,
					shutdown: shutdownSpy,
				}),
			});

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision.isEnabled).toBe(false);
		});

		it("retries direct Langfuse once a declined relay goes away", async () => {
			mockHostOtlpTracer();
			// Relay present: direct declines, relay path serves the stream.
			const withRelay = await resolveAiSdkTelemetry("cline", "task-a");
			expect(withRelay).toEqual({
				isEnabled: true,
				integrations: expect.any(Object),
				recordInputs: false,
				recordOutputs: false,
			});

			// Relay disposed: the decline must not have been cached, so the
			// credentialed direct path now initializes its own provider.
			getTracerProviderSpy.mockReturnValue({
				getDelegate: getDelegateSpy,
			});
			const withoutRelay = await resolveAiSdkTelemetry("cline", "task-a");
			expect(withoutRelay).toEqual({
				isEnabled: true,
				integrations: expect.any(Object),
			});
			expect(tracerProviderInstances).toHaveLength(1);
		});

		it("stays disabled when no recording tracer provider is registered", async () => {
			clearLangfuseEnv();
			process.env.CLINE_TRACE_SAMPLE_PERCENT = "100";
			getTracerProviderSpy.mockReturnValue({
				getDelegate: () => ({ constructor: { name: "NoopTracerProvider" } }),
			});

			const decision = await resolveAiSdkTelemetry("cline", "task-a");

			expect(decision.isEnabled).toBe(false);
		});
	});
});
