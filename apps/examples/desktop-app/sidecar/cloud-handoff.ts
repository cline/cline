import { randomUUID } from "node:crypto";
import { buildCloudHandoffDashboardUrl, type ClineCore } from "@cline/core";
import {
	type CloudCreationOptions,
	type CloudHubScope,
	type HandoffGitPlan,
	type HandoffGitPreview,
	inspectHandoffGit,
	previewHandoffGit,
} from "@cline/core/cloud";
import type { MessageWithMetadata } from "@cline/llms";
import {
	type AgentMode,
	createMediaBudgetState,
	getClineEnvironmentConfig,
	validateAndReserveImageMedia,
} from "@cline/shared";
import {
	type CloudSessionManager,
	getCloudSessionManager,
} from "./cloud-sessions";
import {
	getEnvironmentContext,
	getSessionRuntimeBinding,
	getSidecarContextOwner,
	sendEvent,
} from "./context";
import { isCloudAgentsEnabled } from "./feature-flags";
import {
	readReasoningEffort,
	readWorkspacePath,
	workspacePathKey,
	workspacePathsOverlap,
} from "./session-config";
import type {
	ChatSessionCommandRequest,
	JsonRecord,
	SidecarContext,
} from "./types";

type HandoffSnapshot = {
	cloud: CloudSessionManager;
	scope: CloudHubScope;
	plan: HandoffGitPlan;
	summary: string;
	modelId: string;
	organizationId?: string;
	config: JsonRecord;
};

const gitPlans = new WeakMap<SidecarContext, Map<string, HandoffSnapshot>>();
const gitPreparations = new WeakMap<
	SidecarContext,
	Map<string, { status: "capturing" | "changed" | "captured"; cwd?: string }>
>();
type HandoffRequest = {
	id: string;
	cloud: CloudSessionManager;
	scope: CloudHubScope;
} & ({ status: "running" } | { status: "complete"; result: HandoffResult });
const handoffRequests = new WeakMap<
	SidecarContext,
	Map<string, HandoffRequest>
>();
const activeSendRequests = new WeakMap<SidecarContext, Map<string, number>>();

export type HandoffResult = Awaited<ReturnType<typeof handleHandoffOnce>>;
export type HandoffResponse = HandoffResult | { cancelled: true };
export type PrepareHandoffResult =
	| { gitPreparation: HandoffGitPreview }
	| { previousHandoff: { handoffAttemptId: string; result: HandoffResult } }
	| { cancelled: true };

function assertCloudHandoffAvailable(): void {
	if (!isCloudAgentsEnabled())
		throw new Error("Cloud sessions are not available for this account.");
}

async function assertHandoffIdle(
	ctx: SidecarContext,
	manager: ClineCore,
	sessionId: string,
): Promise<void> {
	if (hasActiveSessionSend(ctx, sessionId))
		throw new Error("Wait for the current send to finish before using /cloud.");
	const live = ctx.liveSessions.get(sessionId);
	const persisted = await manager.get(sessionId);
	if (!live && !persisted)
		throw new Error(`Session ${sessionId} was not found.`);
	const workspaceKey =
		workspacePathKey(live?.config) ?? workspacePathKey(persisted);
	if (
		workspaceKey &&
		[...ctx.restoringWorkspacePaths].some((locked) =>
			workspacePathsOverlap(workspaceKey, locked),
		)
	)
		throw new Error(
			"Wait for workspace preparation to finish before using /cloud.",
		);
	if (
		live?.busy ||
		live?.transitioningProvider ||
		["starting", "running", "stopping"].includes(live?.status ?? "") ||
		persisted?.status === "running" ||
		persisted?.status === "pending"
	)
		throw new Error("Wait for the current run to finish before using /cloud.");
	if (
		(await manager.pendingPrompts.list({ sessionId })).length ||
		live?.promptsInQueue.length
	)
		throw new Error("Remove queued prompts before using /cloud.");
}

async function prepareCloudHandoff(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest & { sessionId: string },
) {
	const { sessionId } = request;
	assertCloudHandoffAvailable();
	const manager = getSessionRuntimeBinding(ctx).sessionManager;
	await assertHandoffIdle(ctx, manager, sessionId);
	const persisted = await manager.get(sessionId);
	const config: JsonRecord = {
		provider: persisted?.provider,
		model: persisted?.model,
		...(ctx.liveSessions.get(sessionId)?.config ?? {}),
		...(request.config ?? {}),
	};
	const cwd = readWorkspacePath(config) ?? readWorkspacePath(persisted);
	if (!cwd) throw new Error("Cloud handoff requires a workspace path.");
	return { manager, config, cwd };
}

function isHandoffAccountCurrent(
	ctx: SidecarContext,
	cloud: CloudSessionManager,
	scope: CloudHubScope | undefined,
): boolean {
	return (
		getSidecarContextOwner(ctx).cloudSessionManager === cloud &&
		(!scope ||
			(cloud.scope?.serviceId === scope.serviceId &&
				cloud.scope?.scopeGeneration === scope.scopeGeneration))
	);
}

function assertHandoffAccount(
	ctx: SidecarContext,
	cloud: CloudSessionManager,
	scope: CloudHubScope,
): void {
	if (!isHandoffAccountCurrent(ctx, cloud, scope))
		throw new Error(
			"The cloud connection or account changed. Check cloud tasks before retrying.",
		);
}

// A Hub restart invalidates the scope but does not prove the account changed.
function hasHandoffAccountChanged(
	ctx: SidecarContext,
	cloud: CloudSessionManager,
	scope: CloudHubScope | undefined,
): boolean {
	const current = cloud.scope;
	return (
		getSidecarContextOwner(ctx).cloudSessionManager !== cloud ||
		(!!scope &&
			current?.serviceId === scope.serviceId &&
			current.scopeGeneration !== scope.scopeGeneration)
	);
}

async function resolveCloudModel(
	ctx: SidecarContext,
	cloud: CloudSessionManager,
	scope: CloudHubScope,
	config: JsonRecord,
	repoUrl: string,
) {
	assertHandoffAccount(ctx, cloud, scope);
	const { organizationId } = await cloud.prepareHandoffRepository(
		repoUrl,
		scope,
	);
	assertHandoffAccount(ctx, cloud, scope);
	const modelId = String(config.model ?? config.modelId ?? "").trim();
	const models = await cloud.listModels(scope);
	assertHandoffAccount(ctx, cloud, scope);
	if (!modelId || !models.some((model) => model.id === modelId))
		throw new Error(
			`The selected model ${modelId || "(none)"} is not available in Cline Cloud for this account. Select a supported model before continuing.`,
		);
	return { modelId, organizationId };
}

export async function handlePrepareHandoff(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
	summarize: Summarize,
): Promise<PrepareHandoffResult> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	if (isCloudHandoffInProgress(ctx, sessionId))
		throw new Error("Cloud preparation is already in progress.");
	const previous = handoffRequests.get(ctx)?.get(sessionId);
	if (
		previous?.status === "complete" &&
		isHandoffAccountCurrent(ctx, previous.cloud, previous.scope) &&
		previous.id !== request.completedHandoffAttemptId
	) {
		return {
			previousHandoff: {
				handoffAttemptId: previous.id,
				result: previous.result,
			},
		};
	}
	let active = gitPreparations.get(ctx);
	if (!active) {
		active = new Map();
		gitPreparations.set(ctx, active);
	}
	const cloud = getCloudSessionManager(ctx);
	let scope = cloud.scope;
	const capture: {
		status: "capturing" | "changed" | "captured";
		cwd?: string;
	} = {
		status: "capturing",
	};
	active.set(sessionId, capture);
	try {
		const source = await prepareCloudHandoff(ctx, { ...request, sessionId });
		capture.cwd = source.cwd;
		await cloud.connect();
		scope ??= cloud.scope;
		if (!scope) throw new Error("Cloud account is unavailable.");
		const config = structuredClone(source.config);
		const messages = structuredClone(
			await source.manager.readLiveMessages(sessionId),
		);
		if (!messages.length)
			throw new Error("Start a conversation before using /cloud.");
		const plan = await inspectHandoffGit(source.cwd, () => {
			if (
				capture.status === "changed" ||
				[...ctx.restoringWorkspacePaths].some((path) =>
					workspacePathsOverlap(source.cwd, path),
				)
			)
				throw new Error(
					"The local conversation or workspace changed during capture. Run /cloud again when the change finishes.",
				);
			capture.status = "captured";
		});
		const { modelId, organizationId } = await resolveCloudModel(
			ctx,
			cloud,
			scope,
			config,
			plan.repoUrl,
		);
		assertHandoffAccount(ctx, cloud, scope);
		const summary = (await summarize(messages, config)).trim();
		assertHandoffAccount(ctx, cloud, scope);
		if (!summary)
			throw new Error(
				"The conversation summary was empty. Nothing was published or started in cloud.",
			);
		let plans = gitPlans.get(ctx);
		if (!plans) {
			plans = new Map();
			gitPlans.set(ctx, plans);
		}
		plans.set(sessionId, {
			cloud,
			scope,
			plan,
			summary,
			modelId,
			organizationId,
			config,
		});
		return { gitPreparation: previewHandoffGit(plan) };
	} catch (error) {
		if (hasHandoffAccountChanged(ctx, cloud, scope)) return { cancelled: true };
		throw error;
	} finally {
		active.delete(sessionId);
	}
}

export async function handleDiscardHandoff(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<void> {
	const plans = gitPlans.get(ctx);
	const id = request.sessionId?.trim();
	if (id && plans && plans.get(id)?.plan.id === request.gitPreparationId)
		plans.delete(id);
}

type Summarize = (
	messages: MessageWithMetadata[],
	config: JsonRecord,
) => Promise<string>;

async function handleHandoffOnce(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest & {
		sessionId: string;
		handoffAttemptId: string;
	},
	approved: HandoffSnapshot,
) {
	if (request.attachments?.userFiles?.length)
		throw new Error("Only image attachments can be sent with /cloud.");
	const images = request.attachments?.userImages ?? [];
	if (images.length > 5) throw new Error("Attach up to 5 images.");
	const imageBudget = createMediaBudgetState();
	for (const image of images) {
		const result = validateAndReserveImageMedia(
			undefined,
			image,
			{},
			imageBudget,
		);
		if (!result.ok) throw new Error(result.message);
	}
	assertCloudHandoffAvailable();
	const sourceSessionId = request.sessionId;
	gitPlans.get(ctx)?.delete(sourceSessionId);
	const { cloud, scope, config, summary, modelId, organizationId, plan } =
		approved;
	assertHandoffAccount(ctx, cloud, scope);
	const emitProgress = (phase: string, message: string, sessionId?: string) =>
		sendEvent(ctx, "cloud_handoff_progress", {
			sourceSessionId,
			handoffAttemptId: request.handoffAttemptId,
			phase,
			message,
			...(sessionId
				? {
						sessionId,
						dashboardUrl: buildCloudHandoffDashboardUrl(
							getClineEnvironmentConfig().appBaseUrl,
							sessionId,
						),
					}
				: {}),
		});
	emitProgress("checking", "Publishing the approved Git checkpoint.");
	const followUp = request.nextCommand?.trim();
	const command = [
		summary,
		followUp
			? `Next instruction from the user:\n${followUp}`
			: "Continue the unfinished work described above. If no next action is clear, ask the user rather than inventing work.",
	].join("\n\n");
	const mode: AgentMode =
		config.mode === "plan" || config.mode === "yolo" || config.mode === "zen"
			? config.mode
			: "act";
	const initialTask: CloudCreationOptions = {
		workspaceRelativePath: plan.workspaceRelativePath || undefined,
		mode,
		...(typeof config.autoApproveTools === "boolean"
			? { autoApproveTools: config.autoApproveTools }
			: {}),
		...(typeof config.thinking === "boolean"
			? { thinking: config.thinking }
			: {}),
		reasoningEffort: readReasoningEffort(config.reasoningEffort),
	};
	let sessionId: string | undefined;
	const unsubscribe = cloud.subscribe((event) => {
		if (
			sessionId ||
			event.type !== "snapshot" ||
			!isHandoffAccountCurrent(ctx, cloud, scope) ||
			event.snapshot.record?.repoContext.repoUrl !== plan.repoUrl ||
			event.snapshot.record.repoContext.branch !== plan.branch
		)
			return;
		// Each approved plan has its own generated branch.
		sessionId = event.sessionId;
		emitProgress("provisioning", "Preparing the cloud workspace.", sessionId);
	});
	let warning: string | undefined;
	let warningKind: "unqueued" | "unconfirmed" | undefined;
	let failure: { dispatched: boolean; detail?: string } | undefined;
	const {
		files: _files,
		commits: _commits,
		sourceBranch: _sourceBranch,
		...localGit
	} = plan;
	try {
		const result = await cloud.create(
			{
				requestId: request.handoffAttemptId,
				localGit,
				repoUrl: plan.repoUrl,
				branch: plan.branch,
				modelId,
				organizationId: organizationId ?? null,
				...initialTask,
				initialMessage: { text: command, images },
			},
			scope,
		);
		sessionId = result.sessionId;
		const send = result.initialSend;
		if (!send)
			throw new Error(
				"Cloud task creation did not confirm the initial message.",
			);
		if ("dispatched" in send) failure = send;
		else if (send.recoveredAfterDisconnect) {
			warningKind = "unconfirmed";
			warning =
				"The cloud connection was interrupted. Check the conversation before resending.";
		}
	} catch (error) {
		if (!sessionId) throw error;
		failure = { dispatched: true };
	} finally {
		unsubscribe();
	}
	if (failure) {
		warningKind = failure.dispatched ? "unconfirmed" : "unqueued";
		warning =
			warningKind === "unconfirmed"
				? "The cloud session was created, but delivery is unconfirmed. Check the conversation before resending."
				: "The cloud task was created, but the prompt was not sent. Open it with the draft to retry. Closing Cline or approving another /cloud discards this draft.";
		if (failure.detail) warning = `${failure.detail} ${warning}`;
	}
	assertHandoffAccount(ctx, cloud, scope);
	const dashboardUrl = buildCloudHandoffDashboardUrl(
		getClineEnvironmentConfig().appBaseUrl,
		sessionId,
	);
	const result = {
		sourceSessionId,
		sessionId,
		dashboardUrl,
		...(warning ? { warning, warningKind } : {}),
		...(warningKind === "unqueued" ? { unsentPrompt: command } : {}),
	};
	sendEvent(ctx, "cloud_handoff_progress", {
		...result,
		handoffAttemptId: request.handoffAttemptId,
		phase: "complete",
		message: "Cloud task ready",
	});
	return result;
}

export async function handleHandoff(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<HandoffResponse> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	if (gitPreparations.get(ctx)?.has(sessionId))
		throw new Error("Wait for Git preparation to finish before continuing.");
	let requests = handoffRequests.get(ctx);
	if (!requests) {
		requests = new Map();
		handoffRequests.set(ctx, requests);
	}
	if (requests.get(sessionId)?.status === "running")
		throw new Error("Cloud preparation is already in progress.");
	const approved = gitPlans.get(ctx)?.get(sessionId);
	if (!approved || approved.plan.id !== request.gitPreparationId)
		throw new Error("Run /cloud again to review the preparation plan.");
	const id = request.handoffAttemptId?.trim() || randomUUID();
	const { cloud, scope } = approved;
	requests.set(sessionId, { id, cloud, scope, status: "running" });
	try {
		const result = await handleHandoffOnce(
			ctx,
			{ ...request, sessionId, handoffAttemptId: id },
			approved,
		);
		requests.set(sessionId, { id, cloud, scope, status: "complete", result });
		return result;
	} catch (error) {
		requests.delete(sessionId);
		if (hasHandoffAccountChanged(ctx, cloud, scope)) return { cancelled: true };
		throw error;
	}
}

export function beginActiveSessionSend(
	ctx: SidecarContext,
	sessionId: string,
): () => void {
	ctx = getEnvironmentContext(ctx, ctx.activeEnvironmentId ?? "local");
	const preparation = gitPreparations.get(ctx)?.get(sessionId);
	if (preparation?.status === "capturing") preparation.status = "changed";
	let sends = activeSendRequests.get(ctx);
	if (!sends) {
		sends = new Map();
		activeSendRequests.set(ctx, sends);
	}
	sends.set(sessionId, (sends.get(sessionId) ?? 0) + 1);
	return () => {
		const remaining = (sends.get(sessionId) ?? 1) - 1;
		if (remaining > 0) sends.set(sessionId, remaining);
		else sends.delete(sessionId);
	};
}

export function invalidateHandoffCaptureForWorkspace(
	ctx: SidecarContext,
	workspacePath: string,
): void {
	for (const capture of gitPreparations.get(ctx)?.values() ?? []) {
		if (
			capture.status === "capturing" &&
			(!capture.cwd || workspacePathsOverlap(capture.cwd, workspacePath))
		) {
			capture.status = "changed";
		}
	}
}

function hasActiveSessionSend(ctx: SidecarContext, sessionId: string): boolean {
	return (
		activeSendRequests
			.get(getEnvironmentContext(ctx, ctx.activeEnvironmentId ?? "local"))
			?.has(sessionId) ?? false
	);
}

function isCloudHandoffInProgress(
	ctx: SidecarContext,
	sessionId: string,
): boolean {
	return Boolean(
		handoffRequests.get(ctx)?.get(sessionId)?.status === "running" ||
			gitPreparations.get(ctx)?.has(sessionId),
	);
}
