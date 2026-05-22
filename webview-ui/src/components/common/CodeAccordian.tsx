import { memo, useMemo } from "react"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { getLanguageFromPath } from "@/utils/getLanguageFromPath"

interface CodeAccordianProps {
	code?: string
	diff?: string
	language?: string | undefined
	path?: string
	isFeedback?: boolean
	isConsoleLogs?: boolean
	isExpanded: boolean
	onToggleExpand: () => void
	isLoading?: boolean
}

/*
We need to remove leading non-alphanumeric characters from the path in order for our leading ellipses trick to work.
^: Anchors the match to the start of the string.
[^a-zA-Z0-9]+: Matches one or more characters that are not alphanumeric.
The replace method removes these matched characters, effectively trimming the string up to the first alphanumeric character.
*/
export const cleanPathPrefix = (path: string): string => path.replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, "")

const CodeAccordian = ({
	code,
	diff,
	language,
	path,
	isFeedback,
	isConsoleLogs,
	isExpanded,
	onToggleExpand,
	isLoading,
}: CodeAccordianProps) => {
	const inferredLanguage = useMemo(
		() => code && (language ?? (path ? getLanguageFromPath(path) : undefined)),
		[path, language, code],
	)

	const numberOfEdits = useMemo(() => {
		if (code) {
			return (code.match(/[-]{3,} SEARCH/g) || []).length || undefined
		}
		return undefined
	}, [code])

	return (
		<div
			className="modern-card overflow-hidden"
			style={{
				borderRadius: 8,
				backgroundColor: CODE_BLOCK_BG_COLOR,
				border: "1px solid color-mix(in srgb, var(--vscode-editorGroup-border) 60%, transparent)",
			}}>
			{(path || isFeedback || isConsoleLogs) && (
				<div
					className={`code-block-header smooth-transition ${isLoading ? "cursor-wait" : "cursor-pointer"} ${isLoading ? "opacity-70" : "opacity-100"}`}
					onClick={isLoading ? undefined : onToggleExpand}
					style={{
						userSelect: "none",
						WebkitUserSelect: "none",
						MozUserSelect: "none",
						msUserSelect: "none",
					}}>
					{isFeedback || isConsoleLogs ? (
						<div className="flex items-center gap-1.5">
							<span className={`codicon codicon-${isFeedback ? "feedback" : "output"} text-[13px]`}></span>
							<span className="font-medium text-[var(--vscode-foreground)]">
								{isFeedback ? "User Edits" : "Console Logs"}
							</span>
						</div>
					) : (
						<div className="flex items-center gap-1.5 min-w-0">
							{inferredLanguage && <span className="chip chip-ocean mr-1.5">{inferredLanguage}</span>}
							{path?.startsWith(".") && <span className="text-[var(--vscode-descriptionForeground)]">.</span>}
							{path && !path.startsWith(".") && (
								<span className="text-[var(--vscode-descriptionForeground)]">/</span>
							)}
							<span className="truncate direction-rtl text-left">{cleanPathPrefix(path ?? "") + "\u200E"}</span>
						</div>
					)}
					<div className="flex-1"></div>
					{numberOfEdits !== undefined && (
						<div className="modern-badge mr-2">
							<span className="codicon codicon-diff-single text-[10px]"></span>
							<span>{numberOfEdits}</span>
						</div>
					)}
					<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} text-[13px] opacity-70`}></span>
				</div>
			)}
			{(!(path || isFeedback || isConsoleLogs) || isExpanded) && (
				<div
					//className="code-block-scrollable" this doesn't seem to be necessary anymore, on silicon macs it shows the native mac scrollbar instead of the vscode styled one
					className="overflow-x-auto overflow-y-hidden max-w-full">
					<CodeBlock
						source={`${"```"}${diff !== undefined ? "diff" : inferredLanguage}\n${(
							code ?? diff ?? ""
						).trim()}\n${"```"}`}
					/>
				</div>
			)}
		</div>
	)
}

// memo does shallow comparison of props, so if you need it to re-render when a nested object changes, you need to pass a custom comparison function
export default memo(CodeAccordian)
