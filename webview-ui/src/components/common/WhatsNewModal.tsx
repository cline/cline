import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import React, { useState } from "react"
import { useMount } from "react-use"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"

interface WhatsNewModalProps {
	open: boolean
	onClose: () => void
	version: string
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ open, onClose, version }) => {
	const isVscode = PLATFORM_CONFIG.type === PlatformType.VSCODE
	const { clineUser } = useClineAuth()
	const { openRouterModels, setShowChatModelSelector, refreshOpenRouterModels } = useExtensionState()
	const user = clineUser || undefined
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const [didClickDevstralButton, setDidClickDevstralButton] = useState(false)
	const [didClickGPT52Button, setDidClickGPT52Button] = useState(false)
	// Need to get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	const setDevstral = () => {
		const modelId = "mistralai/devstral-2512:free"
		handleFieldsChange({
			planModeOpenRouterModelId: modelId,
			actModeOpenRouterModelId: modelId,
			planModeOpenRouterModelInfo: openRouterModels[modelId],
			actModeOpenRouterModelInfo: openRouterModels[modelId],
			planModeApiProvider: "cline",
			actModeApiProvider: "cline",
		})

		setTimeout(() => {
			setDidClickDevstralButton(true)
			setShowChatModelSelector(true)
			onClose()
		}, 10)
	}

	const setGPT52 = () => {
		const modelId = "openai/gpt-5.2"
		handleFieldsChange({
			planModeOpenRouterModelId: modelId,
			actModeOpenRouterModelId: modelId,
			planModeOpenRouterModelInfo: openRouterModels[modelId],
			actModeOpenRouterModelInfo: openRouterModels[modelId],
			planModeApiProvider: "cline",
			actModeApiProvider: "cline",
		})

		setTimeout(() => {
			setDidClickGPT52Button(true)
			setShowChatModelSelector(true)
			onClose()
		}, 10)
	}

	const handleShowAccount = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}

	return (
		<Dialog onOpenChange={(isOpen) => !isOpen && onClose()} open={open}>
			<DialogContent
				aria-describedby="whats-new-description"
				aria-labelledby="whats-new-title"
				className="max-w-md p-0 gap-0">
				{/* Content area */}
				<div className="p-5 pr-10" id="whats-new-description">
					{/* Badge */}
					<div className="mb-3">
						<span
							className="px-2 py-1 text-xs font-semibold rounded"
							style={{
								backgroundColor: "color-mix(in srgb, var(--vscode-button-background) 30%, transparent)",
								color: "var(--vscode-button-foreground)",
							}}>
							NEW
						</span>
					</div>

					{/* Title */}
					<h2
						className="text-lg font-semibold mb-3"
						id="whats-new-title"
						style={{ color: "var(--vscode-editor-foreground)" }}>
						🎉 New in v{version}
					</h2>

					{/* Description */}
					<ul className="text-sm mb-3 pl-3 list-disc" style={{ color: "var(--vscode-descriptionForeground)" }}>
						{isVscode && (
							<li className="mb-2">
								Use the new{" "}
								<VSCodeLink
									href="https://docs.cline.bot/features/slash-commands/explain-changes"
									style={{ display: "inline" }}>
									/explain-changes
								</VSCodeLink>{" "}
								slash command to explain the changes in branches, commits, etc. (Try asking Cline to explain a PR
								you need to review!)
							</li>
						)}
						<li className="mb-2">
							New <strong>OpenAI GPT-5.2</strong> model available!
							<br />
							{user ? (
								<div className="flex gap-2 flex-wrap my-1.5">
									{!didClickGPT52Button && (
										<VSCodeButton
											appearance="primary"
											onClick={setGPT52}
											style={{ transform: "scale(0.85)", transformOrigin: "left center" }}>
											Try GPT-5.2
										</VSCodeButton>
									)}
								</div>
							) : (
								<VSCodeButton
									appearance="primary"
									onClick={handleShowAccount}
									style={{ margin: "5px 0", transform: "scale(0.85)", transformOrigin: "left center" }}>
									Sign Up with Cline
								</VSCodeButton>
							)}
						</li>
						<li className="mb-2">
							Mistral's <strong>Devstral-2512:free</strong> (formerly stealth model "Microwave"), free for a limited
							time!
							<br />
							{user ? (
								<div className="flex gap-2 flex-wrap my-1.5">
									{!didClickDevstralButton && (
										<VSCodeButton
											appearance="primary"
											onClick={setDevstral}
											style={{ transform: "scale(0.85)", transformOrigin: "left center" }}>
											Try for Free Devstral-2512
										</VSCodeButton>
									)}
								</div>
							) : (
								<VSCodeButton
									appearance="primary"
									onClick={handleShowAccount}
									style={{ margin: "5px 0", transform: "scale(0.85)", transformOrigin: "left center" }}>
									Sign Up with Cline
								</VSCodeButton>
							)}
						</li>
					</ul>

					{/* Divider */}
					<div
						className="mb-3"
						style={{
							height: "1px",
							backgroundColor: "var(--vscode-descriptionForeground)",
							opacity: 0.1,
						}}
					/>

					{/* Action button */}
					<div className="flex gap-3">
						<VSCodeButton appearance="secondary" data-testid="close-whats-new-modal" onClick={onClose}>
							Dismiss
						</VSCodeButton>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default WhatsNewModal
