import { memo, useState } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { cn } from "@/lib/utils"
import { useCopyToClipboard } from "@src/utils/clipboard"

import MarkdownBlock from "../common/MarkdownBlock"

export const Markdown = memo(({ markdown, partial }: { markdown?: string; partial?: boolean }) => {
	const [isHovering, setIsHovering] = useState(false)
	const [copySuccess, setCopySuccess] = useState(false)

	// Shorter feedback duration for copy button flash.
	const { copyWithFeedback } = useCopyToClipboard(200)

	if (!markdown || markdown.length === 0) {
		return null
	}

	return (
		<div onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)} className="relative">
			<div className="break-words overflow-wrap-anywhere mb-[-15px] mt-[-15px]">
				<MarkdownBlock markdown={markdown} />
			</div>
			{markdown && !partial && isHovering && (
				<div className="absolute bottom-[-4px] right-2 opacity-0 rounded animate-fadeIn duration-200 ease-in-out forwards">
					<VSCodeButton
						className={cn(
							"copy-button h-6 border-none bg-vscode-editor-background transition-colors duration-200 ease-in-out",
							copySuccess && "bg-vscode-button-background",
						)}
						appearance="icon"
						onClick={async () => {
							const success = await copyWithFeedback(markdown)
							if (success) {
								setCopySuccess(true)
								setTimeout(() => {
									setCopySuccess(false)
								}, 200)
							}
						}}
						title="Copy as markdown">
						<span className="codicon codicon-copy" />
					</VSCodeButton>
				</div>
			)}
		</div>
	)
})
