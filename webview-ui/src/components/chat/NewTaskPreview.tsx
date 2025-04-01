import React, { useState } from "react"
import MarkdownBlock from "../common/MarkdownBlock"
import SuccessButton from "../common/SuccessButton"
import { vscode } from "../../utils/vscode"

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
