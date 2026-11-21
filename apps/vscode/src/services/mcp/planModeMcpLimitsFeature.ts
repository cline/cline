import { featureFlagsService } from "@/services/feature-flags"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"

/**
 * Whether Plan mode limits MCP tools by their read-only hints, under the
 * `ext-plan-mode-mcp-limits` rollout. `CLINE_PLAN_MODE_MCP_LIMITS=1` forces it
 * on (and `0` off) for local development and testing.
 *
 * It is read where a session is built and again at each approval, not kept
 * per session: turning the rollout off stops the asks in running sessions too.
 */
export function isPlanModeMcpLimitsEnabled(): boolean {
	const override = process.env.CLINE_PLAN_MODE_MCP_LIMITS?.trim().toLowerCase()
	if (override === "1" || override === "true") {
		return true
	}
	if (override === "0" || override === "false") {
		return false
	}
	return featureFlagsService.getBooleanFlagEnabled(FeatureFlag.PLAN_MODE_MCP_LIMITS)
}
