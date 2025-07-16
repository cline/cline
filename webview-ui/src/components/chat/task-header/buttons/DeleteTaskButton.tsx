import HeroTooltip from "@/components/common/HeroTooltip"
import { TaskServiceClient } from "@/services/grpc-client"
import { StringArrayRequest } from "@shared/proto/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

const DeleteTaskButton: React.FC<{
	taskSize: string
	taskId?: string
}> = ({ taskSize, taskId }) => (
	<HeroTooltip content="Delete Task">
		<VSCodeButton
			appearance="icon"
			onClick={() => taskId && TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [taskId] }))}
			aria-label="Delete task"
			style={{ padding: "0px 0px" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "3px",
					fontSize: "10px",
					fontWeight: "bold",
					opacity: 0.6,
				}}>
				<i className={`codicon codicon-trash`} />
				{taskSize}
			</div>
		</VSCodeButton>
	</HeroTooltip>
)

export default DeleteTaskButton
