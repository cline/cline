import React from "react"
import { AlertTriangle, Trash2 } from "lucide-react"
import { formatSize } from "@/utils/format"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogAction,
	AlertDialogCancel,
} from "./AlertDialog"

interface TaskDeletionConfirmDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	taskCount: number
	totalSize?: number
	taskDetails?: {
		date?: string
		title?: string
	}
	variant: "single" | "multiple" | "all"
}

export function TaskDeletionConfirmDialog({
	open,
	onOpenChange,
	onConfirm,
	taskCount,
	totalSize,
	taskDetails,
	variant,
}: TaskDeletionConfirmDialogProps) {
	const handleConfirm = () => {
		onConfirm()
		onOpenChange(false)
	}

	const handleCancel = () => {
		onOpenChange(false)
	}

	const getTitle = () => {
		switch (variant) {
			case "single":
				return "Delete Task"
			case "multiple":
				return `Delete ${taskCount} Tasks`
			case "all":
				return "Delete All History"
			default:
				return "Delete Task"
		}
	}

	const getDescription = () => {
		switch (variant) {
			case "single":
				return `Are you sure you want to delete this task${
					taskDetails?.date ? ` from ${taskDetails.date}` : ""
				}? This will also delete all associated checkpoints and cannot be undone.`
			case "multiple":
				return `Are you sure you want to delete ${taskCount} selected tasks? This will free up ${
					totalSize ? formatSize(totalSize) : "storage space"
				} and delete all associated checkpoints. This action cannot be undone.`
			case "all":
				return `Are you sure you want to delete all task history? This will permanently remove all tasks, checkpoints, and conversation data${
					totalSize ? ` (${formatSize(totalSize)})` : ""
				}. This action cannot be undone.`
			default:
				return "This action cannot be undone."
		}
	}

	const getConfirmText = () => {
		switch (variant) {
			case "single":
				return "Delete Task"
			case "multiple":
				return `Delete ${taskCount} Tasks`
			case "all":
				return "Delete All History"
			default:
				return "Delete"
		}
	}

	// Handle keyboard events
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			handleCancel()
		} else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			handleConfirm()
		}
	}

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent onKeyDown={handleKeyDown}>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<AlertTriangle className="w-5 h-5 text-[var(--vscode-errorForeground)]" />
						{getTitle()}
					</AlertDialogTitle>
					<AlertDialogDescription>{getDescription()}</AlertDialogDescription>
					{taskDetails?.title && variant === "single" && (
						<div className="mt-3 p-3 bg-[var(--vscode-editor-inactiveSelectionBackground)] rounded border-l-4 border-[var(--vscode-errorForeground)]">
							<div className="text-sm text-[var(--vscode-foreground)] font-medium">Task Preview:</div>
							<div className="text-sm text-[var(--vscode-descriptionForeground)] mt-1 line-clamp-2">
								{taskDetails.title}
							</div>
						</div>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleConfirm}
						className="!bg-[#c42b2b] !border-[#c42b2b] !text-white hover:!bg-[#a82424] hover:!border-[#a82424] active:!bg-[#8f1f1f] active:!border-[#8f1f1f]">
						<Trash2 className="w-4 h-4 mr-2" />
						{getConfirmText()}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
