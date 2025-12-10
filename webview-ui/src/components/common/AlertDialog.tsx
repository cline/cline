import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { AlertTriangle } from "lucide-react"
import React, { ReactNode } from "react"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../settings/OpenRouterModelPicker"

interface AlertDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	children: ReactNode
}

export function AlertDialog({ open, onOpenChange, children }: AlertDialogProps) {
	if (!open) {
		return null
	}

	// Close the dialog when clicking on the backdrop
	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === e.currentTarget) {
			onOpenChange(false)
		}
	}

	return (
		<div
			className={`fixed inset-0 bg-black/50 flex items-center justify-center`}
			onClick={handleBackdropClick}
			style={{ zIndex: OPENROUTER_MODEL_PICKER_Z_INDEX + 50 }}>
			{children}
		</div>
	)
}

export function AlertDialogContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={`fixed top-[50%] left-[50%] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] ${className}`}
			onClick={(e) => e.stopPropagation()}
			{...props}>
			<div className="bg-(--vscode-editor-background) rounded-sm gap-3 border border-(--vscode-panel-border) p-6 shadow-lg sm:max-w-lg">
				{children}
			</div>
		</div>
	)
}

export function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={`flex flex-col gap-1 text-left ${className}`} {...props} />
}

export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={`flex flex-row justify-end gap-3 mt-6 ${className}`} {...props} />
}

export function AlertDialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
	return (
		<h2
			className={`text-base font-medium text-(--vscode-editor-foreground) flex items-center gap-2 text-left ${className}`}
			{...props}
		/>
	)
}

export function AlertDialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
	return <p className={`text-(--vscode-descriptionForeground) text-sm text-left ${className}`} {...props} />
}

export function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof VSCodeButton>) {
	return <VSCodeButton appearance="primary" {...props} />
}

export function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof VSCodeButton>) {
	return <VSCodeButton appearance="secondary" {...props} />
}

export function UnsavedChangesDialog({
	open,
	onOpenChange,
	onConfirm,
	onCancel,
	onSave,
	title = "Unsaved Changes",
	description = "You have unsaved changes. Are you sure you want to discard them?",
	confirmText = "Discard Changes",
	saveText = "Save & Continue",
	showSaveOption = false,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	onCancel: () => void
	onSave?: () => void
	title?: string
	description?: string
	confirmText?: string
	saveText?: string
	showSaveOption?: boolean
}) {
	return (
		<AlertDialog onOpenChange={onOpenChange} open={open}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<AlertTriangle className="w-5 h-5 text-(--vscode-errorForeground)" />
						{title}
					</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
					{showSaveOption && onSave && <AlertDialogAction onClick={onSave}>{saveText}</AlertDialogAction>}
					<AlertDialogAction appearance={showSaveOption ? "secondary" : "primary"} onClick={onConfirm}>
						{confirmText}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
