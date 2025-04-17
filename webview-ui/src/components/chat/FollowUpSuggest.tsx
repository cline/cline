import { useCallback } from "react"
import { ArrowRight, Edit } from "lucide-react"

import { Button } from "@/components/ui"

import { useAppTranslation } from "../../i18n/TranslationContext"

interface FollowUpSuggestProps {
	suggestions?: string[]
	onSuggestionClick?: (answer: string, event?: React.MouseEvent) => void
	ts: number
}

export const FollowUpSuggest = ({ suggestions = [], onSuggestionClick, ts = 1 }: FollowUpSuggestProps) => {
	const { t } = useAppTranslation()
	const handleSuggestionClick = useCallback(
		(suggestion: string, event: React.MouseEvent) => {
			onSuggestionClick?.(suggestion, event)
		},
		[onSuggestionClick],
	)

	// Don't render if there are no suggestions or no click handler.
	if (!suggestions?.length || !onSuggestionClick) {
		return null
	}

	return (
		<div className="flex mb-2 flex-col h-full border rounded-xs">
			{suggestions.map((suggestion) => (
				<div key={`${suggestion}-${ts}`} className="w-full relative group">
					<Button
						variant="ghost"
						className="text-left whitespace-normal break-words w-full h-auto py-3 justify-start pr-8"
						onClick={(event) => handleSuggestionClick(suggestion, event)}
						aria-label={suggestion}>
						<div className="flex flex-row items-center gap-2">
							<ArrowRight />
							<div>{suggestion}</div>
						</div>
					</Button>
					<div
						className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
						onClick={(e) => {
							e.stopPropagation()
							// Simulate shift-click by directly calling the handler with shiftKey=true.
							onSuggestionClick?.(suggestion, { ...e, shiftKey: true })
						}}
						title={t("chat:followUpSuggest.copyToInput")}>
						<Button variant="ghost" size="icon">
							<Edit />
						</Button>
					</div>
				</div>
			))}
		</div>
	)
}
