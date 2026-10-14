/**
 * Builds the `--telemetry-selfcheck` report (see index.ts). CI runs the
 * packaged sidecar with that flag and fails the publish unless the report
 * shows telemetry enabled with a usable OTLP endpoint, so the checks here
 * define what a release-grade build must prove.
 */

export type TelemetrySelfcheckConfig = {
	enabled?: boolean;
	otlpEndpoint?: string;
	logsExporter?: string;
	metricsExporter?: string;
};

export type TelemetrySelfcheckReport = {
	telemetry_selfcheck: true;
	enabled: boolean;
	/**
	 * The OTLP endpoint host when the endpoint is a usable http(s) URL,
	 * `""` when no endpoint was inlined, or `"invalid-endpoint-url"` when
	 * the endpoint cannot work at runtime (unparseable, hostless, or a
	 * non-http scheme the OTLP http/json exporters cannot speak).
	 */
	otlp_endpoint_host: string;
	logs_exporter: string;
	metrics_exporter: string;
};

// The SDK's OTLP exporters are the http/json ones
// (@opentelemetry/exporter-*-otlp-http); any other scheme would be accepted
// here only to fail at runtime.
const USABLE_OTLP_PROTOCOLS = new Set(["http:", "https:"]);

function otlpEndpointHost(otlpEndpoint: string | undefined): string {
	if (!otlpEndpoint) {
		return "";
	}
	try {
		const url = new URL(otlpEndpoint);
		return USABLE_OTLP_PROTOCOLS.has(url.protocol) && url.host
			? url.host
			: "invalid-endpoint-url";
	} catch {
		return "invalid-endpoint-url";
	}
}

export function buildTelemetrySelfcheckReport(
	config: TelemetrySelfcheckConfig,
): TelemetrySelfcheckReport {
	return {
		telemetry_selfcheck: true,
		enabled: config.enabled === true,
		otlp_endpoint_host: otlpEndpointHost(config.otlpEndpoint),
		logs_exporter: config.logsExporter ?? "",
		metrics_exporter: config.metricsExporter ?? "",
	};
}
