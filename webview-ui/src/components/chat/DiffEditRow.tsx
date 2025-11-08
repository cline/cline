import { ChevronDown, ChevronRight, ChevronsDownUpIcon, FilePlus, FileText, FileX } from "lucide-react"
import React, { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface Patch {
	action: string
	path: string
	lines: string[]
	additions: number
	deletions: number
}

export const DiffEditRow: React.FC<{ patch: string }> = ({ patch }) => {
	const [isStreaming, setIsStreaming] = useState<boolean>(true)
	const [parsedFiles, setParsedFiles] = useState<Patch[]>([])

	useEffect(() => {
		const started = patch.includes("*** Begin Patch")
		const ended = patch.includes("*** End Patch")
		if (started && ended) {
			setIsStreaming(false)
		}
		if (!started) {
			return
		}
		// Extract patches between the begin and end markers
		const parts = patch.split("*** Begin Patch")[1].split("*** End Patch")
		const patchContent = parts[0].trim()
		const patches = patchContent.split("\n*** ").map((p) => p.trim())

		const parsed = parsePatchContent(patches.join("\n"))
		if (patches.length > 0 && parsed.length > 0) {
			setParsedFiles(parsed)
		}
	}, [patch])

	if (parsedFiles.length === 0) {
		return null
	}

	return (
		<div className="space-y-4 border border-code-block-background/70 rounded-sm">
			{parsedFiles.map((file, _idx) => (
				<FileBlock file={file} key={file.path} />
			))}
			{isStreaming && (
				<div className="bg-gray-800 rounded-lg flex items-center text-gray-400">
					<div className="animate-pulse mr-3">●</div>
					Streaming content...
				</div>
			)}
		</div>
	)
}

const FileBlock: React.FC<{ file: Patch }> = ({ file }) => {
	const [isExpanded, setIsExpanded] = useState(true)

	const getActionIcon = (action: string) => {
		switch (action) {
			case "Add":
				return <FilePlus className="w-5 h-5 text-success" />
			case "Delete":
				return <FileX className="w-5 h-5 text-error" />
			default:
				return <FileText className="w-5 h-5 text-info" />
		}
	}

	const getActionColor = (action: string) => {
		switch (action) {
			case "Add":
				return "border-l-success"
			case "Delete":
				return "border-l-error"
			default:
				return "border-l-background"
		}
	}

	return (
		<div className="p-1 bg-editor-background rounded-lg border border-gray-800">
			<button
				className="w-full flex items-center gap-2 px-4 py-3 bg-editor-background hover:bg-gray-850 transition-colors rounded-t-lg border-b border-gray-800"
				onClick={() => setIsExpanded(!isExpanded)}>
				<div className="flex items-center gap-3">
					{isExpanded ? (
						<ChevronDown className="w-5 h-5 text-gray-400" />
					) : (
						<ChevronRight className="w-5 h-5 text-gray-400" />
					)}
					<span className={cn("flex items-center gap-2", getActionColor(file.action))}>
						{getActionIcon(file.action)}
						<span className="font-medium">{file.action}</span>
					</span>
				</div>
				<span className="text-xs text-gray-500">
					{file.additions > 0 && <span className="text-success">+{file.additions}</span>}
					{file.additions > 0 && file.deletions > 0 && <span className="mx-1">·</span>}
					{file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
				</span>
			</button>

			{isExpanded && (
				<div className="border-t border-code-block-background">
					<div className="font-mono text-xs">
						{file.lines.map((line, _idx) => (
							<DiffLine key={line} line={line} />
						))}
					</div>
				</div>
			)}
		</div>
	)
}

const DiffLine: React.FC<{ line: string }> = ({ line }) => {
	const getLineStyle = () => {
		if (line.startsWith("+")) {
			return "bg-green-900/30 text-success border-l-1 border-green-500"
		} else if (line.startsWith("-")) {
			return "bg-red-900/30 text-error border-l-1 border-red-500"
		} else {
			return "bg-editor-background text-editor-foreground"
		}
	}

	if (line.trim() === "@@") {
		return (
			<div className="inline-flex items-center px-3 py-1 text-xs font-mono bg-description/10 w-full text-description">
				<ChevronsDownUpIcon className="size-2 mr-2" />
				@@
			</div>
		)
	}

	return (
		<div className={cn("px-4 py-1 text-xs font-mono w-full", getLineStyle())}>
			<span>{line}</span>
		</div>
	)
}

const parsePatchContent = (content: string) => {
	const files: Patch[] = []
	const lines = content.split("\n")

	let currentFile: Patch | null = null

	for (const line of lines) {
		const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/)

		if (fileMatch) {
			if (currentFile) {
				files.push(currentFile)
			}

			currentFile = {
				action: fileMatch[1],
				path: fileMatch[2].trim(),
				lines: [],
				additions: 0,
				deletions: 0,
			}
		} else if (currentFile && line.trim()) {
			currentFile.lines.push(line)

			if (line.startsWith("+")) {
				currentFile.additions++
			} else if (line.startsWith("-")) {
				currentFile.deletions++
			}
		}
	}

	if (currentFile) {
		files.push(currentFile)
	}

	return files
}
