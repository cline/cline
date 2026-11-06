import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireOwnedProject, requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { normalizeSandboxError } from "@/lib/sandbox/errors";
import { ensureWorkspaceForData } from "@/lib/sandbox/workspace-service";
import { getServiceClient } from "@/lib/supabase/service";
import { writeFileSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_EDITABLE_BYTES = 500_000;

function looksBinary(buffer: Buffer): boolean {
	const sample = buffer.subarray(0, 4096);
	for (const byte of sample) {
		if (byte === 0) return true;
	}
	return false;
}

export async function GET(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const project = await requireOwnedProject(id, user.id);
		const relativePath = new URL(request.url).searchParams.get("path");
		if (!relativePath) throw new ApiError(400, "path_required", "A file path is required.");

		const { provider, workspace } = await ensureWorkspaceForData(project, user.id);
		if (!workspace.external_id)
			throw new ApiError(409, "workspace_not_ready", "Workspace is not ready.");

		const buffer = await provider.readFile(
			workspace.external_id,
			workspace.root_path,
			relativePath,
		);

		if (looksBinary(buffer)) {
			return jsonOk({ path: relativePath, binary: true, size: buffer.byteLength, content: null });
		}

		const truncated = buffer.byteLength > MAX_EDITABLE_BYTES;
		return jsonOk({
			path: relativePath,
			binary: false,
			size: buffer.byteLength,
			truncated,
			content: buffer.subarray(0, MAX_EDITABLE_BYTES).toString("utf8"),
		});
	} catch (error) {
		return handleApiError(normalizeSandboxError(error));
	}
}

export async function PUT(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const project = await requireOwnedProject(id, user.id);
		await enforceRateLimit(user.id, "fileWrite");
		const body = await readJson(request, writeFileSchema);

		const { provider, workspace } = await ensureWorkspaceForData(project, user.id);
		if (!workspace.external_id)
			throw new ApiError(409, "workspace_not_ready", "Workspace is not ready.");

		let before: string | null = null;
		try {
			before = (
				await provider.readFile(workspace.external_id, workspace.root_path, body.path)
			).toString("utf8");
		} catch {
			before = null;
		}

		await provider.writeFile(workspace.external_id, workspace.root_path, body.path, body.content);
		await getServiceClient()
			.from("a21_file_changes")
			.insert({
				project_id: project.id,
				task_id: null,
				owner_id: user.id,
				path: body.path,
				change_type: before === null ? "create" : "update",
				before_content: before,
				after_content: body.content,
				tool_call_id: "manual",
			});

		return jsonOk({ saved: true, path: body.path });
	} catch (error) {
		return handleApiError(normalizeSandboxError(error));
	}
}
