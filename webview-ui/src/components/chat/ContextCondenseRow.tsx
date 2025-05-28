import { useState } from "react"
import { useTranslation } from "react-i18next"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"

import type { ContextCondense } from "@roo-code/types"

import { Markdown } from "./Markdown"
import { ProgressIndicator } from "./ProgressIndicator"

export const ContextCondenseRow = ({ cost, prevContextTokens, newContextTokens, summary }: ContextCondense) => {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)

	return (
		<div className="mb-2">
			<div
				className="flex items-center justify-between cursor-pointer select-none"
				onClick={() => setIsExpanded(!isExpanded)}>
				<div
					style={{
						width: 16,
						height: 16,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}>
					<span
						className={`codicon codicon-check`}
						style={{ color: "var(--vscode-charts-green)", fontSize: 16, marginBottom: "-1.5px" }}
					/>
				</div>
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

export const CondensingContextRow = () => {
	const { t } = useTranslation()
	return (
		<div className="flex items-center gap-2">
			<ProgressIndicator />
			<span className="codicon codicon-compress text-blue-400" />
			<span className="font-bold text-vscode-foreground">{t("chat:contextCondense.condensing")}</span>
		</div>
	)
}

export const CondenseContextErrorRow = ({ errorText }: { errorText?: string }) => {
	const { t } = useTranslation()
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-2">
				<span className="codicon codicon-warning text-vscode-editorWarning-foreground opacity-80 text-base -mb-0.5"></span>
				<span className="font-bold text-vscode-foreground">{t("chat:contextCondense.errorHeader")}</span>
			</div>
			<span className="text-vscode-descriptionForeground text-sm">{errorText}</span>
		</div>
	)
}
