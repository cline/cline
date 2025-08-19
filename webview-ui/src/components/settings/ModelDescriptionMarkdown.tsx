import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useRef, useState } from "react"
import { useRemark } from "react-remark"

import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleTrigger } from "@/components/ui"

import { StyledMarkdown } from "./styles"

export const ModelDescriptionMarkdown = memo(
	({
		markdown = "",
		key,
		isExpanded,
		setIsExpanded,
	}: {
		markdown?: string
		key: string
		isExpanded: boolean
		setIsExpanded: (isExpanded: boolean) => void
	}) => {
		const [content, setContent] = useRemark()
		const [isExpandable, setIsExpandable] = useState(false)
		const textContainerRef = useRef<HTMLDivElement>(null)
		const textRef = useRef<HTMLDivElement>(null)

		useEffect(() => setContent(markdown), [markdown, setContent])

		useEffect(() => {
			if (textRef.current && textContainerRef.current) {
				setIsExpandable(textRef.current.scrollHeight > textContainerRef.current.clientHeight)
			}
		}, [content])

		return (
			<Collapsible open={isExpanded} onOpenChange={setIsExpanded} className="relative">
				<div ref={textContainerRef} className={cn({ "line-clamp-4": !isExpanded })}>
					<div ref={textRef}>
						<StyledMarkdown key={key}>{content}</StyledMarkdown>
					</div>
				</div>
				<CollapsibleTrigger asChild className={cn({ hidden: !isExpandable })}>
					<VSCodeLink className="text-sm">{isExpanded ? "Less" : "More"}</VSCodeLink>
				</CollapsibleTrigger>
			</Collapsible>
		)
	},
)
