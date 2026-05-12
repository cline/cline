/**
 * Public exports for MacM4LocalAgent UI components.
 *
 * These components are designed to be drop-in additions: they poll
 * the MacM4 dashboard (http://127.0.0.1:4001) on a configurable
 * interval and render nothing when the dashboard is unreachable, so
 * mounting them in a layout doesn't break Cline for users who don't
 * run the MacM4 stack.
 *
 * Integration points (existing files):
 *   - ChatRow.tsx: render <MacM4TierBadge tierId=... /> next to the
 *     model name on each assistant turn. Pull `tierId` from the
 *     api_req_started message metadata (route_decision field).
 *   - The right-hand sidebar / settings panel: drop in
 *     <MacM4SavingsWidget />. It renders ~120px tall and degrades
 *     gracefully when no data is available.
 */

export { MacM4TierBadge, classifyTier } from "./MacM4TierBadge"
export type { MacM4TierBadgeProps } from "./MacM4TierBadge"

export { MacM4SavingsWidget } from "./MacM4SavingsWidget"

export { useMacM4Models, useMacM4Savings } from "./hooks"
export type { UseMacM4ModelsResult, UseMacM4SavingsResult } from "./hooks"

export type {
	MacM4Backend,
	MacM4ModelEntry,
	MacM4ModelsResponse,
	MacM4SavingsSummary,
	MacM4TierKind,
} from "./types"
