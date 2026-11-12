import { z } from "zod";
import type { AgendaTaskRuntimeResult } from "../../tasks/agenda-task-manager";
import type { HubTransportContext } from "./handlers/context";

const factoryRuntimeResultSchema = z.object({
	status: z.enum(["completed", "failed", "cancelled"]),
	summary: z.string().optional(),
	error: z.string().optional(),
});

/**
 * Reports what a Factory session is doing so the session runner can decide
 * whether another session may take over its worktree. A turn counts as
 * running until its run promise settles, including after its RPC timed out
 * and after the hub stopped counting it as active once its unwind grace
 * expired, and that wins over a result persisted by an earlier turn.
 */
export async function reconcileFactorySession(
	ctx: Pick<
		HubTransportContext,
		| "sessionHost"
		| "activeRpcTurnCountBySession"
		| "abandonedRpcTurnCountBySession"
	>,
	sessionId: string,
): Promise<
	| AgendaTaskRuntimeResult
	| { status: "running" | "idle" | "missing" | "resumable" }
> {
	if (
		(ctx.activeRpcTurnCountBySession.get(sessionId) ?? 0) > 0 ||
		(ctx.abandonedRpcTurnCountBySession.get(sessionId) ?? 0) > 0
	)
		return { status: "running" };
	const session = await ctx.sessionHost.getSession(sessionId);
	if (!session) return { status: "missing" };
	const persistedResult = factoryRuntimeResultSchema.safeParse(
		session.metadata?.factoryRuntimeResult,
	);
	if (persistedResult.success && persistedResult.data.status !== "cancelled")
		return persistedResult.data;
	if (
		session.status === "running" ||
		session.status === "pending" ||
		session.status === "idle" ||
		session.status === "cancelled"
	)
		return { status: "resumable" };
	return {
		status: "failed",
		error: "Factory session ended without a durable completion result",
	};
}
