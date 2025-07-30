import React, { useState } from "react"
import { Plus, Globe, Folder } from "lucide-react"

import type { Command } from "@roo/ExtensionMessage"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
} from "@/components/ui"
import { vscode } from "@/utils/vscode"

import { SlashCommandItem } from "./SlashCommandItem"

interface SlashCommandsListProps {
	commands: Command[]
	onRefresh: () => void
}

export const SlashCommandsList: React.FC<SlashCommandsListProps> = ({ commands, onRefresh }) => {
	const { t } = useAppTranslation()
	const { cwd } = useExtensionState()
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [commandToDelete, setCommandToDelete] = useState<Command | null>(null)
	const [globalNewName, setGlobalNewName] = useState("")
	const [workspaceNewName, setWorkspaceNewName] = useState("")

	// Check if we're in a workspace/project
	const hasWorkspace = Boolean(cwd)

	const handleDeleteClick = (command: Command) => {
		setCommandToDelete(command)
		setDeleteDialogOpen(true)
	}

	const handleDeleteConfirm = () => {
		if (commandToDelete) {
			vscode.postMessage({
				type: "deleteCommand",
				text: commandToDelete.name,
				values: { source: commandToDelete.source },
			})
			setDeleteDialogOpen(false)
			setCommandToDelete(null)
			// Refresh the commands list after deletion
			setTimeout(onRefresh, 100)
		}
	}

	const handleDeleteCancel = () => {
		setDeleteDialogOpen(false)
		setCommandToDelete(null)
	}

	const handleCreateCommand = (source: "global" | "project", name: string) => {
		if (!name.trim()) return

		// Append .md if not already present
		const fileName = name.trim().endsWith(".md") ? name.trim() : `${name.trim()}.md`

		vscode.postMessage({
			type: "createCommand",
			text: fileName,
			values: { source },
		})

		// Clear the input and refresh
		if (source === "global") {
			setGlobalNewName("")
		} else {
			setWorkspaceNewName("")
		}
		setTimeout(onRefresh, 500)
	}

	const handleCommandClick = (command: Command) => {
		// Insert the command into the textarea
		vscode.postMessage({
			type: "insertTextIntoTextarea",
			text: `/${command.name}`,
		})
	}

	// Group commands by source
	const globalCommands = commands.filter((cmd) => cmd.source === "global")
	const projectCommands = commands.filter((cmd) => cmd.source === "project")

	return (
		<>
			{/* Commands list */}
			<div className="max-h-[300px] overflow-y-auto">
				<div className="py-1">
					{/* Global Commands Section */}
					<div className="px-3 py-1.5 text-xs font-medium text-vscode-descriptionForeground flex items-center gap-1.5">
						<Globe className="w-3 h-3" />
						{t("chat:slashCommands.globalCommands")}
					</div>
					{globalCommands.map((command) => (
						<SlashCommandItem
							key={`global-${command.name}`}
							command={command}
							onDelete={handleDeleteClick}
							onClick={handleCommandClick}
						/>
					))}
					{/* New global command input */}
					<div className="px-4 py-2 flex items-center gap-2 hover:bg-vscode-list-hoverBackground">
						<input
							type="text"
							value={globalNewName}
							onChange={(e) => setGlobalNewName(e.target.value)}
							placeholder={t("chat:slashCommands.newGlobalCommandPlaceholder")}
							className="flex-1 bg-transparent text-vscode-input-foreground placeholder-vscode-input-placeholderForeground border-none outline-none focus:outline-0 text-sm"
							tabIndex={-1}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleCreateCommand("global", globalNewName)
								}
							}}
						/>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => handleCreateCommand("global", globalNewName)}
							disabled={!globalNewName.trim()}
							className="size-6 flex items-center justify-center opacity-60 hover:opacity-100">
							<Plus className="w-4 h-4" />
						</Button>
					</div>

					{/* Workspace Commands Section - Only show if in a workspace */}
					{hasWorkspace && (
						<>
							<div className="px-3 py-1.5 text-xs font-medium text-vscode-descriptionForeground mt-4 flex items-center gap-1.5">
								<Folder className="w-3 h-3" />
								{t("chat:slashCommands.workspaceCommands")}
							</div>
							{projectCommands.map((command) => (
								<SlashCommandItem
									key={`project-${command.name}`}
									command={command}
									onDelete={handleDeleteClick}
									onClick={handleCommandClick}
								/>
							))}
							{/* New workspace command input */}
							<div className="px-4 py-2 flex items-center gap-2 hover:bg-vscode-list-hoverBackground">
								<input
									type="text"
									value={workspaceNewName}
									onChange={(e) => setWorkspaceNewName(e.target.value)}
									placeholder={t("chat:slashCommands.newWorkspaceCommandPlaceholder")}
									className="flex-1 bg-transparent text-vscode-input-foreground placeholder-vscode-input-placeholderForeground border-none outline-none focus:outline-0 text-sm"
									tabIndex={-1}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											handleCreateCommand("project", workspaceNewName)
										}
									}}
								/>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => handleCreateCommand("project", workspaceNewName)}
									disabled={!workspaceNewName.trim()}
									className="size-6 flex items-center justify-center opacity-60 hover:opacity-100">
									<Plus className="w-4 h-4" />
								</Button>
							</div>
						</>
					)}
				</div>
			</div>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("chat:slashCommands.deleteDialog.title")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("chat:slashCommands.deleteDialog.description", { name: commandToDelete?.name })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={handleDeleteCancel}>
							{t("chat:slashCommands.deleteDialog.cancel")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={handleDeleteConfirm}>
							{t("chat:slashCommands.deleteDialog.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
