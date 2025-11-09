import { CheckCircle2, MessageCircle, PlayCircle } from "lucide-react"
import { memo } from "react"

interface PlanCompletionCardProps {
	planSummary?: string
	onSwitchToActMode?: () => void
	onContinueDiscussing?: () => void
	className?: string
}

/**
 * PlanCompletionCard displays when Cline has completed planning and is ready
 * to switch to Act Mode for implementation. Shows plan summary and action buttons.
 */
export const PlanCompletionCard = memo(
	({ planSummary, onSwitchToActMode, onContinueDiscussing, className = "" }: PlanCompletionCardProps) => {
		const handleSwitchToActMode = () => {
			// Mode switching will be handled by parent component via callback
			onSwitchToActMode?.()
		}

		const handleContinueDiscussing = () => {
			onContinueDiscussing?.()
		}

		return (
			<div
				className={`bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/20 rounded-lg p-4 ${className}`}>
				{/* Header */}
				<div className="flex items-center gap-2 mb-3">
					<CheckCircle2 className="w-5 h-5 text-green-500" strokeWidth={2} />
					<h3 className="text-base font-semibold text-(--vscode-foreground)">Plan Complete!</h3>
				</div>

				{/* Plan Summary */}
				{planSummary && (
					<div className="mb-4">
						<p className="text-sm text-(--vscode-descriptionForeground) leading-relaxed whitespace-pre-wrap">
							{planSummary}
						</p>
					</div>
				)}

				{/* Description */}
				<p className="text-sm text-(--vscode-descriptionForeground) mb-4">
					The plan is ready for implementation. You can switch to Act Mode to begin, or continue discussing to refine
					the plan further.
				</p>

				{/* Action Buttons */}
				<div className="flex flex-col sm:flex-row gap-2">
					{/* Primary Action - Switch to Act Mode */}
					<button
						className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors font-medium text-sm flex-1"
						onClick={handleSwitchToActMode}>
						<PlayCircle className="w-4 h-4" />
						<span>Switch to Act Mode</span>
					</button>

					{/* Secondary Action - Continue Discussing */}
					<button
						className="flex items-center justify-center gap-2 px-4 py-2 bg-(--vscode-button-secondaryBackground) hover:bg-(--vscode-button-secondaryHoverBackground) text-(--vscode-button-secondaryForeground) rounded-md transition-colors font-medium text-sm flex-1"
						onClick={handleContinueDiscussing}>
						<MessageCircle className="w-4 h-4" />
						<span>Continue Discussing</span>
					</button>
				</div>

				{/* Helper Text */}
				<div className="mt-3 pt-3 border-t border-(--vscode-widget-border)">
					<p className="text-xs text-(--vscode-descriptionForeground)">
						💡 <strong>Tip:</strong> In Act Mode, Cline will silently implement the plan using tools. Discuss Mode
						will automatically disable.
					</p>
				</div>
			</div>
		)
	},
)

PlanCompletionCard.displayName = "PlanCompletionCard"
