import { StringArrayRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { TaskServiceClient } from "@/services/grpc-client"

const DeleteTaskButton: React.FC<{
	taskSize: string
	taskId?: string
}> = ({ taskId }) => (
	<VSCodeButton
		appearance="icon"
		aria-label="Delete task"
		className="flex items-center text-sm font-bold opacity-80 hover:bg-transparent hover:opacity-100"
		onClick={(e) => {
			e.preventDefault()
			e.stopPropagation()
			taskId && TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [taskId] }))
		}}
		title="Delete Task">
		<i className="codicon codicon-trash" />
	</VSCodeButton>
)

export default DeleteTaskButton
