import { NewTaskRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { GitBranchIcon } from "lucide-react"
import { TaskServiceClient } from "@/services/grpc-client"

const RetryTaskButton: React.FC<{
	text?: string
	images?: string[]
	files?: string[]
}> = ({ text, images = [], files = [] }) => {
	return (
		<VSCodeButton
			appearance="icon"
			aria-label="Branch Task"
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
			}
			title="Create a new branch of the same task">
			<GitBranchIcon />
		</VSCodeButton>
	)
}

export default RetryTaskButton
