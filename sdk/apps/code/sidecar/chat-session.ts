import { execFile as execFileCallback } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
	buildWorkspaceMetadata,
	type ClineCore,
	createUserInstructionConfigWatcher,
	loadRulesForSystemPromptFromWatcher,
	mergeRulesForSystemPrompt,
	SessionSource,
	splitCoreSessionConfig,
} from "@clinebot/core";
import { buildClineSystemPrompt } from "@clinebot/shared";
import { emitChunk, nowMs, sendEvent } from "./context";
import { readSessionManifest, sharedSessionDataDir } from "./paths";
import type {
	ChatSessionCommandRequest,
	JsonRecord,
	LiveSession,
	SidecarContext,
} from "./types";

const execFile = promisify(execFileCallback);

// ---------------------------------------------------------------------------
// Session data helpers
// ---------------------------------------------------------------------------

function readPersistedChatMessages(sessionId: string): unknown[] | null {
	const path = join(
		sharedSessionDataDir(),
		sessionId,
		`${sessionId}.messages.json`,
	);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8").trim());
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function readSessionMetadataTitle(sessionId: string): string | undefined {
	const manifest = readSessionManifest(sessionId);
	const metadata =
		manifest?.metadata && typeof manifest.metadata === "object"
			? (manifest.metadata as JsonRecord)
			: undefined;
	const title = metadata?.title;
	return typeof title === "string" ? title.trim() || undefined : undefined;
}

function derivePromptFromMessages(messages: unknown[]): string {
	for (const msg of messages) {
		if (!msg || typeof msg !== "object") continue;
		const m = msg as JsonRecord;
		if (m.role !== "user") continue;
		if (typeof m.content === "string") {
			const line = m.content.trim().split("\n")[0]?.trim();
			if (line) return line.slice(0, 200);
		}
	}
	return "";
}

// ---------------------------------------------------------------------------
// Checkpoint helpers
// ---------------------------------------------------------------------------

type CheckpointEntry = {
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
};

function readCheckpointHistory(sessionId: string): CheckpointEntry[] {
	const manifestPath = join(
		sharedSessionDataDir(),
		sessionId,
		`${sessionId}.json`,
	);
	if (!existsSync(manifestPath)) return [];
	try {
		const manifest = JSON.parse(
			readFileSync(manifestPath, "utf8"),
		) as JsonRecord;
		const md =
			manifest.metadata && typeof manifest.metadata === "object"
				? (manifest.metadata as JsonRecord)
				: undefined;
		const cp =
			md?.checkpoint && typeof md.checkpoint === "object"
				? (md.checkpoint as JsonRecord)
				: undefined;
		const history = cp?.history;
		if (!Array.isArray(history)) return [];
		return history
			.filter((e): e is JsonRecord => !!e && typeof e === "object")
			.map((e) => ({
				ref: String(e.ref ?? "").trim(),
				createdAt: Number(e.createdAt ?? 0),
				runCount: Number(e.runCount ?? 0),
				kind:
					e.kind === "stash" || e.kind === "commit"
						? (e.kind as "stash" | "commit")
						: undefined,
			}))
			.filter(
				(e) =>
					e.ref.length > 0 &&
					Number.isFinite(e.createdAt) &&
					Number.isInteger(e.runCount) &&
					e.runCount > 0,
			);
	} catch {
		return [];
	}
}

function trimMessagesToCheckpoint(
	messages: unknown[],
	runCount: number,
): unknown[] {
	let userRunCount = 0;
	for (let i = 0; i < messages.length; i++) {
		const raw = messages[i];
		if (!raw || typeof raw !== "object") continue;
		const msg = raw as JsonRecord;
		if (msg.role !== "user") continue;
		const md =
			msg.metadata && typeof msg.metadata === "object"
				? (msg.metadata as JsonRecord)
				: undefined;
		if (md?.kind === "recovery_notice") continue;
		userRunCount++;
		if (userRunCount === runCount) return messages.slice(0, i + 1);
	}
	throw new Error(`Could not find user message for checkpoint run ${runCount}`);
}

async function applyCheckpointToWorktree(
	cwd: string,
	cp: CheckpointEntry,
): Promise<void> {
	const check = await execFile(
		"git",
		["-C", cwd, "rev-parse", "--is-inside-work-tree"],
		{ windowsHide: true },
	);
	if (check.stdout.trim() !== "true")
		throw new Error(`${cwd} is not a git repository`);
	await execFile("git", ["-C", cwd, "reset", "--hard"], { windowsHide: true });
	await execFile("git", ["-C", cwd, "clean", "-fd"], { windowsHide: true });
	if (cp.kind === "commit") {
		await execFile("git", ["-C", cwd, "reset", "--hard", cp.ref], {
			windowsHide: true,
		});
		return;
	}
	await execFile("git", ["-C", cwd, "stash", "apply", cp.ref], {
		windowsHide: true,
	});
}

// ---------------------------------------------------------------------------
// Live session factory
// ---------------------------------------------------------------------------

function createLiveSession(
	config: JsonRecord,
	overrides?: Partial<LiveSession>,
): LiveSession {
	return {
		config,
		messages: overrides?.messages ?? [],
		promptsInQueue: overrides?.promptsInQueue ?? [],
		busy: false,
		startedAt: nowMs(),
		status: overrides?.status ?? "idle",
		prompt: overrides?.prompt,
		title: overrides?.title,
		attachedViaHub: overrides?.attachedViaHub ?? false,
	};
}

function isoTimestampToMs(
	value: string | null | undefined,
): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function buildCoreSessionConfig(config: JsonRecord): JsonRecord {
	return {
		sessionId: config.sessionId ?? config.session_id,
		providerId: config.provider ?? config.providerId ?? "",
		modelId: config.model ?? config.modelId ?? "",
		mode: config.mode ?? "act",
		apiKey: config.apiKey ?? config.api_key ?? "",
		workspaceRoot: config.workspaceRoot ?? config.workspace_root ?? "",
		cwd: config.cwd ?? config.workspaceRoot ?? config.workspace_root ?? "",
		systemPrompt: config.systemPrompt ?? config.system_prompt ?? "",
		maxIterations: config.maxIterations ?? config.max_iterations,
		enableTools: config.enableTools ?? config.enable_tools ?? true,
		enableSpawnAgent:
			config.enableSpawn ??
			config.enableSpawnAgent ??
			config.enable_spawn ??
			false,
		enableAgentTeams:
			config.enableTeams ??
			config.enableAgentTeams ??
			config.enable_teams ??
			false,
		teamName: config.teamName ?? config.team_name,
		missionLogIntervalSteps:
			config.missionStepInterval ?? config.missionLogIntervalSteps,
		missionLogIntervalMs:
			config.missionTimeIntervalMs ?? config.missionLogIntervalMs,
		sessions: config.sessions,
		initialMessages: config.initialMessages,
	};
}

async function resolveSystemPrompt(config: JsonRecord): Promise<string> {
	const cwd = String(
		config.cwd ?? config.workspaceRoot ?? config.workspace_root ?? "",
	).trim();
	if (!cwd) {
		return String(config.systemPrompt ?? config.system_prompt ?? "").trim();
	}
	const providerId = String(config.provider ?? config.providerId ?? "").trim();
	const mode = config.autoApproveTools
		? "yolo"
		: config.mode === "plan"
			? "plan"
			: "act";
	const metadata = await buildWorkspaceMetadata(cwd);
	let watcherRules: string | undefined;
	const watcher = createUserInstructionConfigWatcher({
		skills: { workspacePath: cwd },
		rules: { workspacePath: cwd },
		workflows: { workspacePath: cwd },
	});
	try {
		await watcher.start();
		watcherRules = loadRulesForSystemPromptFromWatcher(watcher);
	} catch {
		watcherRules = undefined;
	} finally {
		watcher.stop();
	}
	const inlineRules =
		typeof config.rules === "string" && config.rules.trim().length > 0
			? config.rules
			: undefined;
	return buildClineSystemPrompt({
		ide: "Terminal Shell",
		workspaceRoot: cwd,
		workspaceName: basename(cwd),
		metadata,
		rules: mergeRulesForSystemPrompt(watcherRules, inlineRules),
		mode,
		providerId: providerId || undefined,
		overridePrompt:
			typeof config.systemPrompt === "string" &&
			config.systemPrompt.trim().length > 0
				? config.systemPrompt
				: typeof config.system_prompt === "string" &&
						config.system_prompt.trim().length > 0
					? config.system_prompt
					: undefined,
		platform: process.platform || "unknown",
	});
}

function resolveToolPolicies(
	config: JsonRecord,
): { "*": { autoApprove: boolean } } | undefined {
	return {
		"*": {
			autoApprove: config.autoApproveTools !== false,
		},
	};
}

function sendPromptsInQueueSnapshot(
	ctx: SidecarContext,
	sessionId: string,
): void {
	const session = ctx.liveSessions.get(sessionId);
	sendEvent(ctx, "prompts_in_queue_state", {
		sessionId,
		items: session?.promptsInQueue ?? [],
	});
}

function getSessionManager(ctx: SidecarContext): ClineCore {
	if (!ctx.sessionManager) throw new Error("Session manager not initialized");
	return ctx.sessionManager;
}

// ---------------------------------------------------------------------------
// Chat session action handlers
// ---------------------------------------------------------------------------

async function handleStart(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	if (!request.config) throw new Error("config is required");
	const manager = getSessionManager(ctx);
	const systemPrompt = await resolveSystemPrompt(request.config);
	const coreConfig: JsonRecord = {
		...buildCoreSessionConfig(request.config),
		systemPrompt,
	};
	// Note: do NOT pass `prompt` to manager.start() here. When a prompt is
	// provided to start(), the local runtime host runs the full agent turn
	// synchronously inside start(). We always start the session idle and let
	// the frontend call the separate "send" action to dispatch the prompt.
	// This avoids a double-execution bug where start() would run the turn AND
	// the subsequent manager.send() fire-and-forget would run it again.
	console.error(
		`[sidecar:handleStart] calling manager.start provider=${coreConfig.providerId} model=${coreConfig.modelId}`,
	);
	const startResult = await manager.start({
		...splitCoreSessionConfig(coreConfig as any),
		source: SessionSource.DESKTOP,
		interactive: true,
		toolPolicies: resolveToolPolicies(request.config),
	});
	const sessionId = startResult.sessionId;
	console.error(`[sidecar:handleStart] session started sessionId=${sessionId}`);
	const session = createLiveSession(request.config, {
		status: "idle",
	});
	ctx.liveSessions.set(sessionId, session);
	return { sessionId };
}

async function handleAttach(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) {
		throw new Error("sessionId is required");
	}

	const manager = getSessionManager(ctx);
	const session = await manager.get(sessionId);
	if (!session) {
		throw new Error(`Session ${sessionId} not found`);
	}

	const metadata =
		session.metadata && typeof session.metadata === "object"
			? (session.metadata as JsonRecord)
			: undefined;
	const existing = ctx.liveSessions.get(sessionId);
	if (ctx.hubClient) {
		await ctx.hubClient.command("session.attach", { sessionId }, sessionId);
	}
	const attachedConfig: JsonRecord = {
		...(existing?.config ?? {}),
		...(request.config ?? {}),
		sessionId,
		provider: session.provider || existing?.config.provider || "",
		model: session.model || existing?.config.model || "",
		cwd:
			session.cwd ||
			session.workspaceRoot ||
			String(request.config?.cwd ?? "").trim() ||
			String(existing?.config.cwd ?? "").trim(),
		workspaceRoot:
			session.workspaceRoot ||
			session.cwd ||
			String(request.config?.workspaceRoot ?? "").trim() ||
			String(existing?.config.workspaceRoot ?? "").trim(),
	};
	ctx.liveSessions.set(
		sessionId,
		createLiveSession(attachedConfig, {
			messages: existing?.messages ?? [],
			promptsInQueue: existing?.promptsInQueue ?? [],
			status: session.status,
			prompt:
				session.prompt ||
				(typeof metadata?.prompt === "string" ? metadata.prompt : undefined) ||
				existing?.prompt,
			title:
				(typeof metadata?.title === "string" ? metadata.title : undefined) ||
				existing?.title,
			endedAt: isoTimestampToMs(session.endedAt),
			attachedViaHub: true,
		}),
	);

	return {
		sessionId,
		status: session.status,
		provider: session.provider,
		model: session.model,
		cwd: session.cwd,
		workspaceRoot: session.workspaceRoot,
		prompt: session.prompt,
		metadata,
	};
}

async function handleSend(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	const prompt = request.prompt?.trim();
	if (!prompt) throw new Error("prompt is required");
	const manager = getSessionManager(ctx);
	const session = ctx.liveSessions.get(sessionId);

	// Determine effective delivery mode.
	// When the session is busy and no explicit delivery was requested, queue it
	// via Core so that Core's own pending-prompts mechanism handles draining.
	// This avoids a sidecar-only local queue that never calls manager.send().
	let delivery = request.delivery;
	if (!delivery && session?.busy) {
		delivery = "queue";
	}

	// Optimistically track queued prompts in the sidecar's local queue for
	// immediate UI feedback (prompts_in_queue_state), but only for "queue"
	// delivery — Core will drain them and emit pending_prompts events back.
	if (delivery === "queue") {
		const queueId = `queued_${Date.now()}_${Math.random().toString(36).slice(2)}`;
		if (session) {
			session.prompt = prompt;
			session.promptsInQueue.push({
				id: queueId,
				prompt,
				steer: false,
				attachmentCount: request.attachments?.userImages?.length ?? 0,
			});
			sendPromptsInQueueSnapshot(ctx, sessionId);
		}
		// Delegate queuing to Core — it will drain the prompt once the current
		// turn finishes and emit pending_prompts / pending_prompt_submitted events.
		manager
			.send({
				sessionId,
				prompt,
				delivery: "queue",
				userImages: request.attachments?.userImages,
			})
			.catch((error) => {
				console.error(
					`[sidecar:handleSend] manager.send (queue) THREW sessionId=${sessionId} error=${error instanceof Error ? error.message : String(error)}`,
				);
			});
		return { sessionId, ok: true, queued: true };
	}

	if (session) {
		session.prompt = prompt;
		session.busy = true;
		session.status = "running";
	}
	try {
		console.error(
			`[sidecar:handleSend] calling manager.send sessionId=${sessionId} prompt=${prompt.slice(0, 80)}`,
		);
		const result = await manager.send({
			sessionId,
			prompt,
			delivery,
			userImages: request.attachments?.userImages,
		});
		console.error(
			`[sidecar:handleSend] manager.send resolved sessionId=${sessionId} finishReason=${result?.finishReason} textLen=${result?.text?.length ?? 0}`,
		);
		if (session) {
			session.busy = false;
			session.status = "idle";
			if (result?.messages) session.messages = result.messages as unknown[];
		}
		return {
			sessionId,
			ok: true,
			result: result
				? {
						text: result.text,
						finishReason: result.finishReason,
						messages: result.messages,
						usage: result.usage,
						iterations: result.iterations,
						toolCalls: result.toolCalls,
					}
				: undefined,
		};
	} catch (error) {
		console.error(
			`[sidecar:handleSend] manager.send THREW sessionId=${sessionId} error=${error instanceof Error ? error.message : String(error)}`,
		);
		if (session) {
			session.busy = false;
			session.status = "error";
		}
		emitChunk(
			ctx,
			sessionId,
			"chat_core_log",
			JSON.stringify({
				level: "error",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return {
			sessionId,
			ok: true,
			result: {
				finishReason: "error",
				text: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

async function handleStop(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	await getSessionManager(ctx).stop(sessionId);
	const session = ctx.liveSessions.get(sessionId);
	if (session) {
		session.busy = false;
		session.status = "stopped";
	}
	return { sessionId, ok: true };
}

async function handleAbort(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	await getSessionManager(ctx).abort(sessionId, "user_abort");
	const session = ctx.liveSessions.get(sessionId);
	if (session) {
		session.busy = false;
		session.status = "aborted";
	}
	return { sessionId, ok: true };
}

async function handleReset(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (sessionId) {
		const session = ctx.liveSessions.get(sessionId);
		if (
			session?.busy ||
			session?.status === "starting" ||
			session?.status === "running" ||
			session?.status === "stopping"
		) {
			await getSessionManager(ctx).stop(sessionId);
		}
		ctx.liveSessions.delete(sessionId);
		sendPromptsInQueueSnapshot(ctx, sessionId);
	}
	return { sessionId: request.sessionId, ok: true };
}

async function handleRestoreCheckpoint(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sourceSessionId = request.sessionId?.trim();
	if (!sourceSessionId) throw new Error("sessionId is required");
	const runCount = request.checkpointRunCount;
	if (
		typeof runCount !== "number" ||
		!Number.isInteger(runCount) ||
		runCount < 1
	)
		throw new Error("checkpointRunCount must be a positive integer");
	if (!request.config)
		throw new Error("config is required to restore a checkpoint");
	const sourceMessages =
		readPersistedChatMessages(sourceSessionId) ??
		ctx.liveSessions.get(sourceSessionId)?.messages;
	if (!sourceMessages?.length)
		throw new Error(`No messages found for session ${sourceSessionId}`);
	const checkpoint = readCheckpointHistory(sourceSessionId).find(
		(e) => e.runCount === runCount,
	);
	if (!checkpoint)
		throw new Error(
			`No checkpoint found for run ${runCount} in session ${sourceSessionId}`,
		);
	const cwd =
		(typeof request.config.cwd === "string" && request.config.cwd.trim()) ||
		(typeof request.config.workspaceRoot === "string" &&
			request.config.workspaceRoot.trim()) ||
		"";
	if (!cwd) throw new Error("config.cwd or config.workspaceRoot is required");
	const restoredMessages = trimMessagesToCheckpoint(sourceMessages, runCount);
	await applyCheckpointToWorktree(cwd, checkpoint);
	const manager = getSessionManager(ctx);
	const startResult = await manager.start({
		...splitCoreSessionConfig(
			buildCoreSessionConfig({
				...request.config,
				systemPrompt: await resolveSystemPrompt(request.config),
				initialMessages: restoredMessages,
			}) as any,
		),
		source: SessionSource.DESKTOP,
		interactive: true,
		initialMessages: restoredMessages as any[],
		toolPolicies: resolveToolPolicies(request.config),
	});
	const sessionId = startResult.sessionId;
	ctx.liveSessions.delete(sourceSessionId);
	ctx.liveSessions.set(
		sessionId,
		createLiveSession(request.config, {
			messages: restoredMessages,
			prompt: derivePromptFromMessages(restoredMessages),
			title: readSessionMetadataTitle(sourceSessionId),
			status: "idle",
		}),
	);
	sendPromptsInQueueSnapshot(ctx, sourceSessionId);
	sendPromptsInQueueSnapshot(ctx, sessionId);
	let messages: unknown[] = restoredMessages;
	try {
		const read = await manager.readMessages(sessionId);
		if (read?.length > 0) messages = read;
	} catch {}
	return { sessionId, messages, restoredCheckpoint: checkpoint };
}

async function handlePendingPrompts(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	return {
		sessionId,
		promptsInQueue: ctx.liveSessions.get(sessionId)?.promptsInQueue ?? [],
	};
}

async function handleSteerPrompt(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	const promptId = request.promptId?.trim();
	if (!sessionId || !promptId)
		throw new Error("sessionId and promptId are required");
	const session = ctx.liveSessions.get(sessionId);
	if (!session) return { sessionId, promptsInQueue: [] };
	const queueIdx = session.promptsInQueue.findIndex((t) => t.id === promptId);
	const prompt =
		queueIdx >= 0 ? session.promptsInQueue[queueIdx]?.prompt : undefined;
	if (queueIdx >= 0) {
		session.promptsInQueue.splice(queueIdx, 1);
	}
	if (prompt)
		getSessionManager(ctx)
			.send({ sessionId, prompt, delivery: "steer" })
			.catch(() => {});
	return { sessionId, promptsInQueue: session.promptsInQueue };
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

const ACTION_HANDLERS: Record<
	string,
	(ctx: SidecarContext, req: ChatSessionCommandRequest) => Promise<unknown>
> = {
	start: handleStart,
	attach: handleAttach,
	send: handleSend,
	stop: handleStop,
	abort: handleAbort,
	reset: handleReset,
	restore_checkpoint: handleRestoreCheckpoint,
	pending_prompts: handlePendingPrompts,
	steer_prompt: handleSteerPrompt,
};

export async function handleChatSessionCommand(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const handler = ACTION_HANDLERS[request.action];
	if (!handler) throw new Error("unsupported action");
	return handler(ctx, request);
}
