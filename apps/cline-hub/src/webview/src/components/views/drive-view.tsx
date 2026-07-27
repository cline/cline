/**
 * Drive — the home for everything this fork adds on top of Cline.
 *
 * Drive Mode, Spotlight, and the Status Hub were previously reachable only from
 * scattered entry points (a button inside Chat, a nav item next to upstream
 * ones), which made the additions easy to miss. This page is the one surface
 * that names them together.
 */

import type { StatusState, StatusSummary } from "@cline/shared";
import {
	ActivityIcon,
	ArrowRightIcon,
	MonitorPlayIcon,
	PhoneIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postToHost } from "../../vscode";
import { DriveMarkIcon } from "../icons/drive-mark";
import { PageFrame, PageHeader } from "./page-layout";

const SNAPSHOT_STATES: readonly StatusState[] = [
	"blocked",
	"failed",
	"running",
	"queued",
];

const SNAPSHOT_STYLES: Record<string, string> = {
	blocked: "text-amber-600 dark:text-amber-400",
	failed: "text-destructive",
	running: "text-primary",
	queued: "text-muted-foreground",
};

function FeatureCard({
	icon: Icon,
	title,
	tagline,
	children,
	action,
}: {
	icon: typeof PhoneIcon;
	title: string;
	tagline: string;
	children: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<section className="flex flex-col rounded-lg border bg-card p-5">
			<div className="mb-2 flex items-center gap-2">
				<Icon className="size-4 shrink-0 text-primary" />
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
			</div>
			<p className="mb-3 text-sm font-medium text-foreground/80">{tagline}</p>
			<div className="flex-1 space-y-2 text-sm leading-6 text-muted-foreground">
				{children}
			</div>
			{action ? <div className="mt-4">{action}</div> : null}
		</section>
	);
}

export function DriveView({
	onOpenCall,
	onOpenStatus,
}: {
	onOpenCall: () => void;
	onOpenStatus: () => void;
}) {
	const [summary, setSummary] = useState<StatusSummary | null>(null);

	const requestSummary = useCallback(() => {
		postToHost({ type: "status_summary", requestId: "drive-summary" });
	}, []);

	useEffect(() => {
		requestSummary();
	}, [requestSummary]);

	useEffect(() => {
		function onMessage(event: MessageEvent) {
			const message = event.data as { type: string } & Record<string, unknown>;
			if (message.type === "status_summary_result") {
				setSummary(message.summary as StatusSummary);
			} else if (message.type === "status_updated") {
				requestSummary();
			}
		}
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [requestSummary]);

	const blocked = summary?.byState.blocked ?? 0;

	return (
		<PageFrame>
			<PageHeader
				description="Drive coding: you stay on a call with an agent while it works, watch what it is doing, and steer. Everything this fork adds to Cline lives here."
				icon={DriveMarkIcon}
				title="Drive"
				actions={
					<Button onClick={onOpenCall} size="sm" type="button">
						<PhoneIcon className="size-3.5" />
						Start a Drive call
					</Button>
				}
			/>

			{/* Status snapshot first: if something is blocked, that is the most
			    useful thing this page can tell you. */}
			{summary ? (
				<button
					className={cn(
						"mb-6 flex w-full flex-wrap items-center gap-6 rounded-lg border bg-card px-5 py-4 text-left transition-colors hover:bg-muted/40",
						blocked > 0 && "border-amber-500/40",
					)}
					onClick={onOpenStatus}
					type="button"
				>
					{SNAPSHOT_STATES.map((state) => (
						<div key={state}>
							<div
								className={cn(
									"text-2xl font-semibold tabular-nums",
									SNAPSHOT_STYLES[state],
								)}
							>
								{summary.byState[state] ?? 0}
							</div>
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground">
								{state}
							</div>
						</div>
					))}
					<div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
						{blocked > 0
							? `${blocked} blocked ${blocked === 1 ? "item needs" : "items need"} you`
							: "Nothing is blocked"}
						<ArrowRightIcon className="size-3.5" />
					</div>
				</button>
			) : null}

			<div className="grid gap-4 md:grid-cols-3">
				<FeatureCard
					action={
						<Button
							onClick={onOpenCall}
							size="sm"
							type="button"
							variant="outline"
						>
							Join a call
						</Button>
					}
					icon={PhoneIcon}
					tagline="Pair with an agent instead of prompting it."
					title="Drive Mode"
				>
					<p>
						A call room where you and one or more agents work together. The
						agent narrates decisions rather than keystrokes; you steer,
						interrupt, and raise a hand.
					</p>
					<p>
						Four sub-modes — <strong>plan</strong>, <strong>agent</strong>,{" "}
						<strong>ask</strong>, <strong>debug</strong> — map onto Cline's
						native plan/act.
					</p>
				</FeatureCard>

				<FeatureCard
					icon={MonitorPlayIcon}
					tagline="See who is sharing, and what."
					title="Spotlight"
				>
					<p>
						The shared surface inside a call. The agent puts its work on it —
						edits, commands, test results, plan steps — and you can take the
						spotlight yourself to pin a selection, a file, or terminal output.
					</p>
					<p>
						Events, not pixels: everyone in the room renders the same event
						stream, so there is no screen-capture to set up.
					</p>
				</FeatureCard>

				<FeatureCard
					action={
						<Button
							onClick={onOpenStatus}
							size="sm"
							type="button"
							variant="outline"
						>
							Open Status Hub
						</Button>
					}
					icon={ActivityIcon}
					tagline="A changelog for every agent."
					title="Status Hub"
				>
					<p>
						Agents publish where they are as they work. The Board shows where
						everything stands, most urgent first; the Changelog shows everything
						that has happened.
					</p>
					<p>
						Urgent updates interrupt you; the rest wait to be found — so agents
						can report often without becoming noise.
					</p>
				</FeatureCard>
			</div>

			{summary && summary.byAgent.length > 0 ? (
				<section className="mt-6 rounded-lg border bg-card p-5">
					<h2 className="mb-3 text-base font-semibold text-foreground">
						Agents reporting
					</h2>
					<div className="flex flex-wrap gap-2">
						{summary.byAgent.map((agent) => (
							<div
								className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
								key={agent.agentId}
							>
								<span className="font-medium text-foreground">
									{agent.agentName ?? agent.agentId}
								</span>
								<span className="text-xs text-muted-foreground">
									{agent.total} active
								</span>
								{agent.blocked > 0 ? (
									<Badge
										className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400"
										variant="outline"
									>
										{agent.blocked} blocked
									</Badge>
								) : null}
							</div>
						))}
					</div>
				</section>
			) : null}
		</PageFrame>
	);
}
