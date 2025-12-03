import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { XIcon } from "lucide-react"
import React from "react"
import { Button } from "@/components/ui/button"
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

	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === e.currentTarget) {
			onClose()
		}
	}

	const handleAllUpdates = () => {
		window.open("https://github.com/cline/cline/blob/main/CHANGELOG.md", "_blank")
		onClose()
	}

	return (
		<div
			className="fixed inset-0 bg-black/50 flex items-center justify-center"
			onClick={handleBackdropClick}
			style={{ zIndex: OPENROUTER_MODEL_PICKER_Z_INDEX + 100 }}>
			<div
				className="relative bg-(--vscode-editor-background) rounded-sm border border-(--vscode-panel-border) shadow-lg max-w-md w-full mx-4"
				onClick={(e) => e.stopPropagation()}
				style={{ maxWidth: "500px" }}>
				{/* Close button */}
				<Button
					className="absolute top-4 right-4 z-10"
					onClick={onClose}
					size="icon"
					style={{ width: "32px", height: "32px" }}
					variant="icon">
					<XIcon style={{ width: "18px", height: "18px" }} />
				</Button>

				{/* Featured image area */}
				<div
					className="w-full rounded-t-sm overflow-hidden"
					style={{
						height: "240px",
						background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
					}}>
					<div className="flex items-center justify-center h-full">
						<div
							style={{
								fontSize: "120px",
								opacity: 0.9,
							}}>
							🎉
						</div>
					</div>
				</div>

				{/* Content area */}
				<div className="p-6 pr-12">
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
					<h2 className="text-xl font-semibold mb-3" style={{ color: "var(--vscode-editor-foreground)" }}>
						What's New in v{version}
					</h2>

					{/* Description */}
					<p className="text-base mb-6" style={{ color: "var(--vscode-descriptionForeground)" }}>
						<strong>MiniMax-M2</strong> free, <strong>Gemini 3 Pro</strong> and <strong>Opus 4.5</strong> with SOTA
						performance, plus bug fixes and new features.{" "}
						<VSCodeLink href="https://github.com/cline/cline/blob/main/CHANGELOG.md" style={{ display: "inline" }}>
							View changelog
						</VSCodeLink>
					</p>

					{/* Action buttons */}
					<div className="flex gap-3">
						<VSCodeButton appearance="primary" onClick={onClose} style={{ flex: 1 }}>
							Try Now
						</VSCodeButton>
						<VSCodeButton appearance="secondary" onClick={handleAllUpdates} style={{ flex: 1 }}>
							All Updates
						</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
}

export default WhatsNewModal
