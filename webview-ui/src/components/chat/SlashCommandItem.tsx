import React from "react"
import { Edit, Trash2 } from "lucide-react"

import type { Command } from "@roo/ExtensionMessage"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { Button, StandardTooltip } from "@/components/ui"
import { vscode } from "@/utils/vscode"

interface SlashCommandItemProps {
	command: Command
	onDelete: (command: Command) => void
	onClick?: (command: Command) => void
}

export const SlashCommandItem: React.FC<SlashCommandItemProps> = ({ command, onDelete, onClick }) => {
	const { t } = useAppTranslation()

	const handleEdit = () => {
		if (command.filePath) {
			vscode.postMessage({
				type: "openFile",
				text: command.filePath,
			})
		} else {
			// Fallback: request to open command file by name and source
			vscode.postMessage({
				type: "openCommandFile",
				text: command.name,
				values: { source: command.source },
			})
		}
	}

	const handleDelete = () => {
		onDelete(command)
	}

	return (
		<div className="px-4 py-2 text-sm flex items-center group hover:bg-vscode-list-hoverBackground">
			{/* Command name - clickable */}
			<div className="flex-1 min-w-0 cursor-pointer" onClick={() => onClick?.(command)}>
				<span className="truncate text-vscode-foreground">{command.name}</span>
			</div>

			{/* Action buttons */}
			<div className="flex items-center gap-2 ml-2">
				<StandardTooltip content={t("chat:slashCommands.editCommand")}>
					<Button
						variant="ghost"
						size="icon"
						tabIndex={-1}
						onClick={handleEdit}
						className="size-6 flex items-center justify-center opacity-60 hover:opacity-100">
						<Edit className="w-4 h-4" />
					</Button>
				</StandardTooltip>

				<StandardTooltip content={t("chat:slashCommands.deleteCommand")}>
					<Button
						variant="ghost"
						size="icon"
						tabIndex={-1}
						onClick={handleDelete}
						className="size-6 flex items-center justify-center opacity-60 hover:opacity-100 hover:text-red-400">
						<Trash2 className="w-4 h-4" />
					</Button>
				</StandardTooltip>
			</div>
		</div>
	)
}
