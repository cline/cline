import { memo } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const ModelDescriptionMarkdown = memo(
	({
		markdown,
		key,
		isExpanded,
		setIsExpanded,
		isPopup,
	}: {
		markdown?: string
		key: string
		isExpanded: boolean
		setIsExpanded: (isExpanded: boolean) => void
		isPopup?: boolean
	}) => {
		return (
			<div className="inline-block mb-0 description line-clamp-3" key={key}>
				<div
					className={cn("relative wrap-anywhere overflow-y-hidden", {
						"overflow-y-auto": isExpanded,
					})}>
					<div
						className={cn("overflow-hidden line-clamp-3", {
							"line-clamp-none": isExpanded,
						})}>
						{markdown}
					</div>
					{!isExpanded && (
						<div className="absolute bottom-0 right-0 flex items-center">
							<div className="w-8 h-2 bg-linear-to-r from-transparent to-sidebar-background" />
							<Button
								className={cn("bg-sidebar-background", {
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
