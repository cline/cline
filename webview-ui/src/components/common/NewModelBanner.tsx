import { EmptyRequest } from "@shared/proto/index.cline"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { Megaphone } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useMount } from "react-use"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_INACTIVE_SELECTION_BACKGROUND } from "@/utils/vscStyles"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"

const NEW_MODEL_BANNER_DISMISSED_KEY = "new-model-banner-dismissed"
const CURRENT_BANNER_VERSION = "sep-28-2025"

export const NewModelBanner: React.FC = () => {
	const { clineUser } = useClineAuth()
	const { apiConfiguration, openRouterModels, setShowChatModelSelector, refreshOpenRouterModels } = useExtensionState()
	const user = apiConfiguration?.clineAccountId ? clineUser : undefined
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const [shouldShow, setShouldShow] = useState<boolean>(false)

	// Need to get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	// Check localStorage on mount to see if banner was already dismissed
	useEffect(() => {
		try {
			const dismissedVersion = localStorage.getItem(NEW_MODEL_BANNER_DISMISSED_KEY)
			if (dismissedVersion !== CURRENT_BANNER_VERSION) {
				setShouldShow(true)
			}
		} catch (e) {
			console.error("Error checking banner dismissal state:", e)
		}
	}, [])

	const handleClose = useCallback((e?: React.MouseEvent) => {
		e?.preventDefault()
		e?.stopPropagation()

		// Store dismissal state in localStorage
		try {
			localStorage.setItem(NEW_MODEL_BANNER_DISMISSED_KEY, CURRENT_BANNER_VERSION)
			setShouldShow(false)
		} catch (e) {
			console.error("Error storing banner dismissal state:", e)
		}
	}, [])

	// Don't show banner if it was already dismissed
	if (!shouldShow) {
		return null
	}

	const setNewModel = () => {
		const modelId = "anthropic/claude-sonnet-4.5"
		// set both plan and act modes to use new model
		handleFieldsChange({
			planModeOpenRouterModelId: modelId,
			actModeOpenRouterModelId: modelId,
			planModeOpenRouterModelInfo: openRouterModels[modelId],
			actModeOpenRouterModelInfo: openRouterModels[modelId],
			planModeApiProvider: "cline",
			actModeApiProvider: "cline",
		})

		setTimeout(() => {
			setShowChatModelSelector(true)
		}, 10)

		setTimeout(() => {
			handleClose()
		}, 50)
	}

	const handleShowAccount = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}

	const handleBannerClick = () => {
		if (user) {
			setNewModel()
		} else {
			handleShowAccount()
		}
	}

	return (
		<div
			className="px-3 py-2 flex flex-col gap-1 shrink-0 mb-1 relative text-sm m-4 no-underline transition-colors hover:brightness-120 border-0 cursor-pointer text-left w-auto"
			onClick={handleBannerClick}
			style={{
				backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
				borderRadius: "3px",
				color: "var(--vscode-foreground)",
			}}>
			<h4 className="m-0 flex items-center gap-2" style={{ paddingRight: "18px" }}>
				<Megaphone className="w-4 h-4" />
				Claude Sonnet 4.5
			</h4>
			<p className="m-0">
				Anthropic's latest model excels at complex planning and long-horizon coding tasks.{" "}
				<span className="text-link cursor-pointer">{user ? "Try new model" : "Try with Cline account"} →</span>
			</p>

			{/* Close button */}
			<VSCodeButton
				appearance="icon"
				data-testid="info-banner-close-button"
				onClick={handleClose}
				style={{ position: "absolute", top: "6px", right: "6px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
		</div>
	)
}

export default NewModelBanner
