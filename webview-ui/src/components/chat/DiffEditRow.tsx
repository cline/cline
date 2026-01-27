import { StringRequest } from "@shared/proto/cline/common"
import { FilePlus, FileText, FileX, SquareArrowOutUpRightIcon } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

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

interface DiffEditRowProps {
	patch: string
	path: string
	isLoading?: boolean
	startLineNumbers?: number[]
}

export const DiffEditRow = memo<DiffEditRowProps>(({ patch, path, isLoading, startLineNumbers }) => {
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
		<div className="space-y-4 rounded-xs">
			{parsedFiles.map((file, index) => (
				<FileBlock
					file={file}
					isStreaming={isStreaming}
					key={`${file.path}-${index}`}
					startLineNumber={startLineNumbers?.[index]}
				/>
			))}
		</div>
	)
})

const FileBlock = memo<{ file: Patch; isStreaming: boolean; startLineNumber?: number }>(
	({ file, isStreaming, startLineNumber }) => {
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

		const handleOpenFile = (event: React.MouseEvent) => {
			event.stopPropagation()

			if (file.path) {
				FileServiceClient.openFileRelativePath(StringRequest.create({ value: file.path })).catch((err) =>
					console.error("Failed to open file:", err),
				)
			}
		}

		const actionStyle = ACTION_STYLES[file.action as keyof typeof ACTION_STYLES] ?? ACTION_STYLES.default
		const ActionIcon = actionStyle.icon

		// Only calculate line numbers if we have actual positions from the backend
		// When startLineNumber is undefined (e.g., V2 diff or no match indices), we skip line numbers entirely
		const lineNumbers = useMemo(() => {
			if (startLineNumber === undefined) return undefined

			let oldLine = startLineNumber
			let newLine = startLineNumber

			return file.lines.map((line) => {
				const isAddition = line.startsWith("+")
				const isDeletion = line.startsWith("-")
				const isContext = !isAddition && !isDeletion

				if (isDeletion) {
					const display = oldLine
					oldLine += 1
					return display
				}

				const display = newLine
				newLine += 1
				if (isContext) {
					oldLine += 1
				}
				return display
			})
		}, [file.lines, startLineNumber])

		return (
			<div className="bg-code rounded-xs border border-editor-group-border overflow-hidden">
				<button
					className="w-full flex items-center gap-2 p-2 bg-code transition-colors justify-between cursor-pointer"
					onClick={() => setIsExpanded((prev) => !prev)}
					type="button">
					<div className="flex items-center gap-3 flex-1 w-full overflow-hidden">
						<div className={cn("flex items-center gap-2 w-full", actionStyle.borderClass)}>
							<ActionIcon className={cn("w-5 h-5", actionStyle.iconClass)} />
							<span
								className="font-medium truncate hover:underline hover:text-link"
								onClick={handleOpenFile}
								title="Open file in editor">
								{file.path}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<DiffStats additions={file.additions} deletions={file.deletions} />
						<span
							className="p-1 hover:bg-description/20 rounded-xs transition-colors"
							onClick={handleOpenFile}
							title="Open file in editor">
							<SquareArrowOutUpRightIcon className="size-2 text-description hover:text-foreground" />
						</span>
					</div>
				</button>

				{isExpanded && (
					<div
						className="border-t border-code-block-background max-h-80 overflow-y-auto overflow-x-auto"
						onScroll={handleScroll}
						ref={scrollContainerRef}>
						<div className="font-mono text-xs w-max min-w-full">
							{file.lines.map((line, index) => (
								<DiffLine key={`${index}-${line.slice(0, 20)}`} line={line} lineNumber={lineNumbers?.[index]} />
							))}
						</div>
					</div>
				)}
			</div>
		)
	},
	(prev, next) =>
		prev.isStreaming === next.isStreaming &&
		prev.startLineNumber === next.startLineNumber &&
		prev.file.path === next.file.path &&
		prev.file.action === next.file.action &&
		prev.file.additions === next.file.additions &&
		prev.file.deletions === next.file.deletions &&
		prev.file.lines === next.file.lines,
)

const DiffStats = memo<{ additions: number; deletions: number }>(({ additions, deletions }) => (
	<div className="text-xs text-gray-500 flex">
		{additions > 0 && <span className="text-success">+{additions}</span>}
		{additions > 0 && deletions > 0 && <span className="mx-1">·</span>}
		{deletions > 0 && <span className="text-error">-{deletions}</span>}
	</div>
))

// Diff line component with Tailwind styling - indicator bar, line number, prefix, code
const DiffLine = memo<{ line: string; lineNumber?: number; showLineNumberColumn?: boolean }>(
	({ line, lineNumber, showLineNumberColumn = true }) => {
		const isAddition = line.startsWith("+")
		const isDeletion = line.startsWith("-")
		const hasSpacePrefix = line.startsWith("+ ") || line.startsWith("- ")
		// Extract just the code content (without +/- prefix)
		const code = isAddition || isDeletion ? line.slice(hasSpacePrefix ? 2 : 1) : line
		// Get the prefix character to display
		const prefix = isAddition ? "+" : isDeletion ? "-" : " "

		return (
			<div
				className={cn(
					"flex text-xs font-mono",
					// Row background tint
					isAddition && "bg-green-500/10",
					isDeletion && "bg-red-500/10",
					// Left indicator bar (the colored stripe)
					isAddition && "border-l-4 border-l-green-500",
					isDeletion && "border-l-4 border-l-red-500",
					!isAddition && !isDeletion && "border-l-4 border-l-transparent",
				)}>
				{/* Line number column - always reserve space to prevent layout shift during streaming */}
				{showLineNumberColumn && (
					<span
						className={cn(
							"w-10 min-w-10 text-right pr-2 py-0.5 select-none border-r border-code-block-background/50",
							isAddition && "text-green-400/60",
							isDeletion && "text-red-400/60",
							!isAddition && !isDeletion && "text-description/50",
						)}>
						{lineNumber ?? ""}
					</span>
				)}
				{/* Prefix character (+/-) for backwards compatibility with traditional diff views */}
				<span
					className={cn(
						"w-4 min-w-4 text-center py-0.5 select-none",
						isAddition && "text-green-400",
						isDeletion && "text-red-400",
						!isAddition && !isDeletion && "text-description/50",
					)}>
					{prefix}
				</span>
				{/* Code content */}
				<span
					className={cn(
						"flex-1 pr-2 py-0.5 whitespace-nowrap",
						isAddition && "text-green-400",
						isDeletion && "text-red-400",
						!isAddition && !isDeletion && "text-editor-foreground",
					)}>
					{code}
				</span>
			</div>
		)
	},
)

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
		const results = parseAllSearchReplaceBlocks(patch, path)
		if (results.length > 0) {
			// Count how many complete blocks we have (those ending with REPLACE marker)
			const replaceCount = (patch.match(/\+{7,} REPLACE/g) || []).length
			const searchCount = (patch.match(/-{7,} SEARCH/g) || []).length
			return {
				parsedFiles: results,
				isStreaming: replaceCount < searchCount,
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
 * Splits each @@ chunk into a separate Patch object so each chunk can have its own startLineNumber
 */
function parseNewFormat(content: string): Patch[] {
	const files: Patch[] = []
	const lines = content.split("\n")

	let currentFile: { action: string; path: string } | null = null
	let currentChunk: Patch | null = null

	const pushCurrentChunk = () => {
		if (currentChunk && currentChunk.lines.length > 0) {
			files.push(currentChunk)
		}
	}

	const startNewChunk = () => {
		if (!currentFile) return
		pushCurrentChunk()
		currentChunk = {
			action: currentFile.action,
			path: currentFile.path,
			lines: [],
			additions: 0,
			deletions: 0,
		}
	}

	for (const line of lines) {
		const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/)

		if (fileMatch) {
			// New file - push any existing chunk and start fresh
			pushCurrentChunk()
			currentFile = {
				action: fileMatch[1],
				path: fileMatch[2].trim(),
			}
			currentChunk = null // Will be created when we see content or @@
		} else if (line.trim() === "@@") {
			// @@ marker means start of a new chunk - split here
			startNewChunk()
		} else if (currentFile && line.trim()) {
			// Content line - ensure we have a chunk to add to
			if (!currentChunk) {
				currentChunk = {
					action: currentFile.action,
					path: currentFile.path,
					lines: [],
					additions: 0,
					deletions: 0,
				}
			}
			currentChunk.lines.push(line)
			if (line[0] === "+") {
				currentChunk.additions++
			} else if (line[0] === "-") {
				currentChunk.deletions++
			}
		}
	}

	// Push the last chunk
	pushCurrentChunk()

	return files
}

/**
 * Parse all SEARCH/REPLACE blocks from a diff string
 * Returns an array of Patch objects, one per SEARCH/REPLACE block
 */
function parseAllSearchReplaceBlocks(patch: string, path: string): Patch[] {
	const results: Patch[] = []
	const searchRegex = /-{7,} SEARCH/g
	let match: RegExpExecArray | null

	// Find all SEARCH markers and extract each block
	const searchPositions: number[] = []
	while ((match = searchRegex.exec(patch)) !== null) {
		searchPositions.push(match.index)
	}

	// Parse each block
	for (let i = 0; i < searchPositions.length; i++) {
		const start = searchPositions[i]
		// The end is either the next SEARCH marker or the end of the patch
		const end = i < searchPositions.length - 1 ? searchPositions[i + 1] : patch.length
		const blockContent = patch.substring(start, end)

		const parsed = parseSearchReplaceFormat(blockContent, path)
		if (parsed) {
			results.push(parsed)
		}
	}

	return results
}

/**
 * Parse a single SEARCH REPLACE diff format block (------- SEARCH / ======= / +++++++ REPLACE)
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
