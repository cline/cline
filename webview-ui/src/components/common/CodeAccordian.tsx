import { memo, useMemo } from "react"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"

import type { ToolProgressStatus } from "@roo-code/types"

import { getLanguageFromPath } from "@src/utils/getLanguageFromPath"
import { removeLeadingNonAlphanumeric } from "@src/utils/removeLeadingNonAlphanumeric"

import { ToolUseBlock, ToolUseBlockHeader } from "./ToolUseBlock"
import CodeBlock from "./CodeBlock"

interface CodeAccordianProps {
	path?: string
	code?: string
	language: string
	progressStatus?: ToolProgressStatus
	isLoading?: boolean
	isExpanded: boolean
	isFeedback?: boolean
	onToggleExpand: () => void
}

const CodeAccordian = ({
	path,
	code = "",
	language,
	progressStatus,
	isLoading,
	isExpanded,
	isFeedback,
	onToggleExpand,
}: CodeAccordianProps) => {
	const inferredLanguage = useMemo(() => language ?? (path ? getLanguageFromPath(path) : "txt"), [path, language])
	const source = useMemo(() => code.trim(), [code])
	const hasHeader = Boolean(path || isFeedback)

	return (
		<ToolUseBlock>
			{hasHeader && (
				<ToolUseBlockHeader onClick={onToggleExpand}>
					{isLoading && <VSCodeProgressRing className="size-3 mr-2" />}
					{isFeedback ? (
						<div className="flex items-center">
							<span className={`codicon codicon-${isFeedback ? "feedback" : "codicon-output"} mr-1.5`} />
							<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2 rtl">
								{isFeedback ? "User Edits" : "Console Logs"}
							</span>
						</div>
					) : (
						<>
							{path?.startsWith(".") && <span>.</span>}
							<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
								{removeLeadingNonAlphanumeric(path ?? "") + "\u200E"}
							</span>
						</>
					)}
					<div className="flex-grow-1" />
					{progressStatus && progressStatus.text && (
						<>
							{progressStatus.icon && <span className={`codicon codicon-${progressStatus.icon} mr-1`} />}
							<span className="mr-1 ml-auto text-vscode-descriptionForeground">
								{progressStatus.text}
							</span>
						</>
					)}
					<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
				</ToolUseBlockHeader>
			)}
			{(!hasHeader || isExpanded) && (
				<div className="overflow-x-auto overflow-y-hidden max-w-full">
					<CodeBlock source={source} language={inferredLanguage} />
				</div>
			)}
		</ToolUseBlock>
	)
}

// Memo does shallow comparison of props, so if you need it to re-render when a
// nested object changes, you need to pass a custom comparison function.
export default memo(CodeAccordian)
