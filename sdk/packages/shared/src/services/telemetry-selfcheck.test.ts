import { describe, expect, it } from "vitest";
import { buildTelemetrySelfcheckReport } from "./telemetry-selfcheck";

describe("buildTelemetrySelfcheckReport", () => {
	it("reports the endpoint host for usable http(s) endpoints", () => {
		expect(
			buildTelemetrySelfcheckReport({
				enabled: true,
				otlpEndpoint: "https://otel.example.com:4318",
				logsExporter: "otlp",
				metricsExporter: "otlp",
			}),
		).toEqual({
			telemetry_selfcheck: true,
			enabled: true,
			otlp_endpoint_host: "otel.example.com:4318",
			logs_exporter: "otlp",
			metrics_exporter: "otlp",
		});
		expect(
			buildTelemetrySelfcheckReport({
				enabled: true,
				otlpEndpoint: "http://127.0.0.1:4319",
			}).otlp_endpoint_host,
		).toBe("127.0.0.1:4319");
	});

	it("reports an empty host when no endpoint was inlined", () => {
		expect(
			buildTelemetrySelfcheckReport({ enabled: false }).otlp_endpoint_host,
		).toBe("");
		expect(
			buildTelemetrySelfcheckReport({ enabled: true, otlpEndpoint: "" })
				.otlp_endpoint_host,
		).toBe("");
	});

	it("flags unparseable endpoints", () => {
		expect(
			buildTelemetrySelfcheckReport({
				enabled: true,
				otlpEndpoint: "not a url at all",
			}).otlp_endpoint_host,
		).toBe("invalid-endpoint-url");
	});

	it("flags endpoints the OTLP http exporters cannot speak", () => {
		for (const otlpEndpoint of [
			"ftp://collector.example.com:4318",
			"grpc://collector.example.com:4317",
			"file:///tmp/otel",
		]) {
			expect(
				buildTelemetrySelfcheckReport({ enabled: true, otlpEndpoint })
					.otlp_endpoint_host,
			).toBe("invalid-endpoint-url");
		}
	});

	it("only treats an explicit true as enabled", () => {
		expect(buildTelemetrySelfcheckReport({}).enabled).toBe(false);
		expect(buildTelemetrySelfcheckReport({ enabled: true }).enabled).toBe(true);
	});
});
