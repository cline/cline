import { memo, useMemo } from "react"
import { getLanguageFromPath } from "../../utils/getLanguageFromPath"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "./CodeBlock"
import { ToolProgressStatus } from "../../../../src/shared/ExtensionMessage"

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
	progressStatus?: ToolProgressStatus
}

/*
We need to remove certain leading characters from the path in order for our leading ellipses trick to work.
However, we want to preserve all language characters (including CJK, Cyrillic, etc.) and only remove specific
punctuation that might interfere with the ellipsis display.
*/
export const removeLeadingNonAlphanumeric = (path: string): string => {
	// Only remove specific punctuation characters that might interfere with ellipsis display
	// Keep all language characters (including CJK, Cyrillic, etc.) and numbers
	return path.replace(/^[/\\:*?"<>|]+/, "")
}

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
	progressStatus,
}: CodeAccordianProps) => {
	const inferredLanguage = useMemo(
		() => code && (language ?? (path ? getLanguageFromPath(path) : undefined)),
		[path, language, code],
	)

	return (
		<div
			style={{
				borderRadius: 3,
				backgroundColor: CODE_BLOCK_BG_COLOR,
				overflow: "hidden", // This ensures the inner scrollable area doesn't overflow the rounded corners
				border: "1px solid var(--vscode-editorGroup-border)",
			}}>
			{(path || isFeedback || isConsoleLogs) && (
				<div
					style={{
						color: "var(--vscode-descriptionForeground)",
						display: "flex",
						alignItems: "center",
						padding: "9px 10px",
						cursor: isLoading ? "wait" : "pointer",
						opacity: isLoading ? 0.7 : 1,
						// pointerEvents: isLoading ? "none" : "auto",
						userSelect: "none",
						WebkitUserSelect: "none",
						MozUserSelect: "none",
						msUserSelect: "none",
					}}
					onClick={isLoading ? undefined : onToggleExpand}>
					{isFeedback || isConsoleLogs ? (
						<div style={{ display: "flex", alignItems: "center" }}>
							<span
								className={`codicon codicon-${isFeedback ? "feedback" : "output"}`}
								style={{ marginRight: "6px" }}></span>
							<span
								style={{
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									marginRight: "8px",
								}}>
								{isFeedback ? "User Edits" : "Console Logs"}
							</span>
						</div>
					) : (
						<>
							{path?.startsWith(".") && <span>.</span>}
							<span
								style={{
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									marginRight: "8px",
									// trick to get ellipsis at beginning of string
									direction: "rtl",
									textAlign: "left",
								}}>
								{removeLeadingNonAlphanumeric(path ?? "") + "\u200E"}
							</span>
						</>
					)}
					<div style={{ flexGrow: 1 }}></div>
					{progressStatus && progressStatus.text && (
						<>
							{progressStatus.icon && <span className={`codicon codicon-${progressStatus.icon} mr-1`} />}
							<span className="mr-1 ml-auto text-vscode-descriptionForeground">
								{progressStatus.text}
							</span>
						</>
					)}
					<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
				</div>
			)}
			{(!(path || isFeedback || isConsoleLogs) || isExpanded) && (
				<div
					//className="code-block-scrollable" this doesn't seem to be necessary anymore, on silicon macs it shows the native mac scrollbar instead of the vscode styled one
					style={{
						overflowX: "auto",
						overflowY: "hidden",
						maxWidth: "100%",
					}}>
					<CodeBlock
						source={`${"```"}${diff !== undefined ? "diff" : inferredLanguage}\n${(
							code ??
							diff ??
							""
						).trim()}\n${"```"}`}
					/>
				</div>
			)}
		</div>
	)
}

// memo does shallow comparison of props, so if you need it to re-render when a nested object changes, you need to pass a custom comparison function
export default memo(CodeAccordian)
