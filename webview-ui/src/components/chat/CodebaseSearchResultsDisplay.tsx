import React, { useState } from "react"
import CodebaseSearchResult from "./CodebaseSearchResult"
import { Trans } from "react-i18next"

interface CodebaseSearchResultsDisplayProps {
	results: Array<{
		filePath: string
		score: number
		startLine: number
		endLine: number
		codeChunk: string
	}>
}

const CodebaseSearchResultsDisplay: React.FC<CodebaseSearchResultsDisplayProps> = ({ results }) => {
	const [codebaseSearchResultsExpanded, setCodebaseSearchResultsExpanded] = useState(false)

	return (
		<div className="flex flex-col -mt-4 gap-1">
			<div
				onClick={() => setCodebaseSearchResultsExpanded(!codebaseSearchResultsExpanded)}
				className="cursor-pointer flex items-center justify-between px-2 py-2 border bg-[var(--vscode-editor-background)] border-[var(--vscode-editorGroup-border)]">
				<span>
					<Trans
						i18nKey="chat:codebaseSearch.didSearch"
						count={results.length}
						values={{ count: results.length }}
					/>
				</span>
				<span className={`codicon codicon-chevron-${codebaseSearchResultsExpanded ? "up" : "down"}`}></span>
			</div>

			{codebaseSearchResultsExpanded && (
				<div className="flex flex-col gap-1">
					{results.map((result, idx) => (
						<CodebaseSearchResult
							key={idx}
							filePath={result.filePath}
							score={result.score}
							startLine={result.startLine}
							endLine={result.endLine}
							language="plaintext"
							snippet={result.codeChunk}
						/>
					))}
				</div>
			)}
		</div>
	)
}

export default CodebaseSearchResultsDisplay
