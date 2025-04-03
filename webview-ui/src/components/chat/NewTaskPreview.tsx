import React from "react"
import MarkdownBlock from "../common/MarkdownBlock"

interface NewTaskPreviewProps {
	context: string
}

const NewTaskPreview: React.FC<NewTaskPreviewProps> = ({ context }) => {
	return (
		<div>
			<MarkdownBlock markdown={"```\n" + context + "\n```"} />
		</div>
	)
}

export default NewTaskPreview
