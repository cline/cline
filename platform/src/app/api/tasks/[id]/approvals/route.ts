import { handleApiError, jsonOk } from "@/lib/api";
import { requireOwnedTask, requireUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		await requireOwnedTask(id, user.id);

		const { data, error } = await getServiceClient()
			.from("a21_approvals")
			.select("*")
			.eq("task_id", id)
			.eq("owner_id", user.id)
			.order("created_at", { ascending: false })
			.limit(50);
		if (error) throw error;
		return jsonOk({ approvals: data ?? [] });
	} catch (error) {
		return handleApiError(error);
	}
}
