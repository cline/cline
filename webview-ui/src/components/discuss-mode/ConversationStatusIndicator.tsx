import { MessageSquare, Mic, Volume2 } from "lucide-react"
import { memo } from "react"

export type ConversationState = "idle" | "listening" | "thinking" | "speaking"

interface ConversationStatusIndicatorProps {
	state: ConversationState
	className?: string
}

/**
 * ConversationStatusIndicator displays the current state of the voice conversation
 * with animated visual feedback for Listening, Thinking, and Speaking states.
 */
export const ConversationStatusIndicator = memo(({ state, className = "" }: ConversationStatusIndicatorProps) => {
	// Don't render anything in idle state
	if (state === "idle") {
		return null
	}

	const getStateConfig = () => {
		switch (state) {
			case "listening":
				return {
					icon: Mic,
					text: "Listening...",
					bgColor: "bg-blue-500/10",
					textColor: "text-blue-500",
					iconColor: "text-blue-500",
					pulseColor: "bg-blue-500",
				}
			case "thinking":
				return {
					icon: MessageSquare,
					text: "Thinking...",
					bgColor: "bg-purple-500/10",
					textColor: "text-purple-500",
					iconColor: "text-purple-500",
					pulseColor: "bg-purple-500",
				}
			case "speaking":
				return {
					icon: Volume2,
					text: "Speaking...",
					bgColor: "bg-green-500/10",
					textColor: "text-green-500",
					iconColor: "text-green-500",
					pulseColor: "bg-green-500",
				}
		}
	}

	const config = getStateConfig()
	const Icon = config.icon

	return (
		<div
			className={`flex items-center gap-2 px-3 py-2 rounded-lg ${config.bgColor} transition-all duration-300 ${className}`}>
			{/* Animated Icon */}
			<div className="relative">
				<Icon className={`w-4 h-4 ${config.iconColor}`} strokeWidth={2} />

				{/* Pulse animation */}
				<span className="absolute inset-0 flex items-center justify-center">
					<span
						className={`absolute w-4 h-4 rounded-full ${config.pulseColor} opacity-75 animate-ping`}
						style={{
							animationDuration: state === "speaking" ? "1.5s" : "2s",
						}}
					/>
				</span>
			</div>

			{/* Status Text */}
			<span className={`text-sm font-medium ${config.textColor}`}>{config.text}</span>

			{/* Visual Indicator - Wave animation for speaking/listening */}
			{(state === "speaking" || state === "listening") && (
				<div className="flex items-center gap-0.5 ml-1">
					{[0, 1, 2].map((i) => (
						<div
							className={`w-0.5 rounded-full ${config.pulseColor}`}
							key={i}
							style={{
								height: "12px",
								animation: `wave 1s ease-in-out ${i * 0.1}s infinite`,
							}}
						/>
					))}
				</div>
			)}

			{/* Spinner for thinking */}
			{state === "thinking" && (
				<div className="ml-1">
					<div
						className={`w-3 h-3 border-2 border-t-transparent rounded-full ${config.iconColor} animate-spin`}
						style={{ borderColor: `currentColor transparent transparent transparent` }}
					/>
				</div>
			)}

			<style>{`
				@keyframes wave {
					0%, 100% {
						height: 8px;
					}
					50% {
						height: 16px;
					}
				}
			`}</style>
		</div>
	)
})

ConversationStatusIndicator.displayName = "ConversationStatusIndicator"
