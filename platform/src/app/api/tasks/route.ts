import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireOwnedProject, requireUser } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { getModelById } from "@/lib/openrouter/models";
import { limitsForPlan } from "@/lib/plans";
import { getOrCreateProfile, getOrCreateSettings } from "@/lib/profile";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase/service";
import type { ConversationRow, ProjectRow, TaskRow } from "@/lib/types";
import { assertTaskQuota, countActiveTasks } from "@/lib/usage";
import { createTaskSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function deriveTitle(prompt: string): string {
	const firstLine = prompt.trim().split("\n")[0] ?? "New task";
	const condensed = firstLine
		.replace(/\s+/g, " ")
		.replace(/^[#>*\-\s]+/, "")
		.trim();
	if (!condensed) return "New task";
	return condensed.length > 90 ? `${condensed.slice(0, 87)}…` : condensed;
}

export async function GET(request: Request) {
	try {
		const user = await requireUser();
		const url = new URL(request.url);
		const projectId = url.searchParams.get("projectId");
		const status = url.searchParams.get("status");
		const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100));
		const client = getServiceClient();

		let query = client
			.from("a21_tasks")
			.select("*")
			.eq("owner_id", user.id)
			.order("created_at", { ascending: false })
			.limit(limit);
		if (projectId) query = query.eq("project_id", projectId);
		if (status) query = query.eq("status", status);

		const { data, error } = await query;
		if (error) throw new ApiError(500, "tasks_lookup_failed", "Could not load tasks.");

		const tasks = (data ?? []) as TaskRow[];
		const projectIds = [...new Set(tasks.map((task) => task.project_id))];
		let projects: Array<Pick<ProjectRow, "id" | "name" | "language">> = [];
		if (projectIds.length > 0) {
			const { data: projectRows } = await client
				.from("a21_projects")
				.select("id, name, language")
				.eq("owner_id", user.id)
				.in("id", projectIds);
			projects = (projectRows ?? []) as Array<Pick<ProjectRow, "id" | "name" | "language">>;
		}

		return jsonOk({ tasks, projects });
	} catch (error) {
		return handleApiError(error);
	}
}

export async function POST(request: Request) {
	try {
		const user = await requireUser();
		await enforceRateLimit(user.id, "taskCreate");
		const body = await readJson(request, createTaskSchema);

		const project = await requireOwnedProject(body.projectId, user.id);
		const [profile, settings] = await Promise.all([
			getOrCreateProfile(user),
			getOrCreateSettings(user.id),
		]);
		const limits = limitsForPlan(profile.plan);

		const quota = await assertTaskQuota(user.id, profile.plan);
		if (settings.monthly_task_limit && quota.usedTasks >= settings.monthly_task_limit) {
			throw new ApiError(
				402,
				"personal_task_limit",
				`You reached your personal limit of ${settings.monthly_task_limit} tasks this month. Raise it in Settings or wait for the next cycle.`,
			);
		}
		if (settings.monthly_token_limit && quota.usedTokens >= settings.monthly_token_limit) {
			throw new ApiError(
				402,
				"personal_token_limit",
				`You reached your personal limit of ${settings.monthly_token_limit.toLocaleString()} tokens this month. Raise it in Settings or wait for the next cycle.`,
			);
		}
		const active = await countActiveTasks(user.id);
		const concurrency = Math.min(limits.concurrentTasks, settings.max_concurrent_tasks);
		if (active >= concurrency) {
			throw new ApiError(
				429,
				"concurrency_limit",
				`You already have ${active} task${active === 1 ? "" : "s"} running. Your ${profile.plan} plan allows ${concurrency} at once.`,
			);
		}

		try {
			const model = await getModelById(body.modelId);
			if (model && !model.supportsTools) {
				throw new ApiError(
					400,
					"model_unsupported",
					`${model.name} does not advertise tool calling on OpenRouter. Choose a tool-capable model.`,
				);
			}
		} catch (error) {
			if (error instanceof ApiError) throw error;
			// Discovery being offline must not block a task; OpenRouter validates at run time.
		}

		const client = getServiceClient();
		let conversation: ConversationRow | null = null;
		if (body.conversationId) {
			const { data } = await client
				.from("a21_conversations")
				.select("*")
				.eq("id", body.conversationId)
				.eq("project_id", project.id)
				.eq("owner_id", user.id)
				.maybeSingle();
			if (!data) throw new ApiError(404, "conversation_not_found", "Conversation not found.");
			conversation = data as ConversationRow;
		} else {
			const title = body.title ?? deriveTitle(body.prompt);
			const { data, error } = await client
				.from("a21_conversations")
				.insert({ project_id: project.id, owner_id: user.id, title })
				.select("*")
				.single();
			if (error || !data) {
				throw new ApiError(500, "conversation_create_failed", "Could not start the conversation.");
			}
			conversation = data as ConversationRow;
		}

		const title = body.title ?? deriveTitle(body.prompt);
		const { data: taskData, error: taskError } = await client
			.from("a21_tasks")
			.insert({
				project_id: project.id,
				owner_id: user.id,
				conversation_id: conversation.id,
				title,
				prompt: body.prompt,
				model_id: body.modelId,
				status: "queued",
				max_iterations: limits.maxTaskIterations,
				max_attempts: 2,
				metadata: { plan: profile.plan },
			})
			.select("*")
			.single();
		if (taskError || !taskData) {
			throw new ApiError(500, "task_create_failed", "Could not create the task.");
		}
		const task = taskData as TaskRow;

		const env = getServerEnv();
		const { error: jobError } = await client.from("a21_jobs").insert({
			task_id: task.id,
			owner_id: user.id,
			kind: "task",
			status: "queued",
			max_attempts: 2,
			payload: {
				modelId: body.modelId,
				projectId: project.id,
				leaseSeconds: env.WORKER_LEASE_SECONDS,
			},
		});
		if (jobError) {
			await client.from("a21_tasks").delete().eq("id", task.id).eq("owner_id", user.id);
			throw new ApiError(500, "job_create_failed", "Could not enqueue the task.");
		}

		await client.from("a21_messages").insert({
			conversation_id: conversation.id,
			task_id: task.id,
			owner_id: user.id,
			role: "user",
			content: [{ type: "text", text: body.prompt }],
		});
		await client.from("a21_task_events").insert({
			task_id: task.id,
			owner_id: user.id,
			type: "task.queued",
			level: "info",
			message: "Task queued — waiting for an available worker.",
			payload: { modelId: body.modelId },
		});
		await client
			.from("a21_conversations")
			.update({ title, updated_at: new Date().toISOString() })
			.eq("id", conversation.id);
		await client.from("a21_audit_logs").insert({
			owner_id: user.id,
			action: "task.created",
			resource_type: "a21_task",
			resource_id: task.id,
			metadata: { projectId: project.id, modelId: body.modelId },
		});

		return jsonOk({ task, conversation }, { status: 201 });
	} catch (error) {
		return handleApiError(error);
	}
}
