import React from "react"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui"
import { vscode } from "@/utils/vscode"

interface DeleteTaskDialogProps {
	taskId: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const DeleteTaskDialog = ({ taskId, open, onOpenChange }: DeleteTaskDialogProps) => {
	const handleDelete = () => {
		vscode.postMessage({ type: "deleteTaskWithId", text: taskId })
		onOpenChange(false)
	}

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Task</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to delete this task? This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="secondary">Cancel</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button variant="destructive" onClick={handleDelete}>
							Delete
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
