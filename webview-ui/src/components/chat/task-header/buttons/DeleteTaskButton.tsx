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
			className="p-0"
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				taskId && TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [taskId] }))
			}}>
			<div className="flex items-center gap-[3px] text-[8px] font-bold opacity-60">
				<i className="codicon codicon-trash" />
			</div>
		</VSCodeButton>
	</HeroTooltip>
)

export default DeleteTaskButton
