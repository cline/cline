import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireOwnedTask, requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase/service";
import type { ApprovalRow } from "@/lib/types";
import { approvalDecisionSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; approvalId: string }> };

export async function POST(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id, approvalId } = await context.params;
		await requireOwnedTask(id, user.id);
		await enforceRateLimit(user.id, "approvalDecision");
		const body = await readJson(request, approvalDecisionSchema);

		const client = getServiceClient();
		const { data, error } = await client
			.from("a21_approvals")
			.select("*")
			.eq("id", approvalId)
			.eq("task_id", id)
			.eq("owner_id", user.id)
			.maybeSingle();
		if (error) throw new ApiError(500, "approval_lookup_failed", "Could not load the approval.");
		if (!data) throw new ApiError(404, "approval_not_found", "Approval not found.");
		const approval = data as ApprovalRow;
		if (approval.status !== "pending") {
			throw new ApiError(409, "approval_already_decided", "That approval was already decided.");
		}

		const approved = body.decision === "approve";
		const { error: updateError } = await client
			.from("a21_approvals")
			.update({
				status: approved ? "approved" : "rejected",
				decided_at: new Date().toISOString(),
				decided_by: user.id,
				note: body.note ?? null,
			})
			.eq("id", approval.id)
			.eq("owner_id", user.id)
			.eq("status", "pending");
		if (updateError) {
			throw new ApiError(500, "approval_update_failed", "Could not record your decision.");
		}

		const { data: taskRow } = await client
			.from("a21_tasks")
			.select("status, conversation_id, progress")
			.eq("id", id)
			.eq("owner_id", user.id)
			.maybeSingle();

		if (approved) {
			const instruction = `Approval granted for the "${approval.tool_name}" action. The approved input was:\n${JSON.stringify(
				approval.input,
				null,
				2,
			).slice(
				0,
				6000,
			)}\n\nRe-run this exact action now, inspect its real result, and continue the task. Finish with finish_task when the work is verified.`;
			await client.from("a21_messages").insert({
				conversation_id: taskRow?.conversation_id,
				task_id: id,
				owner_id: user.id,
				role: "user",
				content: [{ type: "text", text: instruction }],
			});
			await client
				.from("a21_tasks")
				.update({ status: "queued", error: null, cancel_requested: false })
				.eq("id", id)
				.eq("owner_id", user.id);
			await client
				.from("a21_jobs")
				.update({
					status: "queued",
					run_after: new Date().toISOString(),
					locked_by: null,
					locked_at: null,
					lease_expires_at: null,
					last_error: null,
				})
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.in("status", ["queued", "running"]);
			await client.from("a21_task_events").insert({
				task_id: id,
				owner_id: user.id,
				type: "approval.approved",
				level: "info",
				message: `You approved ${approval.tool_name}. The task was re-queued.`,
				tool_name: approval.tool_name,
				payload: { approvalId: approval.id, note: body.note ?? null },
			});
		} else {
			await client
				.from("a21_tasks")
				.update({
					status: "failed",
					progress: 100,
					error: `You rejected the "${approval.tool_name}" action. The task stopped before applying it.`,
					completed_at: new Date().toISOString(),
				})
				.eq("id", id)
				.eq("owner_id", user.id);
			await client
				.from("a21_jobs")
				.update({
					status: "cancelled",
					locked_by: null,
					lease_expires_at: null,
					last_error: "Approval rejected by user.",
				})
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.in("status", ["queued", "running"]);
			await client.from("a21_task_events").insert({
				task_id: id,
				owner_id: user.id,
				type: "approval.rejected",
				level: "warn",
				message: `You rejected ${approval.tool_name}. The task was stopped.`,
				tool_name: approval.tool_name,
				payload: { approvalId: approval.id, note: body.note ?? null },
			});
		}

		await client.from("a21_audit_logs").insert({
			owner_id: user.id,
			action: approved ? "approval.approved" : "approval.rejected",
			resource_type: "a21_task",
			resource_id: id,
			metadata: { approvalId: approval.id, toolName: approval.tool_name },
		});

		return jsonOk({ decided: true, approved, status: approved ? "queued" : "failed" });
	} catch (error) {
		return handleApiError(error);
	}
}
