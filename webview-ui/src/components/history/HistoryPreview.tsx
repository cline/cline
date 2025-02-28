import { memo } from "react"

import { vscode } from "@/utils/vscode"
import { formatLargeNumber, formatDate } from "@/utils/format"
import { Button } from "@/components/ui"

import { useExtensionState } from "../../context/ExtensionStateContext"
import { CopyButton } from "./CopyButton"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()

	const handleHistorySelect = (id: string) => {
		vscode.postMessage({ type: "showTaskWithId", text: id })
	}

	return (
		<div style={{ flexShrink: 0 }}>
			<style>
				{`
					.history-preview-item {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
						border-radius: 4px;
						position: relative;
						overflow: hidden;
						opacity: 0.8;
						cursor: pointer;
						margin-bottom: 12px;
					}
					.history-preview-item:hover {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
						opacity: 1;
						pointer-events: auto;
					}
				`}
			</style>
			<div
				style={{
					color: "var(--vscode-descriptionForeground)",
					margin: "10px 20px 10px 20px",
					display: "flex",
					alignItems: "center",
				}}>
				<span className="codicon codicon-comment-discussion scale-90 mr-1" />
				<span className="font-medium text-xs uppercase">Recent Tasks</span>
			</div>
			<div className="px-5">
				{taskHistory
					.filter((item) => item.ts && item.task)
					.slice(0, 3)
					.map((item) => (
						<div
							key={item.id}
							className="history-preview-item"
							onClick={() => handleHistorySelect(item.id)}>
							<div className="flex flex-col gap-2 p-3 pt-1">
								<div className="flex justify-between items-center">
									<span className="text-xs font-medium text-vscode-descriptionForeground uppercase">
										{formatDate(item.ts)}
									</span>
									<CopyButton itemTask={item.task} />
								</div>
								<div
									className="text-vscode-descriptionForeground overflow-hidden whitespace-pre-wrap"
									style={{
										display: "-webkit-box",
										WebkitLineClamp: 3,
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
									{!!item.cacheWrites && (
										<>
											{" • "}
											<span>
												Cache: +{formatLargeNumber(item.cacheWrites || 0)} →{" "}
												{formatLargeNumber(item.cacheReads || 0)}
											</span>
										</>
									)}
									{!!item.totalCost && (
										<>
											{" • "}
											<span>API Cost: ${item.totalCost?.toFixed(4)}</span>
										</>
									)}
								</div>
							</div>
						</div>
					))}
				<div className="flex justify-center">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => showHistoryView()}
						className="font-normal text-vscode-descriptionForeground">
						View all history
					</Button>
				</div>
			</div>
		</div>
	)
}

export default memo(HistoryPreview)
