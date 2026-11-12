"use client";

import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import { Loader2, ShieldAlert, TriangleAlert } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
	FACTORY_GUIDANCE,
	FACTORY_STAGES_APPROVAL,
	type FactoryGuidanceRoleName,
} from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import type { ToolApprovalRequestItem } from "./tool-approval-panel";

/** The Hub's tool name for Factory guidance changes. */
export const FACTORY_GUIDANCE_TOOL_NAME = "factory_guidance";
/** The Hub's tool name for a project's repository stages changes. */
export const FACTORY_STAGES_TOOL_NAME = "factory_stages";

/** A Factory manager change confirmed with a diff: guidance or repository stages. */
export function isFactoryGuidanceApproval(
	item: ToolApprovalRequestItem,
): boolean {
	return (
		item.toolName === FACTORY_GUIDANCE_TOOL_NAME ||
		item.toolName === FACTORY_STAGES_TOOL_NAME
	);
}

export type GuidanceDiffHunk = {
	oldStart: number;
	newStart: number;
	oldText: string;
	newText: string;
};

export type GuidanceDiff = {
	hunks: GuidanceDiffHunk[];
	additions: number;
	removals: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses the Hub's unified diff (`--- a/…`, `+++ b/…`, `@@` hunks). Returns
 * undefined when it is not a diff with at least one changed line.
 */
export function parseGuidanceDiff(diff: string): GuidanceDiff | undefined {
	const hunks: GuidanceDiffHunk[] = [];
	let current:
		| { oldStart: number; newStart: number; old: string[]; new: string[] }
		| undefined;
	let additions = 0;
	let removals = 0;
	const flush = () => {
		if (!current) return;
		hunks.push({
			oldStart: current.oldStart,
			newStart: current.newStart,
			oldText: current.old.join("\n"),
			newText: current.new.join("\n"),
		});
		current = undefined;
	};
	for (const raw of diff.split("\n")) {
		const line = raw.replace(/\r$/, "");
		const header = HUNK_HEADER.exec(line);
		if (header) {
			flush();
			current = {
				oldStart: Number(header[1]),
				newStart: Number(header[2]),
				old: [],
				new: [],
			};
			continue;
		}
		if (!current) {
			// File headers before the first hunk.
			if (line.startsWith("--- ") || line.startsWith("+++ ") || !line) continue;
			return undefined;
		}
		if (line.startsWith("\\")) continue; // "\ No newline at end of file"
		const kind = line[0];
		const text = line.slice(1);
		if (kind === " ") {
			current.old.push(text);
			current.new.push(text);
		} else if (kind === "-") {
			current.old.push(text);
			removals++;
		} else if (kind === "+") {
			current.new.push(text);
			additions++;
		} else if (line === "") {
		} else {
			return undefined;
		}
	}
	flush();
	if (hunks.length === 0 || additions + removals === 0) return undefined;
	return { hunks, additions, removals };
}

const GUIDANCE_ROLES = new Set<FactoryGuidanceRoleName>([
	"factory",
	"manager",
	"designer",
	"plan_reviewer",
	"builder",
	"verifier",
	"reviewer",
]);

export type FactoryGuidanceApprovalView = {
	heading: string;
	scope: string;
	summary: string;
	path?: string;
	diff: GuidanceDiff;
	/** Repository stages only: one line each, e.g. a command runs as you. */
	warnings?: string[];
	kind: "guidance" | "stages";
};

function repositoryName(workspaceRoot: string): string | undefined {
	const parts = workspaceRoot.split(/[\\/]+/).filter(Boolean);
	return parts[parts.length - 1];
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Builds the card from the approval request's input alone: the Hub supplies
 * the summary and computes the diff. Anything missing or unexpected returns
 * undefined, and the change cannot be saved from this card.
 */
export function readFactoryGuidanceApproval(
	input: unknown,
	toolName: string = FACTORY_GUIDANCE_TOOL_NAME,
): FactoryGuidanceApprovalView | undefined {
	if (!input || typeof input !== "object" || Array.isArray(input))
		return undefined;
	const record = input as Record<string, unknown>;
	if (toolName === FACTORY_STAGES_TOOL_NAME) return readStagesApproval(record);
	const role = record.role;
	if (
		typeof role !== "string" ||
		!GUIDANCE_ROLES.has(role as FactoryGuidanceRoleName)
	)
		return undefined;
	const scope = record.scope;
	if (scope !== "user" && scope !== "repository") return undefined;
	const summary = nonEmptyString(record.summary);
	if (!summary || typeof record.diff !== "string") return undefined;
	const diff = parseGuidanceDiff(record.diff);
	if (!diff) return undefined;
	const action = record.action;
	const heading =
		action === "accept"
			? FACTORY_GUIDANCE.acceptHeading
			: action === "discard"
				? FACTORY_GUIDANCE.discardHeading
				: role === "factory"
					? FACTORY_GUIDANCE.routingHeading
					: role === "manager"
						? FACTORY_GUIDANCE.managerHeading
						: FACTORY_GUIDANCE.roleHeading(
								FACTORY_GUIDANCE.roleLabel[
									role as keyof typeof FACTORY_GUIDANCE.roleLabel
								],
							);
	const workspaceRoot = nonEmptyString(record.workspaceRoot);
	const repository = workspaceRoot ? repositoryName(workspaceRoot) : undefined;
	return {
		heading,
		scope:
			scope === "user"
				? FACTORY_GUIDANCE.scopeUser
				: repository
					? FACTORY_GUIDANCE.scopeRepository(repository)
					: FACTORY_GUIDANCE.scopeRepositoryUnnamed,
		summary,
		path: nonEmptyString(record.path),
		diff,
		kind: "guidance",
	};
}

/** A repository stages change: always one named project, with its warnings. */
function readStagesApproval(
	record: Record<string, unknown>,
): FactoryGuidanceApprovalView | undefined {
	const project = nonEmptyString(record.project);
	const summary = nonEmptyString(record.summary);
	if (!project || !summary || typeof record.diff !== "string") return undefined;
	const diff = parseGuidanceDiff(record.diff);
	if (!diff) return undefined;
	const warnings = Array.isArray(record.warnings)
		? record.warnings
				.map(nonEmptyString)
				.filter((warning): warning is string => warning !== undefined)
				.slice(0, 3)
		: [];
	return {
		heading: FACTORY_STAGES_APPROVAL.heading,
		scope: FACTORY_GUIDANCE.scopeRepository(project),
		summary,
		path: nonEmptyString(record.path),
		diff,
		...(warnings.length ? { warnings } : {}),
		kind: "stages",
	};
}

/**
 * A guidance diff: the change count, the file and each hunk. Shared by the
 * chat's approval card and a Factory card's proposed rule.
 */
export function FactoryGuidanceDiffView({
	diff,
	path,
	className,
}: {
	diff: GuidanceDiff;
	path?: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-md border border-border/70",
				className,
			)}
		>
			<p className="flex flex-wrap items-center gap-x-2 border-b border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
				<span>
					{FACTORY_GUIDANCE.changeCount(diff.additions, diff.removals)}
				</span>
				{path ? (
					<span className="min-w-0 truncate font-mono" title={path}>
						{path}
					</span>
				) : null}
			</p>
			<div className="max-h-80 overflow-auto">
				{diff.hunks.map((hunk) => (
					<ToolFileDiff
						background="var(--background)"
						className="cline-chat-selectable"
						fragment
						// Hunks of one diff never overlap.
						key={`${hunk.oldStart}-${hunk.newStart}`}
						newText={hunk.newText}
						oldText={hunk.oldText}
						path={path ?? "guidance.md"}
					/>
				))}
			</div>
		</div>
	);
}

export function FactoryGuidanceApprovalCard({
	item,
	pendingAction,
	error,
	onApprove,
	onReject,
}: {
	item: ToolApprovalRequestItem;
	pendingAction?: "approving" | "rejecting";
	error?: string;
	onApprove: (requestId: string) => void;
	onReject: (requestId: string) => void;
}) {
	const headingId = useId();
	const noticeId = useId();
	const view = readFactoryGuidanceApproval(item.input, item.toolName);
	const isPending = pendingAction !== undefined;

	return (
		<section
			aria-busy={isPending || undefined}
			aria-describedby={noticeId}
			aria-labelledby={headingId}
			className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			data-factory-guidance-approval={item.requestId}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: The confirmation is a keyboard stop of its own, so its heading, diff and notice are read before the buttons.
			tabIndex={0}
		>
			<div className="flex items-start gap-2">
				<ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
				<div className="min-w-0 flex-1">
					<h3 className="text-sm font-medium text-foreground" id={headingId}>
						{view ? view.heading : FACTORY_GUIDANCE.unreadable}
					</h3>
					{view ? (
						<p className="mt-0.5 text-xs text-muted-foreground">{view.scope}</p>
					) : null}
				</div>
			</div>
			{view ? (
				<>
					<p className="mt-2 text-sm text-foreground">{view.summary}</p>
					{view.warnings?.map((warning) => (
						<p
							className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
							key={warning}
						>
							<TriangleAlert className="mt-px size-3.5 shrink-0" />
							{warning}
						</p>
					))}
					<FactoryGuidanceDiffView
						className="mt-2"
						diff={view.diff}
						path={view.path}
					/>
				</>
			) : null}
			<p className="mt-2 text-xs text-muted-foreground" id={noticeId}>
				{view?.kind === "stages"
					? FACTORY_STAGES_APPROVAL.notSavedYet
					: FACTORY_GUIDANCE.notSavedYet}
			</p>
			{error ? (
				<p className="mt-2 text-xs text-destructive" role="alert">
					{error}
				</p>
			) : null}
			<div className="mt-3 flex flex-wrap gap-2">
				{view ? (
					<Button
						disabled={isPending}
						onClick={() => onApprove(item.requestId)}
						size="sm"
						type="button"
					>
						{pendingAction === "approving" ? (
							<>
								<Loader2 className="size-3.5 animate-spin" />
								{FACTORY_GUIDANCE.saving}
							</>
						) : view.kind === "stages" ? (
							FACTORY_STAGES_APPROVAL.save
						) : (
							FACTORY_GUIDANCE.save
						)}
					</Button>
				) : null}
				<Button
					disabled={isPending}
					onClick={() => onReject(item.requestId)}
					size="sm"
					type="button"
					variant="outline"
				>
					{pendingAction === "rejecting" ? (
						<>
							<Loader2 className="size-3.5 animate-spin" />
							{FACTORY_GUIDANCE.declining}
						</>
					) : (
						FACTORY_GUIDANCE.dontSave
					)}
				</Button>
			</div>
		</section>
	);
}
