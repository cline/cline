import React from "react"
import MarkdownBlock from "../common/MarkdownBlock"

interface NewTaskPreviewProps {
	context: string
}

const NewTaskPreview: React.FC<NewTaskPreviewProps> = ({ context }) => {
	return (
		<div className="bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded-[3px] p-[9px] pt-0 border-t-8 border-[var(--vscode-charts-green)]">
			<MarkdownBlock markdown={context} />
		</div>
	)
}

export default NewTaskPreview
