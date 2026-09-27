import { EmptyRequest } from "@shared/proto/cline/common"
import { Sparkles } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * RFC 0001 §3.2 — non-intrusive card offering to scaffold `.cline/` when the
 * open folder has no workspace at or above it. Visibility is decided by the
 * extension (`workspaceOnboarding.show`), which also remembers dismissals per
 * folder, so this component only owns the two actions.
 */
export const WorkspaceOnboardingCard = () => {
	const { workspaceOnboarding } = useExtensionState()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	if (!workspaceOnboarding?.show) {
		return null
	}

	const runAction = async (action: () => Promise<unknown>) => {
		setBusy(true)
		setError(null)
		try {
			await action()
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="mx-3 mb-2 border border-accent/20 rounded-xs bg-accent/5 px-3 py-2 flex flex-col gap-2">
			<div className="flex items-start gap-2">
				<Sparkles className="size-3 mt-0.5 shrink-0" />
				<div className="flex flex-col gap-0.5">
					<span className="font-medium">Initialize Cline in this repository</span>
					<span className="text-description">
						Create a <code>.cline/</code> directory to share instructions, custom skills, and team settings with your
						collaborators.
					</span>
					{workspaceOnboarding.workspacePath && (
						<span className="text-description break-all opacity-80">{workspaceOnboarding.workspacePath}</span>
					)}
				</div>
			</div>
			{error && <span className="text-error">Could not initialize the workspace: {error}</span>}
			<div className="flex items-center gap-2">
				<Button
					aria-label="Initialize Cline workspace"
					disabled={busy}
					onClick={() => runAction(() => StateServiceClient.initializeWorkspace(EmptyRequest.create({})))}
					size="sm">
					Initialize Project
				</Button>
				<Button
					aria-label="Dismiss workspace onboarding"
					disabled={busy}
					onClick={() => runAction(() => StateServiceClient.dismissWorkspaceOnboarding(EmptyRequest.create({})))}
					size="sm"
					variant="secondary">
					Dismiss
				</Button>
			</div>
		</div>
	)
}

export default WorkspaceOnboardingCard
