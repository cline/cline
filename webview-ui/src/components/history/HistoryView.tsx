import React, { memo, useMemo, useState, useEffect } from "react"
import { Fzf } from "fzf"
import prettyBytes from "pretty-bytes"
import { Virtuoso } from "react-virtuoso"
import { VSCodeButton, VSCodeTextField, VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"

import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { formatLargeNumber } from "../../utils/format"
import { highlightFzfMatch } from "../../utils/highlight"
import { useCopyToClipboard } from "../../utils/clipboard"
import { Button } from "../ui"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const { taskHistory } = useExtensionState()
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("newest")
	const [lastNonRelevantSort, setLastNonRelevantSort] = useState<SortOption | null>("newest")

	useEffect(() => {
		if (searchQuery && sortOption !== "mostRelevant" && !lastNonRelevantSort) {
			setLastNonRelevantSort(sortOption)
			setSortOption("mostRelevant")
		} else if (!searchQuery && sortOption === "mostRelevant" && lastNonRelevantSort) {
			setSortOption(lastNonRelevantSort)
			setLastNonRelevantSort(null)
		}
	}, [searchQuery, sortOption, lastNonRelevantSort])

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

	const fzf = useMemo(() => {
		return new Fzf(presentableTasks, {
			selector: (item) => item.task,
		})
	}, [presentableTasks])

	const taskHistorySearchResults = useMemo(() => {
		let results = presentableTasks
		if (searchQuery) {
			const searchResults = fzf.find(searchQuery)
			results = searchResults.map((result) => ({
				...result.item,
				task: highlightFzfMatch(result.item.task, Array.from(result.positions)),
			}))
		}

		// First apply search if needed
		const searchResults = searchQuery ? results : presentableTasks

		// Then sort the results
		return [...searchResults].sort((a, b) => {
			switch (sortOption) {
				case "oldest":
					return (a.ts || 0) - (b.ts || 0)
				case "mostExpensive":
					return (b.totalCost || 0) - (a.totalCost || 0)
				case "mostTokens":
					const aTokens = (a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0)
					const bTokens = (b.tokensIn || 0) + (b.tokensOut || 0) + (b.cacheWrites || 0) + (b.cacheReads || 0)
					return bTokens - aTokens
				case "mostRelevant":
					// Keep fuse order if searching, otherwise sort by newest
					return searchQuery ? 0 : (b.ts || 0) - (a.ts || 0)
				case "newest":
				default:
					return (b.ts || 0) - (a.ts || 0)
			}
		})
	}, [presentableTasks, searchQuery, fzf, sortOption])

	return (
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
			<div style={{ padding: "5px 17px 6px 17px" }}>
				<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
					<VSCodeTextField
						style={{ width: "100%" }}
						placeholder="Fuzzy search history..."
						value={searchQuery}
						onInput={(e) => {
							const newValue = (e.target as HTMLInputElement)?.value
							setSearchQuery(newValue)
							if (newValue && !searchQuery && sortOption !== "mostRelevant") {
								setLastNonRelevantSort(sortOption)
								setSortOption("mostRelevant")
							}
						}}>
						<div
							slot="start"
							className="codicon codicon-search"
							style={{ fontSize: 13, marginTop: 2.5, opacity: 0.8 }}
						/>
						{searchQuery && (
							<div
								className="input-icon-button codicon codicon-close"
								aria-label="Clear search"
								onClick={() => setSearchQuery("")}
								slot="end"
								style={{
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									height: "100%",
								}}
							/>
						)}
					</VSCodeTextField>
					<VSCodeRadioGroup
						style={{ display: "flex", flexWrap: "wrap" }}
						value={sortOption}
						role="radiogroup"
						onChange={(e) => setSortOption((e.target as HTMLInputElement).value as SortOption)}>
						<VSCodeRadio value="newest">Newest</VSCodeRadio>
						<VSCodeRadio value="oldest">Oldest</VSCodeRadio>
						<VSCodeRadio value="mostExpensive">Most Expensive</VSCodeRadio>
						<VSCodeRadio value="mostTokens">Most Tokens</VSCodeRadio>
						<VSCodeRadio
							value="mostRelevant"
							disabled={!searchQuery}
							style={{ opacity: searchQuery ? 1 : 0.5 }}>
							Most Relevant
						</VSCodeRadio>
					</VSCodeRadioGroup>
				</div>
			</div>
			<div style={{ flexGrow: 1, overflowY: "auto", margin: 0 }}>
				<Virtuoso
					style={{
						flexGrow: 1,
						overflowY: "scroll",
					}}
					data={taskHistorySearchResults}
					data-testid="virtuoso-container"
					components={{
						List: React.forwardRef((props, ref) => (
							<div {...props} ref={ref} data-testid="virtuoso-item-list" />
						)),
					}}
					itemContent={(index, item) => (
						<div
							key={item.id}
							data-testid={`task-item-${item.id}`}
							className="history-item"
							style={{
								cursor: "pointer",
								borderBottom:
									index < taskHistory.length - 1 ? "1px solid var(--vscode-panel-border)" : "none",
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
									<div className="flex flex-row">
										<Button
											variant="ghost"
											size="sm"
											title="Delete Task"
											onClick={(e) => {
												e.stopPropagation()
												handleDeleteHistoryItem(item.id)
											}}>
											<span className="codicon codicon-trash" />
											{item.size && prettyBytes(item.size)}
										</Button>
									</div>
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
									}}
									dangerouslySetInnerHTML={{ __html: item.task }}
								/>
								<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
									<div
										data-testid="tokens-container"
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
												data-testid="tokens-in"
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
												{formatLargeNumber(item.tokensIn || 0)}
											</span>
											<span
												data-testid="tokens-out"
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
												{formatLargeNumber(item.tokensOut || 0)}
											</span>
										</div>
										{!item.totalCost && <ExportButton itemId={item.id} />}
									</div>

									{!!item.cacheWrites && (
										<div
											data-testid="cache-container"
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
												data-testid="cache-writes"
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
												+{formatLargeNumber(item.cacheWrites || 0)}
											</span>
											<span
												data-testid="cache-reads"
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
												{formatLargeNumber(item.cacheReads || 0)}
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
											<div className="flex flex-row gap-1">
												<CopyButton itemTask={item.task} />
												<ExportButton itemId={item.id} />
											</div>
										</div>
									)}
								</div>
							</div>
						</div>
					)}
				/>
			</div>
		</div>
	)
}

const CopyButton = ({ itemTask }: { itemTask: string }) => {
	const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard()

	return (
		<Button variant="ghost" size="icon" title="Copy Prompt" onClick={(e) => copyWithFeedback(itemTask, e)}>
			{showCopyFeedback ? <span className="codicon codicon-check" /> : <span className="codicon codicon-copy" />}
		</Button>
	)
}

const ExportButton = ({ itemId }: { itemId: string }) => (
	<Button
		data-testid="export"
		variant="ghost"
		size="icon"
		title="Export Task"
		onClick={(e) => {
			e.stopPropagation()
			vscode.postMessage({ type: "exportTaskWithId", text: itemId })
		}}>
		<span className="codicon codicon-cloud-download" />
	</Button>
)

export default memo(HistoryView)
