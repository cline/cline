import { useCallback } from "react"
import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import { Edit } from "lucide-react"
import { useAppTranslation } from "../../i18n/TranslationContext"

interface FollowUpSuggestProps {
	suggestions?: string[]
	onSuggestionClick?: (answer: string, event?: React.MouseEvent) => void
	ts: number
}

const FollowUpSuggest = ({ suggestions = [], onSuggestionClick, ts = 1 }: FollowUpSuggestProps) => {
	const { t } = useAppTranslation()
	const handleSuggestionClick = useCallback(
		(suggestion: string, event: React.MouseEvent) => {
			onSuggestionClick?.(suggestion, event)
		},
		[onSuggestionClick],
	)

	// Don't render if there are no suggestions or no click handler
	if (!suggestions?.length || !onSuggestionClick) {
		return null
	}

	return (
		<div className="h-full">
			<div className="h-full scrollbar-thin scrollbar-thumb-vscode-scrollbarSlider-background scrollbar-track-transparent">
				<div className={cn("flex gap-2.5 pb-2 flex-col h-full")}>
					{suggestions.map((suggestion) => (
						<div key={`${suggestion}-${ts}`} className="w-full relative group">
							<Button
								variant="secondary"
								className="w-full text-left whitespace-normal break-words h-auto min-h-[28px] py-2 justify-start pr-8"
								onClick={(event) => handleSuggestionClick(suggestion, event)}
								aria-label={suggestion}>
								<span className="text-left">{suggestion}</span>
							</Button>
							<div
								className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
								onClick={(e) => {
									e.stopPropagation()
									// Simulate shift-click by directly calling the handler with shiftKey=true
									onSuggestionClick?.(suggestion, { ...e, shiftKey: true })
								}}
								title={t("chat:followUpSuggest.copyToInput")}>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 p-1 hover:bg-vscode-button-hoverBackground">
									<Edit className="h-4 w-4" />
								</Button>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

export default FollowUpSuggest
