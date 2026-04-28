import React from "react"
import { DiffViewer } from "./DiffViewer"

interface PlannedEditsProps {
	diff: string
	files: Array<{ path: string }>
}

export const PlannedEdits = ({ diff, files }: PlannedEditsProps) => {
	const getFileDiff = (filePath: string): string => {
		if (!diff || !filePath) return diff
		const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		const match = diff.match(new RegExp(`(diff --git a/.*${escaped}[\s\S]*?)(?=\ndiff --git a/|$)`))
		return match ? match[1] : diff
	}

	return (
		<div>
			{files.map((file) => (
				<div key={file.path}>
					<div>Cline wants to edit this file: {file.path}</div>
					<DiffViewer diff={getFileDiff(file.path)} />
				</div>
			))}
		</div>
	)
}
