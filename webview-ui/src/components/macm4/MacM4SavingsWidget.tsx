/**
 * Cost-savings sidebar widget.
 *
 * Compact summary of:
 *   - $ spent on Claude (actual)
 *   - $ that would have been spent if every request had gone to
 *     Claude (shadow baseline)
 *   - $ saved (and savings %)
 *   - request counts by tier kind
 *
 * Renders nothing while the dashboard is unreachable (e.g. the user
 * isn't running the MacM4 stack), so it's safe to mount
 * unconditionally in any layout.
 *
 * Example:
 *   <MacM4SavingsWidget />
 *   <MacM4SavingsWidget dashboardUrl="http://127.0.0.1:4001" pollIntervalMs={60_000} />
 */

import { useMacM4Savings } from "./hooks"

interface MacM4SavingsWidgetProps {
	dashboardUrl?: string
	pollIntervalMs?: number
	className?: string
}

function fmtUsd(value: number): string {
	if (!Number.isFinite(value) || value === 0) {
		return "$0.00"
	}
	// Show three decimals when value < $1 to surface cent-level savings
	// on small workloads; default to two decimals otherwise.
	const decimals = Math.abs(value) < 1 ? 3 : 2
	return `$${value.toFixed(decimals)}`
}

function fmtPct(value: number): string {
	if (!Number.isFinite(value) || value === 0) {
		return "0%"
	}
	return `${value.toFixed(0)}%`
}

export function MacM4SavingsWidget({ dashboardUrl, pollIntervalMs, className }: MacM4SavingsWidgetProps): JSX.Element | null {
	const { summary, error, loading } = useMacM4Savings(dashboardUrl, pollIntervalMs)

	// Don't render at all when the dashboard isn't there. The widget
	// is opt-in: anyone running MacM4 has the dashboard; anyone not
	// running it shouldn't see an error placeholder.
	if (error || (!summary && !loading)) {
		return null
	}

	const row = (label: string, value: string, hint?: string): JSX.Element => (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "baseline",
				gap: 8,
				padding: "2px 0",
			}}
			title={hint}
		>
			<span style={{ opacity: 0.75 }}>{label}</span>
			<span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
		</div>
	)

	return (
		<div
			className={["macm4-savings-widget", className].filter(Boolean).join(" ")}
			style={{
				border: "1px solid var(--vscode-panel-border, rgba(128,128,128,0.3))",
				borderRadius: 4,
				padding: 8,
				fontSize: 12,
				lineHeight: 1.5,
				color: "var(--vscode-foreground)",
				background: "var(--vscode-editor-background)",
			}}
			data-testid="macm4-savings-widget"
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 6,
					fontWeight: 600,
				}}
			>
				<span>MacM4 savings</span>
				<span style={{ fontSize: 10, opacity: 0.6 }}>{summary?.window_label ?? ""}</span>
			</div>
			{summary ? (
				<>
					{row("spent (cloud)", fmtUsd(summary.actual_cost_usd))}
					{row(
						"shadow (all-Claude)",
						fmtUsd(summary.shadow_cost_usd),
						"What you would have spent if every turn had gone to Claude",
					)}
					{row("saved", fmtUsd(summary.savings_usd))}
					{row("savings %", fmtPct(summary.savings_pct))}
					<hr style={{ border: 0, borderTop: "1px solid var(--vscode-panel-border, rgba(128,128,128,0.2))", margin: "6px 0" }} />
					{row(
						"requests",
						`${summary.requests_local} local · ${summary.requests_cloud} cloud`,
						`of ${summary.requests_total} total`,
					)}
				</>
			) : (
				<div style={{ opacity: 0.6 }}>Loading…</div>
			)}
		</div>
	)
}

export default MacM4SavingsWidget
