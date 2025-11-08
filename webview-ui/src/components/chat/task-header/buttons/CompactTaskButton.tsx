import { FoldVerticalIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const CompactTaskButton: React.FC<{
	className?: string
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ onClick, className }) => {
	const { t } = useTranslation()
	return (
		<Tooltip>
			<TooltipContent side="left">{t("task_header.compact_task")}</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label={t("task_header.compact_task")}
					className="[&_svg]:size-3"
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						onClick(e)
					}}
					size="icon"
					variant="icon">
					<FoldVerticalIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default CompactTaskButton
