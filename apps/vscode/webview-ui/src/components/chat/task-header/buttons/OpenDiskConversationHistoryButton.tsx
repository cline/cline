import { StringRequest } from "@shared/proto/cline/common"
import { ArrowDownToLineIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

const OpenDiskConversationHistoryButton: React.FC<{
	taskId?: string
	className?: string
}> = ({ taskId, className }) => {
	const handleOpenDiskConversationHistory = () => {
		if (!taskId) {
			return
		}

		TaskServiceClient.exportTaskWithId(StringRequest.create({ value: taskId })).catch((err) =>
			console.error("Failed to export task:", err),
		)
	}

	return (
		<Tooltip>
			<TooltipContent>Open Conversation History File</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label="Open Disk Conversation History"
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						handleOpenDiskConversationHistory()
					}}
					size="icon"
					variant="icon">
					<ArrowDownToLineIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

OpenDiskConversationHistoryButton.displayName = "OpenDiskConversationHistoryButton"
export default OpenDiskConversationHistoryButton
