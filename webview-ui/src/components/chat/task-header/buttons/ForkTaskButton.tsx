import { Button } from "@heroui/react"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { GitCompareIcon } from "lucide-react"
import { TaskServiceClient } from "@/services/grpc-client"
import { cn } from "@/utils/cn"

const ForkTaskButton: React.FC<{
	text?: string
	images?: string[]
	files?: string[]
	className?: string
}> = ({ text, images = [], files = [], className }) => {
	return (
		<Button
			aria-label="Fork Task"
			className={cn("flex items-center border-0 text-sm font-bold bg-transparent hover:opacity-100", className)}
			disabled={!text?.trim()}
			isIconOnly={true}
			onPress={() =>
				text &&
				TaskServiceClient.newTask(
					NewTaskRequest.create({
						text: text.trim(),
						images,
						files,
					}),
				)
			}
			radius="sm"
			size="sm"
			title="Fork Task">
			<GitCompareIcon size="14" />
		</Button>
	)
}

export default ForkTaskButton
