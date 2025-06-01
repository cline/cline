import HeroTooltip from "@/components/common/HeroTooltip"
import { FileServiceClient } from "@/services/grpc-client"
import { StringRequest } from "@shared/proto/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

const OpenDiskTaskHistoryButton: React.FC<{
	taskId?: string
}> = ({ taskId }) => {
	const handleOpenDiskTaskHistory = () => {
		if (!taskId) return

		FileServiceClient.openTaskHistory(StringRequest.create({ value: taskId })).catch((err) => {
			console.error(err)
		})
	}

	return (
		<HeroTooltip content="Open Disk Task History">
			<VSCodeButton
				appearance="icon"
				onClick={handleOpenDiskTaskHistory}
				style={{ padding: "0px 0px" }}
				className="p-0"
				aria-label="Open Disk Task History">
				<div className="flex items-center gap-[3px] text-[8px] font-bold opacity-60">
					<i className={`codicon codicon-folder`} />
				</div>
			</VSCodeButton>
		</HeroTooltip>
	)
}

export default OpenDiskTaskHistoryButton
