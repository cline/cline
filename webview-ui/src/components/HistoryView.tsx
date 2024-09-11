import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../context/ExtensionStateContext"
import { vscode } from "../utils/vscode"
import { Virtuoso } from "react-virtuoso"
import { memo, useMemo, useState } from "react"

type HistoryViewProps = {
	onDone: () => void
}

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const { taskHistory } = useExtensionState()
	const [searchQuery, setSearchQuery] = useState("")

	const handleHistorySelect = (id: string) => {
		vscode.postMessage({ type: "showTaskWithId", text: id })
	}

	const handleDeleteHistoryItem = (id: string) => {
		vscode.postMessage({ type: "deleteTaskWithId", text: id })
	}

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

	const presentableTasks = useMemo(() => {
		return taskHistory.filter((item) => item.ts && item.task)
	}, [taskHistory])

	const taskHistorySearchResults = useMemo(() => {
		return presentableTasks.filter((item) => item.task.toLowerCase().includes(searchQuery.toLowerCase()))
	}, [presentableTasks, searchQuery])

	const highlightText = (text: string, query: string) => {
		if (!query) return text
		const parts = text.split(new RegExp(`(${query})`, "gi"))
		return parts.map((part, index) =>
			part.toLowerCase() === query.toLowerCase() ? (
				<mark
					key={index}
					style={{ backgroundColor: "var(--vscode-editor-findMatchHighlightBackground)", color: "inherit" }}>
					{part}
				</mark>
			) : (
				part
			)
		)
	}

	return (
		<>
			<style>
				{`
					.history-item:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.delete-button, .export-button {
						opacity: 0;
						pointer-events: none;
					}
					.history-item:hover .delete-button,
					.history-item:hover .export-button {
						opacity: 1;
						pointer-events: auto;
					}
				`}
			</style>
			<div
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "10px 17px 10px 20px",
					}}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>History</h3>
					<VSCodeButton onClick={onDone}>Done</VSCodeButton>
				</div>
				<div style={{ padding: "5px 17px 10px 17px" }}>
					<VSCodeTextField
						style={{ width: "100%" }}
						placeholder="Search history..."
						value={searchQuery}
						onInput={(e) => setSearchQuery((e.target as HTMLInputElement)?.value)}>
						<div
							slot="start"
							className="codicon codicon-search"
							style={{ fontSize: 13, marginTop: 2.5, opacity: 0.8 }}></div>
						{searchQuery && (
							<VSCodeButton
								appearance="icon"
								aria-label="Clear search"
								onClick={() => setSearchQuery("")}
								slot="end">
								<span className="codicon codicon-close"></span>
							</VSCodeButton>
						)}
					</VSCodeTextField>
				</div>
				<div style={{ flexGrow: 1, overflowY: "auto", margin: 0 }}>
					{presentableTasks.length === 0 && (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								justifyContent: "center",
								alignItems: "center",
								height: "100%",
								fontStyle: "italic",
								color: "var(--vscode-descriptionForeground)",
								textAlign: "center",
								padding: "0px 10px",
							}}>
							<span
								className="codicon codicon-archive"
								style={{ fontSize: "50px", marginBottom: "15px" }}></span>
							<div>
								No history found,
								<br />
								start a new task to see it here...
							</div>
						</div>
					)}
					<Virtuoso
						style={{
							flexGrow: 1,
							overflowY: "scroll",
						}}
						data={taskHistorySearchResults}
						itemContent={(index, item) => (
							<div
								key={item.id}
								className="history-item"
								style={{
									cursor: "pointer",
									borderBottom:
										index < taskHistory.length - 1
											? "1px solid var(--vscode-panel-border)"
											: "none",
								}}
								onClick={() => handleHistorySelect(item.id)}>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "8px",
										padding: "12px 20px",
										position: "relative",
									}}>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
										}}>
										<span
											style={{
												color: "var(--vscode-descriptionForeground)",
												fontWeight: 500,
												fontSize: "0.85em",
												textTransform: "uppercase",
											}}>
											{formatDate(item.ts)}
										</span>
										<VSCodeButton
											appearance="icon"
											onClick={(e) => {
												e.stopPropagation()
												handleDeleteHistoryItem(item.id)
											}}
											className="delete-button">
											<span className="codicon codicon-trash"></span>
										</VSCodeButton>
									</div>
									<div
										style={{
											fontSize: "var(--vscode-font-size)",
											color: "var(--vscode-foreground)",
											display: "-webkit-box",
											WebkitLineClamp: 3,
											WebkitBoxOrient: "vertical",
											overflow: "hidden",
											whiteSpace: "pre-wrap",
											wordBreak: "break-word",
											overflowWrap: "anywhere",
										}}>
										{highlightText(item.task, searchQuery)}
									</div>
									<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												alignItems: "center",
											}}>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "4px",
													flexWrap: "wrap",
												}}>
												<span
													style={{
														fontWeight: 500,
														color: "var(--vscode-descriptionForeground)",
													}}>
													Tokens:
												</span>
												<span
													style={{
														display: "flex",
														alignItems: "center",
														gap: "3px",
														color: "var(--vscode-descriptionForeground)",
													}}>
													<i
														className="codicon codicon-arrow-up"
														style={{
															fontSize: "12px",
															fontWeight: "bold",
															marginBottom: "-2px",
														}}
													/>
													{item.tokensIn?.toLocaleString()}
												</span>
												<span
													style={{
														display: "flex",
														alignItems: "center",
														gap: "3px",
														color: "var(--vscode-descriptionForeground)",
													}}>
													<i
														className="codicon codicon-arrow-down"
														style={{
															fontSize: "12px",
															fontWeight: "bold",
															marginBottom: "-2px",
														}}
													/>
													{item.tokensOut?.toLocaleString()}
												</span>
											</div>
											{!item.totalCost && <ExportButton itemId={item.id} />}
										</div>

										{!!item.cacheWrites && (
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "4px",
													flexWrap: "wrap",
												}}>
												<span
													style={{
														fontWeight: 500,
														color: "var(--vscode-descriptionForeground)",
													}}>
													Cache:
												</span>
												<span
													style={{
														display: "flex",
														alignItems: "center",
														gap: "3px",
														color: "var(--vscode-descriptionForeground)",
													}}>
													<i
														className="codicon codicon-database"
														style={{
															fontSize: "12px",
															fontWeight: "bold",
															marginBottom: "-1px",
														}}
													/>
													+{item.cacheWrites?.toLocaleString()}
												</span>
												<span
													style={{
														display: "flex",
														alignItems: "center",
														gap: "3px",
														color: "var(--vscode-descriptionForeground)",
													}}>
													<i
														className="codicon codicon-arrow-right"
														style={{
															fontSize: "12px",
															fontWeight: "bold",
															marginBottom: 0,
														}}
													/>
													{(item.cacheReads || 0).toLocaleString()}
												</span>
											</div>
										)}
										{!!item.totalCost && (
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center",
													marginTop: -2,
												}}>
												<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
													<span
														style={{
															fontWeight: 500,
															color: "var(--vscode-descriptionForeground)",
														}}>
														API Cost:
													</span>
													<span style={{ color: "var(--vscode-descriptionForeground)" }}>
														${item.totalCost?.toFixed(4)}
													</span>
												</div>
												<ExportButton itemId={item.id} />
											</div>
										)}
									</div>
								</div>
							</div>
						)}
					/>
				</div>
			</div>
		</>
	)
}

const ExportButton = ({ itemId }: { itemId: string }) => (
	<VSCodeButton
		className="export-button"
		appearance="icon"
		onClick={(e) => {
			e.stopPropagation()
			vscode.postMessage({ type: "exportTaskWithId", text: itemId })
		}}>
		<div style={{ fontSize: "11px", fontWeight: 500, opacity: 1 }}>EXPORT</div>
	</VSCodeButton>
)

export default memo(HistoryView)
