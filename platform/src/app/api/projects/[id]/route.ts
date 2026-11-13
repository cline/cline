import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireOwnedProject, requireUser } from "@/lib/auth";
import { deleteWorkspace, getWorkspaceRow } from "@/lib/sandbox/workspace-service";
import { getServiceClient } from "@/lib/supabase/service";
import { updateProjectSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const project = await requireOwnedProject(id, user.id);
		const workspace = await getWorkspaceRow(id, user.id);
		return jsonOk({ project, workspace });
	} catch (error) {
		return handleApiError(error);
	}
}

export async function PATCH(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		await requireOwnedProject(id, user.id);
		const body = await readJson(request, updateProjectSchema);

		const patch: Record<string, unknown> = {};
		if (body.name !== undefined) patch.name = body.name;
		if (body.description !== undefined) patch.description = body.description;
		if (body.defaultModel !== undefined) patch.default_model = body.defaultModel;
		if (body.approvalMode !== undefined) patch.approval_mode = body.approvalMode;
		if (body.status !== undefined) patch.status = body.status;
		if (Object.keys(patch).length === 0) {
			throw new ApiError(400, "empty_update", "No changes were supplied.");
		}

		const { data, error } = await getServiceClient()
			.from("a21_projects")
			.update(patch)
			.eq("id", id)
			.eq("owner_id", user.id)
			.select("*")
			.single();

		if (error) {
			if (error.code === "23505") {
				throw new ApiError(409, "project_name_taken", "You already have a project with that name.");
			}
			throw new ApiError(500, "project_update_failed", "Could not update the project.");
		}
		return jsonOk({ project: data });
	} catch (error) {
		return handleApiError(error);
	}
}

export async function DELETE(_request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const project = await requireOwnedProject(id, user.id);

		await deleteWorkspace(id, user.id);

		const { error } = await getServiceClient()
			.from("a21_projects")
			.delete()
			.eq("id", id)
			.eq("owner_id", user.id);
		if (error) throw new ApiError(500, "project_delete_failed", "Could not delete the project.");

		await getServiceClient()
			.from("a21_audit_logs")
			.insert({
				owner_id: user.id,
				action: "project.deleted",
				resource_type: "a21_project",
				resource_id: project.id,
				metadata: { name: project.name },
			});

		return jsonOk({ deleted: true });
	} catch (error) {
		return handleApiError(error);
	}
}
