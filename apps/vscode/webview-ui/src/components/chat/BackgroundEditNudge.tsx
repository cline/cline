import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { CheckIcon, LightbulbIcon, XIcon } from "lucide-react"
import { memo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * One-time hint shown under the first file edit of a task, suggesting the user
 * enable Background Edit so the diff editor stops taking focus on every edit.
 *
 * Visibility is controlled by two persisted flags: it only appears while
 * Background Edit is off and the user hasn't interacted with the hint yet.
 * Enabling or dismissing persists `backgroundEditHintDismissed`, so the hint
 * never comes back.
 */
export const BackgroundEditNudge = memo(() => {
	const { backgroundEditEnabled, backgroundEditHintDismissed } = useExtensionState()
	// Local interaction state keeps the confirmation on screen after clicking
	// Enable — the persisted flags coming back from the extension would
	// otherwise unmount the hint before the user sees what happened.
	const [interaction, setInteraction] = useState<"none" | "enabled" | "dismissed">("none")

	if (interaction === "dismissed") {
		return null
	}
	if (interaction === "none" && (backgroundEditEnabled || backgroundEditHintDismissed)) {
		return null
	}

	const isEnabled = interaction === "enabled"

	const persist = (enable: boolean) => {
		StateServiceClient.updateSettings(
			UpdateSettingsRequest.create({
				...(enable ? { backgroundEditEnabled: true } : {}),
				backgroundEditHintDismissed: true,
			}),
		).catch((error) => {
			console.error("Failed to update Background Edit settings:", error)
		})
	}

	const handleEnable = () => {
		setInteraction("enabled")
		persist(true)
	}

	const handleDismiss = () => {
		setInteraction("dismissed")
		persist(false)
	}

	return (
		<div className="relative mt-2 p-2 bg-link/10 border border-link/30 rounded-xs">
			{!isEnabled && (
				<button
					aria-label="Dismiss"
					className="absolute top-1 right-1 p-0.5 bg-transparent border-0 cursor-pointer text-description hover:text-foreground"
					onClick={handleDismiss}
					title="Dismiss">
					<XIcon className="size-2" />
				</button>
			)}
			<div className="flex items-center mb-1">
				<LightbulbIcon className="mr-1.5 size-2 text-link shrink-0" />
				<span className="font-medium text-foreground">Tired of the diff editor taking focus?</span>
			</div>
			<div className="text-foreground opacity-90 mb-2">
				{isEnabled
					? "Cline will now edit files in the background and show changes here in chat instead. You can change this anytime in Settings → Features."
					: "Background Edit lets Cline make changes without opening files in the editor — edits show up right here in chat instead."}
			</div>
			<button
				className={cn(
					"bg-button-background text-button-foreground border-0 rounded-xs py-1.5 px-3 text-[12px] flex items-center gap-1.5 cursor-pointer hover:bg-button-hover",
					{
						"cursor-default opacity-80 bg-success hover:bg-success": isEnabled,
					},
				)}
				disabled={isEnabled}
				onClick={handleEnable}>
				{isEnabled ? <CheckIcon className="size-2" /> : <LightbulbIcon className="size-2" />}
				{isEnabled ? "Background Edit Enabled" : "Enable Background Edit"}
			</button>
		</div>
	)
})

BackgroundEditNudge.displayName = "BackgroundEditNudge"
