import type { ClineSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import type { LucideIcon } from "lucide-react"
import { memo, useCallback } from "react"
import { TypewriterText } from "@/components/chat/TypewriterText"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

export interface FileToolRowProps {
	/** The lucide icon component to display */
	icon: LucideIcon
	/** The file/folder path to display (relative/display path) */
	filePath: string
	/** Optional custom display text (overrides filePath display, e.g. for search results) */
	displayText?: string
	/** If true, renders a disabled row with typewriter activity text instead of clickable path */
	isActive?: boolean
	/** Activity text shown during active state (e.g. "Reading src/App.tsx...") */
	activityText?: string
	/** If true, the item is expandable (folders, search, definitions) rather than opening file */
	isExpandable?: boolean
	/** Whether the expandable item is currently expanded */
	isExpanded?: boolean
	/** Callback for expand/collapse toggle */
	onToggle?: () => void
	/** Expandable content (e.g., file list for folders) */
	expandedContent?: string | null
	/** Absolute path to use for opening file (if different from filePath) */
	absolutePath?: string
	/** Warning icon for outside-workspace files */
	outsideWorkspace?: boolean
	/** Highlight the file path in blue (e.g., for pending approval) */
	isHighlighted?: boolean
}

/**
 * A shared compact file/folder row used in both ToolGroupRenderer (grouped tools)
 * and individual ChatRow tool cases (e.g., readFile with approval).
 *
 * Renders a single-line entry: [icon] [path/activity text]
 * Clicking opens the file in the editor or toggles expansion for folders.
 */
export const FileToolRow = memo<FileToolRowProps>(
	({
		icon: Icon,
		filePath,
		displayText,
		isActive,
		activityText,
		isExpandable,
		isExpanded,
		onToggle,
		expandedContent,
		absolutePath,
		outsideWorkspace,
		isHighlighted,
	}) => {
		const handleOpenFile = useCallback(() => {
			if (absolutePath) {
				FileServiceClient.openFile(StringRequest.create({ value: absolutePath })).catch((err) =>
					console.error("Failed to open file:", err),
				)
			} else if (filePath) {
				FileServiceClient.openFileRelativePath(StringRequest.create({ value: filePath })).catch((err) =>
					console.error("Failed to open file:", err),
				)
			}
		}, [filePath, absolutePath])

		const handleClick = useCallback(() => {
			if (isExpandable && onToggle) {
				onToggle()
			} else {
				handleOpenFile()
			}
		}, [isExpandable, onToggle, handleOpenFile])

		// Active items render with "Reading..." TypewriterText (disabled, not clickable)
		if (isActive && activityText) {
			return (
				<div className="min-w-0">
					<Button
						className="flex items-center gap-[3px] text-[13px] text-description py-[1px] min-w-0 max-w-full px-0 leading-tight -my-0.5"
						disabled
						size="icon"
						variant="text">
						<Icon className="opacity-70 shrink-0 size-[12px]" />
						<span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-left text-[13px]">
							<TypewriterText speed={15} text={activityText} />
						</span>
					</Button>
				</div>
			)
		}

		// Completed/static items render as clickable
		return (
			<div className="min-w-0">
				<Button
					className={cn(
						"flex items-center gap-[3px] cursor-pointer text-[13px] py-[1px] hover:text-link min-w-0 max-w-full px-0 leading-tight -my-0.5",
						isHighlighted ? "text-link" : "text-description",
					)}
					onClick={handleClick}
					size="icon"
					variant="text">
					<Icon className={cn("shrink-0 size-[12px]", isHighlighted ? "opacity-90" : "opacity-70")} />
					{outsideWorkspace && (
						<span
							className="codicon codicon-sign-out ph-no-capture"
							style={{
								color: "var(--vscode-editorWarning-foreground)",
								marginBottom: "-1.5px",
								transform: "rotate(-90deg)",
							}}
							title="This file is outside of your workspace"
						/>
					)}
					<span
						className={cn(
							"flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-left [direction:rtl] text-[13px]",
							{
								"[direction:ltr]": !!displayText,
							},
						)}>
						{(displayText || cleanPathPrefix(filePath)) + "\u200E"}
					</span>
				</Button>
				{/* Expanded content for folders/search/definitions - file lists only */}
				{isExpandable && isExpanded && expandedContent && (
					<pre className="m-1 ml-4 text-xs opacity-80 whitespace-pre-wrap break-words p-2 max-h-40 overflow-auto rounded-xs">
						{expandedContent}
					</pre>
				)}
			</div>
		)
	},
)

// ============================================================================
// Helper functions shared between ToolGroupRenderer and ChatRow
// ============================================================================

/**
 * Get display info for a tool type (icon, path, label, displayText).
 */
export function getToolDisplayInfo(tool: ClineSayTool, getIcon: (toolName: string) => LucideIcon) {
	const icon = getIcon(tool.tool)
	const filePath = tool.path || ""
	const folderPath = filePath + "/"

	switch (tool.tool) {
		case "readFile":
			return { icon, path: filePath, label: "read" }
		case "listFilesTopLevel":
			return { icon, path: folderPath, label: "listed" }
		case "listFilesRecursive":
			return { icon, path: folderPath, label: "listed recursively" }
		case "listCodeDefinitionNames":
			return { icon, path: folderPath, label: "definitions" }
		case "searchFiles":
			return {
				icon,
				path: folderPath,
				label: `search: ${tool.regex}`,
				displayText: formatSearchDisplay(tool.regex || "", filePath, tool.filePattern),
			}
		default:
			return null
	}
}

/**
 * Format activity text for active tool items (e.g., "Reading src/App.tsx...").
 */
export function getActivityText(tool: ClineSayTool): string | null {
	const cleanedPath = cleanPathPrefix(tool.path || "")
	switch (tool.tool) {
		case "readFile":
			return tool.path ? `Reading ${cleanedPath}...` : null
		case "listFilesTopLevel":
		case "listFilesRecursive":
			return tool.path ? `Exploring ${cleanedPath}/...` : null
		case "searchFiles":
			return tool.regex && tool.path ? `Searching ${formatSearchRegex(tool.regex, tool.path, tool.filePattern)}...` : null
		case "listCodeDefinitionNames":
			return tool.path ? `Analyzing ${cleanedPath}/...` : null
		default:
			return null
	}
}

/**
 * Format search regex for compact display.
 */
function formatSearchDisplay(regex: string, path: string, filePattern?: string): string {
	const terms = regex
		.split("|")
		.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)

	const termDisplay = terms.length > 3 ? `${terms.length} patterns` : `"${terms.join(" | ")}"`
	let result = `${termDisplay} in ${cleanPathPrefix(path)}/`

	if (filePattern && filePattern !== "*") {
		result += ` (${filePattern})`
	}

	return result
}

/**
 * Format search regex for activity text.
 */
function formatSearchRegex(regex: string, path: string, filePattern?: string): string {
	const cleanedPath = cleanPathPrefix(path)
	const terms = regex
		.split("|")
		.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)
		.join(" | ")
	return filePattern && filePattern !== "*" ? `"${terms}" in ${cleanedPath}/ (${filePattern})` : `"${terms}" in ${cleanedPath}/`
}
