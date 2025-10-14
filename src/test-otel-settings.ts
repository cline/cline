import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { ShowMessageType } from "@/shared/proto/host/window"
import { clearOtelConfigCache } from "@/shared/services/config/otel-config"

export function registerTestOtelSettingsCommand(context: vscode.ExtensionContext) {
	// biome-ignore lint/correctness/noUnusedVariables: Test utility for OpenTelemetry settings
	// biome-ignore plugin: Test utility - direct vscode API usage is acceptable here
	const disposable = vscode.commands.registerCommand("cline.testOtelSettings", async () => {
		try {
			const stateManager = StateManager.get()

			// Set OpenTelemetry settings via StateManager
			await stateManager.setGlobalStateBatch({
				openTelemetryOtlpProtocol: "http/protobuf",
				openTelemetryOtlpEndpoint: "http://localhost:4318",
			})

			// Clear the config cache so it will be re-read on next access
			clearOtelConfigCache()

			// Reinitialize telemetry providers with new config
			await telemetryService.reinitializeAllProviders()

			console.log("[TEST] OpenTelemetry settings updated:")
			console.log("[TEST]   - Protocol: http/protobuf")
			console.log("[TEST]   - Endpoint: http://localhost:4318")
			console.log("[TEST] Config cache cleared")
			console.log("[TEST] Telemetry providers reinitialized")
			console.log("[TEST] Settings saved to disk")

			// Show success message
			await HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message:
					"OpenTelemetry settings updated and providers reinitialized! Protocol: http/protobuf, Endpoint: http://localhost:4318",
			})
		} catch (error) {
			await HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to update settings: ${error}`,
			})
			console.error("[TEST] Error updating settings:", error)
		}
	})

	context.subscriptions.push(disposable)
}
