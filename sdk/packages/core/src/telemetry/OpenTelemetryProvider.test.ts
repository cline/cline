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
