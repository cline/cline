import React, { memo, useState } from "react"
import { DeleteTaskDialog } from "./DeleteTaskDialog"
import { BatchDeleteTaskDialog } from "./BatchDeleteTaskDialog"
import prettyBytes from "pretty-bytes"
import { Virtuoso } from "react-virtuoso"
import {
	VSCodeButton,
	VSCodeTextField,
	VSCodeRadioGroup,
	VSCodeRadio,
	VSCodeCheckbox,
} from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { formatLargeNumber, formatDate } from "@/utils/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

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
	const { t } = useAppTranslation()

	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const [isSelectionMode, setIsSelectionMode] = useState(false)
	const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
	const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState<boolean>(false)

	// Toggle selection mode
	const toggleSelectionMode = () => {
		setIsSelectionMode(!isSelectionMode)
		if (isSelectionMode) {
			setSelectedTaskIds([])
		}
	}

	// Toggle selection for a single task
	const toggleTaskSelection = (taskId: string, isSelected: boolean) => {
		if (isSelected) {
			setSelectedTaskIds((prev) => [...prev, taskId])
		} else {
			setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId))
		}
	}

	// Toggle select all tasks
	const toggleSelectAll = (selectAll: boolean) => {
		if (selectAll) {
			setSelectedTaskIds(tasks.map((task) => task.id))
		} else {
			setSelectedTaskIds([])
		}
	}

	// Handle batch delete button click
	const handleBatchDelete = () => {
		if (selectedTaskIds.length > 0) {
			setShowBatchDeleteDialog(true)
		}
	}

	return (
		<Tab>
			<TabHeader className="flex flex-col gap-2">
				<div className="flex justify-between items-center">
					<h3 className="text-vscode-foreground m-0">{t("history:history")}</h3>
					<div className="flex gap-2">
						<VSCodeButton
							appearance={isSelectionMode ? "primary" : "secondary"}
							onClick={toggleSelectionMode}
							title={
								isSelectionMode
									? `${t("history:exitSelectionMode")}`
									: `${t("history:enterSelectionMode")}`
							}>
							<span
								className={`codicon ${isSelectionMode ? "codicon-check-all" : "codicon-checklist"}`}
							/>
							{isSelectionMode ? t("history:exitSelection") : t("history:selectionMode")}
						</VSCodeButton>
						<VSCodeButton onClick={onDone}>{t("history:done")}</VSCodeButton>
					</div>
				</div>
				<div className="flex flex-col gap-2">
					<VSCodeTextField
						style={{ width: "100%" }}
						placeholder={t("history:searchPlaceholder")}
						value={searchQuery}
						data-testid="history-search-input"
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
						<VSCodeRadio value="newest" data-testid="radio-newest">
							{t("history:newest")}
						</VSCodeRadio>
						<VSCodeRadio value="oldest" data-testid="radio-oldest">
							{t("history:oldest")}
						</VSCodeRadio>
						<VSCodeRadio value="mostExpensive" data-testid="radio-most-expensive">
							{t("history:mostExpensive")}
						</VSCodeRadio>
						<VSCodeRadio value="mostTokens" data-testid="radio-most-tokens">
							{t("history:mostTokens")}
						</VSCodeRadio>
						<VSCodeRadio
							value="mostRelevant"
							disabled={!searchQuery}
							data-testid="radio-most-relevant"
							style={{ opacity: searchQuery ? 1 : 0.5 }}>
							{t("history:mostRelevant")}
						</VSCodeRadio>
					</VSCodeRadioGroup>

					{/* Select all control in selection mode */}
					{isSelectionMode && tasks.length > 0 && (
						<div className="flex items-center py-1 px-2 bg-vscode-editor-background rounded">
							<VSCodeCheckbox
								checked={tasks.length > 0 && selectedTaskIds.length === tasks.length}
								onChange={(e) => toggleSelectAll((e.target as HTMLInputElement).checked)}
							/>
							<span className="ml-2 text-vscode-foreground">
								{selectedTaskIds.length === tasks.length
									? t("history:deselectAll")
									: t("history:selectAll")}
							</span>
							<span className="ml-auto text-vscode-descriptionForeground text-xs">
								{t("history:selectedItems", { selected: selectedTaskIds.length, total: tasks.length })}
							</span>
						</div>
					)}
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
					initialTopMostItemIndex={0}
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
								"bg-vscode-list-activeSelectionBackground":
									isSelectionMode && selectedTaskIds.includes(item.id),
							})}
							onClick={(e) => {
								if (!isSelectionMode || !(e.target as HTMLElement).closest(".task-checkbox")) {
									vscode.postMessage({ type: "showTaskWithId", text: item.id })
								}
							}}>
							<div className="flex items-start p-3 gap-2">
								{/* Show checkbox in selection mode */}
								{isSelectionMode && (
									<div
										className="task-checkbox mt-1"
										onClick={(e) => {
											e.stopPropagation()
										}}>
										<VSCodeCheckbox
											checked={selectedTaskIds.includes(item.id)}
											onChange={(e) =>
												toggleTaskSelection(item.id, (e.target as HTMLInputElement).checked)
											}
										/>
									</div>
								)}

								<div className="flex-1">
									<div className="flex justify-between items-center">
										<span className="text-vscode-descriptionForeground font-medium text-sm uppercase">
											{formatDate(item.ts)}
										</span>
										<div className="flex flex-row">
											{!isSelectionMode && (
												<Button
													variant="ghost"
													size="sm"
													title={t("history:deleteTaskTitle")}
													data-testid="delete-task-button"
													onClick={(e) => {
														e.stopPropagation()

														if (e.shiftKey) {
															vscode.postMessage({
																type: "deleteTaskWithId",
																text: item.id,
															})
														} else {
															setDeleteTaskId(item.id)
														}
													}}>
													<span className="codicon codicon-trash" />
													{item.size && prettyBytes(item.size)}
												</Button>
											)}
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
										data-testid="task-content"
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
													{t("history:tokensLabel")}
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
											{!item.totalCost && !isSelectionMode && (
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
													{t("history:cacheLabel")}
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
														{t("history:apiCostLabel")}
													</span>
													<span style={{ color: "var(--vscode-descriptionForeground)" }}>
														${item.totalCost?.toFixed(4)}
													</span>
												</div>
												{!isSelectionMode && (
													<div className="flex flex-row gap-1">
														<CopyButton itemTask={item.task} />
														<ExportButton itemId={item.id} />
													</div>
												)}
											</div>
										)}
									</div>
								</div>
							</div>
						</div>
					)}
				/>
			</TabContent>

			{/* Fixed action bar at bottom - only shown in selection mode with selected items */}
			{isSelectionMode && selectedTaskIds.length > 0 && (
				<div className="fixed bottom-0 left-0 right-0 bg-vscode-editor-background border-t border-vscode-panel-border p-2 flex justify-between items-center">
					<div className="text-vscode-foreground">
						{t("history:selectedItems", { selected: selectedTaskIds.length, total: tasks.length })}
					</div>
					<div className="flex gap-2">
						<VSCodeButton appearance="secondary" onClick={() => setSelectedTaskIds([])}>
							{t("history:clearSelection")}
						</VSCodeButton>
						<VSCodeButton appearance="primary" onClick={handleBatchDelete}>
							{t("history:deleteSelected")}
						</VSCodeButton>
					</div>
				</div>
			)}

			{/* Delete dialog */}
			{deleteTaskId && (
				<DeleteTaskDialog taskId={deleteTaskId} onOpenChange={(open) => !open && setDeleteTaskId(null)} open />
			)}

			{/* Batch delete dialog */}
			{showBatchDeleteDialog && (
				<BatchDeleteTaskDialog
					taskIds={selectedTaskIds}
					open={showBatchDeleteDialog}
					onOpenChange={(open) => {
						if (!open) {
							setShowBatchDeleteDialog(false)
							setSelectedTaskIds([])
							setIsSelectionMode(false)
						}
					}}
				/>
			)}
		</Tab>
	)
}

export default memo(HistoryView)
