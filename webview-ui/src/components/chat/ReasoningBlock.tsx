import React, { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import MarkdownBlock from "../common/MarkdownBlock"
import { Lightbulb } from "lucide-react"

interface ReasoningBlockProps {
	content: string
	ts: number
	isStreaming: boolean
	isLast: boolean
	metadata?: any
}

/**
 * Render reasoning with a heading and a simple timer.
 * - Heading uses i18n key chat:reasoning.thinking
 * - Timer runs while reasoning is active (no persistence)
 */
export const ReasoningBlock = ({ content, isStreaming, isLast }: ReasoningBlockProps) => {
	const { t } = useTranslation()

	const startTimeRef = useRef<number>(Date.now())
	const [elapsed, setElapsed] = useState<number>(0)

	// Simple timer that runs while streaming
	useEffect(() => {
		if (isLast && isStreaming) {
			const tick = () => setElapsed(Date.now() - startTimeRef.current)
			tick()
			const id = setInterval(tick, 1000)
			return () => clearInterval(id)
		}
	}, [isLast, isStreaming])

	const seconds = Math.floor(elapsed / 1000)
	const secondsLabel = t("chat:reasoning.seconds", { count: seconds })

	return (
		<div>
			<div className="flex items-center justify-between mb-2.5 pr-2">
				<div className="flex items-center gap-2">
					<Lightbulb className="w-4" />
					<span className="font-bold text-vscode-foreground">{t("chat:reasoning.thinking")}</span>
				</div>
				{elapsed > 0 && (
					<span className="text-sm text-vscode-descriptionForeground tabular-nums flex items-center gap-1">
						{secondsLabel}
					</span>
				)}
			</div>
			{(content?.trim()?.length ?? 0) > 0 && (
				<div className="border-l border-vscode-descriptionForeground/20 ml-2 pl-4 pb-1 text-vscode-descriptionForeground">
					<MarkdownBlock markdown={content} />
				</div>
			)}
		</div>
	)
}
