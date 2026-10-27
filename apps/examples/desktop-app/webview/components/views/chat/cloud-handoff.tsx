"use client";

import type { HandoffGitPreview } from "@cline/core/cloud";
import { Cloud, ExternalLink, Loader2, X } from "lucide-react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { HANDOFF_PROGRESS_LABELS } from "@/lib/cloud-handoff";
import type { CloudHandoffUiEntry } from "@/lib/cloud-handoff-ui-state";

export function CloudHandoffGitConfirmation({
	plan,
	onDecision,
}: {
	plan: HandoffGitPreview;
	onDecision: (approved: boolean) => void;
}) {
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open) onDecision(false);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Continue in cloud?</AlertDialogTitle>
					<AlertDialogDescription>
						Cline will push a snapshot to a new GitHub branch and start a cloud
						task with a summary of this conversation. You can keep working
						locally. Later messages and edits stay local.
						{plan.commits.length > 0 && (
							<span className="mt-2 block">
								This includes {plan.commits.length} local{" "}
								{plan.commits.length === 1 ? "commit" : "commits"} not confirmed
								on the remote.
							</span>
						)}
						{plan.files.length > 0 && (
							<span className="mt-2 block">
								{plan.files.length} changed/new{" "}
								{plan.files.length === 1 ? "file" : "files"} will be committed.
								Ignored files are excluded.
							</span>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<dl className="space-y-2 text-sm">
					<div>
						<dt className="text-muted-foreground">Repository</dt>
						<dd className="break-all">
							{plan.repoUrl} ({plan.remote})
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">New branch</dt>
						<dd className="break-all font-mono text-xs">{plan.branch}</dd>
					</div>
				</dl>
				<details className="text-sm">
					<summary className="cursor-pointer">Details</summary>
					<div className="mt-2 max-h-48 space-y-2 overflow-auto text-xs">
						<p className="break-all text-muted-foreground">
							Current branch: {plan.sourceBranch}
						</p>
						{plan.files.length > 0 && (
							<ul>
								{plan.files.map((file) => (
									<li className="break-all font-mono" key={file.path}>
										{file.status} {file.path}
									</li>
								))}
							</ul>
						)}
						{plan.commits.length > 0 && (
							<>
								<p className="text-muted-foreground">
									Commits not confirmed on the remote:
								</p>
								<ul>
									{plan.commits.map((commit) => (
										<li className="break-all font-mono" key={commit}>
											{commit}
										</li>
									))}
								</ul>
							</>
						)}
					</div>
				</details>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => onDecision(false)}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction onClick={() => onDecision(true)}>
						Push and continue
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function CloudHandoffStatus({
	state,
	onOpenCloud,
	onRestoreDraft,
	onDismiss,
}: {
	state: CloudHandoffUiEntry;
	onOpenCloud: () => void;
	onRestoreDraft: (destination: "local" | "cloud") => void;
	onDismiss: () => void;
}) {
	const pending = state.preparing || state.status === "progress";
	const canRestoreDraft =
		state.status === "failed" ||
		(state.status === "complete" && Boolean(state.unsentDraft));
	const dashboardUrl = "dashboardUrl" in state ? state.dashboardUrl : undefined;
	const label = state.preparing
		? HANDOFF_PROGRESS_LABELS.checking
		: state.status === "progress"
			? state.message?.trim() || HANDOFF_PROGRESS_LABELS[state.phase]
			: state.status === "complete"
				? state.message
					? "Check the cloud task"
					: "Cloud task ready"
				: "Cloud handoff needs attention";
	return (
		<output
			aria-live="polite"
			className="mb-2 block w-full rounded-md border bg-card px-3"
		>
			<div className="flex h-9 min-w-0 items-center gap-2">
				{pending ? (
					<Loader2
						aria-hidden="true"
						className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
					/>
				) : (
					<Cloud aria-hidden="true" className="size-3.5 shrink-0" />
				)}
				<span className="min-w-0 flex-1 truncate text-xs" title={label}>
					{label}
				</span>
				{dashboardUrl && (
					<Button
						className="h-7 shrink-0 gap-1.5 px-2 text-xs"
						onClick={onOpenCloud}
						size="sm"
						variant="ghost"
					>
						Open cloud task
						<ExternalLink aria-hidden="true" className="size-3.5" />
					</Button>
				)}
				{!pending && (
					<Button
						aria-label="Dismiss cloud handoff status"
						className="size-7 shrink-0"
						onClick={onDismiss}
						size="icon"
						variant="ghost"
					>
						<X aria-hidden="true" className="size-3.5" />
					</Button>
				)}
			</div>
			{!pending && (state.message || canRestoreDraft) && (
				<div className="space-y-2 pb-3">
					{state.message && (
						<p className="break-words text-xs text-muted-foreground">
							{state.message}
						</p>
					)}
					{canRestoreDraft && (
						<Button
							className="h-7 px-2 text-xs"
							onClick={() =>
								onRestoreDraft(state.status === "complete" ? "cloud" : "local")
							}
							size="sm"
							variant="outline"
						>
							{state.status === "complete"
								? "Open cloud task with draft"
								: "Restore /cloud draft"}
						</Button>
					)}
				</div>
			)}
			{!pending && state.status !== "failed" && state.preparationFailure && (
				<div className="space-y-2 pb-3">
					<p className="break-words text-xs text-muted-foreground">
						{state.preparationFailure.message}
					</p>
					<Button
						className="h-7 px-2 text-xs"
						onClick={() => onRestoreDraft("local")}
						size="sm"
						variant="outline"
					>
						Restore /cloud draft
					</Button>
				</div>
			)}
		</output>
	);
}
