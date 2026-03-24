import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	watch,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setHomeDir, setHomeDirIfUnset } from "@clinebot/core";
import {
	toolApprovalDecisionPath,
	toolApprovalDir,
	toolApprovalRequestPrefix,
} from "./paths";
import {
	derivePromptFromMessages,
	emitChunk,
	normalizeChatFinishStatus,
	persistSessionMessages,
	persistUsageInMessages,
	readPersistedChatMessages,
	readSessionMetadataTitle,
} from "./session-data";
import { nowMs, sendEvent } from "./state";
import {
	type ChatSessionCommandRequest,
	type ChatTurnResult,
	DEFAULT_RPC_CLIENT_ID,
	DEFAULT_RPC_CLIENT_TYPE,
	type HostContext,
	type JsonRecord,
	type LiveSession,
	type PromptInQueue,
	type ToolApprovalRequestItem,
} from "./types";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getNestedString(obj: unknown, ...keys: string[]): string | undefined {
	let current: unknown = obj;
	for (const key of keys) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as JsonRecord)[key];
	}
	return typeof current === "string" ? current : undefined;
}

function setRuntimeHomeDir(config: unknown) {
	const homeDir = getNestedString(config, "sessions", "homeDir")?.trim();
	if (homeDir) {
		setHomeDir(homeDir);
	} else {
		setHomeDirIfUnset(homedir());
	}
}

function addRuntimeLoggerContext(config: unknown) {
	if (!config || typeof config !== "object") return;

	const record = config as JsonRecord;
	const existing =
		record.logger && typeof record.logger === "object"
			? { ...(record.logger as JsonRecord) }
			: {};
	const bindings =
		existing.bindings && typeof existing.bindings === "object"
			? { ...(existing.bindings as JsonRecord) }
			: {};

	record.logger = {
		...existing,
		name:
			(typeof existing.name === "string" && existing.name.trim()) ||
			"clite.code",
		bindings: {
			...bindings,
			clientId: DEFAULT_RPC_CLIENT_ID,
			clientType: DEFAULT_RPC_CLIENT_TYPE,
			clientApp: "code",
		},
	};
}

// ---------------------------------------------------------------------------
// Bridge script resolution
// ---------------------------------------------------------------------------

const BRIDGE_SCRIPT = "chat-runtime-bridge.ts";
const BRIDGE_SEARCH_DIRS = [
	["apps", "code", "scripts"],
	["packages", "app", "scripts"],
	["app", "scripts"],
];

function resolveChatRuntimeBridgeScriptPath(ctx: HostContext): string | null {
	for (const segments of BRIDGE_SEARCH_DIRS) {
		const candidate = join(ctx.workspaceRoot, ...segments, BRIDGE_SCRIPT);
		if (existsSync(candidate)) return candidate;
	}
	for (const base of [process.cwd()]) {
		for (const rel of [["app", "scripts"], ["..", "scripts"], ["scripts"]]) {
			const candidate = join(base, ...rel, BRIDGE_SCRIPT);
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Child process line reader
// ---------------------------------------------------------------------------

function readChildLines(
	stream: NodeJS.ReadableStream,
	onLine: (line: string) => void,
) {
	let buffer = "";
	stream.on("data", (chunk) => {
		buffer += String(chunk);
		let idx = buffer.indexOf("\n");
		while (idx >= 0) {
			const line = buffer.slice(0, idx).trim();
			buffer = buffer.slice(idx + 1);
			if (line) onLine(line);
			idx = buffer.indexOf("\n");
		}
	});
}

// ---------------------------------------------------------------------------
// Bridge lifecycle
// ---------------------------------------------------------------------------

function handleBridgeStdoutLine(ctx: HostContext, parsed: JsonRecord) {
	const type = String(parsed.type ?? "");
	const sessionId =
		typeof parsed.sessionId === "string" ? parsed.sessionId : "";

	switch (type) {
		case "ready":
			ctx.bridgeReady = true;
			return;

		case "response": {
			const requestId = String(parsed.requestId ?? "");
			const pending = ctx.pendingBridge.get(requestId);
			if (!pending) return;
			ctx.pendingBridge.delete(requestId);
			if (typeof parsed.error === "string" && parsed.error.trim()) {
				pending.reject(new Error(parsed.error));
			} else {
				pending.resolve(parsed.response ?? null);
			}
			return;
		}

		case "chat_text":
			emitChunk(ctx, sessionId, "chat_text", String(parsed.chunk ?? ""));
			return;

		case "tool_call_start":
			emitChunk(
				ctx,
				sessionId,
				"chat_tool_call_start",
				JSON.stringify({
					toolCallId: parsed.toolCallId,
					toolName: parsed.toolName,
					input: parsed.input,
				}),
			);
			return;

		case "tool_call_end":
			emitChunk(
				ctx,
				sessionId,
				"chat_tool_call_end",
				JSON.stringify({
					toolCallId: parsed.toolCallId,
					toolName: parsed.toolName,
					output: parsed.output,
					error: parsed.error,
					durationMs: parsed.durationMs,
				}),
			);
			return;

		case "pending_prompts": {
			const prompts = Array.isArray(parsed.prompts)
				? (
						parsed.prompts as Array<{
							id?: unknown;
							prompt?: unknown;
							delivery?: unknown;
							attachmentCount?: unknown;
						}>
					)
						.map((item) => ({
							id: typeof item.id === "string" ? item.id : "",
							prompt: typeof item.prompt === "string" ? item.prompt : "",
							steer: item.delivery === "steer",
							attachmentCount:
								typeof item.attachmentCount === "number"
									? item.attachmentCount
									: 0,
						}))
						.filter((item) => item.id && item.prompt)
				: [];
			if (sessionId) {
				const session = ctx.liveSessions.get(sessionId);
				const previous = session?.promptsInQueue ?? [];
				if (session) {
					session.promptsInQueue = prompts;
				}
				if (
					previous.length > prompts.length &&
					previous[0] &&
					previous[0].id !== prompts[0]?.id
				) {
					emitChunk(
						ctx,
						sessionId,
						"chat_queued_prompt_start",
						JSON.stringify({
							prompt: previous[0].prompt,
							attachmentCount: previous[0].attachmentCount ?? 0,
						}),
					);
				}
				sendPromptsInQueueSnapshot(ctx, sessionId);
			}
			return;
		}

		case "error": {
			const message =
				typeof parsed.message === "string"
					? parsed.message
					: "chat runtime bridge error";
			if (sessionId) {
				emitChunk(
					ctx,
					sessionId,
					"chat_core_log",
					JSON.stringify({ level: "error", message }),
				);
			} else {
				console.error("[chat-runtime-bridge]", message);
			}
			return;
		}
	}
}

export function ensureBridgeStarted(ctx: HostContext) {
	if (ctx.bridgeChild?.exitCode === null && ctx.bridgeReady) return;

	const scriptPath = resolveChatRuntimeBridgeScriptPath(ctx);
	if (!scriptPath) throw new Error("chat runtime bridge script not found");

	ctx.bridgeReady = false;
	mkdirSync(toolApprovalDir(), { recursive: true });

	ctx.bridgeChild = spawn("bun", [scriptPath], {
		cwd: ctx.workspaceRoot,
		env: {
			...process.env,
			CLINE_TOOL_APPROVAL_MODE: "desktop",
			CLINE_TOOL_APPROVAL_DIR: toolApprovalDir(),
			CLINE_RPC_CLIENT_ID: DEFAULT_RPC_CLIENT_ID,
			CLINE_RPC_CLIENT_TYPE: DEFAULT_RPC_CLIENT_TYPE,
			CLINE_RPC_CLIENT_APP: "code",
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	readChildLines(ctx.bridgeChild.stdout, (line) => {
		handleBridgeStdoutLine(ctx, JSON.parse(line) as JsonRecord);
	});

	readChildLines(ctx.bridgeChild.stderr, (line) => {
		console.error("[chat-runtime-bridge]", line);
	});

	ctx.bridgeChild.on("exit", () => {
		ctx.bridgeReady = false;
		ctx.bridgeChild = null;
		for (const [, pending] of ctx.pendingBridge) {
			pending.reject(new Error("chat runtime bridge exited"));
		}
		ctx.pendingBridge.clear();
	});
}

// ---------------------------------------------------------------------------
// Bridge RPC
// ---------------------------------------------------------------------------

export async function runBridgeCommand(
	ctx: HostContext,
	command: Record<string, unknown>,
): Promise<unknown> {
	ensureBridgeStarted(ctx);
	const child = ctx.bridgeChild;
	if (!child?.stdin) throw new Error("chat runtime bridge unavailable");

	const requestId = `bridge_${ctx.bridgeRequestId++}`;
	const envelope = JSON.stringify({ type: "request", requestId, command });

	return new Promise((resolve, reject) => {
		ctx.pendingBridge.set(requestId, { resolve, reject });
		child.stdin.write(`${envelope}\n`, (error) => {
			if (error) {
				ctx.pendingBridge.delete(requestId);
				reject(error);
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Tool approval helpers
// ---------------------------------------------------------------------------

function sendApprovalSnapshot(ctx: HostContext, sessionId: string) {
	sendEvent(ctx, "tool_approval_state", {
		sessionId,
		items: listPendingToolApprovalsForSession(sessionId, 50),
	});
}

export function listPendingToolApprovalsForSession(
	sessionId: string,
	limit = 20,
): ToolApprovalRequestItem[] {
	const dir = toolApprovalDir();
	if (!existsSync(dir)) return [];

	const prefix = toolApprovalRequestPrefix(sessionId);
	const items: ToolApprovalRequestItem[] = [];

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (
			!entry.isFile() ||
			!entry.name.startsWith(prefix) ||
			!entry.name.endsWith(".json")
		)
			continue;
		try {
			items.push(
				JSON.parse(
					readFileSync(join(dir, entry.name), "utf8"),
				) as ToolApprovalRequestItem,
			);
		} catch {
			// Ignore malformed approval files.
		}
	}

	items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return items.slice(0, Math.max(1, limit));
}

export function broadcastApprovalSnapshots(ctx: HostContext) {
	const dir = toolApprovalDir();
	if (!existsSync(dir)) return;

	const sessionIds = new Set<string>();
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.includes(".request.")) continue;
		const id = entry.name.split(".request.")[0]?.trim();
		if (id) sessionIds.add(id);
	}

	for (const sessionId of sessionIds) {
		sendApprovalSnapshot(ctx, sessionId);
	}
}

function getPromptsInQueue(session: LiveSession): PromptInQueue[] {
	return session.promptsInQueue;
}

function sendPromptsInQueueSnapshot(ctx: HostContext, sessionId: string) {
	const session = ctx.liveSessions.get(sessionId);
	sendEvent(ctx, "prompts_in_queue_state", {
		sessionId,
		items: session ? getPromptsInQueue(session) : [],
	});
}

export function ensureApprovalWatcher(ctx: HostContext) {
	if (ctx.approvalWatcher) return;
	mkdirSync(toolApprovalDir(), { recursive: true });
	ctx.approvalWatcher = watch(toolApprovalDir(), () => {
		if (ctx.approvalBroadcastTimer) clearTimeout(ctx.approvalBroadcastTimer);
		ctx.approvalBroadcastTimer = setTimeout(
			() => broadcastApprovalSnapshots(ctx),
			50,
		);
	});
}

export async function respondToolApproval(
	ctx: HostContext,
	args?: Record<string, unknown>,
) {
	const sessionId = String(args?.sessionId ?? "").trim();
	const requestId = String(args?.requestId ?? "").trim();
	if (!sessionId || !requestId)
		throw new Error("sessionId and requestId are required");

	const path = toolApprovalDecisionPath(sessionId, requestId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		JSON.stringify({
			approved: Boolean(args?.approved),
			reason: typeof args?.reason === "string" ? args.reason : undefined,
			ts: nowMs(),
		}),
	);

	const requestPath = join(
		toolApprovalDir(),
		`${sessionId}.request.${requestId}.json`,
	);
	if (existsSync(requestPath)) unlinkSync(requestPath);

	sendApprovalSnapshot(ctx, sessionId);
	return true;
}

// ---------------------------------------------------------------------------
// Chat turn execution
// ---------------------------------------------------------------------------

async function executeChatTurn(
	ctx: HostContext,
	sessionId: string,
	session: LiveSession,
	input: {
		prompt: string;
		config?: JsonRecord;
		attachments?: {
			userImages?: string[];
			userFiles?: Array<{ name: string; content: string }>;
		};
		delivery?: "queue" | "steer";
	},
): Promise<{ result?: ChatTurnResult; queued?: boolean }> {
	if (input.config) session.config = input.config;
	if (input.prompt) session.prompt = input.prompt;

	session.busy = true;
	session.status = "running";
	session.endedAt = undefined;

	setRuntimeHomeDir(session.config);
	addRuntimeLoggerContext(session.config);

	await runBridgeCommand(ctx, {
		action: "set_sessions",
		sessionIds: [sessionId],
	});

	try {
		const resultEnvelope = (await runBridgeCommand(ctx, {
			action: "send",
			sessionId,
			request: {
				config: session.config,
				messages: session.messages,
				prompt: input.prompt,
				attachments: input.attachments,
				delivery: input.delivery,
			},
		})) as { result?: ChatTurnResult; queued?: boolean };

		if (resultEnvelope.queued) {
			return { queued: true };
		}
		const result = resultEnvelope.result;
		if (!result) {
			throw new Error("chat runtime bridge send response missing result");
		}

		session.messages = persistUsageInMessages(
			(Array.isArray(result.messages) ? result.messages : []) as unknown[],
			session.config,
			result,
		);
		session.status = normalizeChatFinishStatus(result.finishReason);
		session.endedAt = nowMs();

		persistSessionMessages(sessionId, session.messages);
		sendApprovalSnapshot(ctx, sessionId);

		return { result, queued: false };
	} finally {
		session.busy = false;
	}
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

function createLiveSession(
	config: JsonRecord,
	extra?: Partial<LiveSession>,
): LiveSession {
	return {
		config,
		messages: [],
		promptsInQueue: [],
		busy: false,
		startedAt: nowMs(),
		status: "idle",
		...extra,
	};
}

async function handleStart(
	ctx: HostContext,
	request: ChatSessionCommandRequest,
) {
	if (!request.config) throw new Error("missing config for start action");

	setRuntimeHomeDir(request.config);
	addRuntimeLoggerContext(request.config);

	const response = (await runBridgeCommand(ctx, {
		action: "start",
		config: request.config,
	})) as { sessionId?: string };

	const sessionId = response.sessionId?.trim();
	if (!sessionId)
		throw new Error("chat runtime bridge start response missing session id");

	await runBridgeCommand(ctx, {
		action: "set_sessions",
		sessionIds: [sessionId],
	});
	ctx.liveSessions.set(sessionId, createLiveSession(request.config));

	return { sessionId };
}

async function handleSend(
	ctx: HostContext,
	request: ChatSessionCommandRequest,
) {
	const prompt = request.prompt?.trim() || "";
	const hasAttachments =
		(request.attachments?.userImages?.length ?? 0) > 0 ||
		(request.attachments?.userFiles?.length ?? 0) > 0;
	if (!prompt && !hasAttachments)
		throw new Error("prompt is required for send action");

	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required for send action");

	let session = ctx.liveSessions.get(sessionId);
	if (!session) {
		if (!request.config)
			throw new Error("session not found. start a new session.");
		const messages = readPersistedChatMessages(sessionId);
		if (!messages) throw new Error("session not found. start a new session.");

		session = createLiveSession(request.config, {
			messages,
			prompt: derivePromptFromMessages(messages),
			title: readSessionMetadataTitle(sessionId),
		});
		ctx.liveSessions.set(sessionId, session);
	}

	if (request.config) session.config = request.config;
	const delivery =
		request.delivery === "queue" || request.delivery === "steer"
			? request.delivery
			: session.busy
				? "queue"
				: undefined;
	const { result, queued } = await executeChatTurn(ctx, sessionId, session, {
		prompt,
		config: request.config,
		attachments: request.attachments,
		delivery,
	});

	return {
		sessionId,
		result,
		queued: queued === true,
		promptsInQueue: getPromptsInQueue(session),
	};
}

async function handleAbort(
	ctx: HostContext,
	request: ChatSessionCommandRequest,
) {
	const sessionId = request.sessionId?.trim();
	if (sessionId) {
		await runBridgeCommand(ctx, { action: "abort", sessionId });
		const session = ctx.liveSessions.get(sessionId);
		if (session) {
			session.busy = false;
			session.promptsInQueue = [];
			session.status = "cancelled";
			session.endedAt = nowMs();
		}
		sendPromptsInQueueSnapshot(ctx, sessionId);
	}
	return { sessionId: request.sessionId, ok: true };
}

async function handleReset(
	ctx: HostContext,
	request: ChatSessionCommandRequest,
) {
	const sessionId = request.sessionId?.trim();
	if (sessionId) {
		ctx.liveSessions.delete(sessionId);
		await runBridgeCommand(ctx, { action: "reset", sessionId });
		sendPromptsInQueueSnapshot(ctx, sessionId);
	}
	return { sessionId: request.sessionId, ok: true };
}

async function handlePendingPrompts(
	ctx: HostContext,
	request: ChatSessionCommandRequest,
) {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	const session = ctx.liveSessions.get(sessionId);
	return {
		sessionId,
		promptsInQueue: session ? getPromptsInQueue(session) : [],
	};
}

async function handleSteerPrompt(
	ctx: HostContext,
	request: ChatSessionCommandRequest,
) {
	const sessionId = request.sessionId?.trim();
	const promptId = request.promptId?.trim();
	if (!sessionId || !promptId) {
		throw new Error("sessionId and promptId are required");
	}
	const session = ctx.liveSessions.get(sessionId);
	if (!session) {
		return { sessionId, promptsInQueue: [] };
	}
	const prompt = session.promptsInQueue.find(
		(turn) => turn.id === promptId,
	)?.prompt;
	if (prompt) {
		await executeChatTurn(ctx, sessionId, session, {
			prompt,
			config: session.config,
			delivery: "steer",
		});
	}
	return {
		sessionId,
		promptsInQueue: getPromptsInQueue(session),
	};
}

const ACTION_HANDLERS: Record<
	string,
	(ctx: HostContext, req: ChatSessionCommandRequest) => Promise<unknown>
> = {
	start: handleStart,
	send: handleSend,
	abort: handleAbort,
	reset: handleReset,
	pending_prompts: handlePendingPrompts,
	steer_prompt: handleSteerPrompt,
};

export async function handleChatSessionCommand(
	ctx: HostContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const handler = ACTION_HANDLERS[request.action];
	if (!handler) throw new Error("unsupported action");
	return handler(ctx, request);
}
