import { XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const NewTaskButton: React.FC<{
	onClick: () => void
	className?: string
}> = ({ className, onClick }) => {
	const { t } = useTranslation()
	return (
		<Tooltip>
			<TooltipContent side="left">{t("taskHeader.startNewTask")}</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label={t("newTask")}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						onClick()
					}}
					size="icon"
					variant="icon">
					<XIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default NewTaskButton
