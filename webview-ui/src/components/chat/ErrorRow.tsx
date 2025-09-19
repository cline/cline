import React, { useState, useCallback, memo } from "react"
import { useTranslation } from "react-i18next"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { MessageCircleWarning } from "lucide-react"
import { useCopyToClipboard } from "@src/utils/clipboard"
import CodeBlock from "../common/CodeBlock"

export interface ErrorRowProps {
	type: "error" | "mistake_limit" | "api_failure" | "diff_error" | "streaming_failed" | "cancelled"
	title?: string
	message: string
	showCopyButton?: boolean
	expandable?: boolean
	defaultExpanded?: boolean
	additionalContent?: React.ReactNode
	headerClassName?: string
	messageClassName?: string
}

/**
 * Unified error display component for all error types in the chat
 */
export const ErrorRow = memo(
	({
		type,
		title,
		message,
		showCopyButton = false,
		expandable = false,
		defaultExpanded = false,
		additionalContent,
		headerClassName,
		messageClassName,
	}: ErrorRowProps) => {
		const { t } = useTranslation()
		const [isExpanded, setIsExpanded] = useState(defaultExpanded)
		const [showCopySuccess, setShowCopySuccess] = useState(false)
		const { copyWithFeedback } = useCopyToClipboard()

		// Default titles for different error types
		const getDefaultTitle = () => {
			if (title) return title

			switch (type) {
				case "error":
					return t("chat:error")
				case "mistake_limit":
					return t("chat:troubleMessage")
				case "api_failure":
					return t("chat:apiRequest.failed")
				case "streaming_failed":
					return t("chat:apiRequest.streamingFailed")
				case "cancelled":
					return t("chat:apiRequest.cancelled")
				case "diff_error":
					return t("chat:diffError.title")
				default:
					return null
			}
		}

		const handleToggleExpand = useCallback(() => {
			if (expandable) {
				setIsExpanded(!isExpanded)
			}
		}, [expandable, isExpanded])

		const handleCopy = useCallback(
			async (e: React.MouseEvent) => {
				e.stopPropagation()
				const success = await copyWithFeedback(message)
				if (success) {
					setShowCopySuccess(true)
					setTimeout(() => {
						setShowCopySuccess(false)
					}, 1000)
				}
			},
			[message, copyWithFeedback],
		)

		const errorTitle = getDefaultTitle()

		// For diff_error type with expandable content
		if (type === "diff_error" && expandable) {
			return (
				<div className="mt-0 overflow-hidden mb-2">
					<div
						className={`font-normal text-vscode-editor-foreground flex items-center justify-between cursor-pointer ${
							isExpanded ? "border-b border-vscode-editorGroup-border" : ""
						}`}
						onClick={handleToggleExpand}>
						<div className="flex items-center gap-2 flex-grow">
							<MessageCircleWarning className="w-4 text-vscode-errorForeground" />
							<span className="font-bold">{errorTitle}</span>
						</div>
						<div className="flex items-center">
							{showCopyButton && (
								<VSCodeButton
									appearance="icon"
									className="p-0.75 h-6 mr-1 text-vscode-editor-foreground flex items-center justify-center bg-transparent"
									onClick={handleCopy}>
									<span className={`codicon codicon-${showCopySuccess ? "check" : "copy"}`} />
								</VSCodeButton>
							)}
							<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`} />
						</div>
					</div>
					{isExpanded && (
						<div className="p-2 bg-vscode-editor-background border-t-0">
							<CodeBlock source={message} language="xml" />
						</div>
					)}
				</div>
			)
		}

		// Standard error display
		return (
			<>
				{errorTitle && (
					<div className={headerClassName || "flex items-center gap-2 break-words"}>
						<MessageCircleWarning className="w-4 text-vscode-errorForeground" />
						<span className="text-vscode-errorForeground font-bold">{errorTitle}</span>
					</div>
				)}
				<p
					className={
						messageClassName || "ml-6 my-0 whitespace-pre-wrap break-words text-vscode-errorForeground"
					}>
					{message}
				</p>
				{additionalContent}
			</>
		)
	},
)

export default ErrorRow
