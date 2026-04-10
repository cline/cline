import type { BasicLogger } from "@clinebot/shared";
import { describe, expect, it, vi } from "vitest";
import type { ITelemetryAdapter } from "./ITelemetryAdapter";
import { TelemetryService } from "./TelemetryService";

describe("TelemetryService", () => {
	it("merges metadata and forwards calls to adapters", async () => {
		const { adapter, emit, recordCounter } = createAdapter();
		const service = new TelemetryService({
			adapters: [adapter],
			metadata: {
				extension_version: "1.2.3",
				cline_type: "cli",
			},
			distinctId: "distinct-1",
			commonProperties: {
				organization_id: "org-1",
			},
		});

		service.capture({
			event: "session.started",
			properties: { sessionId: "session-1" },
		});
		service.recordCounter("cline.session.starts.total", 1, {
			sessionId: "session-1",
		});
		await service.flush();
		await service.dispose();

		expect(emit).toHaveBeenCalledWith(
			"session.started",
			expect.objectContaining({
				sessionId: "session-1",
				organization_id: "org-1",
				extension_version: "1.2.3",
				cline_type: "cli",
				distinct_id: "distinct-1",
			}),
		);
		expect(recordCounter).toHaveBeenCalledWith(
			"cline.session.starts.total",
			1,
			expect.objectContaining({
				sessionId: "session-1",
				distinct_id: "distinct-1",
			}),
			undefined,
			false,
		);
	});

	it("mirrors telemetry events into the logger when provided", () => {
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const service = new TelemetryService({
			logger,
			metadata: {
				extension_version: "1.2.3",
				cline_type: "cli",
			},
			distinctId: "distinct-1",
		});

		service.capture({
			event: "session.started",
			properties: { sessionId: "session-1" },
		});
		service.captureRequired("user.opt_out", { reason: "manual" });
		service.recordCounter("cline.session.starts.total", 1, {
			sessionId: "session-1",
		});

		expect(logger.log).toHaveBeenCalledWith(
			"telemetry.event",
			expect.objectContaining({
				telemetrySink: "TelemetryLoggerSink",
				event: "session.started",
				properties: expect.objectContaining({
					sessionId: "session-1",
					extension_version: "1.2.3",
					distinct_id: "distinct-1",
				}),
			}),
		);
		expect(logger.log).toHaveBeenCalledWith(
			"telemetry.required_event",
			expect.objectContaining({
				telemetrySink: "TelemetryLoggerSink",
				severity: "warn",
				event: "user.opt_out",
				properties: expect.objectContaining({
					reason: "manual",
					extension_version: "1.2.3",
				}),
			}),
		);
		expect(logger.debug).toHaveBeenCalledWith(
			"telemetry.metric",
			expect.objectContaining({
				telemetrySink: "TelemetryLoggerSink",
				instrument: "counter",
				name: "cline.session.starts.total",
			}),
		);
	});
});

function createAdapter(): {
	adapter: ITelemetryAdapter;
	emit: ReturnType<typeof vi.fn>;
	recordCounter: ReturnType<typeof vi.fn>;
} {
	const emit = vi.fn();
	const recordCounter = vi.fn();
	return {
		adapter: {
			name: "test",
			emit,
			emitRequired: vi.fn(),
			recordCounter,
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			isEnabled: vi.fn(() => true),
			flush: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		emit,
		recordCounter,
	};
}
