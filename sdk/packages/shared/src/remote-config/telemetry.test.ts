import { describe, expect, it } from "vitest";
import {
	DefaultRemoteConfigTelemetryAdapter,
	normalizeBundleTelemetry,
} from "./telemetry";

describe("remote-config telemetry", () => {
	it("keeps remote-config settings the bundle telemetry does not set", () => {
		const telemetry =
			new DefaultRemoteConfigTelemetryAdapter().resolveTelemetry(
				{
					source: "test",
					version: "1",
					remoteConfig: {
						openTelemetryEnabled: true,
						openTelemetryOtlpEndpoint: "https://otel.example.com",
					},
					telemetry: { logBatchSize: 100 },
				},
				{ workspacePath: "/workspace" },
			);

		expect(telemetry).toMatchObject({
			enabled: true,
			otlpEndpoint: "https://otel.example.com",
			logBatchSize: 100,
		});
	});

	it("lets bundle telemetry override remote-config settings it does set", () => {
		const telemetry =
			new DefaultRemoteConfigTelemetryAdapter().resolveTelemetry(
				{
					source: "test",
					version: "1",
					remoteConfig: {
						openTelemetryEnabled: true,
						openTelemetryOtlpEndpoint: "https://otel.example.com",
					},
					telemetry: { otlpEndpoint: "https://bundle.example.com" },
				},
				{ workspacePath: "/workspace" },
			);

		expect(telemetry).toMatchObject({
			enabled: true,
			otlpEndpoint: "https://bundle.example.com",
		});
	});

	it("omits unset fields from normalized bundle telemetry", () => {
		expect(normalizeBundleTelemetry({ logBatchSize: 100 })).toEqual({
			logBatchSize: 100,
		});
		expect(normalizeBundleTelemetry({ unrelated: true })).toBeUndefined();
	});
});
