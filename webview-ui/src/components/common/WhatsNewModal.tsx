import { Button } from "@components/ui/button"
import { EmptyRequest } from "@shared/proto/cline/common"
import React, { useCallback, useRef } from "react"
import { useMount } from "react-use"
import DiscordIcon from "@/assets/DiscordIcon"
import GitHubIcon from "@/assets/GitHubIcon"
import LinkedInIcon from "@/assets/LinkedInIcon"
import RedditIcon from "@/assets/RedditIcon"
import XIcon from "@/assets/XIcon"
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
	const {
		openRouterModels,
		setShowChatModelSelector,
		refreshOpenRouterModels,
		navigateToSettings,
		navigateToSettingsModelPicker,
	} = useExtensionState()
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

	const navigateToModelPicker = useCallback(
		(initialModelTab: "recommended" | "free") => {
			// Switch to Cline provider first so the model picker tab works
			handleFieldsChange({
				planModeApiProvider: "cline",
				actModeApiProvider: "cline",
			})
			onClose()
			navigateToSettingsModelPicker({ targetSection: "api-config", initialModelTab })
		},
		[handleFieldsChange, navigateToSettingsModelPicker, onClose],
	)

	const setOpenAiCodexProvider = useCallback(() => {
		handleFieldsChange({
			planModeApiProvider: "openai-codex",
			actModeApiProvider: "openai-codex",
		})
		onClose()
		navigateToSettings("api-config")
	}, [handleFieldsChange, onClose, navigateToSettings])

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

	type InlineModelLinkProps =
		| { type: "model"; modelId: string; label: string }
		| { type: "picker"; pickerTab: "recommended" | "free"; label: string }

	const InlineModelLink: React.FC<InlineModelLinkProps> = (props) => {
		if (props.type === "picker") {
			return (
				<span
					onClick={() => navigateToModelPicker(props.pickerTab)}
					style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
					{props.label}
				</span>
			)
		}

		const isClicked = clickedModelsRef.current.has(props.modelId)
		if (isClicked) {
			return null
		}

		return (
			<span
				onClick={() => setModel(props.modelId)}
				style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
				{props.label}
			</span>
		)
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
							5M installs, <strong>$1M Open Source Grant program</strong>, and the story of how we got here{" "}
							<a
								href="https://cline.bot/blog/5m-installs-1m-open-source-grant-program"
								rel="noopener noreferrer"
								style={{ color: "var(--vscode-textLink-foreground)" }}
								target="_blank">
								Read it
							</a>
						</li>
						<li className="mb-2">
							New free models:
							<ul className="list-none pl-5 mt-1">
								<li>
									<strong>Arcee Trinity Large open weight</strong>{" "}
									<InlineModelLink
										label="Try free"
										modelId="cline:arcee-ai/trinity-large-preview:free"
										type="model"
									/>
								</li>
								<li>
									<strong>Omega Potato stealth</strong>{" "}
									<InlineModelLink label="Try free" modelId="cline:stealth/omega-potato" type="model" />
								</li>
							</ul>
						</li>
						<li className="mb-2">
							<strong>Try Kimi K2.5:</strong> Moonshot's latest with advanced reasoning for complex, multi-step
							coding tasks. Great for front-end tasks.{" "}
							<InlineModelLink label="Try now" modelId="cline:moonshotai/kimi-k2.5" type="model" />
						</li>
						<li className="mb-2">
							<strong>Bring your ChatGPT subscription to Cline!</strong> Use your existing plan directly with no per
							token costs or API keys to manage.{" "}
							<span
								onClick={setOpenAiCodexProvider}
								style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
								Connect
							</span>
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
