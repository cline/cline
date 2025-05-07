import { memo, useMemo } from "react"
import { getLanguageFromPath } from "@src/utils/getLanguageFromPath"
import { cn } from "@/lib/utils"
import CodeBlock from "./CodeBlock"
import { ToolProgressStatus } from "@roo/shared/ExtensionMessage"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"

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
		<div className="rounded-[3px] overflow-hidden border border-vscode-editorGroup-border bg-vscode-code-block-background">
			{(path || isFeedback || isConsoleLogs) && (
				<div
					className={cn(
						"text-vscode-descriptionForeground flex items-center p-[9px_10px] select-none",
						isLoading ? "cursor-wait opacity-70 animate-pulse" : "cursor-pointer opacity-100",
					)}
					onClick={isLoading ? undefined : onToggleExpand}>
					{isLoading && <VSCodeProgressRing className="size-3 mr-2" />}
					{isFeedback || isConsoleLogs ? (
						<div className="flex items-center">
							<span className={`codicon codicon-${isFeedback ? "feedback" : "output"} mr-[6px]`}></span>
							<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2">
								{isFeedback ? "User Edits" : "Console Logs"}
							</span>
						</div>
					) : (
						<>
							{path?.startsWith(".") && <span>.</span>}
							<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2 rtl text-left">
								{removeLeadingNonAlphanumeric(path ?? "") + "\u200E"}
							</span>
						</>
					)}
					<div className="flex-grow"></div>
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
				<div className="overflow-x-auto overflow-y-hidden max-w-full">
					<CodeBlock
						source={(code ?? diff ?? "").trim()}
						language={diff !== undefined ? "diff" : inferredLanguage}
					/>
				</div>
			)}
		</div>
	)
}

// memo does shallow comparison of props, so if you need it to re-render when a nested object changes, you need to pass a custom comparison function
export default memo(CodeAccordian)
