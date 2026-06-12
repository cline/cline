import React, { useState } from "react"

interface RunChipProps {
	runId: string
	jsonPath: string
}

export const RunChip: React.FC<RunChipProps> = ({ runId, jsonPath }) => {
	const [open, setOpen] = useState(false)

	return (
		<span className="relative inline-flex items-center align-middle mx-0.5">
			<button
				className="
					inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[10px] font-medium
					leading-5 cursor-pointer border-0
					bg-[var(--vscode-testing-iconPassed)] text-white
					hover:opacity-90 transition-opacity select-none
				"
				onClick={() => setOpen((o) => !o)}
				title={`run:${runId}#${jsonPath}`}
				type="button">
				<span className="codicon codicon-check text-[9px]" />
				<span className="font-mono">{runId.split(".")[0]}</span>
				<span className="opacity-75">· verified</span>
			</button>

			{open && (
				<span
					className="
						absolute z-50 bottom-full left-0 mb-1 w-80 rounded-md shadow-lg
						bg-[var(--vscode-editorWidget-background)]
						border border-[var(--vscode-panel-border)]
						p-2 text-[var(--vscode-foreground)] text-xs leading-snug
					">
					<button
						className="absolute top-1 right-1 codicon codicon-close opacity-60 hover:opacity-100 bg-transparent border-0 cursor-pointer"
						onClick={() => setOpen(false)}
						type="button"
					/>
					<p className="font-semibold mb-1">Run-log reference</p>
					<p className="mb-0.5">
						<span className="opacity-60">Run ID: </span>
						<span className="font-mono">{runId}</span>
					</p>
					<p>
						<span className="opacity-60">Path: </span>
						<span className="font-mono">{jsonPath}</span>
					</p>
					<p className="mt-1 opacity-60 text-[10px]">Value verified by Answer Auditor against session run-log.</p>
				</span>
			)}
		</span>
	)
}

interface LitChipProps {
	tag: string
}

export const LitChip: React.FC<LitChipProps> = ({ tag }) => (
	<span
		className="
			inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[10px] font-medium
			leading-5 border border-[var(--vscode-panel-border)]
			text-[var(--vscode-disabledForeground)] bg-transparent align-middle mx-0.5
			select-none
		"
		title={`Literature: ${tag}`}>
		<span className="codicon codicon-book text-[9px]" />
		<span>{tag}</span>
	</span>
)
