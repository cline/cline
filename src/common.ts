import * as vscode from "vscode"
import { WebviewProvider } from "./core/webview"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { FileContextTracker } from "./core/context/context-tracking/FileContextTracker"
import { StateManager } from "./core/storage/StateManager"
import { openAiCodexOAuthManager } from "./integrations/openai-codex/oauth"
import { ExtensionRegistryInfo } from "./registry"
import { BannerService } from "./services/banner/BannerService"
import { audioRecordingService } from "./services/dictation/AudioRecordingService"
import { ErrorService } from "./services/error"
import { featureFlagsService } from "./services/feature-flags"
import { getDistinctId, initializeDistinctId } from "./services/logging/distinctId"
import { telemetryService } from "./services/telemetry"
import { PostHogClientProvider } from "./services/telemetry/providers/posthog/PostHogClientProvider"
import { ShowMessageType } from "./shared/proto/host/window"
import { syncWorker } from "./shared/services/worker/sync"
import { getBlobStoreSettingsFromEnv } from "./shared/services/worker/worker"
import { getLatestAnnouncementId } from "./utils/announcements"
import { arePathsEqual } from "./utils/path"

/**
 * Performs intialization for Cline that is common to all platforms.
 *
 * @param context
 * @returns The webview provider
 * @throws ClineConfigurationError if endpoints.json exists but is invalid
 */
export async function initialize(context: vscode.ExtensionContext): Promise<WebviewProvider> {
	// Configure the shared Logging class to use HostProvider's output channels and debug logger
	Logger.subscribe((msg: string) => HostProvider.get().logToChannel(msg)) // File system logging
	Logger.subscribe((msg: string) => HostProvider.env.debugLog({ value: msg })) // Host debug logging

	// Initialize ClineEndpoint configuration first (reads ~/.cline/endpoints.json if present)
	// This must be done before any other code that calls ClineEnv.config()
	// Throws ClineConfigurationError if config file exists but is invalid
	const { ClineEndpoint } = await import("./config")
	await ClineEndpoint.initialize()

	try {
		await StateManager.initialize(context)
	} catch (error) {
		Logger.error("[Controller] CRITICAL: Failed to initialize StateManager - extension may not function properly:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to initialize Cline's application state. Please restart the extension.",
		})
	}

	// Initialize OpenAI Codex OAuth manager with extension context for secrets storage
	openAiCodexOAuthManager.initialize(context)

	// Set the distinct ID for logging and telemetry
	await initializeDistinctId(context)

	// Initialize PostHog client provider (skip in self-hosted mode)
	if (!ClineEndpoint.isSelfHosted()) {
		PostHogClientProvider.getInstance()
	}

	// Setup the external services
	await ErrorService.initialize()
	await featureFlagsService.poll(null)

	// Clean up orphaned file context warnings (startup cleanup)
	await FileContextTracker.cleanupOrphanedWarnings(context)

	const webview = HostProvider.get().createWebviewProvider()

	await showVersionUpdateAnnouncement(context)

	// Check if this workspace was opened from worktree quick launch
	await checkWorktreeAutoOpen(context)

	// Initialize banner service (TEMPORARILY DISABLED - not fetching banners to prevent API hammering)
	BannerService.initialize(webview.controller)
	// DISABLED: .getActiveBanners(true)

	telemetryService.captureExtensionActivated()

	// Use remote config blobStoreConfig if available, otherwise fall back to env vars
	const blobStoreSettings = StateManager.get().getRemoteConfigSettings()?.blobStoreConfig ?? getBlobStoreSettingsFromEnv()
	syncWorker().init({ ...blobStoreSettings, userDistinctId: getDistinctId() })

	return webview
}

async function showVersionUpdateAnnouncement(context: vscode.ExtensionContext) {
	// Version checking for autoupdate notification
	const currentVersion = ExtensionRegistryInfo.version
	const previousVersion = context.globalState.get<string>("clineVersion")
	// Perform post-update actions if necessary
	try {
		if (!previousVersion || currentVersion !== previousVersion) {
			Logger.log(`Cline version changed: ${previousVersion} -> ${currentVersion}. First run or update detected.`)

			// Check if there's a new announcement to show
			const lastShownAnnouncementId = context.globalState.get<string>("lastShownAnnouncementId")
			const latestAnnouncementId = getLatestAnnouncementId()

			if (lastShownAnnouncementId !== latestAnnouncementId) {
				// Show notification when there's a new announcement (major/minor updates or fresh installs)
				const message = previousVersion
					? `Cline has been updated to v${currentVersion}`
					: `Welcome to Cline v${currentVersion}`
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
		Logger.error(`Error during post-update actions: ${errorMessage}, Stack trace: ${error.stack}`)
	}
}

/**
 * Checks if this workspace was opened from the worktree quick launch button.
 * If so, opens the Cline sidebar and clears the state.
 */
async function checkWorktreeAutoOpen(context: vscode.ExtensionContext): Promise<void> {
	try {
		// Read directly from globalState (not StateManager cache) since this may have been
		// set by another window right before this one opened
		const worktreeAutoOpenPath = context.globalState.get<string>("worktreeAutoOpenPath")
		if (!worktreeAutoOpenPath) {
			return
		}

		// Get current workspace path
		const workspacePaths = (await HostProvider.workspace.getWorkspacePaths({})).paths
		if (workspacePaths.length === 0) {
			return
		}

		const currentPath = workspacePaths[0]

		// Check if current workspace matches the worktree path
		if (arePathsEqual(currentPath, worktreeAutoOpenPath)) {
			// Clear the state first to prevent re-triggering
			await context.globalState.update("worktreeAutoOpenPath", undefined)
			// Open the Cline sidebar
			await HostProvider.workspace.openClineSidebarPanel({})
		}
	} catch (error) {
		Logger.error("Error checking worktree auto-open", error)
	}
}

/**
 * Performs cleanup when Cline is deactivated that is common to all platforms.
 */
export async function tearDown(): Promise<void> {
	// Clean up audio recording service to ensure no orphaned processes
	audioRecordingService.cleanup()

	PostHogClientProvider.getInstance().dispose()
	telemetryService.dispose()
	ErrorService.get().dispose()
	featureFlagsService.dispose()
	// Dispose all webview instances
	await WebviewProvider.disposeAllInstances()
	syncWorker().dispose()
}
