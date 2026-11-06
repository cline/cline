import { ApiError, handleApiError, jsonOk } from "@/lib/api";
import { requireOwnedTask, requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

export async function POST(_request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const task = await requireOwnedTask(id, user.id);
		await enforceRateLimit(user.id, "taskCancel");

		if (TERMINAL.has(task.status)) {
			throw new ApiError(409, "task_finished", "This task has already finished.");
		}

		const client = getServiceClient();
		await client
			.from("a21_tasks")
			.update({ cancel_requested: true })
			.eq("id", id)
			.eq("owner_id", user.id);

		// Queued or paused tasks have no worker to observe the flag, so finish
		// them immediately and release the job.
		if (task.status === "queued" || task.status === "waiting_approval") {
			await client
				.from("a21_tasks")
				.update({
					status: "cancelled",
					progress: 100,
					cancel_requested: true,
					error: null,
					completed_at: new Date().toISOString(),
				})
				.eq("id", id)
				.eq("owner_id", user.id);
			await client
				.from("a21_jobs")
				.update({
					status: "cancelled",
					locked_by: null,
					locked_at: null,
					lease_expires_at: null,
					last_error: "Cancelled by user.",
					updated_at: new Date().toISOString(),
				})
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.in("status", ["queued", "running"]);
			await client
				.from("a21_approvals")
				.update({
					status: "expired",
					decided_at: new Date().toISOString(),
					note: "Task cancelled.",
				})
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.eq("status", "pending");
			await client.from("a21_task_events").insert({
				task_id: id,
				owner_id: user.id,
				type: "task.cancelled",
				level: "warn",
				message: "Task cancelled by user.",
			});
		} else {
			await client.from("a21_task_events").insert({
				task_id: id,
				owner_id: user.id,
				type: "task.cancel_requested",
				level: "warn",
				message: "Cancellation requested — the worker will stop at the next safe point.",
			});
		}

		await client.from("a21_audit_logs").insert({
			owner_id: user.id,
			action: "task.cancel_requested",
			resource_type: "a21_task",
			resource_id: id,
			metadata: { previousStatus: task.status },
		});

		return jsonOk({ cancelled: true, immediate: task.status !== "running" });
	} catch (error) {
		return handleApiError(error);
	}
}
