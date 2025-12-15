import { Button } from "@components/ui/button"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useCallback, useRef } from "react"
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
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const clickedModelsRef = useRef<Set<string>>(new Set())

	// Get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	const setModel = useCallback(
		(modelId: string) => {
			handleFieldsChange({
				planModeOpenRouterModelId: modelId,
				actModeOpenRouterModelId: modelId,
				planModeOpenRouterModelInfo: openRouterModels[modelId],
				actModeOpenRouterModelInfo: openRouterModels[modelId],
				planModeApiProvider: "cline",
				actModeApiProvider: "cline",
			})

			clickedModelsRef.current.add(modelId)
			setShowChatModelSelector(true)
			onClose()
		},
		[handleFieldsChange, openRouterModels, setShowChatModelSelector, onClose],
	)

	const handleShowAccount = useCallback(() => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}, [])

	const ModelButton: React.FC<{ modelId: string; label: string }> = ({ modelId, label }) => {
		const isClicked = clickedModelsRef.current.has(modelId)
		if (isClicked) {
			return null
		}

		return (
			<Button className="my-1" onClick={() => setModel(modelId)} size="sm">
				{label}
			</Button>
		)
	}

	const AuthButton: React.FC<{ children: React.ReactNode }> = ({ children }) =>
		clineUser ? (
			<div className="flex gap-2 flex-wrap my-1.5">{children}</div>
		) : (
			<Button className="my-1" onClick={handleShowAccount} size="sm">
				Sign Up with Cline
			</Button>
		)

	return (
		<Dialog onOpenChange={(isOpen) => !isOpen && onClose()} open={open}>
			<DialogContent aria-describedby="whats-new-description" aria-labelledby="whats-new-title" className="p-0 gap-0">
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
								Use the new
								<a
									aria-label="Learn about the explain-changes slash command"
									className="mx-1"
									href="https://docs.cline.bot/features/slash-commands/explain-changes"
									rel="noreferrer"
									target="_blank">
									/explain-changes
								</a>
								slash command to explain the changes in branches, commits, etc. (Try asking Cline to explain a PR
								you need to review!)
							</li>
						)}
						<li className="mb-2">
							New <strong>OpenAI GPT-5.2</strong> model available!
							<br />
							<AuthButton>
								<ModelButton label="Try GPT-5.2" modelId="openai/gpt-5.2" />
							</AuthButton>
						</li>
						<li className="mb-2">
							Mistral's <strong>Devstral-2512:free</strong> (formerly stealth model "Microwave"), free for a limited
							time!
							<br />
							<AuthButton>
								<ModelButton label="Try for Free Devstral-2512" modelId="mistralai/devstral-2512:free" />
							</AuthButton>
						</li>
					</ul>

					{/* Action button */}
					<div className="flex gap-3 pt-4 border-t-1 border-description/20">
						<Button data-testid="close-whats-new-modal" onClick={onClose} size="sm" variant="secondary">
							Dismiss
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default WhatsNewModal
