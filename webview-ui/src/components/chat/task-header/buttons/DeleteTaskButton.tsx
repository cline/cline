import { Button } from "@heroui/react"
import { StringArrayRequest } from "@shared/proto/cline/common"
import { TrashIcon } from "lucide-react"
import { TaskServiceClient } from "@/services/grpc-client"
import { cn } from "@/utils/cn"

const DeleteTaskButton: React.FC<{
	taskId?: string
	className?: string
}> = ({ taskId, className }) => (
	<Button
		aria-label="Delete Task"
		className={cn("flex items-center border-0 text-sm font-bold bg-transparent hover:opacity-100", className)}
		isIconOnly={true}
		onPress={() => {
			taskId && TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [taskId] }))
		}}
		radius="sm"
		size="sm"
		title="Delete Task">
		<TrashIcon size="14" />
	</Button>
)
DeleteTaskButton.displayName = "DeleteTaskButton"

export default DeleteTaskButton
