/**
 * Pure decision logic for the MCP OAuth flow lifecycle.
 *
 * The MCP SDK calls `redirectToAuthorization()` on every connection attempt, and
 * a single server can be (re)connected many times (settings watcher, reconnect
 * handler, restart). Each new flow generates a `state` baked into an
 * authorization URL; that URL may already be open in the user's browser. To keep
 * the stored `state` consistent with the URL the user is completing, a new flow
 * is only started when one isn't already in progress and fresh:
 *
 *   - no flow in progress             -> start one
 *   - a flow is in progress and FRESH -> keep it
 *   - the in-progress flow is STALE   -> start a fresh one
 *
 * Freshness is measured from when the flow started and is never extended, so a
 * flow always eventually expires and the system can make forward progress.
 */
export interface OAuthFlowDecisionInput {
	/** Timestamp (ms) when the in-progress flow's state was generated, or undefined if none. */
	existingFlowStartedAt: number | undefined
	/** Current time (ms). */
	now: number
	/** How long a flow stays valid, measured from when it started. */
	ttlMs: number
}

/**
 * Returns true if `redirectToAuthorization()` should generate a new state/URL,
 * or false if it should keep the existing in-progress flow untouched.
 */
export function shouldStartNewOAuthFlow({ existingFlowStartedAt, now, ttlMs }: OAuthFlowDecisionInput): boolean {
	// No flow in progress (or partial state with no timestamp): start one.
	if (existingFlowStartedAt === undefined) {
		return true
	}
	// A flow is in progress: keep it while fresh, replace it once stale.
	const isStale = now - existingFlowStartedAt > ttlMs
	return isStale
}
