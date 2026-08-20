import { homedir } from "node:os";
import type { AgentMessage, AgentMessagePart } from "@cline/shared";
import type {
	BotId,
	BotToolConfiguration,
	RunId,
	SessionId,
} from "@cline/shared/gateway";
import {
	connectorChannels,
	startConnectorChannel,
	stopConnectorChannel,
} from "./connectors";
import { listProviderCatalog, listProviderModels } from "./provider-catalog";
import type { SidecarContext } from "./types";

type RecordValue = Record<string, unknown>;

const MARKETPLACE_CATALOG_URL =
	process.env.CLINE_MARKETPLACE_CATALOG_URL?.trim() ||
	"https://cline.github.io/marketplace/catalog.json";

async function marketplaceCatalog(): Promise<unknown> {
	const response = await fetch(MARKETPLACE_CATALOG_URL, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(
			`Failed to fetch marketplace catalog: ${response.status} ${response.statusText}`.trim(),
		);
	}
	return response.json();
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

function text(parts: readonly AgentMessagePart[]): string {
	return parts
		.map((part) => {
			if (part.type === "text" || part.type === "reasoning") return part.text;
			if (part.type === "tool-call")
				return JSON.stringify({ toolName: part.toolName, input: part.input });
			if (part.type === "tool-result")
				return JSON.stringify({
					toolName: part.toolName,
					output: part.output,
					error: part.isError,
				});
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function toChatMessage(sessionId: string, message: AgentMessage) {
	return {
		id: message.id,
		sessionId,
		role: message.role,
		content: text(message.content),
		createdAt: message.createdAt,
		meta: {
			providerId: message.modelInfo?.provider,
			modelId: message.modelInfo?.id,
			inputTokens: message.metrics?.inputTokens,
			outputTokens: message.metrics?.outputTokens,
			totalCost: message.metrics?.cost,
		},
	};
}

const GLOBAL_TOOLS_SCOPE = { kind: "global" } as const;

async function gatewayCustomizationLists(ctx: SidecarContext) {
	const [catalog, configuration] = await Promise.all([
		ctx.client.listTools(),
		ctx.client.getToolConfiguration(GLOBAL_TOOLS_SCOPE),
	]);
	return {
		workspaceRoot: ctx.workspaceRoot,
		rules: [],
		workflows: [],
		skills: [],
		agents: [],
		plugins: [],
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
		mcp: { settingsPath: "", hasSettingsFile: false, servers: [] },
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

async function sessionMessages(ctx: SidecarContext, sessionId: string) {
	const snapshot = await ctx.client.getSession({
		sessionId: sessionId as SessionId,
	});
	return snapshot.messages.map(({ message }) =>
		toChatMessage(sessionId, message),
	);
}

async function chatCommand(ctx: SidecarContext, request: RecordValue) {
	const action = String(request.action ?? "");
	const sessionId =
		typeof request.sessionId === "string" ? request.sessionId : undefined;
	if (action === "attach") {
		if (!sessionId) throw new Error("sessionId is required");
		const snapshot = await ctx.client.getSession({
			sessionId: sessionId as SessionId,
		});
		const running = [...snapshot.runs]
			.reverse()
			.find((run) => run.state === "running" || run.state === "queued");
		if (running) ctx.activeRuns.set(sessionId, running.runId);
		return {
			sessionId,
			workspaceRoot: snapshot.session.workspace.rootPath,
			cwd: snapshot.session.workspace.rootPath,
		};
	}
	if (action === "start") {
		const bots = await ctx.client.listBots();
		const botId = String(
			(request.config as RecordValue | undefined)?.botId ??
				bots.bots[0]?.identity.botId ??
				"",
		);
		if (!botId) throw new Error("No Gateway bot is configured");
		const config = (request.config as RecordValue | undefined) ?? {};
		const session = await ctx.client.createSession({
			botId: botId as BotId,
			workspaceRoot: String(config.workspaceRoot ?? ctx.workspaceRoot),
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
		const bots = await ctx.client.listBots();
		const botId = String(
			(request.config as RecordValue | undefined)?.botId ??
				bots.bots[0]?.identity.botId ??
				"",
		);
		if (!botId) throw new Error("No Gateway bot is configured");
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
		const activeRun = sessionId ? ctx.activeRuns.get(sessionId) : undefined;
		if (action === "send" && activeRun && request.delivery === "steer") {
			await ctx.client.steerRun({ runId: activeRun as RunId, text: prompt });
			return { sessionId, ok: true, queued: false };
		}
		const accepted = await ctx.client.startRun({
			botId: botId as BotId,
			prompt,
			...(sessionId ? { sessionId: sessionId as SessionId } : {}),
			workspaceRoot: String(
				(request.config as RecordValue | undefined)?.workspaceRoot ??
					ctx.workspaceRoot,
			),
			overrides: {
				providerId:
					String((request.config as RecordValue | undefined)?.provider ?? "") ||
					undefined,
				modelId:
					String((request.config as RecordValue | undefined)?.model ?? "") ||
					undefined,
			},
		});
		const { runs } = await ctx.client.listRuns({ runId: accepted.runId });
		const acceptedSessionId = runs[0]?.sessionId;
		if (!acceptedSessionId)
			throw new Error("Gateway accepted a run without a session");
		ctx.activeRuns.set(acceptedSessionId, accepted.runId);
		return {
			sessionId: acceptedSessionId,
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
			ok: true,
			queued: true,
		};
	}
	if (action === "stop" || action === "abort") {
		const runId = sessionId ? ctx.activeRuns.get(sessionId) : undefined;
		if (runId)
			await ctx.client.interruptRun({ runId: runId as RunId, reason: action });
		return { sessionId, ok: true };
	}
	if (action === "pending_prompts") return { sessionId, promptsInQueue: [] };
	if (action === "steer_prompt") {
		const runId = sessionId ? ctx.activeRuns.get(sessionId) : undefined;
		if (!runId) throw new Error("No active Gateway run");
		await ctx.client.steerRun({
			runId: runId as RunId,
			text: String(request.prompt ?? ""),
		});
		return { sessionId, ok: true };
	}
	throw new Error(`Unsupported Gateway chat action: ${action}`);
}

export async function handleCommand(
	ctx: SidecarContext,
	command: string,
	args: RecordValue = {},
): Promise<unknown> {
	if (command === "get_gateway_update_status") {
		return {
			updateRequired: ctx.gatewayUpdateRequired,
			missingCapabilities: ctx.gatewayUpdateRequired
				? [
						"sessions.create",
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
	if (command === "get_marketplace_catalog") return marketplaceCatalog();
	if (command === "read_bot_system_prompt") {
		const result = await ctx.client.getBotSystemPrompt({
			botId: String(args.botId ?? "") as BotId,
		});
		return result.content;
	}
	if (command === "write_bot_system_prompt") {
		const botId = String(args.botId ?? "") as BotId;
		const current = await ctx.client.getBotSystemPrompt({ botId });
		await ctx.client.putBotSystemPrompt({
			botId,
			content: String(args.content ?? ""),
			expectedRevision: current.revision,
		});
		return null;
	}
	if (command === "set_tool_disabled") {
		const names = Array.isArray(args.names)
			? args.names.filter((name): name is string => typeof name === "string")
			: [];
		return setGatewayToolsDisabled(ctx, names, Boolean(args.disabled));
	}
	if (command === "chat_session_command")
		return chatCommand(ctx, (args.request as RecordValue) ?? args);
	if (command === "read_session_messages")
		return sessionMessages(ctx, String(args.sessionId ?? ""));
	if (
		[
			"list_chat_sessions",
			"list_cli_sessions",
			"list_discovered_sessions",
		].includes(command)
	) {
		const [{ sessions }, { bots }] = await Promise.all([
			ctx.client.listSessions(),
			ctx.client.listBots(),
		]);
		const botsById = new Map(bots.map((bot) => [bot.identity.botId, bot]));
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
				const latestRun = snapshot.runs.at(-1);
				const latestMessageAt = messages.at(-1)?.createdAt ?? session.createdAt;
				const bot = botsById.get(session.botId);
				return {
					sessionId: session.sessionId,
					id: session.sessionId,
					botId: session.botId,
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
					prompt: firstUserMessage ? text(firstUserMessage.content) : "",
				};
			}),
		);
	}
	if (command === "get_discovered_session") {
		const id = String(args.sessionId ?? args.session_id ?? "");
		const { sessions } = await ctx.client.listSessions();
		return sessions.find((session) => session.sessionId === id) ?? null;
	}
	if (command === "get_process_context") {
		const status = await ctx.client.getStatus();
		return {
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
			homeDir: homedir(),
			platform: process.platform,
			appVersion: "0.0.1",
			runningSessionCount: status.counts.runningRuns,
			gateway: {
				status: "connected",
				gatewayId: status.gatewayId,
				namespace: status.namespace,
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
		return [...ctx.pendingApprovals.entries()].map(([requestId, value]) => ({
			requestId,
			sessionId: value.sessionId,
			...(value.request as object),
		}));
	if (command === "respond_tool_approval") {
		ctx.client.resolveApproval(String(args.requestId), {
			approved: Boolean(args.approved),
			reason: typeof args.reason === "string" ? args.reason : undefined,
		});
		ctx.pendingApprovals.delete(String(args.requestId));
		return true;
	}
	if (command === "list_connectors") return ctx.client.listConnectors();
	if (command === "list_connector_channels") return connectorChannels(ctx);
	if (command === "start_connector_channel")
		return startConnectorChannel(ctx, args);
	if (command === "stop_connector_channel")
		return stopConnectorChannel(ctx, args);
	if (command === "list_routine_schedules") return ctx.client.listSchedules();
	if (command === "list_mcp_servers") return { servers: [] };
	if (command === "read_session_hooks" || command === "list_session_agents")
		return [];
	if (command === "get_chat_ws_endpoint") return "";
	if (command === "list_provider_catalog") return listProviderCatalog();
	if (command === "list_provider_models")
		return listProviderModels(String(args.provider ?? ""));
	if (command === "get_global_settings") return {};
	if (command === "get_update_status") return { available: false };
	if (command === "cline_account") return null;
	if (
		[
			"set_tray_status",
			"set_app_icon",
			"update_chat_session_title",
			"update_chat_session_metadata",
			"respond_ask_question",
			"respond_message_bot",
			"claim_message_bot",
		].includes(command)
	)
		return true;
	throw new Error(`Command is not available through the Gateway: ${command}`);
}
