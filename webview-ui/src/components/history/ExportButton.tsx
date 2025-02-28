import { vscode } from "@/utils/vscode"
import { Button } from "@/components/ui"

export const ExportButton = ({ itemId }: { itemId: string }) => (
	<Button
		data-testid="export"
		variant="ghost"
		size="icon"
		title="Export Task"
		onClick={(e) => {
			e.stopPropagation()
			vscode.postMessage({ type: "exportTaskWithId", text: itemId })
		}}>
		<span className="codicon codicon-cloud-download" />
	</Button>
)
