import React, { useCallback } from "react"
import styled from "styled-components"
import { SlashCommand, SUPPORTED_SLASH_COMMANDS, getMatchingSlashCommands } from "@/utils/slash-commands"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"

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
	z-index: 1000;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 3px;
	width: 250px;
	max-height: 300px;
	overflow-y: auto;
`

const MenuItem = styled.div<{ isSelected: boolean }>`
	padding: 8px 10px;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	background-color: ${(props) => (props.isSelected ? "var(--vscode-list-activeSelectionBackground)" : "transparent")};
	color: ${(props) => (props.isSelected ? "var(--vscode-list-activeSelectionForeground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-hoverBackground);
	}
`

const CommandName = styled.div`
	font-weight: bold;
`

const CommandDescription = styled.div`
	font-size: 0.85em;
	color: var(--vscode-descriptionForeground);
`

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ onSelect, selectedIndex, setSelectedIndex, onMouseDown, query }) => {
	const handleClick = useCallback(
		(command: SlashCommand) => {
			onSelect(command)
		},
		[onSelect],
	)

	// Filter commands based on query
	const filteredCommands = getMatchingSlashCommands(query)

	return (
		<MenuContainer onMouseDown={onMouseDown}>
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
		</MenuContainer>
	)
}

export default SlashCommandMenu
