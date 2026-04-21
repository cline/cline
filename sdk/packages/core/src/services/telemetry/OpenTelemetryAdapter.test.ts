import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import type { MeterProvider } from "@opentelemetry/sdk-metrics";
import { describe, expect, it, vi } from "vitest";
import { OpenTelemetryAdapter } from "./OpenTelemetryAdapter";

describe("OpenTelemetryAdapter", () => {
	it("emits events in the telemetry service log format", () => {
		const emit = vi.fn();
		const adapter = new OpenTelemetryAdapter({
			metadata: makeMetadata(),
			distinctId: "user-123",
			commonProperties: {
				organization_id: "org-1",
			},
			loggerProvider: {
				getLogger: () => ({ emit }),
			} as unknown as LoggerProvider,
		});

		adapter.emit("task.created", {
			ulid: "01HXYZ",
			nested: {
				mode: "act",
			},
			items: ["a", "b"],
			nullable: null,
		});

		expect(emit).toHaveBeenCalledWith({
			severityText: "INFO",
			body: "task.created",
			attributes: expect.objectContaining({
				ulid: "01HXYZ",
				"nested.mode": "act",
				items: JSON.stringify(["a", "b"]),
				nullable: "null",
				distinct_id: "user-123",
				organization_id: "org-1",
				extension_version: "1.2.3",
				cline_type: "cli",
				platform: "terminal",
			}),
		});
	});

	it("marks required events with the expected flag", () => {
		const emit = vi.fn();
		const adapter = new OpenTelemetryAdapter({
			metadata: makeMetadata(),
			loggerProvider: {
				getLogger: () => ({ emit }),
			} as unknown as LoggerProvider,
			enabled: false,
		});

		adapter.emitRequired("user.opt_out");

		expect(emit).toHaveBeenCalledWith({
			severityText: "INFO",
			body: "user.opt_out",
			attributes: expect.objectContaining({
				_required: true,
			}),
		});
	});

	it("records metrics with merged telemetry attributes and retires gauge series", () => {
		const counterAdd = vi.fn();
		const histogramRecord = vi.fn();
		let gaugeCallback:
			| ((result: {
					observe: (
						value: number,
						attributes?: Record<string, string | number | boolean>,
					) => void;
			  }) => void)
			| undefined;

		const forceFlush = vi.fn().mockResolvedValue(undefined);
		const shutdown = vi.fn().mockResolvedValue(undefined);

		const adapter = new OpenTelemetryAdapter({
			metadata: makeMetadata(),
			distinctId: "user-123",
			meterProvider: {
				getMeter: () =>
					({
						createCounter: () => ({ add: counterAdd }),
						createHistogram: () => ({ record: histogramRecord }),
						createObservableGauge: () => ({
							addCallback: (callback: typeof gaugeCallback) => {
								gaugeCallback = callback;
							},
						}),
					}) as never,
				forceFlush,
				shutdown,
			} as unknown as MeterProvider,
		});

		adapter.recordCounter("cline.turns.total", 2, { ulid: "01HXYZ" });
		adapter.recordHistogram("cline.api.duration.seconds", 1.5, {
			ulid: "01HXYZ",
		});
		adapter.recordGauge("cline.workspace.active_roots", 3, { workspace: "a" });

		expect(counterAdd).toHaveBeenCalledWith(
			2,
			expect.objectContaining({
				ulid: "01HXYZ",
				distinct_id: "user-123",
				extension_version: "1.2.3",
			}),
		);
		expect(histogramRecord).toHaveBeenCalledWith(
			1.5,
			expect.objectContaining({
				ulid: "01HXYZ",
				distinct_id: "user-123",
			}),
		);

		const observe = vi.fn();
		gaugeCallback?.({ observe });
		expect(observe).toHaveBeenCalledWith(
			3,
			expect.objectContaining({
				workspace: "a",
				distinct_id: "user-123",
			}),
		);

		adapter.recordGauge("cline.workspace.active_roots", null, {
			workspace: "a",
		});
		const observeAfterRetire = vi.fn();
		gaugeCallback?.({ observe: observeAfterRetire });
		expect(observeAfterRetire).not.toHaveBeenCalled();

		return Promise.all([adapter.flush(), adapter.dispose()]).then(() => {
			expect(forceFlush).toHaveBeenCalledTimes(1);
			expect(shutdown).toHaveBeenCalledTimes(1);
		});
	});
});

function makeMetadata() {
	return {
		extension_version: "1.2.3",
		cline_type: "cli",
		platform: "terminal",
		platform_version: "1.0.0",
		os_type: "darwin",
		os_version: "24.0.0",
		is_dev: "true",
	};
}
