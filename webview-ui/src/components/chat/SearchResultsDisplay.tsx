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
		<div
			style={{
				borderRadius: 3,
				backgroundColor: "var(--vscode-textCodeBlock-background)",
				overflow: "hidden",
				border: "1px solid var(--vscode-editorGroup-border)",
			}}>
			<div
				onClick={onToggleExpand}
				style={{
					color: "var(--vscode-descriptionForeground)",
					display: "flex",
					alignItems: "center",
					padding: "9px 10px",
					cursor: "pointer",
					userSelect: "none",
					WebkitUserSelect: "none",
					MozUserSelect: "none",
					msUserSelect: "none",
				}}>
				<span>/</span>
				<span
					style={{
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						marginRight: "8px",
					}}>
					{path + (filePattern ? `/(${filePattern})` : "")}
				</span>
				<div style={{ flexGrow: 1 }}></div>
				<span
					className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}
					style={{
						fontSize: 13.5,
						margin: "1px 0",
					}}></span>
			</div>

			{isExpanded && (
				<div style={{ padding: "10px", borderTop: "1px solid var(--vscode-editorGroup-border)" }}>
					{/* Summary line */}
					<div
						style={{
							marginBottom: "12px",
							fontWeight: "bold",
							color: "var(--vscode-foreground)",
						}}>
						{summaryLine}
					</div>

					{/* Workspace sections */}
					{sections?.map((section: any, index: number) => (
						<div
							key={`workspace-${section.workspace}`}
							style={{ marginBottom: index < sections.length - 1 ? "16px" : 0 }}>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "6px",
									marginBottom: "8px",
									padding: "4px 8px",
									backgroundColor: "var(--vscode-editor-background)",
									borderRadius: "3px",
									border: "1px solid var(--vscode-editorWidget-border)",
								}}>
								<span
									className="codicon codicon-folder"
									style={{
										fontSize: "14px",
										color: "var(--vscode-symbolIcon-folderForeground)",
									}}></span>
								<span
									style={{
										fontWeight: "500",
										color: "var(--vscode-foreground)",
									}}>
									Workspace: {section.workspace}
								</span>
							</div>

							{/* Results for this workspace */}
							<div
								style={{
									backgroundColor: "var(--vscode-textCodeBlock-background)",
									padding: "8px",
									borderRadius: "3px",
									fontSize: "var(--vscode-editor-font-size)",
									fontFamily: "var(--vscode-editor-font-family)",
									lineHeight: "1.5",
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
								}}>
								<pre style={{ margin: 0, fontFamily: "inherit" }}>{section.content.trim()}</pre>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

export default SearchResultsDisplay
