import React from "react"

import type { Command } from "@roo/ExtensionMessage"

interface SlashCommandItemSimpleProps {
	command: Command
	onClick?: (command: Command) => void
}

export const SlashCommandItemSimple: React.FC<SlashCommandItemSimpleProps> = ({ command, onClick }) => {
	return (
		<div
			className="px-4 py-2 text-sm flex items-center hover:bg-vscode-list-hoverBackground cursor-pointer"
			onClick={() => onClick?.(command)}>
			{/* Command name */}
			<div className="flex-1 min-w-0">
				<div>
					<span className="truncate text-vscode-foreground">/{command.name}</span>
					{command.description && (
						<div className="text-xs text-vscode-descriptionForeground truncate mt-0.5">
							{command.description}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
