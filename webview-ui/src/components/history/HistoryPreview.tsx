import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { memo } from "react"
import { formatLargeNumber } from "@/utils/format"
// Remove the incorrect import: import { getWorkspacePath } from "@utils/path"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory, showWorkspaceTasksOnly, setShowWorkspaceTasksOnly, workspaceRoot } = useExtensionState() // Add workspaceRoot
	const handleHistorySelect = (id: string) => {
		vscode.postMessage({ type: "showTaskWithId", text: id })
	}

	// Use workspaceRoot from state
	const currentWorkspaceRoot = workspaceRoot

	// Filter tasks by workspace if the toggle is on
	const filteredTaskHistory =
		showWorkspaceTasksOnly && currentWorkspaceRoot
			? taskHistory.filter((item) => item.workspaceRoot === currentWorkspaceRoot)
			: taskHistory

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date
			?.toLocaleString("en-US", {
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
			.replace(", ", " ")
			.replace(" at", ",")
			.toUpperCase()
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
					justifyContent: "space-between",
				}}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span
						className="codicon codicon-comment-discussion"
						style={{
							marginRight: "4px",
							transform: "scale(0.9)",
						}}></span>
					<span
						style={{
							fontWeight: 500,
							fontSize: "0.85em",
							textTransform: "uppercase",
						}}>
						Recent Tasks
					</span>
				</div>

				{/* Add workspace filter toggle */}
				<div style={{ display: "flex", alignItems: "center", fontSize: "0.85em" }}>
					<label style={{ marginRight: "8px", color: "var(--vscode-descriptionForeground)" }}>
						Current workspace only
					</label>
					<VSCodeCheckbox
						checked={showWorkspaceTasksOnly}
						onChange={() => {
							setShowWorkspaceTasksOnly(!showWorkspaceTasksOnly)
							vscode.postMessage({
								type: "toggleWorkspaceTasksOnly",
								bool: !showWorkspaceTasksOnly,
							})
						}}
					/>
				</div>
			</div>

			<div style={{ padding: "0px 20px 0 20px" }}>
				{filteredTaskHistory
					.filter((item) => item.ts && item.task)
					.slice(0, 3)
					.map((item) => (
						<div key={item.id} className="history-preview-item" onClick={() => handleHistorySelect(item.id)}>
							<div style={{ padding: "12px" }}>
								<div style={{ marginBottom: "8px" }}>
									<span
										style={{
											color: "var(--vscode-descriptionForeground)",
											fontWeight: 500,
											fontSize: "0.85em",
											textTransform: "uppercase",
										}}>
										{formatDate(item.ts)}
									</span>
								</div>
								<div
									style={{
										fontSize: "var(--vscode-font-size)",
										color: "var(--vscode-descriptionForeground)",
										marginBottom: "8px",
										display: "-webkit-box",
										WebkitLineClamp: 3,
										WebkitBoxOrient: "vertical",
										overflow: "hidden",
										whiteSpace: "pre-wrap",
										wordBreak: "break-word",
										overflowWrap: "anywhere",
									}}>
									{item.task}
								</div>
								<div
									style={{
										fontSize: "0.85em",
										color: "var(--vscode-descriptionForeground)",
									}}>
									<span>
										Tokens: ↑{formatLargeNumber(item.tokensIn || 0)} ↓{formatLargeNumber(item.tokensOut || 0)}
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
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}>
					<VSCodeButton
						appearance="icon"
						onClick={() => showHistoryView()}
						style={{
							opacity: 0.9,
						}}>
						<div
							style={{
								fontSize: "var(--vscode-font-size)",
								color: "var(--vscode-descriptionForeground)",
							}}>
							View all history
						</div>
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default memo(HistoryPreview)
