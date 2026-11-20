import { ApiError, handleApiError, jsonOk } from "@/lib/api";
import { requireOwnedTask, requireUser } from "@/lib/auth";
import { getWorkspaceRow } from "@/lib/sandbox/workspace-service";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const task = await requireOwnedTask(id, user.id);
		const client = getServiceClient();

		const [projectResult, workspace, conversationResult, jobResult] = await Promise.all([
			client
				.from("a21_projects")
				.select("*")
				.eq("id", task.project_id)
				.eq("owner_id", user.id)
				.maybeSingle(),
			getWorkspaceRow(task.project_id, user.id),
			client
				.from("a21_conversations")
				.select("*")
				.eq("id", task.conversation_id)
				.eq("owner_id", user.id)
				.maybeSingle(),
			client
				.from("a21_jobs")
				.select("status, attempts, max_attempts, last_error, run_after")
				.eq("task_id", task.id)
				.eq("owner_id", user.id)
				.maybeSingle(),
		]);

		if (projectResult.error || !projectResult.data) {
			throw new ApiError(404, "project_not_found", "The task's project is no longer available.");
		}

		return jsonOk({
			task,
			project: projectResult.data as ProjectRow,
			workspace,
			conversation: conversationResult.data ?? null,
			job: jobResult.data ?? null,
		});
	} catch (error) {
		return handleApiError(error);
	}
}
