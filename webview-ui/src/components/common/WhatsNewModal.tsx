import { Button } from "@components/ui/button"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useCallback, useRef } from "react"
import { useMount } from "react-use"
import { Dialog, DialogContent } from "@/components/ui/dialog"
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
			<div className="flex gap-2 flex-wrap">{children}</div>
		) : (
			<Button className="my-1" onClick={handleShowAccount} size="sm">
				Sign Up with Cline
			</Button>
		)

	return (
		<Dialog onOpenChange={(isOpen) => !isOpen && onClose()} open={open}>
			<DialogContent
				aria-describedby="whats-new-description"
				aria-labelledby="whats-new-title"
				className="pt-5 px-5 pb-4 gap-0">
				<div id="whats-new-description">
					<h2
						className="text-lg font-semibold mb-3 pr-6"
						id="whats-new-title"
						style={{ color: "var(--vscode-editor-foreground)" }}>
						🎉 New in v{version}
					</h2>

					{/* Description */}
					<ul className="text-sm pl-3 list-disc" style={{ color: "var(--vscode-descriptionForeground)" }}>
						<li className="mb-2">
							<strong>OpenAI:</strong> Added gpt-5.2-codex model support
							<div>
								<AuthButton>
									<ModelButton label="Try now!" modelId="openai/gpt-5.2-codex" />
								</AuthButton>
							</div>
						</li>
						<li className="mb-2">
							<strong>Skills:</strong> Extend Cline with instruction sets for specialized tasks.{" "}
							<a
								href="https://docs.cline.bot/features/skills"
								style={{ color: "var(--vscode-textLink-foreground)" }}>
								Learn more
							</a>
						</li>
						<li>
							<strong>Web Search:</strong> Improved websearch tooling in Cline provider.{" "}
							<a
								href="https://docs.cline.bot/features/web-tools"
								style={{ color: "var(--vscode-textLink-foreground)" }}>
								Learn more
							</a>
						</li>
					</ul>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default WhatsNewModal
