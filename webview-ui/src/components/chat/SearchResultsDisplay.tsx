import React, { useMemo } from "react"
import CodeAccordian from "../common/CodeAccordian"

interface SearchResultsDisplayProps {
	content: string
	isExpanded: boolean
	onToggleExpand: () => void
	path: string
	filePattern?: string
}

const SearchResultsDisplay: React.FC<SearchResultsDisplayProps> = ({
	content,
	isExpanded,
	onToggleExpand,
	path,
	filePattern,
}) => {
	const parsedData = useMemo(() => {
		// Check if this is a multi-workspace result
		const multiWorkspaceMatch = content.match(/^Found \d+ results? across \d+ workspaces?\./m)

		if (!multiWorkspaceMatch) {
			// Single workspace result - return as is
			return { isMultiWorkspace: false }
		}

		// Parse multi-workspace results
		const lines = content.split("\n")
		const sections: Array<{ workspace: string; content: string }> = []
		let currentWorkspace: string | null = null
		let currentContent: string[] = []

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]

			// Check for workspace header
			if (line.startsWith("## Workspace: ")) {
				// Save previous workspace section if exists
				if (currentWorkspace && currentContent.length > 0) {
					sections.push({
						workspace: currentWorkspace,
						content: currentContent.join("\n"),
					})
				}

				// Start new workspace section
				currentWorkspace = line.replace("## Workspace: ", "").trim()
				currentContent = []
			} else if (currentWorkspace) {
				// Add line to current workspace content
				currentContent.push(line)
			}
		}

		// Save last workspace section
		if (currentWorkspace && currentContent.length > 0) {
			sections.push({
				workspace: currentWorkspace,
				content: currentContent.join("\n"),
			})
		}

		return { isMultiWorkspace: true, sections, summaryLine: lines[0] }
	}, [content])

	// For single workspace, use the standard CodeAccordian
	if (!parsedData.isMultiWorkspace) {
		return (
			<CodeAccordian
				code={content}
				isExpanded={isExpanded}
				language="plaintext"
				onToggleExpand={onToggleExpand}
				path={path + (filePattern ? `/(${filePattern})` : "")}
			/>
		)
	}

	// For multi-workspace results, render a custom view
	const { sections, summaryLine } = parsedData

	return (
		<div className="search-results-container">
			<div className="search-results-header" onClick={onToggleExpand}>
				<span>/</span>
				<span className="search-results-path">{path + (filePattern ? `/(${filePattern})` : "")}</span>
				<div className="flex-1"></div>
				<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} text-[13.5px] my-[1px]`}></span>
			</div>

			{isExpanded && (
				<div className="search-results-content">
					{/* Summary line */}
					<div className="search-results-summary">{summaryLine}</div>

					{/* Workspace sections */}
					{sections?.map((section: any, index: number) => (
						<div className={index < sections.length - 1 ? "mb-4" : "mb-0"} key={`workspace-${section.workspace}`}>
							<div className="search-results-workspace-header">
								<span className="codicon codicon-folder text-sm text-[var(--vscode-symbolIcon-folderForeground)]"></span>
								<span className="search-results-workspace-name">Workspace: {section.workspace}</span>
							</div>

							{/* Results for this workspace */}
							<div className="search-results-code-block">
								<pre className="m-0 font-[inherit]">{section.content.trim()}</pre>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

export default SearchResultsDisplay
