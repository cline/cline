import { useMemo, useState } from "react";
import type { ChatForkRecord } from "@cline/shared";
import { Button } from "@/components/ui/button";
import { ChatForkAuditPanel } from "./ChatForkAuditPanel";
import { StickyStagePane } from "./StickyStagePane";
import {
	DEFAULT_DRIVE_UI,
	DRIVE_PARTICIPANT_PARTNER,
	type DriveUiState,
} from "./types";

type ChatForkDemoBeat = {
	id: string;
	label: string;
	forks: ChatForkRecord[];
	showTitle: string;
	showCaption: string;
	promoteSummary?: string;
};

const DEMO_FORKS_RUNNING: ChatForkRecord[] = [
	{
		workerSessionId: "demo-worker-a",
		lifecycle: "running",
		seed: {
			doItemId: "do-auth",
			title: "Fix auth flake",
			goal: "Stabilize login test",
			parentBriefing: "Keep auth green while director plans next demos",
			assigneeParticipantId: "drive:partner",
			allowedPathPrefixes: ["src/auth"],
			linkedShowTemplateIds: ["work.card"],
			workspace: { mode: "path_disjoint" },
			parentSessionId: "demo-main",
		},
		promote: null,
		visibleToHuman: false,
	},
	{
		workerSessionId: "demo-worker-b",
		lifecycle: "running",
		seed: {
			doItemId: "do-docs",
			title: "Draft architecture card",
			goal: "Enqueue diagram for Spotlight",
			parentBriefing: "Show backlog should fill while workers run",
			assigneeParticipantId: "drive:partner",
			allowedPathPrefixes: ["docs"],
			linkedShowTemplateIds: ["diagram.architecture"],
			workspace: { mode: "path_disjoint" },
			parentSessionId: "demo-main",
		},
		promote: null,
		visibleToHuman: false,
	},
];

const BEATS: ChatForkDemoBeat[] = [
	{
		id: "claim",
		label: "Workers claimed",
		forks: DEMO_FORKS_RUNNING,
		showTitle: "Show backlog building",
		showCaption: "Two path-disjoint workers run while director ranks demos.",
	},
	{
		id: "show",
		label: "Show ready",
		forks: DEMO_FORKS_RUNNING,
		showTitle: "Architecture diagram",
		showCaption: "Worker B enqueued a sticky diagram into the Show backlog.",
	},
	{
		id: "promote",
		label: "Promoted",
		forks: [
			{
				...DEMO_FORKS_RUNNING[0]!,
				lifecycle: "archived",
				promote: {
					workerSessionId: "demo-worker-a",
					doItemId: "do-auth",
					status: "done",
					summary: "Auth flake fixed with waitFor network idle.",
					decisions: ["Prefer waitFor over sleep"],
					showItemIds: ["show-auth"],
					eventRefs: [],
					auditHandle: "demo-worker-a",
					retainForAudit: true,
				},
			},
			{
				...DEMO_FORKS_RUNNING[1]!,
				lifecycle: "dropped",
				promote: {
					workerSessionId: "demo-worker-b",
					doItemId: "do-docs",
					status: "done",
					summary: "Architecture card presented.",
					decisions: [],
					showItemIds: ["show-arch"],
					eventRefs: [],
					auditHandle: "demo-worker-b",
					retainForAudit: false,
				},
			},
		],
		showTitle: "Architecture diagram (sticky)",
		showCaption: "Promote injected one summary into main; worker B messages dropped.",
		promoteSummary: "Auth flake fixed with waitFor network idle.",
	},
];

export function ChatForkDemo() {
	const [beatIndex, setBeatIndex] = useState(0);
	const [workersOpen, setWorkersOpen] = useState(true);
	const [focused, setFocused] = useState<string | null>(null);
	const beat = BEATS[beatIndex] ?? BEATS[0]!;
	const drive: DriveUiState = useMemo(
		() => ({
			...DEFAULT_DRIVE_UI,
			active: true,
			stageLayout: true,
			spotlightParticipantId: DRIVE_PARTICIPANT_PARTNER,
			demo: true,
		}),
		[],
	);

	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
			<header className="space-y-1">
				<p className="text-xs uppercase tracking-wide text-muted-foreground">
					ChatFork demo · /drive?demoChatFork=1
				</p>
				<h1 className="text-xl font-semibold">Invisible workers, reactive share</h1>
				<p className="text-sm text-muted-foreground">
					Claim path-disjoint workers, fill the Show backlog, promote summaries
					back — without parallel chat tabs.
				</p>
			</header>
			<div className="flex flex-wrap gap-2">
				{BEATS.map((entry, index) => (
					<Button
						key={entry.id}
						onClick={() => {
							setBeatIndex(index);
							setFocused(null);
						}}
						size="sm"
						type="button"
						variant={index === beatIndex ? "default" : "outline"}
					>
						{entry.label}
					</Button>
				))}
				<Button
					onClick={() => setWorkersOpen((value) => !value)}
					size="sm"
					type="button"
					variant="ghost"
				>
					{workersOpen ? "Hide workers" : "Workers"}
				</Button>
			</div>
			<StickyStagePane
				caption={beat.showCaption}
				drive={drive}
				title={beat.showTitle}
			/>
			{beat.promoteSummary ? (
				<p className="rounded border border-border bg-muted/40 p-3 text-sm">
					Main context inject: {beat.promoteSummary}
				</p>
			) : null}
			<ChatForkAuditPanel
				auditMessages={
					focused
						? [{ role: "assistant", content: "Worker transcript retained for audit." }]
						: []
				}
				focusedAuditHandle={focused}
				forks={beat.forks}
				onClose={() => setWorkersOpen(false)}
				onOpenAudit={setFocused}
				onRetain={() => undefined}
				open={workersOpen}
				summaryOnly={
					beat.forks.find((fork) => fork.workerSessionId === focused)
						?.lifecycle === "dropped"
				}
			/>
		</div>
	);
}
