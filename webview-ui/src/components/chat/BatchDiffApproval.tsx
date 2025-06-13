import React, { memo, useState } from "react"
import CodeAccordian from "../common/CodeAccordian"

interface FileDiff {
	path: string
	changeCount: number
	key: string
	content: string
	diffs?: Array<{
		content: string
		startLine?: number
	}>
}

interface BatchDiffApprovalProps {
	files: FileDiff[]
	ts: number
}

export const BatchDiffApproval = memo(({ files = [], ts }: BatchDiffApprovalProps) => {
	const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({})

	if (!files?.length) {
		return null
	}

	const handleToggleExpand = (filePath: string) => {
		setExpandedFiles((prev) => ({
			...prev,
			[filePath]: !prev[filePath],
		}))
	}

	return (
		<div className="pt-[5px]">
			<div className="flex flex-col gap-0 border border-border rounded-md p-1">
				{files.map((file) => {
					// Combine all diffs into a single diff string for this file
					const combinedDiff = file.diffs?.map((diff) => diff.content).join("\n\n") || file.content

					return (
						<div key={`${file.path}-${ts}`}>
							<CodeAccordian
								path={file.path}
								code={combinedDiff}
								language="diff"
								isExpanded={expandedFiles[file.path] || false}
								onToggleExpand={() => handleToggleExpand(file.path)}
							/>
						</div>
					)
				})}
			</div>
		</div>
	)
})

BatchDiffApproval.displayName = "BatchDiffApproval"
