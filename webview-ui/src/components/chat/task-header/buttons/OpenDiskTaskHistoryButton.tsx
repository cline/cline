import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { FileServiceClient } from "@/services/grpc-client"

const OpenDiskTaskHistoryButton: React.FC<{
	taskId?: string
}> = ({ taskId }) => {
	const handleOpenDiskTaskHistory = () => {
		if (!taskId) {
			return
		}

		FileServiceClient.openTaskHistory(StringRequest.create({ value: taskId })).catch((err) => {
			console.error(err)
		})
	}

	return (
		<HeroTooltip content="Open Disk Task History">
			<VSCodeButton
				appearance="icon"
				aria-label="Open Disk Task History"
				className="flex items-center text-sm font-bold opacity-80 hover:bg-transparent hover:opacity-100"
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					handleOpenDiskTaskHistory()
				}}>
				<i className={`codicon codicon-folder`} />
			</VSCodeButton>
		</HeroTooltip>
	)
}

export default OpenDiskTaskHistoryButton
