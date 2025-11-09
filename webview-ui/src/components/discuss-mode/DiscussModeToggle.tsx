import { BooleanRequest, EmptyRequest } from "@shared/proto/cline/common"
import { Mic, MicOff } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TtsServiceClient, UiServiceClient } from "@/services/grpc-client"

interface DiscussModeToggleProps {
	className?: string
}

/**
 * Toggle button to enable/disable Discuss Mode in Plan Mode.
 * When enabled, Cline's responses are spoken via TTS and conversations
 * can flow naturally with voice input/output.
 */
export function DiscussModeToggle({ className = "" }: DiscussModeToggleProps) {
	const { discussModeEnabled, mode, discussModeSettings } = useExtensionState()
	const [isToggling, setIsToggling] = useState(false)
	const [isConfigured, setIsConfigured] = useState(false)

	// Only show in Plan Mode
	const isPlanMode = mode === "plan"

	console.log("[DiscussModeToggle] Component rendered:", {
		mode,
		isPlanMode,
		discussModeSettings,
		discussModeEnabled,
	})

	// Check if API key is configured on mount and when settings change
	useEffect(() => {
		const checkConfiguration = async () => {
			try {
				console.log("[DiscussModeToggle] Checking configuration...")
				const response = await TtsServiceClient.CheckApiKeyConfigured(EmptyRequest.create())
				const hasVoice = !!discussModeSettings?.selectedVoice

				console.log("[DiscussModeToggle] Configuration check result:", {
					apiKeyValid: response.isValid,
					hasVoice,
					selectedVoice: discussModeSettings?.selectedVoice,
					error: response.error,
				})

				setIsConfigured(response.isValid && hasVoice)
			} catch (error) {
				console.error("[DiscussModeToggle] Failed to check TTS configuration:", error)
				setIsConfigured(false)
			}
		}
		checkConfiguration()
	}, [discussModeSettings])

	const handleToggle = useCallback(async () => {
		if (isToggling || !isPlanMode) return

		// If not configured, show settings hint
		if (!isConfigured) {
			// TODO: Show tooltip or open settings panel
			console.warn("Discuss Mode requires ElevenLabs API key configuration")
			return
		}

		setIsToggling(true)
		try {
			// Toggle discuss mode via gRPC
			await UiServiceClient.setDiscussModeEnabled(BooleanRequest.create({ value: !discussModeEnabled }))
		} catch (error) {
			console.error("Error toggling Discuss Mode:", error)
		} finally {
			setIsToggling(false)
		}
	}, [discussModeEnabled, isPlanMode, isConfigured, isToggling])

	// Don't render in Act Mode
	if (!isPlanMode) {
		return null
	}

	const isEnabled = discussModeEnabled && isConfigured

	return (
		<button
			className={`
				group relative flex items-center gap-2 px-3 py-2 rounded-lg
				transition-all duration-200 ease-in-out
				${
					isEnabled
						? "bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground"
						: "bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground"
				}
				${!isConfigured ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
				${isToggling ? "opacity-70" : ""}
				${className}
			`}
			disabled={isToggling || !isConfigured}
			onClick={handleToggle}
			title={
				!isConfigured
					? "Configure ElevenLabs API key in settings to enable Discuss Mode"
					: isEnabled
						? "Disable Discuss Mode (voice conversations)"
						: "Enable Discuss Mode (voice conversations)"
			}>
			{/* Icon */}
			<div
				className={`
				transition-transform duration-200
				${isEnabled ? "scale-110" : "scale-100"}
			`}>
				{isEnabled ? <Mic className="w-4 h-4" strokeWidth={2} /> : <MicOff className="w-4 h-4" strokeWidth={2} />}
			</div>

			{/* Label */}
			<span className="text-sm font-medium">{isEnabled ? "Discussing" : "Discuss Mode"}</span>

			{/* Status indicator */}
			{isEnabled && (
				<div className="relative">
					<div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
					<div className="absolute inset-0 w-2 h-2 bg-green-500 rounded-full opacity-50 animate-ping" />
				</div>
			)}

			{/* Hover tooltip for unconfigured state */}
			{!isConfigured && (
				<div
					className="
					invisible group-hover:visible
					absolute top-full left-0 mt-2 p-2
					bg-vscode-notifications-background
					border border-vscode-notifications-border
					rounded shadow-lg z-50 w-64
					text-xs text-vscode-notifications-foreground
				">
					⚙️ Configure ElevenLabs API key in Settings → Voice to enable Discuss Mode
				</div>
			)}
		</button>
	)
}

export default DiscussModeToggle
