import { Button, cn } from "@heroui/react"
import { StringRequest } from "@shared/proto/cline/common"
import { ArrowDownToLineIcon } from "lucide-react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { FileServiceClient } from "@/services/grpc-client"

const OpenDiskConversationHistoryButton: React.FC<{
	taskId?: string
	className?: string
}> = ({ taskId, className }) => {
	const handleOpenDiskConversationHistory = () => {
		if (!taskId) {
			return
		}

		FileServiceClient.openDiskConversationHistory(StringRequest.create({ value: taskId })).catch((err) => {
			console.error(err)
		})
	}

	return (
		<HeroTooltip content="Open Conversation History File" placement="right">
			<Button
				aria-label="Open Disk Conversation History"
				className={cn("flex items-center border-0 text-sm font-bold bg-transparent hover:opacity-100", className)}
				isIconOnly={true}
				onPress={() => handleOpenDiskConversationHistory()}
				radius="sm"
				size="sm">
				<ArrowDownToLineIcon size="14" />
			</Button>
		</HeroTooltip>
	)
}

export default OpenDiskConversationHistoryButton
