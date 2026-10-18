import { runTask } from "@/lib/agent/run";
import { sanitizeLogMessage } from "@/lib/api";
import { getServerEnv } from "@/lib/env";
import { getServiceClient } from "@/lib/supabase/service";

export type TickResult = {
	processed: boolean;
	outcome?: string;
	jobId?: string;
	taskId?: string;
	error?: string;
};

/**
 * Claims and processes one queued job. Intended for the standalone worker loop
 * and for the protected /api/internal/tick endpoint. Long-running tasks should
 * be executed by the standalone worker, not by a 60s serverless invocation.
 */
export async function runTick(workerId: string, leaseSeconds = 60): Promise<TickResult> {
	const env = getServerEnv();
	const client = getServiceClient();
	const { data, error } = await client.rpc("a21_claim_job", {
		p_worker_id: workerId,
		p_lease_seconds: Math.max(30, Math.min(leaseSeconds, env.WORKER_LEASE_SECONDS)),
	});
	if (error) throw new Error(`Queue claim failed: ${error.message}`);
	const job = Array.isArray(data) ? data[0] : data;
	if (!job) return { processed: false };

	try {
		const outcome = await runTask({
			taskId: job.task_id,
			jobId: job.id,
			workerId,
			jobAttempts: job.attempts,
			jobMaxAttempts: job.max_attempts,
		});
		return {
			processed: true,
			outcome: outcome.status,
			jobId: job.id,
			taskId: job.task_id,
			error: outcome.error ? sanitizeLogMessage(outcome.error) : undefined,
		};
	} catch (error) {
		const message = sanitizeLogMessage(error instanceof Error ? error.message : String(error));
		console.error("[21-agent worker] Unhandled job error:", message);
		await client
			.from("a21_tasks")
			.update({
				status: "failed",
				error: message.slice(0, 4000),
				completed_at: new Date().toISOString(),
				progress: 100,
			})
			.eq("id", job.task_id)
			.eq("owner_id", job.owner_id);
		await client.rpc("a21_finish_job", {
			p_job_id: job.id,
			p_worker_id: workerId,
			p_status: "failed",
			p_error: message.slice(0, 2000),
		});
		return {
			processed: true,
			outcome: "failed",
			jobId: job.id,
			taskId: job.task_id,
			error: message,
		};
	}
}
