import type { BasicLogger } from "@clinebot/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createConfiguredTelemetryService,
	createOpenTelemetryTelemetryService,
	OpenTelemetryProvider,
} from "./OpenTelemetryProvider";
import { TelemetryService } from "./TelemetryService";

describe("createOpenTelemetryTelemetryService", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs a provider creation event during bootstrap", async () => {
		const captureRequired = vi
			.spyOn(TelemetryService.prototype, "captureRequired")
			.mockImplementation(() => {});

		const { provider } = createOpenTelemetryTelemetryService({
			metadata: {
				extension_version: "1.2.3",
				cline_type: "cli",
				platform: "terminal",
				platform_version: process.version,
				os_type: process.platform,
				os_version: "unknown",
			},
			enabled: true,
			logsExporter: "console",
			metricsExporter: "otlp",
			otlpProtocol: "http/json",
			otlpEndpoint: "http://localhost:4318",
			serviceName: "cline-cli",
			serviceVersion: "1.2.3",
		});

		expect(captureRequired).toHaveBeenCalledWith(
			"telemetry.provider_created",
			expect.objectContaining({
				provider: "opentelemetry",
				enabled: true,
				logsExporter: "console",
				metricsExporter: "otlp",
				otlpProtocol: "http/json",
				hasOtlpEndpoint: true,
				serviceName: "cline-cli",
				serviceVersion: "1.2.3",
			}),
		);

		await provider.dispose();
	});

	it("registers a tracer provider when tracesExporter is set", async () => {
		const { provider } = createOpenTelemetryTelemetryService({
			metadata: {
				extension_version: "1.2.3",
				cline_type: "cli",
				platform: "terminal",
				platform_version: process.version,
				os_type: process.platform,
				os_version: "unknown",
			},
			enabled: true,
			tracesExporter: "console",
			logsExporter: "console",
			metricsExporter: "console",
			serviceName: "cline-test",
		});

		expect(provider.tracerProvider).not.toBeNull();
		const span = provider.getTracer("test").startSpan("verify.tracing");
		span.end();
		await provider.dispose();
	});

	it("does not create an OTEL provider when disabled", () => {
		const providerSpy = vi.spyOn(
			OpenTelemetryProvider.prototype,
			"createTelemetryService",
		);

		const { telemetry, provider } = createConfiguredTelemetryService({
			metadata: {
				extension_version: "1.2.3",
				cline_type: "cli",
				platform: "terminal",
				platform_version: process.version,
				os_type: process.platform,
				os_version: "unknown",
			},
			enabled: false,
		});

		expect(provider).toBeUndefined();
		expect(providerSpy).not.toHaveBeenCalled();
		expect(telemetry).toBeInstanceOf(TelemetryService);
	});

	it("preserves metadata when disabled", () => {
		const metadata = {
			extension_version: "1.0.0",
			cline_type: "kanban",
			platform: "kanban",
			platform_version: "v22.0.0",
			os_type: "darwin",
			os_version: "15.0",
		};
		const { telemetry } = createConfiguredTelemetryService({
			metadata,
			enabled: false,
		});
		const spy = vi.fn();
		(Reflect.get(telemetry, "adapters") as unknown[]).push({
			name: "test",
			emit: spy,
			emitRequired: spy,
			isEnabled: () => true,
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: async () => {},
			dispose: async () => {},
		});
		telemetry.captureRequired("test.event", {});
		expect(spy).toHaveBeenCalledWith(
			"test.event",
			expect.objectContaining({
				cline_type: "kanban",
				platform: "kanban",
			}),
		);
	});

	it("preserves metadata in the enabled (OTEL) path", async () => {
		const metadata = {
			extension_version: "1.0.0",
			cline_type: "kanban",
			platform: "kanban",
			platform_version: "v22.0.0",
			os_type: "darwin",
			os_version: "15.0",
		};
		const { telemetry, provider } = createOpenTelemetryTelemetryService({
			metadata,
			enabled: true,
			logsExporter: "console",
		});
		const spy = vi.fn();
		(Reflect.get(telemetry, "adapters") as unknown[]).push({
			name: "test",
			emit: spy,
			emitRequired: spy,
			isEnabled: () => true,
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: async () => {},
			dispose: async () => {},
		});
		telemetry.captureRequired("test.event", {});
		expect(spy).toHaveBeenCalledWith(
			"test.event",
			expect.objectContaining({
				cline_type: "kanban",
				platform: "kanban",
			}),
		);
		await provider.dispose();
	});

	it("delivers metadata to the OTEL logger without duplication", async () => {
		const otelEmit = vi.fn();
		const provider = new OpenTelemetryProvider({
			enabled: true,
		});
		// Replace the loggerProvider with a mock so we can inspect emit calls
		Reflect.set(provider, "loggerProvider", {
			getLogger: () => ({ emit: otelEmit }),
			forceFlush: async () => {},
			shutdown: async () => {},
		});

		const metadata = {
			extension_version: "1.0.0",
			cline_type: "kanban",
			platform: "kanban",
			platform_version: "v22.0.0",
			os_type: "darwin",
			os_version: "15.0",
		};

		const telemetry = provider.createTelemetryService({ metadata });

		telemetry.captureRequired("test.otel_event", { custom_prop: "value" });

		expect(otelEmit).toHaveBeenCalledTimes(1);
		const emittedAttributes = otelEmit.mock.calls[0][0].attributes;

		// Metadata fields must be present
		expect(emittedAttributes).toMatchObject({
			cline_type: "kanban",
			platform: "kanban",
			extension_version: "1.0.0",
			custom_prop: "value",
		});

		// Verify no key appears more than once (flattened object can't have
		// duplicate keys, but this guards against nested duplication patterns
		// like metadata appearing under a sub-prefix)
		const keys = Object.keys(emittedAttributes);
		const metadataKeys = Object.keys(metadata);
		for (const mk of metadataKeys) {
			const occurrences = keys.filter((k) => k === mk || k.endsWith(`.${mk}`));
			expect(
				occurrences,
				`metadata key "${mk}" should appear exactly once, found: ${occurrences.join(", ")}`,
			).toHaveLength(1);
		}

		await provider.dispose();
	});

	it("propagates updateMetadata to OTEL logger output", async () => {
		const otelEmit = vi.fn();
		const provider = new OpenTelemetryProvider({
			enabled: true,
		});
		Reflect.set(provider, "loggerProvider", {
			getLogger: () => ({ emit: otelEmit }),
			forceFlush: async () => {},
			shutdown: async () => {},
		});

		const metadata = {
			extension_version: "1.0.0",
			cline_type: "kanban",
			platform: "kanban",
			platform_version: "v22.0.0",
			os_type: "darwin",
			os_version: "15.0",
		};

		const telemetry = provider.createTelemetryService({ metadata });

		// Update metadata after construction
		telemetry.updateMetadata({ cline_type: "kanban-updated" });

		telemetry.captureRequired("test.updated_event", {});

		// The OTEL logger should see the updated value
		const emittedAttributes =
			otelEmit.mock.calls[otelEmit.mock.calls.length - 1][0].attributes;
		expect(emittedAttributes.cline_type).toBe("kanban-updated");

		await provider.dispose();
	});

	it("preserves logger when disabled", () => {
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const { telemetry } = createConfiguredTelemetryService({
			metadata: {
				extension_version: "1.0.0",
				cline_type: "kanban",
				platform: "kanban",
				platform_version: "v22.0.0",
				os_type: "darwin",
				os_version: "15.0",
			},
			enabled: false,
			logger,
		});

		telemetry.capture({
			event: "session.started",
			properties: { sessionId: "session-1" },
		});

		expect(logger.log).toHaveBeenCalledWith(
			"telemetry.event",
			expect.objectContaining({
				event: "session.started",
			}),
		);
	});

	it("attaches the logger adapter when creating configured telemetry", () => {
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const { telemetry, provider } = createConfiguredTelemetryService({
			metadata: {
				extension_version: "1.2.3",
				cline_type: "cli",
				platform: "terminal",
				platform_version: process.version,
				os_type: process.platform,
				os_version: "unknown",
			},
			enabled: true,
			logsExporter: "console",
			logger,
		});

		telemetry.capture({
			event: "session.started",
			properties: { sessionId: "session-1" },
		});

		expect(logger.log).toHaveBeenCalledWith(
			"telemetry.event",
			expect.objectContaining({
				event: "session.started",
			}),
		);

		return provider?.dispose();
	});
});
