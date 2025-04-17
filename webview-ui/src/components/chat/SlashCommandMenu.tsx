import React, { useCallback, useRef, useEffect } from "react"
import styled from "styled-components"
import { SlashCommand, getMatchingSlashCommands } from "@/utils/slash-commands"

interface SlashCommandMenuProps {
	onSelect: (command: SlashCommand) => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	onMouseDown: () => void
	query: string
}

const MenuContainer = styled.div`
	position: absolute;
	bottom: calc(100% - 10px);
	left: 15px;
	right: 15px; // Make it span the full width like ContextMenu
	overflow-x: hidden;
	z-index: 1000;
`

const MenuContent = styled.div`
	background: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 3px;
	box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
	display: flex;
	flex-direction: column;
	max-height: 200px;
	overflow-y: auto;
`

const MenuItem = styled.div<{ isSelected: boolean }>`
	padding: 8px 12px;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	background-color: ${(props) => (props.isSelected ? "var(--vscode-quickInputList-focusBackground)" : "transparent")};
	color: ${(props) => (props.isSelected ? "var(--vscode-quickInputList-focusForeground)" : "inherit")};
	border-bottom: 1px solid var(--vscode-editorGroup-border);

	&:hover {
		background-color: var(--vscode-list-hoverBackground);
	}
`

const CommandName = styled.div`
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

const CommandDescription = styled.div`
	font-size: 0.85em;
	color: var(--vscode-descriptionForeground);
	white-space: normal; // Allow wrapping
	overflow: hidden;
	text-overflow: ellipsis;
`

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ onSelect, selectedIndex, setSelectedIndex, onMouseDown, query }) => {
	const menuRef = useRef<HTMLDivElement>(null)

	const handleClick = useCallback(
		(command: SlashCommand) => {
			onSelect(command)
		},
		[onSelect],
	)

	// Auto-scroll to make selected item visible
	useEffect(() => {
		if (menuRef.current) {
			const selectedElement = menuRef.current.children[selectedIndex] as HTMLElement
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
	const filteredCommands = getMatchingSlashCommands(query)

	return (
		<MenuContainer onMouseDown={onMouseDown}>
			<MenuContent ref={menuRef}>
				{filteredCommands.length > 0 ? (
					filteredCommands.map((command, index) => (
						<MenuItem
							key={command.name}
							isSelected={index === selectedIndex}
							onClick={() => handleClick(command)}
							onMouseEnter={() => setSelectedIndex(index)}>
							<CommandName>/{command.name}</CommandName>
							<CommandDescription>{command.description}</CommandDescription>
						</MenuItem>
					))
				) : (
					<MenuItem isSelected={false}>
						<CommandDescription>No matching commands found</CommandDescription>
					</MenuItem>
				)}
			</MenuContent>
		</MenuContainer>
	)
}

export default SlashCommandMenu
