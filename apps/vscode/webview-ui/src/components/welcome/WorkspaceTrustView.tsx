import { EmptyRequest } from "@shared/proto/cline/common"
import { FolderLockIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * Shown in place of the chat while the open folder is not on the trusted
 * workspaces allow list, because Cline would otherwise pick up the folder's
 * rules, skills, hooks, and plugins without asking.
 */
const WorkspaceTrustView = ({ path }: { path: string }) => (
	<div className="fixed inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
		<FolderLockIcon className="size-8 text-description" />
		<h2 className="m-0 text-base font-semibold text-foreground">Do you trust the files in this folder?</h2>
		<code className="break-all text-xs text-description">{path}</code>
		<p className="m-0 max-w-sm text-sm leading-relaxed text-description">
			Cline automatically loads rules, skills, hooks, and plugins from this folder, and can read, edit, and run its files.
			Only continue if you trust where it came from.
		</p>
		<Button
			className="mt-2"
			onClick={() =>
				StateServiceClient.trustWorkspace(EmptyRequest.create({})).catch((error) =>
					console.error("Failed to trust workspace:", error),
				)
			}>
			Trust folder
		</Button>
	</div>
)

export default WorkspaceTrustView
