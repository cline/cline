"use client";

import type {
	FactoryAcceptanceCriterion,
	FactoryAcceptanceEvaluation,
	FactoryCandidate,
	FactoryCheckResult,
	FactoryReview,
} from "@cline/shared";
import {
	evaluateFactoryAcceptance,
	factoryRepositoryRelative,
} from "@cline/shared/browser";
import { AgentImageLightboxContent } from "@cline/ui";
import { ToolActivityCode } from "@cline/ui/components/agent-chat";
import {
	ArrowUpRight,
	CheckCircle2,
	Circle,
	CircleAlert,
	CircleSlash,
	Copy,
	Film,
	ImageIcon,
	X,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import { desktopClient } from "@/lib/desktop-client";
import { factoryPublishFailureReason } from "@/lib/factory-attention";
import {
	FACTORY_CARD,
	FACTORY_CHECK_RESULT,
	FACTORY_PROOF,
	FACTORY_RECOVERY,
} from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import { factoryRequirementUncheckable } from "./factory-proof";
import { type FactoryTone, StatusPill, toneText } from "./factory-ui";

/**
 * A check's screenshot or recording: loaded on demand, then shown in the
 * app's lightbox rather than inline in the card.
 */
export function EvidencePreview({
	taskId,
	runId,
	artifact,
}: {
	taskId: string;
	runId: string;
	artifact: { path: string; label: string; mimeType: string };
}) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [open, setOpen] = useState(false);
	const video = artifact.mimeType.startsWith("video/");
	const Icon = video ? Film : ImageIcon;
	return (
		<div className="mt-3">
			<Button
				size="sm"
				variant="outline"
				disabled={loading}
				aria-haspopup="dialog"
				onClick={() => {
					if (dataUrl) {
						setOpen(true);
						return;
					}
					setLoading(true);
					void desktopClient
						.invoke<{ dataUrl: string }>("factory_read_artifact", {
							taskId,
							runId,
							path: artifact.path,
						})
						.then((result) => {
							setDataUrl(result.dataUrl);
							setError(null);
							setOpen(true);
						})
						.catch((cause: unknown) =>
							setError(
								cause instanceof Error
									? cause.message
									: "Unable to load evidence.",
							),
						)
						.finally(() => setLoading(false));
				}}
			>
				<Icon className="mr-1.5 size-3.5" />
				{loading ? "Loading…" : artifact.label}
			</Button>
			{error ? (
				<p role="alert" className="mt-1 text-xs text-destructive">
					{error}
				</p>
			) : null}
			<Dialog open={open && Boolean(dataUrl)} onOpenChange={setOpen}>
				<DialogContent
					showCloseButton={false}
					aria-describedby={undefined}
					className="h-[calc(100dvh-4rem)] max-w-[calc(100vw-4rem)] border-0 bg-background/95 p-4 shadow-none backdrop-blur-sm sm:max-w-[calc(100vw-4rem)]"
					data-testid="factory-evidence-lightbox"
				>
					<DialogTitle className="sr-only">{artifact.label}</DialogTitle>
					{dataUrl && video ? (
						<div className="relative flex h-full w-full items-center justify-center">
							<video
								src={dataUrl}
								controls
								className="max-h-full max-w-full rounded-lg"
							>
								<track kind="captions" />
							</video>
							<Button
								size="sm"
								variant="secondary"
								className="absolute top-0 right-0"
								onClick={() => setOpen(false)}
							>
								<X className="size-3.5" />
								<span className="sr-only">Close recording</span>
							</Button>
						</div>
					) : dataUrl ? (
						<div className="relative h-full w-full">
							<AgentImageLightboxContent
								src={dataUrl}
								alt={artifact.label}
								onClose={() => setOpen(false)}
								backdropTabIndex={-1}
							/>
						</div>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
}

type AcceptanceCandidate = Pick<FactoryCandidate, "checks" | "verification">;

/** Required criteria proven, unmet required criteria by outcome, then optional ones. */
export function acceptanceSummary(
	criteria: FactoryAcceptanceCriterion[] | undefined,
	candidate: AcceptanceCandidate | undefined,
): string {
	if (!criteria?.length) return "No criteria recorded";
	const required = criteria.filter((criterion) => criterion.required).length;
	const optional = criteria.length - required;
	if (!candidate)
		return `${required} required, ${optional} optional · not evaluated`;
	// A requirement the build cannot check is never counted as proven.
	const results = evaluateFactoryAcceptance(criteria, candidate).map(
		(result) => ({
			...result,
			outcome:
				result.outcome === "passed" &&
				factoryRequirementUncheckable(result.criterion.text)
					? ("not checked" as const)
					: result.outcome,
		}),
	);
	const ids = (
		outcome: FactoryAcceptanceEvaluation["outcome"] | "not checked",
		isRequired: boolean,
	) =>
		results
			.filter(
				(result) =>
					result.outcome === outcome &&
					result.criterion.required === isRequired,
			)
			.map((result) => result.criterion.id);
	return [
		required
			? `${ids("passed", true).length}/${required} required proven`
			: "No required criteria",
		...(["failed", "unverified", "not checked"] as const).flatMap((outcome) => {
			const unmet = ids(outcome, true);
			// Counts, not criterion ids: ids are the plan's internals.
			return unmet.length ? [`${unmet.length} ${outcome}`] : [];
		}),
		...(optional
			? [`optional ${ids("passed", false).length}/${optional} passed`]
			: []),
	].join(" · ");
}

const OUTCOME_STYLE = {
	passed: { tone: "success", icon: CheckCircle2 },
	failed: { tone: "danger", icon: XCircle },
	unverified: { tone: "attention", icon: CircleAlert },
} as const satisfies Record<string, { tone: FactoryTone; icon: unknown }>;
const UNCHECKABLE_STYLE = { tone: "neutral", icon: CircleSlash } as const;

type AcceptanceItem = Pick<FactoryAcceptanceEvaluation, "criterion"> &
	Partial<FactoryAcceptanceEvaluation>;

function firstLine(text: string): string {
	return (
		text
			.split("\n")
			.map((line) => line.replace(/^#+\s*/, "").trim())
			.find(Boolean) ?? ""
	);
}

export type FactoryErrorSummary = {
	/** The first sentence, short enough for the status panel. */
	headline: string;
	/** The same sentence uncut, when the headline had to shorten it. */
	sentence?: string;
	/** Per-check lines found in "<check name>: blocked|failed" form. */
	checks: { name: string; status: "blocked" | "failed"; detail?: string }[];
	/** The full text when it says more than the headline. */
	details?: string;
};

const NOT_CHECK_NAMES =
	/^(error|warning|fatal|panic|fail|failed|exit|status|reason|cause|note)$/i;
const CHECK_LINE =
	/^\s*(?:[-*\u2022]\s*)?(?:check\s+)?["\u201c]?([^:"\u201d\n]{1,80}?)["\u201d]?:\s*(blocked|failed)\b[\s:.,-]*(.*)$/i;
const MAX_HEADLINE = 200;

/**
 * Splits a stored error into a headline, per-check lines and the full log.
 * Works with both a short structured summary and a long raw test log.
 */
export function summarizeFactoryError(text: string): FactoryErrorSummary {
	// Older runs recorded findings with absolute worktree paths.
	const trimmed = factoryRepositoryRelative(text).trim();
	// A draft PR that could not be opened: the header names the step, so the
	// headline is core's one-sentence reason.
	const publishReason = factoryPublishFailureReason(trimmed);
	if (publishReason !== undefined) {
		const headline = publishReason || `${FACTORY_RECOVERY.publishFailed}.`;
		return {
			headline,
			checks: [],
			...(trimmed.length > headline.length + 1 ? { details: trimmed } : {}),
		};
	}
	const checks: FactoryErrorSummary["checks"] = [];
	const seen = new Set<string>();
	for (const segment of trimmed
		.split("\n")
		.slice(0, 400)
		.flatMap((line) => line.split(/;\s+/))) {
		const match = CHECK_LINE.exec(segment);
		const name = match?.[1]?.trim();
		if (!match || !name || NOT_CHECK_NAMES.test(name) || seen.has(name))
			continue;
		seen.add(name);
		const detail = match[3]?.trim();
		checks.push({
			name,
			status: match[2]?.toLowerCase() === "blocked" ? "blocked" : "failed",
			...(detail ? { detail: detail.slice(0, 160) } : {}),
		});
		if (checks.length >= 12) break;
	}
	const first =
		trimmed
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean) ?? "";
	const sentence = /^(.+?[.!?])(?:\s|$)/.exec(first)?.[1] ?? first;
	let headline =
		sentence.length > MAX_HEADLINE
			? `${sentence.slice(0, MAX_HEADLINE - 1).trimEnd()}\u2026`
			: sentence;
	if (checks.length && CHECK_LINE.test(headline))
		headline =
			checks.length === 1
				? "1 check did not pass."
				: `${checks.length} checks did not pass.`;
	return {
		headline,
		...(headline !== sentence && headline.endsWith("\u2026")
			? { sentence }
			: {}),
		checks,
		...(trimmed.length > headline.length + 1 ? { details: trimmed } : {}),
	};
}

/**
 * The details behind a stopped card: per-check lines, then the raw log in a
 * collapsed, scrollable, copyable disclosure. Never a red wall of text.
 */
export function FactoryErrorDetails({
	summary,
}: {
	summary: FactoryErrorSummary;
}) {
	const [copied, setCopied] = useState(false);
	if (!summary.checks.length && !summary.details) return null;
	return (
		<section
			aria-label="What stopped this work"
			className="space-y-3 rounded-lg border bg-card px-5 py-4 text-sm"
		>
			{summary.checks.length ? (
				<ul className="space-y-1.5">
					{summary.checks.map((check) => (
						<li key={check.name} className="flex min-w-0 items-start gap-2">
							<XCircle
								className={cn(
									"mt-0.5 size-4 shrink-0",
									toneText(check.status === "failed" ? "danger" : "attention"),
								)}
							/>
							<span className="min-w-0 break-words">
								<strong className="font-medium">{check.name}</strong>{" "}
								<span className="text-muted-foreground">
									{check.status === "failed" ? "failed" : "was blocked"}
									{check.detail ? ` · ${check.detail}` : ""}
								</span>
							</span>
						</li>
					))}
				</ul>
			) : null}
			{summary.details ? (
				<details className="text-xs">
					<summary className="cursor-pointer select-none text-muted-foreground">
						Show full log
					</summary>
					<div className="mt-2 space-y-2">
						<div className="flex justify-end">
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								onClick={() =>
									void navigator.clipboard
										?.writeText(summary.details ?? "")
										.then(() => setCopied(true))
										.catch(() => setCopied(false))
								}
							>
								<Copy className="mr-1.5 size-3" />
								{copied ? "Copied" : "Copy log"}
							</Button>
						</div>
						<ToolActivityCode
							data-testid="factory-error-log"
							className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono"
						>
							{summary.details}
						</ToolActivityCode>
					</div>
				</details>
			) : null}
		</section>
	);
}

/**
 * Requirements as a checklist. A requirement whose own text says the build
 * cannot check it never shows a green "passed": it reads "not checked".
 */
export function AcceptanceCriteria({ items }: { items: AcceptanceItem[] }) {
	return (
		<ul className="divide-y rounded-lg border text-sm">
			{items.map(({ criterion, outcome, evidence }) => {
				const uncheckable =
					outcome === "passed" && factoryRequirementUncheckable(criterion.text);
				const style = uncheckable
					? UNCHECKABLE_STYLE
					: outcome
						? OUTCOME_STYLE[outcome]
						: undefined;
				const Icon = style?.icon ?? Circle;
				return (
					<li
						key={criterion.id}
						className="flex gap-3 px-3 py-2.5"
						data-outcome={uncheckable ? "uncheckable" : (outcome ?? "pending")}
					>
						<Icon
							className={cn(
								"mt-0.5 size-4 shrink-0",
								style ? toneText(style.tone) : "text-muted-foreground/60",
							)}
						/>
						<div className="min-w-0 flex-1">
							<div className="flex items-start justify-between gap-3">
								<span className="min-w-0 break-words">{criterion.text}</span>
								{outcome && style ? (
									<StatusPill tone={style.tone}>
										{uncheckable ? FACTORY_PROOF.outcome.uncheckable : outcome}
									</StatusPill>
								) : null}
							</div>
							<p className="mt-0.5 text-xs text-muted-foreground">
								{criterion.required ? "Required" : "Optional"} · proven by{" "}
								{criterion.check
									? `check “${criterion.check}”`
									: "agent verification"}
							</p>
							{outcome ? (
								<p className="mt-1.5 whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 text-xs">
									{evidence ?? "No evidence recorded."}
								</p>
							) : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

export function AcceptanceResults({
	criteria,
	candidate,
	inProgress = false,
}: {
	criteria: FactoryAcceptanceCriterion[] | undefined;
	candidate: AcceptanceCandidate | undefined;
	/**
	 * Work is still running: a requirement with no result yet is an open
	 * checklist item, not "unverified", and fills in as its check lands.
	 */
	inProgress?: boolean;
}) {
	if (!criteria?.length)
		return (
			<p className="text-sm text-muted-foreground">
				{FACTORY_CARD.noCriterionResults}
			</p>
		);
	return (
		<section aria-label="Acceptance results" className="space-y-2">
			<h4 className="text-sm font-semibold">
				Requirements{" "}
				<span className="font-normal text-muted-foreground">
					· {acceptanceSummary(criteria, candidate)}
				</span>
			</h4>
			<AcceptanceCriteria
				items={
					candidate
						? evaluateFactoryAcceptance(criteria, candidate).map((item) =>
								inProgress && item.outcome === "unverified"
									? { criterion: item.criterion }
									: item,
							)
						: criteria.map((criterion) => ({ criterion }))
				}
			/>
		</section>
	);
}

export function ReviewResult({
	label,
	review,
	sessionId,
	onOpenSession,
	collapsed = false,
}: {
	label: string;
	review: FactoryReview;
	sessionId: string;
	onOpenSession: (sessionId: string) => Promise<void>;
	/** One line per verdict; the report opens on demand. */
	collapsed?: boolean;
}) {
	if (collapsed)
		return (
			<details className="group rounded-lg border text-sm">
				<summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5">
					<StatusPill
						tone={review.verdict === "pass" ? "success" : "attention"}
						icon={review.verdict === "pass" ? CheckCircle2 : CircleAlert}
					>
						{FACTORY_PROOF.verdict[review.verdict]}
					</StatusPill>
					<span className="shrink-0 font-medium">{label}</span>
					<span className="min-w-0 truncate text-xs text-muted-foreground">
						{firstLine(review.summary)}
					</span>
				</summary>
				<div className="border-t px-4 pb-4">
					<ReviewResult
						label={label}
						review={review}
						sessionId={sessionId}
						onOpenSession={onOpenSession}
					/>
				</div>
			</details>
		);
	return (
		<div className="rounded-lg border p-4 text-sm group-open:mt-3 group-open:border-0 group-open:p-0">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h4 className="font-medium">
					{label}
					<span className="sr-only"> · </span>
				</h4>
				<StatusPill
					tone={review.verdict === "pass" ? "success" : "attention"}
					icon={review.verdict === "pass" ? CheckCircle2 : CircleAlert}
				>
					{FACTORY_PROOF.verdict[review.verdict]}
				</StatusPill>
			</div>
			<MemoizedMarkdown content={review.summary} classNames="mt-2 text-sm" />
			{review.findings.length ? (
				<ul className="mt-2 list-disc space-y-1 pl-5">
					{review.findings.map((finding) => (
						<li key={finding}>
							<MemoizedMarkdown
								content={factoryRepositoryRelative(finding)}
								classNames="text-sm"
							/>
						</li>
					))}
				</ul>
			) : null}
			{review.coverage ? (
				<details className="mt-3 text-xs text-muted-foreground">
					<summary className="cursor-pointer">Private local coverage</summary>
					{[
						{ label: "Static review", paths: review.coverage.static },
						{ label: "Executed checks", paths: review.coverage.exercised },
						{ label: "Required gaps", paths: review.coverage.requiredGaps },
						{
							label: "Nonblocking limitations",
							paths: review.coverage.limitations,
						},
					]
						.filter(({ paths }) => paths.length > 0)
						.map(({ label: coverageLabel, paths }) => (
							<div key={coverageLabel} className="mt-2">
								<strong>{coverageLabel}</strong>
								<ul className="list-disc pl-5">
									{paths.map((path) => (
										<li key={path}>{path}</li>
									))}
								</ul>
							</div>
						))}
				</details>
			) : null}
			<Button
				variant="link"
				size="sm"
				className="mt-2 h-auto p-0"
				onClick={() => void onOpenSession(sessionId)}
			>
				Open {label.toLowerCase()} session
				<ArrowUpRight className="ml-1 size-3" />
			</Button>
		</div>
	);
}

/**
 * A check's name and result. A check its own definition blocked (for example
 * evidence outside the worktree) is a plan problem, not a code failure, so it
 * offers "Edit plan". A pass with limitations names what it could not capture.
 */
export function CheckResultSummary({
	check,
	onEditPlan,
}: {
	check: Pick<
		FactoryCheckResult,
		"name" | "status" | "limitations" | "blockedBy"
	>;
	onEditPlan?: () => void;
}) {
	const configuration =
		check.status !== "passed" && check.blockedBy === "configuration";
	const limitations =
		check.status === "passed" ? (check.limitations ?? []) : [];
	return (
		<>
			<div className="flex items-center justify-between gap-3 text-sm">
				<strong className="min-w-0 break-words font-medium">
					{check.name}
				</strong>
				{configuration ? (
					<StatusPill tone="attention" icon={CircleAlert}>
						{FACTORY_CHECK_RESULT.configurationPill}
					</StatusPill>
				) : (
					<StatusPill
						tone={
							check.status !== "passed"
								? "danger"
								: limitations.length
									? "attention"
									: "success"
						}
						icon={check.status === "passed" ? CheckCircle2 : XCircle}
					>
						{check.status}
					</StatusPill>
				)}
			</div>
			{limitations.length ? (
				<p
					className={cn("mt-1 text-xs", toneText("attention"))}
					data-testid="factory-check-limitations"
				>
					{FACTORY_CHECK_RESULT.limitations(limitations)}
				</p>
			) : null}
			{configuration ? (
				<div
					className="mt-1 flex flex-wrap items-center gap-2 text-xs"
					data-testid="factory-check-configuration"
				>
					<span className={toneText("attention")}>
						{FACTORY_CHECK_RESULT.configuration}
					</span>
					{onEditPlan ? (
						<Button size="xs" variant="outline" onClick={onEditPlan}>
							{FACTORY_CHECK_RESULT.editPlan}
						</Button>
					) : null}
				</div>
			) : null}
		</>
	);
}
