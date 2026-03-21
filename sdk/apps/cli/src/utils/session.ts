import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type {
	AgentEvent,
	AgentResult,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/agents";
import type {
	BasicLogger,
	LlmsProviders,
	RpcChatMessage,
	RpcChatRunTurnRequest,
	RpcChatRuntimeLoggerConfig,
	RpcChatStartSessionArtifacts,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
} from "@clinebot/core";
import {
	createSessionHost,
	RpcCoreSessionService,
	resolveSessionBackend,
	type SessionAccumulatedUsage,
	type SessionBackend,
	type SessionManifest,
	SessionSource,
} from "@clinebot/core/node";
import { getRpcServerDefaultAddress, RpcSessionClient } from "@clinebot/rpc";
import { ensureRpcRuntimeAddress } from "../commands/rpc";
import { createCliLoggerAdapter } from "../logging/adapter";
import { getCliTelemetryService } from "./telemetry";

function resolveRpcAddress(): string {
	return process.env.CLINE_RPC_ADDRESS?.trim() || getRpcServerDefaultAddress();
}

function hasExplicitRpcAddress(): boolean {
	return !!process.env.CLINE_RPC_ADDRESS?.trim();
}

function resolveSessionBackendMode(): "auto" | "rpc" | "local" {
	const raw = process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase();
	if (raw === "rpc" || raw === "local") {
		return raw;
	}
	return "auto";
}

export interface CliSessionManager {
	start(input: {
		config: import("@clinebot/core/node").CoreSessionConfig & {
			loggerConfig?: RpcChatRuntimeLoggerConfig;
		};
		source?: import("@clinebot/core/node").SessionSource;
		prompt?: string;
		interactive?: boolean;
		initialMessages?: LlmsProviders.Message[];
		userImages?: string[];
		userFiles?: string[];
		userInstructionWatcher?: import("@clinebot/core/node").UserInstructionConfigWatcher;
		onTeamRestored?: () => void;
		defaultToolExecutors?: Partial<import("@clinebot/core/node").ToolExecutors>;
		toolPolicies?: import("@clinebot/agents").AgentConfig["toolPolicies"];
		requestToolApproval?: (
			request: import("@clinebot/agents").ToolApprovalRequest,
		) => Promise<import("@clinebot/agents").ToolApprovalResult>;
	}): Promise<{
		sessionId: string;
		manifest: SessionManifest;
		manifestPath: string;
		transcriptPath: string;
		hookPath: string;
		messagesPath: string;
		result?: AgentResult;
	}>;
	send(input: {
		sessionId: string;
		prompt: string;
		userImages?: string[];
		userFiles?: string[];
	}): Promise<AgentResult | undefined>;
	getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined>;
	readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
	abort(sessionId: string): Promise<void>;
	stop(sessionId: string): Promise<void>;
	dispose(reason?: string): Promise<void>;
	subscribe(listener: (event: unknown) => void): () => void;
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>;
}

function createInitialAccumulatedUsage(): SessionAccumulatedUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
	};
}

function accumulateUsageTotals(
	baseline: SessionAccumulatedUsage,
	usage: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	},
): SessionAccumulatedUsage {
	return {
		inputTokens: baseline.inputTokens + Math.max(0, usage.inputTokens ?? 0),
		outputTokens: baseline.outputTokens + Math.max(0, usage.outputTokens ?? 0),
		cacheReadTokens:
			baseline.cacheReadTokens + Math.max(0, usage.cacheReadTokens ?? 0),
		cacheWriteTokens:
			baseline.cacheWriteTokens + Math.max(0, usage.cacheWriteTokens ?? 0),
		totalCost: baseline.totalCost + Math.max(0, usage.totalCost ?? 0),
	};
}

async function getCoreSessions(): Promise<SessionBackend> {
	const backendMode = resolveSessionBackendMode();
	if (backendMode === "local" || process.env.CLINE_VCR) {
		process.stderr.write(`Forcing local in-process sessions\n`);
		return await resolveSessionBackend({
			backendMode,
			autoStartRpcServer: false,
		});
	}
	const requestedAddress = resolveRpcAddress();
	if (backendMode === "auto" && hasExplicitRpcAddress()) {
		process.env.CLINE_RPC_ADDRESS = requestedAddress;
		return await resolveSessionBackend({
			backendMode: "rpc",
			rpcAddress: requestedAddress,
			autoStartRpcServer: false,
		});
	}
	const ensuredAddress = await ensureRpcRuntimeAddress(requestedAddress).catch(
		() => requestedAddress,
	);
	process.env.CLINE_RPC_ADDRESS = ensuredAddress;
	return await resolveSessionBackend({
		backendMode,
		rpcAddress: ensuredAddress,
	});
}

export async function getCoreSessionBackend(): Promise<SessionBackend> {
	return getCoreSessions();
}

export async function createDefaultCliSessionManager(options?: {
	defaultToolExecutors?: Partial<import("@clinebot/core/node").ToolExecutors>;
	toolPolicies?: import("@clinebot/agents").AgentConfig["toolPolicies"];
	logger?: BasicLogger;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}): Promise<CliSessionManager> {
	const sessionBackend = await getCoreSessions();
	if (sessionBackend instanceof RpcCoreSessionService) {
		return createRpcRuntimeCliSessionManager(options, sessionBackend);
	}
	return (await createSessionHost({
		sessionService: sessionBackend,
		defaultToolExecutors: options?.defaultToolExecutors,
		telemetry: getCliTelemetryService(options?.logger),
		toolPolicies: options?.toolPolicies,
		requestToolApproval: options?.requestToolApproval,
	})) as CliSessionManager;
}

type StartSessionInput = Parameters<CliSessionManager["start"]>[0];
type StartSessionOutput = Awaited<ReturnType<CliSessionManager["start"]>>;

type ListenerEvent = {
	type: "agent_event";
	payload: {
		sessionId: string;
		event: AgentEvent;
	};
};

function isUnimplementedRpcMethodError(error: unknown): boolean {
	if (error && typeof error === "object" && "code" in error) {
		const code = Number((error as { code?: unknown }).code);
		if (code === 12) {
			return true;
		}
	}
	const message = error instanceof Error ? error.message : String(error);
	return message.toUpperCase().includes("UNIMPLEMENTED");
}

function isSessionNotFoundError(error: unknown): boolean {
	if (error && typeof error === "object" && "code" in error) {
		const code = Number((error as { code?: unknown }).code);
		if (code === 5) {
			return true;
		}
	}
	const message = error instanceof Error ? error.message : String(error);
	return message.toLowerCase().includes("session not found");
}

function emitAgentEvent(
	listeners: Set<(event: unknown) => void>,
	sessionId: string,
	event: AgentEvent,
): void {
	const payload: ListenerEvent = {
		type: "agent_event",
		payload: {
			sessionId,
			event,
		},
	};
	for (const listener of listeners) {
		listener(payload);
	}
}

function toRpcStartRequest(
	input: StartSessionInput,
	defaultToolPolicies: StartSessionInput["toolPolicies"] | undefined,
): RpcChatStartSessionRequest {
	const config = input.config;
	const request: RpcChatStartSessionRequest = {
		sessionId: config.sessionId,
		workspaceRoot: config.workspaceRoot ?? config.cwd,
		cwd: config.cwd,
		provider: config.providerId,
		model: config.modelId,
		mode: config.mode,
		apiKey: config.apiKey ?? "",
		systemPrompt: config.systemPrompt,
		maxIterations: config.maxIterations,
		enableTools: config.enableTools,
		enableSpawn: config.enableSpawnAgent,
		enableTeams: config.enableAgentTeams,
		autoApproveTools:
			(input.toolPolicies ?? defaultToolPolicies)?.["*"]?.autoApprove !== false,
		teamName: config.teamName ?? "",
		missionStepInterval: config.missionLogIntervalSteps ?? 3,
		missionTimeIntervalMs: config.missionLogIntervalMs ?? 120000,
		initialMessages: input.initialMessages as RpcChatMessage[] | undefined,
		logger: config.loggerConfig as RpcChatRuntimeLoggerConfig | undefined,
	};
	(
		request as RpcChatStartSessionRequest & {
			toolPolicies?: Record<
				string,
				{ enabled?: boolean; autoApprove?: boolean }
			>;
		}
	).toolPolicies = (input.toolPolicies ?? defaultToolPolicies) as
		| Record<string, { enabled?: boolean; autoApprove?: boolean }>
		| undefined;
	return request;
}

function toAgentResult(
	result: RpcChatTurnResult,
	config: RpcChatStartSessionRequest,
): AgentResult {
	const now = new Date();
	return {
		text: result.text,
		usage: result.usage,
		iterations: result.iterations,
		finishReason: result.finishReason as AgentResult["finishReason"],
		messages: result.messages as AgentResult["messages"],
		toolCalls: result.toolCalls as AgentResult["toolCalls"],
		durationMs: 0,
		model: {
			id: config.model,
			provider: config.provider,
		},
		startedAt: now,
		endedAt: now,
	};
}

function parseToolApprovalInput(inputJson: unknown): unknown {
	if (typeof inputJson !== "string" || !inputJson.trim()) {
		return undefined;
	}
	try {
		return JSON.parse(inputJson);
	} catch {
		return undefined;
	}
}

function normalizeStartResult(
	sessionId: string,
	startResult: RpcChatStartSessionArtifacts | undefined,
): StartSessionOutput {
	const manifestPath = startResult?.manifestPath?.trim() || "";
	const transcriptPath = startResult?.transcriptPath?.trim() || "";
	const hookPath = startResult?.hookPath?.trim() || "";
	const messagesPath = startResult?.messagesPath?.trim() || "";
	let manifest: SessionManifest | undefined;
	if (manifestPath && existsSync(manifestPath)) {
		try {
			manifest = JSON.parse(
				readFileSync(manifestPath, "utf8"),
			) as SessionManifest;
		} catch {
			manifest = undefined;
		}
	}
	if (!manifest) {
		throw new Error("manifest unavailable");
	}
	return {
		sessionId,
		manifest,
		manifestPath,
		transcriptPath,
		hookPath,
		messagesPath,
	};
}

function toManifestFromSessionRow(
	sessionId: string,
	row: Awaited<ReturnType<RpcSessionClient["getSession"]>>,
): SessionManifest | undefined {
	if (!row) {
		return undefined;
	}
	const source = row.source?.trim() as SessionSource | undefined;
	if (!source || !Object.values(SessionSource).includes(source)) {
		return undefined;
	}
	return {
		version: 1,
		session_id: row.sessionId?.trim() || sessionId,
		source,
		pid: row.pid,
		started_at: row.startedAt,
		ended_at: row.endedAt || undefined,
		exit_code: row.exitCode ?? undefined,
		status: row.status,
		interactive: row.interactive,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspace_root: row.workspaceRoot,
		team_name: row.teamName || undefined,
		enable_tools: row.enableTools,
		enable_spawn: row.enableSpawn,
		enable_teams: row.enableTeams,
		prompt: row.prompt || undefined,
		metadata: row.metadata || undefined,
		messages_path: row.messagesPath || undefined,
	};
}

function toFallbackManifest(
	sessionId: string,
	request: RpcChatStartSessionRequest,
	source: StartSessionInput["source"],
	interactive: boolean | undefined,
	messagesPath: string,
): SessionManifest {
	return {
		version: 1,
		session_id: sessionId,
		source:
			source === "cli-subagent"
				? SessionSource.CLI_SUBAGENT
				: SessionSource.CLI,
		pid: process.pid,
		started_at: new Date().toISOString(),
		status: "running",
		interactive: interactive === true,
		provider: request.provider,
		model: request.model,
		cwd: request.cwd ?? process.cwd(),
		workspace_root: request.workspaceRoot,
		team_name: request.teamName || undefined,
		enable_tools: request.enableTools,
		enable_spawn: request.enableSpawn,
		enable_teams: request.enableTeams,
		messages_path: messagesPath || undefined,
	};
}

function normalizeStartResultWithFallback(
	sessionId: string,
	startResult: RpcChatStartSessionArtifacts | undefined,
	sessionRow: Awaited<ReturnType<RpcSessionClient["getSession"]>> | undefined,
	request: RpcChatStartSessionRequest,
	source: StartSessionInput["source"],
	interactive: boolean | undefined,
): StartSessionOutput {
	try {
		return normalizeStartResult(sessionId, startResult);
	} catch {
		const transcriptPath =
			startResult?.transcriptPath?.trim() ||
			sessionRow?.transcriptPath?.trim() ||
			"";
		const hookPath =
			startResult?.hookPath?.trim() || sessionRow?.hookPath?.trim() || "";
		const messagesPath =
			startResult?.messagesPath?.trim() ||
			sessionRow?.messagesPath?.trim() ||
			"";
		const manifestPathFromStart = startResult?.manifestPath?.trim() || "";
		const inferredManifestPath = transcriptPath
			? `${dirname(transcriptPath)}/${sessionId}.json`
			: "";
		const manifestPath = manifestPathFromStart || inferredManifestPath;
		let manifest: SessionManifest | undefined;
		if (manifestPath && existsSync(manifestPath)) {
			try {
				manifest = JSON.parse(
					readFileSync(manifestPath, "utf8"),
				) as SessionManifest;
			} catch {
				manifest = undefined;
			}
		}
		manifest =
			manifest ??
			toManifestFromSessionRow(sessionId, sessionRow) ??
			toFallbackManifest(sessionId, request, source, interactive, messagesPath);
		return {
			sessionId,
			manifest,
			manifestPath,
			transcriptPath,
			hookPath,
			messagesPath,
		};
	}
}

function resolveAttachmentPath(filePath: string, cwd: string): string {
	return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

async function toRpcAttachmentFiles(
	userFiles: string[] | undefined,
	cwd: string,
): Promise<Array<{ name: string; content: string }> | undefined> {
	if (!userFiles || userFiles.length === 0) {
		return undefined;
	}

	const files = await Promise.all(
		userFiles.map(async (filePath) => {
			const absolutePath = resolveAttachmentPath(filePath, cwd);
			return {
				name: basename(filePath),
				content: await readFile(absolutePath, "utf8"),
			};
		}),
	);
	return files.length > 0 ? files : undefined;
}

function resolveTextDelta(
	payload: Record<string, unknown>,
	streamedText: string,
): {
	delta: string;
	nextText: string;
} {
	const accumulated =
		typeof payload.accumulated === "string" ? payload.accumulated : undefined;
	if (typeof accumulated === "string") {
		if (accumulated.startsWith(streamedText)) {
			return {
				delta: accumulated.slice(streamedText.length),
				nextText: accumulated,
			};
		}
		if (streamedText.startsWith(accumulated)) {
			return {
				delta: "",
				nextText: streamedText,
			};
		}
	}

	const text = typeof payload.text === "string" ? payload.text : "";
	return {
		delta: text,
		nextText: `${streamedText}${text}`,
	};
}

function createRpcRuntimeCliSessionManager(
	options:
		| {
				defaultToolExecutors?: Partial<
					import("@clinebot/core/node").ToolExecutors
				>;
				toolPolicies?: import("@clinebot/agents").AgentConfig["toolPolicies"];
				requestToolApproval?: (
					request: ToolApprovalRequest,
				) => Promise<ToolApprovalResult>;
		  }
		| undefined,
	rpcSessions: RpcCoreSessionService,
): CliSessionManager {
	const listeners = new Set<(event: unknown) => void>();
	const client = new RpcSessionClient({
		address: resolveRpcAddress(),
	});
	const sessionConfigs = new Map<string, RpcChatStartSessionRequest>();
	const accumulatedUsageBySession = new Map<string, SessionAccumulatedUsage>();
	const sessionLogger = createCliLoggerAdapter({
		runtime: "rpc-runtime",
		component: "session",
	}).core;

	return {
		start: async (input) => {
			const request = toRpcStartRequest(input, options?.toolPolicies);
			const response = await client.startRuntimeSession(request);
			const sessionId = response.sessionId.trim();
			if (!sessionId) {
				throw new Error("rpc runtime start returned empty session id");
			}
			sessionConfigs.set(sessionId, request);
			accumulatedUsageBySession.set(sessionId, createInitialAccumulatedUsage());
			let sessionRow:
				| Awaited<ReturnType<RpcSessionClient["getSession"]>>
				| undefined;
			try {
				sessionRow = await client.getSession(sessionId);
			} catch {
				sessionRow = undefined;
			}
			return normalizeStartResultWithFallback(
				sessionId,
				response.startResult,
				sessionRow,
				request,
				input.source,
				input.interactive,
			);
		},
		send: async (input) => {
			const config = sessionConfigs.get(input.sessionId);
			if (!config) {
				sessionLogger.debug?.("send() session not found", {
					sessionId: input.sessionId,
					knownSessions: [...sessionConfigs.keys()],
				});
				throw new Error(`session not found: ${input.sessionId}`);
			}
			const attachmentFiles = await toRpcAttachmentFiles(
				input.userFiles,
				config.cwd ?? process.cwd(),
			);
			const request: RpcChatRunTurnRequest = {
				config,
				prompt: input.prompt,
				attachments:
					(input.userImages && input.userImages.length > 0) || attachmentFiles
						? {
								userImages:
									input.userImages && input.userImages.length > 0
										? input.userImages
										: undefined,
								userFiles: attachmentFiles,
							}
						: undefined,
			};
			let streamedText = "";
			const stopStreaming = client.streamEvents(
				{
					clientId: `cli-runtime-${process.pid}`,
					sessionIds: [input.sessionId],
				},
				{
					onEvent: (event) => {
						const payload = event.payload;
						if (event.eventType === "approval.requested") {
							const approvalId =
								typeof payload.approvalId === "string"
									? payload.approvalId.trim()
									: "";
							const toolCallId =
								typeof payload.toolCallId === "string"
									? payload.toolCallId
									: "";
							const toolName =
								typeof payload.toolName === "string" ? payload.toolName : "";
							if (!approvalId || !toolCallId || !toolName) {
								return;
							}
							const inputValue = parseToolApprovalInput(payload.inputJson);
							const requestApproval = options?.requestToolApproval;
							void (async () => {
								const decision = requestApproval
									? await requestApproval({
											agentId: "",
											conversationId: "",
											iteration: 0,
											toolCallId,
											toolName,
											input: inputValue,
											policy: {},
										})
									: {
											approved: false,
											reason: `Tool "${toolName}" requires approval but no approval handler is configured`,
										};
								await client.respondToolApproval({
									approvalId,
									approved: decision.approved === true,
									reason: decision.reason,
									responderClientId: `cli-runtime-${process.pid}`,
								});
							})().catch(() => {
								// Best effort: do not fail turn streaming on approval transport errors.
							});
							return;
						}
						if (event.eventType === "runtime.chat.text_delta") {
							const resolved = resolveTextDelta(payload, streamedText);
							if (!resolved.delta) {
								streamedText = resolved.nextText;
								return;
							}
							streamedText = resolved.nextText;
							emitAgentEvent(listeners, input.sessionId, {
								type: "content_start",
								contentType: "text",
								text: resolved.delta,
							});
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_start") {
							emitAgentEvent(listeners, input.sessionId, {
								type: "content_start",
								contentType: "tool",
								toolCallId:
									typeof payload.toolCallId === "string"
										? payload.toolCallId
										: undefined,
								toolName:
									typeof payload.toolName === "string"
										? payload.toolName
										: undefined,
								input: payload.input,
							} as unknown as AgentEvent);
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_end") {
							emitAgentEvent(listeners, input.sessionId, {
								type: "content_end",
								contentType: "tool",
								toolCallId:
									typeof payload.toolCallId === "string"
										? payload.toolCallId
										: undefined,
								toolName:
									typeof payload.toolName === "string"
										? payload.toolName
										: undefined,
								output: payload.output,
								error:
									typeof payload.error === "string" ? payload.error : undefined,
								durationMs:
									typeof payload.durationMs === "number"
										? payload.durationMs
										: undefined,
							} as unknown as AgentEvent);
							return;
						}
						if (event.eventType === "runtime.chat.error") {
							emitAgentEvent(listeners, input.sessionId, {
								type: "error",
								error: new Error(
									typeof payload.message === "string"
										? payload.message
										: "runtime error",
								),
								recoverable: payload.recoverable !== false,
								iteration:
									typeof payload.iteration === "number" ? payload.iteration : 0,
							});
						}
					},
				},
			);
			sessionLogger.debug?.("calling sendRuntimeSession", {
				sessionId: input.sessionId,
			});
			const response = await client
				.sendRuntimeSession(input.sessionId, request)
				.finally(() => {
					sessionLogger.debug?.("sendRuntimeSession completed/failed", {
						sessionId: input.sessionId,
					});
					stopStreaming();
				});
			const result = response.result as RpcChatTurnResult;
			if (result.text) {
				if (result.text.startsWith(streamedText)) {
					const remainder = result.text.slice(streamedText.length);
					if (remainder) {
						emitAgentEvent(listeners, input.sessionId, {
							type: "content_start",
							contentType: "text",
							text: remainder,
						});
						streamedText += remainder;
					}
				} else if (result.text !== streamedText) {
					emitAgentEvent(listeners, input.sessionId, {
						type: "content_start",
						contentType: "text",
						text: result.text,
					});
					streamedText = result.text;
				}
			}
			if (streamedText) {
				emitAgentEvent(listeners, input.sessionId, {
					type: "content_end",
					contentType: "text",
				});
			}
			const agentResult = toAgentResult(result, config);
			const baseline =
				accumulatedUsageBySession.get(input.sessionId) ??
				createInitialAccumulatedUsage();
			const accumulatedUsage = accumulateUsageTotals(
				baseline,
				agentResult.usage,
			);
			accumulatedUsageBySession.set(input.sessionId, accumulatedUsage);
			emitAgentEvent(listeners, input.sessionId, {
				type: "done",
				reason: result.finishReason,
				iterations: result.iterations,
				usage: accumulatedUsage,
			} as unknown as AgentEvent);
			return agentResult;
		},
		getAccumulatedUsage: async (sessionId) => {
			const usage = accumulatedUsageBySession.get(sessionId);
			return usage ? { ...usage } : undefined;
		},
		readMessages: async (sessionId) => {
			const row = await client.getSession(sessionId);
			const path = row?.messagesPath?.trim();
			if (!path || !existsSync(path)) {
				return [];
			}
			try {
				const raw = readFileSync(path, "utf8");
				if (!raw.trim()) {
					return [];
				}
				const parsed = JSON.parse(raw) as { messages?: unknown[] } | unknown[];
				const messages = Array.isArray(parsed)
					? parsed
					: Array.isArray(parsed.messages)
						? parsed.messages
						: [];
				return messages as LlmsProviders.Message[];
			} catch {
				return [];
			}
		},
		abort: async (sessionId) => {
			await client.abortRuntimeSession(sessionId);
		},
		stop: async (sessionId) => {
			sessionLogger.debug?.("stop() called", { sessionId });
			try {
				await client.stopRuntimeSession(sessionId);
			} catch (error) {
				if (
					!isUnimplementedRpcMethodError(error) &&
					!isSessionNotFoundError(error)
				) {
					throw error;
				}
			}
			sessionConfigs.delete(sessionId);
			accumulatedUsageBySession.delete(sessionId);
		},
		dispose: async () => {
			sessionLogger.debug?.("dispose() called", {
				sessionCount: sessionConfigs.size,
				sessions: [...sessionConfigs.keys()],
			});
			const sessionIds = [...sessionConfigs.keys()];
			await Promise.allSettled(
				sessionIds.map(async (sessionId) => {
					try {
						await client.stopRuntimeSession(sessionId);
					} catch {
						// Best-effort cleanup.
					}
					try {
						await rpcSessions.updateSessionStatus(sessionId, "cancelled", null);
					} catch {
						// Best-effort cleanup.
					}
					sessionConfigs.delete(sessionId);
					accumulatedUsageBySession.delete(sessionId);
				}),
			);
			accumulatedUsageBySession.clear();
			client.close();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		updateSessionModel: async (sessionId, modelId) => {
			const config = sessionConfigs.get(sessionId);
			if (!config) {
				throw new Error(`session not found: ${sessionId}`);
			}
			config.model = modelId;
		},
	};
}

export async function listSessions(limit = 200): Promise<unknown[]> {
	return await (await getCoreSessions()).listSessions(limit);
}

export async function deleteSession(
	sessionId: string,
): Promise<{ deleted: boolean }> {
	return await (await getCoreSessions()).deleteSession(sessionId);
}

export async function updateSession(
	sessionId: string,
	updates: {
		prompt?: string | null;
		metadata?: Record<string, unknown> | null;
		title?: string | null;
	},
): Promise<{ updated: boolean }> {
	return await (await getCoreSessions()).updateSession({
		sessionId,
		...updates,
	});
}
