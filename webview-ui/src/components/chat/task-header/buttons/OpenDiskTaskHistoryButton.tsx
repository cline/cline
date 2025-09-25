import { StringRequest } from "@shared/proto/cline/common"
import { ArrowDownToLineIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

const OpenDiskTaskHistoryButton: React.FC<{
	taskId?: string
	visible?: boolean
	className?: string
}> = ({ taskId, className, visible }) => {
	if (!visible) {
		return null
	}

	return (
		<Tooltip>
			<TooltipContent>Export Task</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label="Delete Task"
					onClick={() =>
						taskId &&
						FileServiceClient.openTaskHistory(StringRequest.create({ value: taskId })).catch((err) => {
							console.error(err)
						})
					}
					size="icon"
					title="Export Task"
					variant="icon">
					<ArrowDownToLineIcon strokeWidth={1.5} />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default OpenDiskTaskHistoryButton
