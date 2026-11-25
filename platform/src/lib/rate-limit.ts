import { ApiError } from "@/lib/api";
import { getServiceClient } from "@/lib/supabase/service";

export const RATE_LIMITS = {
	taskCreate: { action: "task:create", limit: 20, windowSeconds: 3600 },
	taskCancel: { action: "task:cancel", limit: 60, windowSeconds: 60 },
	terminalExec: { action: "terminal:exec", limit: 120, windowSeconds: 60 },
	fileWrite: { action: "file:write", limit: 240, windowSeconds: 60 },
	workspaceProvision: { action: "workspace:provision", limit: 12, windowSeconds: 3600 },
	approvalDecision: { action: "approval:decide", limit: 120, windowSeconds: 60 },
	providerKey: { action: "provider:key", limit: 10, windowSeconds: 3600 },
	projectCreate: { action: "project:create", limit: 20, windowSeconds: 3600 },
	modelsList: { action: "models:list", limit: 120, windowSeconds: 60 },
} as const;

export type RateLimitKey = keyof typeof RATE_LIMITS;

export async function enforceRateLimit(ownerId: string, key: RateLimitKey): Promise<void> {
	const config = RATE_LIMITS[key];
	const { data, error } = await getServiceClient().rpc("a21_consume_rate_limit", {
		p_owner_id: ownerId,
		p_action: config.action,
		p_limit: config.limit,
		p_window_seconds: config.windowSeconds,
	});

	if (error) {
		console.error("[21-agent] Rate limiter unavailable:", error.message);
		throw new ApiError(
			503,
			"rate_limiter_unavailable",
			"Request throttling is temporarily unavailable. Please retry shortly.",
		);
	}
	if (data !== true) {
		throw new ApiError(
			429,
			"rate_limit_exceeded",
			"Too many requests. Slow down for a moment and try again.",
		);
	}
}
