import { StringArrayRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { TaskServiceClient } from "@/services/grpc-client"

const DeleteTaskButton: React.FC<{
	taskSize: string
	taskId?: string
}> = ({ taskId }) => (
	<HeroTooltip content="Delete Task">
		<VSCodeButton
			appearance="icon"
			aria-label="Delete task"
			className="flex items-center text-sm font-bold opacity-80 hover:bg-transparent hover:opacity-100"
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				taskId && TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [taskId] }))
			}}>
			<i className="codicon codicon-trash" />
		</VSCodeButton>
	</HeroTooltip>
)

export default DeleteTaskButton
