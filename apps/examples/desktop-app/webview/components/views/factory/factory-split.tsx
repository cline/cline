"use client";

import type {
	AgendaTaskRecord,
	FactoryDesignSplit,
	FactoryPartsSummary,
} from "@cline/shared";
import { factorySplitApprovalFacts } from "@cline/shared/browser";
import { ArrowUpRight, CornerLeftUp } from "lucide-react";
import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { openExternalUrl } from "@/lib/desktop-client";
import type { FactoryCardLinks } from "@/lib/factory-attention";
import {
	FACTORY_PROOF,
	FACTORY_SPLIT,
	factoryHistoryStatus,
} from "@/lib/factory-copy";
import type { FactoryLimits } from "@/lib/factory-limits";
import { cn } from "@/lib/utils";
import {
	type FactoryActivity,
	type FactoryTone,
	factoryShortId,
	Panel,
	toneDot,
} from "./factory-ui";

/** Another card of the same split, as a link names it. */
type FactorySplitCard = {
	taskId: string;
	shortId?: string;
	title: string;
	pullRequestUrl?: string;
};

/** One row of a parent's breakdown: a part's card, or a part left out. */
type FactorySplitPartRow = {
	/** Its place in the breakdown, from 1. */
	number: number;
	title: string;
	omitted?: boolean;
	/** Absent for a part left out, or one with no card. */
	card?: FactorySplitCard & { label: string; tone: FactoryTone };
	/** A kept part with no card: being created, never created, or removed. */
	missing?: string;
};

/**
 * What a card page shows about its split, from the cards the board already
 * holds: the link facts its state reads, the card a part came from, a
 * parent's parts, and the earlier parts a waiting part needs merged.
 */
export type FactorySplitContext = {
	links: FactoryCardLinks;
	parent?: FactorySplitCard;
	parts?: FactorySplitPartRow[];
	waitingOn?: FactorySplitCard[];
};

/**
 * The split context of `task`, or undefined for a card that is neither a
 * parent nor a part. `card` reads another card's activity and PR link.
 */
export function factorySplitContext(
	task: AgendaTaskRecord,
	{
		tasks,
		links,
		card,
	}: {
		tasks: ReadonlyMap<string, AgendaTaskRecord>;
		links: FactoryCardLinks;
		card: (task: AgendaTaskRecord) => {
			activity: FactoryActivity;
			pullRequestUrl?: string;
			pullRequestOutcome?: Parameters<
				typeof FACTORY_PROOF.pullRequestOutcome
			>[0];
		};
	},
): FactorySplitContext | undefined {
	const named = (other: AgendaTaskRecord): FactorySplitCard => ({
		taskId: other.taskId,
		shortId: factoryShortId(other),
		title: other.title,
		...(card(other).pullRequestUrl
			? { pullRequestUrl: card(other).pullRequestUrl }
			: {}),
	});
	const split = task.factorySplit;
	if (split)
		return {
			links,
			parts: split.parts.map((part, index) => {
				const other = tasks.get(part.taskId);
				const row = { number: index + 1, title: part.title };
				if (part.omitted) return { ...row, omitted: true };
				if (!other)
					return {
						...row,
						missing: split.createdAt
							? FACTORY_SPLIT.removed
							: split.cancelledAt
								? FACTORY_SPLIT.notCreated
								: FACTORY_SPLIT.creating,
					};
				const { activity, pullRequestOutcome } = card(other);
				return {
					...row,
					card: {
						...named(other),
						label: other.archivedAt
							? FACTORY_SPLIT.archived
							: other.status === "cancelled" || other.status === "expired"
								? factoryHistoryStatus({ status: other.status })
								: pullRequestOutcome
									? FACTORY_PROOF.pullRequestOutcome(pullRequestOutcome)
									: activity.label,
						tone: activity.tone,
					},
				};
			}),
		};
	const parent = task.factoryParentTaskId
		? tasks.get(task.factoryParentTaskId)
		: undefined;
	if (!parent && !task.factoryBlockedBy) return undefined;
	const waitingOn = (task.factoryBlockedBy?.taskIds ?? [])
		.filter((taskId) => !task.factoryBlockedBy?.met[taskId])
		.flatMap((taskId) => {
			const other = tasks.get(taskId);
			return other ? [named(other)] : [];
		});
	return {
		links,
		...(parent ? { parent: named(parent) } : {}),
		...(waitingOn.length ? { waitingOn } : {}),
	};
}

/**
 * "Part of F40" on a part, linking to the card it came from, as a tracker
 * shows a sub-issue's parent. `compact` is the board card's form: the id only.
 */
export function FactoryParentLink({
	parent,
	onOpen,
	compact = false,
	className,
}: {
	parent: FactorySplitCard;
	onOpen?: (taskId: string) => void;
	compact?: boolean;
	className?: string;
}) {
	const id = parent.shortId ?? parent.title;
	const label = compact ? id : FACTORY_SPLIT.partOf(id);
	return (
		<Button
			variant="link"
			data-factory-parent={parent.taskId}
			aria-label={FACTORY_SPLIT.openParent(id)}
			title={`${FACTORY_SPLIT.partOf(id)}: ${parent.title}`}
			className={cn(
				"h-auto gap-0.5 p-0 font-normal text-accent-foreground hover:underline has-[>svg]:px-0",
				compact ? "font-mono text-[10.5px]" : "text-xs",
				className,
			)}
			disabled={!onOpen}
			onClick={(event) => {
				event.stopPropagation();
				onOpen?.(parent.taskId);
			}}
		>
			<CornerLeftUp aria-hidden className="size-3" />
			{label}
		</Button>
	);
}

/**
 * A breakdown waiting for the person: the engine's facts for the kept parts
 * first (with today's spend from the limits the board holds), then each
 * part with its scope and order, then the scoper's reason. Unchecked parts
 * are `omit`; the card's footer approves the rest or keeps it as one card.
 */
export function FactoryBreakdownApproval({
	config,
	split,
	limits,
	busy,
	omit,
	onOmitChange,
}: {
	config: NonNullable<AgendaTaskRecord["factory"]>;
	split: FactoryDesignSplit;
	limits: FactoryLimits | undefined;
	busy: boolean;
	omit: number[];
	onOmitChange: (omit: number[]) => void;
}) {
	const facts = factorySplitApprovalFacts({
		config,
		split,
		omit,
		...(limits?.supported
			? {
					dailyCostUsd: limits.dailyCostUsd,
					spentTodayUsd: limits.spentTodayUsd,
				}
			: {}),
	});
	return (
		<section
			aria-label={FACTORY_SPLIT.approvalTitle(split.parts.length)}
			data-factory-breakdown
			className="space-y-3 rounded-lg border border-primary/30 px-5 py-4"
		>
			<h3 className="text-sm font-semibold">
				{FACTORY_SPLIT.approvalTitle(split.parts.length)}
			</h3>
			<ul
				data-factory-breakdown-facts
				className="list-disc space-y-1 pl-5 text-sm"
			>
				{facts.map((fact) => (
					<li key={fact}>{fact}</li>
				))}
			</ul>
			<ol className="divide-y rounded-md border">
				{split.parts.map((part, index) => {
					const number = index + 1;
					const kept = !omit.includes(index);
					const id = `factory-part-${number}`;
					const scope = part.brief.split("\n").find((line) => line.trim());
					return (
						<li
							key={part.title}
							data-factory-breakdown-part={number}
							className="flex items-start gap-3 px-3 py-2.5"
						>
							<Checkbox
								id={id}
								className="mt-0.5"
								checked={kept}
								disabled={busy}
								aria-label={FACTORY_SPLIT.include(number, part.title)}
								onCheckedChange={(checked) =>
									onOmitChange(
										checked === true
											? omit.filter((item) => item !== index)
											: [...omit, index].sort((a, b) => a - b),
									)
								}
							/>
							<div
								className={cn(
									"min-w-0 flex-1 space-y-0.5",
									!kept && "text-muted-foreground",
								)}
							>
								<label
									htmlFor={id}
									className="block break-words text-sm font-medium"
								>
									<span className="mr-1.5 tabular-nums text-muted-foreground">
										{number}.
									</span>
									{part.title}
									{kept ? null : (
										<span className="ml-2 text-xs font-normal">
											· {FACTORY_SPLIT.leftOut}
										</span>
									)}
								</label>
								{scope ? (
									<p
										className="line-clamp-2 break-words text-xs text-muted-foreground"
										title={part.brief}
									>
										{scope.trim()}
									</p>
								) : null}
								{part.dependsOn.length ? (
									<p className="text-xs text-muted-foreground">
										{FACTORY_SPLIT.startsAfter(
											part.dependsOn.map((earlier) => earlier + 1),
										)}
									</p>
								) : null}
							</div>
						</li>
					);
				})}
			</ol>
			<div className="space-y-1">
				<h4 className="text-xs font-medium text-muted-foreground">
					{FACTORY_SPLIT.why}
				</h4>
				<p className="whitespace-pre-wrap break-words text-sm">
					{split.rationale}
				</p>
			</div>
		</section>
	);
}

/**
 * A parent's parts, in breakdown order, each with its state and PR, and the
 * one way to stop the rest: "Cancel remaining parts", confirmed first.
 */
export function FactoryPartsPanel({
	rows,
	summary,
	busy,
	onOpenCard,
	onCancelRemaining,
}: {
	rows: readonly FactorySplitPartRow[];
	summary: FactoryPartsSummary | undefined;
	busy: boolean;
	onOpenCard: (taskId: string) => void;
	onCancelRemaining?: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const open = summary?.open ?? 0;
	return (
		<Panel
			aria-label={FACTORY_SPLIT.partsTitle}
			title={FACTORY_SPLIT.partsTitle}
			description={FACTORY_SPLIT.progress(summary)}
			bodyClassName="px-0 py-0"
			actions={
				onCancelRemaining && open > 0 ? (
					<Button
						size="sm"
						variant="outline"
						className="text-error-text hover:border-destructive/60 hover:bg-destructive/10 hover:text-error-text"
						disabled={busy}
						onClick={() => setConfirming(true)}
					>
						{FACTORY_SPLIT.cancelRemaining}
					</Button>
				) : null
			}
		>
			<ol className="divide-y" data-factory-parts>
				{rows.map((row) => (
					<li
						key={row.number}
						data-factory-part={row.card?.taskId ?? row.number}
						className="flex flex-col gap-0.5 px-5 py-2.5"
					>
						<div className="flex min-w-0 items-baseline gap-2 text-sm">
							<span className="shrink-0 tabular-nums text-muted-foreground">
								{row.number}.
							</span>
							{row.card ? (
								<button
									type="button"
									className="min-w-0 rounded-sm text-left hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									onClick={() => row.card && onOpenCard(row.card.taskId)}
								>
									{row.card.shortId ? (
										<span className="mr-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
											{row.card.shortId}
										</span>
									) : null}
									<span className="break-words">{row.card.title}</span>
								</button>
							) : (
								<span className="min-w-0 break-words text-muted-foreground">
									{row.title}
								</span>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-xs">
							<span className="flex items-center gap-1.5 text-muted-foreground">
								{row.card ? (
									<span
										aria-hidden
										className={cn(
											"size-1.5 rounded-full",
											toneDot(row.card.tone),
										)}
									/>
								) : null}
								{row.omitted
									? FACTORY_SPLIT.leftOut
									: (row.card?.label ?? row.missing)}
							</span>
							{row.card?.pullRequestUrl ? (
								<Button
									variant="link"
									className="h-auto p-0 text-xs has-[>svg]:px-0"
									onClick={() =>
										row.card?.pullRequestUrl &&
										void openExternalUrl(row.card.pullRequestUrl)
									}
								>
									{FACTORY_SPLIT.openPr}
									<ArrowUpRight className="ml-0.5 size-3" />
								</Button>
							) : null}
						</div>
					</li>
				))}
			</ol>
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{FACTORY_SPLIT.cancelRemainingTitle(open)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{FACTORY_SPLIT.cancelRemainingDescription}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{FACTORY_SPLIT.keepParts}</AlertDialogCancel>
						<AlertDialogAction onClick={onCancelRemaining}>
							{FACTORY_SPLIT.cancelRemainingConfirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Panel>
	);
}
