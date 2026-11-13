import type { User } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProjectRow, TaskRow, WorkspaceRow } from "@/lib/types";

export async function getCurrentUser(): Promise<User | null> {
	const supabase = await createSupabaseServerClient();
	const {
		data: { user },
		error,
	} = await supabase.auth.getUser();
	if (error) return null;
	return user;
}

export async function requireUser(): Promise<User> {
	const user = await getCurrentUser();
	if (!user) {
		throw new ApiError(401, "unauthenticated", "You must sign in to do that.");
	}
	return user;
}

export async function requireOwnedProject(projectId: string, userId: string): Promise<ProjectRow> {
	const { data, error } = await getServiceClient()
		.from("a21_projects")
		.select("*")
		.eq("id", projectId)
		.eq("owner_id", userId)
		.maybeSingle();

	if (error) {
		throw new ApiError(500, "project_lookup_failed", "Could not load that project.");
	}
	if (!data) {
		// Deliberately indistinguishable from a missing project to avoid leaking ids.
		throw new ApiError(404, "project_not_found", "Project not found.");
	}
	return data as ProjectRow;
}

export async function requireOwnedTask(taskId: string, userId: string): Promise<TaskRow> {
	const { data, error } = await getServiceClient()
		.from("a21_tasks")
		.select("*")
		.eq("id", taskId)
		.eq("owner_id", userId)
		.maybeSingle();

	if (error) {
		throw new ApiError(500, "task_lookup_failed", "Could not load that task.");
	}
	if (!data) {
		throw new ApiError(404, "task_not_found", "Task not found.");
	}
	return data as TaskRow;
}

export async function getProjectWorkspace(
	projectId: string,
	userId: string,
): Promise<WorkspaceRow | null> {
	const { data, error } = await getServiceClient()
		.from("a21_workspaces")
		.select("*")
		.eq("project_id", projectId)
		.eq("owner_id", userId)
		.maybeSingle();
	if (error) {
		throw new ApiError(500, "workspace_lookup_failed", "Could not load the workspace.");
	}
	return (data as WorkspaceRow | null) ?? null;
}
