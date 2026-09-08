import type { McpServer } from "@shared/mcp"
import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import React, { useCallback, useEffect, useRef } from "react"
import ScreenReaderAnnounce from "@/components/common/ScreenReaderAnnounce"
import { useMenuAnnouncement } from "@/hooks/useMenuAnnouncement"
import type { SlashCommand } from "@/utils/slash-commands"
import { getMatchingSlashCommands } from "@/utils/slash-commands"

interface SlashCommandMenuProps {
	onSelect: (command: SlashCommand) => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	onMouseDown: () => void
	query: string
	/** Skills and workflows served by the extension host, already filtered by the user's toggles. */
	runtimeCommands?: SlashCommandInfo[]
	mcpServers?: McpServer[]
}

/**
 * Menu groups in display order. Must match the order `getAllSlashCommands`
 * produces so keyboard navigation indexes line up with the rendered rows.
 */
const SECTIONS: Array<{ section: NonNullable<SlashCommand["section"]>; title: string }> = [
	{ section: "default", title: "Default Commands" },
	{ section: "skill", title: "Skills" },
	{ section: "custom", title: "Workflow Commands" },
	{ section: "mcp", title: "MCP Prompts" },
]

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
	onSelect,
	selectedIndex,
	setSelectedIndex,
	onMouseDown,
	query,
	runtimeCommands = [],
	mcpServers = [],
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

	// Filter commands based on query
	const filteredCommands = getMatchingSlashCommands(query, runtimeCommands, mcpServers)

	// Screen reader announcements
	const getCommandLabel = useCallback((command: SlashCommand) => {
		const description = command.description ? `, ${command.description}` : ""
		return `${command.name}${description}`
	}, [])

	const { announcement } = useMenuAnnouncement({
		items: filteredCommands,
		selectedIndex,
		getItemLabel: getCommandLabel,
	})

	const handleClick = useCallback(
		(command: SlashCommand) => {
			onSelect(command)
		},
		[onSelect],
	)

	useEffect(() => {
		if (menuRef.current) {
			const selectedElement = menuRef.current.querySelector(`#slash-command-menu-item-${selectedIndex}`) as HTMLElement
			if (selectedElement) {
				const menuRect = menuRef.current.getBoundingClientRect()
				const selectedRect = selectedElement.getBoundingClientRect()

				if (selectedRect.bottom > menuRect.bottom) {
					menuRef.current.scrollTop += selectedRect.bottom - menuRect.bottom
				} else if (selectedRect.top < menuRect.top) {
					menuRef.current.scrollTop -= menuRect.top - selectedRect.top
				}
			}
		}
	}, [selectedIndex])

	// Create a reusable function for rendering a command section
	const renderCommandSection = (commands: SlashCommand[], title: string, indexOffset: number) => {
		if (commands.length === 0) {
			return null
		}

		return (
			<React.Fragment key={title}>
				<div
					className="text-xs text-(--vscode-descriptionForeground) px-3 py-1 font-bold border-b border-(--vscode-editorGroup-border)"
					role="presentation">
					{title}
				</div>
				{commands.map((command, index) => {
					const itemIndex = index + indexOffset
					return (
						<div
							aria-selected={itemIndex === selectedIndex}
							className={`slash-command-menu-item py-2 px-3 cursor-pointer flex flex-col border-b border-(--vscode-editorGroup-border) ${
								itemIndex === selectedIndex
									? "bg-(--vscode-quickInputList-focusBackground) text-(--vscode-quickInputList-focusForeground)"
									: ""
							} hover:bg-(--vscode-list-hoverBackground)`}
							id={`slash-command-menu-item-${itemIndex}`}
							key={command.name}
							onClick={() => handleClick(command)}
							onMouseEnter={() => setSelectedIndex(itemIndex)}
							role="option">
							<div className="font-bold whitespace-nowrap overflow-hidden text-ellipsis">
								<span className="ph-no-capture">/{command.name}</span>
							</div>
							{command.description && (
								<div
									className={`text-[0.85em] ${
										itemIndex === selectedIndex
											? "text-(--vscode-quickInputList-focusForeground)"
											: "text-(--vscode-descriptionForeground)"
									} whitespace-normal overflow-hidden text-ellipsis`}>
									<span className="ph-no-capture">{command.description}</span>
								</div>
							)}
						</div>
					)
				})}
			</React.Fragment>
		)
	}

	const renderSections = () => {
		let indexOffset = 0
		return SECTIONS.map(({ section, title }) => {
			const commands = filteredCommands.filter((cmd) =>
				section === "default" ? cmd.section === "default" || !cmd.section : cmd.section === section,
			)
			const rendered = renderCommandSection(commands, title, indexOffset)
			indexOffset += commands.length
			return rendered
		})
	}

	return (
		<div
			className="absolute bottom-[calc(100%-10px)] left-[15px] right-[15px] overflow-x-hidden z-1000"
			data-testid="slash-commands-menu"
			onMouseDown={onMouseDown}>
			<ScreenReaderAnnounce message={announcement} />
			<div
				aria-activedescendant={filteredCommands.length > 0 ? `slash-command-menu-item-${selectedIndex}` : undefined}
				aria-label="Slash commands"
				className="bg-(--vscode-dropdown-background) border border-(--vscode-editorGroup-border) rounded-[3px] shadow-[0_4px_10px_rgba(0,0,0,0.25)] flex flex-col overflow-y-auto"
				ref={menuRef}
				role="listbox"
				style={{ maxHeight: "min(200px, calc(50vh))", overscrollBehavior: "contain" }}>
				{filteredCommands.length > 0 ? (
					renderSections()
				) : (
					<div aria-selected="false" className="py-2 px-3 cursor-default flex flex-col" role="option">
						<div className="text-[0.85em] text-(--vscode-descriptionForeground)">No matching commands found</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default SlashCommandMenu
