import { isDeepStrictEqual } from "node:util";
import {
	buildCloudHandoffDashboardUrl,
	type ClineCore,
	type CloudHandoffFingerprint,
	type CloudHandoffMetadata,
	CloudHandoffTranscriptMismatchError,
	clearCloudHandoffMetadata,
	cloudHandoffFingerprintsEqual,
	cloudHandoffTranscriptsEqual,
	createCloudHandoffFingerprint,
	mergeCloudHandoffMetadata,
	preflightCloudHandoffGit,
	readCloudHandoffMetadata,
	selectCloudHandoffModel,
} from "@cline/core";
import { loadCloudHandoffModels } from "@cline/core/cloud";
import type { MessageWithMetadata } from "@cline/llms";
import { type AgentMode, getClineEnvironmentConfig } from "@cline/shared";
import {
	CloudHandoffSeedUnsupportedError,
	CloudQueueUnconfirmedError,
	CloudSessionError,
	type CloudSessionManager,
	getCloudSessionManager,
} from "./cloud-sessions";
import {
	getEnvironmentContext,
	getSessionRuntimeBinding,
	sendEvent,
} from "./context";
import { isCloudAgentsEnabled } from "./feature-flags";
import {
	readReasoningEffort,
	readWorkspacePath,
	workspacePathKey,
} from "./session-config";
import { readSessionMetadata } from "./session-data/common";
import type {
	ChatSessionCommandRequest,
	JsonRecord,
	SidecarContext,
} from "./types";

type PreparedCloudHandoff = {
	fingerprint: CloudHandoffFingerprint;
	repoUrl: string;
	branch: string;
	headSha: string;
	modelId: string;
	modelFallback?: { from: string; to: string };
};

type CloudHandoffGitState = {
	repoUrl: string;
	branch: string;
	headSha: string;
	workspaceRelativePath?: string;
};

export function cloudHandoffGitStateMatchesFingerprint(
	git: CloudHandoffGitState,
	fingerprint: CloudHandoffFingerprint,
): boolean {
	return (
		git.repoUrl === fingerprint.repoUrl &&
		git.branch === fingerprint.branch &&
		git.headSha.toLowerCase() === fingerprint.headSha.toLowerCase() &&
		(git.workspaceRelativePath ?? "") ===
			(fingerprint.workspaceRelativePath ?? "")
	);
}

function readCloudHandoffMode(value: unknown): AgentMode {
	return value === "plan" || value === "yolo" || value === "zen"
		? value
		: "act";
}

async function assertHandoffIdle(
	ctx: SidecarContext,
	manager: ClineCore,
	sessionId: string,
): Promise<void> {
	if ((activeSendRequests.get(ctx)?.get(sessionId) ?? 0) > 0) {
		throw new Error("Wait for the current send to finish before handing off.");
	}
	const live = ctx.liveSessions.get(sessionId);
	const persisted = await manager.get(sessionId);
	const workspaceKey =
		workspacePathKey(live?.config) ?? workspacePathKey(persisted);
	if (workspaceKey && ctx.restoringWorkspacePaths.has(workspaceKey)) {
		throw new Error(
			"Wait for the workspace restore to finish before handing off to cloud.",
		);
	}
	if (!live && !persisted) {
		throw new Error(`Session ${sessionId} was not found.`);
	}
	const liveIsBusy =
		live?.busy ||
		live?.transitioningProvider ||
		live?.status === "starting" ||
		live?.status === "running" ||
		live?.status === "stopping";
	const persistedIsBusy =
		!live &&
		(persisted?.status === "running" || persisted?.status === "pending");
	if (liveIsBusy || persistedIsBusy) {
		throw new Error("Stop the current run before handing off to cloud.");
	}
	const queued = await manager.pendingPrompts.list({ sessionId });
	if (queued.length > 0 || (live?.promptsInQueue.length ?? 0) > 0) {
		throw new Error("Remove queued prompts before handing off to cloud.");
	}
}

export async function updateHandoffMetadataOrThrow(
	manager: Pick<ClineCore, "update">,
	sessionId: string,
	metadata: Record<string, unknown>,
	failureMessage: string,
): Promise<void> {
	const result = await manager.update(sessionId, { metadata });
	if (!result.updated) throw new Error(failureMessage);
}

export async function assertPendingCloudHandoffCompatible(
	cloud: Pick<CloudSessionManager, "handoffTargetExists">,
	input: {
		pending?: CloudHandoffMetadata;
		fingerprint: CloudHandoffFingerprint;
		appBaseUrl: string;
	},
): Promise<void> {
	if (
		input.pending?.status !== "pending" ||
		cloudHandoffFingerprintsEqual(input.pending.fingerprint, input.fingerprint)
	) {
		return;
	}
	if (await cloud.handoffTargetExists(input.pending.toCloudSessionId)) {
		const dashboardUrl =
			input.pending.dashboardUrl ??
			buildCloudHandoffDashboardUrl(
				input.appBaseUrl,
				input.pending.toCloudSessionId,
			);
		throw new Error(
			`A previous cloud handoff is still pending for a different repository, branch, commit, or model. Continue or delete it before retrying: ${dashboardUrl}`,
		);
	}
	throw new Error(
		"The previous cloud handoff is not visible from the current account. Sign back into the account that created it before retrying.",
	);
}

export function shouldCleanupFailedHandoffVerification(
	error: unknown,
	createdOuterSessionThisAttempt = true,
): boolean {
	return (
		error instanceof CloudHandoffSeedUnsupportedError ||
		(createdOuterSessionThisAttempt &&
			error instanceof CloudHandoffTranscriptMismatchError)
	);
}

export function formatPendingHandoffVerificationError(
	error: CloudHandoffTranscriptMismatchError,
	dashboardUrl: string,
): string {
	return `${error.message} Open the pending cloud workspace to inspect it, or delete it before retrying /cloud: ${dashboardUrl}`;
}

async function assertCloudHandoffAvailable(
	ctx: SidecarContext,
	sourceSessionId?: string,
): Promise<void> {
	if (isCloudAgentsEnabled()) {
		return;
	}
	// These gates block NEW handoffs only. A handoff that is already pending
	// must stay recoverable after a flag or the opt-in flips off: the source
	// session's normal actions are blocked by the pending guard, so gating
	// recovery here would deadlock the session until the gate returns.
	if (sourceSessionId) {
		const manager = getSessionRuntimeBinding(ctx).sessionManager;
		const persisted = await manager.get(sourceSessionId).catch(() => undefined);
		const pending =
			readCloudHandoffMetadata(
				(persisted?.metadata ?? undefined) as JsonRecord | undefined,
			) ?? readCloudHandoffMetadata(readSessionMetadata(sourceSessionId));
		if (pending?.status === "pending") return;
	}
	throw new Error("Enable Cloud sessions in Settings before using /cloud.");
}

async function prepareCloudHandoff(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
	options: { pinnedModelId?: string } = {},
): Promise<PreparedCloudHandoff> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	const manager = getSessionRuntimeBinding(ctx).sessionManager;
	await assertHandoffIdle(ctx, manager, sessionId);
	if ((await manager.readLiveMessages(sessionId)).length === 0) {
		throw new Error("Start a conversation before handing it off to cloud.");
	}
	const persisted = await manager.get(sessionId);
	const existingHandoff = readCloudHandoffMetadata(
		persisted?.metadata ?? readSessionMetadata(sessionId),
	);
	if (existingHandoff?.status === "complete") {
		throw new Error(
			`This session already continued in Cline Cloud: ${existingHandoff.dashboardUrl ?? buildCloudHandoffDashboardUrl(getClineEnvironmentConfig().appBaseUrl, existingHandoff.toCloudSessionId)}`,
		);
	}
	const config = {
		...(ctx.liveSessions.get(sessionId)?.config ?? {}),
		...(request.config ?? {}),
	};
	const cwd = readWorkspacePath(config) ?? readWorkspacePath(persisted);
	if (!cwd) throw new Error("Cloud handoff requires a workspace path.");
	const git = await preflightCloudHandoffGit({ cwd });
	const cloud = getCloudSessionManager(ctx);
	const { organizationId } = await cloud.prepareHandoffRepository(git.repoUrl);
	const localModelId = String(
		config.model ?? config.modelId ?? persisted?.model ?? "",
	).trim();
	const models = await loadCloudHandoffModels(
		getClineEnvironmentConfig().apiBaseUrl,
	);
	let selection = selectCloudHandoffModel({
		localModelId: options.pinnedModelId ?? localModelId,
		models,
		isOrganizationSession: Boolean(organizationId),
	});
	if (options.pinnedModelId) {
		if (selection.modelId !== options.pinnedModelId) {
			throw new Error(
				`Cloud model ${options.pinnedModelId} is no longer available for this account. Run /cloud again to select an available model.`,
			);
		}
		selection = {
			modelId: options.pinnedModelId,
			usedFallback: options.pinnedModelId !== localModelId,
			catalogId: selection.catalogId,
		};
	}
	const mode = readCloudHandoffMode(config.mode);
	const fingerprint = createCloudHandoffFingerprint({
		repoUrl: git.repoUrl,
		branch: git.branch,
		headSha: git.headSha,
		modelId: selection.modelId,
		...(organizationId ? { organizationId } : {}),
		...(git.workspaceRelativePath
			? { workspaceRelativePath: git.workspaceRelativePath }
			: {}),
		...(mode !== "act" ? { mode } : {}),
	});
	return {
		fingerprint,
		repoUrl: git.repoUrl,
		branch: git.branch,
		headSha: git.headSha,
		modelId: selection.modelId,
		...(selection.usedFallback && localModelId
			? { modelFallback: { from: localModelId, to: selection.modelId } }
			: {}),
	};
}

function readRequestedHandoffFingerprint(
	request: ChatSessionCommandRequest,
): CloudHandoffFingerprint {
	const value = request.fingerprint;
	if (!value) throw new Error("Run handoff preflight again before continuing.");
	return createCloudHandoffFingerprint({
		repoUrl: String(value.repoUrl ?? ""),
		branch: String(value.branch ?? ""),
		headSha: String(value.headSha ?? ""),
		modelId: String(value.modelId ?? ""),
		...(typeof value.organizationId === "string"
			? { organizationId: value.organizationId }
			: {}),
		...(typeof value.workspaceRelativePath === "string"
			? { workspaceRelativePath: value.workspaceRelativePath }
			: {}),
		...(value.mode === "plan" || value.mode === "yolo" || value.mode === "zen"
			? { mode: value.mode }
			: {}),
	});
}

export async function handlePrepareHandoff(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<PreparedCloudHandoff> {
	await assertCloudHandoffAvailable(ctx, request.sessionId?.trim());
	return await prepareCloudHandoff(ctx, request);
}

async function handleHandoffOnce(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sourceSessionId = request.sessionId?.trim();
	await assertCloudHandoffAvailable(ctx, sourceSessionId);
	if (!sourceSessionId) throw new Error("sessionId is required");
	if (request.attachments?.userFiles?.length) {
		throw new Error("Only image attachments can be sent with a cloud handoff.");
	}
	const nextCommand = request.nextCommand?.trim() ?? "";
	const handoffAttemptId = request.handoffAttemptId?.trim();
	if (!nextCommand && request.attachments?.userImages?.length) {
		throw new Error("Add a command to send the attached images after handoff.");
	}
	const expectedFingerprint = readRequestedHandoffFingerprint(request);
	const prepared = await prepareCloudHandoff(ctx, request, {
		pinnedModelId: expectedFingerprint.modelId,
	});
	if (
		!cloudHandoffFingerprintsEqual(expectedFingerprint, prepared.fingerprint)
	) {
		throw new Error(
			"The repository, branch, commit, workspace path, mode, or cloud model changed after handoff started. Review the handoff details and try again.",
		);
	}
	const manager = getSessionRuntimeBinding(ctx).sessionManager;
	const cloud = getCloudSessionManager(ctx);
	const environment = getClineEnvironmentConfig();
	const emitProgress = (
		phase:
			| "creating"
			| "provisioning"
			| "connecting"
			| "seeding"
			| "verifying"
			| "complete",
		message: string,
		outerSessionId?: string,
	) => {
		sendEvent(ctx, "cloud_handoff_progress", {
			sourceSessionId,
			...(handoffAttemptId ? { handoffAttemptId } : {}),
			phase,
			message,
			...(outerSessionId
				? {
						sessionId: outerSessionId,
						dashboardUrl: buildCloudHandoffDashboardUrl(
							environment.appBaseUrl,
							outerSessionId,
						),
					}
				: {}),
		});
	};

	const persistedBefore = await manager.get(sourceSessionId);
	const sourceConfig = {
		...(ctx.liveSessions.get(sourceSessionId)?.config ?? {}),
		...(request.config ?? {}),
	};
	const sourceReasoningEffort = readReasoningEffort(
		sourceConfig.reasoningEffort,
	);
	const handoffConfig = {
		...(typeof sourceConfig.autoApproveTools === "boolean"
			? { autoApproveTools: sourceConfig.autoApproveTools }
			: {}),
		...(typeof sourceConfig.thinking === "boolean"
			? { thinking: sourceConfig.thinking }
			: {}),
		...(sourceReasoningEffort
			? { reasoningEffort: sourceReasoningEffort }
			: {}),
	};
	const sourceCwd =
		readWorkspacePath(sourceConfig) ?? readWorkspacePath(persistedBefore);
	if (!sourceCwd) throw new Error("Cloud handoff requires a workspace path.");
	const metadataBefore =
		(persistedBefore?.metadata as JsonRecord | null | undefined) ??
		readSessionMetadata(sourceSessionId) ??
		{};
	const pending = readCloudHandoffMetadata(metadataBefore);
	await assertPendingCloudHandoffCompatible(cloud, {
		pending,
		fingerprint: prepared.fingerprint,
		appBaseUrl: environment.appBaseUrl,
	});

	let outerSessionId = pending?.toCloudSessionId ?? "";
	let innerSessionId = pending?.innerSessionId ?? "";
	let seededMessages: MessageWithMetadata[] | undefined;
	let createdOuterSessionThisAttempt = false;
	const readSeedMessages = async (): Promise<MessageWithMetadata[]> => {
		await assertHandoffIdle(ctx, manager, sourceSessionId);
		emitProgress(
			"connecting",
			"Connecting securely to the cloud workspace…",
			outerSessionId || undefined,
		);
		const currentGit = await preflightCloudHandoffGit({ cwd: sourceCwd });
		if (
			!cloudHandoffGitStateMatchesFingerprint(currentGit, prepared.fingerprint)
		) {
			const dashboardUrl = outerSessionId
				? buildCloudHandoffDashboardUrl(environment.appBaseUrl, outerSessionId)
				: undefined;
			const error = new Error(
				createdOuterSessionThisAttempt
					? "The repository branch changed while the cloud workspace was starting. Review the latest commit and run /cloud again."
					: `The repository branch changed after this cloud handoff started. Restore the source repository to commit ${prepared.headSha.slice(0, 12)} and retry, or open/delete the pending cloud workspace before starting another handoff${dashboardUrl ? `: ${dashboardUrl}` : "."}`,
			);
			if (createdOuterSessionThisAttempt && outerSessionId) {
				try {
					await clearPendingTarget(outerSessionId);
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						"The repository branch changed during handoff and the incomplete cloud workspace could not be cleaned up.",
					);
				}
			}
			throw error;
		}
		const messages = await manager.readLiveMessages(sourceSessionId);
		if (messages.length === 0) {
			throw new Error("Start a conversation before handing it off to cloud.");
		}
		seededMessages = messages;
		return messages;
	};
	const clearPendingMetadata = async (): Promise<void> => {
		const current = await manager.get(sourceSessionId);
		await updateHandoffMetadataOrThrow(
			manager,
			sourceSessionId,
			clearCloudHandoffMetadata(
				(current?.metadata as JsonRecord | null | undefined) ?? metadataBefore,
			),
			"The cloud target was removed, but its local pending handoff record could not be cleared.",
		);
	};
	const clearPendingTarget = async (sessionId: string): Promise<void> => {
		try {
			await cloud.delete(sessionId);
		} catch (error) {
			if (
				error instanceof CloudSessionError &&
				(error.code === "session_not_found" || error.code === "session_expired")
			) {
				// An authoritative gone response means there is no target left to adopt.
			} else {
				// Preserve the pending lineage and recovery URL on transient cleanup
				// failures. Clearing them here would let the next retry create a
				// duplicate sandbox with no way to recover the first one.
				throw new Error(
					"Could not clean up the previous cloud handoff; retry after deleting it from Cline Cloud.",
					{ cause: error },
				);
			}
		}
		await clearPendingMetadata();
	};

	if (outerSessionId) {
		if (!pending) {
			throw new Error("The pending cloud handoff metadata is incomplete.");
		}
		const pendingHandoff = pending;
		const dashboardUrl = buildCloudHandoffDashboardUrl(
			environment.appBaseUrl,
			outerSessionId,
		);
		emitProgress(
			"provisioning",
			"Resuming the existing cloud handoff…",
			outerSessionId,
		);
		try {
			await cloud.waitUntilReady(outerSessionId);
			const seed = await readSeedMessages();
			const resumed = await cloud.seedHandoff(outerSessionId, {
				sourceSessionId,
				messages: seed,
				workspaceRelativePath: prepared.fingerprint.workspaceRelativePath,
				mode: prepared.fingerprint.mode ?? "act",
				// After a sidecar restart nothing else remembers the source
				// session's approval/reasoning settings for the inner create.
				config: handoffConfig,
				onSeeding: () =>
					emitProgress(
						"seeding",
						"Copying the local conversation to cloud…",
						outerSessionId,
					),
			});
			innerSessionId = resumed.innerSessionId;
			if (!pendingHandoff.dashboardUrl) {
				const current = await manager.get(sourceSessionId);
				await updateHandoffMetadataOrThrow(
					manager,
					sourceSessionId,
					mergeCloudHandoffMetadata(
						(current?.metadata as JsonRecord | null | undefined) ??
							metadataBefore,
						{
							...pendingHandoff,
							dashboardUrl,
							innerSessionId,
						},
					),
					"The resumed cloud handoff could not update its local recovery record.",
				);
			}
		} catch (error) {
			if (
				error instanceof CloudSessionError &&
				(error.code === "session_not_found" ||
					error.code === "session_expired" ||
					error.code === "session_failed")
			) {
				await clearPendingTarget(outerSessionId);
				outerSessionId = "";
				innerSessionId = "";
				seededMessages = undefined;
			} else {
				throw error;
			}
		}
	}
	if (!outerSessionId) {
		emitProgress("creating", "Creating the cloud workspace…");
		const created = await cloud.create({
			// Single-flight concurrent handoff attempts of the same source
			// session under the base's requestId-keyed create dedupe.
			requestId: `handoff:${sourceSessionId}:${prepared.headSha.toLowerCase()}`,
			repoUrl: prepared.repoUrl,
			branch: prepared.branch,
			modelId: prepared.modelId,
			mode: prepared.fingerprint.mode ?? "act",
			workspaceRelativePath: prepared.fingerprint.workspaceRelativePath,
			organizationId: prepared.fingerprint.organizationId ?? null,
			...handoffConfig,
			handoff: {
				sourceSessionId,
				resolveMessages: readSeedMessages,
				onOuterSessionCreated: async (createdSessionId, info) => {
					outerSessionId = createdSessionId;
					const dashboardUrl = buildCloudHandoffDashboardUrl(
						environment.appBaseUrl,
						createdSessionId,
					);
					const current = await manager.get(sourceSessionId);
					await updateHandoffMetadataOrThrow(
						manager,
						sourceSessionId,
						mergeCloudHandoffMetadata(
							(current?.metadata as JsonRecord | null | undefined) ??
								metadataBefore,
							{
								toCloudSessionId: createdSessionId,
								handedOffAt: new Date().toISOString(),
								status: "pending",
								dashboardUrl,
								fingerprint: prepared.fingerprint,
							},
						),
						`Cloud workspace ${createdSessionId} was created, but its recovery link could not be saved locally.`,
					);
					createdOuterSessionThisAttempt = info?.created === true;
					emitProgress(
						"provisioning",
						"Preparing the cloud workspace…",
						createdSessionId,
					);
				},
				onOuterSessionRemoved: async () => {
					await clearPendingMetadata();
					outerSessionId = "";
					innerSessionId = "";
					seededMessages = undefined;
				},
				onSeeding: () =>
					emitProgress(
						"seeding",
						"Copying the local conversation to cloud…",
						outerSessionId,
					),
			},
		});
		outerSessionId = String(created.sessionId ?? "").trim();
		innerSessionId = String(created.innerSessionId ?? "").trim();
	}

	if (!outerSessionId || !innerSessionId || !seededMessages) {
		throw new Error("Cloud handoff did not initialize a conversation.");
	}
	emitProgress(
		"verifying",
		"Verifying the transferred conversation…",
		outerSessionId,
	);
	try {
		await cloud.verifyHandoffTranscript(outerSessionId, seededMessages, {
			allowAppendedMessages: !createdOuterSessionThisAttempt,
		});
	} catch (error) {
		if (
			!shouldCleanupFailedHandoffVerification(
				error,
				createdOuterSessionThisAttempt,
			)
		) {
			if (
				error instanceof CloudHandoffTranscriptMismatchError &&
				!createdOuterSessionThisAttempt
			) {
				throw new Error(
					formatPendingHandoffVerificationError(
						error,
						buildCloudHandoffDashboardUrl(
							environment.appBaseUrl,
							outerSessionId,
						),
					),
					{ cause: error },
				);
			}
			throw error;
		}
		try {
			await clearPendingTarget(outerSessionId);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Cloud transcript verification failed and the incomplete cloud handoff could not be cleaned up.",
			);
		}
		throw error;
	}
	await assertHandoffIdle(ctx, manager, sourceSessionId);
	const finalLocalMessages = await manager.readLiveMessages(sourceSessionId);
	if (!cloudHandoffTranscriptsEqual(finalLocalMessages, seededMessages)) {
		const error = new Error(
			"The local conversation changed during handoff. Nothing was closed; try again when the session is idle.",
		);
		if (createdOuterSessionThisAttempt) {
			try {
				await clearPendingTarget(outerSessionId);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"The local conversation changed during handoff and the incomplete cloud handoff could not be cleaned up.",
				);
			}
		}
		throw error;
	}
	const dashboardUrl = buildCloudHandoffDashboardUrl(
		environment.appBaseUrl,
		outerSessionId,
	);
	const latest = await manager.get(sourceSessionId);
	const latestMetadata =
		(latest?.metadata as JsonRecord | null | undefined) ?? metadataBefore;
	const handedOffAt =
		readCloudHandoffMetadata(latestMetadata)?.handedOffAt ??
		new Date().toISOString();
	await updateHandoffMetadataOrThrow(
		manager,
		sourceSessionId,
		mergeCloudHandoffMetadata(latestMetadata, {
			toCloudSessionId: outerSessionId,
			handedOffAt,
			status: "complete",
			innerSessionId,
			dashboardUrl,
			fingerprint: prepared.fingerprint,
		}),
		"The cloud transcript was verified, but the local handoff marker could not be saved. The local session remains open.",
	);

	let warning: string | undefined;
	let warningKind: "unqueued" | "unconfirmed" | undefined;
	if (nextCommand) {
		try {
			await cloud.send(
				outerSessionId,
				nextCommand,
				"queue",
				prepared.modelId,
				request.attachments?.userImages,
			);
		} catch (error) {
			// An unconfirmed outcome must never read as "not queued": inviting
			// a resubmission of a durably queued prompt executes it twice.
			if (error instanceof CloudQueueUnconfirmedError) {
				warningKind = "unconfirmed";
				warning = `The handoff completed, but Cline could not confirm whether the follow-up command was queued. Check the cloud session before resending it.`;
			} else {
				warningKind = "unqueued";
				warning = `The handoff completed, but the follow-up command was not queued: ${error instanceof Error ? error.message : String(error)}`;
			}
		}
	}
	const destination = isCloudAgentsEnabled() ? "in_app" : "external";
	// The completion event is the authoritative signal for the webview; emit it
	// with the full payload before the RPC returns.
	sendEvent(ctx, "cloud_handoff_progress", {
		sourceSessionId,
		...(handoffAttemptId ? { handoffAttemptId } : {}),
		phase: "complete",
		message: "Ready in Cline Cloud.",
		sessionId: outerSessionId,
		dashboardUrl,
		destination,
		// If the RPC response is lost, this event is all the webview sees: a
		// clean complete would silently drop a definite follow-up queue failure.
		...(warning ? { warning } : {}),
		...(warningKind ? { warningKind } : {}),
		// Only a definitely-unqueued command is safe to offer for resending; an
		// unconfirmed one may already be durably queued.
		...(warningKind === "unqueued" && nextCommand.trim()
			? { undeliveredCommand: nextCommand.trim() }
			: {}),
	});
	return {
		sessionId: outerSessionId,
		outerSessionId,
		innerSessionId,
		dashboardUrl,
		destination,
		...(warning ? { warning } : {}),
		...(warningKind ? { warningKind } : {}),
	};
}

type HandoffRequestIdentity = {
	handoffAttemptId: string;
	fingerprint: JsonRecord | null;
	config: JsonRecord | null;
	nextCommand: string;
	userImages: string[];
	userFiles: Array<{ name: string; content: string }>;
};

const handoffRequests = new WeakMap<
	SidecarContext,
	Map<string, { identity: HandoffRequestIdentity; promise: Promise<unknown> }>
>();

// Track sends before their first await so handoff cannot snapshot a changing
// transcript. The counter keeps concurrent queued sends from releasing early.
const activeSendRequests = new WeakMap<SidecarContext, Map<string, number>>();
const activeDeleteRequests = new WeakMap<SidecarContext, Map<string, number>>();
const activeMetadataUpdateRequests = new WeakMap<
	SidecarContext,
	Map<string, number>
>();

function handoffLockContext(ctx: SidecarContext): SidecarContext {
	return getEnvironmentContext(ctx, ctx.activeEnvironmentId ?? "local");
}

export function beginActiveSessionSend(
	ctx: SidecarContext,
	sessionId: string,
): () => void {
	const lockContext = handoffLockContext(ctx);
	let requests = activeSendRequests.get(lockContext);
	if (!requests) {
		requests = new Map();
		activeSendRequests.set(lockContext, requests);
	}
	requests.set(sessionId, (requests.get(sessionId) ?? 0) + 1);
	let finished = false;
	return () => {
		if (finished) return;
		finished = true;
		const remaining = (requests?.get(sessionId) ?? 1) - 1;
		if (remaining > 0) requests?.set(sessionId, remaining);
		else requests?.delete(sessionId);
		if (requests?.size === 0) activeSendRequests.delete(lockContext);
	};
}

function beginActiveSessionDelete(
	ctx: SidecarContext,
	sessionId: string,
): () => void {
	const lockContext = handoffLockContext(ctx);
	if (handoffRequests.get(lockContext)?.has(sessionId)) {
		throw new Error("Wait for the cloud handoff to finish before deleting.");
	}
	let requests = activeDeleteRequests.get(lockContext);
	if (!requests) {
		requests = new Map();
		activeDeleteRequests.set(lockContext, requests);
	}
	requests.set(sessionId, (requests.get(sessionId) ?? 0) + 1);
	let finished = false;
	return () => {
		if (finished) return;
		finished = true;
		const remaining = (requests?.get(sessionId) ?? 1) - 1;
		if (remaining > 0) requests?.set(sessionId, remaining);
		else requests?.delete(sessionId);
		if (requests?.size === 0) activeDeleteRequests.delete(lockContext);
	};
}

export function beginSessionMetadataUpdate(
	ctx: SidecarContext,
	sessionId: string,
): () => void {
	const lockContext = handoffLockContext(ctx);
	if (handoffRequests.get(lockContext)?.has(sessionId)) {
		throw new Error(
			"Wait for the cloud handoff to finish before updating session metadata.",
		);
	}
	let requests = activeMetadataUpdateRequests.get(lockContext);
	if (!requests) {
		requests = new Map();
		activeMetadataUpdateRequests.set(lockContext, requests);
	}
	requests.set(sessionId, (requests.get(sessionId) ?? 0) + 1);
	let finished = false;
	return () => {
		if (finished) return;
		finished = true;
		const remaining = (requests?.get(sessionId) ?? 1) - 1;
		if (remaining > 0) requests?.set(sessionId, remaining);
		else requests?.delete(sessionId);
		if (requests?.size === 0) activeMetadataUpdateRequests.delete(lockContext);
	};
}

/**
 * Deleting a source session while its cloud handoff is in flight can remove
 * the only durable recovery record for an already-created sandbox. Keep this
 * check in the sidecar as well as the UI so alternate clients cannot bypass it.
 */
export async function assertSessionDeleteAllowedDuringHandoff(
	ctx: SidecarContext,
	sessionId: string,
): Promise<() => void> {
	const release = beginActiveSessionDelete(ctx, sessionId);
	try {
		const manager = getSessionRuntimeBinding(ctx).sessionManager;
		const persisted = await manager.get(sessionId);
		const handoff = readCloudHandoffMetadata(
			persisted?.metadata ?? readSessionMetadata(sessionId),
		);
		if (handoff?.status === "pending") {
			throw new Error(
				`Cloud handoff is still pending. Retry /cloud or continue here: ${handoff.dashboardUrl ?? buildCloudHandoffDashboardUrl(getClineEnvironmentConfig().appBaseUrl, handoff.toCloudSessionId)}`,
			);
		}
		return release;
	} catch (error) {
		release();
		throw error;
	}
}

export async function handleHandoff(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sourceSessionId = request.sessionId?.trim();
	if (!sourceSessionId) throw new Error("sessionId is required");
	if (activeDeleteRequests.get(ctx)?.has(sourceSessionId)) {
		throw new Error("Wait for session deletion to finish before handing off.");
	}
	if (activeMetadataUpdateRequests.get(ctx)?.has(sourceSessionId)) {
		throw new Error(
			"Wait for the session metadata update to finish before handing off.",
		);
	}
	let requests = handoffRequests.get(ctx);
	if (!requests) {
		requests = new Map();
		handoffRequests.set(ctx, requests);
	}
	const identity: HandoffRequestIdentity = {
		handoffAttemptId: request.handoffAttemptId?.trim() ?? "",
		fingerprint: request.fingerprint ?? null,
		config: request.config ?? null,
		nextCommand: request.nextCommand?.trim() ?? "",
		userImages: [...(request.attachments?.userImages ?? [])],
		userFiles: (request.attachments?.userFiles ?? []).map((file) => ({
			...file,
		})),
	};
	const existing = requests.get(sourceSessionId);
	if (existing) {
		if (!isDeepStrictEqual(existing.identity, identity)) {
			throw new Error(
				"A different cloud handoff is already in progress for this session.",
			);
		}
		return await existing.promise;
	}
	const running = handleHandoffOnce(ctx, request).finally(() => {
		if (requests?.get(sourceSessionId)?.promise === running) {
			requests.delete(sourceSessionId);
		}
	});
	requests.set(sourceSessionId, { identity, promise: running });
	return await running;
}

export function isCloudHandoffInProgress(
	ctx: SidecarContext,
	sessionId: string,
): boolean {
	return handoffRequests.get(ctx)?.has(sessionId) ?? false;
}
