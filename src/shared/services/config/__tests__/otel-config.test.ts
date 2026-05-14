import * as assert from "assert"
import { getValidRuntimeOpenTelemetryConfig } from "../otel-config"

describe("OpenTelemetry runtime config", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		process.env = { ...originalEnv }
	})

	it("parses CLINE_OTEL_RESOURCE_ATTRIBUTES into runtime config", () => {
		process.env.E2E_TEST = "false"
		process.env.IS_TEST = "false"
		process.env.CLINE_OTEL_TELEMETRY_ENABLED = "true"
		process.env.CLINE_OTEL_METRICS_EXPORTER = "otlp"
		process.env.CLINE_OTEL_RESOURCE_ATTRIBUTES = "username=john,team=platform"

		const config = getValidRuntimeOpenTelemetryConfig()

		assert.ok(config)
		assert.deepStrictEqual(config.resourceAttributes, {
			username: "john",
			team: "platform",
		})
	})
})
