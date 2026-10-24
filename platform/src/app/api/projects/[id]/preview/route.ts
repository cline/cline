import { z } from "zod";
import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireOwnedProject, requireUser } from "@/lib/auth";
import { normalizeSandboxError } from "@/lib/sandbox/errors";
import { ensureWorkspaceForData } from "@/lib/sandbox/workspace-service";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

const previewSchema = z.object({
	port: z.number().int().min(1024).max(65535),
});

export async function POST(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const project = await requireOwnedProject(id, user.id);
		const body = await readJson(request, previewSchema);

		const { provider, workspace } = await ensureWorkspaceForData(project, user.id);
		if (!workspace.external_id)
			throw new ApiError(409, "workspace_not_ready", "Workspace is not ready.");

		const preview = await provider.getPreviewLink(workspace.external_id, body.port);
		await getServiceClient()
			.from("a21_workspaces")
			.update({
				preview_url: preview.url,
				preview_port: body.port,
				last_active_at: new Date().toISOString(),
			})
			.eq("id", workspace.id)
			.eq("owner_id", user.id);

		return jsonOk({ url: preview.url, port: body.port });
	} catch (error) {
		return handleApiError(normalizeSandboxError(error));
	}
}
