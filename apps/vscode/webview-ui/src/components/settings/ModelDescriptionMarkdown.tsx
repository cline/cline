import { memo, useEffect, useRef, useState } from "react"
import { useRemark } from "react-remark"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ModelDescriptionMarkdownProps {
	markdown?: string
	key: string
	isPopup?: boolean
}

export const ModelDescriptionMarkdown = memo(({ markdown, key, isPopup }: ModelDescriptionMarkdownProps) => {
	// Update the markdown content when the prop changes
	const [reactContent, setMarkdown] = useRemark()
	const contentRef = useRef<HTMLDivElement>(null)
	const [isTruncated, setIsTruncated] = useState(false)
	const [isExpanded, setIsExpanded] = useState(false)

	useEffect(() => {
		if (markdown) {
			setIsExpanded(false)
			setMarkdown(markdown)
		}
	}, [markdown, setMarkdown])

	useEffect(() => {
		if (contentRef.current && !isExpanded) {
			const element = contentRef.current
			// Check if content is truncated by comparing scrollHeight with clientHeight
			setIsTruncated(element.scrollHeight > element.clientHeight)
		}
	}, [reactContent, isExpanded])

	return (
		<div className="inline-block mb-2 description line-clamp-3" key={key}>
			<div className="relative wrap-anywhere overflow-y-hidden">
				<div
					className={cn("overflow-hidden text-sm line-clamp-3", {
						"line-clamp-none": isExpanded,
						"max-h-19": !isExpanded,
					})}
					ref={contentRef}>
					{reactContent}
				</div>
				{isTruncated && (
					<div className="absolute bottom-0 right-0 flex items-center">
						<div className="w-10 h-5 bg-linear-to-r from-transparent to-sidebar-background" />
						<Button
							className={cn("bg-sidebar-background p-0 m-0 text-sm cursor-pointer", {
								"bg-code-block-background": isPopup,
							})}
							onClick={() => setIsExpanded(!isExpanded)}
							variant="link">
							{isExpanded ? "See less" : "See more"}
						</Button>
					</div>
				)}
			</div>
		</div>
	)
})
ModelDescriptionMarkdown.displayName = "ModelDescriptionMarkdown"
