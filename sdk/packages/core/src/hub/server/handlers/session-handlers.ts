import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	JsonValue,
	ToolApprovalRequest,
} from "@clinebot/shared";
import type { RuntimeSessionConfig } from "../../../runtime/host/runtime-host";
import {
	applyCheckpointToWorktree,
	createCheckpointRestorePlan,
} from "../../../session/checkpoint-restore";
import {
	createCapabilityBackedToolExecutors,
	isHubToolExecutorName,
	parseRuntimeConfigExtensions,
	toHubSessionRecord,
} from "../helpers";
import {
	asPlainRecord,
	ensureSessionState,
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
	readHubSessionRecord,
} from "./context";

export async function handleSessionCreate(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	requestToolApproval: (
		request: ToolApprovalRequest,
	) => Promise<{ approved: boolean; reason?: string }>,
): Promise<HubReplyEnvelope> {
	const payload =
		envelope.payload && typeof envelope.payload === "object"
			? envelope.payload
			: {};
	const metadata =
		payload.metadata && typeof payload.metadata === "object"
			? JSON.parse(JSON.stringify(payload.metadata))
			: {};
	const sessionConfig =
		payload.sessionConfig && typeof payload.sessionConfig === "object"
			? (JSON.parse(
					JSON.stringify(payload.sessionConfig),
				) as Partial<RuntimeSessionConfig>)
			: undefined;
	const runtimeOptions =
		payload.runtimeOptions && typeof payload.runtimeOptions === "object"
			? (payload.runtimeOptions as Record<string, unknown>)
			: {};
	if (typeof sessionConfig?.mode === "string") {
		metadata.mode = sessionConfig.mode;
	} else if (typeof runtimeOptions.mode === "string") {
		metadata.mode = runtimeOptions.mode;
	}
	if (typeof sessionConfig?.systemPrompt === "string") {
		metadata.systemPrompt = sessionConfig.systemPrompt;
	} else if (typeof runtimeOptions.systemPrompt === "string") {
		metadata.systemPrompt = runtimeOptions.systemPrompt;
	}
	if (sessionConfig?.checkpoint?.enabled === true) {
		metadata.checkpointEnabled = true;
	} else if (runtimeOptions.checkpointEnabled === true) {
		metadata.checkpointEnabled = true;
	}
	const modelSelection =
		payload.modelSelection && typeof payload.modelSelection === "object"
			? (payload.modelSelection as Record<string, unknown>)
			: {};
	const workspaceRoot =
		typeof payload.workspaceRoot === "string" && payload.workspaceRoot.trim()
			? payload.workspaceRoot.trim()
			: typeof payload.cwd === "string" && payload.cwd.trim()
				? payload.cwd.trim()
				: "";
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_session_create",
			"session.create requires workspaceRoot or cwd",
		);
	}
	const clientId = envelope.clientId?.trim() || "hub-client";
	const advertisedToolExecutors = Array.isArray(runtimeOptions.toolExecutors)
		? runtimeOptions.toolExecutors.filter(isHubToolExecutorName)
		: [];
	const configExtensions = parseRuntimeConfigExtensions(
		runtimeOptions.configExtensions,
	);
	const started = await ctx.sessionHost.start({
		source: typeof metadata.source === "string" ? metadata.source : undefined,
		interactive: metadata.interactive !== false,
		sessionMetadata:
			Object.keys(metadata as Record<string, unknown>).length > 0
				? (metadata as Record<string, unknown>)
				: undefined,
		initialMessages: Array.isArray(payload.initialMessages)
			? (payload.initialMessages as never[])
			: undefined,
		localRuntime: {
			modelCatalogDefaults: {
				loadLatestOnInit: true,
				loadPrivateOnAuth: true,
			},
			configExtensions,
			defaultToolExecutors: createCapabilityBackedToolExecutors(
				clientId,
				advertisedToolExecutors,
				ctx.requestCapability,
			),
		},
		requestToolApproval,
		config: {
			...(sessionConfig ?? {}),
			providerId:
				sessionConfig?.providerId ??
				(typeof modelSelection.provider === "string"
					? modelSelection.provider
					: typeof metadata.provider === "string"
						? metadata.provider
						: "hub"),
			modelId:
				sessionConfig?.modelId ??
				(typeof modelSelection.model === "string"
					? modelSelection.model
					: typeof metadata.model === "string"
						? metadata.model
						: "hub"),
			apiKey:
				sessionConfig?.apiKey ??
				(typeof modelSelection.apiKey === "string"
					? modelSelection.apiKey
					: undefined),
			cwd:
				sessionConfig?.cwd ??
				(typeof payload.cwd === "string" && payload.cwd.trim()
					? payload.cwd.trim()
					: workspaceRoot),
			workspaceRoot: sessionConfig?.workspaceRoot ?? workspaceRoot,
			systemPrompt:
				sessionConfig?.systemPrompt ??
				(typeof runtimeOptions.systemPrompt === "string"
					? runtimeOptions.systemPrompt
					: ""),
			mode:
				sessionConfig?.mode ??
				(runtimeOptions.mode === "plan" || runtimeOptions.mode === "yolo"
					? runtimeOptions.mode
					: "act"),
			maxIterations:
				sessionConfig?.maxIterations ??
				(typeof runtimeOptions.maxIterations === "number"
					? runtimeOptions.maxIterations
					: undefined),
			enableTools:
				sessionConfig?.enableTools ?? runtimeOptions.enableTools !== false,
			enableSpawnAgent:
				sessionConfig?.enableSpawnAgent ?? runtimeOptions.enableSpawn !== false,
			enableAgentTeams:
				sessionConfig?.enableAgentTeams ?? runtimeOptions.enableTeams !== false,
			checkpoint:
				sessionConfig?.checkpoint ??
				(runtimeOptions.checkpointEnabled === true
					? { enabled: true }
					: undefined),
			teamName:
				sessionConfig?.teamName ??
				(typeof metadata.teamName === "string" ? metadata.teamName : undefined),
		},
		toolPolicies:
			payload.toolPolicies &&
			typeof payload.toolPolicies === "object" &&
			!Array.isArray(payload.toolPolicies)
				? (JSON.parse(JSON.stringify(payload.toolPolicies)) as Record<
						string,
						{ autoApprove?: boolean; enabled?: boolean }
					>)
				: runtimeOptions.autoApproveTools === true
					? { "*": { autoApprove: true } }
					: undefined,
	});
	ensureSessionState(ctx, started.sessionId, clientId, "creator", {
		interactive: metadata.interactive !== false,
	});
	const session = await readHubSessionRecord(ctx, started.sessionId);
	if (session) {
		ctx.publish(
			ctx.buildEvent("session.created", { session }, started.sessionId),
		);
	}
	return okReply(envelope, { session });
}

export async function handleSessionRestore(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	requestToolApproval: (
		request: ToolApprovalRequest,
	) => Promise<{ approved: boolean; reason?: string }>,
): Promise<HubReplyEnvelope> {
	const payload =
		envelope.payload && typeof envelope.payload === "object"
			? envelope.payload
			: {};
	const sourceSessionId =
		typeof payload.sessionId === "string"
			? payload.sessionId.trim()
			: envelope.sessionId?.trim() || "";
	const checkpointRunCount = payload.checkpointRunCount;
	if (!sourceSessionId) {
		return errorReply(
			envelope,
			"invalid_restore",
			"session.restore requires a session id",
		);
	}
	const restoreOptions =
		payload.restore && typeof payload.restore === "object"
			? (payload.restore as Record<string, unknown>)
			: {};
	const restoreMessages = restoreOptions.messages !== false;
	const restoreWorkspace = restoreOptions.workspace !== false;
	if (!restoreMessages && !restoreWorkspace) {
		return errorReply(
			envelope,
			"invalid_restore",
			"restore.messages or restore.workspace must be true",
		);
	}
	if (
		typeof checkpointRunCount !== "number" ||
		!Number.isInteger(checkpointRunCount) ||
		checkpointRunCount < 1
	) {
		return errorReply(
			envelope,
			"invalid_restore",
			"checkpointRunCount must be a positive integer",
		);
	}
	const sourceSession = await ctx.sessionHost.get(sourceSessionId);
	if (!sourceSession) {
		return errorReply(
			envelope,
			"session_not_found",
			`Unknown session: ${sourceSessionId}`,
		);
	}
	const sourceMessages = restoreMessages
		? await ctx.sessionHost.readMessages(sourceSessionId)
		: undefined;
	if (restoreMessages && sourceMessages?.length === 0) {
		return errorReply(
			envelope,
			"session_messages_not_found",
			`No messages found for session ${sourceSessionId}`,
		);
	}

	try {
		const sessionConfig =
			payload.sessionConfig && typeof payload.sessionConfig === "object"
				? (JSON.parse(
						JSON.stringify(payload.sessionConfig),
					) as Partial<RuntimeSessionConfig>)
				: undefined;
		if (restoreMessages && !sessionConfig) {
			return errorReply(
				envelope,
				"invalid_restore",
				"sessionConfig is required when restore.messages is true",
			);
		}
		const runtimeOptions =
			payload.runtimeOptions && typeof payload.runtimeOptions === "object"
				? (payload.runtimeOptions as Record<string, unknown>)
				: {};
		const restoreCwd =
			(typeof sessionConfig?.cwd === "string" && sessionConfig.cwd.trim()) ||
			(typeof sessionConfig?.workspaceRoot === "string" &&
				sessionConfig.workspaceRoot.trim()) ||
			sourceSession.cwd ||
			sourceSession.workspaceRoot;
		const plan = createCheckpointRestorePlan({
			session: sourceSession,
			messages: sourceMessages,
			checkpointRunCount,
			cwd: restoreCwd,
			restoreMessages,
		});
		if (restoreWorkspace) {
			await applyCheckpointToWorktree(plan.cwd, plan.checkpoint);
		}
		if (!restoreMessages) {
			return okReply(envelope, { checkpoint: plan.checkpoint });
		}

		const metadata =
			payload.metadata && typeof payload.metadata === "object"
				? JSON.parse(JSON.stringify(payload.metadata))
				: {};
		if (typeof sessionConfig?.mode === "string") {
			metadata.mode = sessionConfig.mode;
		} else if (typeof runtimeOptions.mode === "string") {
			metadata.mode = runtimeOptions.mode;
		}
		if (typeof sessionConfig?.systemPrompt === "string") {
			metadata.systemPrompt = sessionConfig.systemPrompt;
		} else if (typeof runtimeOptions.systemPrompt === "string") {
			metadata.systemPrompt = runtimeOptions.systemPrompt;
		}
		if (sessionConfig?.checkpoint?.enabled === true) {
			metadata.checkpointEnabled = true;
		} else if (runtimeOptions.checkpointEnabled === true) {
			metadata.checkpointEnabled = true;
		}

		const modelSelection =
			payload.modelSelection && typeof payload.modelSelection === "object"
				? (payload.modelSelection as Record<string, unknown>)
				: {};
		const workspaceRoot =
			typeof payload.workspaceRoot === "string" && payload.workspaceRoot.trim()
				? payload.workspaceRoot.trim()
				: typeof payload.cwd === "string" && payload.cwd.trim()
					? payload.cwd.trim()
					: sourceSession.workspaceRoot || sourceSession.cwd;
		const clientId = envelope.clientId?.trim() || "hub-client";
		const advertisedToolExecutors = Array.isArray(runtimeOptions.toolExecutors)
			? runtimeOptions.toolExecutors.filter(isHubToolExecutorName)
			: [];
		const configExtensions = parseRuntimeConfigExtensions(
			runtimeOptions.configExtensions,
		);
		const started = await ctx.sessionHost.start({
			source: typeof metadata.source === "string" ? metadata.source : undefined,
			interactive: metadata.interactive !== false,
			sessionMetadata: {
				...metadata,
				restoredFromSessionId: sourceSessionId,
				restoredCheckpointRunCount: checkpointRunCount,
			},
			initialMessages: plan.messages ?? [],
			localRuntime: {
				modelCatalogDefaults: {
					loadLatestOnInit: true,
					loadPrivateOnAuth: true,
				},
				configExtensions,
				defaultToolExecutors:
					advertisedToolExecutors.length > 0
						? createCapabilityBackedToolExecutors(
								clientId,
								advertisedToolExecutors,
								ctx.requestCapability,
							)
						: undefined,
			},
			requestToolApproval,
			config: {
				...(sessionConfig ?? {}),
				providerId:
					sessionConfig?.providerId ??
					(typeof modelSelection.provider === "string"
						? modelSelection.provider
						: sourceSession.provider),
				modelId:
					sessionConfig?.modelId ??
					(typeof modelSelection.model === "string"
						? modelSelection.model
						: sourceSession.model),
				apiKey:
					sessionConfig?.apiKey ??
					(typeof modelSelection.apiKey === "string"
						? modelSelection.apiKey
						: ""),
				cwd: sessionConfig?.cwd ?? plan.cwd,
				workspaceRoot: sessionConfig?.workspaceRoot ?? workspaceRoot,
				systemPrompt:
					sessionConfig?.systemPrompt ??
					(typeof runtimeOptions.systemPrompt === "string"
						? runtimeOptions.systemPrompt
						: ""),
				mode:
					sessionConfig?.mode ??
					(runtimeOptions.mode === "plan" || runtimeOptions.mode === "yolo"
						? runtimeOptions.mode
						: "act"),
				maxIterations:
					sessionConfig?.maxIterations ??
					(typeof runtimeOptions.maxIterations === "number"
						? runtimeOptions.maxIterations
						: undefined),
				enableTools:
					sessionConfig?.enableTools ?? runtimeOptions.enableTools !== false,
				enableSpawnAgent:
					sessionConfig?.enableSpawnAgent ??
					runtimeOptions.enableSpawn !== false,
				enableAgentTeams:
					sessionConfig?.enableAgentTeams ??
					runtimeOptions.enableTeams !== false,
				checkpoint:
					sessionConfig?.checkpoint ??
					(runtimeOptions.checkpointEnabled === true
						? { enabled: true }
						: undefined),
				teamName:
					sessionConfig?.teamName ??
					(typeof metadata.teamName === "string"
						? metadata.teamName
						: undefined),
			},
			toolPolicies:
				payload.toolPolicies &&
				typeof payload.toolPolicies === "object" &&
				!Array.isArray(payload.toolPolicies)
					? (JSON.parse(JSON.stringify(payload.toolPolicies)) as Record<
							string,
							{ autoApprove?: boolean; enabled?: boolean }
						>)
					: runtimeOptions.autoApproveTools === true
						? { "*": { autoApprove: true } }
						: undefined,
		});
		ensureSessionState(ctx, started.sessionId, clientId, "creator", {
			interactive: metadata.interactive !== false,
		});
		const session = await readHubSessionRecord(ctx, started.sessionId);
		if (session) {
			ctx.publish(
				ctx.buildEvent("session.created", { session }, started.sessionId),
			);
		}
		return okReply(envelope, {
			session,
			messages: plan.messages ?? [],
			checkpoint: plan.checkpoint,
		});
	} catch (error) {
		return errorReply(
			envelope,
			"restore_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export async function handleSessionAttach(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	if (!sessionId) {
		return errorReply(
			envelope,
			"invalid_session_attach",
			"session.attach requires a session id",
		);
	}
	ensureSessionState(
		ctx,
		sessionId,
		envelope.clientId?.trim() || "hub-client",
		"participant",
	);
	const session = await readHubSessionRecord(ctx, sessionId);
	if (session) {
		ctx.publish(ctx.buildEvent("session.attached", { session }, sessionId));
	}
	return session
		? okReply(envelope, { session })
		: errorReply(
				envelope,
				"session_not_found",
				`Unknown session: ${sessionId}`,
			);
}

export async function handleSessionDetach(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	if (!sessionId) {
		return errorReply(
			envelope,
			"invalid_session_detach",
			"session.detach requires a session id",
		);
	}
	const clientId = envelope.clientId?.trim() || "hub-client";
	const state = ctx.sessionState.get(sessionId);
	if (state) {
		state.participants.delete(clientId);
		if (state.participants.size === 0) {
			ctx.sessionState.delete(sessionId);
		}
	}
	const session = await readHubSessionRecord(ctx, sessionId);
	ctx.publish(
		ctx.buildEvent(
			"session.detached",
			session ? { session, clientId } : { clientId },
			sessionId,
		),
	);
	return okReply(envelope);
}

export async function handleSessionGet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const session = await readHubSessionRecord(ctx, sessionId);
	return session
		? okReply(envelope, { session })
		: errorReply(
				envelope,
				"session_not_found",
				`Unknown session: ${sessionId}`,
			);
}

export async function handleSessionMessages(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	if (!sessionId) {
		return errorReply(
			envelope,
			"invalid_session_id",
			"session.messages requires a session id",
		);
	}
	const session = await readHubSessionRecord(ctx, sessionId);
	if (!session) {
		return errorReply(
			envelope,
			"session_not_found",
			`Unknown session: ${sessionId}`,
		);
	}
	const messages = await ctx.sessionHost.readMessages(sessionId);
	return okReply(envelope, { sessionId, messages });
}

export async function handleSessionList(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const limit =
		typeof envelope.payload?.limit === "number" ? envelope.payload.limit : 200;
	const sessions = (await ctx.sessionHost.list(limit)).map((session) =>
		toHubSessionRecord(session, ctx.sessionState.get(session.sessionId)),
	);
	return okReply(envelope, { sessions });
}

export async function handleSessionUpdate(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const metadata = asPlainRecord(envelope.payload?.metadata);
	const updated = await ctx.sessionHost.update(sessionId, { metadata });
	const session = await readHubSessionRecord(ctx, sessionId);
	if (session) {
		ctx.publish(ctx.buildEvent("session.updated", { session }, sessionId));
	}
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: updated.updated,
		payload: { updated: updated.updated, session },
	};
}

export async function handleSessionDelete(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const deleted = await ctx.sessionHost.delete(sessionId);
	ctx.sessionState.delete(sessionId);
	return okReply(envelope, { deleted });
}

export async function handleSessionPendingPrompts(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const prompts = await ctx.sessionHost.pendingPrompts("list", { sessionId });
	return okReply(envelope, { sessionId, prompts });
}

export async function handleSessionUpdatePendingPrompt(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const promptId =
		typeof envelope.payload?.promptId === "string"
			? envelope.payload.promptId.trim()
			: "";
	const prompt =
		typeof envelope.payload?.prompt === "string"
			? envelope.payload.prompt
			: undefined;
	const delivery =
		envelope.payload?.delivery === "queue" ||
		envelope.payload?.delivery === "steer"
			? envelope.payload.delivery
			: undefined;
	const result = await ctx.sessionHost.pendingPrompts("update", {
		sessionId,
		promptId,
		prompt,
		delivery,
	});
	return okReply(
		envelope,
		result as unknown as Record<string, JsonValue | undefined>,
	);
}

export async function handleSessionRemovePendingPrompt(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const promptId =
		typeof envelope.payload?.promptId === "string"
			? envelope.payload.promptId.trim()
			: "";
	const result = await ctx.sessionHost.pendingPrompts("delete", {
		sessionId,
		promptId,
	});
	return okReply(
		envelope,
		result as unknown as Record<string, JsonValue | undefined>,
	);
}
