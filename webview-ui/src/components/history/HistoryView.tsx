import React, { memo, useState } from "react"
import { DeleteTaskDialog } from "./DeleteTaskDialog"
import prettyBytes from "pretty-bytes"
import { Virtuoso } from "react-virtuoso"
import { VSCodeButton, VSCodeTextField, VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { formatLargeNumber, formatDate } from "@/utils/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"

import { Tab, TabContent, TabHeader } from "../common/Tab"
import { useTaskSearch } from "./useTaskSearch"
import { ExportButton } from "./ExportButton"
import { CopyButton } from "./CopyButton"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const { tasks, searchQuery, setSearchQuery, sortOption, setSortOption, setLastNonRelevantSort } = useTaskSearch()

	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)

	return (
		<Tab>
			<TabHeader className="flex flex-col gap-2">
				<div className="flex justify-between items-center">
					<h3 className="text-vscode-foreground m-0">History</h3>
					<VSCodeButton onClick={onDone}>Done</VSCodeButton>
				</div>
				<div className="flex flex-col gap-2">
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
			</TabHeader>

			<TabContent className="p-0">
				<Virtuoso
					style={{
						flexGrow: 1,
						overflowY: "scroll",
					}}
					data={tasks}
					data-testid="virtuoso-container"
					components={{
						List: React.forwardRef((props, ref) => (
							<div {...props} ref={ref} data-testid="virtuoso-item-list" />
						)),
					}}
					itemContent={(index, item) => (
						<div
							data-testid={`task-item-${item.id}`}
							key={item.id}
							className={cn("cursor-pointer", {
								"border-b border-vscode-panel-border": index < tasks.length - 1,
							})}
							onClick={() => vscode.postMessage({ type: "showTaskWithId", text: item.id })}>
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
											title="Delete Task (Shift + Click to skip confirmation)"
											onClick={(e) => {
												e.stopPropagation()

												if (e.shiftKey) {
													vscode.postMessage({ type: "deleteTaskWithId", text: item.id })
												} else {
													setDeleteTaskId(item.id)
												}
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
										{!item.totalCost && (
											<div className="flex flex-row gap-1">
												<CopyButton itemTask={item.task} />
												<ExportButton itemId={item.id} />
											</div>
										)}
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
			</TabContent>

			{deleteTaskId && (
				<DeleteTaskDialog taskId={deleteTaskId} onOpenChange={(open) => !open && setDeleteTaskId(null)} open />
			)}
		</Tab>
	)
}

export default memo(HistoryView)
