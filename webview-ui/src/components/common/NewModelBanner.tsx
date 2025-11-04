import { EmptyRequest, Int64Request } from "@shared/proto/index.cline"
import { Megaphone, XIcon } from "lucide-react"
import { useCallback } from "react"
import { useMount } from "react-use"
import { Button } from "@/components/ui/button"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient, StateServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_INACTIVE_SELECTION_BACKGROUND } from "@/utils/vscStyles"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"

export const CURRENT_MODEL_BANNER_VERSION = 2

export const NewModelBanner: React.FC = () => {
	const { clineUser } = useClineAuth()
	const { openRouterModels, setShowChatModelSelector, refreshOpenRouterModels } = useExtensionState()
	const user = clineUser || undefined
	const { handleFieldsChange } = useApiConfigurationHandlers()

	// Need to get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	const handleClose = useCallback((e?: React.MouseEvent) => {
		e?.preventDefault()
		e?.stopPropagation()

		// Update state instead of localStorage
		StateServiceClient.updateModelBannerVersion(Int64Request.create({ value: CURRENT_MODEL_BANNER_VERSION })).catch(
			console.error,
		)
	}, [])

	const setNewModel = () => {
		const modelId = "anthropic/claude-haiku-4.5"
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
			className="px-3 py-2 flex flex-col gap-1 shrink-0 mb-1 relative text-sm mt-1.5 m-4 no-underline transition-colors hover:brightness-120 border-0 cursor-pointer text-left w-auto rounded-sm"
			onClick={handleBannerClick}
			style={{
				backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
			}}>
			<h4 className="m-0 flex items-center gap-2">
				<Megaphone className="w-4 h-4" />
				Claude Haiku 4.5
			</h4>
			<p className="m-0">
				Anthropic's fastest model with frontier-level coding intelligence at a fraction of the cost.{" "}
				<span className="text-link cursor-pointer">{user ? "Try new model" : "Try with Cline account"} →</span>
			</p>

			{/* Close button */}
			<Button
				className="absolute top-2.5 right-2"
				data-testid="info-banner-close-button"
				onClick={handleClose}
				size="icon"
				variant="icon">
				<XIcon />
			</Button>
		</div>
	)
}

export default NewModelBanner
