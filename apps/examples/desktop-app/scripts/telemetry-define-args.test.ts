import { describe, expect, it } from "vitest";
import { telemetryDefineArgs } from "./telemetry-define-args";

function defineMap(args: string[]): Record<string, string> {
	const map: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 2) {
		expect(args[index]).toBe("--define");
		const pair = args[index + 1];
		const separator = pair.indexOf("=");
		map[pair.slice(0, separator)] = pair.slice(separator + 1);
	}
	return map;
}

describe("telemetryDefineArgs", () => {
	it("inlines every OTEL var getTelemetryBuildTimeConfig reads", () => {
		const defines = defineMap(
			telemetryDefineArgs({
				OTEL_TELEMETRY_ENABLED: "1",
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com:4318",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
				OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=secret",
				OTEL_LOGS_EXPORTER: "otlp",
				OTEL_METRICS_EXPORTER: "otlp",
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_METRIC_EXPORT_INTERVAL: "60000",
			}),
		);
		expect(defines["process.env.OTEL_TELEMETRY_ENABLED"]).toBe('"1"');
		expect(defines["process.env.OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe(
			'"https://otel.example.com:4318"',
		);
		expect(defines["process.env.OTEL_EXPORTER_OTLP_PROTOCOL"]).toBe(
			'"http/json"',
		);
		expect(defines["process.env.OTEL_EXPORTER_OTLP_HEADERS"]).toBe(
			'"x-api-key=secret"',
		);
		expect(defines["process.env.OTEL_LOGS_EXPORTER"]).toBe('"otlp"');
		expect(defines["process.env.OTEL_METRICS_EXPORTER"]).toBe('"otlp"');
		expect(defines["process.env.OTEL_TRACES_EXPORTER"]).toBe('"otlp"');
		expect(defines["process.env.OTEL_METRIC_EXPORT_INTERVAL"]).toBe('"60000"');
	});

	it("inlines unset OTEL vars as empty strings so binaries never fall back to runtime env", () => {
		const defines = defineMap(telemetryDefineArgs({}));
		expect(defines["process.env.OTEL_TELEMETRY_ENABLED"]).toBe('""');
		expect(defines["process.env.OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe('""');
	});

	it("includes API key defines only when the vars are set", () => {
		const withoutKeys = defineMap(telemetryDefineArgs({}));
		expect(withoutKeys).not.toHaveProperty(
			"process.env.TELEMETRY_SERVICE_API_KEY",
		);
		expect(withoutKeys).not.toHaveProperty("process.env.ERROR_SERVICE_API_KEY");

		const withKeys = defineMap(
			telemetryDefineArgs({
				TELEMETRY_SERVICE_API_KEY: "tk",
				ERROR_SERVICE_API_KEY: "ek",
			}),
		);
		expect(withKeys["process.env.TELEMETRY_SERVICE_API_KEY"]).toBe('"tk"');
		expect(withKeys["process.env.ERROR_SERVICE_API_KEY"]).toBe('"ek"');
	});

	it("JSON-escapes values so headers with quotes survive the define", () => {
		const defines = defineMap(
			telemetryDefineArgs({
				OTEL_EXPORTER_OTLP_HEADERS: 'x-quote="quoted",y=2',
			}),
		);
		expect(defines["process.env.OTEL_EXPORTER_OTLP_HEADERS"]).toBe(
			JSON.stringify('x-quote="quoted",y=2'),
		);
		expect(JSON.parse(defines["process.env.OTEL_EXPORTER_OTLP_HEADERS"])).toBe(
			'x-quote="quoted",y=2',
		);
	});
});
