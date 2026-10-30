import { AgentRuntime } from "@cline/agents";
import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentTool,
	AgentUsage,
	ToolApprovalResult,
} from "@cline/shared";
import { TaskEventLogger } from "@/lib/agent/events";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import { type AgentRunState, buildAgentTools } from "@/lib/agent/tools";
import { ApiError, sanitizeLogMessage } from "@/lib/api";
import { hashToolInput } from "@/lib/crypto";
import { getServerEnv } from "@/lib/env";
import { resolveOpenRouterKey } from "@/lib/openrouter/keys";
import { getModelById } from "@/lib/openrouter/models";
import { computeCost } from "@/lib/openrouter/pricing";
import type { SandboxProvider } from "@/lib/sandbox/types";
import { ensureWorkspace } from "@/lib/sandbox/workspace-service";
import { getServiceClient } from "@/lib/supabase/service";
import type { ApprovalMode, MessageRow, ProjectRow, TaskRow, WorkspaceRow } from "@/lib/types";
import { safeJson } from "@/lib/utils";

type RunInput = {
	taskId: string;
	jobId: string;
	workerId: string;
	jobAttempts: number;
	jobMaxAttempts: number;
};

export type RunOutcome = {
	status: "succeeded" | "failed" | "cancelled" | "waiting_approval" | "retry";
	summary?: string;
	error?: string;
};

function isPermanentProviderError(message: string): boolean {
	return /(401|403|402|unauthori[sz]ed|forbidden|insufficient credits|not found|does not support|invalid model|context length|context window)/i.test(
		message,
	);
}

function truncateMessageContent(content: unknown): unknown {
	if (typeof content === "string") return content.slice(0, 60_000);
	if (Array.isArray(content)) return content.map((part) => truncateMessageContent(part));
	if (content && typeof content === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(content as Record<string, unknown>)) {
			out[key] = truncateMessageContent(value);
		}
		return out;
	}
	return content;
}

function buildRunInput(): AgentMessage[] {
	// The current user instruction is already part of `initialMessages`
	// (task prompt or the retry/approval follow-up). Passing it again would
	// duplicate the message, so the runtime starts the loop from history.
	return [];
}

async function loadMessages(task: TaskRow): Promise<AgentMessage[]> {
	const { data, error } = await getServiceClient()
		.from("a21_messages")
		.select("*")
		.eq("task_id", task.id)
		.eq("owner_id", task.owner_id)
		.order("created_at", { ascending: true })
		.limit(120);
	if (error) throw new ApiError(500, "message_load_failed", "Could not load task messages.");

	return ((data ?? []) as MessageRow[]).map((row) => ({
		id: row.id,
		role: row.role === "system" ? "user" : row.role,
		content: (Array.isArray(row.content)
			? row.content
			: [{ type: "text", text: "" }]) as AgentMessage["content"],
		createdAt: Date.parse(row.created_at) || Date.now(),
		...(row.model_id ? { modelInfo: { id: row.model_id, provider: "openrouter" } } : {}),
	}));
}

async function persistNewMessages(
	task: TaskRow,
	messages: readonly AgentMessage[],
	known: Set<string>,
): Promise<void> {
	const client = getServiceClient();
	const rows = messages
		.filter(
			(message) =>
				(message.role === "assistant" || message.role === "tool") && !known.has(message.id),
		)
		.map((message) => ({
			conversation_id: task.conversation_id,
			task_id: task.id,
			owner_id: task.owner_id,
			role: message.role,
			content: truncateMessageContent(message.content),
			model_id: message.modelInfo?.id ?? task.model_id,
			created_at: new Date(message.createdAt || Date.now()).toISOString(),
		}))
		.slice(-60);
	if (rows.length === 0) return;
	const { error } = await client.from("a21_messages").insert(rows);
	if (error && error.code !== "23505") {
		console.error("[21-agent] Could not persist messages:", error.message);
	}
}

async function updateTask(taskId: string, ownerId: string, patch: Record<string, unknown>) {
	await getServiceClient().from("a21_tasks").update(patch).eq("id", taskId).eq("owner_id", ownerId);
}

async function insertUsage(input: {
	task: TaskRow;
	modelId: string;
	usage: AgentUsage;
}): Promise<{ costUsd: number; pricing: unknown; totalTokens: number }> {
	let model = null;
	try {
		model = await getModelById(input.modelId);
	} catch {
		// Cost estimation is best effort. Tokens are always recorded.
	}
	const cost = computeCost(
		{
			inputTokens: input.usage.inputTokens ?? 0,
			outputTokens: input.usage.outputTokens ?? 0,
			cacheReadTokens: input.usage.cacheReadTokens ?? 0,
			cacheWriteTokens: input.usage.cacheWriteTokens ?? 0,
		},
		model,
	);
	const providerCost =
		typeof input.usage.totalCost === "number" && input.usage.totalCost > 0
			? input.usage.totalCost
			: null;
	const costUsd = providerCost ?? cost.costUsd;
	const client = getServiceClient();
	await client.from("a21_usage_records").insert({
		owner_id: input.task.owner_id,
		project_id: input.task.project_id,
		task_id: input.task.id,
		model_id: input.modelId,
		provider: "openrouter",
		prompt_tokens: input.usage.inputTokens ?? 0,
		completion_tokens: input.usage.outputTokens ?? 0,
		cache_read_tokens: input.usage.cacheReadTokens ?? 0,
		cache_write_tokens: input.usage.cacheWriteTokens ?? 0,
		cost_usd: costUsd,
		pricing: providerCost !== null ? { source: "provider-reported" } : cost.pricing,
	});
	return {
		costUsd,
		pricing: cost.pricing,
		totalTokens:
			(input.usage.inputTokens ?? 0) +
			(input.usage.outputTokens ?? 0) +
			(input.usage.cacheReadTokens ?? 0) +
			(input.usage.cacheWriteTokens ?? 0),
	};
}

async function countFileChanges(taskId: string, ownerId: string): Promise<number> {
	const { count } = await getServiceClient()
		.from("a21_file_changes")
		.select("id", { count: "exact", head: true })
		.eq("task_id", taskId)
		.eq("owner_id", ownerId);
	return count ?? 0;
}

async function createApprovalOrResolve(input: {
	task: TaskRow;
	toolName: string;
	toolInput: unknown;
	logger: TaskEventLogger;
	runState: AgentRunState;
}): Promise<ToolApprovalResult> {
	const { task, toolName, toolInput, logger, runState } = input;
	const client = getServiceClient();
	const inputHash = hashToolInput(toolInput);
	const { data: decided, error: decidedError } = await client
		.from("a21_approvals")
		.select("*")
		.eq("task_id", task.id)
		.eq("owner_id", task.owner_id)
		.eq("tool_name", toolName)
		.eq("input_hash", inputHash)
		.in("status", ["approved", "rejected"])
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (decidedError) {
		throw new Error("Could not verify tool approval state.");
	}
	if (decided?.status === "approved") {
		runState.approvalPending = false;
		return { approved: true };
	}
	if (decided?.status === "rejected") {
		return {
			approved: false,
			reason:
				decided.note ??
				"The user rejected this action. Do not retry it; choose a different approach or finish with remaining issues.",
		};
	}

	const approvalInput = JSON.parse(
		JSON.stringify(truncateMessageContent(toolInput) ?? {}),
	) as Record<string, unknown>;
	const { data: pending } = await client
		.from("a21_approvals")
		.select("id")
		.eq("task_id", task.id)
		.eq("tool_name", toolName)
		.eq("input_hash", inputHash)
		.eq("status", "pending")
		.maybeSingle();

	let approvalId = pending?.id as string | undefined;
	if (!approvalId) {
		const { data, error } = await client
			.from("a21_approvals")
			.insert({
				task_id: task.id,
				owner_id: task.owner_id,
				tool_name: toolName,
				input: approvalInput,
				input_hash: inputHash,
				status: "pending",
			})
			.select("id")
			.single();
		if (error) {
			if (error.code === "23505") {
				const { data: raced } = await client
					.from("a21_approvals")
					.select("id")
					.eq("task_id", task.id)
					.eq("tool_name", toolName)
					.eq("input_hash", inputHash)
					.eq("status", "pending")
					.maybeSingle();
				approvalId = raced?.id as string | undefined;
			} else {
				throw new Error("Could not create the approval request.");
			}
		} else {
			approvalId = data.id as string;
		}
	}

	if (!approvalId) throw new Error("Could not create the approval request.");

	await updateTask(task.id, task.owner_id, { status: "waiting_approval" });
	runState.approvalPending = true;
	await logger.emit("approval.required", {
		level: "warn",
		message: `Approval required for ${toolName}`,
		toolName,
		payload: {
			approvalId,
			toolName,
			input: approvalInput,
		},
	});
	return {
		approved: false,
		reason:
			"This action is paused waiting for the user's approval in 21 Agent. Do not retry it and do not fabricate completion. Finish the run by calling finish_task with a short summary explaining that an approval is pending.",
	};
}

export async function runTask(input: RunInput): Promise<RunOutcome> {
	const env = getServerEnv();
	const client = getServiceClient();
	const { data: taskData, error: taskError } = await client
		.from("a21_tasks")
		.select("*")
		.eq("id", input.taskId)
		.maybeSingle();
	if (taskError || !taskData) {
		await getServiceClient().rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "failed",
			p_error: "Task no longer exists.",
		});
		return { status: "failed", error: "Task no longer exists." };
	}
	const task = taskData as TaskRow;

	const { data: projectData, error: projectError } = await client
		.from("a21_projects")
		.select("*")
		.eq("id", task.project_id)
		.eq("owner_id", task.owner_id)
		.maybeSingle();
	if (projectError || !projectData) {
		await updateTask(task.id, task.owner_id, {
			status: "failed",
			error: "Project no longer exists.",
			completed_at: new Date().toISOString(),
		});
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "failed",
			p_error: "Project no longer exists.",
		});
		return { status: "failed", error: "Project no longer exists." };
	}
	const project = projectData as ProjectRow;

	if (task.cancel_requested) {
		await updateTask(task.id, task.owner_id, {
			status: "cancelled",
			completed_at: new Date().toISOString(),
			progress: 100,
		});
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "cancelled",
			p_error: null,
		});
		return { status: "cancelled" };
	}

	const logger = new TaskEventLogger(task.id, task.owner_id);
	await updateTask(task.id, task.owner_id, {
		status: "provisioning",
		progress: 8,
		started_at: task.started_at ?? new Date().toISOString(),
		attempt: input.jobAttempts,
		error: null,
	});
	await logger.emit("workspace.starting", {
		message: "Preparing the isolated cloud workspace",
	});

	// Keep the job lease alive during provisioning and agent execution. The
	// lease must never lapse while a sandbox is being created.
	let runtime: AgentRuntime | null = null;
	let leaseLost = false;
	let cancelSignal = false;
	const heartbeat = setInterval(async () => {
		try {
			const { data: heartbeatOk } = await client.rpc("a21_heartbeat_job", {
				p_job_id: input.jobId,
				p_worker_id: input.workerId,
				p_lease_seconds: env.WORKER_LEASE_SECONDS,
			});
			if (heartbeatOk === false) {
				leaseLost = true;
				runtime?.abort("Job lease was lost to another worker.");
			}
			const { data } = await client
				.from("a21_tasks")
				.select("cancel_requested, status")
				.eq("id", task.id)
				.eq("owner_id", task.owner_id)
				.maybeSingle();
			if (data?.cancel_requested || data?.status === "cancelled") {
				cancelSignal = true;
				runtime?.abort("Cancelled by user.");
			}
		} catch {
			// A transient heartbeat failure should not abort real work.
		}
	}, 15_000);
	const stopHeartbeat = () => clearInterval(heartbeat);

	let workspace: WorkspaceRow;
	let provider: SandboxProvider;
	try {
		const context = await ensureWorkspace(project, task.owner_id, { allowCreate: true });
		workspace = context.workspace;
		provider = context.provider;
	} catch (error) {
		const message =
			error instanceof ApiError ? error.message : "Could not prepare the cloud workspace.";
		await updateTask(task.id, task.owner_id, {
			status: "failed",
			error: message.slice(0, 2000),
			progress: 100,
			completed_at: new Date().toISOString(),
		});
		await logger.emit("workspace.failed", { level: "error", message });
		await logger.close();
		stopHeartbeat();
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "failed",
			p_error: message.slice(0, 2000),
		});
		return { status: "failed", error: message };
	}

	if (!workspace.external_id) {
		const message = "Workspace has no sandbox id.";
		await updateTask(task.id, task.owner_id, {
			status: "failed",
			error: message,
			completed_at: new Date().toISOString(),
		});
		await logger.close();
		stopHeartbeat();
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "failed",
			p_error: message,
		});
		return { status: "failed", error: message };
	}

	await logger.emit("workspace.ready", {
		message: `Sandbox ${workspace.external_id} is ready`,
		payload: { rootPath: workspace.root_path, provider: workspace.provider },
	});

	if (cancelSignal || task.cancel_requested) {
		await updateTask(task.id, task.owner_id, {
			status: "cancelled",
			progress: 100,
			completed_at: new Date().toISOString(),
			error: null,
		});
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "cancelled",
			p_error: null,
		});
		await logger.emit("task.cancelled", { level: "warn", message: "Task cancelled" });
		await logger.close();
		stopHeartbeat();
		return { status: "cancelled" };
	}
	if (leaseLost) {
		await logger.emit("run.failed", {
			level: "error",
			message: "Job lease was lost; another worker owns this task.",
		});
		await logger.close();
		stopHeartbeat();
		return { status: "retry", error: "Job lease lost." };
	}

	// Runtime provisioning happens in the long-lived worker. Never block a
	// short-lived serverless tick for minutes installing a compiler.
	const runtimeInfo = safeJson<{ ready?: boolean; detail?: string }>(
		(workspace.resources as Record<string, unknown> | null)?.runtime,
		{},
	);
	if (
		runtimeInfo.ready === false &&
		!process.env.VERCEL &&
		process.env.A21_AUTO_INSTALL_RUNTIMES !== "false"
	) {
		await logger.emit("runtime.setup", {
			message: `Installing ${project.language} runtime`,
		});
		try {
			const status = await provider.installRuntime(
				workspace.external_id,
				workspace.root_path,
				project.language,
			);
			await logger.emit("runtime.result", {
				level: status.ready ? "info" : "warn",
				message: status.detail.slice(0, 1500),
				payload: { ready: status.ready, language: project.language },
			});
			await client
				.from("a21_workspaces")
				.update({
					resources: {
						...(workspace.resources ?? {}),
						runtime: status,
					},
				})
				.eq("id", workspace.id);
		} catch (error) {
			await logger.emit("runtime.result", {
				level: "warn",
				message: sanitizeLogMessage(
					error instanceof Error ? error.message : "Runtime installation failed",
				),
			});
		}
	}

	await updateTask(task.id, task.owner_id, { status: "running", progress: 12 });

	let apiKey: string;
	try {
		const resolved = await resolveOpenRouterKey(task.owner_id);
		apiKey = resolved.key;
	} catch (error) {
		const message =
			error instanceof ApiError ? error.message : "No OpenRouter credentials are available.";
		await updateTask(task.id, task.owner_id, {
			status: "failed",
			error: message,
			progress: 100,
			completed_at: new Date().toISOString(),
		});
		await logger.emit("run.failed", { level: "error", message });
		await logger.close();
		stopHeartbeat();
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "failed",
			p_error: message.slice(0, 2000),
		});
		return { status: "failed", error: message };
	}

	let model = null;
	try {
		model = await getModelById(task.model_id);
	} catch {
		// Discovery is advisory; the provider is the source of truth.
	}
	if (model && !model.supportsTools) {
		const message = `${model.name} does not advertise tool calling on OpenRouter. Choose a tool-capable model.`;
		await updateTask(task.id, task.owner_id, {
			status: "failed",
			error: message,
			progress: 100,
			completed_at: new Date().toISOString(),
		});
		await logger.emit("run.failed", { level: "error", message });
		await logger.close();
		stopHeartbeat();
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "failed",
			p_error: message.slice(0, 2000),
		});
		return { status: "failed", error: message };
	}

	const initialMessages = await loadMessages(task);
	const seenMessageIds = new Set(initialMessages.map((message) => message.id));
	const runState: AgentRunState = {
		finished: false,
		approvalPending: false,
		testsRun: [],
		remainingIssues: [],
	};
	const toolRuntime = {
		taskId: task.id,
		projectId: project.id,
		ownerId: task.owner_id,
		workspaceId: workspace.id,
		sandboxId: workspace.external_id,
		rootPath: workspace.root_path,
		language: project.language,
		approvalMode: project.approval_mode as ApprovalMode,
		provider,
		state: runState,
		emit: (type: string, message: string, payload?: Record<string, unknown>) =>
			logger.emit(type, { message, payload }),
	};

	const tools: AgentTool<any, any>[] = buildAgentTools(toolRuntime);
	let lastProgressUpdate = 0;

	const gatedTools = ["write_file", "edit_file", "delete_file", "run_command", "start_server"];
	const toolPolicies: Record<string, { autoApprove?: boolean; enabled?: boolean }> = {};
	if (project.approval_mode === "writes") {
		for (const name of gatedTools) toolPolicies[name] = { autoApprove: false };
	}
	if (project.approval_mode === "read_only") {
		for (const name of gatedTools) toolPolicies[name] = { enabled: false };
	}

	const activeRuntime = new AgentRuntime({
		providerId: "openrouter",
		modelId: task.model_id,
		apiKey,
		baseUrl: env.OPENROUTER_BASE_URL,
		headers: {
			"HTTP-Referer": env.OPENROUTER_SITE_URL,
			"X-Title": env.OPENROUTER_APP_NAME,
		},
		sessionId: task.id,
		conversationId: task.conversation_id,
		agentId: `agent_${task.id.slice(0, 8)}`,
		systemPrompt: buildSystemPrompt({
			projectName: project.name,
			language: project.language,
			template: project.template,
			rootPath: workspace.root_path,
			approvalMode: project.approval_mode as ApprovalMode,
			modelId: task.model_id,
		}),
		tools,
		initialMessages,
		maxIterations: Math.min(task.max_iterations, 60),
		toolExecution: "sequential",
		toolPolicies,
		toolContextMetadata: {
			taskId: task.id,
			projectId: project.id,
			conversationId: task.conversation_id,
		},
		completionPolicy: { requireCompletionTool: true },
		requestToolApproval: async (request): Promise<ToolApprovalResult> => {
			if (project.approval_mode === "auto") return { approved: true };
			return createApprovalOrResolve({
				task,
				toolName: request.toolName,
				toolInput: request.input,
				logger,
				runState,
			});
		},
		hooks: {
			onEvent: (event: AgentRuntimeEvent) => {
				switch (event.type) {
					case "run-started":
						void logger.emit("run.started", {
							message: `Agent run started with ${task.model_id}`,
							payload: { runId: event.snapshot.runId, modelId: task.model_id },
						});
						break;
					case "turn-started":
						if (Date.now() - lastProgressUpdate > 2500) {
							lastProgressUpdate = Date.now();
							void updateTask(task.id, task.owner_id, {
								iteration: event.iteration,
								progress: Math.min(88, 15 + event.iteration * 4),
							});
						}
						break;
					case "assistant-text-delta":
						void logger.delta(event.iteration, event.text);
						break;
					case "assistant-message": {
						const text = event.message.content
							.filter((part) => part.type === "text")
							.map((part) => (part.type === "text" ? part.text : ""))
							.join("");
						if (text.trim()) {
							void logger.emit("assistant.message", {
								message: text.slice(0, 8000),
								payload: { iteration: event.iteration, finishReason: event.finishReason },
							});
						}
						break;
					}
					case "tool-started":
						void logger.emit("tool.started", {
							message: `Running ${event.toolCall.toolName}`,
							toolName: event.toolCall.toolName,
							payload: { input: event.toolCall.input, toolCallId: event.toolCall.toolCallId },
						});
						break;
					case "tool-finished": {
						const resultPart = event.message.content.find((part) => part.type === "tool-result");
						void logger.emit("tool.finished", {
							level: resultPart?.type === "tool-result" && resultPart.isError ? "warn" : "info",
							message: `${event.toolCall.toolName} ${
								resultPart?.type === "tool-result" && resultPart.isError
									? "returned an error"
									: "completed"
							}`,
							toolName: event.toolCall.toolName,
							payload:
								resultPart?.type === "tool-result"
									? { output: resultPart.output, isError: resultPart.isError ?? false }
									: {},
						});
						break;
					}
					case "usage-updated":
						void updateTask(task.id, task.owner_id, {
							usage: {
								inputTokens: event.usage.inputTokens,
								outputTokens: event.usage.outputTokens,
								cacheReadTokens: event.usage.cacheReadTokens,
								cacheWriteTokens: event.usage.cacheWriteTokens,
							},
						});
						break;
					case "run-failed":
						void logger.emit("run.failed", {
							level: "error",
							message: sanitizeLogMessage(event.error.message),
						});
						break;
					case "status-notice":
						void logger.emit("notice", { message: event.message });
						break;
					default:
						break;
				}
			},
		},
	});

	runtime = activeRuntime;
	let result: Awaited<ReturnType<AgentRuntime["run"]>>;
	try {
		result = await activeRuntime.run(buildRunInput());
	} catch (error) {
		const message = sanitizeLogMessage(error instanceof Error ? error.message : String(error));
		result = {
			status: "failed" as const,
			error: new Error(message),
			messages: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			iterations: 0,
			outputText: "",
			agentId: "",
			runId: "",
		};
	} finally {
		stopHeartbeat();
	}

	if (runState.approvalPending) {
		let approvalUsage = { costUsd: 0 };
		if (result.usage) {
			try {
				approvalUsage = await insertUsage({ task, modelId: task.model_id, usage: result.usage });
			} catch {
				// Usage persistence is best-effort; the approval pause is not.
			}
		}
		await updateTask(task.id, task.owner_id, {
			usage: result.usage
				? {
						...task.usage,
						inputTokens: (task.usage.inputTokens ?? 0) + (result.usage.inputTokens ?? 0),
						outputTokens: (task.usage.outputTokens ?? 0) + (result.usage.outputTokens ?? 0),
						cacheReadTokens:
							(task.usage.cacheReadTokens ?? 0) + (result.usage.cacheReadTokens ?? 0),
						cacheWriteTokens:
							(task.usage.cacheWriteTokens ?? 0) + (result.usage.cacheWriteTokens ?? 0),
						costUsd: (task.usage.costUsd ?? 0) + approvalUsage.costUsd,
					}
				: task.usage,
		});
		await persistNewMessages(task, result.messages, seenMessageIds);
		await client
			.from("a21_jobs")
			.update({
				status: "queued",
				locked_by: null,
				locked_at: null,
				lease_expires_at: null,
				run_after: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
				last_error: "Paused until the user approves the pending action.",
			})
			.eq("id", input.jobId)
			.eq("locked_by", input.workerId);
		await updateTask(task.id, task.owner_id, {
			status: "waiting_approval",
			progress: 55,
			error: null,
		});
		await logger.close();
		stopHeartbeat();
		return { status: "waiting_approval" };
	}

	const cancelled =
		task.cancel_requested ||
		result.status === "aborted" ||
		(result.error ? /cancel/i.test(result.error.message) : false);

	if (cancelled) {
		await updateTask(task.id, task.owner_id, {
			status: "cancelled",
			progress: 100,
			error: null,
			completed_at: new Date().toISOString(),
		});
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "cancelled",
			p_error: null,
		});
		await logger.emit("task.cancelled", { level: "warn", message: "Task cancelled" });
		await logger.close();
		return { status: "cancelled" };
	}

	let usageInfo = { costUsd: 0, totalTokens: 0, pricing: null as unknown };
	if (result.usage) {
		try {
			usageInfo = await insertUsage({ task, modelId: task.model_id, usage: result.usage });
		} catch (error) {
			console.error(
				"[21-agent] Could not record usage:",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	const previousUsage = safeJson<Record<string, number>>(task.usage, {});
	const totalUsage = {
		inputTokens: (previousUsage.inputTokens ?? 0) + (result.usage?.inputTokens ?? 0),
		outputTokens: (previousUsage.outputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
		cacheReadTokens: (previousUsage.cacheReadTokens ?? 0) + (result.usage?.cacheReadTokens ?? 0),
		cacheWriteTokens: (previousUsage.cacheWriteTokens ?? 0) + (result.usage?.cacheWriteTokens ?? 0),
		costUsd: (previousUsage.costUsd ?? 0) + usageInfo.costUsd,
	};

	if (result.status === "completed" && runState.finished) {
		const filesChanged = await countFileChanges(task.id, task.owner_id);
		await updateTask(task.id, task.owner_id, {
			status: "succeeded",
			progress: 100,
			summary: runState.summary ?? result.outputText.slice(0, 8000),
			remaining_issues: runState.remainingIssues,
			usage: totalUsage,
			files_changed: filesChanged,
			error: null,
			completed_at: new Date().toISOString(),
			metadata: {
				...(task.metadata ?? {}),
				testsRun: runState.testsRun,
				iterations: result.iterations,
			},
		});
		await persistNewMessages(task, result.messages, seenMessageIds);
		await client.rpc("a21_finish_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_status: "succeeded",
			p_error: null,
		});
		await logger.emit("task.succeeded", {
			message: "Task completed",
			payload: { filesChanged, testsRun: runState.testsRun },
		});
		await logger.close();
		await client.from("a21_audit_logs").insert({
			owner_id: task.owner_id,
			action: "task.succeeded",
			resource_type: "a21_task",
			resource_id: task.id,
			metadata: { modelId: task.model_id, filesChanged, iterations: result.iterations },
		});
		return { status: "succeeded", summary: runState.summary };
	}

	const errorMessage = sanitizeLogMessage(
		result.error?.message ??
			(result.status === "completed"
				? "The agent ended without calling finish_task; the result is incomplete."
				: "The agent run failed."),
	);
	const permanent = isPermanentProviderError(errorMessage);
	const canRetry = !permanent && input.jobAttempts < input.jobMaxAttempts;

	if (canRetry) {
		await updateTask(task.id, task.owner_id, {
			status: "queued",
			error: errorMessage.slice(0, 2000),
			usage: totalUsage,
			progress: Math.max(12, task.progress),
		});
		await getServiceClient()
			.from("a21_messages")
			.insert({
				conversation_id: task.conversation_id,
				task_id: task.id,
				owner_id: task.owner_id,
				role: "user",
				content: [
					{
						type: "text",
						text: `The previous attempt stopped with: ${errorMessage}\n\nResume the task from the actual workspace state. Inspect what already changed instead of starting over, fix the failure, and finish with finish_task.`,
					},
				],
			});
		await client.rpc("a21_retry_job", {
			p_job_id: input.jobId,
			p_worker_id: input.workerId,
			p_error: errorMessage.slice(0, 2000),
			p_delay_seconds: Math.min(30 * input.jobAttempts, 120),
		});
		await logger.emit("run.retry", {
			level: "warn",
			message: `Retrying after failure (attempt ${input.jobAttempts}/${input.jobMaxAttempts})`,
			payload: { error: errorMessage.slice(0, 2000) },
		});
		await logger.close();
		return { status: "retry", error: errorMessage };
	}

	const filesChanged = await countFileChanges(task.id, task.owner_id);
	await updateTask(task.id, task.owner_id, {
		status: "failed",
		progress: 100,
		error: errorMessage.slice(0, 4000),
		usage: totalUsage,
		files_changed: filesChanged,
		completed_at: new Date().toISOString(),
	});
	await persistNewMessages(task, result.messages, seenMessageIds);
	await client.rpc("a21_finish_job", {
		p_job_id: input.jobId,
		p_worker_id: input.workerId,
		p_status: "failed",
		p_error: errorMessage.slice(0, 2000),
	});
	await logger.emit("task.failed", { level: "error", message: errorMessage });
	await logger.close();
	await client.from("a21_audit_logs").insert({
		owner_id: task.owner_id,
		action: "task.failed",
		resource_type: "a21_task",
		resource_id: task.id,
		metadata: { error: errorMessage.slice(0, 500) },
	});
	return { status: "failed", error: errorMessage };
}
