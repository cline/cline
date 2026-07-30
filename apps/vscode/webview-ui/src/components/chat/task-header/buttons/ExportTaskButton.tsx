import { StringRequest } from "@shared/proto/cline/common"
import { ArrowDownToLineIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

const ExportTaskButton: React.FC<{
	taskId?: string
	className?: string
}> = ({ taskId, className }) => {
	const handleExportTask = () => {
		if (!taskId) {
			return
		}

		TaskServiceClient.exportTaskWithId(StringRequest.create({ value: taskId })).catch((err) =>
			console.error("Failed to export task:", err),
		)
	}

	return (
		<Tooltip>
			<TooltipContent>Export Task</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label="Export Task"
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						handleExportTask()
					}}
					size="icon"
					variant="icon">
					<ArrowDownToLineIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

ExportTaskButton.displayName = "ExportTaskButton"
export default ExportTaskButton
