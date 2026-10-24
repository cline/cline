import { randomUUID } from "node:crypto";
import { buildCloudHandoffDashboardUrl, type ClineCore } from "@cline/core";
import type { CloudCreationOptions, CloudHubScope } from "@cline/core/cloud";
import type { MessageWithMetadata } from "@cline/llms";
import {
	type AgentMode,
	createMediaBudgetState,
	getClineEnvironmentConfig,
	validateAndReserveImageMedia,
} from "@cline/shared";
import {
	applyHandoffGit,
	type HandoffGitPlan,
	type HandoffGitPreview,
	inspectHandoffGit,
	previewHandoffGit,
	verifyPublishedHandoffGit,
} from "./cloud-handoff-git";
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
	messages: MessageWithMetadata[];
	config: JsonRecord;
};

const gitPlans = new WeakMap<SidecarContext, Map<string, HandoffSnapshot>>();
const gitPreparations = new WeakMap<
	SidecarContext,
	Map<string, "capturing" | "changed" | "captured">
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
export type PrepareHandoffResult =
	| { gitPreparation: HandoffGitPreview }
	| { previousHandoff: { handoffAttemptId: string; result: HandoffResult } };

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

function assertHandoffAccount(
	ctx: SidecarContext,
	cloud: CloudSessionManager,
	scope: CloudHubScope,
): void {
	if (
		getSidecarContextOwner(ctx).cloudSessionManager !== cloud ||
		cloud.scope?.serviceId !== scope.serviceId ||
		cloud.scope?.scopeGeneration !== scope.scopeGeneration
	)
		throw new Error(
			"The cloud account changed. Run /cloud again to review the preparation plan.",
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
): Promise<PrepareHandoffResult> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	if (isCloudHandoffInProgress(ctx, sessionId))
		throw new Error("Cloud preparation is already in progress.");
	const previous = handoffRequests.get(ctx)?.get(sessionId);
	if (
		previous?.status === "complete" &&
		previous.cloud === getSidecarContextOwner(ctx).cloudSessionManager &&
		previous.scope.serviceId === previous.cloud.scope?.serviceId &&
		previous.scope.scopeGeneration === previous.cloud.scope?.scopeGeneration &&
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
	active.set(sessionId, "capturing");
	try {
		const cloud = getCloudSessionManager(ctx);
		const source = await prepareCloudHandoff(ctx, { ...request, sessionId });
		await cloud.connect();
		const scope = cloud.scope;
		if (!scope) throw new Error("Cloud account is unavailable.");
		const config = structuredClone(source.config);
		const messages = structuredClone(
			await source.manager.readLiveMessages(sessionId),
		);
		if (!messages.length)
			throw new Error("Start a conversation before using /cloud.");
		const plan = await inspectHandoffGit(source.cwd, () => {
			if (active.get(sessionId) === "changed")
				throw new Error(
					"The local conversation changed during capture. Run /cloud again when the turn finishes.",
				);
			active.set(sessionId, "captured");
		});
		await resolveCloudModel(ctx, cloud, scope, config, plan.repoUrl);
		assertHandoffAccount(ctx, cloud, scope);
		let plans = gitPlans.get(ctx);
		if (!plans) {
			plans = new Map();
			gitPlans.set(ctx, plans);
		}
		plans.set(sessionId, { cloud, scope, plan, messages, config });
		return { gitPreparation: previewHandoffGit(plan) };
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
	summarize: Summarize,
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
	const { cloud, scope, config, messages, plan } = approved;
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
	const { modelId, organizationId } = await resolveCloudModel(
		ctx,
		cloud,
		scope,
		config,
		plan.repoUrl,
	);
	assertHandoffAccount(ctx, cloud, scope);
	emitProgress("summarizing", "Preparing a summary of this conversation.");
	const summary = (await summarize(messages, config)).trim();
	assertHandoffAccount(ctx, cloud, scope);
	if (!summary)
		throw new Error(
			"The conversation summary was empty. Nothing was published or started in cloud.",
		);
	emitProgress("checking", "Publishing the approved Git checkpoint.");
	const headSha = await applyHandoffGit(plan);
	assertHandoffAccount(ctx, cloud, scope);
	assertCloudHandoffAvailable();
	await verifyPublishedHandoffGit(plan, headSha);
	assertHandoffAccount(ctx, cloud, scope);
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
	emitProgress("creating", "Starting a new cloud session.");
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
			cloud.scope?.serviceId !== scope.serviceId ||
			cloud.scope?.scopeGeneration !== scope.scopeGeneration ||
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
	try {
		const result = await cloud.create(
			{
				requestId: request.handoffAttemptId,
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
				: "The cloud workspace was created, but the prompt was not sent. Keep Cline open to retry; closing it loses the unsent draft and may require a new cloud task.";
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
	summarize: Summarize,
): Promise<HandoffResult> {
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
			summarize,
			approved,
		);
		requests.set(sessionId, { id, cloud, scope, status: "complete", result });
		return result;
	} catch (error) {
		requests.delete(sessionId);
		throw error;
	}
}

export function beginActiveSessionSend(
	ctx: SidecarContext,
	sessionId: string,
): () => void {
	ctx = getEnvironmentContext(ctx, ctx.activeEnvironmentId ?? "local");
	const preparation = gitPreparations.get(ctx);
	if (preparation?.get(sessionId) === "capturing")
		preparation.set(sessionId, "changed");
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
