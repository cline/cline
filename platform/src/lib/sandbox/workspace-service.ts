import { ApiError } from "@/lib/api";
import { getSandboxProvider } from "@/lib/sandbox";
import type { SandboxProvider } from "@/lib/sandbox/types";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProjectRow, WorkspaceRow } from "@/lib/types";

export type WorkspaceContext = {
	workspace: WorkspaceRow;
	provider: SandboxProvider;
};

const STALE_PROVISIONING_MS = 3 * 60 * 1000;

function publicError(error: unknown): ApiError {
	if (error instanceof ApiError) return error;
	const message = error instanceof Error ? error.message : String(error);
	return new ApiError(
		502,
		"sandbox_error",
		"The cloud sandbox could not be reached. Check the Daytona configuration and try again.",
		message.slice(0, 800),
	);
}

export async function getWorkspaceRow(
	projectId: string,
	ownerId: string,
): Promise<WorkspaceRow | null> {
	const { data, error } = await getServiceClient()
		.from("a21_workspaces")
		.select("*")
		.eq("project_id", projectId)
		.eq("owner_id", ownerId)
		.maybeSingle();
	if (error) throw new ApiError(500, "workspace_lookup_failed", "Could not load workspace.");
	return (data as WorkspaceRow | null) ?? null;
}

/**
 * Returns a running workspace, creating one if needed. Provisioning is an
 * external side effect, so the row is marked `provisioning` first to prevent two
 * concurrent requests from creating duplicate sandboxes.
 */
export async function ensureWorkspace(
	project: ProjectRow,
	ownerId: string,
	options?: { allowCreate?: boolean },
): Promise<WorkspaceContext> {
	const allowCreate = options?.allowCreate ?? true;
	let row = await getWorkspaceRow(project.id, ownerId);

	if (row?.external_id && ["ready", "stopped"].includes(row.state)) {
		const provider = getSandboxProvider();
		try {
			await provider.ensureRunning(row.external_id);
			await getServiceClient()
				.from("a21_workspaces")
				.update({ state: "ready", last_active_at: new Date().toISOString(), error: null })
				.eq("id", row.id);
			row = { ...row, state: "ready", error: null };
			return { workspace: row, provider };
		} catch (error) {
			await getServiceClient()
				.from("a21_workspaces")
				.update({ state: "error", error: (error as Error).message.slice(0, 2000) })
				.eq("id", row.id);
			throw publicError(error);
		}
	}

	if (!allowCreate) {
		throw new ApiError(
			409,
			"workspace_not_ready",
			"Start the workspace before using files or the terminal.",
		);
	}

	if (!row) {
		const { data, error } = await getServiceClient()
			.from("a21_workspaces")
			.insert({
				project_id: project.id,
				owner_id: ownerId,
				provider: "daytona",
				state: "provisioning",
				root_path: "workspace",
			})
			.select("*")
			.single();
		if (error) {
			if (error.code === "23505") {
				throw new ApiError(409, "workspace_provisioning", "Workspace is already being created.");
			}
			throw new ApiError(500, "workspace_create_failed", "Could not create workspace record.");
		}
		row = data as WorkspaceRow;
	} else {
		const age = Date.now() - new Date(row.updated_at).getTime();
		if (row.state === "provisioning" && age < STALE_PROVISIONING_MS) {
			throw new ApiError(409, "workspace_provisioning", "Workspace is still starting.");
		}
		const { data, error } = await getServiceClient()
			.from("a21_workspaces")
			.update({ state: "provisioning", error: null })
			.eq("id", row.id)
			.eq("owner_id", ownerId)
			.select("*")
			.single();
		if (error) throw new ApiError(500, "workspace_update_failed", "Could not update workspace.");
		row = data as WorkspaceRow;
	}

	let provider: SandboxProvider;
	try {
		provider = getSandboxProvider();
	} catch {
		await getServiceClient()
			.from("a21_workspaces")
			.update({
				state: "error",
				error: "DAYTONA_API_KEY is not configured on the server.",
			})
			.eq("id", row.id);
		throw new ApiError(
			503,
			"sandbox_not_configured",
			"Cloud execution is not configured. Ask the operator to set DAYTONA_API_KEY.",
		);
	}

	try {
		const provisioned = await provider.provision({
			projectId: project.id,
			projectName: project.name,
			language: project.language,
			template: project.template,
			repoUrl: project.repo_url,
			repoBranch: null,
		});
		const { data, error } = await getServiceClient()
			.from("a21_workspaces")
			.update({
				state: "ready",
				external_id: provisioned.externalId,
				root_path: provisioned.rootPath,
				resources: {
					runtime: provisioned.runtime,
					setupLog: provisioned.setupLog.slice(-40),
				},
				last_active_at: new Date().toISOString(),
				error: null,
			})
			.eq("id", row.id)
			.select("*")
			.single();
		if (error) throw new ApiError(500, "workspace_save_failed", "Could not save workspace.");
		return { workspace: data as WorkspaceRow, provider };
	} catch (error) {
		if (error instanceof ApiError) throw error;
		const detail = error instanceof Error ? error.message : String(error);
		await getServiceClient()
			.from("a21_workspaces")
			.update({ state: "error", error: detail.slice(0, 2000) })
			.eq("id", row.id);
		throw publicError(error);
	}
}

export async function ensureWorkspaceForData(
	project: ProjectRow,
	ownerId: string,
): Promise<WorkspaceContext> {
	const context = await ensureWorkspace(project, ownerId, { allowCreate: false });
	if (context.workspace.state !== "ready" || !context.workspace.external_id) {
		throw new ApiError(409, "workspace_not_ready", "Workspace is not ready yet.");
	}
	return context;
}

export async function installWorkspaceRuntime(
	project: ProjectRow,
	ownerId: string,
): Promise<{ ready: boolean; detail: string }> {
	const context = await ensureWorkspaceForData(project, ownerId);
	const workspace = context.workspace;
	if (!workspace.external_id) {
		throw new ApiError(409, "workspace_not_ready", "Workspace is not ready yet.");
	}
	const status = await context.provider.installRuntime(
		workspace.external_id,
		workspace.root_path,
		project.language,
	);
	await getServiceClient()
		.from("a21_workspaces")
		.update({
			resources: {
				...(workspace.resources ?? {}),
				runtime: status,
			},
		})
		.eq("id", workspace.id);
	return { ready: status.ready, detail: status.detail };
}

export async function deleteWorkspace(projectId: string, ownerId: string): Promise<void> {
	const row = await getWorkspaceRow(projectId, ownerId);
	if (!row) return;
	if (row.external_id) {
		try {
			await getSandboxProvider().delete(row.external_id);
		} catch {
			// A sandbox that is already gone should still release the database row.
		}
	}
	await getServiceClient()
		.from("a21_workspaces")
		.update({ state: "deleted", external_id: null, preview_url: null })
		.eq("id", row.id)
		.eq("owner_id", ownerId);
}
