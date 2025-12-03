import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { XIcon } from "lucide-react"
import React from "react"
import { Button } from "@/components/ui/button"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../settings/OpenRouterModelPicker"

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

	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === e.currentTarget) {
			onClose()
		}
	}

	const handleContentClick = (e: React.MouseEvent) => {
		// Allow links (a tags) to propagate so they work properly
		if (e.target instanceof HTMLElement && e.target.tagName === "A") {
			return
		}
		// Stop propagation for other clicks to prevent closing modal
		e.stopPropagation()
	}

	return (
		<div
			className="fixed inset-0 bg-black/80 flex justify-center items-start"
			onClick={handleBackdropClick}
			style={{ zIndex: OPENROUTER_MODEL_PICKER_Z_INDEX + 100, paddingTop: "calc(15vh + 60px)" }}>
			<div
				className="relative bg-(--vscode-editor-background) rounded-sm border border-(--vscode-panel-border) shadow-lg max-w-md w-full mx-4"
				onClick={handleContentClick}
				style={{ maxWidth: "420px", height: "fit-content" }}>
				{/* Close button */}
				<Button
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
				<div
					className="w-full rounded-t-sm overflow-hidden"
					style={{
						height: "160px",
						backgroundImage:
							"url('https://cline.ghost.io/content/images/2025/12/u9318423161_from_autumn_to_winter_interpreted_in_nature_in_th_621d4b5d-74bb-4757-8afc-8095d4fafcc4_1.png')",
						backgroundSize: "cover",
						backgroundPosition: "center",
						backgroundRepeat: "no-repeat",
					}}
				/>

				{/* Content area */}
				<div className="p-5 pr-10">
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
					<h2 className="text-lg font-semibold mb-3" style={{ color: "var(--vscode-editor-foreground)" }}>
						🎉 New in v{version}
					</h2>

					{/* Description */}
					<ul className="text-sm mb-5 pl-3 list-disc" style={{ color: "var(--vscode-descriptionForeground)" }}>
						{isVscode && (
							<>
								<li className="mb-2">
									New{" "}
									<VSCodeLink
										href="https://docs.cline.bot/features/explain-changes"
										style={{ display: "inline" }}>
										Explain Changes
									</VSCodeLink>{" "}
									button when Cline completes a task to help review code with inline chat. You can reply to
									comments, or send the chat as context back to Cline.
								</li>
								<li className="mb-2">
									Use the new{" "}
									<VSCodeLink
										href="https://docs.cline.bot/features/slash-commands/explain-changes"
										style={{ display: "inline" }}>
										/explain-changes
									</VSCodeLink>{" "}
									slash command to explain the changes in branches, commits, etc. (Try asking Cline to explain a
									PR you need to review!)
								</li>
							</>
						)}
					</ul>

					{/* Action button */}
					<div className="flex gap-3">
						<VSCodeButton appearance="secondary" onClick={onClose}>
							Dismiss
						</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
}

export default WhatsNewModal
