import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireOwnedProject, requireUser } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { limitsForPlan } from "@/lib/plans";
import { getOrCreateProfile, getOrCreateSettings } from "@/lib/profile";
import { enforceRateLimit } from "@/lib/rate-limit";
import { normalizeSandboxError } from "@/lib/sandbox/errors";
import { ensureWorkspaceForData } from "@/lib/sandbox/workspace-service";
import { executeCommandSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
	try {
		const user = await requireUser();
		const { id } = await context.params;
		const project = await requireOwnedProject(id, user.id);
		await enforceRateLimit(user.id, "terminalExec");

		const body = await readJson(request, executeCommandSchema);
		const env = getServerEnv();
		const [profile, settings] = await Promise.all([
			getOrCreateProfile(user),
			getOrCreateSettings(user.id),
		]);
		const limits = limitsForPlan(profile.plan);
		const timeout = Math.max(
			1,
			Math.min(
				body.timeoutSeconds ?? env.TERMINAL_MAX_TIMEOUT_SECONDS,
				env.TERMINAL_MAX_TIMEOUT_SECONDS,
				limits.maxTerminalTimeoutSeconds,
				settings.terminal_timeout_seconds,
			),
		);

		const { provider, workspace } = await ensureWorkspaceForData(project, user.id);
		if (!workspace.external_id)
			throw new ApiError(409, "workspace_not_ready", "Workspace is not ready.");

		const started = Date.now();
		const result = await provider.execute(
			workspace.external_id,
			workspace.root_path,
			body.command,
			{
				cwd: body.cwd,
				timeoutSeconds: timeout,
			},
		);

		const maxChars = env.SANDBOX_MAX_OUTPUT_CHARS;
		const output =
			result.output.length > maxChars
				? `${result.output.slice(0, maxChars)}\n… [output truncated at ${maxChars} characters]`
				: result.output;

		return jsonOk({
			exitCode: result.exitCode,
			output,
			durationMs: result.durationMs ?? Date.now() - started,
			timedOut: result.timedOut ?? false,
			command: body.command,
			cwd: body.cwd ?? ".",
		});
	} catch (error) {
		return handleApiError(normalizeSandboxError(error));
	}
}
