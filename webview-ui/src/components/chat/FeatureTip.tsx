import { LightbulbIcon } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface FeatureTipItem {
	text: string
}

const FEATURE_TIPS: FeatureTipItem[] = [
	{
		text: 'Enable "Double-Check Completion" in settings to have Cline verify its work before finishing a task.',
	},
	{
		text: "Add a .clinerules file to your project root to give Cline project-specific instructions.",
	},
	{
		text: "Switch to Plan Mode to discuss and plan an approach before Cline takes action.",
	},
	{
		text: "Use @ in the chat input to add files, folders, or URLs as context for your task.",
	},
	{
		text: "Set up MCP Servers to give Cline access to external tools and APIs.",
	},
	{
		text: "Cline creates checkpoints after changes — you can always restore to a previous state.",
	},
	{
		text: "Use /compact to condense long conversations and free up context window space.",
	},
	{
		text: "Enable auto-approve for read-only tools like file reads to speed up exploration.",
	},
	{
		text: "Use the quote button to select text from Cline's response and reference it in your reply.",
	},
	{
		text: "You can drag and drop images into the chat to share screenshots with Cline.",
	},
	{
		text: "Cline can browse websites — ask it to test your local dev server in the browser.",
	},
	{
		text: "Use /reportbug to quickly file a GitHub issue with diagnostic context included.",
	},
]

const SHOW_DELAY_MS = 2000
const CYCLE_INTERVAL_MS = 8000
const FADE_DURATION_MS = 300

/**
 * Shows rotating feature tips below the "Thinking..." indicator.
 * Appears after a brief delay and cycles through tips while Cline is thinking.
 */
export const FeatureTip = memo(() => {
	const [isVisible, setIsVisible] = useState(false)
	const [isFading, setIsFading] = useState(false)
	const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * FEATURE_TIPS.length))
	const cycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const currentTip = useMemo(() => FEATURE_TIPS[tipIndex], [tipIndex])

	const advanceTip = useCallback(() => {
		setIsFading(true)
		fadeTimerRef.current = setTimeout(() => {
			setTipIndex((prev) => (prev + 1) % FEATURE_TIPS.length)
			setIsFading(false)
		}, FADE_DURATION_MS)
	}, [])

	// Delayed appearance + cycling
	useEffect(() => {
		showTimerRef.current = setTimeout(() => {
			setIsVisible(true)
			cycleTimerRef.current = setInterval(advanceTip, CYCLE_INTERVAL_MS)
		}, SHOW_DELAY_MS)

		return () => {
			if (showTimerRef.current) {
				clearTimeout(showTimerRef.current)
			}
			if (cycleTimerRef.current) {
				clearInterval(cycleTimerRef.current)
			}
			if (fadeTimerRef.current) {
				clearTimeout(fadeTimerRef.current)
			}
		}
	}, [advanceTip])

	if (!isVisible) {
		return null
	}

	return (
		<div
			className={cn(
				"flex items-start gap-1.5 mt-2 ml-1 transition-opacity duration-300",
				isFading ? "opacity-0" : "opacity-100",
			)}>
			<LightbulbIcon className="size-3 text-description shrink-0 mt-[1px]" />
			<span className="text-xs text-description leading-relaxed">
				<span className="font-medium">Tip:</span> {currentTip.text}
			</span>
		</div>
	)
})

FeatureTip.displayName = "FeatureTip"
