import { describe, expect, it, vi } from "vitest";
import { TelemetryLoggerSink } from "./TelemetryLoggerSink";

describe("TelemetryLoggerSink", () => {
	it("logs events and metrics through the provided logger", async () => {
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
		};
		const sink = new TelemetryLoggerSink({ logger });

		sink.emit("session.started", { sessionId: "s1" });
		sink.emitRequired("user.opt_out", { reason: "manual" });
		sink.recordCounter("cline.session.starts.total", 1, {
			sessionId: "s1",
		});

		expect(logger.log).toHaveBeenCalledWith("telemetry.event", {
			telemetrySink: "TelemetryLoggerSink",
			event: "session.started",
			properties: { sessionId: "s1" },
		});
		expect(logger.log).toHaveBeenCalledWith("telemetry.required_event", {
			telemetrySink: "TelemetryLoggerSink",
			severity: "warn",
			event: "user.opt_out",
			properties: { reason: "manual" },
		});
		expect(logger.debug).toHaveBeenCalledWith("telemetry.metric", {
			telemetrySink: "TelemetryLoggerSink",
			instrument: "counter",
			name: "cline.session.starts.total",
			value: 1,
			attributes: { sessionId: "s1" },
			description: undefined,
			required: false,
		});

		await sink.flush();
		await sink.dispose();
	});
});
