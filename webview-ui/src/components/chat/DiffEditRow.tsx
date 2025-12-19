import { ChevronsDownUpIcon, FilePlus, FileText, FileX } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface Patch {
	action: string
	path: string
	lines: string[]
	additions: number
	deletions: number
}

// Constants for format markers
const MARKERS = {
	SEARCH_BLOCK: "------- SEARCH",
	SEARCH_SEPARATOR: "=======",
	REPLACE_BLOCK: "+++++++ REPLACE",
	NEW_BEGIN: "*** Begin Patch",
	NEW_END: "*** End Patch",
	FILE_PATTERN: /^\*\*\* (Add|Update|Delete) File: (.+)$/m,
} as const

// Style mappings for actions
const ACTION_STYLES = {
	Add: { icon: FilePlus, iconClass: "text-success", borderClass: "border-l-success" },
	Delete: { icon: FileX, iconClass: "text-error", borderClass: "border-l-error" },
	default: { icon: FileText, iconClass: "text-info", borderClass: "border-l-background" },
} as const

// Style mappings for diff lines
const LINE_STYLES = {
	"+": "bg-green-500/10 text-success border-l-1 border-green-500",
	"-": "bg-red-500/10 text-error border-l-1 border-red-500",
	default: "bg-editor-background text-editor-foreground",
} as const

interface DiffEditRowProps {
	patch: string
	path: string
	isLoading?: boolean
}

export const DiffEditRow = memo<DiffEditRowProps>(({ patch, path, isLoading }) => {
	const { parsedFiles, isStreaming } = useMemo(() => {
		const parsed = parsePatch(patch, path)
		return {
			parsedFiles: parsed.parsedFiles,
			isStreaming: isLoading || parsed.isStreaming,
		}
	}, [patch, path, isLoading])

	if (!path) {
		return null
	}

	return (
		<div className="space-y-4 border border-code-block-background/70 rounded-xs">
			{parsedFiles.map((file) => (
				<FileBlock file={file} isStreaming={isStreaming} key={file.path} />
			))}
		</div>
	)
})

const FileBlock = memo<{ file: Patch; isStreaming: boolean }>(
	({ file, isStreaming }) => {
		const [isExpanded, setIsExpanded] = useState(true)
		const scrollContainerRef = useRef<HTMLDivElement>(null)
		const shouldFollowRef = useRef(true)
		const isProgrammaticScrollRef = useRef(false)

		// Auto-scroll to bottom during streaming
		useEffect(() => {
			const container = scrollContainerRef.current
			if (!isExpanded || !isStreaming || !shouldFollowRef.current || !container) {
				return
			}

			isProgrammaticScrollRef.current = true
			container.scrollTop = container.scrollHeight - container.clientHeight

			requestAnimationFrame(() => {
				isProgrammaticScrollRef.current = false
			})
		}, [file.lines.length, isExpanded, isStreaming])

		const handleScroll = () => {
			const container = scrollContainerRef.current
			if (!container || isProgrammaticScrollRef.current) {
				return
			}

			const { scrollTop, scrollHeight, clientHeight } = container
			shouldFollowRef.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 10
		}

		const actionStyle = ACTION_STYLES[file.action as keyof typeof ACTION_STYLES] ?? ACTION_STYLES.default
		const ActionIcon = actionStyle.icon

		return (
			<div className="p-1 bg-code rounded-xs border border-editor-group-border">
				<button
					className="w-full flex items-center gap-2 p-2 bg-code transition-colors rounded-t-xs justify-between cursor-pointer"
					onClick={() => setIsExpanded((prev) => !prev)}
					type="button">
					<div className="flex items-center gap-3">
						<div className={cn("flex items-center gap-2", actionStyle.borderClass)}>
							<ActionIcon className={cn("w-5 h-5", actionStyle.iconClass)} />
							<span className="font-medium">{file.path}</span>
						</div>
					</div>
					<DiffStats additions={file.additions} deletions={file.deletions} />
				</button>

				{isExpanded && (
					<div
						className="border-t border-code-block-background max-h-72 overflow-y-auto"
						onScroll={handleScroll}
						ref={scrollContainerRef}>
						<div className="font-mono text-xs">
							{file.lines.map((line, idx) => (
								<DiffLine key={idx} line={line} />
							))}
						</div>
					</div>
				)}
			</div>
		)
	},
	(prev, next) =>
		prev.isStreaming === next.isStreaming &&
		prev.file.path === next.file.path &&
		prev.file.action === next.file.action &&
		prev.file.additions === next.file.additions &&
		prev.file.deletions === next.file.deletions &&
		prev.file.lines === next.file.lines, // Reference equality - parsing creates new arrays only when content changes
)

const DiffStats = memo<{ additions: number; deletions: number }>(({ additions, deletions }) => (
	<div className="text-xs text-gray-500 flex">
		{additions > 0 && <span className="text-success">+{additions}</span>}
		{additions > 0 && deletions > 0 && <span className="mx-1">·</span>}
		{deletions > 0 && <span className="text-error">-{deletions}</span>}
	</div>
))

const DiffLine = memo<{ line: string }>(({ line }) => {
	if (line.trim() === "@@") {
		return (
			<div className="inline-flex items-center px-3 py-1 text-xs font-mono bg-description/10 w-full text-description">
				<ChevronsDownUpIcon className="size-2 mr-2" />
				@@
			</div>
		)
	}

	const firstChar = line[0] as "+" | "-" | undefined
	const style = LINE_STYLES[firstChar ?? "default"] ?? LINE_STYLES.default

	return (
		<div className={cn("px-4 py-1 text-xs font-mono w-full", style)}>
			<span>{line}</span>
		</div>
	)
})

// ============================================================================
// Parsing Functions
// ============================================================================

interface ParseResult {
	parsedFiles: Patch[]
	isStreaming: boolean
}

/**
 * Main parsing function that detects format and delegates to appropriate parser
 */
function parsePatch(patch: string, path: string): ParseResult {
	// Try old format first (------- SEARCH / ======= / +++++++ REPLACE)
	if (patch.includes(MARKERS.SEARCH_BLOCK)) {
		const result = parseSearchReplaceFormat(patch, path)
		if (result) {
			return {
				parsedFiles: [result],
				isStreaming: !patch.includes(MARKERS.REPLACE_BLOCK),
			}
		}
	}

	// Try new format (*** Begin Patch / *** End Patch)
	if (patch.includes(MARKERS.NEW_BEGIN)) {
		const endIndex = patch.indexOf(MARKERS.NEW_END)
		const isComplete = endIndex !== -1

		const beginIndex = patch.indexOf(MARKERS.NEW_BEGIN)
		const contentStart = beginIndex + MARKERS.NEW_BEGIN.length
		const contentEnd = isComplete ? endIndex : patch.length
		const patchContent = patch.substring(contentStart, contentEnd).trim()

		const parsed = parseNewFormat(patchContent)
		if (parsed.length > 0) {
			return { parsedFiles: parsed, isStreaming: !isComplete }
		}
	}

	// Fallback: treat entire patch as a new file addition
	if (path && patch) {
		const lines = patch.split("\n")
		return {
			parsedFiles: [
				{
					action: "Add",
					path,
					lines: lines.map((line) => `+ ${line}`),
					additions: lines.length,
					deletions: 0,
				},
			],
			isStreaming: true,
		}
	}

	return { parsedFiles: [], isStreaming: true }
}

/**
 * Parse new format patches (*** Add/Update/Delete File: path)
 */
function parseNewFormat(content: string): Patch[] {
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
			if (line[0] === "+") {
				currentFile.additions++
			} else if (line[0] === "-") {
				currentFile.deletions++
			}
		}
	}

	if (currentFile) {
		files.push(currentFile)
	}

	return files
}

/**
 * Parse SEARCH REPLACE diff format patches (------- SEARCH / ======= / +++++++ REPLACE)
 * Converts SEARCH block to deletions (-) and REPLACE block to additions (+)
 */
function parseSearchReplaceFormat(patch: string, path: string): Patch | undefined {
	const searchIndex = patch.indexOf(MARKERS.SEARCH_BLOCK)
	if (searchIndex === -1) {
		return undefined
	}

	// Extract file metadata if present
	const fileMatch = patch.match(MARKERS.FILE_PATTERN)

	const result: Patch = {
		action: fileMatch?.[1] ?? "Update",
		path: fileMatch?.[2]?.trim() ?? path ?? "",
		lines: [],
		additions: 0,
		deletions: 0,
	}

	// Extract content after SEARCH marker
	const afterSearch = patch.substring(searchIndex + MARKERS.SEARCH_BLOCK.length).replace(/^\r?\n/, "")

	const separatorIndex = afterSearch.indexOf(MARKERS.SEARCH_SEPARATOR)

	if (separatorIndex === -1) {
		// Still streaming - only SEARCH block available
		const searchContent = afterSearch.trimEnd()
		addLinesToPatch(result, searchContent, "-")
		return result
	}

	// Extract SEARCH block (deletions)
	const searchContent = afterSearch.substring(0, separatorIndex).replace(/\r?\n$/, "")
	addLinesToPatch(result, searchContent, "-")

	// Extract REPLACE block (additions)
	const afterSeparator = afterSearch.substring(separatorIndex + MARKERS.SEARCH_SEPARATOR.length).replace(/^\r?\n/, "")
	const replaceEndIndex = afterSeparator.indexOf(MARKERS.REPLACE_BLOCK)

	const replaceContent =
		replaceEndIndex !== -1 ? afterSeparator.substring(0, replaceEndIndex).replace(/\r?\n$/, "") : afterSeparator.trimEnd()

	addLinesToPatch(result, replaceContent, "+")

	return result
}

/**
 * Helper to add lines to a patch with the specified prefix
 */
function addLinesToPatch(patch: Patch, content: string, prefix: "+" | "-"): void {
	const lines = content.split("\n")
	for (const line of lines) {
		patch.lines.push(`${prefix} ${line}`)
		if (prefix === "+") {
			patch.additions++
		} else {
			patch.deletions++
		}
	}
}
