import type { CloudHandoffView } from "@shared/cloud/cloud-handoff"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CloudServiceClient, TaskServiceClient } from "@/services/grpc-client"

function handoffStatus(view: Exclude<CloudHandoffView, { phase: "ready" }>): string {
	switch (view.phase) {
		case "preparing":
			return "Preparing conversation summary and Git snapshot…"
		case "launching":
			return view.sessionId
				? "Sending cloud continuation… You can continue locally."
				: "Starting cloud task… You can continue locally."
		case "complete":
			return {
				sent: "Cloud task started. Your local task is still open.",
				unsent: "The cloud task was created, but the continuation was not sent. Retry here while this window stays open. Your draft has been kept.",
				unconfirmed: "Delivery is unconfirmed. Open the cloud task and check before resending. Your draft has been kept.",
			}[view.delivery]
		case "failed":
			return view.message
	}
}

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
	const dismissLabel = view?.phase === "preparing" ? "Cancel handoff" : "Dismiss handoff"
	const sessionId = view && (view.phase === "complete" || view.phase === "launching") ? view.sessionId : undefined
	const errorText = error ?? preparationError
	if (!view)
		return errorText ? (
			<section
				aria-label="Cloud handoff error"
				className="mx-3 my-2 max-h-[min(25vh,10rem)] overflow-y-auto text-error whitespace-pre-wrap break-words focus-visible:ring-1 focus-visible:ring-ring"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Long errors need keyboard scrolling.
				tabIndex={0}>
				<div role="alert">{errorText}</div>
			</section>
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
							Later local edits are excluded. Snapshot commits are unsigned and skip commit hooks. Pre-push hooks
							run locally and may change your files.
						</p>
						{errorText && (
							<div className="text-error whitespace-pre-wrap break-words" role="alert">
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
				<section
					aria-label="Cloud handoff"
					className="m-2 p-3 max-h-[min(35vh,14rem)] overflow-y-auto border border-input-border rounded text-sm focus-visible:ring-1 focus-visible:ring-ring"
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Long notices need keyboard scrolling.
					tabIndex={0}>
					<div className="flex items-start gap-2">
						<div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
							<div role={view.phase === "failed" ? "alert" : "status"}>{handoffStatus(view)}</div>
							{errorText && (
								<div className="text-error mt-2" role="alert">
									{errorText}
								</div>
							)}
						</div>
						{view.phase !== "launching" && !(view.phase === "complete" && view.delivery === "unsent") && (
							<Button
								aria-label={dismissLabel}
								className="size-5 shrink-0"
								onClick={() => void dismiss()}
								size="icon"
								title={dismissLabel}
								variant="icon">
								<XIcon />
							</Button>
						)}
					</div>
					{view.phase === "failed" && view.recovery === "connect_github" && (
						<div className="flex mt-2">
							<VSCodeButton
								appearance="secondary"
								onClick={() => void run(() => CloudServiceClient.connectGitHub(EmptyRequest.create()))}>
								Connect GitHub
							</VSCodeButton>
						</div>
					)}
					{sessionId && (
						<div className="flex flex-wrap gap-2 mt-2">
							<VSCodeButton
								disabled={view.phase === "launching"}
								onClick={() =>
									void run(() => TaskServiceClient.showTaskWithId(StringRequest.create({ value: sessionId })))
								}>
								Open in Cline
							</VSCodeButton>
							<VSCodeButton
								appearance="secondary"
								onClick={() =>
									void run(() =>
										CloudServiceClient.openCloudSessionDashboard(StringRequest.create({ value: sessionId })),
									)
								}>
								Open in browser
							</VSCodeButton>
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
						</div>
					)}
				</section>
			)}
		</>
	)
}
