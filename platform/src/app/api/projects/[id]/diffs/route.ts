import { ApiError, handleApiError, jsonOk } from "@/lib/api";
import { requireOwnedProject, requireUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";
import type { FileChangeRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		await requireOwnedProject(id, user.id);

		const url = new URL(request.url);
		const taskId = url.searchParams.get("taskId");
		const status = url.searchParams.get("status");
		const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 200));

		let query = getServiceClient()
			.from("a21_file_changes")
			.select("*")
			.eq("project_id", id)
			.eq("owner_id", user.id)
			.order("created_at", { ascending: false })
			.limit(limit);

		if (taskId) query = query.eq("task_id", taskId);
		if (status === "applied" || status === "reverted") query = query.eq("status", status);

		const { data, error } = await query;
		if (error) throw new ApiError(500, "diffs_lookup_failed", "Could not load file changes.");

		return jsonOk({ changes: (data ?? []) as FileChangeRow[] });
	} catch (error) {
		return handleApiError(error);
	}
}
