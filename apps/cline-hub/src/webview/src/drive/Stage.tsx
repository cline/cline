/**
 * Events-first Call Stage surface for Hub Chat (Drive Slice A).
 * Renders StageCard rows via ai-elements; always labels the sharer.
 */

import type { StageCard } from "@cline/shared";
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

export type StageHumanPin = {
	kind: "selection" | "file" | "terminal";
	label: string;
};

export type StageViewProps = {
	cards: readonly StageCard[];
	/** Always shown in the stage header (agent partner or You). */
	sharerLabel: string;
	demo?: boolean;
	/** Client-only structured pin stub when You take stage (Slice B later). */
	humanPin?: StageHumanPin | null;
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

function HumanPinStub({ pin }: { pin: StageHumanPin }) {
	return (
		<div className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-3">
			<div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-amber-800 dark:text-amber-200">
				<span className="rounded border border-amber-500/40 px-1.5 py-0.5">
					{pin.kind} pin
				</span>
				<span className="normal-case text-foreground">{pin.label}</span>
			</div>
			<p className="mt-1 text-[11px] text-muted-foreground">
				Client-only share stub. Hub <code>call_set_stage</code> lands in Slice B.
			</p>
		</div>
	);
}

/**
 * Full stage column: sharer header, cards, optional now/next strip.
 * Prefer this over DriveStagePanel + DriveStageCards for live projection.
 */
export function Stage({
	cards,
	sharerLabel,
	demo,
	humanPin,
	nowLabel,
	nextLabel,
	emptyHint = "Waiting for partner tool activity on this session.",
	className,
	children,
}: StageViewProps) {
	return (
		<div
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col border-l bg-muted/20",
				className,
			)}
		>
			<div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
				<span className="text-emerald-600 dark:text-emerald-400">● sharing</span>
				<span className="truncate font-medium text-foreground">{sharerLabel}</span>
				{demo ? (
					<Badge className="ml-auto shrink-0 text-[10px]" variant="outline">
						Demo fixture
					</Badge>
				) : (
					<Badge className="ml-auto shrink-0 text-[10px]" variant="outline">
						Live session
					</Badge>
				)}
			</div>
			<div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
				{humanPin ? <HumanPinStub pin={humanPin} /> : null}
				{cards.length === 0 && !humanPin ? (
					<p className="text-xs text-muted-foreground">{emptyHint}</p>
				) : null}
				{cards.map((card) => (
					<StageCardView card={card} key={card.id} />
				))}
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
