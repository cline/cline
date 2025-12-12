import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { XIcon } from "lucide-react"
import React, { useState } from "react"
import { useMount } from "react-use"
import { Button } from "@/components/ui/button"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../settings/OpenRouterModelPicker"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"

interface WhatsNewModalProps {
	open: boolean
	onClose: () => void
	version: string
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ open, onClose, version }) => {
	if (!open) {
		return null
	}

	const isVscode = PLATFORM_CONFIG.type === PlatformType.VSCODE
	const { clineUser } = useClineAuth()
	const { openRouterModels, setShowChatModelSelector, refreshOpenRouterModels } = useExtensionState()
	const user = clineUser || undefined
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const [didClickDevstralButton, setDidClickDevstralButton] = useState(false)
	const [didClickGPT52Button, setDidClickGPT52Button] = useState(false)
	// Need to get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === e.currentTarget) {
			onClose()
		}
	}

	// Handle escape key to close modal
	React.useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && open) {
				onClose()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [open, onClose])

	const setDevstral = () => {
		const modelId = "mistralai/devstral-2512"
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
		<div
			aria-modal="true"
			className="fixed inset-0 bg-black/80 flex justify-center items-start"
			onClick={handleBackdropClick}
			role="dialog"
			style={{ zIndex: OPENROUTER_MODEL_PICKER_Z_INDEX + 100, paddingTop: "calc(15vh + 60px)" }}>
			<div
				aria-describedby="whats-new-description"
				aria-labelledby="whats-new-title"
				className="relative bg-code rounded-sm shadow-lg max-w-md w-full mx-4"
				style={{ maxWidth: "420px", height: "fit-content" }}>
				{/* Close button */}
				<Button
					aria-label="Close"
					className="absolute top-3 right-3 z-10"
					onClick={onClose}
					size="icon"
					style={{
						width: "29px",
						height: "29px",
						borderRadius: "50%",
						backgroundColor: "rgba(0, 0, 0, 0.3)",
					}}
					variant="icon">
					<XIcon style={{ width: "18px", height: "18px" }} />
				</Button>

				{/* Featured image area */}
				{/* <div
					className="w-full rounded-t-sm overflow-hidden"
					style={{
						height: "160px",
						backgroundImage:
							"url('https://cline.ghost.io/content/images/2025/12/u9318423161_from_autumn_to_winter_interpreted_in_nature_in_th_621d4b5d-74bb-4757-8afc-8095d4fafcc4_1.png')",
						backgroundSize: "cover",
						backgroundPosition: "center",
						backgroundRepeat: "no-repeat",
					}}
				/> */}

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
							Mistral's <strong>Devstral-2512</strong> (formerly stealth model "Microwave"), free for a limited
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

					{/* Social links */}
					{/* <p className="text-sm mb-5" style={{ color: "var(--vscode-descriptionForeground)" }}>
						Join us on{" "}
						<VSCodeLink href="https://x.com/cline" style={{ display: "inline" }}>
							X,
						</VSCodeLink>{" "}
						<VSCodeLink href="https://discord.gg/cline" style={{ display: "inline" }}>
							discord,
						</VSCodeLink>{" "}
						or{" "}
						<VSCodeLink href="https://www.reddit.com/r/cline/" style={{ display: "inline" }}>
							r/cline
						</VSCodeLink>{" "}
						for more updates!
					</p> */}

					{/* Action button */}
					<div className="flex gap-3">
						<VSCodeButton appearance="secondary" data-testid="close-whats-new-modal" onClick={onClose}>
							Dismiss
						</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
}

export default WhatsNewModal
