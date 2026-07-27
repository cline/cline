/**
 * Events-first Spotlight surface for Drive Mode Chat — who is sharing right now.
 * Live rooms render hub roomSnapshot.stage; offline/demo may use fixtures.
 * `stage` on the wire is the hub-side name for the same thing.
 */

import type { StageCard, StagePin } from "@cline/shared";
import type { ReactNode } from "react";
import {
	CodeBlock,
	CodeBlockCopyButton,
	CodeBlockFilename,
	CodeBlockHeader,
	CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import {
	Terminal,
	TerminalContent,
	TerminalHeader,
	TerminalTitle,
} from "@/components/ai-elements/terminal";
import {
	Test,
	TestName,
	TestResults,
	TestResultsContent,
	TestResultsHeader,
	TestResultsSummary,
	TestStatus,
} from "@/components/ai-elements/test-results";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SpotlightHumanPin = Pick<StagePin, "kind" | "label"> & {
	ref?: string;
};

export type SpotlightViewProps = {
	cards: readonly StageCard[];
	/** Who holds the spotlight (agent partner or You). */
	sharerLabel: string;
	demo?: boolean;
	/** Structured human share when you take the spotlight (hub pin). */
	humanPin?: SpotlightHumanPin | null;
	/** When true, agent work cards are dimmed under the human pin. */
	humanSharing?: boolean;
	nowLabel?: string;
	nextLabel?: string;
	emptyHint?: string;
	className?: string;
	children?: ReactNode;
};

function languageFromTitle(title: string): string {
	const lower = title.toLowerCase();
	if (lower.endsWith(".tsx")) return "tsx";
	if (lower.endsWith(".ts")) return "typescript";
	if (lower.endsWith(".jsx")) return "jsx";
	if (lower.endsWith(".js")) return "javascript";
	if (lower.endsWith(".json")) return "json";
	if (lower.endsWith(".md")) return "markdown";
	if (lower.endsWith(".py")) return "python";
	if (lower.endsWith(".css")) return "css";
	if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
	if (lower.endsWith(".html")) return "html";
	return "typescript";
}

function testStatusFromSummary(
	summary: string | undefined,
): "passed" | "failed" | "running" {
	const text = (summary ?? "").toLowerCase();
	if (
		text.includes("fail") ||
		text.includes("error") ||
		text.includes("✗") ||
		text.includes("×")
	) {
		return "failed";
	}
	if (text.includes("running") || text.includes("pending")) {
		return "running";
	}
	return "passed";
}

function EditStageCard({ card }: { card: StageCard }) {
	const code = card.summary?.trim() || `// ${card.title}`;
	const language = languageFromTitle(card.title);
	return (
		<CodeBlock code={code} language={language} showLineNumbers={false}>
			<CodeBlockHeader>
				<CodeBlockTitle>
					<Badge className="text-[10px] uppercase" variant="outline">
						edit
					</Badge>
					<CodeBlockFilename>{card.title}</CodeBlockFilename>
				</CodeBlockTitle>
				<CodeBlockCopyButton />
			</CodeBlockHeader>
		</CodeBlock>
	);
}

function CommandStageCard({ card }: { card: StageCard }) {
	const output = card.summary?.trim() || card.title;
	return (
		<Terminal isStreaming={false} output={output}>
			<TerminalHeader>
				<TerminalTitle>
					<span className="mr-2 inline-flex">
						<Badge className="text-[10px] uppercase" variant="outline">
							command
						</Badge>
					</span>
					{card.title}
				</TerminalTitle>
			</TerminalHeader>
			{/* Plain children avoid ansi-to-react default-import ESM quirk in TerminalContent. */}
			<TerminalContent>
				<pre className="whitespace-pre-wrap break-words text-zinc-100">{output}</pre>
			</TerminalContent>
		</Terminal>
	);
}

function TestStageCard({ card }: { card: StageCard }) {
	const status = testStatusFromSummary(card.summary);
	const summary =
		status === "failed"
			? { passed: 0, failed: 1, skipped: 0, total: 1 }
			: status === "running"
				? { passed: 0, failed: 0, skipped: 0, total: 1 }
				: { passed: 1, failed: 0, skipped: 0, total: 1 };

	return (
		<TestResults summary={summary}>
			<TestResultsHeader>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Badge className="text-[10px] uppercase" variant="outline">
						test
					</Badge>
					<span className="truncate font-mono text-xs">{card.title}</span>
				</div>
				<TestResultsSummary />
			</TestResultsHeader>
			<TestResultsContent>
				<Test status={status}>
					<TestStatus />
					<TestName>{card.summary ?? card.title}</TestName>
				</Test>
			</TestResultsContent>
		</TestResults>
	);
}

function StageCardView({ card }: { card: StageCard }) {
	switch (card.category) {
		case "edit":
			return <EditStageCard card={card} />;
		case "command":
			return <CommandStageCard card={card} />;
		case "test":
			return <TestStageCard card={card} />;
		case "plan":
		case "decision":
		case "other":
			return (
				<div className="rounded-md border bg-background p-2">
					<div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
						<span className="rounded border px-1.5 py-0.5">{card.category}</span>
						<span className="truncate font-medium normal-case text-foreground">
							{card.title}
						</span>
					</div>
					{card.summary ? (
						<pre className="mt-1 overflow-auto font-mono text-[11px] text-muted-foreground">
							{card.summary}
						</pre>
					) : null}
				</div>
			);
		default: {
			const _exhaustive: never = card.category;
			return _exhaustive;
		}
	}
}

function HumanPinContent({ pin }: { pin: SpotlightHumanPin }) {
	const body = pin.ref?.trim() || pin.label;
	switch (pin.kind) {
		case "selection":
			return (
				<div className="rounded-md border border-amber-500/40 bg-amber-500/5">
					<div className="flex items-center gap-2 border-b border-amber-500/20 px-3 py-2 text-[10px] uppercase tracking-wide text-amber-800 dark:text-amber-200">
						<span className="rounded border border-amber-500/40 px-1.5 py-0.5">
							selection
						</span>
						<span className="truncate normal-case text-foreground">{pin.label}</span>
					</div>
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-foreground">
						{body}
					</pre>
				</div>
			);
		case "file":
			return (
				<div className="rounded-md border bg-background">
					<div className="flex items-center gap-2 border-b px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
						<span className="rounded border px-1.5 py-0.5">file</span>
						<span className="truncate font-mono normal-case text-foreground">
							{pin.label}
						</span>
					</div>
					<pre className="overflow-auto p-3 font-mono text-[11px] text-muted-foreground">
						{body}
					</pre>
				</div>
			);
		case "terminal":
			return (
				<Terminal isStreaming={false} output={body}>
					<TerminalHeader>
						<TerminalTitle>
							<span className="mr-2 inline-flex">
								<Badge className="text-[10px] uppercase" variant="outline">
									terminal
								</Badge>
							</span>
							{pin.label}
						</TerminalTitle>
					</TerminalHeader>
					<TerminalContent>
						<pre className="whitespace-pre-wrap break-words text-zinc-100">
							{body}
						</pre>
					</TerminalContent>
				</Terminal>
			);
		default: {
			const _exhaustive: never = pin.kind;
			return _exhaustive;
		}
	}
}

/**
 * Full spotlight column: sharer header, cards, optional now/next strip.
 * Prefer this over DriveStagePanel + DriveStageCards for live projection.
 */
export function Spotlight({
	cards,
	sharerLabel,
	demo,
	humanPin,
	humanSharing,
	nowLabel,
	nextLabel,
	emptyHint = "Waiting for partner tool activity on this session.",
	className,
	children,
}: SpotlightViewProps) {
	const showHumanPrimary = Boolean(humanPin) && (humanSharing || Boolean(humanPin));
	const suppressAgentCards = Boolean(humanPin) && humanSharing !== false;

	return (
		<div
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col border-l bg-muted/20",
				className,
			)}
		>
			<div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
				<span className="text-emerald-600 dark:text-emerald-400">
					● in the spotlight
				</span>
				<span className="truncate font-medium text-foreground">{sharerLabel}</span>
				{demo ? (
					<Badge className="ml-auto shrink-0 text-[10px]" variant="outline">
						Demo fixture
					</Badge>
				) : (
					<Badge className="ml-auto shrink-0 text-[10px]" variant="outline">
						{showHumanPrimary ? "Human share" : "Live room"}
					</Badge>
				)}
			</div>
			<div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
				{humanPin ? <HumanPinContent pin={humanPin} /> : null}
				{cards.length === 0 && !humanPin ? (
					<p className="text-xs text-muted-foreground">{emptyHint}</p>
				) : null}
				{!suppressAgentCards
					? cards.map((card) => (
							<StageCardView card={card} key={card.id} />
						))
					: cards.length > 0
						? (
								<div className="space-y-2 opacity-40" aria-hidden>
									<p className="text-[10px] uppercase tracking-wide text-muted-foreground">
										Agent deck paused while you hold the spotlight
									</p>
									{cards.map((card) => (
										<StageCardView card={card} key={card.id} />
									))}
								</div>
							)
						: null}
				{children}
			</div>
			{nowLabel != null || nextLabel != null ? (
				<div className="grid grid-cols-2 gap-2 border-t p-3">
					<div className="rounded-md border bg-background p-2">
						<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
							now
						</div>
						<div className="text-xs">{nowLabel ?? "—"}</div>
					</div>
					<div className="rounded-md border bg-background p-2">
						<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
							next
						</div>
						<div className="text-xs">{nextLabel ?? "—"}</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
