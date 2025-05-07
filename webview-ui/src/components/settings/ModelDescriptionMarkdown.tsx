import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import React, { memo, useEffect, useRef, useState, FC, PropsWithChildren } from "react" // Added React, FC, PropsWithChildren
import { useRemark } from "react-remark"

import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleTrigger } from "@/components/ui"

// Removed import { StyledMarkdown } from "./styles"

// Moved StyledMarkdown component definition here
interface StyledMarkdownProps extends React.HTMLAttributes<HTMLDivElement> {}

const StyledMarkdown: FC<PropsWithChildren<StyledMarkdownProps>> = ({ className, children, ...props }) => {
	return (
		<div
			className={cn(
				"font-vscode-font-family text-xs text-vscode-descriptionForeground",
				"[&_p]:leading-tight [&_p]:m-0 [&_p]:whitespace-pre-wrap",
				"[&_li]:leading-tight [&_li]:m-0",
				"[&_ol]:leading-tight [&_ol]:m-0 [&_ol]:pl-[1.5em] [&_ol]:ml-0",
				"[&_ul]:leading-tight [&_ul]:m-0 [&_ul]:pl-[1.5em] [&_ul]:ml-0",
				"[&_a]:no-underline hover:[&_a]:underline",
				className,
			)}
			{...props}>
			{children}
		</div>
	)
}

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
				<div ref={textContainerRef} className={cn({ "line-clamp-3": !isExpanded })}>
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
