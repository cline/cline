import type { ClaimRecord, EvidenceSpanRecord } from "@shared/proto/cline/ledger"
import React, { useEffect, useMemo, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { useLedgerContext } from "../../context/LedgerContext"

const STATUS_ORDER: string[] = ["proposed", "tested", "weakly_supported", "supported", "stale", "contradicted", "retracted"]

const STATUS_META: Record<string, { label: string; color: string; icon: string; lane: string }> = {
	proposed: { label: "Proposed", color: "var(--vscode-disabledForeground)", icon: "codicon-lightbulb", lane: "Needs evidence" },
	tested: { label: "Tested", color: "var(--vscode-textLink-foreground)", icon: "codicon-beaker", lane: "Under test" },
	weakly_supported: {
		label: "Weak support",
		color: "var(--vscode-testing-iconQueued)",
		icon: "codicon-warning",
		lane: "Needs review",
	},
	supported: { label: "Supported", color: "var(--vscode-testing-iconPassed)", icon: "codicon-pass-filled", lane: "Citable" },
	stale: { label: "Stale", color: "var(--vscode-testing-iconQueued)", icon: "codicon-history", lane: "Needs review" },
	contradicted: { label: "Contradicted", color: "var(--vscode-testing-iconFailed)", icon: "codicon-error", lane: "Blocked" },
	retracted: { label: "Retracted", color: "var(--vscode-disabledForeground)", icon: "codicon-circle-slash", lane: "Archived" },
}

const TYPE_LABEL: Record<string, string> = {
	empirical_result: "empirical",
	model_performance: "model",
	assumption: "assumption",
	literature_comparison: "literature",
	quantitative: "quantitative",
	qualitative: "qualitative",
	quality_control: "quality-control",
	evidence_candidate: "evidence candidate",
}

const CONFIDENCE_ICON: Record<string, string> = {
	high: "codicon-flame",
	medium: "codicon-info",
	low: "codicon-question",
}

const BUTTON_BASE =
	"text-[10px] rounded border border-[var(--vscode-panel-border)] px-2 py-0.5 bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"

function postMessage(msg: unknown) {
	PLATFORM_CONFIG.postMessage(msg)
}

function sourceIcon(sourceType: string): string {
	switch (sourceType) {
		case "run":
			return "codicon-debug-rerun"
		case "experiment":
			return "codicon-table"
		case "metric":
			return "codicon-graph-line"
		case "paper":
			return "codicon-book"
		case "dataset":
			return "codicon-database"
		default:
			return "codicon-link"
	}
}

function shortSource(span: EvidenceSpanRecord): string {
	if (span.sourceType === "run") {
		return span.sourceId.replace(/^run\./, "")
	}
	return span.sourceId.length > 28 ? `${span.sourceId.slice(0, 25)}…` : span.sourceId
}

async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard?.writeText(text)
	} catch {
		console.warn("[EvidenceBoard] Clipboard write was unavailable")
	}
}

function claimMarkdown(claim: ClaimRecord): string {
	const evidence = claim.evidenceSpans
		.map(
			(span) =>
				`- ${span.sourceType}:${span.sourceId}${span.metricRef ? ` #${span.metricRef}` : ""}${span.description ? ` — ${span.description}` : ""}`,
		)
		.join("\n")
	const limitations = claim.limitations.map((lim) => `- ${lim}`).join("\n")
	return [
		`### ${claim.statement}`,
		"",
		`Status: ${claim.status}`,
		`Confidence: ${claim.confidence}`,
		`Type: ${claim.claimType}`,
		"",
		"Evidence:",
		evidence || "- none",
		"",
		"Limitations:",
		limitations || "- none",
	].join("\n")
}

const EvidenceBadge: React.FC<{ span: EvidenceSpanRecord; sessionId: string; compact?: boolean }> = ({
	span,
	sessionId,
	compact,
}) => {
	const isRun = span.sourceType === "run"
	const isExperiment = span.sourceType === "experiment"
	const isNavigable = isRun || isExperiment
	const navLabel = isRun ? " · open replay" : isExperiment ? " · open experiment table" : ""
	return (
		<button
			className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] hover:border-[var(--vscode-focusBorder)] disabled:opacity-75 disabled:cursor-default"
			disabled={!isNavigable}
			onClick={(event) => {
				event.stopPropagation()
				if (isRun) {
					postMessage({ type: "open_replay", session_id: sessionId, run_id: span.sourceId })
				} else if (isExperiment) {
					postMessage({ type: "open_experiment", session_id: sessionId, experiment_id: span.sourceId })
				}
			}}
			title={`${span.sourceType}:${span.sourceId}${span.metricRef ? ` #${span.metricRef}` : ""}${span.description ? ` — ${span.description}` : ""}${navLabel}`}
			type="button">
			<span className={`codicon ${sourceIcon(span.sourceType)} text-[8px]`} />
			<span className="font-mono truncate max-w-[180px]">{compact ? shortSource(span) : span.sourceId}</span>
			{span.metricRef && <span className="opacity-65">#{span.metricRef.split(".").pop()}</span>}
		</button>
	)
}

const ClaimCard: React.FC<{ claim: ClaimRecord; selected: boolean; onSelect: () => void }> = ({ claim, selected, onSelect }) => {
	const meta = STATUS_META[claim.status] ?? STATUS_META.proposed
	const typeLabel = TYPE_LABEL[claim.claimType] ?? claim.claimType
	const confIcon = CONFIDENCE_ICON[claim.confidence] ?? "codicon-question"
	const linkedRuns = claim.evidenceSpans.filter((span) => span.sourceType === "run").length

	return (
		// A <div role="button">, not a <button>: this card contains EvidenceBadge
		// buttons (open-replay actions), and nesting <button> inside <button> is
		// invalid HTML — browsers/assistive tech reparent or drop the inner
		// control, making its click/focus behavior unpredictable. This keeps the
		// same click-to-select interaction with equivalent keyboard support.
		<div
			className={[
				"w-full text-left mb-2 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] px-2 py-2 hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer",
				selected ? "border-[var(--vscode-focusBorder)] shadow-[inset_3px_0_0_var(--vscode-focusBorder)]" : "",
			].join(" ")}
			onClick={onSelect}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault()
					onSelect()
				}
			}}
			role="button"
			tabIndex={0}>
			<div className="flex items-start gap-2">
				<span className={`codicon ${meta.icon} text-[12px] mt-0.5 shrink-0`} style={{ color: meta.color }} />
				<p className="flex-1 leading-snug text-[11px] line-clamp-3">{claim.statement}</p>
			</div>
			<div className="flex items-center gap-1.5 mt-2 flex-wrap">
				{typeLabel && (
					<span className="px-1 py-0 rounded text-[9px] bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
						{typeLabel}
					</span>
				)}
				{claim.confidence && (
					<span className="inline-flex items-center gap-0.5 text-[9px] opacity-75">
						<span className={`codicon ${confIcon} text-[9px]`} />
						{claim.confidence}
					</span>
				)}
				{linkedRuns > 0 && (
					<span className="inline-flex items-center gap-0.5 text-[9px] opacity-75">
						<span className="codicon codicon-debug-rerun text-[9px]" />
						{linkedRuns}
					</span>
				)}
				{claim.evidenceSpans.slice(0, 2).map((span) => (
					<EvidenceBadge
						compact
						key={`${span.sourceType}:${span.sourceId}:${span.metricRef ?? ""}`}
						sessionId={claim.sessionId}
						span={span}
					/>
				))}
			</div>
		</div>
	)
}

const StatusLane: React.FC<{
	status: string
	claims: ClaimRecord[]
	selectedClaimId: string | null
	onSelect: (claim: ClaimRecord) => void
}> = ({ status, claims, selectedClaimId, onSelect }) => {
	const meta = STATUS_META[status] ?? STATUS_META.proposed
	return (
		<div className="flex flex-col min-w-[260px] flex-1 max-w-[390px]">
			<div className="flex items-center gap-1.5 mb-2 px-1 py-1 border-b border-[var(--vscode-panel-border)]">
				<span className={`codicon ${meta.icon} text-[12px]`} style={{ color: meta.color }} />
				<span className="text-xs font-semibold" style={{ color: meta.color }}>
					{meta.label}
				</span>
				<span className="text-[9px] opacity-55">{meta.lane}</span>
				<span className="ml-auto text-[10px] bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded-full px-1.5">
					{claims.length}
				</span>
			</div>
			<div className="flex-1 overflow-y-auto pr-1">
				{claims.map((claim) => (
					<ClaimCard
						claim={claim}
						key={claim.claimId}
						onSelect={() => onSelect(claim)}
						selected={selectedClaimId === claim.claimId}
					/>
				))}
			</div>
		</div>
	)
}

const ClaimDetail: React.FC<{ claim: ClaimRecord | null }> = ({ claim }) => {
	if (!claim) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center opacity-55 px-4">
				<span className="codicon codicon-checklist text-[30px] mb-2" />
				<p className="text-sm">Select a claim to inspect evidence, limitations, and reproducibility links.</p>
			</div>
		)
	}
	const meta = STATUS_META[claim.status] ?? STATUS_META.proposed
	const typeLabel = TYPE_LABEL[claim.claimType] ?? claim.claimType
	return (
		<div className="h-full overflow-auto px-4 py-3 text-[11px]">
			<div className="flex items-start gap-2 mb-3">
				<span className={`codicon ${meta.icon} text-[16px] mt-0.5`} style={{ color: meta.color }} />
				<div className="min-w-0 flex-1">
					<div className="text-sm font-semibold leading-snug">{claim.statement}</div>
					<div className="font-mono text-[10px] opacity-55 truncate" title={claim.claimId}>
						{claim.claimId}
					</div>
				</div>
				<button className={BUTTON_BASE} onClick={() => void copyText(claimMarkdown(claim))} type="button">
					Copy claim
				</button>
			</div>

			<div className="grid grid-cols-3 gap-2 mb-3">
				<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
					<div className="opacity-60 text-[9px]">status</div>
					<div className="font-mono" style={{ color: meta.color }}>
						{meta.label}
					</div>
				</div>
				<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
					<div className="opacity-60 text-[9px]">confidence</div>
					<div className="font-mono">{claim.confidence || "—"}</div>
				</div>
				<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
					<div className="opacity-60 text-[9px]">type</div>
					<div className="font-mono truncate">{typeLabel || "—"}</div>
				</div>
			</div>

			<section className="mb-3">
				<div className="text-[9px] font-semibold uppercase tracking-wide opacity-60 mb-1">Evidence links</div>
				{claim.evidenceSpans.length === 0 ? (
					<div className="opacity-55 italic">No evidence spans attached.</div>
				) : (
					<div className="flex flex-col gap-1.5">
						{claim.evidenceSpans.map((span) => (
							<div
								className="rounded border border-[var(--vscode-panel-border)] px-2 py-1"
								key={`${span.sourceType}:${span.sourceId}:${span.metricRef ?? ""}`}>
								<EvidenceBadge sessionId={claim.sessionId} span={span} />
								{span.description && <div className="mt-1 opacity-70">{span.description}</div>}
							</div>
						))}
					</div>
				)}
			</section>

			{claim.limitations.length > 0 && (
				<section className="mb-3">
					<div className="text-[9px] font-semibold uppercase tracking-wide opacity-60 mb-1">Limitations</div>
					<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
						{claim.limitations.map((lim) => (
							<p className="opacity-80" key={lim}>
								• {lim}
							</p>
						))}
					</div>
				</section>
			)}

			<section>
				<div className="text-[9px] font-semibold uppercase tracking-wide opacity-60 mb-1">Provenance</div>
				<div className="font-mono text-[10px] opacity-70">session: {claim.sessionId || "—"}</div>
				<div className="font-mono text-[10px] opacity-70">
					updated: {claim.updatedAt ? `${claim.updatedAt.slice(0, 16).replace("T", " ")} UTC` : "—"}
				</div>
			</section>
		</div>
	)
}

/**
 * Start an agent task from Evidence Board (e.g. "check claim staleness").
 * Mirrors startPreviewAgentTask in html_preview/previewBridge.ts.
 */
function startLedgerAgentTask(prompt: string): Promise<{ ok: boolean; error?: string }> {
	const requestId = `ledger-agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	return new Promise((resolve) => {
		const cleanup = () => {
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
		}
		const timeout = window.setTimeout(() => {
			cleanup()
			resolve({ ok: false, error: "Timed out waiting for agent task to start" })
		}, 15_000)
		const onMessage = (e: MessageEvent) => {
			const d = e.data
			if (!d || d.type !== "aihydro-ledger-agent-result" || d.requestId !== requestId) {
				return
			}
			cleanup()
			resolve({ ok: Boolean(d.ok), error: d.error })
		}
		window.addEventListener("message", onMessage)
		try {
			postMessage({ type: "aihydro-ledger-agent-task", requestId, prompt })
		} catch {
			cleanup()
			resolve({ ok: false, error: "postMessage failed" })
		}
	})
}

export const EvidenceBoard: React.FC = () => {
	const { claims, sessionId, loadSession, loading, error } = useLedgerContext()
	const [filterType, setFilterType] = useState<string>("all")
	const [requestedSessionId, setRequestedSessionId] = useState("")
	const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
	const [stalenessCheck, setStalenessCheck] = useState<{ status: "idle" | "starting" | "started" | "error"; message?: string }>(
		{ status: "idle" },
	)

	const handleCheckStaleness = async () => {
		if (!sessionId) {
			return
		}
		setStalenessCheck({ status: "starting" })
		// check_registry_staleness (aihydro-tools, Tier 2) already exists and is
		// already agent-callable from chat — this closes the UI-reachability
		// gap (F-4), it does not reimplement the staleness logic itself. The
		// result only confirms the agent TASK started, not that the tool call
		// (and its content-hash comparison) has finished — hence "Reload" being
		// a separate, explicit step rather than an automatic refresh.
		const result = await startLedgerAgentTask(
			`Call check_registry_staleness for session "${sessionId}" and report which claims (if any) became stale.`,
		)
		setStalenessCheck(
			result.ok
				? {
						status: "started",
						message: "Agent task started — watch the chat sidebar, then click Reload here when it finishes.",
					}
				: { status: "error", message: result.error ?? "Failed to start the staleness-check task." },
		)
	}

	useEffect(() => {
		if (sessionId && !requestedSessionId) {
			setRequestedSessionId(sessionId)
		}
	}, [sessionId, requestedSessionId])

	const allClaims = useMemo(() => Object.values(claims), [claims])
	const evidenceSpanCount = allClaims.reduce((acc, claim) => acc + claim.evidenceSpans.length, 0)
	const reviewCount = allClaims.filter((claim) => ["weakly_supported", "stale", "contradicted"].includes(claim.status)).length
	const types = Array.from(new Set(allClaims.map((claim) => claim.claimType).filter(Boolean)))
	const filtered = filterType === "all" ? allClaims : allClaims.filter((claim) => claim.claimType === filterType)
	const byStatus = STATUS_ORDER.reduce<Record<string, ClaimRecord[]>>((acc, status) => {
		acc[status] = filtered.filter((claim) => claim.status === status)
		return acc
	}, {})
	const visibleStatuses = STATUS_ORDER.filter((status) => (byStatus[status]?.length ?? 0) > 0)
	const selectedClaim = allClaims.find((claim) => claim.claimId === selectedClaimId) ?? filtered[0] ?? null

	useEffect(() => {
		if (!selectedClaimId && filtered[0]) {
			setSelectedClaimId(filtered[0].claimId)
		}
		if (selectedClaimId && !filtered.some((claim) => claim.claimId === selectedClaimId)) {
			setSelectedClaimId(filtered[0]?.claimId ?? null)
		}
	}, [filtered, selectedClaimId])

	return (
		<div
			className="flex flex-col h-full w-full bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]"
			style={{ fontFamily: "var(--vscode-font-family)" }}>
			<div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--vscode-panel-border)] shrink-0">
				<span className="codicon codicon-beaker text-[14px] opacity-75" />
				<span className="text-sm font-semibold">Evidence Board</span>
				{sessionId && <span className="text-[10px] opacity-55 font-mono ml-1 truncate max-w-[260px]">{sessionId}</span>}
				<div className="ml-auto flex items-center gap-2">
					<input
						className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] px-1.5 py-0.5 w-72"
						onChange={(e) => setRequestedSessionId(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void loadSession(requestedSessionId.trim())}
						placeholder="session_id or blank = latest"
						type="text"
						value={requestedSessionId}
					/>
					<select
						className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] px-1 py-0.5 cursor-pointer"
						disabled={types.length === 0}
						onChange={(e) => setFilterType(e.target.value)}
						value={filterType}>
						<option value="all">All types</option>
						{types.map((type) => (
							<option key={type} value={type}>
								{TYPE_LABEL[type] ?? type}
							</option>
						))}
					</select>
					<button
						className={BUTTON_BASE}
						onClick={() => {
							setRequestedSessionId("demo-reproducibility-cockpit")
							void loadSession("demo-reproducibility-cockpit")
						}}
						title="Load the bundled reproducibility cockpit demo"
						type="button">
						Demo
					</button>
					<button
						className={BUTTON_BASE}
						disabled={!sessionId || stalenessCheck.status === "starting"}
						onClick={() => void handleCheckStaleness()}
						title="Ask the agent to re-check promoted claims against current data (check_registry_staleness)"
						type="button">
						{stalenessCheck.status === "starting" ? "Starting…" : "Check staleness"}
					</button>
					<button
						className={`${BUTTON_BASE} px-1.5`}
						onClick={() => void loadSession(requestedSessionId.trim())}
						title="Reload claims"
						type="button">
						<span className="codicon codicon-refresh text-[11px]" />
					</button>
				</div>
			</div>

			{error && (
				<div className="mx-3 mt-2 px-2 py-1.5 rounded border border-[var(--vscode-testing-iconFailed)] text-[11px] text-[var(--vscode-testing-iconFailed)] bg-[var(--vscode-editor-background)]">
					<span className="codicon codicon-error text-[10px] mr-1" />
					Ledger load failed: {error}
				</div>
			)}

			{stalenessCheck.status === "started" && (
				<div className="mx-3 mt-2 px-2 py-1.5 rounded border border-[var(--vscode-textLink-foreground)] text-[11px] text-[var(--vscode-textLink-foreground)] bg-[var(--vscode-editor-background)] flex items-center gap-2">
					<span className="codicon codicon-comment-discussion text-[10px]" />
					{stalenessCheck.message}
					<button
						className={`${BUTTON_BASE} ml-auto`}
						onClick={() => setStalenessCheck({ status: "idle" })}
						type="button">
						Dismiss
					</button>
				</div>
			)}
			{stalenessCheck.status === "error" && (
				<div className="mx-3 mt-2 px-2 py-1.5 rounded border border-[var(--vscode-testing-iconFailed)] text-[11px] text-[var(--vscode-testing-iconFailed)] bg-[var(--vscode-editor-background)]">
					<span className="codicon codicon-error text-[10px] mr-1" />
					{stalenessCheck.message}
				</div>
			)}

			{sessionId && !loading && !error && (
				<div className="flex items-center gap-4 px-3 py-1.5 border-b border-[var(--vscode-panel-border)] text-[10px] opacity-75 shrink-0">
					<span>
						<span className="codicon codicon-checklist text-[10px] mr-1" />
						{allClaims.length} claims
					</span>
					<span>
						<span className="codicon codicon-link text-[10px] mr-1" />
						{evidenceSpanCount} evidence spans
					</span>
					<span
						style={{
							color: reviewCount > 0 ? "var(--vscode-testing-iconQueued)" : "var(--vscode-testing-iconPassed)",
						}}>
						<span className="codicon codicon-warning text-[10px] mr-1" />
						{reviewCount} need review
					</span>
					<span className="ml-auto font-mono opacity-65 truncate">loaded: {sessionId}</span>
				</div>
			)}

			{loading ? (
				<div className="flex items-center justify-center flex-1 opacity-50">
					<span className="codicon codicon-loading codicon-modifier-spin text-[20px] mr-2" />
					<span className="text-sm">Loading claims…</span>
				</div>
			) : allClaims.length === 0 ? (
				<div className="flex flex-col items-center justify-center flex-1 opacity-70 text-center px-4">
					<span className="codicon codicon-beaker text-[32px] mb-2 opacity-55" />
					<p className="text-sm">Session loaded successfully. 0 claims found.</p>
					<p className="text-[11px] mt-1 max-w-[620px] opacity-75">
						Use <code>add_claim</code> or <code>draft_claim_from_run</code> in chat, or click <strong>Demo</strong> to
						inspect a populated review board.
					</p>
				</div>
			) : (
				<div className="grid grid-cols-[minmax(520px,62%)_1fr] flex-1 min-h-0">
					<div className="overflow-x-auto overflow-y-hidden border-r border-[var(--vscode-panel-border)] px-3 py-3">
						<div className="flex gap-3 h-full min-w-max">
							{visibleStatuses.map((status) => (
								<StatusLane
									claims={byStatus[status] ?? []}
									key={status}
									onSelect={(claim) => setSelectedClaimId(claim.claimId)}
									selectedClaimId={selectedClaim?.claimId ?? null}
									status={status}
								/>
							))}
						</div>
					</div>
					<ClaimDetail claim={selectedClaim} />
				</div>
			)}
		</div>
	)
}
