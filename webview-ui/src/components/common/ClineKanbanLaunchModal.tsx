import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useMemo, useState } from "react"
import kanbanDemoVideo from "@/assets/cline_kanban_demo.mp4"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { FileServiceClient, StateServiceClient } from "@/services/grpc-client"

const INSTALL_COMMAND = "npm install -g cline"
const COPIED_TIMEOUT = 1500
const kanbanDemoVideoSrc = kanbanDemoVideo.startsWith("/src/")
	? new URL(kanbanDemoVideo, import.meta.url).toString()
	: kanbanDemoVideo

export const CLINE_KANBAN_MODAL_DISMISS_ID = "cline-kanban-launch-modal-v1"

interface ClineKanbanLaunchModalProps {
	open: boolean
	onClose: (doNotShowAgain: boolean) => void
}

export const ClineKanbanLaunchModal: React.FC<ClineKanbanLaunchModalProps> = ({ open, onClose }) => {
	const [doNotShowAgain, setDoNotShowAgain] = useState(false)
	const [isInstalling, setIsInstalling] = useState(false)
	const [copied, setCopied] = useState(false)

	const isVsCode = useMemo(() => PLATFORM_CONFIG.type === PlatformType.VSCODE, [])

	useEffect(() => {
		if (open) {
			setCopied(false)
			setIsInstalling(false)
		}
	}, [open])

	const handleAction = async () => {
		if (isVsCode) {
			setIsInstalling(true)
			try {
				await StateServiceClient.installClineCli({})
			} catch (error) {
				console.error("Failed to run CLI install command:", error)
			} finally {
				setIsInstalling(false)
			}
			return
		}

		try {
			await FileServiceClient.copyToClipboard(StringRequest.create({ value: INSTALL_COMMAND }))
			setCopied(true)
			setTimeout(() => setCopied(false), COPIED_TIMEOUT)
		} catch (error) {
			console.error("Failed to copy CLI install command:", error)
		}
	}

	return (
		<Dialog onOpenChange={(isOpen) => !isOpen && onClose(doNotShowAgain)} open={open}>
			<DialogContent
				aria-describedby="cline-kanban-description"
				aria-labelledby="cline-kanban-title"
				className="pt-4 px-5 pb-4 gap-0 max-w-2xl">
				<div className="space-y-3" id="cline-kanban-description">
					<div className="pr-6 min-h-6 flex items-center">
						<h2
							className="m-0 text-lg font-semibold"
							id="cline-kanban-title"
							style={{ color: "var(--vscode-editor-foreground)" }}>
							Introducing Cline Kanban
						</h2>
					</div>

					<video
						autoPlay
						className="w-full rounded-md border border-[var(--vscode-editorGroup-border)]"
						loop
						muted
						playsInline
						src={kanbanDemoVideoSrc}
					/>

					<p className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
						A replacement for your IDE better suited for running many agents in parallel and reviewing diffs. Enable
						auto-commit and link cards together to create dependency chains that complete large amounts of work
						autonomously.
					</p>

					<div className="p-1">
						<code className="block rounded-sm px-2 py-1 bg-[var(--vscode-textCodeBlock-background)] text-sm">
							{INSTALL_COMMAND}
						</code>
						<div className="mt-3">
							<VSCodeButton disabled={isInstalling} onClick={handleAction}>
								{isVsCode
									? isInstalling
										? "Running install command..."
										: "Run in terminal"
									: copied
										? "Copied"
										: "Copy command"}
							</VSCodeButton>
						</div>
					</div>

					<div className="pt-2">
						<VSCodeCheckbox
							checked={doNotShowAgain}
							onChange={(e: any) => {
								setDoNotShowAgain(e.target.checked === true)
							}}>
							Do not show again
						</VSCodeCheckbox>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default ClineKanbanLaunchModal
