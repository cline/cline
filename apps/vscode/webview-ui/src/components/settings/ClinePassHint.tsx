import { Sparkles, XIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CLINE_PASS_FEATURE_FLAG } from "@/constants/featureFlags"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useHasFeatureFlag } from "@/hooks/useFeatureFlag"
import { StateServiceClient } from "@/services/grpc-client"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

const CLINE_PASS_SETTINGS_HINT_ID = "cline-pass-settings-hint-v1"
const CLINE_PASS_PROVIDER_ID = "cline-pass"

interface ClinePassHintProps {
	selectedProvider: string
}

/**
 * Compact, dismissible callout under the API provider dropdown that lets users
 * of any provider discover ClinePass. Selecting it swaps the provider in place
 * so its settings render right below.
 */
export const ClinePassHint = ({ selectedProvider }: ClinePassHintProps) => {
	const isClinePassEnabled = useHasFeatureFlag(CLINE_PASS_FEATURE_FLAG)
	const { dismissedBanners, remoteConfigSettings } = useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()
	const [locallyDismissed, setLocallyDismissed] = useState(false)

	const isDismissed =
		locallyDismissed || (dismissedBanners ?? []).some((dismissed) => dismissed.bannerId === CLINE_PASS_SETTINGS_HINT_ID)

	// Respect org-managed provider allowlists.
	const remoteProviders: string[] = remoteConfigSettings?.remoteConfiguredProviders || []
	const isBlockedByRemoteConfig = remoteProviders.length > 0 && !remoteProviders.includes(CLINE_PASS_PROVIDER_ID)

	if (!isClinePassEnabled || selectedProvider === CLINE_PASS_PROVIDER_ID || isDismissed || isBlockedByRemoteConfig) {
		return null
	}

	const handleDismiss = () => {
		setLocallyDismissed(true)
		StateServiceClient.dismissBanner({ value: CLINE_PASS_SETTINGS_HINT_ID }).catch(console.error)
	}

	const handleTryIt = () => {
		handleFieldsChange({
			planModeApiProvider: CLINE_PASS_PROVIDER_ID,
			actModeApiProvider: CLINE_PASS_PROVIDER_ID,
		}).catch((error) => console.error("Failed to switch to ClinePass provider:", error))
	}

	return (
		<div
			className="flex items-start gap-2 rounded-sm bg-[var(--vscode-textBlockQuote-background)] px-2.5 py-2 mt-1"
			data-testid="cline-pass-settings-hint">
			<Sparkles className="size-3.5 shrink-0 mt-0.5 text-[var(--vscode-charts-yellow)]" />
			<div className="grow text-xs text-description">
				<span className="font-semibold text-foreground">ClinePass</span> — the latest open-weights models for $9.99/month.{" "}
				<button
					className="cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground,var(--vscode-textLink-foreground))]"
					onClick={handleTryIt}
					type="button">
					Try it
				</button>
			</div>
			<Button
				aria-label="Dismiss ClinePass hint"
				className="shrink-0 -mt-0.5 -mr-1"
				onClick={handleDismiss}
				size="icon"
				variant="icon">
				<XIcon className="size-3.5" />
			</Button>
		</div>
	)
}
