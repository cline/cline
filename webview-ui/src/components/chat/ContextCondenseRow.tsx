import { useState } from "react"
import { useTranslation } from "react-i18next"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"

import { ContextCondense } from "@roo/schemas"

interface ContextCondenseRowProps {
	contextCondense?: ContextCondense
}

const ContextCondenseRow = ({ contextCondense }: ContextCondenseRowProps) => {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)

	if (!contextCondense) {
		return null
	}
	const { cost, prevContextTokens, newContextTokens, summary } = contextCondense

	return (
		<div className="mb-2">
			<div
				className="flex items-center justify-between cursor-pointer select-none"
				onClick={() => setIsExpanded(!isExpanded)}>
				<div className="flex items-center gap-2 flex-grow">
					<span className="codicon codicon-compress text-blue-400" />
					<span className="font-bold text-vscode-foreground">
						{t("chat:contextCondense.title", "Context Condensed")}
					</span>
					<span className="text-vscode-descriptionForeground text-sm">
						{prevContextTokens.toLocaleString()} → {newContextTokens.toLocaleString()} tokens
					</span>
					<VSCodeBadge style={{ opacity: cost > 0 ? 1 : 0 }}>${cost.toFixed(2)}</VSCodeBadge>
				</div>
				<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
			</div>

			{isExpanded && (
				<div className="mt-2 ml-6 p-3 bg-vscode-editor-background rounded text-vscode-foreground text-sm">
					{summary}
				</div>
			)}
		</div>
	)
}

export default ContextCondenseRow
