import { Int64Request } from "@shared/proto/cline/common"
import { EditMessageAndRegenerateRequest } from "@shared/proto/cline/task"
import type React from "react"
import { useEffect, useMemo, useState } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CheckpointsServiceClient, TaskServiceClient } from "@/services/grpc-client"
import { highlightText } from "./task-header/Highlights"

interface UserMessageProps {
	text?: string
	files?: string[]
	images?: string[]
	messageTs?: number
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
	/** True for messages that started an agent run, which are the only ones Reset Code applies to. */
	canRestoreWorkspace?: boolean
}

/**
 * What the Reset Code button can do for the message being edited. The
 * checkpoint is looked up when the editor opens, so the button is pending
 * until the answer arrives.
 */
type WorkspaceRestoreAvailability =
	| { state: "pending" }
	| { state: "available" }
	| { state: "unavailable"; reason: "checkpoints_disabled" | "checkpoint_unavailable" }

const WORKSPACE_RESTORE_TOOLTIPS: Record<WorkspaceRestoreAvailability["state"], string> = {
	pending: "Checking for a workspace checkpoint…",
	available: "Rewind conversation, reset code edits",
	unavailable: "No workspace checkpoint was created for this message.",
}

const UserMessage: React.FC<UserMessageProps> = ({ text, images, files, messageTs, canRestoreWorkspace }) => {
	const { navigateToSettings, enableCheckpointsSetting } = useExtensionState()
	const [isEditing, setIsEditing] = useState(false)
	const [editedText, setEditedText] = useState(text ?? "")
	const [editedImages, setEditedImages] = useState(images ?? [])
	const [editedFiles, setEditedFiles] = useState(files ?? [])
	const [savingMode, setSavingMode] = useState<"chat" | "workspace" | undefined>()
	const [errorMessage, setErrorMessage] = useState<string | undefined>()
	const [workspaceRestorePopoverOpen, setWorkspaceRestorePopoverOpen] = useState(false)
	const [hasWorkspaceCheckpoint, setHasWorkspaceCheckpoint] = useState<boolean | undefined>()
	const highlightedText = useMemo(() => highlightText(text), [text])
	const workspaceRestoreAvailability: WorkspaceRestoreAvailability | undefined = !canRestoreWorkspace
		? undefined
		: hasWorkspaceCheckpoint === undefined
			? { state: "pending" }
			: hasWorkspaceCheckpoint
				? { state: "available" }
				: {
						state: "unavailable",
						reason: enableCheckpointsSetting === false ? "checkpoints_disabled" : "checkpoint_unavailable",
					}
	const workspaceRestoreTooltip = workspaceRestoreAvailability && WORKSPACE_RESTORE_TOOLTIPS[workspaceRestoreAvailability.state]
	const workspaceRestorePending = workspaceRestoreAvailability?.state === "pending"

	// The checkpoint is looked up when the user opens the editor, not pushed
	// with every state update, so the answer covers the checkpoint written for
	// the latest turn. A failed lookup is reported as no checkpoint.
	useEffect(() => {
		setHasWorkspaceCheckpoint(undefined)
		if (!isEditing || !canRestoreWorkspace || messageTs === undefined) {
			return
		}
		let cancelled = false
		CheckpointsServiceClient.checkpointExistsForMessage(Int64Request.create({ value: messageTs }))
			.then(
				(result) => result.value,
				(error) => {
					console.error("Failed to look up the workspace checkpoint for this message:", error)
					return false
				},
			)
			.then((exists) => {
				if (!cancelled) {
					setHasWorkspaceCheckpoint(exists)
				}
			})
		return () => {
			cancelled = true
		}
	}, [isEditing, canRestoreWorkspace, messageTs])

	const startEditing = () => {
		setEditedText(text ?? "")
		setEditedImages(images ?? [])
		setEditedFiles(files ?? [])
		setErrorMessage(undefined)
		setIsEditing(true)
	}

	const cancelEditing = () => {
		if (savingMode) {
			return
		}
		setIsEditing(false)
	}

	const handleEditingKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Escape") {
			return
		}

		event.preventDefault()
		event.stopPropagation()
		cancelEditing()
	}

	const handleSave = async (restoreWorkspace: boolean) => {
		if (!messageTs || savingMode || (restoreWorkspace && workspaceRestoreAvailability?.state !== "available")) {
			return
		}
		setSavingMode(restoreWorkspace ? "workspace" : "chat")
		setErrorMessage(undefined)
		try {
			await TaskServiceClient.editMessageAndRegenerate(
				EditMessageAndRegenerateRequest.create({
					messageTs,
					text: editedText,
					images: editedImages,
					files: editedFiles,
					restoreWorkspace,
				}),
			)
			setIsEditing(false)
			setSavingMode(undefined)
		} catch (error) {
			console.error("Failed to edit and regenerate message:", error)
			setErrorMessage(error instanceof Error ? error.message : "Failed to edit and regenerate message")
			setSavingMode(undefined)
		}
	}

	// Pending and unavailable states keep the button focusable, so the tooltip
	// or explanation popover can still be opened from the keyboard.
	const resetCodeButton = workspaceRestoreAvailability ? (
		<button
			aria-busy={workspaceRestorePending || undefined}
			aria-disabled={workspaceRestoreAvailability.state !== "available" || undefined}
			className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap px-2 py-1 rounded-xs border border-vscode-button-border bg-transparent text-badge-foreground cursor-pointer disabled:opacity-60 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed aria-busy:cursor-progress text-xs"
			disabled={!!savingMode}
			onClick={() => handleSave(true)}
			type="button">
			{workspaceRestorePending && (
				<i aria-hidden="true" className="codicon codicon-loading codicon-modifier-spin text-xs" />
			)}
			{savingMode === "workspace" ? "Restoring..." : "Reset Code"}
		</button>
	) : null

	return (
		<div
			className={`group relative p-2.5 my-1 text-badge-foreground rounded-xs ${
				messageTs && !isEditing ? "cursor-pointer pr-8" : ""
			}`}
			onClick={messageTs && !isEditing ? startEditing : undefined}
			onKeyDown={
				messageTs && !isEditing
					? (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault()
								startEditing()
							}
						}
					: undefined
			}
			role={messageTs && !isEditing ? "button" : undefined}
			style={{
				backgroundColor: "var(--vscode-badge-background)",
				whiteSpace: "pre-line",
				wordWrap: "break-word",
			}}
			tabIndex={messageTs && !isEditing ? 0 : undefined}
			title={messageTs && !isEditing ? "Edit and regenerate from here" : undefined}>
			{messageTs && !isEditing && (
				<Tooltip>
					<TooltipContent side="left">Edit and regenerate from here</TooltipContent>
					<TooltipTrigger asChild>
						<button
							aria-label="Edit and regenerate from this message"
							className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-80 hover:opacity-100 bg-transparent border-0 text-badge-foreground cursor-pointer p-1"
							onClick={(event) => {
								event.stopPropagation()
								startEditing()
							}}
							type="button">
							<i className="codicon codicon-edit" />
						</button>
					</TooltipTrigger>
				</Tooltip>
			)}
			{isEditing ? (
				<div className="flex flex-col gap-2" onKeyDown={handleEditingKeyDown}>
					<textarea
						className="w-full box-border rounded-xs border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground p-2 text-sm resize-vertical"
						disabled={!!savingMode}
						onChange={(event) => setEditedText(event.target.value)}
						rows={Math.max(3, editedText.split("\n").length)}
						value={editedText}
					/>
					{(editedImages.length > 0 || editedFiles.length > 0) && (
						<Thumbnails
							files={editedFiles}
							images={editedImages}
							setFiles={setEditedFiles}
							setImages={setEditedImages}
						/>
					)}
					{errorMessage && <div className="text-xs text-(--vscode-errorForeground)">{errorMessage}</div>}
					<div className="flex items-center justify-between gap-1.5">
						<button
							className="shrink-0 whitespace-nowrap px-1 py-1 rounded-xs border-0 bg-transparent text-badge-foreground/80 hover:text-badge-foreground cursor-pointer text-xs"
							disabled={!!savingMode}
							onClick={cancelEditing}
							type="button">
							Cancel
						</button>
						<div className="flex items-center gap-1.5">
							<Tooltip>
								<TooltipContent side="top">Rewind conversation, keep current code edits</TooltipContent>
								<TooltipTrigger asChild>
									<span className="inline-flex shrink-0">
										<button
											className="whitespace-nowrap px-2 py-1 rounded-xs border border-vscode-button-border bg-transparent text-badge-foreground cursor-pointer disabled:opacity-60 text-xs"
											disabled={!!savingMode}
											onClick={() => handleSave(false)}
											type="button">
											{savingMode === "chat" ? "Running..." : "Reset Chat"}
										</button>
									</span>
								</TooltipTrigger>
							</Tooltip>
							{workspaceRestoreAvailability &&
								(workspaceRestoreAvailability.state === "unavailable" &&
								workspaceRestoreAvailability.reason === "checkpoints_disabled" ? (
									<Popover onOpenChange={setWorkspaceRestorePopoverOpen} open={workspaceRestorePopoverOpen}>
										<PopoverContent className="max-w-xs w-auto text-xs" side="top">
											No checkpoint is available for this message. Enable Checkpoints in{" "}
											<button
												className="cursor-pointer border-0 bg-transparent p-0 text-[inherit] text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground)]"
												onClick={() => {
													setWorkspaceRestorePopoverOpen(false)
													navigateToSettings("checkpoints")
												}}
												type="button">
												Settings
											</button>{" "}
											to create checkpoints for future messages.
										</PopoverContent>
										<PopoverTrigger asChild>{resetCodeButton}</PopoverTrigger>
									</Popover>
								) : (
									<Tooltip>
										<TooltipContent className="max-w-xs" side="top">
											{workspaceRestoreTooltip}
										</TooltipContent>
										<TooltipTrigger asChild>{resetCodeButton}</TooltipTrigger>
									</Tooltip>
								))}
						</div>
					</div>
				</div>
			) : (
				<span className="ph-no-capture text-sm" style={{ display: "block" }}>
					{highlightedText}
				</span>
			)}
			{!isEditing && ((images && images.length > 0) || (files && files.length > 0)) && (
				<Thumbnails files={files ?? []} images={images ?? []} style={{ marginTop: "8px" }} />
			)}
		</div>
	)
}

export default UserMessage
