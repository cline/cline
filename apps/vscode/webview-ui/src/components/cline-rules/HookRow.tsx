import { StringRequest } from "@shared/proto/cline/common"
import { PenIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FileServiceClient } from "@/services/grpc-client"

interface HookRowProps {
	hookName: string
	hookEventName?: string
	absolutePath: string
}

const HookRow: React.FC<HookRowProps> = ({ hookName, hookEventName, absolutePath }) => {
	const handleEditClick = () => {
		FileServiceClient.openFile(StringRequest.create({ value: absolutePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}

	return (
		<div className="mb-2.5">
			<div className="flex items-center px-2 py-4 rounded bg-text-block-background max-h-4">
				<span className="flex-1 min-w-0 overflow-hidden break-all whitespace-normal flex items-center gap-2 mr-1">
					<span className="ph-no-capture font-medium">{hookName}</span>
					{hookEventName && <span className="text-xs text-description ph-no-capture">{hookEventName}</span>}
				</span>

				<div className="flex items-center space-x-2 gap-2">
					<Button aria-label="Edit hook file" onClick={handleEditClick} size="xs" title="Edit hook file" variant="icon">
						<PenIcon />
					</Button>
				</div>
			</div>
		</div>
	)
}

export default HookRow
