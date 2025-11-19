import { StringRequest } from "@shared/proto/cline/common"
import { DeleteHookRequest } from "@shared/proto/cline/file"
import { PenIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { FileServiceClient } from "@/services/grpc-client"

interface HookRowProps {
	hookName: string
	enabled: boolean
	absolutePath: string
	isGlobal: boolean
	onToggle: (hookName: string, enabled: boolean) => void
	onDelete: () => void
}

const HookRow: React.FC<HookRowProps> = ({ hookName, enabled, absolutePath, isGlobal, onToggle, onDelete }) => {
	const handleEditClick = () => {
		FileServiceClient.openFile(StringRequest.create({ value: absolutePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}

	const handleDeleteClick = () => {
		FileServiceClient.deleteHook(
			DeleteHookRequest.create({
				hookName,
				isGlobal,
			}),
		)
			.then(() => {
				onDelete()
			})
			.catch((err) => console.error("Failed to delete hook:", err))
	}

	return (
		<div className="mb-2.5">
			<div className="flex items-center px-2 py-4 rounded bg-text-block-background max-h-4">
				<span className="flex-1 overflow-hidden break-all whitespace-normal flex items-center mr-1">
					<span className="ph-no-capture">{hookName}</span>
				</span>

				{/* Toggle Switch */}
				<div className="flex items-center space-x-2 gap-2">
					<Switch checked={enabled} className="mx-1" key={hookName} onClick={() => onToggle(hookName, !enabled)} />
					<Button aria-label="Edit hook file" onClick={handleEditClick} size="xs" title="Edit hook file" variant="icon">
						<PenIcon />
					</Button>
					<Button
						aria-label="Delete hook file"
						onClick={handleDeleteClick}
						size="xs"
						title="Delete hook file"
						variant="icon">
						<Trash2Icon />
					</Button>
				</div>
			</div>
		</div>
	)
}

export default HookRow
