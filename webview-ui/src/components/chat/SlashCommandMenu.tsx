import React, { useCallback, useRef, useEffect } from "react"
import { SlashCommand, getMatchingSlashCommands } from "@/utils/slash-commands"

interface SlashCommandMenuProps {
	onSelect: (command: SlashCommand) => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	onMouseDown: () => void
	query: string
	localWorkflowToggles?: Record<string, boolean>
	globalWorkflowToggles?: Record<string, boolean>
}

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
	onSelect,
	selectedIndex,
	setSelectedIndex,
	onMouseDown,
	query,
	localWorkflowToggles = {},
	globalWorkflowToggles = {},
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

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

	// Filter commands based on query
	const filteredCommands = getMatchingSlashCommands(query, localWorkflowToggles, globalWorkflowToggles)
	const defaultCommands = filteredCommands.filter((cmd) => cmd.section === "default" || !cmd.section)
	const workflowCommands = filteredCommands.filter((cmd) => cmd.section === "custom")

	// Create a reusable function for rendering a command section
	const renderCommandSection = (commands: SlashCommand[], title: string, indexOffset: number, showDescriptions: boolean) => {
		if (commands.length === 0) return null

		return (
			<>
				<div className="text-xs text-[var(--vscode-descriptionForeground)] px-3 py-1 font-bold border-b border-[var(--vscode-editorGroup-border)]">
					{title}
				</div>
				{commands.map((command, index) => {
					const itemIndex = index + indexOffset
					return (
						<div
							key={command.name}
							id={`slash-command-menu-item-${itemIndex}`}
							className={`slash-command-menu-item py-2 px-3 cursor-pointer flex flex-col border-b border-[var(--vscode-editorGroup-border)] ${
								itemIndex === selectedIndex
									? "bg-[var(--vscode-quickInputList-focusBackground)] text-[var(--vscode-quickInputList-focusForeground)]"
									: ""
							} hover:bg-[var(--vscode-list-hoverBackground)]`}
							onClick={() => handleClick(command)}
							onMouseEnter={() => setSelectedIndex(itemIndex)}>
							<div className="font-bold whitespace-nowrap overflow-hidden text-ellipsis">
								<span className="ph-no-capture">/{command.name}</span>
							</div>
							{showDescriptions && command.description && (
								<div className="text-[0.85em] text-[var(--vscode-descriptionForeground)] whitespace-normal overflow-hidden text-ellipsis">
									<span className="ph-no-capture">{command.description}</span>
								</div>
							)}
						</div>
					)
				})}
			</>
		)
	}

	return (
		<div
			className="absolute bottom-[calc(100%-10px)] left-[15px] right-[15px] overflow-x-hidden z-[1000]"
			onMouseDown={onMouseDown}>
			<div
				ref={menuRef}
				className="bg-[var(--vscode-dropdown-background)] border border-[var(--vscode-editorGroup-border)] rounded-[3px] shadow-[0_4px_10px_rgba(0,0,0,0.25)] flex flex-col overflow-y-auto"
				style={{ maxHeight: "min(200px, calc(50vh))", overscrollBehavior: "contain" }}>
				{filteredCommands.length > 0 ? (
					<>
						{renderCommandSection(defaultCommands, "Default Commands", 0, true)}
						{renderCommandSection(workflowCommands, "Workflow Commands", defaultCommands.length, false)}
					</>
				) : (
					<div className="py-2 px-3 cursor-default flex flex-col">
						<div className="text-[0.85em] text-[var(--vscode-descriptionForeground)]">No matching commands found</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default SlashCommandMenu
