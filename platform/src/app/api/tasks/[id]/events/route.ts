import { handleApiError, jsonOk } from "@/lib/api";
import { requireOwnedTask, requireUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";
import type { MessageRow, TaskEventRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const task = await requireOwnedTask(id, user.id);

		const url = new URL(request.url);
		const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
		const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 300) || 300, 500));
		const client = getServiceClient();

		const [eventsResult, messagesResult, approvalsResult] = await Promise.all([
			client
				.from("a21_task_events")
				.select("*")
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.gt("id", after)
				.order("id", { ascending: true })
				.limit(limit),
			client
				.from("a21_messages")
				.select("*")
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.order("created_at", { ascending: true })
				.limit(200),
			client
				.from("a21_approvals")
				.select("*")
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.eq("status", "pending")
				.order("created_at", { ascending: true }),
		]);

		const events = (eventsResult.data ?? []) as TaskEventRow[];
		return jsonOk({
			events,
			cursor: events.length > 0 ? events[events.length - 1].id : after,
			messages: (messagesResult.data ?? []) as MessageRow[],
			approvals: approvalsResult.data ?? [],
			task: {
				status: task.status,
				progress: task.progress,
				iteration: task.iteration,
				cancel_requested: task.cancel_requested,
				files_changed: task.files_changed,
				summary: task.summary,
				error: task.error,
				usage: task.usage,
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}
