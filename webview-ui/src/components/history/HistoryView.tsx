import React, { memo, useState } from "react"
import { DeleteTaskDialog } from "./DeleteTaskDialog"
import { BatchDeleteTaskDialog } from "./BatchDeleteTaskDialog"
import { Virtuoso } from "react-virtuoso"

import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { Button, Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { Tab, TabContent, TabHeader } from "../common/Tab"
import { useTaskSearch } from "./useTaskSearch"
import TaskItem from "./TaskItem"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const {
		tasks,
		searchQuery,
		setSearchQuery,
		sortOption,
		setSortOption,
		setLastNonRelevantSort,
		showAllWorkspaces,
		setShowAllWorkspaces,
	} = useTaskSearch()
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
						<Button
							variant={isSelectionMode ? "default" : "secondary"}
							onClick={toggleSelectionMode}
							data-testid="toggle-selection-mode-button"
							title={
								isSelectionMode
									? `${t("history:exitSelectionMode")}`
									: `${t("history:enterSelectionMode")}`
							}>
							<span
								className={`codicon ${isSelectionMode ? "codicon-check-all" : "codicon-checklist"} mr-1`}
							/>
							{isSelectionMode ? t("history:exitSelection") : t("history:selectionMode")}
						</Button>
						<Button onClick={onDone}>{t("history:done")}</Button>
					</div>
				</div>
				<div className="flex flex-col gap-2">
					<VSCodeTextField
						className="w-full"
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
						<div slot="start" className="codicon codicon-search mt-0.5 opacity-80 text-sm!" />
						{searchQuery && (
							<div
								className="input-icon-button codicon codicon-close flex justify-center items-center h-full"
								aria-label="Clear search"
								onClick={() => setSearchQuery("")}
								slot="end"
							/>
						)}
					</VSCodeTextField>
					<div className="flex gap-2">
						<Select
							value={showAllWorkspaces ? "all" : "current"}
							onValueChange={(value) => setShowAllWorkspaces(value === "all")}>
							<SelectTrigger className="flex-1">
								<SelectValue>
									{t("history:workspace.prefix")}{" "}
									{t(`history:workspace.${showAllWorkspaces ? "all" : "current"}`)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="current">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-folder" />
										{t("history:workspace.current")}
									</div>
								</SelectItem>
								<SelectItem value="all">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-folder-opened" />
										{t("history:workspace.all")}
									</div>
								</SelectItem>
							</SelectContent>
						</Select>
						<Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
							<SelectTrigger className="flex-1">
								<SelectValue>
									{t("history:sort.prefix")} {t(`history:sort.${sortOption}`)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="newest" data-testid="select-newest">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-arrow-down" />
										{t("history:newest")}
									</div>
								</SelectItem>
								<SelectItem value="oldest" data-testid="select-oldest">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-arrow-up" />
										{t("history:oldest")}
									</div>
								</SelectItem>
								<SelectItem value="mostExpensive" data-testid="select-most-expensive">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-credit-card" />
										{t("history:mostExpensive")}
									</div>
								</SelectItem>
								<SelectItem value="mostTokens" data-testid="select-most-tokens">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-symbol-numeric" />
										{t("history:mostTokens")}
									</div>
								</SelectItem>
								<SelectItem
									value="mostRelevant"
									disabled={!searchQuery}
									data-testid="select-most-relevant">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-search" />
										{t("history:mostRelevant")}
									</div>
								</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Select all control in selection mode */}
					{isSelectionMode && tasks.length > 0 && (
						<div className="flex items-center py-1">
							<div className="flex items-center gap-2">
								<Checkbox
									checked={tasks.length > 0 && selectedTaskIds.length === tasks.length}
									onCheckedChange={(checked) => toggleSelectAll(checked === true)}
									variant="description"
								/>
								<span className="text-vscode-foreground">
									{selectedTaskIds.length === tasks.length
										? t("history:deselectAll")
										: t("history:selectAll")}
								</span>
								<span className="ml-auto text-vscode-descriptionForeground text-xs">
									{t("history:selectedItems", {
										selected: selectedTaskIds.length,
										total: tasks.length,
									})}
								</span>
							</div>
						</div>
					)}
				</div>
			</TabHeader>

			<TabContent className="p-0">
				<Virtuoso
					className="flex-1 overflow-y-scroll"
					data={tasks}
					data-testid="virtuoso-container"
					initialTopMostItemIndex={0}
					components={{
						List: React.forwardRef((props, ref) => (
							<div {...props} ref={ref} data-testid="virtuoso-item-list" />
						)),
					}}
					itemContent={(_index, item) => (
						<TaskItem
							key={item.id}
							item={item}
							variant="full"
							showWorkspace={showAllWorkspaces}
							isSelectionMode={isSelectionMode}
							isSelected={selectedTaskIds.includes(item.id)}
							onToggleSelection={toggleTaskSelection}
							onDelete={setDeleteTaskId}
							className="m-2 mr-0"
						/>
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
						<Button variant="secondary" onClick={() => setSelectedTaskIds([])}>
							{t("history:clearSelection")}
						</Button>
						<Button variant="default" onClick={handleBatchDelete}>
							{t("history:deleteSelected")}
						</Button>
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
