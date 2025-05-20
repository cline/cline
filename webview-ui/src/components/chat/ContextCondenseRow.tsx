import { useState } from "react"
import { useTranslation } from "react-i18next"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"

import { ContextCondense } from "@roo/schemas"
import { Markdown } from "./Markdown"

export const ContextCondenseRow = ({ cost, prevContextTokens, newContextTokens, summary }: ContextCondense) => {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)

	return (
		<div className="mb-2">
			<div
				className="flex items-center justify-between cursor-pointer select-none"
				onClick={() => setIsExpanded(!isExpanded)}>
				<div className="flex items-center gap-2 flex-grow">
					<span className="codicon codicon-compress text-blue-400" />
					<span className="font-bold text-vscode-foreground">{t("chat:contextCondense.title")}</span>
					<span className="text-vscode-descriptionForeground text-sm">
						{prevContextTokens.toLocaleString()} → {newContextTokens.toLocaleString()} {t("tokens")}
					</span>
					<VSCodeBadge className={cost > 0 ? "opacity-100" : "opacity-0"}>${cost.toFixed(2)}</VSCodeBadge>
				</div>
				<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
			</div>

			{isExpanded && (
				<div className="mt-2 ml-0 p-4 bg-vscode-editor-background rounded text-vscode-foreground text-sm">
					<Markdown markdown={summary} />
				</div>
			)}
		</div>
	)
}
