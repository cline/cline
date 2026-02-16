import React, { useCallback } from "react"
import { useMount } from "react-use"
import DiscordIcon from "@/assets/DiscordIcon"
import GitHubIcon from "@/assets/GitHubIcon"
import LinkedInIcon from "@/assets/LinkedInIcon"
import RedditIcon from "@/assets/RedditIcon"
import XIcon from "@/assets/XIcon"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"

interface WhatsNewModalProps {
	open: boolean
	onClose: () => void
	version: string
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ open, onClose, version }) => {
	const { openRouterModels, refreshOpenRouterModels, navigateToSettingsModelPicker } = useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()

	// Get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	const navigateToModelPicker = useCallback(
		(initialModelTab: "recommended" | "free", modelId?: string) => {
			// Switch to Cline provider first so the model picker tab works
			// Optionally also set the model if provided
			const updates: Record<string, any> = {
				planModeApiProvider: "cline",
				actModeApiProvider: "cline",
			}
			if (modelId) {
				updates.planModeOpenRouterModelId = modelId
				updates.actModeOpenRouterModelId = modelId
				updates.planModeOpenRouterModelInfo = openRouterModels[modelId]
				updates.actModeOpenRouterModelInfo = openRouterModels[modelId]
			}
			handleFieldsChange(updates)
			onClose()
			navigateToSettingsModelPicker({ targetSection: "api-config", initialModelTab })
		},
		[handleFieldsChange, navigateToSettingsModelPicker, onClose, openRouterModels],
	)

	type InlineModelLinkProps = { pickerTab: "recommended" | "free"; modelId: string; label: string }

	const InlineModelLink: React.FC<InlineModelLinkProps> = (props) => {
		return (
			<span
				onClick={() => navigateToModelPicker(props.pickerTab, props.modelId)}
				style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
				{props.label}
			</span>
		)
	}

	const inlineCodeStyle: React.CSSProperties = {
		backgroundColor: "var(--vscode-textCodeBlock-background)",
		padding: "2px 6px",
		borderRadius: "3px",
		fontFamily: "var(--vscode-editor-font-family)",
		fontSize: "0.9em",
	}

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
							<strong>GLM 5 is now available with free promo!</strong> the latest open-source SOTA model for
							advanced reasoning, coding, and agentic tasks.{" "}
							<InlineModelLink label="Try now" modelId="z-ai/glm-5" pickerTab="free" />
						</li>
						<li className="mb-2">
							<strong>Minimax M2.5 is now available with free promo!</strong> SOTA coding capability with lightning
							fast inference. <InlineModelLink label="Try now" modelId="minimax/minimax-m2.5" pickerTab="free" />
						</li>
						<li className="mb-2">
							<strong>Cline CLI 2.0:</strong> Major upgrade bringing interactive and autonomous agentic coding to
							your terminal. Install with <code style={inlineCodeStyle}>npm install -g cline</code>
							<a
								href="https://cline.bot/cli"
								rel="noopener noreferrer"
								style={{ color: "var(--vscode-textLink-foreground)" }}
								target="_blank">
								{" "}
								Learn more
							</a>
						</li>
						<li className="mb-2">
							<strong> Subagents experimental feature</strong> available in VSCode and the CLI.{" "}
							<a
								href="https://docs.cline.bot/features/subagents"
								rel="noopener noreferrer"
								style={{ color: "var(--vscode-textLink-foreground)" }}
								target="_blank">
								Learn more
							</a>
						</li>
					</ul>

					{/* Social Icons Section */}
					<div className="flex flex-col items-center gap-3 mt-4 pt-4 border-t border-[var(--vscode-widget-border)]">
						{/* Icon Row */}
						<div className="flex items-center gap-4">
							{/* X/Twitter */}
							<a
								aria-label="Follow us on X"
								className="text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] transition-colors"
								href="https://x.com/cline"
								rel="noopener noreferrer"
								target="_blank">
								<XIcon />
							</a>

							{/* Discord */}
							<a
								aria-label="Join our Discord"
								className="text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] transition-colors"
								href="https://discord.gg/cline"
								rel="noopener noreferrer"
								target="_blank">
								<DiscordIcon />
							</a>

							{/* GitHub */}
							<a
								aria-label="Star us on GitHub"
								className="text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] transition-colors"
								href="https://github.com/cline/cline"
								rel="noopener noreferrer"
								target="_blank">
								<GitHubIcon />
							</a>

							{/* Reddit */}
							<a
								aria-label="Join our subreddit"
								className="text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] transition-colors"
								href="https://www.reddit.com/r/cline/"
								rel="noopener noreferrer"
								target="_blank">
								<RedditIcon />
							</a>

							{/* LinkedIn */}
							<a
								aria-label="Follow us on LinkedIn"
								className="text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] transition-colors"
								href="https://www.linkedin.com/company/clinebot/"
								rel="noopener noreferrer"
								target="_blank">
								<LinkedInIcon />
							</a>
						</div>

						{/* GitHub Star CTA */}
						<p className="text-sm text-center" style={{ color: "var(--vscode-descriptionForeground)" }}>
							Please support Cline by{" "}
							<a
								href="https://github.com/cline/cline"
								rel="noopener noreferrer"
								style={{ color: "var(--vscode-textLink-foreground)" }}
								target="_blank">
								starring us on GitHub
							</a>
							.
						</p>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default WhatsNewModal
