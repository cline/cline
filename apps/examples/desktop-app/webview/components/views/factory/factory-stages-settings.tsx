"use client";

import {
	type FactoryRepositoryStage,
	type FactoryWorkflowConfig,
	factoryStageCanonicalJson,
} from "@cline/shared/browser";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { factoryModelLabel } from "@/lib/factory-copy";
import type { FactoryStageTrust } from "@/lib/factory-settings-client";
import { FS_STAGES } from "@/lib/factory-settings-copy/stages";
import { cn } from "@/lib/utils";
import { type FactoryTone, StatusPill } from "./factory-ui";

const S = FS_STAGES;

const TRUST_TONE: Record<FactoryStageTrust, FactoryTone> = {
	approved: "success",
	needs_approval: "attention",
	changed: "attention",
	declined: "neutral",
};

/**
 * "Command · when src/auth/** changes · blocks delivery": what a stage is,
 * when it runs and whether a failure stops delivery.
 */
export function factoryStageSummary(stage: FactoryRepositoryStage): string {
	return [
		S.kind[stage.kind === "command" ? "command" : (stage.access ?? "read")],
		S.when(stage.when?.paths, stage.when?.minSize),
		stage.blocking === false ? S.notBlocking : S.blocks,
	].join(" · ");
}

/**
 * The model an agent stage runs on: the first code reviewer's for a
 * read-only stage, the first builder's for one that edits (as core's
 * `factoryAgentStageAgent` picks it), read from the default workflow.
 */
function agentStageModel(
	stage: Extract<FactoryRepositoryStage, { kind: "agent" }>,
	config: FactoryWorkflowConfig | undefined,
): string {
	const write = stage.access === "write";
	const agent = write
		? config?.agents?.implementers?.[0]
		: config?.agents?.reviewers?.[0];
	const selection = agent?.modelSelection;
	return S.agentModel(
		S.agentRole[write ? "write" : "read"],
		selection ? factoryModelLabel(selection) : "",
	);
}

/**
 * A stage's canonical JSON (what its hash covers) for reading: one key per
 * line, nested values on that line, as in the stages file.
 */
export function factoryStageDefinitionText(
	stage: FactoryRepositoryStage,
): string {
	const canonical = JSON.parse(factoryStageCanonicalJson(stage)) as Record<
		string,
		unknown
	>;
	// Indented JSON with its line breaks folded: strings keep theirs escaped.
	const inline = (value: unknown) =>
		JSON.stringify(value, null, 1).replace(/\n\s*/g, " ");
	const lines = Object.entries(canonical).map(
		([key, value]) => `  ${JSON.stringify(key)}: ${inline(value)}`,
	);
	return `{\n${lines.join(",\n")}\n}`;
}

/**
 * The fixed five stages of every card, with the slot after Build where a
 * project's own stages run. Explanatory only: a labelled figure, no
 * controls. Under 700px of content width (a 1100 window, or docked) the second lines go, except the
 * repository slot's.
 */
export function FactoryStageLine() {
	let number = 0;
	return (
		<div
			role="img"
			aria-label={S.lineLabel}
			data-stage-line=""
			className="mt-3 grid grid-cols-6 overflow-hidden rounded-lg border bg-card"
		>
			{S.line.map((item) => {
				const slot = item.id === "repository";
				if (!slot) number += 1;
				return (
					<div
						key={item.id}
						data-stage-line-item={item.id}
						className={cn(
							"min-w-0 border-l px-3 py-2.5 first:border-l-0 @max-[720px]/settings:px-2",
							slot && "bg-primary/10",
						)}
					>
						<p
							className={cn(
								"text-xs font-semibold leading-[18px]",
								slot && "text-primary",
							)}
						>
							{slot ? item.name : `${number} ${item.name}`}
						</p>
						<p
							className={cn(
								"mt-0.5 text-[11.5px] leading-[15px] text-muted-foreground",
								!slot && "@max-[700px]/settings:hidden",
							)}
						>
							{item.detail}
						</p>
					</div>
				);
			})}
		</div>
	);
}

/**
 * One repository stage as a settings row: its name (which shows or hides
 * the definition), what it is and when it runs, its status, exactly one
 * action (Approve, or Stop using once in use) and a menu of Ask Factory
 * drafts. Approve trusts the stage by the hash of its canonical JSON, so
 * the whole definition is on screen whenever Approve is.
 */
export function FactoryStageRow({
	stage,
	status,
	project,
	config,
	busy,
	disabled,
	error,
	onDecide,
	onAsk,
}: {
	stage: FactoryRepositoryStage;
	status: FactoryStageTrust;
	/** The project's name, for the Ask Factory drafts. */
	project: string;
	/** The default workflow: an agent stage's model. */
	config?: FactoryWorkflowConfig;
	busy: boolean;
	disabled: boolean;
	error?: string;
	onDecide: (decision: "approved" | "declined") => void;
	onAsk: (draft: string) => void;
}) {
	const approving = status !== "approved";
	const [open, setOpen] = useState(approving);
	const shown = open || approving;
	const id = `stage-${stage.id}`;
	const definitionId = `${id}-definition`;
	return (
		<div
			data-setting={id}
			data-status={status}
			className="border-b py-3 text-sm"
		>
			<div className="flex items-start justify-between gap-4 @max-[460px]/settings:flex-col @max-[460px]/settings:gap-2">
				<div className="min-w-0 flex-1">
					<button
						type="button"
						id={`${id}-title`}
						aria-expanded={shown}
						aria-controls={definitionId}
						aria-describedby={`${id}-description`}
						// While Approve is offered the definition stays open: the
						// person approves only what they can read.
						disabled={approving}
						onClick={() => setOpen((value) => !value)}
						className="-ml-0.5 flex items-center gap-1 rounded-sm text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
					>
						<ChevronRight
							aria-hidden
							className={cn(
								"size-3.5 shrink-0 text-muted-foreground transition-transform",
								shown && "rotate-90",
							)}
						/>
						{stage.name}
					</button>
					<p
						id={`${id}-description`}
						className="mt-0.5 pl-[18px] text-xs text-muted-foreground"
					>
						{factoryStageSummary(stage)}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2 @max-[460px]/settings:pl-[18px]">
					<StatusPill tone={TRUST_TONE[status]}>{S.trust[status]}</StatusPill>
					<Button
						size="xs"
						variant={approving ? "default" : "ghost"}
						className="h-[26px] px-2.5 text-xs"
						disabled={busy || disabled}
						aria-describedby={`${id}-title`}
						onClick={() => onDecide(approving ? "approved" : "declined")}
					>
						{approving ? S.approve : S.stopUsing}
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="xs"
								className="h-[26px] w-[26px] px-0 text-muted-foreground"
								aria-label={S.moreActions(stage.name)}
								disabled={disabled}
							>
								<MoreHorizontal aria-hidden className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								onSelect={() => onAsk(S.changeDraft(stage.name, project))}
							>
								{S.change}
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => onAsk(S.removeDraft(stage.name, project))}
							>
								{S.remove}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{error ? (
				<p role="alert" className="mt-1.5 pl-[18px] text-xs text-destructive">
					{error}
				</p>
			) : null}
			<div id={definitionId} hidden={!shown} className="mt-2.5">
				<pre
					data-stage-definition=""
					className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-card px-3 py-2.5 font-mono text-xs leading-[18px]"
				>
					{factoryStageDefinitionText(stage)}
				</pre>
				<p className="mt-2 max-w-[640px] text-xs text-muted-foreground">
					{stage.kind === "command"
						? approving
							? S.approveRunsAsYou
							: S.runsAsYou
						: agentStageModel(stage, config)}{" "}
					{S.coversDefinition}
				</p>
			</div>
		</div>
	);
}
