import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CloudServiceClient } from "@/services/grpc-client"

export function CloudHandoff({ error: preparationError }: { error?: string }) {
	const { cloudHandoff: view } = useExtensionState()
	const [error, setError] = useState<string>()
	const [confirming, setConfirming] = useState(false)
	useEffect(() => {
		setError(undefined)
		setConfirming(false)
	}, [view?.id, view?.phase])
	const run = async (operation: () => Promise<unknown>) => {
		setError(undefined)
		try {
			await operation()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Cloud handoff failed.")
		}
	}
	const dismiss = () => view && run(() => CloudServiceClient.discardHandoff(StringRequest.create({ value: view.id })))
	const sessionId = view && (view.phase === "complete" || view.phase === "launching") ? view.sessionId : undefined
	const errorText = error ?? preparationError
	if (!view)
		return errorText ? (
			<div className="px-3 py-2 text-error" role="alert">
				{errorText}
			</div>
		) : null

	return (
		<>
			{view.phase === "ready" && (
				<Dialog
					onOpenChange={(open) => {
						if (!open && !confirming) void dismiss()
					}}
					open>
					<DialogContent className="max-h-[85vh] overflow-y-auto" hideClose={confirming}>
						<DialogHeader>
							<DialogTitle>Continue in cloud</DialogTitle>
							<DialogDescription>
								Publish this Git snapshot and start a separate cloud conversation from a summary. Your local task
								stays open.
							</DialogDescription>
						</DialogHeader>
						<dl className="m-0 text-sm break-all space-y-1">
							<dt className="text-description">Repository</dt>
							<dd className="m-0">{view.git.repoUrl}</dd>
							<dt className="text-description">New branch</dt>
							<dd className="m-0">{view.git.branch}</dd>
							<dt className="text-description">From</dt>
							<dd className="m-0">
								{view.git.sourceBranch} · {view.git.remote}
							</dd>
							<dt className="text-description">Destination</dt>
							<dd className="m-0">
								{view.organizationName} · {view.modelId}
							</dd>
						</dl>
						<details>
							<summary>
								{view.git.files.length} changed files · {view.git.commits.length} unpublished commits
							</summary>
							<div className="max-h-48 overflow-y-auto text-xs break-all">
								{view.git.files.map((file) => (
									<div key={file.path}>
										<code>
											{file.status} {file.path}
										</code>
									</div>
								))}
								{view.git.commits.map((commit) => (
									<div key={commit}>{commit}</div>
								))}
							</div>
						</details>
						{view.instruction && <p className="m-0 text-sm whitespace-pre-wrap break-words">{view.instruction}</p>}
						{view.imageCount > 0 && (
							<p className="m-0 text-sm">
								{view.imageCount} attached {view.imageCount === 1 ? "image" : "images"} will be sent.
							</p>
						)}
						<p className="m-0 text-sm text-description">
							Later local edits are excluded. Your current branch and working files stay unchanged.
						</p>
						{errorText && (
							<div className="text-error" role="alert">
								{errorText}
							</div>
						)}
						<DialogFooter className="gap-2">
							<VSCodeButton appearance="secondary" disabled={confirming} onClick={() => void dismiss()}>
								Cancel
							</VSCodeButton>
							<VSCodeButton
								disabled={confirming}
								onClick={() => {
									setConfirming(true)
									void run(() =>
										CloudServiceClient.confirmHandoff(StringRequest.create({ value: view.id })),
									).finally(() => setConfirming(false))
								}}>
								Publish and start
							</VSCodeButton>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
			{view.phase !== "ready" && (
				<section aria-label="Cloud handoff" className="m-2 p-3 border border-input-border rounded text-sm">
					<div role="status">
						{view.phase === "preparing"
							? "Preparing conversation summary and Git snapshot…"
							: view.phase === "launching"
								? view.sessionId
									? "Sending cloud continuation… You can continue locally."
									: "Starting cloud task… You can continue locally."
								: view.phase === "complete" && view.delivery === "sent"
									? "Cloud task started. Your local task is still open."
									: view.message}
					</div>
					{errorText && (
						<div className="text-error mt-2" role="alert">
							{errorText}
						</div>
					)}
					<div className="flex gap-2 mt-2">
						{sessionId && (
							<VSCodeButton
								appearance="secondary"
								onClick={() =>
									void run(() =>
										CloudServiceClient.openCloudSessionDashboard(StringRequest.create({ value: sessionId })),
									)
								}>
								Open cloud task
							</VSCodeButton>
						)}
						{view.phase === "complete" && view.delivery === "unsent" && (
							<VSCodeButton
								onClick={() =>
									void run(() =>
										CloudServiceClient.retryHandoffMessage(StringRequest.create({ value: view.id })),
									)
								}>
								Retry continuation
							</VSCodeButton>
						)}
						{view.phase !== "launching" && (
							<VSCodeButton appearance="secondary" onClick={() => void dismiss()}>
								{view.phase === "preparing" ? "Cancel" : "Dismiss"}
							</VSCodeButton>
						)}
					</div>
				</section>
			)}
		</>
	)
}
