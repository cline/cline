import { RecordingResult } from "@shared/proto/cline/dictation"
import * as os from "os"
import { HostProvider } from "@/hosts/host-provider"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { telemetryService } from "@/services/telemetry"
import { AUDIO_PROGRAM_CONFIG } from "@/shared/audioProgramConstants"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Controller } from ".."

/**
 * Handles the installation of missing dependencies with Cline
 */
async function handleInstallWithCline(
	controller: Controller,
	dependencyName: string,
	installCommand: string,
	platform: string,
): Promise<void> {
	const platformName = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux"
	const installTask = `Please install ${dependencyName} for voice recording on ${platformName}.\n\nRun this command:\n\`\`\`bash\n${installCommand}\n\`\`\`\n\nThis will enable voice recording functionality in Cline.`

	// Clear any existing task and start the installation task
	await controller.clearTask()
	await controller.postStateToWebview()
	await controller.initTask(installTask)

	HostProvider.get().logToChannel(`Started task to install ${dependencyName}`)
}

/**
 * Handles copying the installation command to clipboard
 */
async function handleCopyCommand(installCommand: string): Promise<void> {
	await HostProvider.env.clipboardWriteText({ value: installCommand })
	await HostProvider.window.showMessage({
		type: ShowMessageType.INFORMATION,
		message: `Installation command copied to clipboard: ${installCommand}`,
		options: { items: [] },
	})
}

/**
 * Handles missing dependency notification and user action
 */
async function handleMissingDependency(
	controller: Controller,
	platform: string,
	config: (typeof AUDIO_PROGRAM_CONFIG)[keyof typeof AUDIO_PROGRAM_CONFIG],
): Promise<void> {
	const installWithCline = "Install with Cline"
	const installManually = "Copy Command"
	const dismiss = "Dismiss"

	const action = await HostProvider.window.showMessage({
		type: ShowMessageType.INFORMATION,
		message: `${config.dependencyName} is required for voice recording. ${config.installDescription}`,
		options: { items: [installWithCline, installManually, dismiss] },
	})

	if (action.selectedOption === installWithCline) {
		await handleInstallWithCline(controller, config.dependencyName, config.installCommand, platform)
	} else if (action.selectedOption === installManually) {
		await handleCopyCommand(config.installCommand)
	}
	// If dismiss, do nothing
}

/**
 * Handles sign-in errors for dictation
 */
async function handleSignInError(controller: Controller, errorMessage: string): Promise<void> {
	const signInAction = "Sign in to Cline"
	const action = await HostProvider.window.showMessage({
		type: ShowMessageType.ERROR,
		message: `Voice recording error: ${errorMessage}`,
		options: { items: [signInAction] },
	})

	if (action.selectedOption === signInAction) {
		await controller.authService.createAuthRequest()
	}
}

/**
 * Shows a generic error message
 */
async function showGenericError(errorMessage: string): Promise<void> {
	await HostProvider.window.showMessage({
		type: ShowMessageType.ERROR,
		message: `Voice recording error: ${errorMessage}`,
		options: { items: [] },
	})
}

/**
 * Checks if the recording error is due to missing dependencies
 */
function isMissingDependencyError(
	error: string | undefined,
	config: (typeof AUDIO_PROGRAM_CONFIG)[keyof typeof AUDIO_PROGRAM_CONFIG] | undefined,
): boolean {
	return !!(error && config && error.includes(config.error))
}

/**
 * Starts audio recording using the Extension Host
 * @param controller The controller instance
 * @returns RecordingResult with success status
 */
export const startRecording = async (controller: Controller): Promise<RecordingResult> => {
	const taskId = controller.task?.taskId

	try {
		// Verify user authentication
		const userInfo = controller.authService.getInfo()
		if (!userInfo?.user?.uid) {
			throw new Error("Please sign in to your Cline Account to use Dictation.")
		}

		// Attempt to start recording
		const result = await audioRecordingService.startRecording()

		// Handle successful recording start
		if (result.success) {
			telemetryService.captureVoiceRecordingStarted(taskId, process.platform)
			return RecordingResult.create({
				success: true,
				error: "",
			})
		}

		// Check if the error is due to missing dependencies
		const platform = os.platform() as keyof typeof AUDIO_PROGRAM_CONFIG
		const config = AUDIO_PROGRAM_CONFIG[platform]

		if (isMissingDependencyError(result.error, config)) {
			// Don't await - show dialog asynchronously so frontend gets immediate response
			handleMissingDependency(controller, platform, config)
		}

		return RecordingResult.create({
			success: false,
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error starting recording:", error)
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"

		// Handle different error types
		if (errorMessage.includes("sign in")) {
			// Don't await - show dialog asynchronously so frontend gets immediate response
			handleSignInError(controller, errorMessage)
		} else {
			// Don't await - show dialog asynchronously so frontend gets immediate response
			showGenericError(errorMessage)
		}

		return RecordingResult.create({
			success: false,
			error: errorMessage,
		})
	}
}
