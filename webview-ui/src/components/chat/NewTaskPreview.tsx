import React from "react"
import MarkdownBlock from "../common/MarkdownBlock"

interface NewTaskPreviewProps {
	context: string
}

const NewTaskPreview: React.FC<NewTaskPreviewProps> = ({ context }) => {
	return (
		<div className="bg-(--vscode-badge-background) text-(--vscode-badge-foreground) rounded-[3px] p-[14px] pb-[6px]">
			<span style={{ fontWeight: "bold" }}>Task</span>
			<MarkdownBlock markdown={context} />
		</div>
	)
}

export default NewTaskPreview
