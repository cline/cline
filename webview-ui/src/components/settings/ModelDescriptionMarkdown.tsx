import { memo, useEffect } from "react"
import { useRemark } from "react-remark"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ModelDescriptionMarkdownProps {
	markdown?: string
	key: string
	isExpanded: boolean
	setIsExpanded: (isExpanded: boolean) => void
	isPopup?: boolean
}

export const ModelDescriptionMarkdown = memo(
	({ markdown, key, isExpanded, setIsExpanded, isPopup }: ModelDescriptionMarkdownProps) => {
		// Update the markdown content when the prop changes
		const [reactContent, setMarkdown] = useRemark()

		useEffect(() => {
			if (markdown) {
				setMarkdown(markdown)
			}
		}, [markdown, setMarkdown])

		return (
			<div className="inline-block mb-0 description line-clamp-3" key={key}>
				<div
					className={cn("relative wrap-anywhere overflow-y-hidden", {
						"overflow-y-auto": isExpanded,
					})}>
					<div
						className={cn("overflow-hidden text-sm line-clamp-3", {
							"line-clamp-none": isExpanded,
							"h-20": !isExpanded,
						})}>
						{reactContent}
					</div>
					{!isExpanded && (
						<div className="absolute bottom-0 right-0 flex items-center">
							<div className="w-10 h-5 bg-linear-to-r from-transparent to-sidebar-background" />
							<Button
								className={cn("bg-sidebar-background p-0 m-0 text-sm", {
									"bg-code-block-background": isPopup,
								})}
								onClick={() => setIsExpanded(true)}
								variant="link">
								See more
							</Button>
						</div>
					)}
				</div>
			</div>
		)
	},
)
ModelDescriptionMarkdown.displayName = "ModelDescriptionMarkdown"
