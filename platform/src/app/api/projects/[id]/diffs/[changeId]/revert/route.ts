import { ApiError, handleApiError, jsonOk } from "@/lib/api";
import { requireOwnedProject, requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { normalizeSandboxError } from "@/lib/sandbox/errors";
import { ensureWorkspaceForData } from "@/lib/sandbox/workspace-service";
import { getServiceClient } from "@/lib/supabase/service";
import type { FileChangeRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string; changeId: string }> };

export async function POST(_request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id, changeId } = await context.params;
		const project = await requireOwnedProject(id, user.id);
		await enforceRateLimit(user.id, "fileWrite");

		const { data, error } = await getServiceClient()
			.from("a21_file_changes")
			.select("*")
			.eq("id", changeId)
			.eq("project_id", id)
			.eq("owner_id", user.id)
			.maybeSingle();
		if (error) throw new ApiError(500, "change_lookup_failed", "Could not load that change.");
		if (!data) throw new ApiError(404, "change_not_found", "Change not found.");
		const change = data as FileChangeRow;
		if (change.status === "reverted") {
			throw new ApiError(409, "already_reverted", "That change has already been reverted.");
		}

		const { provider, workspace } = await ensureWorkspaceForData(project, user.id);
		if (!workspace.external_id)
			throw new ApiError(409, "workspace_not_ready", "Workspace is not ready.");

		let current: string | null = null;
		try {
			current = (
				await provider.readFile(workspace.external_id, workspace.root_path, change.path)
			).toString("utf8");
		} catch {
			current = null;
		}

		if (current !== change.after_content) {
			throw new ApiError(
				409,
				"file_diverged",
				"The file changed after this edit was recorded. Reverting would overwrite newer work.",
			);
		}

		if (change.before_content === null) {
			await provider.deleteFile(workspace.external_id, workspace.root_path, change.path);
		} else {
			await provider.writeFile(
				workspace.external_id,
				workspace.root_path,
				change.path,
				change.before_content,
			);
		}

		const client = getServiceClient();
		await client.from("a21_file_changes").update({ status: "reverted" }).eq("id", change.id);
		await client.from("a21_file_changes").insert({
			project_id: project.id,
			task_id: change.task_id,
			owner_id: user.id,
			path: change.path,
			change_type: "revert",
			before_content: change.after_content,
			after_content: change.before_content,
			status: "applied",
			tool_call_id: "revert",
		});

		return jsonOk({ reverted: true, path: change.path });
	} catch (error) {
		return handleApiError(normalizeSandboxError(error));
	}
}
