"use client";

import {
	type FactoryRepositoryStage,
	factoryStageCanonicalJson,
} from "@cline/shared/browser";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { FACTORY_STAGES } from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import { type FactoryTone, StatusPill, toneText } from "./factory-ui";

type TrustStatus = "approved" | "needs_approval" | "changed" | "declined";

/** What `factory_get_stages` and `factory_decide_stage` return. */
type FactoryStagesListing =
	| { supported: false }
	| {
			supported?: undefined;
			file: "absent" | "present" | "invalid";
			reason?: string;
			stages: {
				stage: FactoryRepositoryStage;
				hash: string;
				status: TrustStatus;
			}[];
	  };

type ProjectStages =
	| { loading: true }
	| { loading: false; listing?: FactoryStagesListing; error?: string };

const TRUST_TONE: Record<TrustStatus, FactoryTone> = {
	approved: "success",
	needs_approval: "attention",
	changed: "attention",
	declined: "neutral",
};

const awaitsDecision = (status: TrustStatus) =>
	status === "needs_approval" || status === "changed";

/**
 * Each project's repository stages, read once per project list, and the one
 * decision per stage. Settings keeps this state so the Projects count and
 * the list are the same read, and a decision updates both.
 */
export function useFactoryStages(projects: readonly string[]) {
	const [states, setStates] = useState<Record<string, ProjectStages>>({});
	const [deciding, setDeciding] = useState<string>();
	const key = projects.join("\0");

	useEffect(() => {
		let active = true;
		const roots = key ? key.split("\0") : [];
		setStates(
			Object.fromEntries(roots.map((root) => [root, { loading: true }])),
		);
		for (const root of roots)
			void desktopClient
				.invoke<FactoryStagesListing>("factory_get_stages", {
					workspaceRoot: root,
				})
				.then(
					(listing): ProjectStages => ({ loading: false, listing }),
					(): ProjectStages => ({
						loading: false,
						error: FACTORY_STAGES.readFailed,
					}),
				)
				.then((next) => {
					if (active) setStates((current) => ({ ...current, [root]: next }));
				});
		return () => {
			active = false;
		};
	}, [key]);

	const decide = useCallback(
		async (
			workspaceRoot: string,
			stageId: string,
			hash: string,
			decision: "approved" | "declined",
		) => {
			setDeciding(`${workspaceRoot}\0${stageId}`);
			try {
				const listing = await desktopClient.invoke<FactoryStagesListing>(
					"factory_decide_stage",
					{ workspaceRoot, stageId, expectedHash: hash, decision },
				);
				setStates((current) => ({
					...current,
					[workspaceRoot]: { loading: false, listing },
				}));
			} catch {
				setStates((current) => ({
					...current,
					[workspaceRoot]: {
						...(current[workspaceRoot] ?? { loading: false }),
						loading: false,
						error: FACTORY_STAGES.decideFailed,
					},
				}));
			} finally {
				setDeciding(undefined);
			}
		},
		[],
	);

	// Stages awaiting a decision (new, or changed since approval), for the
	// Projects item's count.
	const awaiting = projects.reduce((sum, root) => {
		const state = states[root];
		const listing = state && !state.loading ? state.listing : undefined;
		return listing && listing.supported !== false
			? sum +
					listing.stages.filter((entry) => awaitsDecision(entry.status)).length
			: sum;
	}, 0);
	return { states, decide, deciding, awaiting };
}

export type FactoryStages = ReturnType<typeof useFactoryStages>;

/**
 * One project's repository stages as settings rows: name, kind and when it
 * runs, its status, the definition, and one action: Approve (exactly the
 * definition shown, by hash) or Stop using. A row whose action is Approve
 * always shows the whole definition it hashes; an approved one keeps it
 * behind a disclosure. Nothing here prompts or blocks a card.
 */
export function FactoryStagesSettings({
	workspaceRoot,
	stages,
}: {
	workspaceRoot: string;
	stages: FactoryStages;
}) {
	const state = stages.states[workspaceRoot];
	if (!state || state.loading) return null;
	if (state.listing?.supported === false)
		return <Note>{FACTORY_STAGES.unsupported}</Note>;
	const listing = state.listing;
	return (
		<>
			{state.error ? (
				<Note className={toneText("danger")} alert>
					{state.error}
				</Note>
			) : null}
			{listing?.file === "invalid" ? (
				<Note className={toneText("attention")}>
					{FACTORY_STAGES.invalid(listing.reason ?? "")}
				</Note>
			) : listing && !listing.stages.length ? (
				<Note>{FACTORY_STAGES.empty}</Note>
			) : (
				listing?.stages.map((entry) => (
					<StageRow
						key={entry.stage.id}
						{...entry}
						busy={stages.deciding === `${workspaceRoot}\0${entry.stage.id}`}
						onDecide={(decision) =>
							void stages.decide(
								workspaceRoot,
								entry.stage.id,
								entry.hash,
								decision,
							)
						}
					/>
				))
			)}
		</>
	);
}

function Note({
	children,
	className,
	alert,
}: {
	children: string;
	className?: string;
	alert?: boolean;
}) {
	return (
		<p
			role={alert ? "alert" : undefined}
			className={cn("border-b py-3 text-xs text-muted-foreground", className)}
		>
			{children}
		</p>
	);
}

function StageRow({
	stage,
	status,
	busy,
	onDecide,
}: {
	stage: FactoryRepositoryStage;
	status: TrustStatus;
	busy: boolean;
	onDecide: (decision: "approved" | "declined") => void;
}) {
	const [open, setOpen] = useState(() => awaitsDecision(status));
	// Approve trusts the stage by the hash of this canonical JSON, so all of
	// it is on screen whenever Approve is.
	const approving = status !== "approved";
	const shown = open || approving;
	const definitionId = `factory-stage-${stage.id}-definition`;
	return (
		<div className="border-b py-3 text-sm" data-status={status}>
			<div className="flex items-start justify-between gap-5">
				<div className="min-w-0">
					<button
						type="button"
						aria-expanded={shown}
						aria-controls={definitionId}
						disabled={approving}
						onClick={() => setOpen((value) => !value)}
						className="-ml-0.5 flex items-center gap-1 rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
					<p className="mt-0.5 text-xs text-muted-foreground">
						{[
							FACTORY_STAGES.kind[
								stage.kind === "command" ? "command" : (stage.access ?? "read")
							],
							FACTORY_STAGES.when(stage.when?.paths, stage.when?.minSize),
							stage.blocking === false ? FACTORY_STAGES.notBlocking : undefined,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<StatusPill tone={TRUST_TONE[status]}>
						{FACTORY_STAGES.trust[status]}
					</StatusPill>
					<Button
						size="sm"
						variant={status === "approved" ? "ghost" : "outline"}
						disabled={busy}
						onClick={() =>
							onDecide(status === "approved" ? "declined" : "approved")
						}
					>
						{status === "approved"
							? FACTORY_STAGES.stopUsing
							: FACTORY_STAGES.approve}
					</Button>
				</div>
			</div>
			<pre
				id={definitionId}
				hidden={!shown}
				className="mt-2 max-w-[470px] whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 font-mono text-xs"
			>
				{JSON.stringify(JSON.parse(factoryStageCanonicalJson(stage)), null, 2)}
			</pre>
			{approving ? (
				<p className="mt-1.5 text-xs text-muted-foreground">
					{FACTORY_STAGES.approveRunsAsYou}
				</p>
			) : null}
		</div>
	);
}
