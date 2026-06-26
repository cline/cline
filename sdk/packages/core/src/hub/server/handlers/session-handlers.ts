import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	JsonValue,
	ToolApprovalRequest,
} from "@cline/shared";
import { createSessionId, parseRuntimeConfigExtensions } from "@cline/shared";
import type { RuntimeSessionConfig } from "../../../runtime/host/runtime-host";
import { parseSessionCompactionState } from "../../../session/models/session-compaction";
import {
	SessionVersioningError,
	SessionVersioningService,
} from "../../../session/session-versioning-service";
import {
	createHubClientContributionRuntime,
	parseHubClientContributions,
} from "../hub-client-contributions";
import { logHubMessage } from "../hub-server-logging";
import { toHubSessionRecord } from "../hub-session-records";
import { cancelPendingCapabilityRequests } from "./capability-handlers";
import {
	asPlainRecord,
	ensureSessionParticipant,
	ensureSessionState,
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
	readCoreSessionSnapshot,
	readHubSessionRecord,
} from "./context";

const CAPABILITY_OWNER_METADATA_KEY = "hubCapabilityOwnerClientId";

function getCapabilityOwnerClientId(
	ctx: HubTransportContext,
	sessionId: string,
): string | undefined {
	// Sidecar access follows the live hub owner, not persisted metadata clients
	// can replay or edit.
	return ctx.sessionState.get(sessionId)?.createdByClientId;
}

function stripServerOwnedSessionMetadata(
	metadata: Record<string, JsonValue | undefined> | undefined,
): Record<string, JsonValue | undefined> | undefined {
	// Clients may echo old records back through session.update; keep ownership
	// on the live hub state only.
	if (!metadata || !(CAPABILITY_OWNER_METADATA_KEY in metadata)) {
		return metadata;
	}
	const sanitized = { ...metadata };
	delete sanitized[CAPABILITY_OWNER_METADATA_KEY];
	return sanitized;
}

function authorizeSessionCompactionAccess(input: {
	sessionId: string;
	ctx: HubTransportContext;
	clientId: string;
	envelope: HubCommandEnvelope;
}): HubReplyEnvelope | undefined {
	const ownerClientId = getCapabilityOwnerClientId(input.ctx, input.sessionId);
	if (!ownerClientId) {
		return errorReply(
			input.envelope,
			"session_wrong_client",
			`Session ${input.sessionId} has no owner`,
		);
	}
	if (ownerClientId !== input.clientId) {
		return errorReply(
			input.envelope,
			"session_wrong_client",
			`Session ${input.sessionId} is owned by ${ownerClientId}`,
		);
	}
	return undefined;
}

export async function handleSessionCreate(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	requestToolApproval: (
		request: ToolApprovalRequest,
	) => Promise<{ approved: boolean; reason?: string }>,
): Promise<HubReplyEnvelope> {
	const startedAt = performance.now();
	const baseLogContext = {
		command: envelope.command,
		requestId: envelope.requestId,
		clientId: envelope.clientId,
		sessionId: envelope.sessionId,
	};
	logHubMessage("info", "session.create.begin", baseLogContext);
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
	const initialCompactionState = ctx.isCompactionSidecarEnabled()
		? parseSessionCompactionState(payload.initialCompactionState)
		: undefined;
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
		logHubMessage("warn", "session.create.invalid", {
			...baseLogContext,
			reason: "missing_workspace_root",
		});
		return errorReply(
			envelope,
			"invalid_session_create",
			"session.create requires workspaceRoot or cwd",
		);
	}
	const clientId = envelope.clientId?.trim() || "hub-client";
	const clientContributions = parseHubClientContributions(
		runtimeOptions.clientContributions,
	);
	logHubMessage("info", "session.create.contributions_parsed", {
		...baseLogContext,
		clientId,
		workspaceRoot,
		cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
		contributionCount: clientContributions.length,
	});
	const requestedSessionId =
		typeof sessionConfig?.sessionId === "string"
			? sessionConfig.sessionId.trim()
			: "";
	const sessionId = requestedSessionId || createSessionId();
	const configExtensions = parseRuntimeConfigExtensions(
		runtimeOptions.configExtensions,
	);
	logHubMessage("info", "session.create.runtime_build.begin", {
		...baseLogContext,
		sessionId,
		configExtensionCount: configExtensions?.length ?? 0,
	});
	const clientContributionRuntime = createHubClientContributionRuntime({
		sessionId,
		targetClientId: clientId,
		contributions: clientContributions,
		sessionConfig,
		requestCapability: ctx.requestCapability,
	});
	logHubMessage("info", "session.create.start_session.begin", {
		...baseLogContext,
		sessionId,
		provider:
			sessionConfig?.providerId ??
			(typeof modelSelection.provider === "string"
				? modelSelection.provider
				: typeof metadata.provider === "string"
					? metadata.provider
					: "hub"),
		model:
			sessionConfig?.modelId ??
			(typeof modelSelection.model === "string"
				? modelSelection.model
				: typeof metadata.model === "string"
					? metadata.model
					: "hub"),
	});
	const started = await ctx.sessionHost.startSession({
		source: typeof metadata.source === "string" ? metadata.source : undefined,
		interactive: metadata.interactive !== false,
		sessionMetadata:
			Object.keys(metadata as Record<string, unknown>).length > 0
				? (metadata as Record<string, unknown>)
				: undefined,
		initialMessages: Array.isArray(payload.initialMessages)
			? (payload.initialMessages as never[])
			: undefined,
		initialCompactionState,
		localRuntime: {
			modelCatalogDefaults: {
				loadLatestOnInit: true,
				loadPrivateOnAuth: true,
			},
			configExtensions,
			...clientContributionRuntime.localRuntime,
		},
		capabilities: {
			toolExecutors: clientContributionRuntime.toolExecutors,
			requestToolApproval,
		},
		config: {
			...(sessionConfig ?? {}),
			sessionId,
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
	logHubMessage("info", "session.create.start_session.end", {
		...baseLogContext,
		sessionId: started.sessionId,
		elapsedMs: Math.round(performance.now() - startedAt),
		hasImmediateResult: !!started.result,
	});
	ensureSessionState(ctx, started.sessionId, clientId, "creator", {
		interactive: metadata.interactive !== false,
	});
	logHubMessage("info", "session.create.read_records.begin", {
		...baseLogContext,
		sessionId: started.sessionId,
	});
	const [session, snapshot] = await Promise.all([
		readHubSessionRecord(ctx, started.sessionId),
		readCoreSessionSnapshot(ctx, started.sessionId),
	]);
	logHubMessage("info", "session.create.read_records.end", {
		...baseLogContext,
		sessionId: started.sessionId,
		hasSession: !!session,
		hasSnapshot: !!snapshot,
		elapsedMs: Math.round(performance.now() - startedAt),
	});
	if (session) {
		ctx.publish(
			ctx.buildEvent(
				"session.created",
				{ session, ...(snapshot ? { snapshot } : {}) },
				started.sessionId,
			),
		);
	}
	logHubMessage("info", "session.create.reply", {
		...baseLogContext,
		sessionId: started.sessionId,
		elapsedMs: Math.round(performance.now() - startedAt),
	});
	return okReply(envelope, { session, ...(snapshot ? { snapshot } : {}) });
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
	if (typeof checkpointRunCount !== "number") {
		return errorReply(
			envelope,
			"invalid_restore",
			"checkpointRunCount must be a positive integer",
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
		const initialCompactionState = ctx.isCompactionSidecarEnabled()
			? parseSessionCompactionState(payload.initialCompactionState)
			: undefined;
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
		const clientId = envelope.clientId?.trim() || "hub-client";
		const clientContributions = parseHubClientContributions(
			runtimeOptions.clientContributions,
		);
		const requestedSessionId =
			typeof sessionConfig?.sessionId === "string"
				? sessionConfig.sessionId.trim()
				: "";
		const sessionId = requestedSessionId || createSessionId();
		const configExtensions = parseRuntimeConfigExtensions(
			runtimeOptions.configExtensions,
		);
		const clientContributionRuntime = createHubClientContributionRuntime({
			sessionId,
			targetClientId: clientId,
			contributions: clientContributions,
			sessionConfig,
			requestCapability: ctx.requestCapability,
		});
		const service = new SessionVersioningService();
		const result = await service.restoreCheckpoint({
			sessionId: sourceSessionId,
			checkpointRunCount,
			restore: {
				messages: restoreOptions.messages as boolean | undefined,
				workspace: restoreOptions.workspace as boolean | undefined,
				omitCheckpointMessageFromSession:
					restoreOptions.omitCheckpointMessageFromSession === true,
			},
			start: sessionConfig,
			cwd:
				(typeof sessionConfig?.cwd === "string" && sessionConfig.cwd.trim()) ||
				(typeof sessionConfig?.workspaceRoot === "string" &&
					sessionConfig.workspaceRoot.trim()) ||
				undefined,
			getSession: (sessionId) => ctx.sessionHost.getSession(sessionId),
			readMessages: (sessionId) =>
				ctx.sessionHost.readSessionMessages(sessionId),
			buildStartInput: (context) => {
				if (context.restoredCheckpointMetadata) {
					metadata.checkpoint = context.restoredCheckpointMetadata;
				}
				const workspaceRoot =
					typeof payload.workspaceRoot === "string" &&
					payload.workspaceRoot.trim()
						? payload.workspaceRoot.trim()
						: typeof payload.cwd === "string" && payload.cwd.trim()
							? payload.cwd.trim()
							: context.sourceSession.workspaceRoot ||
								context.sourceSession.cwd;
				return {
					source:
						typeof metadata.source === "string" ? metadata.source : undefined,
					interactive: metadata.interactive !== false,
					sessionMetadata: {
						...metadata,
						restoredFromSessionId: sourceSessionId,
						restoredCheckpointRunCount: checkpointRunCount,
					},
					initialMessages: context.initialMessages,
					initialCompactionState,
					localRuntime: {
						modelCatalogDefaults: {
							loadLatestOnInit: true,
							loadPrivateOnAuth: true,
						},
						configExtensions,
						...clientContributionRuntime.localRuntime,
					},
					capabilities: {
						toolExecutors: clientContributionRuntime.toolExecutors,
						requestToolApproval,
					},
					config: {
						...(sessionConfig ?? {}),
						sessionId,
						providerId:
							sessionConfig?.providerId ??
							(typeof modelSelection.provider === "string"
								? modelSelection.provider
								: context.sourceSession.provider),
						modelId:
							sessionConfig?.modelId ??
							(typeof modelSelection.model === "string"
								? modelSelection.model
								: context.sourceSession.model),
						apiKey:
							sessionConfig?.apiKey ??
							(typeof modelSelection.apiKey === "string"
								? modelSelection.apiKey
								: ""),
						cwd: sessionConfig?.cwd ?? context.plan.cwd,
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
							sessionConfig?.enableTools ??
							runtimeOptions.enableTools !== false,
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
				};
			},
			startSession: (startInput) => ctx.sessionHost.startSession(startInput),
			getStartedSessionId: (started) => started.sessionId,
			readRestoredSession: (sessionId) => ctx.sessionHost.getSession(sessionId),
		});
		if (!restoreMessages) {
			return okReply(envelope, { checkpoint: result.checkpoint });
		}
		const started = result.startResult;
		if (!started) {
			return errorReply(
				envelope,
				"restore_failed",
				"Checkpoint restore did not start a session",
			);
		}
		ensureSessionState(ctx, started.sessionId, clientId, "creator", {
			interactive: metadata.interactive !== false,
		});
		const [session, snapshot] = await Promise.all([
			readHubSessionRecord(ctx, started.sessionId),
			readCoreSessionSnapshot(ctx, started.sessionId),
		]);
		if (session) {
			ctx.publish(
				ctx.buildEvent(
					"session.created",
					{ session, ...(snapshot ? { snapshot } : {}) },
					started.sessionId,
				),
			);
		}
		return okReply(envelope, {
			session,
			...(snapshot ? { snapshot } : {}),
			messages: result.messages ?? [],
			checkpoint: result.checkpoint,
		});
	} catch (error) {
		if (error instanceof SessionVersioningError) {
			return errorReply(
				envelope,
				error.code,
				error.code === "session_not_found"
					? `Unknown session: ${sourceSessionId}`
					: error.message,
			);
		}
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
	const session = await readHubSessionRecord(ctx, sessionId);
	if (!session) {
		return errorReply(
			envelope,
			"session_not_found",
			`Unknown session: ${sessionId}`,
		);
	}
	ensureSessionParticipant(
		ctx,
		sessionId,
		envelope.clientId?.trim() || "hub-client",
		"participant",
	);
	const attachedSession = await readHubSessionRecord(ctx, sessionId);
	ctx.publish(
		ctx.buildEvent(
			"session.attached",
			{ session: attachedSession ?? session },
			sessionId,
		),
	);
	return okReply(envelope, { session: attachedSession ?? session });
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
		if (state.createdByClientId === clientId) {
			state.createdByClientId = undefined;
		}
		if (state.participants.size === 0) {
			ctx.sessionState.delete(sessionId);
		}
	}
	cancelPendingCapabilityRequests(
		ctx,
		(request) =>
			request.sessionId === sessionId && request.targetClientId === clientId,
		`Capability owner client ${clientId} detached before request was resolved.`,
	);
	const [session, snapshot] = await Promise.all([
		readHubSessionRecord(ctx, sessionId),
		readCoreSessionSnapshot(ctx, sessionId),
	]);
	ctx.publish(
		ctx.buildEvent(
			"session.detached",
			session
				? { session, ...(snapshot ? { snapshot } : {}), clientId }
				: { clientId },
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
	const includeSnapshot = envelope.payload?.includeSnapshot === true;
	const [session, snapshot] = await Promise.all([
		readHubSessionRecord(ctx, sessionId),
		includeSnapshot
			? readCoreSessionSnapshot(ctx, sessionId)
			: Promise.resolve(undefined),
	]);
	return session
		? okReply(envelope, { session, ...(snapshot ? { snapshot } : {}) })
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
	const messages = await ctx.sessionHost.readSessionMessages(sessionId);
	return okReply(envelope, { sessionId, messages });
}

export async function handleSessionCompactionGet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	if (!sessionId) {
		return errorReply(
			envelope,
			"invalid_session_id",
			"session.compaction.get requires a session id",
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
	if (!ctx.isCompactionSidecarEnabled()) {
		return okReply(envelope, { sessionId, state: undefined, disabled: true });
	}
	const clientId = envelope.clientId?.trim() || "hub-client";
	const unauthorized = authorizeSessionCompactionAccess({
		sessionId,
		ctx,
		clientId,
		envelope,
	});
	if (unauthorized) {
		return unauthorized;
	}
	const state = await ctx.sessionHost.readSessionCompactionState(sessionId);
	return okReply(envelope, { sessionId, state });
}

export async function handleSessionList(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const limit =
		typeof envelope.payload?.limit === "number" ? envelope.payload.limit : 200;
	const records = await ctx.sessionHost.listSessions(limit);
	const sessions = records.map((session) =>
		toHubSessionRecord(session, ctx.sessionState.get(session.sessionId)),
	);
	return okReply(envelope, {
		sessions,
	});
}

export async function handleSessionUpdate(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const metadata = stripServerOwnedSessionMetadata(
		asPlainRecord(envelope.payload?.metadata),
	);
	const updated = await ctx.sessionHost.updateSession(sessionId, { metadata });
	const [session, snapshot] = await Promise.all([
		readHubSessionRecord(ctx, sessionId),
		readCoreSessionSnapshot(ctx, sessionId),
	]);
	if (session) {
		ctx.publish(
			ctx.buildEvent(
				"session.updated",
				{ session, ...(snapshot ? { snapshot } : {}) },
				sessionId,
			),
		);
	}
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: updated.updated,
		payload: {
			updated: updated.updated,
			session,
			...(snapshot ? { snapshot } : {}),
		},
	};
}

export async function handleSessionCompactionUpdate(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	if (!sessionId) {
		return errorReply(
			envelope,
			"invalid_session_id",
			"session.compaction.update requires a session id",
		);
	}
	const clientId = envelope.clientId?.trim() || "hub-client";
	const session = await readHubSessionRecord(ctx, sessionId);
	if (!session) {
		return errorReply(
			envelope,
			"session_not_found",
			`Unknown session: ${sessionId}`,
		);
	}
	if (!ctx.isCompactionSidecarEnabled()) {
		return okReply(envelope, { sessionId, updated: false, disabled: true });
	}
	const unauthorized = authorizeSessionCompactionAccess({
		sessionId,
		ctx,
		clientId,
		envelope,
	});
	if (unauthorized) {
		return unauthorized;
	}
	const payload =
		envelope.payload && typeof envelope.payload === "object"
			? envelope.payload
			: {};
	const state = parseSessionCompactionState(payload.state);
	if (!state) {
		return errorReply(
			envelope,
			"invalid_compaction_state",
			"session.compaction.update requires a valid compaction state",
		);
	}
	const updated = await ctx.sessionHost.updateSessionCompactionState(
		sessionId,
		state,
	);
	const [updatedSession, snapshot] = updated.updated
		? await Promise.all([
				readHubSessionRecord(ctx, sessionId),
				readCoreSessionSnapshot(ctx, sessionId),
			])
		: [session, undefined];
	if (updated.updated) {
		ctx.publish(
			ctx.buildEvent(
				"session.updated",
				{
					session: updatedSession ?? session,
					...(snapshot ? { snapshot } : {}),
				},
				sessionId,
			),
		);
	}
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: true,
		payload: {
			updated: updated.updated,
			session: updatedSession ?? session,
			...(snapshot ? { snapshot } : {}),
		},
	};
}

export async function handleSessionDelete(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const deleted = await ctx.sessionHost.deleteSession(sessionId);
	ctx.sessionState.delete(sessionId);
	return okReply(envelope, { deleted });
}

export async function handleSessionPendingPrompts(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	const service = ctx.sessionHost.pendingPrompts;
	if (!service) {
		return errorReply(
			envelope,
			"pending_prompts_unavailable",
			"Pending prompt service is not available.",
		);
	}
	const prompts = await service.list({ sessionId });
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
	const service = ctx.sessionHost.pendingPrompts;
	if (!service) {
		return errorReply(
			envelope,
			"pending_prompts_unavailable",
			"Pending prompt service is not available.",
		);
	}
	const result = await service.update({
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
	const service = ctx.sessionHost.pendingPrompts;
	if (!service) {
		return errorReply(
			envelope,
			"pending_prompts_unavailable",
			"Pending prompt service is not available.",
		);
	}
	const result = await service.delete({
		sessionId,
		promptId,
	});
	return okReply(
		envelope,
		result as unknown as Record<string, JsonValue | undefined>,
	);
}
