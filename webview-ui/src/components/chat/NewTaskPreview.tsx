import React from "react"
import { useTranslation } from "react-i18next"
import MarkdownBlock from "../common/MarkdownBlock"

interface NewTaskPreviewProps {
	context: string
}

const NewTaskPreview: React.FC<NewTaskPreviewProps> = ({ context }) => {
	const { t } = useTranslation()

	return (
		<div className="bg-(--vscode-badge-background) text-(--vscode-badge-foreground) rounded-[3px] p-[14px] pb-[6px]">
			<span style={{ fontWeight: "bold" }}>{t("new_task_preview.task_label")}</span>
			<MarkdownBlock markdown={context} />
		</div>
	)
}

export default NewTaskPreview
