import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useMemo } from "react"
import CodeBlock from "@/components/common/CodeBlock"
import { cn } from "@/lib/utils"
import { getLanguageFromPath } from "@/utils/getLanguageFromPath"
import { Button } from "../ui/button"

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
		<div className="bg-code overflow-hidden rounded-xs border border-editor-group-border">
			{(path || isFeedback || isConsoleLogs) && (
				<Button
					aria-label={isExpanded ? "Collapse code block" : "Expand code block"}
					className={cn("text-description flex items-center cursor-pointer select-none w-full py-[9px] px-2.5", {
						"cursor-wait opacity-70": isLoading,
					})}
					onClick={isLoading ? undefined : onToggleExpand}
					onKeyDown={(e) => {
						if (!isLoading) {
							e.preventDefault()
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation()
								onToggleExpand()
							}
						}
					}}
					tabIndex={0}
					variant="text">
					{isFeedback || isConsoleLogs ? (
						<div className="flex items-center">
							<span className={`mr-1.5 codicon codicon-${isFeedback ? "feedback" : "output"}`} />
							<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2">
								{isFeedback ? "User Edits" : "Console Logs"}
							</span>
						</div>
					) : (
						<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2 [direction: rtl] text-left">
							{path?.startsWith(".") && <span>.</span>}
							{path && !path.startsWith(".") && <span>/</span>}
							{cleanPathPrefix(path ?? "") + "\u200E"}
						</span>
					)}
					<div className="grow" />
					{numberOfEdits !== undefined && (
						<div className="flex items-center mr-2 text-description">
							<span className="codicon codicon-diff-single mr-1" />
							<span>{numberOfEdits}</span>
						</div>
					)}
					{isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
				</Button>
			)}
			{(!(path || isFeedback || isConsoleLogs) || isExpanded) && (
				<div className="overflow-x-auto overflow-y-hidden max-w-full">
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
