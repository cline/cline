import { memo, useMemo } from "react"
import { getLanguageFromPath } from "../utils/getLanguageFromPath"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "./CodeBlock"

interface CodeAccordianProps {
	code?: string
	diff?: string
	language?: string | undefined
	path?: string
	isFeedback?: boolean
	isExpanded: boolean
	onToggleExpand: () => void
}

/*
We need to remove leading non-alphanumeric characters from the path in order for our leading ellipses trick to work.
^: Anchors the match to the start of the string.
[^a-zA-Z0-9]+: Matches one or more characters that are not alphanumeric.
The replace method removes these matched characters, effectively trimming the string up to the first alphanumeric character.
*/
export const removeLeadingNonAlphanumeric = (path: string): string => path.replace(/^[^a-zA-Z0-9]+/, "")

const CodeAccordian = ({ code, diff, language, path, isFeedback, isExpanded, onToggleExpand }: CodeAccordianProps) => {
	const inferredLanguage = useMemo(
		() => code && (language ?? (path ? getLanguageFromPath(path) : undefined)),
		[path, language, code]
	)

	return (
		<div
			style={{
				borderRadius: 3,
				backgroundColor: CODE_BLOCK_BG_COLOR,
				overflow: "hidden", // This ensures the inner scrollable area doesn't overflow the rounded corners
				border: "1px solid var(--vscode-editorGroup-border)",
			}}>
			{(path || isFeedback) && (
				<div
					style={{
						color: "var(--vscode-descriptionForeground)",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "9px 10px",
						cursor: "pointer",
						userSelect: "none",
						WebkitUserSelect: "none",
						MozUserSelect: "none",
						msUserSelect: "none",
					}}
					onClick={onToggleExpand}>
					{isFeedback && <span className="codicon codicon-feedback" style={{ marginRight: "6px" }}></span>}
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
						{isFeedback ? "User Edits" : removeLeadingNonAlphanumeric(path ?? "") + "\u200E"}
					</span>
					<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
				</div>
			)}
			{(!(path || isFeedback) || isExpanded) && (
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
