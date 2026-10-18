import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitsForPlan } from "@/lib/plans";
import { getOrCreateProfile } from "@/lib/profile";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProjectRow, WorkspaceRow } from "@/lib/types";
import { createProjectSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		const user = await requireUser();
		const url = new URL(request.url);
		const status = url.searchParams.get("status");
		const client = getServiceClient();

		let query = client
			.from("a21_projects")
			.select("*")
			.eq("owner_id", user.id)
			.order("updated_at", { ascending: false });

		if (status === "archived" || status === "active") {
			query = query.eq("status", status);
		}

		const { data, error } = await query;
		if (error) throw new ApiError(500, "projects_lookup_failed", "Could not load projects.");

		const projects = (data ?? []) as ProjectRow[];
		const ids = projects.map((project) => project.id);
		let workspaces: WorkspaceRow[] = [];
		if (ids.length > 0) {
			const { data: workspaceRows } = await client
				.from("a21_workspaces")
				.select("*")
				.eq("owner_id", user.id)
				.in("project_id", ids);
			workspaces = (workspaceRows ?? []) as WorkspaceRow[];
		}

		return jsonOk({ projects, workspaces });
	} catch (error) {
		return handleApiError(error);
	}
}

export async function POST(request: Request) {
	try {
		const user = await requireUser();
		await enforceRateLimit(user.id, "projectCreate");
		const body = await readJson(request, createProjectSchema);

		const profile = await getOrCreateProfile(user);
		const limits = limitsForPlan(profile.plan);
		const client = getServiceClient();

		const { count, error: countError } = await client
			.from("a21_projects")
			.select("id", { count: "exact", head: true })
			.eq("owner_id", user.id)
			.eq("status", "active");
		if (countError) {
			throw new ApiError(500, "project_quota_failed", "Could not verify project limits.");
		}
		if ((count ?? 0) >= limits.projects) {
			throw new ApiError(
				402,
				"project_quota_exceeded",
				`Your ${profile.plan} plan includes ${limits.projects} active projects. Archive one or upgrade.`,
			);
		}

		const { data, error } = await client
			.from("a21_projects")
			.insert({
				owner_id: user.id,
				name: body.name,
				description: body.description,
				language: body.language,
				template: body.template,
				repo_url: body.repoUrl || null,
				default_model: body.modelId ?? null,
				approval_mode: body.approvalMode,
			})
			.select("*")
			.single();

		if (error) {
			if (error.code === "23505") {
				throw new ApiError(409, "project_name_taken", "You already have a project with that name.");
			}
			throw new ApiError(500, "project_create_failed", "Could not create the project.");
		}

		await client.from("a21_audit_logs").insert({
			owner_id: user.id,
			action: "project.created",
			resource_type: "a21_project",
			resource_id: data.id,
			metadata: { language: body.language, template: body.template },
		});

		return jsonOk({ project: data as ProjectRow }, { status: 201 });
	} catch (error) {
		return handleApiError(error);
	}
}
