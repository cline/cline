import type { RunRecord } from "@cline/gateway/client";
import type { RunId, SessionId } from "@cline/shared/gateway";
import type { SidecarContext } from "./types";

export type GatewayQueuedPrompt = {
	id: string;
	prompt: string;
	steer: false;
};

export async function listSessionRuns(
	ctx: SidecarContext,
	sessionId: string,
): Promise<readonly RunRecord[]> {
	const { runs } = await ctx.client.listRuns({
		sessionId: sessionId as SessionId,
	});
	return runs;
}

export function queuedPromptsFromRuns(
	runs: readonly RunRecord[],
): GatewayQueuedPrompt[] {
	return runs
		.filter((run) => run.state === "queued")
		.map((run) => ({ id: run.runId, prompt: run.input, steer: false }));
}

export async function listQueuedPrompts(
	ctx: SidecarContext,
	sessionId: string,
): Promise<GatewayQueuedPrompt[]> {
	return queuedPromptsFromRuns(await listSessionRuns(ctx, sessionId));
}

/**
 * Gateway's durable run records are authoritative. The in-memory map is only
 * a projection used to avoid extra reads while events are flowing; queued run
 * admission must never overwrite the run that is actually executing.
 */
export async function resolveRunningRunId(
	ctx: SidecarContext,
	sessionId: string,
): Promise<RunId | undefined> {
	const running = (await listSessionRuns(ctx, sessionId)).find(
		(run) => run.state === "running",
	);
	if (running) {
		ctx.activeRuns.set(sessionId, running.runId);
		return running.runId;
	}
	ctx.activeRuns.delete(sessionId);
	return undefined;
}

/**
 * Resolve the run targeted by the desktop stop control. A newly admitted run
 * can still be queued before its `run.started` event arrives, so restricting
 * stop to `running` records leaves the UI spinning during that race.
 */
export async function resolveInterruptibleRunId(
	ctx: SidecarContext,
	sessionId: string,
): Promise<RunId | undefined> {
	const runs = await listSessionRuns(ctx, sessionId);
	const running = runs.find((run) => run.state === "running");
	if (running) {
		ctx.activeRuns.set(sessionId, running.runId);
		return running.runId;
	}
	ctx.activeRuns.delete(sessionId);
	return runs.find((run) => run.state === "queued")?.runId;
}
