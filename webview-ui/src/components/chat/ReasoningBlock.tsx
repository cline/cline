import { useCallback, useEffect, useRef, useState } from "react"
import { CaretDownIcon, CaretUpIcon, CounterClockwiseClockIcon } from "@radix-ui/react-icons"
import { useTranslation } from "react-i18next"

import MarkdownBlock from "../common/MarkdownBlock"
import { useMount } from "react-use"

interface ReasoningBlockProps {
	content: string
	elapsed?: number
	isCollapsed?: boolean
	onToggleCollapse?: () => void
}

export const ReasoningBlock = ({ content, elapsed, isCollapsed = false, onToggleCollapse }: ReasoningBlockProps) => {
	const contentRef = useRef<HTMLDivElement>(null)
	const elapsedRef = useRef<number>(0)
	const { t } = useTranslation("chat")
	const [thought, setThought] = useState<string>()
	const [prevThought, setPrevThought] = useState<string>(t("chat:reasoning.thinking"))
	const [isTransitioning, setIsTransitioning] = useState<boolean>(false)
	const cursorRef = useRef<number>(0)
	const queueRef = useRef<string[]>([])

	useEffect(() => {
		if (contentRef.current && !isCollapsed) {
			contentRef.current.scrollTop = contentRef.current.scrollHeight
		}
	}, [content, isCollapsed])

	useEffect(() => {
		if (elapsed) {
			elapsedRef.current = elapsed
		}
	}, [elapsed])

	// Process the transition queue.
	const processNextTransition = useCallback(() => {
		const nextThought = queueRef.current.pop()
		queueRef.current = []

		if (nextThought) {
			setIsTransitioning(true)
		}

		setTimeout(() => {
			if (nextThought) {
				setPrevThought(nextThought)
				setIsTransitioning(false)
			}

			setTimeout(() => processNextTransition(), 500)
		}, 200)
	}, [])

	useMount(() => {
		processNextTransition()
	})

	useEffect(() => {
		if (content.length - cursorRef.current > 160) {
			setThought("... " + content.slice(cursorRef.current))
			cursorRef.current = content.length
		}
	}, [content])

	useEffect(() => {
		if (thought && thought !== prevThought) {
			queueRef.current.push(thought)
		}
	}, [thought, prevThought])

	return (
		<div className="bg-vscode-editor-background border border-vscode-border rounded-xs overflow-hidden">
			<div
				className="flex items-center justify-between gap-1 px-3 py-2 cursor-pointer text-muted-foreground"
				onClick={onToggleCollapse}>
				<div
					className={`truncate flex-1 transition-opacity duration-200 ${isTransitioning ? "opacity-0" : "opacity-100"}`}>
					{prevThought}
				</div>
				<div className="flex flex-row items-center gap-1">
					{elapsedRef.current > 1000 && (
						<>
							<CounterClockwiseClockIcon className="scale-80" />
							<div>{t("reasoning.seconds", { count: Math.round(elapsedRef.current / 1000) })}</div>
						</>
					)}
					{isCollapsed ? <CaretDownIcon /> : <CaretUpIcon />}
				</div>
			</div>
			{!isCollapsed && (
				<div ref={contentRef} className="px-3 max-h-[160px] overflow-y-auto">
					<MarkdownBlock markdown={content} />
				</div>
			)}
		</div>
	)
}
