import React from "react"
import styled from "styled-components"
import { SearchResultItem } from "./SearchResultItem" // Assuming SearchResultItem.ts is in the same directory

interface SearchResultsPanelProps {
	results: SearchResultItem[]
	searchQuery: string
	onResultClick: (messageTs: number, occurrenceInMessage: number) => void // Updated signature
	isVisible: boolean
}

const PanelContainer = styled.div<{ $isVisible: boolean }>`
	display: ${(props) => (props.$isVisible ? "block" : "none")};
	max-height: 200px; // Or any appropriate max height
	overflow-y: auto;
	border: 1px solid var(--vscode-sideBar-border, var(--vscode-editorGroup-border));
	border-radius: 3px;
	margin: 0 15px 10px 15px; // Match search input horizontal margin, add bottom margin
	background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
`

const ResultItemContainer = styled.div`
	padding: 8px 12px;
	cursor: pointer;
	border-bottom: 1px solid var(--vscode-dropdown-border, var(--vscode-editorWidget-border));
	font-size: var(--vscode-font-size);
	color: var(--vscode-editor-foreground);

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background-color: var(--vscode-list-hoverBackground);
	}

	mark.search-highlight {
		background-color: var(--vscode-editor-findMatchHighlightBackground, yellow);
		color: var(--vscode-editor-foreground, black);
		padding: 0.1em;
		border-radius: 2px;
	}
`

const NoResultsMessage = styled.div`
	padding: 8px 12px;
	font-style: italic;
	color: var(--vscode-descriptionForeground);
`

// Helper function for highlighting text within snippets
const highlightSnippet = (text: string, query: string): React.ReactNode => {
	if (!query.trim()) {
		return text
	}
	const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const parts = text.split(new RegExp(`(${escapedQuery})`, "gi"))
	return (
		<>
			{parts.map((part, i) =>
				part.toLowerCase() === query.toLowerCase() ? (
					<mark key={i} className="search-highlight">
						{part}
					</mark>
				) : (
					part
				),
			)}
		</>
	)
}

const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({ results, searchQuery, onResultClick, isVisible }) => {
	if (!isVisible || !searchQuery.trim()) {
		return null
	}

	return (
		<PanelContainer $isVisible={isVisible}>
			{results.length === 0 && searchQuery.trim() && (
				<NoResultsMessage>No results found for "{searchQuery}"</NoResultsMessage>
			)}
			{results.map((item) => (
				<ResultItemContainer key={item.id} onClick={() => onResultClick(item.messageTs, item.occurrenceInMessage)}>
					{highlightSnippet(item.snippet, searchQuery)}
				</ResultItemContainer>
			))}
		</PanelContainer>
	)
}

export default SearchResultsPanel
