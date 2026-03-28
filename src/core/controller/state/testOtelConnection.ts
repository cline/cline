import { EmptyRequest } from "@shared/proto/cline/common"
import { TestConnectionResult } from "@shared/proto/cline/state"
import { REMOTE_CONFIG_OTEL_PROVIDER_ID } from "@/core/storage/remote-config/utils"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Tests the OpenTelemetry connection by sending a test log event
 * @param controller The controller instance
 * @param request Empty request
 * @returns TestConnectionResult with success status and message
 */
export async function testOtelConnection(_controller: Controller, _: EmptyRequest): Promise<TestConnectionResult> {
	try {
		const providers = await telemetryService.getProviders()
		const otelProvider = providers.find((p) => p.name === REMOTE_CONFIG_OTEL_PROVIDER_ID)

		if (!otelProvider) {
			return TestConnectionResult.create({
				success: false,
				error: "OpenTelemetry provider not configured",
			})
		}

		otelProvider.log("cline.test.connection", {
			test: true,
			timestamp: new Date().toISOString(),
			source: "remote_config_settings",
		})

		otelProvider.recordCounter("cline.test.connection", 1)

		await otelProvider.forceFlush()

		return TestConnectionResult.create({
			success: true,
			message: "Test log event sent successfully. Check your OTEL collector for the event.",
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		Logger.error("[TEST_OTEL_CONNECTION] Failed to send test event:", error)

		return TestConnectionResult.create({
			success: false,
			error: errorMessage,
		})
	}
}
