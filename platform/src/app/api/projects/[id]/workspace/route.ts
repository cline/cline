import { ApiError, handleApiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
	deleteWorkspace,
	ensureWorkspace,
	getWorkspaceRow,
	installWorkspaceRuntime,
} from "@/lib/sandbox/workspace-service";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProjectRow, WorkspaceRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

async function loadProject(projectId: string, ownerId: string): Promise<ProjectRow> {
	const client = getServiceClient();
	const { data, error } = await client
		.from("a21_projects")
		.select("*")
		.eq("id", projectId)
		.eq("owner_id", ownerId)
		.maybeSingle();
	if (error) throw new ApiError(500, "project_lookup_failed", "Could not load the project.");
	if (!data) throw new ApiError(404, "project_not_found", "Project not found.");
	return data as ProjectRow;
}

function serializeWorkspace(workspace: WorkspaceRow) {
	// The workspace client consumes the full row shape (external_id, preview_port,
	// error, timestamps), so return it unchanged.
	return workspace;
}

export async function GET(_request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		await loadProject(id, user.id);
		const workspace = await getWorkspaceRow(id, user.id);
		if (!workspace) {
			return jsonOk({ workspace: null, ready: false });
		}
		return jsonOk({ workspace: serializeWorkspace(workspace), ready: workspace.state === "ready" });
	} catch (error) {
		return handleApiError(error);
	}
}

export async function POST(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const project = await loadProject(id, user.id);
		const url = new URL(request.url);

		if (url.searchParams.get("runtime") === "1") {
			if (!project.language)
				throw new ApiError(400, "language_missing", "Project has no language.");
			const result = await installWorkspaceRuntime(project, user.id);
			return jsonOk(result);
		}

		await enforceRateLimit(user.id, "workspaceProvision");
		const { workspace } = await ensureWorkspace(project, user.id, { allowCreate: true });
		return jsonOk({ workspace: serializeWorkspace(workspace), ready: workspace.state === "ready" });
	} catch (error) {
		return handleApiError(error);
	}
}

export async function DELETE(_request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		await loadProject(id, user.id);
		const client = getServiceClient();
		const { data: activeTask } = await client
			.from("a21_tasks")
			.select("id, status")
			.eq("project_id", id)
			.eq("owner_id", user.id)
			.in("status", ["queued", "provisioning", "running", "waiting_approval"])
			.limit(1)
			.maybeSingle();
		if (activeTask) {
			throw new ApiError(
				409,
				"workspace_busy",
				"Cannot release the sandbox while a task is active. Cancel the task first.",
			);
		}
		const result = await deleteWorkspace(id, user.id);
		return jsonOk(result);
	} catch (error) {
		return handleApiError(error);
	}
}
