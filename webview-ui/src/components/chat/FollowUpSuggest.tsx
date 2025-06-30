import { useCallback, useEffect, useState } from "react"
import { Edit } from "lucide-react"

import { Button, StandardTooltip } from "@/components/ui"
import { vscode } from "@/utils/vscode"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"

interface SuggestionItem {
	answer: string
	mode?: string
}

interface FollowUpSuggestProps {
	suggestions?: (string | SuggestionItem)[]
	onSuggestionClick?: (answer: string, event?: React.MouseEvent) => void
	ts: number
}

export const FollowUpSuggest = ({ suggestions = [], onSuggestionClick, ts = 1 }: FollowUpSuggestProps) => {
	const { autoApprovalEnabled, alwaysAllowFollowupQuestions, followupAutoApproveTimeoutMs } = useExtensionState()
	const [countdown, setCountdown] = useState<number | null>(null)
	const [suggestionSelected, setSuggestionSelected] = useState(false)
	const { t } = useAppTranslation()

	// Start countdown timer when auto-approval is enabled for follow-up questions
	useEffect(() => {
		// Only start countdown if auto-approval is enabled for follow-up questions and no suggestion has been selected
		if (autoApprovalEnabled && alwaysAllowFollowupQuestions && suggestions.length > 0 && !suggestionSelected) {
			// Start with the configured timeout in seconds
			const timeoutMs =
				typeof followupAutoApproveTimeoutMs === "number" && !isNaN(followupAutoApproveTimeoutMs)
					? followupAutoApproveTimeoutMs
					: 10000

			// Convert milliseconds to seconds for the countdown
			setCountdown(Math.floor(timeoutMs / 1000))

			// Update countdown every second
			const intervalId = setInterval(() => {
				setCountdown((prevCountdown) => {
					if (prevCountdown === null || prevCountdown <= 1) {
						clearInterval(intervalId)
						return null
					}
					return prevCountdown - 1
				})
			}, 1000)

			// Clean up interval on unmount
			return () => clearInterval(intervalId)
		} else {
			setCountdown(null)
		}
	}, [
		autoApprovalEnabled,
		alwaysAllowFollowupQuestions,
		suggestions,
		followupAutoApproveTimeoutMs,
		suggestionSelected,
	])
	const handleSuggestionClick = useCallback(
		(suggestion: string | SuggestionItem, event: React.MouseEvent) => {
			const suggestionText = typeof suggestion === "string" ? suggestion : suggestion.answer
			const mode = typeof suggestion === "object" ? suggestion.mode : undefined

			// If there's a mode switch and it's not a shift-click (which just copies to input), switch modes first
			if (mode && !event.shiftKey) {
				vscode.postMessage({
					type: "mode",
					text: mode,
				})
			}

			// Mark a suggestion as selected if it's not a shift-click (which just copies to input)
			if (!event.shiftKey) {
				setSuggestionSelected(true)
			}

			onSuggestionClick?.(suggestionText, event)
		},
		[onSuggestionClick],
	)

	// Don't render if there are no suggestions or no click handler.
	if (!suggestions?.length || !onSuggestionClick) {
		return null
	}

	return (
		<div className="flex mb-2 flex-col h-full gap-2">
			{suggestions.map((suggestion, index) => {
				const suggestionText = typeof suggestion === "string" ? suggestion : suggestion.answer
				const mode = typeof suggestion === "object" ? suggestion.mode : undefined
				const isFirstSuggestion = index === 0

				return (
					<div key={`${suggestionText}-${ts}`} className="w-full relative group">
						<Button
							variant="outline"
							className="text-left whitespace-normal break-words w-full h-auto py-3 justify-start pr-8"
							onClick={(event) => handleSuggestionClick(suggestion, event)}
							aria-label={suggestionText}>
							{suggestionText}
							{isFirstSuggestion && countdown !== null && !suggestionSelected && (
								<span
									className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-vscode-badge-background text-vscode-badge-foreground"
									title={t("chat:followUpSuggest.autoSelectCountdown", { count: countdown })}>
									{countdown}s
								</span>
							)}
						</Button>
						{mode && (
							<div className="absolute bottom-0 right-0 text-[10px] bg-vscode-badge-background text-vscode-badge-foreground px-1 py-0.5 border border-vscode-badge-background flex items-center gap-0.5">
								<span className="codicon codicon-arrow-right" style={{ fontSize: "8px" }} />
								{mode}
							</div>
						)}
						<StandardTooltip content={t("chat:followUpSuggest.copyToInput")}>
							<div
								className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
								onClick={(e) => {
									e.stopPropagation()
									// Simulate shift-click by directly calling the handler with shiftKey=true.
									onSuggestionClick?.(suggestionText, { ...e, shiftKey: true })
								}}>
								<Button variant="ghost" size="icon">
									<Edit />
								</Button>
							</div>
						</StandardTooltip>
					</div>
				)
			})}
		</div>
	)
}
