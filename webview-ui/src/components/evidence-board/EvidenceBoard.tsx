import type { ClaimRecord, EvidenceSpanRecord } from "@shared/proto/cline/ledger"
import React, { useState } from "react"
import { useLedgerContext } from "../../context/LedgerContext"

// ---------------------------------------------------------------------------
// Status lifecycle order + presentation
// ---------------------------------------------------------------------------

const STATUS_ORDER: string[] = ["proposed", "tested", "weakly_supported", "supported", "stale", "contradicted", "retracted"]

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
	proposed: { label: "Proposed", color: "var(--vscode-disabledForeground)", icon: "codicon-lightbulb" },
	tested: { label: "Tested", color: "var(--vscode-textLink-foreground)", icon: "codicon-beaker" },
	weakly_supported: { label: "Weak support", color: "var(--vscode-testing-iconQueued)", icon: "codicon-warning" },
	supported: { label: "Supported", color: "var(--vscode-testing-iconPassed)", icon: "codicon-pass-filled" },
	stale: { label: "Stale", color: "var(--vscode-testing-iconQueued)", icon: "codicon-history" },
	contradicted: { label: "Contradicted", color: "var(--vscode-testing-iconFailed)", icon: "codicon-error" },
	retracted: { label: "Retracted", color: "var(--vscode-disabledForeground)", icon: "codicon-circle-slash" },
}

const CONFIDENCE_ICON: Record<string, string> = {
	high: "codicon-flame",
	medium: "codicon-info",
	low: "codicon-question",
}

const TYPE_LABEL: Record<string, string> = {
	empirical_result: "empirical",
	model_performance: "model",
	assumption: "assumption",
	literature_comparison: "lit",
	quantitative: "quant",
	qualitative: "qual",
}

// ---------------------------------------------------------------------------
// EvidenceSpan row
// ---------------------------------------------------------------------------

const EvidenceSpanRow: React.FC<{ span: EvidenceSpanRecord }> = ({ span }) => {
	const icon = span.sourceType === "run" ? "codicon-check" : span.sourceType === "paper" ? "codicon-book" : "codicon-database"

	return (
		<span
			className="inline-flex items-center gap-1 px-1 py-0 text-[9px] rounded border border-[var(--vscode-panel-border)] opacity-80"
			title={`${span.sourceType}:${span.sourceId}${span.metricRef ? " #" + span.metricRef : ""}${span.description ? " — " + span.description : ""}`}>
			<span className={`codicon ${icon} text-[8px]`} />
			<span className="font-mono truncate max-w-[80px]">
				{span.sourceType === "run"
					? span.sourceId.split(".")[0]
					: span.sourceType === "paper"
						? span.sourceId.slice(0, 12)
						: span.sourceId.slice(0, 10)}
			</span>
			{span.metricRef && <span className="opacity-60">#{span.metricRef.split(".").pop()}</span>}
		</span>
	)
}

// ---------------------------------------------------------------------------
// Claim card
// ---------------------------------------------------------------------------

const ClaimCard: React.FC<{ claim: ClaimRecord }> = ({ claim }) => {
	const [expanded, setExpanded] = useState(false)
	const meta = STATUS_META[claim.status] ?? STATUS_META.proposed
	const confIcon = CONFIDENCE_ICON[claim.confidence] ?? "codicon-question"
	const typeLabel = TYPE_LABEL[claim.claimType] ?? claim.claimType

	return (
		<div
			className="mb-2 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] text-xs cursor-pointer select-none"
			onClick={() => setExpanded((e) => !e)}>
			{/* Header */}
			<div className="flex items-start gap-1.5 px-2 pt-2 pb-1">
				<span className={`codicon ${meta.icon} text-[10px] mt-0.5 shrink-0`} style={{ color: meta.color }} />
				<p className="flex-1 leading-snug line-clamp-2 text-[11px]">{claim.statement}</p>
				<span
					className={`codicon ${expanded ? "codicon-chevron-up" : "codicon-chevron-down"} text-[9px] opacity-50 shrink-0 mt-0.5`}
				/>
			</div>

			{/* Tags row */}
			<div className="flex items-center gap-1 px-2 pb-1.5 flex-wrap">
				{typeLabel && (
					<span className="px-1 py-0 rounded text-[9px] bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
						{typeLabel}
					</span>
				)}
				{claim.confidence && (
					<span className="inline-flex items-center gap-0.5 text-[9px] opacity-60">
						<span className={`codicon ${confIcon} text-[9px]`} />
						{claim.confidence}
					</span>
				)}
				{claim.evidenceSpans.slice(0, 3).map((span, i) => (
					<EvidenceSpanRow key={i} span={span} />
				))}
				{claim.evidenceSpans.length > 3 && (
					<span className="text-[9px] opacity-50">+{claim.evidenceSpans.length - 3} more</span>
				)}
			</div>

			{/* Expanded body */}
			{expanded && (
				<div className="border-t border-[var(--vscode-panel-border)] px-2 py-1.5">
					<p className="text-[10px] opacity-70 mb-1 font-semibold">
						{claim.claimId}
						{claim.sessionId && <span className="ml-1 font-normal opacity-50">· {claim.sessionId.slice(0, 16)}</span>}
					</p>

					{claim.evidenceSpans.length > 0 && (
						<div className="mb-1">
							<p className="text-[9px] opacity-50 mb-0.5 uppercase tracking-wide">Evidence</p>
							<div className="flex flex-col gap-0.5">
								{claim.evidenceSpans.map((span, i) => (
									<div className="text-[10px] font-mono opacity-80 truncate" key={i}>
										<span className="opacity-60">{span.sourceType}:</span>
										{span.sourceId}
										{span.metricRef && <span className="opacity-50"> #{span.metricRef}</span>}
										{span.description && (
											<span className="ml-1 opacity-50 font-sans not-italic">— {span.description}</span>
										)}
									</div>
								))}
							</div>
						</div>
					)}

					{claim.limitations.length > 0 && (
						<div>
							<p className="text-[9px] opacity-50 mb-0.5 uppercase tracking-wide">Limitations</p>
							{claim.limitations.map((lim, i) => (
								<p className="text-[10px] opacity-70" key={i}>
									• {lim}
								</p>
							))}
						</div>
					)}

					{claim.updatedAt && (
						<p className="text-[9px] opacity-40 mt-1">{claim.updatedAt.slice(0, 16).replace("T", " ")} UTC</p>
					)}
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Status column
// ---------------------------------------------------------------------------

const StatusColumn: React.FC<{ status: string; claims: ClaimRecord[] }> = ({ status, claims }) => {
	const meta = STATUS_META[status] ?? STATUS_META.proposed

	return (
		<div className="flex flex-col min-w-[200px] max-w-[260px] shrink-0">
			{/* Column header */}
			<div className="flex items-center gap-1.5 mb-2 px-1 py-1 rounded border-b border-[var(--vscode-panel-border)]">
				<span className={`codicon ${meta.icon} text-[11px]`} style={{ color: meta.color }} />
				<span className="text-xs font-semibold" style={{ color: meta.color }}>
					{meta.label}
				</span>
				<span className="ml-auto text-[10px] opacity-50 bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded-full px-1.5">
					{claims.length}
				</span>
			</div>

			{/* Cards */}
			<div className="flex-1 overflow-y-auto pr-0.5">
				{claims.length === 0 ? (
					<div className="text-[10px] opacity-30 text-center py-4 italic">—</div>
				) : (
					claims.map((c) => <ClaimCard claim={c} key={c.claimId} />)
				)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// EvidenceBoard root
// ---------------------------------------------------------------------------

export const EvidenceBoard: React.FC = () => {
	const { claims, sessionId, loadSession } = useLedgerContext()
	const [filterType, setFilterType] = useState<string>("all")

	const allClaims = Object.values(claims)

	const types = Array.from(new Set(allClaims.map((c) => c.claimType).filter(Boolean)))

	const filtered = filterType === "all" ? allClaims : allClaims.filter((c) => c.claimType === filterType)

	const byStatus = STATUS_ORDER.reduce<Record<string, ClaimRecord[]>>((acc, s) => {
		acc[s] = filtered.filter((c) => c.status === s)
		return acc
	}, {})

	const hasAnyClaims = allClaims.length > 0

	return (
		<div
			className="flex flex-col h-full w-full bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]"
			style={{ fontFamily: "var(--vscode-font-family)" }}>
			{/* Top bar */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--vscode-panel-border)] shrink-0">
				<span className="codicon codicon-beaker text-[14px] opacity-70" />
				<span className="text-sm font-semibold">Evidence Board</span>
				{sessionId && <span className="text-[10px] opacity-40 font-mono ml-1">{sessionId.slice(0, 20)}</span>}
				<div className="ml-auto flex items-center gap-2">
					{types.length > 0 && (
						<select
							className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] px-1 py-0.5 cursor-pointer"
							onChange={(e) => setFilterType(e.target.value)}
							value={filterType}>
							<option value="all">All types</option>
							{types.map((t) => (
								<option key={t} value={t}>
									{TYPE_LABEL[t] ?? t}
								</option>
							))}
						</select>
					)}
					<button
						className="codicon codicon-refresh text-[12px] opacity-60 hover:opacity-100 bg-transparent border-0 cursor-pointer"
						onClick={() => void loadSession("")}
						title="Reload claims from most recent session"
						type="button"
					/>
				</div>
			</div>

			{/* Board */}
			{!hasAnyClaims ? (
				<div className="flex flex-col items-center justify-center flex-1 opacity-40">
					<span className="codicon codicon-beaker text-[32px] mb-2" />
					<p className="text-sm">No claims in session.</p>
					<p className="text-[11px] mt-1">
						Use <code>add_claim</code> in the chat to record a scientific claim.
					</p>
				</div>
			) : (
				<div className="flex flex-row gap-3 flex-1 overflow-x-auto overflow-y-hidden px-3 py-3">
					{STATUS_ORDER.map((status) => (
						<StatusColumn claims={byStatus[status] ?? []} key={status} status={status} />
					))}
				</div>
			)}
		</div>
	)
}
