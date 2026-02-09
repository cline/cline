import React, { useCallback } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"

interface WhatsNewModalProps {
	open: boolean
	onClose: () => void
	version: string
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ open, onClose, version }) => {
	const { navigateToSettings } = useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const setOpenAiCodexProvider = useCallback(() => {
		handleFieldsChange({
			planModeApiProvider: "openai-codex",
			actModeApiProvider: "openai-codex",
		})
		onClose()
		navigateToSettings("api-config")
	}, [handleFieldsChange, onClose, navigateToSettings])

	const setClaudeCodeProvider = useCallback(() => {
		handleFieldsChange({
			planModeApiProvider: "claude-code",
			actModeApiProvider: "claude-code",
		})
		onClose()
		navigateToSettings("api-config")
	}, [handleFieldsChange, onClose, navigateToSettings])

	const setGitHubCopilotProvider = useCallback(() => {
		handleFieldsChange({
			planModeApiProvider: "vscode-lm",
			actModeApiProvider: "vscode-lm",
		})
		onClose()
		navigateToSettings("api-config")
	}, [handleFieldsChange, onClose, navigateToSettings])

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
						Welcome to Beadsmith v{version}
					</h2>

					<p className="text-sm mb-3" style={{ color: "var(--vscode-descriptionForeground)" }}>
						Beadsmith is a fork of Cline that integrates with your existing AI providers.
					</p>

					{/* Provider options */}
					<ul className="text-sm pl-3 list-disc" style={{ color: "var(--vscode-descriptionForeground)" }}>
						<li className="mb-2">
							<strong>Use Claude Code:</strong> Connect with your Anthropic Claude Code subscription.{" "}
							<span
								onClick={setClaudeCodeProvider}
								style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
								Configure
							</span>
						</li>
						<li className="mb-2">
							<strong>Use GitHub Copilot:</strong> Leverage your existing Copilot subscription.{" "}
							<span
								onClick={setGitHubCopilotProvider}
								style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
								Configure
							</span>
						</li>
						<li className="mb-2">
							<strong>Use ChatGPT Plus/Pro:</strong> Connect with OpenAI Codex (ChatGPT Plus/Pro).{" "}
							<span
								onClick={setOpenAiCodexProvider}
								style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
								Configure
							</span>
						</li>
						<li>
							<strong>Many more providers:</strong> OpenRouter, Anthropic API, Google Gemini, and more.{" "}
							<span
								onClick={() => {
									onClose()
									navigateToSettings("api-config")
								}}
								style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
								See all
							</span>
						</li>
					</ul>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default WhatsNewModal
