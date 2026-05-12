/**
 * Routing-tier badge.
 *
 * Renders a compact pill-style label indicating which MacM4 tier
 * handled a turn (or will handle the next one). Pure visual; the
 * caller is responsible for passing in the correct tierId.
 *
 * Example:
 *   <MacM4TierBadge tierId="local-long" warm={true} />
 *   <MacM4TierBadge tierId="claude-opus-4-7" />
 *   <MacM4TierBadge tierId="hybrid-auto" reason="task=12 tok, default" />
 *
 * Designed to be embedded next to a model name in a ChatRow or in
 * the model picker UI. The badge has no side effects and renders
 * nothing for unknown tier ids.
 */

import { useMemo } from "react"
import type { MacM4Backend, MacM4TierKind } from "./types"

interface TierStyle {
	kind: MacM4TierKind
	backend: MacM4Backend | "unknown"
	label: string
	color: string
	bg: string
}

/**
 * Pure mapping function (no hook -- useful in tests and Storybook).
 * Returns undefined for unknown tier ids so the badge can short-circuit.
 */
export function classifyTier(tierId: string): TierStyle | undefined {
	const stripped = tierId.startsWith("gpt-") ? tierId.slice(4) : tierId
	switch (stripped) {
		case "local-fast":
			return {
				kind: "local",
				backend: "mlx",
				label: "local · MLX",
				color: "var(--vscode-charts-green, #4caf50)",
				bg: "rgba(76, 175, 80, 0.15)",
			}
		case "local-long":
		case "local-agent":
			return {
				kind: "local",
				backend: "ollama",
				label: "local · Ollama",
				color: "var(--vscode-charts-green, #4caf50)",
				bg: "rgba(76, 175, 80, 0.15)",
			}
		case "claude-haiku-4-5":
			return {
				kind: "cloud",
				backend: "anthropic",
				label: "cloud · Haiku 4.5",
				color: "var(--vscode-charts-blue, #5bc0de)",
				bg: "rgba(91, 192, 222, 0.15)",
			}
		case "claude-sonnet-4-6":
			return {
				kind: "cloud",
				backend: "anthropic",
				label: "cloud · Sonnet 4.6",
				color: "var(--vscode-charts-blue, #5bc0de)",
				bg: "rgba(91, 192, 222, 0.15)",
			}
		case "claude-opus-4-7":
		case "claude-code":
			return {
				kind: "cloud",
				backend: "anthropic",
				label: "cloud · Opus 4.7",
				color: "var(--vscode-charts-purple, #b388ff)",
				bg: "rgba(179, 136, 255, 0.15)",
			}
		case "hybrid-auto":
			return {
				kind: "router",
				backend: "litellm-router",
				label: "auto · router",
				color: "var(--vscode-charts-orange, #ffa726)",
				bg: "rgba(255, 167, 38, 0.15)",
			}
		default:
			return undefined
	}
}

export interface MacM4TierBadgeProps {
	tierId: string
	/** Optional warm flag (from useMacM4Models). Renders a "loading" hint when false for local tiers. */
	warm?: boolean
	/** Free-form reason string (e.g. "complex: architecture") shown as tooltip. */
	reason?: string
	/** Compact mode: hide the backend portion of the label ("local" instead of "local · MLX"). */
	compact?: boolean
}

export function MacM4TierBadge({ tierId, warm, reason, compact }: MacM4TierBadgeProps): JSX.Element | null {
	const style = useMemo(() => classifyTier(tierId), [tierId])
	if (!style) {
		return null
	}
	const label = compact ? style.label.split(" ·")[0] : style.label
	const showColdHint = style.kind === "local" && warm === false
	return (
		<span
			className="macm4-tier-badge"
			data-tier={tierId}
			data-tier-kind={style.kind}
			title={reason ?? ""}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "1px 6px",
				borderRadius: 4,
				fontSize: "11px",
				fontWeight: 500,
				color: style.color,
				backgroundColor: style.bg,
				border: `1px solid ${style.color}33`,
				lineHeight: 1.4,
			}}
		>
			<span aria-hidden="true">{style.kind === "local" ? "●" : style.kind === "router" ? "↻" : "☁"}</span>
			<span>{label}</span>
			{showColdHint ? <span style={{ opacity: 0.7, marginLeft: 4 }}>(cold)</span> : null}
		</span>
	)
}

export default MacM4TierBadge
