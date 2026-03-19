/**
 * Rotating feature tips shown during thinking/acting phases.
 * Appears after a brief delay and cycles through tips to educate users
 * about Cline features while they wait.
 */

import { Box, Text } from "ink"
import React, { useCallback, useEffect, useRef, useState } from "react"

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
		text: "Press Tab to switch between Plan and Act mode — plan an approach before Cline takes action.",
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
		text: "Use /settings to configure your API provider and model without leaving the terminal.",
	},
	{
		text: "You can pass images with --images flag or paste image file paths in the chat.",
	},
	{
		text: "Cline can browse websites — ask it to test your local dev server in the browser.",
	},
	{
		text: "Use /reportbug to quickly file a GitHub issue with diagnostic context included.",
	},
	{
		text: "Try 'npx kanban' to manage tasks on a Kanban board — orchestrate coding agents across worktrees.",
	},
	{
		text: "Use Shift+Tab to toggle auto-approve all — let Cline work uninterrupted on trusted tasks.",
	},
	{
		text: "Press Up/Down arrows in an empty input to browse your previous task prompts.",
	},
	{
		text: "Type / to see all available commands — /history, /compact, /settings, and more.",
	},
	{
		text: "Use /skills to browse and attach reusable skill files that guide Cline's behavior.",
	},
]

const SHOW_DELAY_MS = 2000
const CYCLE_INTERVAL_MS = 8000

/**
 * Shows rotating feature tips below the thinking indicator.
 * Appears after a brief delay and cycles through tips while Cline is thinking/acting.
 */
export const FeatureTip: React.FC = () => {
	const [isVisible, setIsVisible] = useState(false)
export const FeatureTip: React.FC = React.memo(() => {
	const cycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const currentTip = FEATURE_TIPS[tipIndex]

	const advanceTip = useCallback(() => {
		setTipIndex((prev) => (prev + 1) % FEATURE_TIPS.length)
	}, [])

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
		}
	}, [advanceTip])

	if (!isVisible) {
		return null
	}

	return (
		<Box paddingLeft={1}>
			<Text color="gray">
				💡 <Text bold>Tip:</Text> {currentTip.text}
			</Text>
		</Box>
	)
}
