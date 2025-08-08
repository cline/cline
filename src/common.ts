import * as vscode from "vscode"
import {
	migrateCustomInstructionsToGlobalRules,
	migrateWelcomeViewCompleted,
	migrateWorkspaceToGlobalStorage,
} from "./core/storage/state-migrations"
import { WebviewProvider } from "./core/webview"
import { Logger } from "./services/logging/Logger"
import { PostHogClientProvider } from "./services/posthog/PostHogClientProvider"
import { WebviewProviderType } from "./shared/webview/types"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import { HostProvider } from "@/hosts/host-provider"
import { FileContextTracker } from "./core/context/context-tracking/FileContextTracker"
import { telemetryService } from "./services/posthog/PostHogClientProvider"
import { ShowMessageType } from "./shared/proto/host/window"
import { getLatestAnnouncementId } from "./utils/announcements"
/**
 * Performs intialization for Cline that is common to all platforms.
 *
 * @param context
 * @returns The webview provider
 */
export async function initialize(context: vscode.ExtensionContext): Promise<WebviewProvider> {
	// Initialize PostHog client provider
	const distinctId = context.globalState.get<string>("cline.distinctId")
	PostHogClientProvider.getInstance(distinctId)

	// Migrate custom instructions to global Cline rules (one-time cleanup)
	await migrateCustomInstructionsToGlobalRules(context)

	// Migrate welcomeViewCompleted setting based on existing API keys (one-time cleanup)
	await migrateWelcomeViewCompleted(context)

	// Migrate workspace storage values back to global storage (reverting previous migration)
	await migrateWorkspaceToGlobalStorage(context)

	// Clean up orphaned file context warnings (startup cleanup)
	await FileContextTracker.cleanupOrphanedWarnings(context)

	const sidebarWebview = HostProvider.get().createWebviewProvider(WebviewProviderType.SIDEBAR)

	await showVersionUpdateAnnouncement(context)

	telemetryService.captureExtensionActivated()

	return sidebarWebview
}

async function showVersionUpdateAnnouncement(context: vscode.ExtensionContext) {
	// Version checking for autoupdate notification
	const currentVersion = context.extension.packageJSON.version
	const previousVersion = context.globalState.get<string>("clineVersion")
	// Perform post-update actions if necessary
	try {
		if (!previousVersion || currentVersion !== previousVersion) {
			Logger.log(`Cline version changed: ${previousVersion} -> ${currentVersion}. First run or update detected.`)

			// Use the same condition as announcements: focus when there's a new announcement to show
			const lastShownAnnouncementId = context.globalState.get<string>("lastShownAnnouncementId")
			const latestAnnouncementId = getLatestAnnouncementId(context)

			if (lastShownAnnouncementId !== latestAnnouncementId) {
				// Focus Cline when there's a new announcement to show (major/minor updates or fresh installs)
				const message = previousVersion
					? `Cline has been updated to v${currentVersion}`
					: `Welcome to Cline v${currentVersion}`
				await vscode.commands.executeCommand("claude-dev.SidebarProvider.focus")
				await new Promise((resolve) => setTimeout(resolve, 200))
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message,
				})
			}
			// Always update the main version tracker for the next launch.
			await context.globalState.update("clineVersion", currentVersion)
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error(`Error during post-update actions: ${errorMessage}, Stack trace: ${error.stack}`)
	}
}

/**
 * Performs cleanup when Cline is deactivated that is common to all platforms.
 */
export async function tearDown(): Promise<void> {
	PostHogClientProvider.getInstance().dispose()

	// Dispose all webview instances
	await WebviewProvider.disposeAllInstances()
}
