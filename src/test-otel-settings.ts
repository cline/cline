import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"

export function registerTestOtelSettingsCommand(context: vscode.ExtensionContext) {
	// biome-ignore lint/correctness/noUnusedVariables: Test utility for OpenTelemetry settings
	// biome-ignore plugin: Test utility - direct vscode API usage is acceptable here
	const disposable = vscode.commands.registerCommand("cline.testOtelSettings", async () => {
		try {
			const stateManager = StateManager.get()

			// Set OpenTelemetry settings via StateManager
			stateManager.setGlobalStateBatch({
				openTelemetryOtlpProtocol: "http/protobuf",
				openTelemetryOtlpEndpoint: "http://localhost:4318",
			})

			await HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message:
					"OpenTelemetry settings updated! Protocol: http/protobuf, Endpoint: http://localhost:4318. Please reload the window.",
			})

			console.log("[TEST] OpenTelemetry settings updated:")
			console.log("[TEST]   - Protocol: http/protobuf")
			console.log("[TEST]   - Endpoint: http://localhost:4318")
			console.log("[TEST] Reload window to see changes take effect")
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
