import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildCloudHandoffDashboardUrl, type ClineCore } from "@cline/core";
import { type CloudCreationOptions, loadCloudModels } from "@cline/core/cloud";
import type { MessageWithMetadata } from "@cline/llms";
import {
	type AgentMode,
	createMediaBudgetState,
	getClineEnvironmentConfig,
	validateAndReserveImageMedia,
} from "@cline/shared";
import {
	saveCloudHandoffFollowUp,
	sendWithCloudHandoffFollowUp,
} from "./cloud-handoff-follow-up";
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
	plan: HandoffGitPlan;
	messages: MessageWithMetadata[];
	config: JsonRecord;
};

const gitPlans = new WeakMap<SidecarContext, Map<string, HandoffSnapshot>>();
const gitPreparations = new WeakMap<SidecarContext, Set<string>>();
const handoffRequests = new WeakMap<
	SidecarContext,
	Map<string, { request: ChatSessionCommandRequest; promise: Promise<unknown> }>
>();
const activeSendRequests = new WeakMap<SidecarContext, Map<string, number>>();

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
			workspacePathsOverlap(workspaceKey, locked, "local"),
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
	request: ChatSessionCommandRequest,
) {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
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
	return { sessionId, manager, config, cwd };
}

function assertHandoffAccount(
	ctx: SidecarContext,
	cloud: CloudSessionManager,
): void {
	if (getSidecarContextOwner(ctx).cloudSessionManager !== cloud)
		throw new Error(
			"The cloud account changed. Run /cloud again to review the preparation plan.",
		);
}

async function resolveCloudModel(
	ctx: SidecarContext,
	cloud: CloudSessionManager,
	config: JsonRecord,
	repoUrl: string,
) {
	assertHandoffAccount(ctx, cloud);
	const { organizationId } = await cloud.prepareHandoffRepository(repoUrl);
	assertHandoffAccount(ctx, cloud);
	const modelId = String(config.model ?? config.modelId ?? "").trim();
	const models = await loadCloudModels(getClineEnvironmentConfig().apiBaseUrl, {
		isOrganizationSession: Boolean(organizationId),
	});
	assertHandoffAccount(ctx, cloud);
	if (!modelId || !models.some((model) => model.id === modelId))
		throw new Error(
			`The selected model ${modelId || "(none)"} is not available in Cline Cloud for this account. Select a supported model before continuing.`,
		);
	return { modelId, organizationId };
}

export async function handlePrepareHandoff(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<{ gitPreparation: HandoffGitPreview }> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	if (isCloudHandoffInProgress(ctx, sessionId))
		throw new Error("Cloud preparation is already in progress.");
	let active = gitPreparations.get(ctx);
	if (!active) {
		active = new Set();
		gitPreparations.set(ctx, active);
	}
	active.add(sessionId);
	try {
		const cloud = getCloudSessionManager(ctx);
		const source = await prepareCloudHandoff(ctx, request);
		const config = structuredClone(source.config);
		const messages = structuredClone(
			await source.manager.readLiveMessages(sessionId),
		);
		if (!messages.length)
			throw new Error("Start a conversation before using /cloud.");
		const plan = await inspectHandoffGit(source.cwd);
		await resolveCloudModel(ctx, cloud, config, plan.repoUrl);
		assertHandoffAccount(ctx, cloud);
		let plans = gitPlans.get(ctx);
		if (!plans) {
			plans = new Map();
			gitPlans.set(ctx, plans);
		}
		plans.set(sessionId, { cloud, plan, messages, config });
		return { gitPreparation: previewHandoffGit(plan) };
	} finally {
		active.delete(sessionId);
	}
}

type Summarize = (
	messages: MessageWithMetadata[],
	config: JsonRecord,
) => Promise<string>;

async function handleHandoffOnce(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
	summarize: Summarize,
): Promise<unknown> {
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
	const sourceSessionId = request.sessionId?.trim();
	if (!sourceSessionId) throw new Error("sessionId is required");
	const approved = gitPlans.get(ctx)?.get(sourceSessionId);
	if (!approved || approved.plan.id !== request.gitPreparationId)
		throw new Error("Run /cloud again to review the preparation plan.");
	gitPlans.get(ctx)?.delete(sourceSessionId);
	const { cloud, config, messages, plan } = approved;
	assertHandoffAccount(ctx, cloud);
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
	await resolveCloudModel(ctx, cloud, config, plan.repoUrl);
	assertHandoffAccount(ctx, cloud);
	emitProgress("summarizing", "Preparing a summary of this conversation.");
	const summary = (await summarize(messages, config)).trim();
	assertHandoffAccount(ctx, cloud);
	if (!summary)
		throw new Error(
			"The conversation summary was empty. Nothing was published or started in cloud.",
		);
	emitProgress("checking", "Publishing the approved Git checkpoint.");
	const headSha = await applyHandoffGit(plan);
	assertHandoffAccount(ctx, cloud);
	assertCloudHandoffAvailable();
	await verifyPublishedHandoffGit(plan, headSha);
	const { modelId, organizationId } = await resolveCloudModel(
		ctx,
		cloud,
		config,
		plan.repoUrl,
	);
	assertHandoffAccount(ctx, cloud);
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
	const target = await cloud.create({
		requestId: request.handoffAttemptId?.trim() || randomUUID(),
		repoUrl: plan.repoUrl,
		branch: plan.branch,
		modelId,
		organizationId: organizationId ?? null,
		...initialTask,
		initialPrompt: command,
	});
	const sessionId = target.sessionId;
	const dashboardUrl = buildCloudHandoffDashboardUrl(
		getClineEnvironmentConfig().appBaseUrl,
		sessionId,
	);
	try {
		saveCloudHandoffFollowUp(sessionId, {
			sourceSessionId,
			command,
			userImages: images,
			initialTask,
		});
	} catch {
		throw new Error(
			`The cloud task was created, but its draft could not be saved. Nothing was sent. Your instruction and images remain local. Open the task before trying again: ${dashboardUrl}`,
		);
	}
	let warning: string | undefined;
	let warningKind: "unqueued" | "unconfirmed" | undefined;
	let dispatched = false;
	try {
		emitProgress("provisioning", "Preparing the cloud workspace.", sessionId);
		const result = await sendWithCloudHandoffFollowUp(
			sessionId,
			command,
			images,
			(lifecycle) =>
				cloud.send(sessionId, command, undefined, modelId, images, {
					beforeDispatch: () => {
						lifecycle?.beforeDispatch?.();
						dispatched = true;
						emitProgress(
							"sending",
							"Sending the summary and your instruction.",
							sessionId,
						);
					},
				}),
		);
		if (result.recoveredAfterDisconnect) {
			warningKind = "unconfirmed";
			warning =
				"The cloud connection was interrupted. Check the conversation before resending the saved prompt.";
		}
	} catch {
		warningKind = dispatched ? "unconfirmed" : "unqueued";
		warning =
			warningKind === "unconfirmed"
				? "The cloud session was created, but delivery is unconfirmed. Check the conversation before resending."
				: "The cloud session was created, but the prepared prompt could not be sent. Open it to recover the saved draft.";
	}
	const result = {
		sourceSessionId,
		sessionId,
		dashboardUrl,
		...(warning ? { warning, warningKind } : {}),
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
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	if (gitPreparations.get(ctx)?.has(sessionId))
		throw new Error("Wait for Git preparation to finish before continuing.");
	let requests = handoffRequests.get(ctx);
	if (!requests) {
		requests = new Map();
		handoffRequests.set(ctx, requests);
	}
	const existing = requests.get(sessionId);
	if (existing) {
		if (!isDeepStrictEqual(existing.request, request))
			throw new Error("A different cloud preparation is already in progress.");
		return await existing.promise;
	}
	const running = handleHandoffOnce(ctx, request, summarize).finally(() =>
		requests.delete(sessionId),
	);
	requests.set(sessionId, {
		request: structuredClone(request),
		promise: running,
	});
	return await running;
}

export function beginActiveSessionSend(
	ctx: SidecarContext,
	sessionId: string,
): () => void {
	ctx = getEnvironmentContext(ctx, ctx.activeEnvironmentId ?? "local");
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

export function hasActiveSessionSend(
	ctx: SidecarContext,
	sessionId: string,
): boolean {
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
		handoffRequests.get(ctx)?.has(sessionId) ||
			gitPreparations.get(ctx)?.has(sessionId),
	);
}
