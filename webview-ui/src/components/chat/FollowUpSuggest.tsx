import { useCallback } from "react"
import { cn } from "../../lib/utils"
import { Button } from "../ui/button"

interface FollowUpSuggestProps {
	suggestions?: string[]
	onSuggestionClick?: (answer: string) => void
	ts: number
}

const FollowUpSuggest = ({ suggestions = [], onSuggestionClick, ts = 1 }: FollowUpSuggestProps) => {
	const handleSuggestionClick = useCallback(
		(suggestion: string) => {
			onSuggestionClick?.(suggestion)
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
						<div key={`${suggestion}-${ts}`} className="w-full">
							<Button
								variant="outline"
								className="w-full text-left whitespace-normal break-words h-auto min-h-[28px] py-2 justify-start"
								onClick={() => handleSuggestionClick(suggestion)}
								aria-label={suggestion}>
								<span className="text-left">{suggestion}</span>
							</Button>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

export default FollowUpSuggest
