import { homedir } from "node:os";
import { join } from "node:path";
import {
	type GatewayMcpServerInput,
	type MarketplacePrimitiveType,
	MCP_OAUTH_UNAVAILABLE_MESSAGE,
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
	type RunRecord,
	type ScheduleJobRecord,
	type ScheduleRecord,
} from "@cline/gateway/client";
import type { AgentMessage, AgentMessagePart } from "@cline/shared/agent";
import type {
	BotId,
	BotToolConfiguration,
	RunId,
	ScheduleId,
	SessionId,
} from "@cline/shared/gateway";
import { SERVER_REQUEST_METHODS } from "@cline/shared/gateway";
import {
	listQueuedPrompts,
	listSessionRuns,
	resolveInterruptibleRunId,
	resolveRunningRunId,
} from "./chat-runs";
import {
	connectorChannels,
	startConnectorChannel,
	stopConnectorChannel,
} from "./connectors";
import { handleHostCommand } from "./host-commands";
import { SIDECAR_VERSION, type SidecarContext } from "./types";

type RecordValue = Record<string, unknown>;

function recordValue(value: unknown): RecordValue | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as RecordValue)
		: undefined;
}

function trimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function optionalPositiveInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return undefined;
	}
	return value;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
	return values.length > 0 ? values : [];
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	const record = recordValue(value);
	if (!record) return undefined;
	const entries = Object.entries(record).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function marketplacePrimitiveType(value: unknown): MarketplacePrimitiveType {
	if (value === "mcp" || value === "skill" || value === "plugin") return value;
	throw new Error("marketplace entry type must be mcp, skill, or plugin");
}

function marketplaceReference(args: RecordValue): {
	type: MarketplacePrimitiveType;
	id: string;
} {
	const id = trimmedString(args.id);
	if (!id) throw new Error("marketplace entry id is required");
	return { id, type: marketplacePrimitiveType(args.type) };
}

function mcpServerInput(value: unknown): GatewayMcpServerInput {
	const input = recordValue(value);
	if (!input) throw new Error("input is required");
	const name = trimmedString(input.name);
	if (!name) throw new Error("MCP server name is required");
	const transportType = input.transportType;
	if (
		transportType !== "stdio" &&
		transportType !== "sse" &&
		transportType !== "streamableHttp"
	) {
		throw new Error("MCP transport type is invalid");
	}
	return {
		name,
		transportType,
		...(trimmedString(input.previousName)
			? { previousName: trimmedString(input.previousName) }
			: {}),
		...(typeof input.command === "string" ? { command: input.command } : {}),
		...(stringArray(input.args) ? { args: stringArray(input.args) } : {}),
		...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
		...(stringRecord(input.env) ? { env: stringRecord(input.env) } : {}),
		...(typeof input.url === "string" ? { url: input.url } : {}),
		...(stringRecord(input.headers)
			? { headers: stringRecord(input.headers) }
			: {}),
		...(typeof input.disabled === "boolean"
			? { disabled: input.disabled }
			: {}),
		...(Object.hasOwn(input, "metadata") ? { metadata: input.metadata } : {}),
	};
}

function providerSettingsPatch(args: RecordValue): RecordValue {
	const patch = { ...(recordValue(args.settings) ?? {}) };
	if (Object.hasOwn(args, "api_key") && typeof args.api_key === "string") {
		patch.apiKey = args.api_key;
	}
	if (Object.hasOwn(args, "base_url") && typeof args.base_url === "string") {
		patch.baseUrl = args.base_url;
	}
	if (Object.hasOwn(args, "model") && typeof args.model === "string") {
		patch.model = args.model;
	}
	return patch;
}

const HISTORICAL_TOOL_PAYLOAD_CHARS = 16 * 1024;

async function resolveBotId(
	ctx: SidecarContext,
	requestedBotId: string,
): Promise<BotId> {
	const { bots } = await ctx.client.listBots();
	const normalized = requestedBotId
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-");
	const botId =
		bots.find((bot) => bot.identity.botId === requestedBotId)?.identity.botId ??
		(normalized
			? bots.find(
					(bot) =>
						bot.identity.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-") ===
						normalized,
				)?.identity.botId
			: undefined) ??
		(bots.length === 1 ? bots[0]?.identity.botId : undefined);
	if (!botId) throw new Error(`Gateway bot not found: ${requestedBotId}`);
	return botId;
}

function chatConfig(request: RecordValue): RecordValue {
	return (request.config as RecordValue | undefined) ?? {};
}

type DesktopChatScope = {
	botId: string;
	workspaceRoot: string;
};

function desktopChatScope(request: RecordValue): DesktopChatScope | undefined {
	if (request.desktopScope === undefined) return undefined;
	if (!request.desktopScope || typeof request.desktopScope !== "object") {
		throw new Error("desktopScope must be an object");
	}
	const scope = request.desktopScope as RecordValue;
	const botId = typeof scope.botId === "string" ? scope.botId.trim() : "";
	const workspaceRoot =
		typeof scope.workspaceRoot === "string" ? scope.workspaceRoot.trim() : "";
	if (!botId || !workspaceRoot) {
		throw new Error("desktopScope requires a bot id and workspace root");
	}
	return { botId, workspaceRoot };
}

async function chatBotId(
	ctx: SidecarContext,
	config: RecordValue,
	desktopScope?: DesktopChatScope,
): Promise<BotId> {
	const configuredBotId =
		typeof config.botId === "string" ? config.botId.trim() : "";
	// A locked native sidecar is already scoped to one resolved bot. Browser
	// input cannot switch that process to another bot after it has spawned.
	const requestedBotId = ctx.workspaceRootLocked
		? (ctx.botId ?? "")
		: desktopScope?.botId || configuredBotId || ctx.botId || "";
	return resolveBotId(ctx, requestedBotId);
}

function chatWorkspaceRoot(
	ctx: SidecarContext,
	config: RecordValue,
	desktopScope?: DesktopChatScope,
): string {
	const configuredWorkspace =
		typeof config.workspaceRoot === "string" ? config.workspaceRoot.trim() : "";
	return ctx.workspaceRootLocked
		? ctx.workspaceRoot
		: desktopScope?.workspaceRoot || configuredWorkspace || ctx.workspaceRoot;
}

async function uploadChatAttachments(
	ctx: SidecarContext,
	sessionId: string,
	value: unknown,
): Promise<string[]> {
	const attachments = (value ?? {}) as {
		userImages?: unknown;
		userFiles?: unknown;
	};
	const uploads: string[] = [];
	for (const [index, image] of (Array.isArray(attachments.userImages)
		? attachments.userImages
		: []
	).entries()) {
		if (typeof image !== "string") continue;
		const match = image.match(/^data:([^;,]+);base64,(.+)$/s);
		if (!match) throw new Error("Image attachment is not a base64 data URL");
		const extension = match[1]?.split("/")[1]?.replace("jpeg", "jpg") || "png";
		const uploaded = (await ctx.client.mutate("workspace.file.upload", {
			sessionId,
			name: `image-${index + 1}.${extension}`,
			mediaType: match[1],
			base64: match[2],
		})) as { path: string };
		uploads.push(`[uploaded image: ${uploaded.path}]`);
	}
	for (const file of Array.isArray(attachments.userFiles)
		? attachments.userFiles
		: []) {
		if (!file || typeof file !== "object") continue;
		const record = file as { name?: unknown; content?: unknown };
		if (typeof record.name !== "string" || typeof record.content !== "string") {
			continue;
		}
		const uploaded = (await ctx.client.mutate("workspace.file.upload", {
			sessionId,
			name: record.name,
			mediaType: "text/plain",
			base64: Buffer.from(record.content).toString("base64"),
		})) as { path: string };
		uploads.push(`[uploaded file: ${uploaded.path}]`);
	}
	return uploads;
}

function truncateHistoricalToolPayload(
	value: unknown,
	maxChars: number,
): unknown {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) return value;
	if (serialized.length <= maxChars) return value;
	return `${serialized.slice(0, maxChars)}\n… [historical tool payload truncated; ${serialized.length - maxChars} characters omitted]`;
}

function messageText(parts: readonly AgentMessagePart[]): string {
	return parts
		.flatMap((part) =>
			part.type === "text" || part.type === "reasoning" ? [part.text] : [],
		)
		.join("\n");
}

type HistoricalChatMessage = {
	id: string;
	sessionId: string;
	role: AgentMessage["role"];
	content: string;
	reasoning?: string;
	createdAt: number;
	meta?: Record<string, unknown>;
};

type HistoricalStoredMessage = {
	message: AgentMessage;
	runId?: string;
};

function historicalToolPayload(
	toolName: string,
	input: unknown,
	result: unknown,
	isError: boolean,
): string {
	return JSON.stringify({ toolName, input, result, isError });
}

function toChatMessages(
	sessionId: string,
	messages: readonly HistoricalStoredMessage[],
	maxToolPayloadChars?: number,
	options: {
		activeRunIds?: ReadonlySet<string>;
		sessionActiveWithoutRunId?: boolean;
	} = {},
): HistoricalChatMessage[] {
	const projected: HistoricalChatMessage[] = [];
	const pendingTools = new Map<
		string,
		{ index: number; toolName: string; input: unknown; runId?: string }
	>();

	for (const { message, runId } of messages) {
		let textParts: string[] = [];
		let reasoningParts: string[] = [];
		let segment = 0;
		const baseMeta = {
			providerId: message.modelInfo?.provider,
			modelId: message.modelInfo?.id,
			inputTokens: message.metrics?.inputTokens,
			outputTokens: message.metrics?.outputTokens,
			totalCost: message.metrics?.cost,
		};
		const flushText = () => {
			const content = textParts.join("\n").trim();
			const reasoning = reasoningParts.join("\n").trim();
			textParts = [];
			reasoningParts = [];
			if (!content && !reasoning) return;
			projected.push({
				id: `${message.id}_text_${segment++}`,
				sessionId,
				role: message.role,
				content,
				...(reasoning ? { reasoning } : {}),
				createdAt: message.createdAt + segment,
				meta: baseMeta,
			});
		};

		for (const part of message.content as readonly AgentMessagePart[]) {
			if (part.type === "text") {
				textParts.push(part.text);
				continue;
			}
			if (part.type === "reasoning") {
				reasoningParts.push(part.text);
				continue;
			}
			if (part.type === "tool-call") {
				flushText();
				const input =
					maxToolPayloadChars === undefined
						? part.input
						: truncateHistoricalToolPayload(part.input, maxToolPayloadChars);
				const index = projected.length;
				projected.push({
					id: `${message.id}_tool_${part.toolCallId}`,
					sessionId,
					role: "tool",
					content: historicalToolPayload(part.toolName, input, null, false),
					createdAt: message.createdAt + ++segment,
					meta: {
						toolName: part.toolName,
						toolCallId: part.toolCallId,
						hookEventName: "history_tool_use",
					},
				});
				pendingTools.set(part.toolCallId, {
					index,
					toolName: part.toolName,
					input,
					runId,
				});
				continue;
			}
			if (part.type === "tool-result") {
				flushText();
				const result =
					maxToolPayloadChars === undefined
						? part.output
						: truncateHistoricalToolPayload(part.output, maxToolPayloadChars);
				const pending = pendingTools.get(part.toolCallId);
				if (pending) {
					const target = projected[pending.index];
					if (target) {
						target.content = historicalToolPayload(
							pending.toolName,
							pending.input,
							result,
							Boolean(part.isError),
						);
						target.meta = {
							...target.meta,
							hookEventName: "history_tool_result",
						};
					}
					pendingTools.delete(part.toolCallId);
				} else {
					projected.push({
						id: `${message.id}_tool_result_${part.toolCallId}`,
						sessionId,
						role: "tool",
						content: historicalToolPayload(
							part.toolName,
							null,
							result,
							Boolean(part.isError),
						),
						createdAt: message.createdAt + ++segment,
						meta: {
							toolName: part.toolName,
							toolCallId: part.toolCallId,
							hookEventName: "history_tool_result",
						},
					});
				}
			}
		}
		flushText();
	}

	for (const pending of pendingTools.values()) {
		const target = projected[pending.index];
		if (!target) continue;
		// A running Gateway session can legitimately end its current canonical
		// snapshot with a tool call: execution is paused while an operator answers
		// the approval request. Keep that call in progress. Only a terminal session
		// can prove that a missing tool result is actually orphaned.
		const runStillActive = pending.runId
			? options.activeRunIds?.has(pending.runId) === true
			: options.sessionActiveWithoutRunId === true;
		if (runStillActive) continue;
		target.content = historicalToolPayload(
			pending.toolName,
			pending.input,
			"Tool execution ended without a recorded result.",
			true,
		);
		target.meta = { ...target.meta, hookEventName: "history_tool_result" };
	}

	return projected;
}

const GLOBAL_TOOLS_SCOPE = { kind: "global" } as const;

async function gatewayCustomizationLists(ctx: SidecarContext) {
	const [catalog, configuration, extensions, mcp] = await Promise.all([
		ctx.client.listTools(),
		ctx.client.getToolConfiguration(GLOBAL_TOOLS_SCOPE),
		ctx.client.listManagedExtensions(),
		ctx.client.listMcpServers(),
	]);
	return {
		workspaceRoot: ctx.workspaceRoot,
		rules: [],
		workflows: [],
		skills: extensions.skills,
		agents: [],
		plugins: extensions.plugins,
		tools: catalog.entries.map(({ descriptor, available }) => {
			const configured = configuration?.config.tools?.[descriptor.id];
			const name = descriptor.id.slice(descriptor.id.indexOf(":") + 1);
			return {
				id: descriptor.id,
				name,
				description: descriptor.description,
				enabled: available && configured?.enabled !== false,
				source: descriptor.source,
				...(descriptor.source === "plugin" &&
				typeof descriptor.metadata?.pluginName === "string"
					? { pluginName: descriptor.metadata.pluginName }
					: {}),
				headlessToolNames: [name],
			};
		}),
		hooks: [],
		mcp,
		warnings: [],
	};
}

async function setGatewayToolsDisabled(
	ctx: SidecarContext,
	names: string[],
	disabled: boolean,
) {
	const [catalog, current] = await Promise.all([
		ctx.client.listTools(),
		ctx.client.getToolConfiguration(GLOBAL_TOOLS_SCOPE),
	]);
	const requested = new Set(names);
	const ids = catalog.entries
		.map(({ descriptor }) => descriptor.id)
		.filter(
			(id) => requested.has(id) || requested.has(id.slice(id.indexOf(":") + 1)),
		);
	if (ids.length === 0)
		throw new Error(`Unknown Gateway tool: ${names.join(", ")}`);
	const tools: NonNullable<BotToolConfiguration["tools"]> = {
		...(current?.config.tools ?? {}),
	};
	for (const id of ids) {
		tools[id] = { ...tools[id], enabled: !disabled };
	}
	await ctx.client.putToolConfiguration({
		scope: GLOBAL_TOOLS_SCOPE,
		config: { ...(current?.config ?? {}), tools },
		...(current ? { expectedRevision: current.revision } : {}),
	});
	return gatewayCustomizationLists(ctx);
}

async function sessionMessages(
	ctx: SidecarContext,
	sessionId: string,
	maxMessages?: number,
) {
	const snapshot = await ctx.client.getSession({
		sessionId: sessionId as SessionId,
		...(maxMessages === undefined ? {} : { messageLimit: maxMessages }),
	});
	const activeRunIds = new Set(
		(snapshot.runs ?? [])
			.filter((run) => run.state === "queued" || run.state === "running")
			.map((run) => run.runId),
	);
	return toChatMessages(
		sessionId,
		snapshot.messages,
		maxMessages === undefined ? undefined : HISTORICAL_TOOL_PAYLOAD_CHARS,
		{
			activeRunIds,
			sessionActiveWithoutRunId: activeRunIds.size > 0,
		},
	);
}

async function chatCommand(ctx: SidecarContext, request: RecordValue) {
	const action = String(request.action ?? "");
	const sessionId =
		typeof request.sessionId === "string" ? request.sessionId : undefined;
	if (action === "attach") {
		if (!sessionId) throw new Error("sessionId is required");
		const desktopScope = desktopChatScope(request);
		const snapshot = await ctx.client.getSession({
			sessionId: sessionId as SessionId,
		});
		if (ctx.workspaceRootLocked || desktopScope) {
			const botId = await chatBotId(ctx, chatConfig(request), desktopScope);
			if (snapshot.session.botId !== botId) {
				throw new Error("Session does not belong to the active bot");
			}
		}
		const running = [...snapshot.runs]
			.reverse()
			.find((run) => run.state === "running");
		if (running) ctx.activeRuns.set(sessionId, running.runId);
		else ctx.activeRuns.delete(sessionId);
		const workspaceRoot = ctx.workspaceRootLocked
			? ctx.workspaceRoot
			: desktopScope?.workspaceRoot || snapshot.session.workspace.rootPath;
		return {
			sessionId,
			workspaceRoot,
			cwd: workspaceRoot,
		};
	}
	if (action === "start") {
		const config = chatConfig(request);
		const desktopScope = desktopChatScope(request);
		const botId = await chatBotId(ctx, config, desktopScope);
		const workspaceRoot = chatWorkspaceRoot(ctx, config, desktopScope);
		const session = await ctx.client.createSession({
			botId,
			workspaceRoot,
			kind: "dedicated",
		});
		return {
			sessionId: session.sessionId,
			workspaceRoot: session.workspace.rootPath,
			cwd: session.workspace.rootPath,
		};
	}
	if (action === "send") {
		let prompt = String(request.prompt ?? "").trim();
		if (!prompt) throw new Error("prompt is required");
		const config = chatConfig(request);
		const desktopScope = desktopChatScope(request);
		const botId = await chatBotId(ctx, config, desktopScope);
		const workspaceRoot = chatWorkspaceRoot(ctx, config, desktopScope);
		if (sessionId && (ctx.workspaceRootLocked || desktopScope)) {
			const snapshot = await ctx.client.getSession({
				sessionId: sessionId as SessionId,
			});
			if (snapshot.session.botId !== botId) {
				throw new Error("Session does not belong to the active bot");
			}
			if (snapshot.session.workspace.rootPath !== workspaceRoot) {
				throw new Error(
					"Session workspace is unavailable; start a new session in the resolved bot workspace",
				);
			}
		}
		if (sessionId) {
			const uploadLabels = await uploadChatAttachments(
				ctx,
				sessionId,
				request.attachments,
			);
			if (uploadLabels.length > 0) {
				prompt = `${prompt}\n\n${uploadLabels.join("\n")}\nUse read_files with these absolute paths to inspect the uploaded content.`;
			}
		}
		const activeRun = sessionId
			? await resolveRunningRunId(ctx, sessionId)
			: undefined;
		if (activeRun && request.delivery === "steer") {
			await ctx.client.steerRun({ runId: activeRun as RunId, text: prompt });
			return {
				sessionId,
				ok: true,
				queued: false,
				promptsInQueue: sessionId
					? await listQueuedPrompts(ctx, sessionId)
					: [],
			};
		}
		const accepted = await ctx.client.startRun({
			botId,
			prompt,
			...(sessionId ? { sessionId: sessionId as SessionId } : {}),
			workspaceRoot,
			overrides: {
				providerId: String(config.provider ?? "") || undefined,
				modelId: String(config.model ?? "") || undefined,
			},
		});
		const { runs } = await ctx.client.listRuns({ runId: accepted.runId });
		const acceptedSessionId = runs[0]?.sessionId;
		if (!acceptedSessionId)
			throw new Error("Gateway accepted a run without a session");
		const promptsInQueue = await listQueuedPrompts(ctx, acceptedSessionId);
		return {
			sessionId: acceptedSessionId,
			workspaceRoot,
			cwd: workspaceRoot,
			ok: true,
			// run.start is an admission acknowledgement. Completion arrives on the
			// event stream, so the webview must remain in its working state.
			queued: true,
			queuePosition: accepted.queuePosition,
			promptsInQueue,
		};
	}
	if (action === "stop" || action === "abort") {
		const runId = sessionId
			? await resolveInterruptibleRunId(ctx, sessionId)
			: undefined;
		if (runId)
			await ctx.client.interruptRun({ runId: runId as RunId, reason: action });
		return { sessionId, ok: true };
	}
	if (action === "reset") {
		if (sessionId) {
			const active = (await listSessionRuns(ctx, sessionId)).filter(
				(run) => run.state === "running" || run.state === "queued",
			);
			for (const run of active) {
				await ctx.client.abortRun({
					runId: run.runId,
					reason: "desktop_session_reset",
				});
			}
			ctx.activeRuns.delete(sessionId);
		}
		return { sessionId, ok: true, promptsInQueue: [] };
	}
	if (action === "fork") {
		if (!sessionId) throw new Error("sessionId is required");
		const desktopScope = desktopChatScope(request);
		const source = await ctx.client.getSession({
			sessionId: sessionId as SessionId,
		});
		if (ctx.workspaceRootLocked || desktopScope) {
			const botId = await chatBotId(ctx, chatConfig(request), desktopScope);
			if (source.session.botId !== botId) {
				throw new Error("Session does not belong to the active bot");
			}
			const workspaceRoot = chatWorkspaceRoot(
				ctx,
				chatConfig(request),
				desktopScope,
			);
			if (source.session.workspace.rootPath !== workspaceRoot) {
				throw new Error(
					"Session workspace is unavailable; fork it from its assigned bot workspace",
				);
			}
		}
		const beforeRunCount =
			typeof request.forkBeforeRunCount === "number"
				? request.forkBeforeRunCount
				: undefined;
		const forked = await ctx.client.forkSession({
			sessionId: sessionId as SessionId,
			...(beforeRunCount === undefined ? {} : { beforeRunCount }),
		});
		return {
			sessionId: forked.session.sessionId,
			forkedFromSessionId: forked.forkedFromSessionId,
			workspaceRoot: forked.session.workspace.rootPath,
			cwd: forked.session.workspace.rootPath,
		};
	}
	if (action === "pending_prompts") {
		if (!sessionId) throw new Error("sessionId is required");
		return {
			sessionId,
			promptsInQueue: await listQueuedPrompts(ctx, sessionId),
		};
	}
	if (action === "steer_prompt") {
		if (!sessionId) throw new Error("sessionId is required");
		const promptId = String(request.promptId ?? "").trim();
		if (!promptId) throw new Error("promptId is required");
		const runs = await listSessionRuns(ctx, sessionId);
		const queued = runs.find(
			(run) => run.runId === promptId && run.state === "queued",
		);
		if (!queued) throw new Error("Queued Gateway prompt was not found");
		// Gateway performs the merge and queue removal atomically. If steering
		// refuses the input, the queued prompt remains available to the user.
		await ctx.client.promoteQueuedRun({ runId: queued.runId });
		return {
			sessionId,
			updated: true,
			promptsInQueue: await listQueuedPrompts(ctx, sessionId),
		};
	}
	if (action === "update_pending_prompt") {
		if (!sessionId) throw new Error("sessionId is required");
		const promptId = String(request.promptId ?? "").trim();
		const prompt = String(request.prompt ?? "").trim();
		if (!promptId) throw new Error("promptId is required");
		if (!prompt) throw new Error("prompt is required");
		const queued = (await listSessionRuns(ctx, sessionId)).find(
			(run) => run.runId === promptId && run.state === "queued",
		);
		if (!queued) throw new Error("Queued Gateway prompt was not found");
		const { run } = await ctx.client.updateQueuedRun({
			runId: queued.runId,
			input: prompt,
		});
		return {
			sessionId,
			updated: true,
			prompt: { id: run.runId, prompt: run.input, steer: false },
			promptsInQueue: await listQueuedPrompts(ctx, sessionId),
		};
	}
	if (action === "remove_pending_prompt") {
		if (!sessionId) throw new Error("sessionId is required");
		const promptId = String(request.promptId ?? "").trim();
		if (!promptId) throw new Error("promptId is required");
		const runs = await listSessionRuns(ctx, sessionId);
		const queued = runs.find(
			(run) => run.runId === promptId && run.state === "queued",
		);
		if (!queued) throw new Error("Queued Gateway prompt was not found");
		await ctx.client.abortRun({
			runId: queued.runId,
			reason: "removed_from_queue",
		});
		return {
			sessionId,
			removed: true,
			prompt: { id: queued.runId, prompt: queued.input, steer: false },
			promptsInQueue: await listQueuedPrompts(ctx, sessionId),
		};
	}
	if (action === "restore_checkpoint") {
		throw new Error(
			"Gateway workspace checkpoints are not available for this session. No workspace files were changed; branch the conversation instead.",
		);
	}
	throw new Error(`Unsupported Gateway chat action: ${action}`);
}

type RoutineExecution = {
	executionId: string;
	scheduleId: string;
	sessionId?: string;
	triggeredAt?: number;
	startedAt?: number;
	endedAt?: number;
	status?: string;
	errorMessage?: string;
};

function routineSchedule(
	schedule: ScheduleRecord,
	jobs: readonly ScheduleJobRecord[] = [],
): RecordValue {
	const latest = jobs[0];
	const oneTimeMetadata =
		schedule.at === undefined
			? {}
			: { [ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]: schedule.at };
	return {
		scheduleId: schedule.scheduleId,
		name: schedule.name,
		cronPattern: schedule.cronPattern ?? ONE_TIME_SCHEDULE_CRON_PATTERN,
		metadata: { ...(schedule.metadata ?? {}), ...oneTimeMetadata },
		prompt: schedule.prompt,
		provider: schedule.modelSelection?.providerId,
		model: schedule.modelSelection?.modelId,
		modelSelection: schedule.modelSelection,
		mode: schedule.mode ?? "yolo",
		workspaceRoot: schedule.workspaceRoot,
		cwd: schedule.cwd,
		systemPrompt: schedule.systemPrompt,
		maxIterations: schedule.maxIterations,
		timeoutSeconds: schedule.timeoutSeconds,
		maxParallel: schedule.maxParallel,
		enabled: schedule.enabled,
		createdAt: schedule.createdAt,
		updatedAt: schedule.updatedAt,
		lastRunAt: latest?.dueAt,
		nextRunAt: schedule.nextDueAt,
		tags: schedule.tags,
	};
}

function routineExecution(
	job: ScheduleJobRecord,
	run?: RunRecord,
): RoutineExecution {
	return {
		executionId: String(job.jobId),
		scheduleId: job.scheduleId,
		sessionId: run?.sessionId,
		triggeredAt: job.createdAt,
		startedAt: run?.startedAt,
		endedAt: job.settledAt ?? run?.endedAt,
		status: run?.state ?? (job.state === "claimed" ? "running" : job.state),
		errorMessage: job.lastError ?? run?.error?.message,
	};
}

async function routineOverview(ctx: SidecarContext): Promise<RecordValue> {
	const { schedules } = await ctx.client.listSchedules();
	const reports = await Promise.all(
		schedules.map(async (schedule) => ({
			schedule,
			jobs: (
				await ctx.client.scheduleReport({ scheduleId: schedule.scheduleId })
			).jobs,
		})),
	);
	const runIds = [
		...new Set(
			reports.flatMap(({ jobs }) =>
				jobs.flatMap((job) => (job.runId ? [job.runId] : [])),
			),
		),
	];
	const runs = await Promise.all(
		runIds.map(async (runId) => {
			const response = await ctx.client.listRuns({ runId });
			return response.runs[0];
		}),
	);
	const runsById = new Map(
		runs
			.filter((run): run is RunRecord => Boolean(run))
			.map((run) => [run.runId, run]),
	);
	const executions = reports.flatMap(({ jobs }) =>
		jobs.map((job) =>
			routineExecution(job, job.runId ? runsById.get(job.runId) : undefined),
		),
	);
	return {
		schedules: reports.map(({ schedule, jobs }) =>
			routineSchedule(schedule, jobs),
		),
		activeExecutions: executions.filter((execution) =>
			["pending", "queued", "running"].includes(execution.status ?? ""),
		),
		upcomingRuns: schedules.flatMap((schedule) =>
			schedule.enabled && schedule.nextDueAt !== undefined
				? [
						{
							scheduleId: schedule.scheduleId,
							name: schedule.name,
							nextRunAt: schedule.nextDueAt,
						},
					]
				: [],
		),
		lastExecutions: reports.flatMap(({ jobs }) => {
			const latest = jobs[0];
			return latest
				? [
						routineExecution(
							latest,
							latest.runId ? runsById.get(latest.runId) : undefined,
						),
					]
				: [];
		}),
	};
}

function routineTrigger(
	args: RecordValue,
):
	| { at: number; metadata: RecordValue }
	| { cronPattern: string; metadata: RecordValue } {
	const scheduleType = trimmedString(args.schedule_type);
	if (scheduleType === "once") {
		const at = Number(args.run_at);
		if (!Number.isFinite(at) || at < 0) throw new Error("run_at is required");
		return {
			at,
			metadata: { [ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]: at },
		};
	}
	const cronPattern = trimmedString(args.cron_pattern);
	if (!cronPattern) throw new Error("cron_pattern is required");
	return { cronPattern, metadata: {} };
}

function routineMode(value: unknown): "act" | "plan" | "yolo" {
	return value === "act" || value === "plan" || value === "yolo"
		? value
		: "yolo";
}

export async function handleCommand(
	ctx: SidecarContext,
	command: string,
	args: RecordValue = {},
): Promise<unknown> {
	const hostCommand = await handleHostCommand(ctx, command, args);
	if (hostCommand.handled) return hostCommand.result;
	if (command === "get_gateway_update_status") {
		return {
			updateRequired: ctx.gatewayUpdateRequired,
			missingCapabilities: ctx.gatewayUpdateRequired
				? [
						"sessions.create",
						"sessions.dedicated",
						"sessions.fork",
						"sessions.metadata",
						"sessions.lifecycle",
						"runs.queuedMutations",
						"schedules.mutations",
						"bots.profilePromptLayers",
						"providers.settings",
						"settings.global",
						"voice.transcription",
						"marketplace.management",
						"mcp.settings",
						"plugins.management",
						"connectors.authorization",
						"connectors.slackLoadingStatus",
						"connectors.slackMentionGate",
					]
				: [],
		};
	}
	if (command === "update_gateway_server") {
		if (ctx.gatewayUpdateRequired) await ctx.updateGateway();
		return { updateRequired: false };
	}
	if (ctx.gatewayUpdateRequired) {
		throw new Error(
			"The running Gateway must be updated before it can be used by this version of Cline Bots.",
		);
	}
	if (command === "list_user_instruction_configs")
		return gatewayCustomizationLists(ctx);
	if (command === "get_marketplace_catalog")
		return ctx.client.getMarketplaceCatalog();
	if (command === "list_marketplace_installed_entries")
		return ctx.client.listMarketplaceInstalled();
	if (command === "install_marketplace_entry")
		return ctx.client.installMarketplace(marketplaceReference(args));
	if (command === "uninstall_marketplace_entry")
		return ctx.client.uninstallMarketplace(marketplaceReference(args));
	if (command === "read_bot_system_prompt") {
		const requestedBotId = String(args.botId ?? "");
		const botId = await resolveBotId(ctx, requestedBotId);
		const result = await ctx.client.getBotSystemPrompt({
			botId,
		});
		return result;
	}
	if (command === "write_bot_system_prompt") {
		const requestedBotId = String(args.botId ?? "");
		const botId = await resolveBotId(ctx, requestedBotId);
		const current = await ctx.client.getBotSystemPrompt({ botId });
		await ctx.client.putBotSystemPrompt({
			botId,
			content: String(args.content ?? ""),
			expectedRevision: current.revision,
		});
		return null;
	}
	if (command === "get_bots_state") {
		const { bots } = await ctx.client.listBots();
		return {
			bots: bots
				.filter((bot) => bot.status === "active")
				.map((bot) => ({
					id: bot.identity.botId,
					name: bot.identity.name,
				})),
		};
	}
	if (command === "create_bot") {
		const name = String(args.name ?? "").trim();
		if (!name) throw new Error("bot name is required");
		const { bots } = await ctx.client.listBots();
		const activeBots = bots.filter((bot) => bot.status === "active");
		if (activeBots.length >= 5) throw new Error("maximum of 5 bots reached");
		const parent =
			activeBots.find((bot) => bot.identity.role === "lead") ?? activeBots[0];
		if (!parent) throw new Error("No lead bot is configured");
		const created = (await ctx.client.mutate("bot.delegate", {
			parentBotId: parent.identity.botId,
			name,
			role: "worker",
			reason: "Created from the Cline Bots UI",
		})) as (typeof bots)[number];
		const systemPrompt = String(args.systemPrompt ?? "").trim();
		if (systemPrompt) {
			await ctx.client.putBotSystemPrompt({
				botId: created.identity.botId,
				content: systemPrompt,
				expectedRevision: created.revision,
			});
		}
		return { id: created.identity.botId, name: created.identity.name };
	}
	if (command === "switch_active_bot") {
		const botId = await resolveBotId(ctx, String(args.botId ?? ""));
		return botId;
	}
	if (command === "set_tool_disabled") {
		const names = Array.isArray(args.names)
			? args.names.filter((name): name is string => typeof name === "string")
			: [];
		return setGatewayToolsDisabled(ctx, names, Boolean(args.disabled));
	}
	if (command === "toggle_disabled_plugin_tool") {
		const name = trimmedString(args.name);
		if (!name) throw new Error("tool name is required");
		const [catalog, current] = await Promise.all([
			ctx.client.listTools(),
			ctx.client.getToolConfiguration(GLOBAL_TOOLS_SCOPE),
		]);
		const entry = catalog.entries.find(({ descriptor }) => {
			const shortName = descriptor.id.slice(descriptor.id.indexOf(":") + 1);
			return descriptor.id === name || shortName === name;
		});
		if (!entry) throw new Error(`Unknown Gateway tool: ${name}`);
		const enabled =
			current?.config.tools?.[entry.descriptor.id]?.enabled !== false;
		return setGatewayToolsDisabled(ctx, [entry.descriptor.id], enabled);
	}
	if (command === "set_plugin_disabled") {
		const path = trimmedString(args.path);
		if (!path) throw new Error("plugin path is required");
		if (typeof args.disabled !== "boolean") {
			throw new Error("disabled must be a boolean");
		}
		await ctx.client.setPluginDisabled(path, args.disabled);
		return gatewayCustomizationLists(ctx);
	}
	if (command === "uninstall_local_primitive") {
		const type = args.type;
		if (
			type !== "mcp" &&
			type !== "skill" &&
			type !== "workflow" &&
			type !== "plugin"
		) {
			throw new Error(
				"local uninstall type must be mcp, skill, workflow, or plugin",
			);
		}
		return ctx.client.uninstallManagedExtension({
			type,
			...(trimmedString(args.id) ? { id: trimmedString(args.id) } : {}),
			...(trimmedString(args.name) ? { name: trimmedString(args.name) } : {}),
			...(trimmedString(args.path) ? { path: trimmedString(args.path) } : {}),
		});
	}
	if (command === "chat_session_command")
		return chatCommand(ctx, (args.request as RecordValue) ?? args);
	if (command === "read_session_messages")
		return sessionMessages(
			ctx,
			String(args.sessionId ?? ""),
			typeof args.maxMessages === "number" ? args.maxMessages : undefined,
		);
	if (command === "update_chat_session_title") {
		const sessionId = trimmedString(
			args.sessionId ?? args.session_id,
		) as SessionId;
		if (!sessionId) throw new Error("sessionId is required");
		const { session } = await ctx.client.getSession({ sessionId });
		await ctx.client.updateSession({
			sessionId,
			title: String(args.title ?? ""),
			expectedRevision: session.revision,
		});
		return true;
	}
	if (command === "update_chat_session_metadata") {
		const sessionId = trimmedString(
			args.sessionId ?? args.session_id,
		) as SessionId;
		if (!sessionId) throw new Error("sessionId is required");
		const metadata = recordValue(args.metadata);
		if (!metadata) throw new Error("metadata must be an object");
		const { session } = await ctx.client.getSession({ sessionId });
		const updated = await ctx.client.updateSession({
			sessionId,
			metadata,
			expectedRevision: session.revision,
		});
		return updated.metadata ?? {};
	}
	if (command === "delete_chat_session" || command === "delete_cli_session") {
		const sessionId = trimmedString(
			args.sessionId ?? args.session_id,
		) as SessionId;
		if (!sessionId) throw new Error("sessionId is required");
		const result = await ctx.client.deleteSession({ sessionId });
		if (result.deleted) ctx.activeRuns.delete(sessionId);
		return result.deleted;
	}
	if (
		[
			"list_chat_sessions",
			"list_cli_sessions",
			"list_discovered_sessions",
		].includes(command)
	) {
		const [{ sessions }, { bots }, { connectors }] = await Promise.all([
			ctx.client.listSessions(),
			ctx.client.listBots(),
			ctx.client.listConnectors(),
		]);
		const botsById = new Map(bots.map((bot) => [bot.identity.botId, bot]));
		const connectorsById = new Map(
			connectors.map((connector) => [connector.connectorId, connector]),
		);
		const limit = Math.max(1, Number(args.limit) || sessions.length);
		return Promise.all(
			sessions.slice(0, limit).map(async (session) => {
				const snapshot = await ctx.client.getSession({
					sessionId: session.sessionId,
				});
				const messages = snapshot.messages.map(({ message }) => message);
				const modelMessage = [...messages]
					.reverse()
					.find((message) => message.modelInfo);
				const firstUserMessage = messages.find(
					(message) => message.role === "user",
				);
				const lastAssistantMessage = [...messages]
					.reverse()
					.find((message) => message.role === "assistant");
				const latestRun = snapshot.runs.at(-1);
				const provenance = latestRun?.provenance;
				const source =
					provenance?.mode === "connector" && provenance.connectorId
						? connectorsById.get(provenance.connectorId)?.kind || "connector"
						: provenance?.mode;
				const latestMessageAt = messages.at(-1)?.createdAt ?? session.createdAt;
				const bot = botsById.get(session.botId);
				return {
					sessionId: session.sessionId,
					id: session.sessionId,
					botId: session.botId,
					botName: bot?.identity.name ?? "",
					source: source ?? "",
					workspaceRoot: session.workspace.rootPath,
					cwd: session.workspace.rootPath,
					status: latestRun?.state ?? session.state,
					startedAt: String(session.createdAt),
					endedAt: String(latestMessageAt),
					createdAt: session.createdAt,
					updatedAt: latestMessageAt,
					provider:
						modelMessage?.modelInfo?.provider ?? bot?.config.providerId ?? "",
					model: modelMessage?.modelInfo?.id ?? bot?.config.modelId ?? "",
					prompt: firstUserMessage ? messageText(firstUserMessage.content) : "",
					lastMessage: lastAssistantMessage
						? messageText(lastAssistantMessage.content)
						: "",
					title: session.title ?? "",
					metadata: {
						...(session.metadata ?? {}),
						...(session.title ? { title: session.title } : {}),
					},
				};
			}),
		);
	}
	if (command === "get_discovered_session") {
		const id = String(args.sessionId ?? args.session_id ?? "");
		const sessions = (await handleCommand(ctx, "list_discovered_sessions", {
			limit: 10_000,
		})) as readonly RecordValue[];
		return sessions.find((session) => session.sessionId === id) ?? null;
	}
	if (command === "get_process_context") {
		const status = await ctx.client.getStatus();
		return {
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
			homeDir: homedir(),
			platform: process.platform,
			appVersion: SIDECAR_VERSION,
			runningSessionCount: status.counts.runningRuns,
			gateway: {
				status: "connected",
				gatewayId: status.gatewayId,
				namespace: status.namespace,
				dataDir: status.dataDir,
				historyDatabase: join(status.dataDir, "gateway.db"),
				webSocketAddress: ctx.webSocketAddress,
				webSocketProtocol: "cline-desktop-v1",
			},
		};
	}
	if (command === "list_bots") {
		const { bots } = await ctx.client.listBots();
		return {
			bots: bots.map((bot) => ({
				id: bot.identity.botId,
				botId: bot.identity.botId,
				name: bot.identity.name,
				role: bot.identity.role,
				active: bot.status === "active",
			})),
		};
	}
	if (command === "poll_tool_approvals")
		return [...ctx.pendingServerRequests.values()]
			.filter(
				(request) => request.method === SERVER_REQUEST_METHODS.toolApproval,
			)
			.map((request) => ({
				requestId: request.id,
				sessionId: request.scope.sessionId,
				...request.params,
			}));
	if (command === "respond_tool_approval") {
		const requestId = String(args.requestId ?? "").trim();
		const pending = ctx.pendingServerRequests.get(requestId);
		if (!pending || pending.method !== SERVER_REQUEST_METHODS.toolApproval) {
			throw new Error("Gateway tool approval request was not found");
		}
		ctx.client.resolveApproval(requestId, {
			approved: Boolean(args.approved),
			reason: typeof args.reason === "string" ? args.reason : undefined,
		});
		// Keep the request until Gateway broadcasts approval.resolved. Removing it
		// here makes the UI claim success before the authority has accepted the
		// answer and loses the recovery path if the connection drops mid-write.
		return true;
	}
	if (command === "respond_ask_question") {
		const requestId = String(args.requestId ?? "").trim();
		const answer = String(args.answer ?? "").trim();
		if (!answer) throw new Error("answer is required");
		const pending = ctx.pendingServerRequests.get(requestId);
		if (!pending || pending.method !== SERVER_REQUEST_METHODS.question) {
			throw new Error("Gateway question request was not found");
		}
		ctx.client.resolveQuestion(requestId, answer);
		// serverRequest.resolved is the authoritative acknowledgement.
		return true;
	}
	if (command === "list_connectors") return ctx.client.listConnectors();
	if (command === "list_connector_channels") return connectorChannels(ctx);
	if (command === "start_connector_channel")
		return startConnectorChannel(ctx, args);
	if (command === "stop_connector_channel")
		return stopConnectorChannel(ctx, args);
	if (command === "list_routine_schedules") return routineOverview(ctx);
	if (command === "create_routine_schedule") {
		const botId = await resolveBotId(
			ctx,
			trimmedString(args.bot_id ?? args.botId ?? ctx.botId),
		);
		const name = trimmedString(args.name);
		const prompt = trimmedString(args.prompt);
		if (!name) throw new Error("name is required");
		if (!prompt) throw new Error("prompt is required");
		const trigger = routineTrigger(args);
		const providerId = trimmedString(args.provider);
		const modelId = trimmedString(args.model);
		const workspaceRoot = trimmedString(args.workspace_root);
		const cwd = trimmedString(args.cwd);
		const systemPrompt = trimmedString(args.system_prompt);
		const schedule = await ctx.client.createSchedule({
			botId,
			name,
			prompt,
			...trigger,
			...(providerId || modelId
				? { modelSelection: { providerId, modelId } }
				: {}),
			mode: routineMode(args.mode),
			...(workspaceRoot ? { workspaceRoot } : {}),
			...(cwd ? { cwd } : {}),
			...(systemPrompt ? { systemPrompt } : {}),
			...(optionalPositiveInteger(args.max_iterations) !== undefined
				? { maxIterations: optionalPositiveInteger(args.max_iterations) }
				: {}),
			...(optionalPositiveInteger(args.timeout_seconds) !== undefined
				? { timeoutSeconds: optionalPositiveInteger(args.timeout_seconds) }
				: {}),
			maxParallel: optionalPositiveInteger(args.max_parallel) ?? 1,
			enabled: typeof args.enabled === "boolean" ? args.enabled : true,
			tags: stringArray(args.tags) ?? [],
		});
		return { schedule: routineSchedule(schedule) };
	}
	if (command === "update_routine_schedule") {
		const scheduleId = trimmedString(
			args.schedule_id ?? args.scheduleId,
		) as ScheduleId;
		if (!scheduleId) throw new Error("schedule_id is required");
		const current = (await ctx.client.listSchedules()).schedules.find(
			(schedule) => schedule.scheduleId === scheduleId,
		);
		if (!current) throw new Error(`Gateway schedule not found: ${scheduleId}`);
		const name = trimmedString(args.name);
		const prompt = trimmedString(args.prompt);
		if (!name) throw new Error("name is required");
		if (!prompt) throw new Error("prompt is required");
		const trigger = routineTrigger(args);
		const providerId = trimmedString(args.provider);
		const modelId = trimmedString(args.model);
		const schedule = await ctx.client.updateSchedule({
			scheduleId,
			expectedRevision: current.revision,
			name,
			prompt,
			...trigger,
			modelSelection: providerId || modelId ? { providerId, modelId } : null,
			mode: routineMode(args.mode),
			workspaceRoot:
				args.workspace_root === null
					? null
					: trimmedString(args.workspace_root) || null,
			cwd: args.cwd === null ? null : trimmedString(args.cwd) || null,
			systemPrompt:
				args.system_prompt === null
					? null
					: trimmedString(args.system_prompt) || null,
			maxIterations:
				args.max_iterations === null
					? null
					: (optionalPositiveInteger(args.max_iterations) ?? null),
			timeoutSeconds:
				args.timeout_seconds === null
					? null
					: (optionalPositiveInteger(args.timeout_seconds) ?? null),
			maxParallel: optionalPositiveInteger(args.max_parallel) ?? 1,
			enabled:
				typeof args.enabled === "boolean" ? args.enabled : current.enabled,
			tags: stringArray(args.tags) ?? [],
		});
		return { schedule: routineSchedule(schedule) };
	}
	if (
		command === "pause_routine_schedule" ||
		command === "resume_routine_schedule"
	) {
		const scheduleId = trimmedString(
			args.schedule_id ?? args.scheduleId,
		) as ScheduleId;
		if (!scheduleId) throw new Error("schedule_id is required");
		const schedule =
			command === "resume_routine_schedule"
				? await ctx.client.enableSchedule({ scheduleId })
				: await ctx.client.disableSchedule({ scheduleId });
		return { schedule: routineSchedule(schedule) };
	}
	if (command === "trigger_routine_schedule") {
		const scheduleId = trimmedString(
			args.schedule_id ?? args.scheduleId,
		) as ScheduleId;
		if (!scheduleId) throw new Error("schedule_id is required");
		const { job } = await ctx.client.triggerSchedule({ scheduleId });
		const run = job.runId
			? (await ctx.client.listRuns({ runId: job.runId })).runs[0]
			: undefined;
		return { execution: routineExecution(job, run) };
	}
	if (command === "delete_routine_schedule") {
		const scheduleId = trimmedString(
			args.schedule_id ?? args.scheduleId,
		) as ScheduleId;
		if (!scheduleId) throw new Error("schedule_id is required");
		return ctx.client.deleteSchedule({ scheduleId });
	}
	if (command === "list_mcp_servers") return ctx.client.listMcpServers();
	if (command === "upsert_mcp_server")
		return ctx.client.putMcpServer(mcpServerInput(args.input));
	if (command === "delete_mcp_server") {
		const name = trimmedString(args.name);
		if (!name) throw new Error("MCP server name is required");
		return ctx.client.deleteMcpServer(name);
	}
	if (command === "set_mcp_server_disabled") {
		const name = trimmedString(args.name);
		if (!name) throw new Error("MCP server name is required");
		if (typeof args.disabled !== "boolean") {
			throw new Error("disabled must be a boolean");
		}
		return ctx.client.setMcpServerDisabled(name, args.disabled);
	}
	if (
		command === "authorize_mcp_server_oauth" ||
		command === "cancel_mcp_server_oauth"
	) {
		throw new Error(MCP_OAUTH_UNAVAILABLE_MESSAGE);
	}
	if (command === "read_session_hooks" || command === "list_session_agents")
		return [];
	if (command === "get_chat_ws_endpoint") return "";
	if (command === "list_provider_catalog")
		return ctx.client.listProviderCatalog();
	if (command === "list_provider_models")
		return ctx.client.listProviderModels(String(args.provider ?? ""));
	if (command === "save_voice_input_settings") {
		const providerId = trimmedString(args.provider);
		const modelId = trimmedString(args.model);
		if (!providerId && !modelId) return ctx.client.setVoiceInput(undefined);
		if (!providerId || !modelId) {
			throw new Error("provider and model must be configured together");
		}
		return ctx.client.setVoiceInput({ providerId, modelId });
	}
	if (command === "create_streaming_transcription_session") {
		return ctx.client.createStreamingTranscriptionSession();
	}
	if (command === "transcribe_audio") {
		if (typeof args.audioBase64 !== "string" || !args.audioBase64) {
			throw new Error("audioBase64 is required");
		}
		if (args.mediaType !== undefined && typeof args.mediaType !== "string") {
			throw new Error("mediaType must be a string");
		}
		return ctx.client.transcribeAudio({
			audioBase64: args.audioBase64,
			...(typeof args.mediaType === "string"
				? { mediaType: args.mediaType }
				: {}),
		});
	}
	if (command === "save_provider_settings") {
		const providerId = String(args.provider ?? "").trim();
		if (!providerId) throw new Error("provider is required");
		return ctx.client.patchProviderSettings(providerId, {
			...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
			settings: providerSettingsPatch(args),
		});
	}
	if (command === "add_provider") {
		return ctx.client.addProvider({
			providerId: String(args.provider_id ?? ""),
			name: String(args.name ?? ""),
			baseUrl: String(args.base_url ?? ""),
			apiKey: typeof args.api_key === "string" ? args.api_key : undefined,
			headers: recordValue(args.headers) as Record<string, string> | undefined,
			timeoutMs:
				typeof args.timeout_ms === "number" ? args.timeout_ms : undefined,
			models: Array.isArray(args.models)
				? args.models.filter(
						(model): model is string => typeof model === "string",
					)
				: undefined,
			defaultModelId:
				typeof args.default_model_id === "string"
					? args.default_model_id
					: undefined,
			modelsSourceUrl:
				typeof args.models_source_url === "string"
					? args.models_source_url
					: undefined,
			capabilities: Array.isArray(args.capabilities)
				? (args.capabilities as never)
				: undefined,
		});
	}
	if (command === "update_provider_models") {
		return ctx.client.updateProviderModels({
			providerId: String(args.provider ?? ""),
			models: Array.isArray(args.models)
				? args.models.filter(
						(model): model is string => typeof model === "string",
					)
				: [],
			defaultModelId:
				typeof args.default_model_id === "string"
					? args.default_model_id
					: undefined,
		});
	}
	if (
		command === "run_provider_oauth_login" ||
		command === "cancel_provider_oauth_login"
	) {
		const provider = trimmedString(args.provider);
		if (provider !== "cline") {
			throw new Error(
				`Desktop OAuth sign-in is not available for provider "${provider || "unknown"}".`,
			);
		}
		return command === "run_provider_oauth_login"
			? ctx.client.loginProviderOAuth("cline")
			: ctx.client.cancelProviderOAuth("cline");
	}
	if (command === "cline_account") {
		if (args.action !== "clineAccount") {
			throw new Error("cline_account action must be clineAccount");
		}
		const operation = trimmedString(args.operation);
		switch (operation) {
			case "fetchMe":
			case "fetchUserOrganizations":
				return ctx.client.queryClineAccount({ operation });
			case "fetchBalance":
			case "fetchUsageTransactions":
			case "fetchPaymentTransactions":
				return ctx.client.queryClineAccount({
					operation,
					...(trimmedString(args.userId)
						? { userId: trimmedString(args.userId) }
						: {}),
				});
			case "fetchOrganizationBalance": {
				const organizationId = trimmedString(args.organizationId);
				if (!organizationId) throw new Error("organizationId is required");
				return ctx.client.queryClineAccount({ operation, organizationId });
			}
			case "fetchOrganizationUsageTransactions": {
				const organizationId = trimmedString(args.organizationId);
				if (!organizationId) throw new Error("organizationId is required");
				return ctx.client.queryClineAccount({
					operation,
					organizationId,
					...(trimmedString(args.memberId)
						? { memberId: trimmedString(args.memberId) }
						: {}),
				});
			}
			case "switchAccount":
				return ctx.client.switchClineAccount(
					typeof args.organizationId === "string" ? args.organizationId : null,
				);
			case "fetchFeaturebaseToken":
				throw new Error(
					"Featurebase tokens are not exposed through the desktop Gateway.",
				);
			default:
				throw new Error(
					`Unsupported Cline account operation: ${operation || "missing"}`,
				);
		}
	}
	if (command === "get_global_settings") return ctx.client.getGlobalSettings();
	if (command === "set_telemetry_opt_out") {
		if (typeof args.telemetry_opt_out !== "boolean") {
			throw new Error("telemetry_opt_out must be a boolean");
		}
		return ctx.client.patchGlobalSettings({
			telemetryOptOut: args.telemetry_opt_out,
		});
	}
	if (command === "set_auto_update_enabled") {
		if (typeof args.auto_update_enabled !== "boolean") {
			throw new Error("auto_update_enabled must be a boolean");
		}
		return ctx.client.patchGlobalSettings({
			autoUpdateEnabled: args.auto_update_enabled,
		});
	}
	if (command === "set_web_search_enabled") {
		if (typeof args.web_search_enabled !== "boolean") {
			throw new Error("web_search_enabled must be a boolean");
		}
		return ctx.client.patchGlobalSettings({
			webSearchEnabled: args.web_search_enabled,
		});
	}
	if (command === "get_update_status") return { available: false };
	if (
		[
			"set_tray_status",
			"set_app_icon",
			"respond_message_bot",
			"claim_message_bot",
		].includes(command)
	)
		return true;
	throw new Error(`Command is not available through the Gateway: ${command}`);
}
