import { EditMessageAndRegenerateRequest } from "@shared/proto/cline/task"
import type React from "react"
import { useMemo, useState } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { TaskServiceClient } from "@/services/grpc-client"
import { highlightText } from "./task-header/Highlights"

interface UserMessageProps {
	text?: string
	files?: string[]
	images?: string[]
	messageTs?: number
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
}

const UserMessage: React.FC<UserMessageProps> = ({ text, images, files, messageTs }) => {
	const [isEditing, setIsEditing] = useState(false)
	const [editedText, setEditedText] = useState(text ?? "")
	const [savingMode, setSavingMode] = useState<"chat" | "workspace" | undefined>()
	const [errorMessage, setErrorMessage] = useState<string | undefined>()
	const highlightedText = useMemo(() => highlightText(text), [text])

	const handleSave = async (restoreWorkspace: boolean) => {
		if (!messageTs || savingMode) {
			return
		}
		setSavingMode(restoreWorkspace ? "workspace" : "chat")
		setErrorMessage(undefined)
		try {
			await TaskServiceClient.editMessageAndRegenerate(
				EditMessageAndRegenerateRequest.create({
					messageTs,
					text: editedText,
					images: images ?? [],
					files: files ?? [],
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

	return (
		<div
			className="group relative p-2.5 pr-8 my-1 text-badge-foreground rounded-xs"
			style={{
				backgroundColor: "var(--vscode-badge-background)",
				whiteSpace: "pre-line",
				wordWrap: "break-word",
			}}>
			{messageTs && !isEditing && (
				<button
					aria-label="Edit and regenerate from this message"
					className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-80 hover:opacity-100 bg-transparent border-0 text-badge-foreground cursor-pointer p-1"
					onClick={() => {
						setEditedText(text ?? "")
						setErrorMessage(undefined)
						setIsEditing(true)
					}}
					title="Edit and regenerate from here"
					type="button">
					<i className="codicon codicon-edit" />
				</button>
			)}
			{isEditing ? (
				<div className="flex flex-col gap-2">
					<textarea
						className="w-full box-border rounded-xs border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground p-2 text-sm resize-vertical"
						disabled={!!savingMode}
						onChange={(event) => setEditedText(event.target.value)}
						rows={Math.max(3, editedText.split("\n").length)}
						value={editedText}
					/>
					{errorMessage && <div className="text-xs text-(--vscode-errorForeground)">{errorMessage}</div>}
					<div className="flex flex-wrap gap-2 justify-end">
						<button
							className="px-2 py-1 rounded-xs border border-vscode-button-border bg-transparent text-badge-foreground cursor-pointer"
							disabled={!!savingMode}
							onClick={() => setIsEditing(false)}
							type="button">
							Cancel
						</button>
						<button
							className="px-2 py-1 rounded-xs border-0 bg-vscode-button-background text-vscode-button-foreground cursor-pointer disabled:opacity-60"
							disabled={!!savingMode}
							onClick={() => handleSave(false)}
							type="button">
							{savingMode === "chat" ? "Regenerating..." : "Save & Regenerate"}
						</button>
						<button
							className="px-2 py-1 rounded-xs border border-vscode-button-border bg-transparent text-badge-foreground cursor-pointer disabled:opacity-60"
							disabled={!!savingMode}
							onClick={() => handleSave(true)}
							title="Restore workspace files to this checkpoint before regenerating"
							type="button">
							{savingMode === "workspace" ? "Restoring..." : "Restore Code & Regenerate"}
						</button>
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
