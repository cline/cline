import { Button, cn } from "@heroui/react"
import { StringRequest } from "@shared/proto/cline/common"
import { ArrowDownToLineIcon } from "lucide-react"
import { FileServiceClient } from "@/services/grpc-client"

const OpenDiskTaskHistoryButton: React.FC<{
	taskId?: string
	className?: string
}> = ({ taskId, className }) => {
	const handleOpenDiskTaskHistory = () => {
		if (!taskId) {
			return
		}

		FileServiceClient.openTaskHistory(StringRequest.create({ value: taskId })).catch((err) => {
			console.error(err)
		})
	}

	return (
		<Button
			aria-label="Open Disk Task History"
			className={cn("flex items-center border-0 text-sm font-bold bg-transparent hover:opacity-100", className)}
			isIconOnly={true}
			onPress={() => handleOpenDiskTaskHistory()}
			radius="sm"
			size="sm"
			title="Export Task">
			<ArrowDownToLineIcon size="14" />
		</Button>
	)
}

export default OpenDiskTaskHistoryButton
