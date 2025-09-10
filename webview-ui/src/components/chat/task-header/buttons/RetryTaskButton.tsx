import { NewTaskRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { TaskServiceClient } from "@/services/grpc-client"

const RetryTaskButton: React.FC<{
	text?: string
	images?: string[]
	files?: string[]
}> = ({ text, images = [], files = [] }) => {
	return (
		<HeroTooltip content="Retry Task">
			<VSCodeButton
				appearance="icon"
				aria-label="Retry Task"
				className="flex items-center text-sm font-bold opacity-80 hover:bg-transparent hover:opacity-100"
				disabled={!text?.trim()}
				onClick={() =>
					text &&
					TaskServiceClient.newTask(
						NewTaskRequest.create({
							text: text.trim(),
							images,
							files,
						}),
					)
				}>
				<i className={"codicon codicon-refresh"} />
			</VSCodeButton>
		</HeroTooltip>
	)
}

export default RetryTaskButton
