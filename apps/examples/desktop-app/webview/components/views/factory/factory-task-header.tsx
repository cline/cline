"use client";

import type { AgendaTaskRecord, FactoryRunState } from "@cline/shared";
import { ArrowLeft, ArrowUpRight, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openExternalUrl } from "@/lib/desktop-client";

export function FactoryTaskHeader({
	task,
	busy,
	designActive,
	state,
	approvalReason,
	onBack,
	onArchive,
	onDelete,
}: {
	task: AgendaTaskRecord;
	busy: boolean;
	designActive: boolean;
	state: FactoryRunState | undefined;
	approvalReason: string | null;
	onBack: () => void;
	onArchive: () => void;
	onDelete: () => void;
}) {
	const [deleting, setDeleting] = useState(false);
	const executionTask =
		task.status === "in_progress" ||
		task.status === "completed" ||
		task.status === "failed";
	const phase =
		executionTask && state
			? state.phase
			: designActive
				? task.factoryDesignProgress?.phase
				: undefined;
	const nextAction = task.archivedAt
		? "Restore this task to continue."
		: task.status === "cancelled" || task.status === "expired"
			? "This task is closed. Create a new task for further changes."
			: state?.humanApproval
				? "This candidate has been checked off."
				: task.status === "failed" ||
						(executionTask && state?.phase === "blocked")
					? "Inspect the recorded error and evidence before choosing the next step."
					: task.status === "in_progress"
						? "Execution is in progress. Follow the evidence or open a role session."
						: task.status === "completed"
							? "Review the candidate, checks and independent reports in Verification."
							: (approvalReason ??
								"Review the saved brief and checks, then approve execution.");
	const source = task.factory?.sourceIssue;
	return (
		<header className="space-y-4">
			<div className="flex items-center justify-between gap-3">
				<Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
					<ArrowLeft className="mr-1 size-4" /> Back to factory
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" disabled={busy}>
							<MoreHorizontal className="mr-1 size-4" /> More
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={onArchive}>
							{task.archivedAt
								? "Restore"
								: task.status === "in_progress" || designActive
									? "Cancel and archive"
									: "Archive"}
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							onSelect={() => setDeleting(true)}
						>
							Delete…
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<div>
				<h1 className="break-words text-2xl font-semibold">{task.title}</h1>
				<p className="mt-2 break-all text-sm text-muted-foreground">
					{task.workspaceRoot} ·{" "}
					{task.factory?.execution === "cloud"
						? "Cloud execution unavailable"
						: "Local execution"}{" "}
					· Revision {task.revision}
					{task.modelSelection
						? ` · ${task.modelSelection.providerId}/${task.modelSelection.modelId ?? "default"}`
						: ""}
				</p>
				{source ? (
					<Button
						variant="link"
						className="mt-2 h-auto p-0"
						onClick={() => void openExternalUrl(source.url)}
					>
						{source.provider === "github" ? "GitHub issue" : "Linear issue"} ·{" "}
						{source.id}
						<ArrowUpRight className="ml-1 size-3" />
					</Button>
				) : null}
			</div>
			<section
				aria-label="Task progress"
				className="space-y-2 rounded-lg border bg-muted/20 p-4"
			>
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<strong>
						{task.archivedAt ? "Archived" : task.status.replaceAll("_", " ")}
					</strong>
					{phase ? (
						<span className="text-muted-foreground">· {phase}</span>
					) : null}
					{executionTask && state ? (
						<span className="text-xs text-muted-foreground">
							· Repair round {state.repairRound} of{" "}
							{task.factory?.maxRepairRounds ?? 0}
						</span>
					) : null}
				</div>
				<p className="text-sm text-muted-foreground">{nextAction}</p>
			</section>
			<AlertDialog open={deleting} onOpenChange={setDeleting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this task permanently?</AlertDialogTitle>
						<AlertDialogDescription>
							This stops any active work and deletes the task and its run
							history. Files, branches, and session transcripts are kept. You
							cannot undo this.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep task</AlertDialogCancel>
						<AlertDialogAction onClick={onDelete}>
							Delete permanently
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</header>
	);
}
