import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentTool,
	type ClineCore,
	type ClineCoreStartConfig,
	createTool,
	ProviderSettingsManager,
	SessionSource,
	splitCoreSessionConfig,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/llms";
import { buildClineSystemPrompt } from "@cline/shared";
import { emitChunk, sendEvent } from "./context";
import { sharedSessionDataDir } from "./paths";
import type { JsonRecord, SidecarContext } from "./types";

// ---------------------------------------------------------------------------
// Bot registry
//
// A bot is a persistent agent identity: a name, a visual (shape + color), a
// memory markdown file it curates itself, and one long-lived chat session.
// Everything lives under ~/.cline/data/bots/<botId>/:
//   bot.json    — identity + session binding
//   memory.md   — the bot's persistent memory (model-curated)
//   workspace/  — the bot's private working directory
// ---------------------------------------------------------------------------

export const BOT_SHAPES = [
	"circle",
	"square",
	"triangle",
	"diamond",
	"hexagon",
	"star",
] as const;

export type BotShape = (typeof BOT_SHAPES)[number];

export type BotRecord = {
	id: string;
	name: string;
	shape: BotShape;
	color: string;
	provider?: string;
	model?: string;
	sessionId?: string;
	createdAt: string;
	updatedAt: string;
};

export type BotSummary = BotRecord & {
	memoryPreview: string;
	hasMemory: boolean;
};

const MAX_BOT_NAME_LENGTH = 40;
const MAX_MEMORY_LENGTH = 48_000;
const MEMORY_PREVIEW_LENGTH = 160;
const DEFAULT_BOT_CHAT_MESSAGE_LIMIT = 30;
const MAX_BOT_CHAT_MESSAGE_LIMIT = 200;
const BOT_CHAT_MESSAGE_TEXT_LIMIT = 4_000;

export function botsDataDir(): string {
	return (
		process.env.CLINE_BOTS_DATA_DIR?.trim() ||
		join(homedir(), ".cline", "data", "bots")
	);
}

function botDir(botId: string): string {
	return join(botsDataDir(), botId);
}

function botConfigPath(botId: string): string {
	return join(botDir(botId), "bot.json");
}

export function botMemoryPath(botId: string): string {
	return join(botDir(botId), "memory.md");
}

export function botWorkspaceDir(botId: string): string {
	return join(botDir(botId), "workspace");
}

function isBotShape(value: unknown): value is BotShape {
	return (
		typeof value === "string" &&
		(BOT_SHAPES as readonly string[]).includes(value)
	);
}

function sanitizeColor(value: unknown): string {
	const color = String(value ?? "").trim();
	return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "#8b5cf6";
}

function sanitizeName(value: unknown): string {
	const name = String(value ?? "")
		.trim()
		.slice(0, MAX_BOT_NAME_LENGTH);
	if (!name) {
		throw new Error("Bot name is required");
	}
	return name;
}

function parseBotRecord(botId: string, raw: string): BotRecord | null {
	try {
		const parsed = JSON.parse(raw) as JsonRecord;
		const name = String(parsed.name ?? "").trim();
		if (!name) {
			return null;
		}
		return {
			id: botId,
			name,
			shape: isBotShape(parsed.shape) ? parsed.shape : "circle",
			color: sanitizeColor(parsed.color),
			provider:
				typeof parsed.provider === "string" && parsed.provider.trim()
					? parsed.provider.trim()
					: undefined,
			model:
				typeof parsed.model === "string" && parsed.model.trim()
					? parsed.model.trim()
					: undefined,
			sessionId:
				typeof parsed.sessionId === "string" && parsed.sessionId.trim()
					? parsed.sessionId.trim()
					: undefined,
			createdAt: String(parsed.createdAt ?? new Date().toISOString()),
			updatedAt: String(parsed.updatedAt ?? new Date().toISOString()),
		};
	} catch {
		return null;
	}
}

function writeBotRecord(bot: BotRecord): void {
	mkdirSync(botDir(bot.id), { recursive: true });
	const { id: _id, ...persisted } = bot;
	writeFileSync(
		botConfigPath(bot.id),
		`${JSON.stringify(persisted, null, 2)}\n`,
	);
}

export function getBot(botId: string): BotRecord | null {
	const path = botConfigPath(botId);
	if (!existsSync(path)) {
		return null;
	}
	return parseBotRecord(botId, readFileSync(path, "utf8"));
}

function requireBot(botId: string): BotRecord {
	const bot = getBot(botId);
	if (!bot) {
		throw new Error(`Bot ${botId} not found`);
	}
	return bot;
}

export function readBotMemory(botId: string): string {
	const path = botMemoryPath(botId);
	if (!existsSync(path)) {
		return "";
	}
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

export function writeBotMemory(botId: string, content: string): void {
	requireBot(botId);
	mkdirSync(botDir(botId), { recursive: true });
	writeFileSync(botMemoryPath(botId), content.slice(0, MAX_MEMORY_LENGTH));
}

function toBotSummary(bot: BotRecord): BotSummary {
	const memory = readBotMemory(bot.id).trim();
	const previewLine =
		memory
			.split("\n")
			.map((line) => line.replace(/^#+\s*/, "").trim())
			.find((line) => line.length > 0) ?? "";
	return {
		...bot,
		hasMemory: memory.length > 0,
		memoryPreview: previewLine.slice(0, MEMORY_PREVIEW_LENGTH),
	};
}

export function listBots(): BotSummary[] {
	const dir = botsDataDir();
	if (!existsSync(dir)) {
		return [];
	}
	const bots: BotSummary[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const bot = getBot(entry.name);
		if (bot) {
			bots.push(toBotSummary(bot));
		}
	}
	return bots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createBot(input: {
	name: string;
	shape?: unknown;
	color?: unknown;
	provider?: string;
	model?: string;
}): BotSummary {
	const now = new Date().toISOString();
	const bot: BotRecord = {
		id: `bot_${randomUUID().slice(0, 12)}`,
		name: sanitizeName(input.name),
		shape: isBotShape(input.shape) ? input.shape : "circle",
		color: sanitizeColor(input.color),
		provider: input.provider?.trim() || undefined,
		model: input.model?.trim() || undefined,
		createdAt: now,
		updatedAt: now,
	};
	writeBotRecord(bot);
	mkdirSync(botWorkspaceDir(bot.id), { recursive: true });
	return toBotSummary(bot);
}

export function updateBot(
	botId: string,
	patch: {
		name?: unknown;
		shape?: unknown;
		color?: unknown;
	},
): BotSummary {
	const bot = requireBot(botId);
	const next: BotRecord = {
		...bot,
		name: patch.name !== undefined ? sanitizeName(patch.name) : bot.name,
		shape: isBotShape(patch.shape) ? patch.shape : bot.shape,
		color: patch.color !== undefined ? sanitizeColor(patch.color) : bot.color,
		updatedAt: new Date().toISOString(),
	};
	writeBotRecord(next);
	return toBotSummary(next);
}

export function deleteBot(ctx: SidecarContext, botId: string): boolean {
	const dir = botDir(botId);
	if (!existsSync(dir)) {
		return false;
	}
	rmSync(dir, { recursive: true, force: true });
	ctx.liveBotSessions.delete(botId);
	return true;
}

export function bindBotSession(
	ctx: SidecarContext,
	botId: string,
	binding: { sessionId: string; provider?: string; model?: string },
): void {
	const bot = requireBot(botId);
	writeBotRecord({
		...bot,
		sessionId: binding.sessionId,
		provider: binding.provider?.trim() || bot.provider,
		model: binding.model?.trim() || bot.model,
		updatedAt: new Date().toISOString(),
	});
	ctx.liveBotSessions.set(botId, binding.sessionId);
}

export function broadcastBotsChanged(ctx: SidecarContext): void {
	sendEvent(ctx, "bots_changed", { bots: listBots() });
}

// ---------------------------------------------------------------------------
// Bot persona rules (injected into the standard Cline system prompt)
// ---------------------------------------------------------------------------

export function buildBotRules(bot: BotRecord): string {
	const memory = readBotMemory(bot.id).trim();
	const roster = listBots().filter((other) => other.id !== bot.id);
	const rosterLines =
		roster.length > 0
			? roster
					.map((other) => `- ${other.name} (bot_id: ${other.id})`)
					.join("\n")
			: "- (no other bots yet)";
	return [
		"# Bot Mode",
		"",
		`You are "${bot.name}" (bot_id: ${bot.id}), a persistent bot in the user's bot roster. Unlike a one-off coding session, you are a continuous persona: your memory file below carries your role, knowledge, and ongoing work across every conversation.`,
		"",
		"## Memory",
		"Your memory is a markdown file that is loaded into this prompt at the start of every session. Curate it with the `update_memory` tool whenever you learn something worth keeping: your role and responsibilities, user preferences, ongoing work and its status, and notable facts about other bots. Keep it concise and well organized — it is your entire long-term memory, so anything not written there is forgotten between sessions.",
		"",
		"## Working with other bots",
		"You can collaborate with the other bots in the roster:",
		"- `send_bot_message` sends a message to another bot. It is delivered asynchronously into their chat and they will act on it; you will not receive a synchronous reply. If you need their answer, ask them to message you back, and finish your current turn — their reply arrives as a new message.",
		"- `read_bot_chat` reads another bot's recent conversation.",
		"- `read_bot_memory` reads another bot's memory file.",
		"- `list_bots` lists the current roster.",
		"",
		"Current roster:",
		rosterLines,
		"",
		"When you receive a message prefixed with `[Bot message from ...]`, it came from another bot rather than the user. Reply to that bot with `send_bot_message` when a response is expected.",
		"",
		"## Your memory file",
		memory.length > 0
			? memory
			: "(empty — you have not written any memory yet)",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Persisted chat helpers
// ---------------------------------------------------------------------------

function readPersistedMessages(
	sessionId: string,
): MessageWithMetadata[] | null {
	const path = join(
		sharedSessionDataDir(),
		sessionId,
		`${sessionId}.messages.json`,
	);
	if (!existsSync(path)) {
		return null;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8").trim()) as
			| { messages?: MessageWithMetadata[] }
			| MessageWithMetadata[];
		if (Array.isArray(parsed)) {
			return parsed;
		}
		return Array.isArray(parsed.messages) ? parsed.messages : null;
	} catch {
		return null;
	}
}

function messageText(message: MessageWithMetadata): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (typeof block === "string") {
				parts.push(block);
				continue;
			}
			if (block && typeof block === "object") {
				const text = (block as { text?: unknown }).text;
				if (typeof text === "string" && text.trim()) {
					parts.push(text);
				}
			}
		}
		return parts.join("\n");
	}
	return "";
}

// ---------------------------------------------------------------------------
// Bot session lifecycle
// ---------------------------------------------------------------------------

function getSessionManager(ctx: SidecarContext): ClineCore {
	if (!ctx.sessionManager) {
		throw new Error("Session manager not initialized");
	}
	return ctx.sessionManager;
}

function resolveBotCredentials(
	bot: BotRecord,
	config: JsonRecord | undefined,
): { provider: string; model: string; apiKey: string; baseUrl?: string } {
	const provider = String(
		config?.provider ?? config?.providerId ?? bot.provider ?? "",
	).trim();
	const model = String(
		config?.model ?? config?.modelId ?? bot.model ?? "",
	).trim();
	if (!provider || !model) {
		throw new Error(
			`Bot "${bot.name}" has no model configured yet. Open its chat once to initialize it.`,
		);
	}
	const configApiKey = String(config?.apiKey ?? config?.api_key ?? "").trim();
	if (configApiKey) {
		const baseUrl =
			typeof config?.baseUrl === "string" && config.baseUrl.trim()
				? config.baseUrl.trim()
				: undefined;
		return { provider, model, apiKey: configApiKey, baseUrl };
	}
	const providerConfig = new ProviderSettingsManager().getProviderConfig(
		provider,
		{ includeKnownModels: false },
	);
	return {
		provider,
		model,
		apiKey: providerConfig?.apiKey?.trim() ?? "",
		baseUrl: providerConfig?.baseUrl?.trim() || undefined,
	};
}

export type BotSessionStartResult = {
	sessionId: string;
	cwd: string;
	workspaceRoot: string;
	initialMessages?: MessageWithMetadata[];
};

/**
 * Start (or resume) a bot's persistent chat session with its persona rules and
 * bot tools registered. Used both by the webview chat flow (which passes the
 * composer config) and by bot-to-bot message delivery (which resolves
 * credentials from the bot record + saved provider settings).
 */
export async function startBotChatSession(
	ctx: SidecarContext,
	botId: string,
	options: { config?: JsonRecord } = {},
): Promise<BotSessionStartResult> {
	const bot = requireBot(botId);
	const manager = getSessionManager(ctx);
	const credentials = resolveBotCredentials(bot, options.config);
	const workspace = botWorkspaceDir(bot.id);
	mkdirSync(workspace, { recursive: true });

	const sessionId = bot.sessionId;
	const initialMessages = sessionId
		? (readPersistedMessages(sessionId) ?? undefined)
		: undefined;

	const systemPrompt = buildClineSystemPrompt({
		ide: "Terminal Shell",
		workspaceRoot: workspace,
		workspaceName: `${bot.name} (bot)`,
		rules: buildBotRules(bot),
		mode: "act",
		providerId: credentials.provider,
		platform: process.platform || "unknown",
	});

	const coreConfig: JsonRecord = {
		...(sessionId ? { sessionId } : {}),
		providerId: credentials.provider,
		modelId: credentials.model,
		apiKey: credentials.apiKey,
		...(credentials.baseUrl ? { baseUrl: credentials.baseUrl } : {}),
		mode: "act",
		cwd: workspace,
		workspaceRoot: workspace,
		systemPrompt,
		enableTools: true,
		extraTools: createBotTools(ctx, bot.id),
		checkpoint: { enabled: true },
		...(options.config?.thinking !== undefined
			? { thinking: options.config.thinking }
			: {}),
		...(typeof options.config?.reasoningEffort === "string"
			? { reasoningEffort: options.config.reasoningEffort }
			: {}),
	};

	const startResult = await manager.start({
		...splitCoreSessionConfig(coreConfig as unknown as ClineCoreStartConfig),
		source: SessionSource.DESKTOP,
		interactive: true,
		...(initialMessages ? { initialMessages } : {}),
		sessionMetadata: { botId: bot.id, botName: bot.name, title: bot.name },
		// Bots run autonomously (they may act while their chat is closed), so
		// tool calls are auto-approved like the desktop default.
		toolPolicies: { "*": { autoApprove: true } },
	});

	bindBotSession(ctx, bot.id, {
		sessionId: startResult.sessionId,
		provider: credentials.provider,
		model: credentials.model,
	});
	broadcastBotsChanged(ctx);

	return {
		sessionId: startResult.sessionId,
		cwd: startResult.manifest.cwd,
		workspaceRoot: startResult.manifest.workspace_root,
		initialMessages,
	};
}

function isRunInProgressError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("session_run_in_progress") ||
		message.includes("run is in progress") ||
		message.includes("run already in progress")
	);
}

/**
 * Deliver a message from one bot into another bot's chat session. Delivery is
 * asynchronous: the target's agent turn runs in the background (queued if the
 * target is mid-turn), and the sender's tool call returns immediately.
 */
export async function deliverBotMessage(
	ctx: SidecarContext,
	fromBotId: string,
	toBotId: string,
	message: string,
): Promise<JsonRecord> {
	const fromBot = requireBot(fromBotId);
	const toBot = getBot(toBotId);
	if (!toBot) {
		return {
			error: `No bot with bot_id ${toBotId}. Use list_bots to see the roster.`,
		};
	}
	if (toBot.id === fromBot.id) {
		return { error: "You cannot send a bot message to yourself." };
	}
	const manager = getSessionManager(ctx);

	// Reuse the target's session when this sidecar already started it (bot
	// tools stay registered for the lifetime of a started session). Otherwise
	// resume/create it so tools and persona rules are wired up.
	let sessionId = ctx.liveBotSessions.get(toBot.id);
	if (!sessionId) {
		try {
			sessionId = (await startBotChatSession(ctx, toBot.id)).sessionId;
		} catch (error) {
			return {
				error: `Could not start a session for bot "${toBot.name}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}
	}

	const prompt = `[Bot message from "${fromBot.name}" (bot_id: ${fromBot.id})]\n\n${message}`;
	const targetSessionId = sessionId;
	// Fire-and-forget: the sender's turn must not block on the receiver's.
	void manager
		.send({ sessionId: targetSessionId, prompt })
		.catch(async (error) => {
			if (isRunInProgressError(error)) {
				await manager
					.send({ sessionId: targetSessionId, prompt, delivery: "queue" })
					.catch((queueError) => {
						ctx.logger?.error?.("Bot message queue delivery failed", {
							toBotId: toBot.id,
							error: queueError,
						});
					});
				return;
			}
			ctx.logger?.error?.("Bot message delivery failed", {
				toBotId: toBot.id,
				error,
			});
		});
	// Surface the incoming message in the receiver's chat if it is open.
	emitChunk(
		ctx,
		targetSessionId,
		"chat_queued_prompt_start",
		JSON.stringify({ prompt }),
	);
	return {
		delivered: true,
		to: { botId: toBot.id, name: toBot.name },
		note: "Delivered asynchronously. The bot will act on it and can message you back; you will not get a synchronous reply.",
	};
}

// ---------------------------------------------------------------------------
// Bot tools (registered as extraTools on every bot session)
// ---------------------------------------------------------------------------

export function createBotTools(
	ctx: SidecarContext,
	botId: string,
): AgentTool[] {
	const updateMemory = createTool({
		name: "update_memory",
		description:
			"Update your persistent memory markdown file. This file is your only long-term memory: it is loaded into your system prompt at the start of every session. Keep it concise and organized (role, preferences, ongoing work, key facts). Mode 'replace' rewrites the whole file; 'append' adds to the end.",
		inputSchema: {
			type: "object",
			properties: {
				content: {
					type: "string",
					description: "Markdown content to write.",
				},
				mode: {
					type: "string",
					enum: ["replace", "append"],
					description:
						"replace (default) rewrites the file; append adds to the end.",
				},
			},
			required: ["content"],
		},
		execute: async (input) => {
			const { content, mode } = input as { content?: unknown; mode?: unknown };
			const text = String(content ?? "");
			if (!text.trim()) {
				return { error: "content is required" };
			}
			const existing = readBotMemory(botId);
			const next =
				mode === "append" && existing.trim().length > 0
					? `${existing.replace(/\n+$/, "")}\n\n${text}`
					: text;
			if (next.length > MAX_MEMORY_LENGTH) {
				return {
					error: `Memory would exceed ${MAX_MEMORY_LENGTH} characters. Rewrite it more concisely with mode "replace".`,
				};
			}
			writeBotMemory(botId, next);
			broadcastBotsChanged(ctx);
			return { saved: true, length: next.length };
		},
	});

	const listBotsTool = createTool({
		name: "list_bots",
		description:
			"List every bot in the roster (including yourself) with their bot_id, name, and a preview of their memory. Use the bot_id with send_bot_message, read_bot_memory, and read_bot_chat.",
		inputSchema: { type: "object", properties: {} },
		execute: async () => ({
			bots: listBots().map((bot) => ({
				bot_id: bot.id,
				name: bot.name,
				is_you: bot.id === botId,
				memory_preview: bot.memoryPreview,
			})),
		}),
	});

	const readBotMemoryTool = createTool({
		name: "read_bot_memory",
		description:
			"Read another bot's full memory markdown file to understand its role and current state.",
		inputSchema: {
			type: "object",
			properties: {
				bot_id: { type: "string", description: "The target bot's bot_id." },
			},
			required: ["bot_id"],
		},
		execute: async (input) => {
			const targetId = String(
				(input as { bot_id?: unknown }).bot_id ?? "",
			).trim();
			const target = getBot(targetId);
			if (!target) {
				return {
					error: `No bot with bot_id ${targetId}. Use list_bots to see the roster.`,
				};
			}
			const memory = readBotMemory(targetId);
			return {
				bot_id: target.id,
				name: target.name,
				memory: memory || "(empty)",
			};
		},
	});

	const readBotChatTool = createTool({
		name: "read_bot_chat",
		description:
			"Read the most recent messages from another bot's chat to see what it has been working on and saying.",
		inputSchema: {
			type: "object",
			properties: {
				bot_id: { type: "string", description: "The target bot's bot_id." },
				max_messages: {
					type: "number",
					description: `How many recent messages to return (default ${DEFAULT_BOT_CHAT_MESSAGE_LIMIT}, max ${MAX_BOT_CHAT_MESSAGE_LIMIT}).`,
				},
			},
			required: ["bot_id"],
		},
		execute: async (input) => {
			const { bot_id, max_messages } = input as {
				bot_id?: unknown;
				max_messages?: unknown;
			};
			const targetId = String(bot_id ?? "").trim();
			const target = getBot(targetId);
			if (!target) {
				return {
					error: `No bot with bot_id ${targetId}. Use list_bots to see the roster.`,
				};
			}
			if (!target.sessionId) {
				return { bot_id: target.id, name: target.name, messages: [] };
			}
			const limit = Math.min(
				Math.max(1, Number(max_messages) || DEFAULT_BOT_CHAT_MESSAGE_LIMIT),
				MAX_BOT_CHAT_MESSAGE_LIMIT,
			);
			const persisted = readPersistedMessages(target.sessionId) ?? [];
			const messages = persisted
				.map((message) => ({
					role: String((message as { role?: unknown }).role ?? ""),
					text: messageText(message),
				}))
				.filter(
					(entry) =>
						(entry.role === "user" || entry.role === "assistant") &&
						entry.text.trim().length > 0,
				)
				.slice(-limit)
				.map((entry) => ({
					role: entry.role,
					text:
						entry.text.length > BOT_CHAT_MESSAGE_TEXT_LIMIT
							? `${entry.text.slice(0, BOT_CHAT_MESSAGE_TEXT_LIMIT)}… [truncated]`
							: entry.text,
				}));
			return { bot_id: target.id, name: target.name, messages };
		},
	});

	const sendBotMessageTool = createTool({
		name: "send_bot_message",
		description:
			"Send a message to another bot. It is delivered into that bot's chat and the bot acts on it in the background — you will NOT receive a synchronous reply. If you need an answer, ask the bot to message you back and end your turn; its reply will arrive as a new [Bot message ...] in your chat.",
		inputSchema: {
			type: "object",
			properties: {
				bot_id: { type: "string", description: "The target bot's bot_id." },
				message: { type: "string", description: "The message to send." },
			},
			required: ["bot_id", "message"],
		},
		execute: async (input) => {
			const { bot_id, message } = input as {
				bot_id?: unknown;
				message?: unknown;
			};
			const targetId = String(bot_id ?? "").trim();
			const body = String(message ?? "").trim();
			if (!body) {
				return { error: "message is required" };
			}
			return await deliverBotMessage(ctx, botId, targetId, body);
		},
	});

	return [
		updateMemory,
		listBotsTool,
		readBotMemoryTool,
		readBotChatTool,
		sendBotMessageTool,
	];
}

// ---------------------------------------------------------------------------
// Desktop command handlers
// ---------------------------------------------------------------------------

export function handleBotsCommand(
	ctx: SidecarContext,
	command: string,
	args?: Record<string, unknown>,
): unknown {
	switch (command) {
		case "list_bots":
			return listBots();
		case "create_bot": {
			const bot = createBot({
				name: String(args?.name ?? ""),
				shape: args?.shape,
				color: args?.color,
				provider:
					typeof args?.provider === "string" ? args.provider : undefined,
				model: typeof args?.model === "string" ? args.model : undefined,
			});
			broadcastBotsChanged(ctx);
			return bot;
		}
		case "update_bot": {
			const bot = updateBot(String(args?.botId ?? ""), {
				name: args?.name,
				shape: args?.shape,
				color: args?.color,
			});
			broadcastBotsChanged(ctx);
			return bot;
		}
		case "delete_bot": {
			const deleted = deleteBot(ctx, String(args?.botId ?? ""));
			broadcastBotsChanged(ctx);
			return deleted;
		}
		case "read_bot_memory":
			return {
				botId: String(args?.botId ?? ""),
				memory: readBotMemory(String(args?.botId ?? "")),
			};
		case "update_bot_memory": {
			writeBotMemory(String(args?.botId ?? ""), String(args?.memory ?? ""));
			broadcastBotsChanged(ctx);
			return true;
		}
		default:
			throw new Error(`unsupported bots command: ${command}`);
	}
}

export function isBotsCommand(command: string): boolean {
	return (
		command === "list_bots" ||
		command === "create_bot" ||
		command === "update_bot" ||
		command === "delete_bot" ||
		command === "read_bot_memory" ||
		command === "update_bot_memory"
	);
}
