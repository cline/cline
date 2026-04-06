import {
	type AgentHooks,
	CoreSessionService,
	createPersistentSubprocessHooks,
	DefaultSessionManager,
	type LlmsProviders,
	type PersistentSubprocessHookControl,
	SqliteSessionStore,
} from "@clinebot/core";
import { type RpcRuntimeHandlers, RpcSessionClient } from "@clinebot/rpc";
import {
	CLINE_DEFAULT_RPC_ADDRESS,
	createSessionId,
	type HookSessionContext,
	type HookSessionContextLookup,
} from "@clinebot/shared";
import {
	createCliLoggerAdapter,
	flushCliLoggerAdapters,
} from "../logging/adapter";
import { logSpawnedProcess } from "../logging/process";
import {
	buildCliSubcommandCommand,
	buildInternalCliEnv,
} from "../utils/internal-launch";
import {
	createRpcToolApprovalRequester,
	subscribeRuntimeEventBridge,
} from "./rpc-runtime/event-bridge";
import {
	runProviderAction,
	runProviderOAuthLogin,
} from "./rpc-runtime/provider-actions";
import {
	applyHomeDir,
	buildSessionStartInput,
	cleanupMaterializedFiles,
	materializeUserFiles,
	parseSendPayload,
	parseStartPayload,
	shouldRestoreSession,
	toRpcTurnResult,
} from "./rpc-runtime/session-helpers";

const RPC_RUNTIME_NAME = "rpc-runtime";
const moduleLogger = createCliLoggerAdapter({
	runtime: RPC_RUNTIME_NAME,
	component: "rpc-runtime",
}).core;

type HookRunStartContext = Parameters<NonNullable<AgentHooks["onRunStart"]>>[0];
type HookSessionShutdownContext = Parameters<
	NonNullable<AgentHooks["onSessionShutdown"]>
>[0];

function getHookWorkerCommand(): string[] | undefined {
	const command = buildCliSubcommandCommand("hook-worker");
	return command ? [command.launcher, ...command.childArgs] : undefined;
}

class RpcRuntimeHookService {
	private readonly logger = createCliLoggerAdapter({
		runtime: RPC_RUNTIME_NAME,
		component: "hooks",
	}).core;
	private readonly rootHookPaths = new Map<string, string>();
	private readonly agentRoots = new Map<string, string>();
	private readonly conversationRoots = new Map<string, string>();
	private readonly rootMembers = new Map<
		string,
		{ agents: Set<string>; conversations: Set<string> }
	>();
	private readonly control?: PersistentSubprocessHookControl;
	public readonly hooks?: AgentHooks;

	constructor() {
		const command = getHookWorkerCommand();
		if (!command) {
			return;
		}
		this.control = createPersistentSubprocessHooks({
			command,
			cwd: process.cwd(),
			env: buildInternalCliEnv("hook-worker"),
			sessionContext: (input) => this.resolveSessionContext(input),
			onDispatchError: (error, payload) => {
				this.logger.warn?.("RPC hook dispatch failed", {
					error,
					hookName: payload.hookName,
					taskId: payload.taskId,
					agentId: payload.agent_id,
				});
			},
			onSpawn: ({ command: spawnedCommand, pid, detached }) => {
				logSpawnedProcess({
					component: "hooks",
					command: spawnedCommand,
					childPid: pid,
					detached,
					cwd: process.cwd(),
					metadata: { runtime: RPC_RUNTIME_NAME },
				});
			},
		});
		this.hooks = this.wrapHooks(this.control.hooks);
	}

	public registerSession(sessionId: string, hookPath: string): void {
		const normalizedSessionId = sessionId.trim();
		const normalizedHookPath = hookPath.trim();
		if (!normalizedSessionId || !normalizedHookPath) {
			return;
		}
		this.rootHookPaths.set(normalizedSessionId, normalizedHookPath);
		this.conversationRoots.set(normalizedSessionId, normalizedSessionId);
		this.membersForRoot(normalizedSessionId).conversations.add(
			normalizedSessionId,
		);
	}

	public unregisterSession(sessionId: string): void {
		const normalizedSessionId = sessionId.trim();
		if (!normalizedSessionId) {
			return;
		}
		this.rootHookPaths.delete(normalizedSessionId);
		this.clearRoot(normalizedSessionId);
	}

	public async shutdown(): Promise<void> {
		this.rootHookPaths.clear();
		this.agentRoots.clear();
		this.conversationRoots.clear();
		this.rootMembers.clear();
		await this.control?.client.close();
	}

	private wrapHooks(hooks: AgentHooks): AgentHooks {
		return {
			...hooks,
			onSessionStart: async (ctx) => {
				this.trackContext(ctx);
				return await hooks.onSessionStart?.(ctx);
			},
			onRunStart: async (ctx) => {
				this.trackContext(ctx);
				return await hooks.onRunStart?.(ctx);
			},
			onSessionShutdown: async (ctx) => {
				this.trackContext(ctx);
				try {
					return await hooks.onSessionShutdown?.(ctx);
				} finally {
					this.releaseContext(ctx);
				}
			},
		};
	}

	private resolveSessionContext(
		input?: HookSessionContextLookup,
	): HookSessionContext | undefined {
		const rootSessionId = this.resolveRootSessionId(input);
		if (!rootSessionId) {
			return undefined;
		}
		return {
			rootSessionId,
			hookLogPath: this.rootHookPaths.get(rootSessionId),
		};
	}

	private resolveRootSessionId(
		input?: HookSessionContextLookup,
	): string | undefined {
		const conversationId = input?.conversationId?.trim();
		const agentId = input?.agentId?.trim();
		const parentAgentId = input?.parentAgentId?.trim();
		if (conversationId) {
			const rootFromConversation = this.conversationRoots.get(conversationId);
			if (rootFromConversation) {
				return rootFromConversation;
			}
			if (this.rootHookPaths.has(conversationId)) {
				return conversationId;
			}
		}
		if (agentId) {
			const rootFromAgent = this.agentRoots.get(agentId);
			if (rootFromAgent) {
				return rootFromAgent;
			}
		}
		if (parentAgentId) {
			return this.agentRoots.get(parentAgentId);
		}
		return undefined;
	}

	private trackContext(
		ctx: Pick<
			HookRunStartContext,
			"agentId" | "conversationId" | "parentAgentId"
		>,
	): void {
		const agentId = ctx.agentId.trim();
		const conversationId = ctx.conversationId.trim();
		const rootSessionId =
			this.resolveRootSessionId({
				agentId,
				conversationId,
				parentAgentId: ctx.parentAgentId,
			}) ?? (!ctx.parentAgentId ? conversationId : undefined);
		if (!rootSessionId) {
			return;
		}
		if (agentId) {
			this.agentRoots.set(agentId, rootSessionId);
			this.membersForRoot(rootSessionId).agents.add(agentId);
		}
		if (conversationId) {
			this.conversationRoots.set(conversationId, rootSessionId);
			this.membersForRoot(rootSessionId).conversations.add(conversationId);
		}
	}

	private releaseContext(ctx: HookSessionShutdownContext): void {
		const agentId = ctx.agentId.trim();
		const conversationId = ctx.conversationId.trim();
		const rootSessionId =
			this.resolveRootSessionId({
				agentId,
				conversationId,
				parentAgentId: ctx.parentAgentId,
			}) ?? conversationId;
		if (!rootSessionId) {
			return;
		}
		if (ctx.parentAgentId) {
			if (agentId) {
				this.agentRoots.delete(agentId);
				this.rootMembers.get(rootSessionId)?.agents.delete(agentId);
			}
			if (conversationId) {
				this.conversationRoots.delete(conversationId);
				this.rootMembers
					.get(rootSessionId)
					?.conversations.delete(conversationId);
			}
			return;
		}
		this.rootHookPaths.delete(rootSessionId);
		this.clearRoot(rootSessionId);
	}

	private membersForRoot(rootSessionId: string): {
		agents: Set<string>;
		conversations: Set<string>;
	} {
		let members = this.rootMembers.get(rootSessionId);
		if (!members) {
			members = {
				agents: new Set<string>(),
				conversations: new Set<string>(),
			};
			this.rootMembers.set(rootSessionId, members);
		}
		return members;
	}

	private clearRoot(rootSessionId: string): void {
		const members = this.rootMembers.get(rootSessionId);
		if (members) {
			for (const agentId of members.agents) {
				this.agentRoots.delete(agentId);
			}
			for (const conversationId of members.conversations) {
				this.conversationRoots.delete(conversationId);
			}
			this.rootMembers.delete(rootSessionId);
			return;
		}
		this.conversationRoots.delete(rootSessionId);
	}
}

export function createRpcRuntimeHandlers(): RpcRuntimeHandlers {
	const RPC_SESSION_COMPONENT = "rpc-runtime-session";
	const processId = process.pid.toString();
	const sessionManager = new DefaultSessionManager({
		sessionService: new CoreSessionService(new SqliteSessionStore()),
	});
	const hookService = new RpcRuntimeHookService();
	const sessionModes = new Map<string, "act" | "plan">();
	const activeSessions = new Set<string>();
	const rpcAddress =
		process.env.CLINE_RPC_ADDRESS?.trim() || CLINE_DEFAULT_RPC_ADDRESS;
	const eventClient = new RpcSessionClient({ address: rpcAddress });
	const runtimeClientId = `cli-rpc-runtime-${processId}`;
	const unsubscribeEventBridge = subscribeRuntimeEventBridge({
		sessionManager,
		eventClient,
	});
	const cleanupFailedSession = async (
		sessionId: string,
		runtimeLogger: ReturnType<typeof createCliLoggerAdapter>["core"],
		reason: string,
	): Promise<void> => {
		try {
			await sessionManager.stop(sessionId);
		} catch (stopError) {
			runtimeLogger.warn?.("RPC runtime failed-session cleanup errored", {
				sessionId,
				reason,
				error: stopError,
			});
		} finally {
			activeSessions.delete(sessionId);
			sessionModes.delete(sessionId);
			hookService.unregisterSession(sessionId);
		}
	};
	const stopTrackedSessions = async (
		shutdownReason: "rpc_runtime_dispose" | "rpc_runtime_shutdown",
	): Promise<void> => {
		const sessionIds = [...activeSessions];
		await Promise.allSettled(
			sessionIds.map(async (sessionId) => {
				try {
					await sessionManager.abort(
						sessionId,
						new Error(`RPC runtime abort during ${shutdownReason}`),
					);
				} catch {
					// Best-effort abort before stop.
				}
				try {
					await sessionManager.stop(sessionId);
				} catch {
					// Best-effort stop during runtime teardown.
				}
			}),
		);
		if (shutdownReason === "rpc_runtime_shutdown") {
			activeSessions.clear();
			sessionModes.clear();
		}
	};

	return {
		startSession: async (request) => {
			const config = parseStartPayload(request);
			applyHomeDir(config);
			const runtimeLogger = createCliLoggerAdapter({
				runtime: RPC_RUNTIME_NAME,
				component: RPC_SESSION_COMPONENT,
				runtimeConfig: config.logger,
			}).core;
			const sessionId = config.sessionId?.trim() || createSessionId();
			const startedConfig = await buildSessionStartInput({
				config,
				sessionId,
				initialMessages: config.initialMessages as
					| LlmsProviders.Message[]
					| undefined,
				hooks: hookService.hooks,
			});
			startedConfig.sessionInput.requestToolApproval =
				createRpcToolApprovalRequester({
					eventClient,
					runtimeClientId,
					sessionId,
				});
			const started = await sessionManager.start(startedConfig.sessionInput);
			runtimeLogger.info?.("RPC runtime session started", {
				sessionId: started.sessionId,
				mode: startedConfig.mode,
			});
			hookService.registerSession(started.sessionId, started.hookPath);
			sessionModes.set(started.sessionId, startedConfig.mode);
			activeSessions.add(started.sessionId);
			return {
				sessionId: started.sessionId,
				startResult: {
					sessionId: started.sessionId,
					manifestPath: started.manifestPath,
					transcriptPath: started.transcriptPath,
					hookPath: started.hookPath,
					messagesPath: started.messagesPath,
				},
			};
		},
		sendSession: async (sessionId, requestInput) => {
			moduleLogger.debug?.("sendSession called", {
				sessionId,
				activeSessions: [...activeSessions],
			});
			const request = parseSendPayload(requestInput);
			applyHomeDir(request.config);
			const runtimeLogger = createCliLoggerAdapter({
				runtime: RPC_RUNTIME_NAME,
				component: RPC_SESSION_COMPONENT,
				runtimeConfig: request.config.logger,
			}).core;
			const input = request.prompt.trim();
			const userImages = request.attachments?.userImages ?? [];
			const fileMaterialized = await materializeUserFiles(
				request.attachments?.userFiles,
			);

			try {
				runtimeLogger.debug?.("RPC runtime turn send requested", {
					sessionId,
					promptLength: input.length,
				});
				const result = await sessionManager.send({
					sessionId,
					prompt: input,
					userImages,
					userFiles: fileMaterialized.paths,
					delivery: request.delivery,
				});
				if (!result) {
					return { queued: true };
				}
				runtimeLogger.info?.("RPC runtime turn send completed", {
					sessionId,
					finishReason: result.finishReason,
					iterations: result.iterations,
				});
				return { result: toRpcTurnResult(result) };
			} catch (error) {
				if (!shouldRestoreSession(error)) {
					runtimeLogger.error?.("RPC runtime turn send failed", { error });
					await cleanupFailedSession(
						sessionId,
						runtimeLogger,
						"send_failed_non_restorable",
					);
					throw error;
				}

				const restoredConfig = await buildSessionStartInput({
					config: request.config,
					sessionId,
					initialMessages: request.messages as unknown as
						| LlmsProviders.Message[]
						| undefined,
					hooks: hookService.hooks,
				});
				const restoredStarted = await sessionManager.start(
					restoredConfig.sessionInput,
				);
				hookService.registerSession(
					restoredStarted.sessionId,
					restoredStarted.hookPath,
				);
				runtimeLogger.warn?.(
					"RPC runtime session restored after missing session",
					{
						sessionId,
					},
				);
				sessionModes.set(sessionId, restoredConfig.mode);
				activeSessions.add(sessionId);
				const restoredResult = await (async () => {
					try {
						return await sessionManager.send({
							sessionId,
							prompt: input,
							userImages,
							userFiles: fileMaterialized.paths,
							delivery: request.delivery,
						});
					} catch (restoredError) {
						runtimeLogger.error?.(
							"RPC runtime turn send failed after restore",
							{
								error: restoredError,
							},
						);
						await cleanupFailedSession(
							sessionId,
							runtimeLogger,
							"send_failed_after_restore",
						);
						throw restoredError;
					}
				})();
				if (!restoredResult) {
					await cleanupFailedSession(
						sessionId,
						runtimeLogger,
						"send_missing_result_after_restore",
					);
					throw new Error("runtime send returned no result after restore");
				}
				runtimeLogger.info?.("RPC runtime turn completed after restore", {
					sessionId,
					finishReason: restoredResult.finishReason,
					iterations: restoredResult.iterations,
				});
				return { result: toRpcTurnResult(restoredResult) };
			} finally {
				flushCliLoggerAdapters();
				await cleanupMaterializedFiles(fileMaterialized.tempDir);
			}
		},
		abortSession: async (sessionId) => {
			const id = sessionId.trim();
			if (!id) {
				return { applied: false };
			}
			const known = activeSessions.has(id);
			await sessionManager.abort(
				id,
				new Error("RPC runtime abortSession requested"),
			);
			createCliLoggerAdapter({
				runtime: RPC_RUNTIME_NAME,
				component: RPC_SESSION_COMPONENT,
			}).core.info?.("RPC runtime session abort requested", {
				sessionId: id,
				known,
			});
			return { applied: known };
		},
		stopSession: async (sessionId) => {
			const id = sessionId.trim();
			if (!id) {
				return { applied: false };
			}
			const known = activeSessions.has(id);
			await sessionManager.stop(id);
			createCliLoggerAdapter({
				runtime: RPC_RUNTIME_NAME,
				component: RPC_SESSION_COMPONENT,
			}).core.info?.("RPC runtime session stopped", {
				sessionId: id,
				known,
			});
			flushCliLoggerAdapters();
			activeSessions.delete(id);
			sessionModes.delete(id);
			hookService.unregisterSession(id);
			return { applied: known };
		},
		runProviderAction: async (request) => runProviderAction(request),
		runProviderOAuthLogin: async (provider) => runProviderOAuthLogin(provider),
		dispose: async () => {
			unsubscribeEventBridge();
			await stopTrackedSessions("rpc_runtime_shutdown");
			await sessionManager.dispose("rpc_runtime_shutdown");
			await hookService.shutdown();
			flushCliLoggerAdapters();
			activeSessions.clear();
			sessionModes.clear();
			eventClient.close();
		},
	};
}
