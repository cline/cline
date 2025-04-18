import { memo, useState, useEffect } from "react"

import { vscode } from "@/utils/vscode"
import { formatLargeNumber, formatDate } from "@/utils/format"
import { Button } from "@/components/ui"

import { useAppTranslation } from "../../i18n/TranslationContext"
import { CopyButton } from "./CopyButton"
import { useTaskSearch } from "./useTaskSearch"

import { Trans } from "react-i18next"

type HistoryPreviewProps = {
	showHistoryView: () => void
}
const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { tasks, showAllWorkspaces } = useTaskSearch()
	const { t } = useAppTranslation()
	// Use a consistent key for localStorage
	const STORAGE_KEY = "historyPreview.minimized"

	// Initialize state from localStorage with fallback
	const [minimized, setMinimized] = useState(() => {
		try {
			const savedState = localStorage.getItem(STORAGE_KEY)
			return savedState === "true"
		} catch (e) {
			console.error("Failed to access localStorage:", e)
			return false
		}
	})

	// Persist state changes to localStorage and notify VSCode
	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, minimized.toString())

			// Notify VSCode about state change to persist across sessions
			vscode.postMessage({
				type: "historyPreviewState",
				minimized,
			})
		} catch (e) {
			console.error("Failed to save history preview state:", e)
		}
	}, [minimized])

	const toggleMinimized = () => {
		setMinimized(!minimized)
	}

	return (
		<>
			<div className="flex flex-col gap-3 shrink-0 mx-4">
				{tasks.length > 0 && (
					<Button
						variant="secondary"
						size="default"
						onClick={toggleMinimized}
						className="w-full text-center py-4 bg-vscode-editor-background text-vscode-foreground text-xs uppercase tracking-wider border border-vscode-toolbar-hoverBackground/30 hover:border-vscode-toolbar-hoverBackground/60">
						{minimized ? "Show recent tasks" : "Hide recent tasks"}
					</Button>
				)}
				{tasks.length === 0 && (
					<>
						<p className="outline rounded p-4">
							<Trans
								i18nKey="chat:onboarding"
								components={{
									DocsLink: (
										<a
											href="https://docs.roocode.com/getting-started/your-first-task"
											target="_blank"
											rel="noopener noreferrer">
											the docs
										</a>
									),
								}}
							/>
						</p>

						<Button size="sm" onClick={() => showHistoryView()} className="mx-auto">
							{t("history:viewAll")}
						</Button>
					</>
				)}
				{!minimized &&
					tasks.slice(0, 3).map((item) => (
						<div
							key={item.id}
							className="bg-vscode-editor-background rounded relative overflow-hidden cursor-pointer border border-vscode-toolbar-hoverBackground/30 hover:border-vscode-toolbar-hoverBackground/60"
							onClick={() => vscode.postMessage({ type: "showTaskWithId", text: item.id })}>
							<div className="flex flex-col gap-2 p-3 pt-1">
								<div className="flex justify-between items-center">
									<span className="text-xs font-medium text-vscode-descriptionForeground uppercase">
										{formatDate(item.ts)}
									</span>
									<CopyButton itemTask={item.task} />
								</div>
								<div
									className="text-vscode-foreground overflow-hidden whitespace-pre-wrap"
									style={{
										display: "-webkit-box",
										WebkitLineClamp: 2,
										WebkitBoxOrient: "vertical",
										wordBreak: "break-word",
										overflowWrap: "anywhere",
									}}>
									{item.task}
								</div>
								<div className="text-xs text-vscode-descriptionForeground">
									<span>
										Tokens: ↑{formatLargeNumber(item.tokensIn || 0)} ↓
										{formatLargeNumber(item.tokensOut || 0)}
									</span>
									{!!item.totalCost && (
										<>
											{" • "}
											<span>API Cost: ${item.totalCost?.toFixed(4)}</span>
										</>
									)}
								</div>
								{showAllWorkspaces && item.workspace && (
									<div className="flex flex-row gap-1 text-vscode-descriptionForeground text-xs mt-1">
										<span className="codicon codicon-folder scale-80" />
										<span>{item.workspace}</span>
									</div>
								)}
							</div>
						</div>
					))}

				{/* View All History button */}
				{!minimized && tasks.length > 0 && (
					<Button
						variant="secondary"
						size="default"
						onClick={() => showHistoryView()}
						className="w-full text-center py-4 bg-vscode-editor-background text-vscode-foreground text-xs uppercase tracking-wider border border-vscode-toolbar-hoverBackground/30 hover:border-vscode-toolbar-hoverBackground/60">
						View all history
					</Button>
				)}
			</div>
		</>
	)
}

export default memo(HistoryPreview)
