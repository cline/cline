import React from "react"
import { useTranslation } from "react-i18next"
import { vscode } from "@src/utils/vscode"
import { StandardTooltip } from "@/components/ui"

interface CodebaseSearchResultProps {
	filePath: string
	score: number
	startLine: number
	endLine: number
	snippet: string
	language: string
}

const CodebaseSearchResult: React.FC<CodebaseSearchResultProps> = ({ filePath, score, startLine, endLine }) => {
	const { t } = useTranslation("chat")

	const handleClick = () => {
		console.log(filePath)
		vscode.postMessage({
			type: "openFile",
			text: "./" + filePath,
			values: {
				line: startLine,
			},
		})
	}

	return (
		<StandardTooltip content={t("codebaseSearch.resultTooltip", { score: score.toFixed(3) })}>
			<div
				onClick={handleClick}
				className="mb-1 p-2 border border-primary rounded cursor-pointer hover:bg-secondary hover:text-white">
				<div className="flex gap-2 items-center overflow-hidden">
					<span className="text-primary-300 whitespace-nowrap flex-shrink-0">
						{filePath.split("/").at(-1)}:{startLine}-{endLine}
					</span>
					<span className="text-gray-500 truncate min-w-0 flex-1">
						{filePath.split("/").slice(0, -1).join("/")}
					</span>
					<span className="text-xs text-vscode-descriptionForeground bg-vscode-badge-background px-2 py-1 rounded whitespace-nowrap ml-auto">
						{score.toFixed(3)}
					</span>
				</div>
			</div>
		</StandardTooltip>
	)
}

export default CodebaseSearchResult
