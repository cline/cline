import {
	buildCloudHandoffDashboardUrl,
	summarizeConversation,
} from "@cline/core";
import {
	type CloudCreationOptions,
	cloudHandoffTranscriptsEqual,
	type HubCloudSessionClient,
	inspectHandoffGit,
	previewHandoffGit,
} from "@cline/core/cloud";
import {
	createMediaBudgetState,
	getClineEnvironmentConfig,
	type MessageWithMetadata,
	validateAndReserveImageMedia,
} from "@cline/shared";

export type CloudHandoffSource = {
	sessionId: string;
	cwd: string;
	messages: MessageWithMetadata[];
};

export type CloudHandoffDraft = {
	instruction: string;
	images: string[];
};

export type CloudHandoffProgress = {
	message: string;
	dashboardUrl?: string;
};

export type CloudHandoffResult = {
	dashboardUrl: string;
	warning?: string;
	retrySend?: () => Promise<CloudHandoffResult>;
};

export async function prepareCloudHandoff(input: {
	readSource: () => Promise<CloudHandoffSource>;
	connection: Parameters<typeof summarizeConversation>[0]["config"];
	creationOptions: CloudCreationOptions;
	cloud: Pick<
		HubCloudSessionClient,
		| "connect"
		| "scope"
		| "prepareHandoffRepository"
		| "listModels"
		| "create"
		| "send"
		| "subscribe"
	>;
	draft: CloudHandoffDraft;
}) {
	const { cloud } = input;
	const draft = structuredClone(input.draft);
	if (draft.images.length > 5) throw new Error("Attach up to 5 images.");
	const budget = createMediaBudgetState();
	for (const image of draft.images) {
		const result = validateAndReserveImageMedia(undefined, image, {}, budget);
		if (!result.ok) throw new Error(result.message);
	}
	const source = await input.readSource();
	if (!source.messages.length)
		throw new Error("Start a local conversation before using /cloud.");
	await cloud.connect();
	const scope = cloud.scope;
	if (!scope) throw new Error("Cloud account is unavailable.");
	const assertAccount = () => {
		if (
			cloud.scope?.serviceId !== scope.serviceId ||
			cloud.scope?.scopeGeneration !== scope.scopeGeneration
		) {
			throw new Error(
				"The cloud account changed. Run /cloud again to review the preparation plan.",
			);
		}
	};
	const plan = await inspectHandoffGit(source.cwd);
	const current = await input.readSource();
	if (
		current.sessionId !== source.sessionId ||
		current.cwd !== source.cwd ||
		!cloudHandoffTranscriptsEqual(source.messages, current.messages)
	) {
		throw new Error(
			"The local conversation changed during capture. Run /cloud again when the turn finishes.",
		);
	}
	const modelId = input.connection.modelId;
	assertAccount();
	const { organizationId } = await cloud.prepareHandoffRepository(
		plan.repoUrl,
		scope,
	);
	const models = await cloud.listModels(scope);
	assertAccount();
	if (!models.some((model) => model.id === modelId)) {
		throw new Error(
			`The selected model ${modelId} is not available in Cline Cloud. Select a supported model before continuing.`,
		);
	}
	const {
		files: _files,
		commits: _commits,
		sourceBranch: _sourceBranch,
		...localGit
	} = plan;
	// Confirmation authorizes this captured snapshot, not later local edits or messages.
	let started: Promise<CloudHandoffResult> | undefined;
	return {
		git: previewHandoffGit(plan),
		start(
			onProgress: (progress: CloudHandoffProgress) => void,
		): Promise<CloudHandoffResult> {
			started ??= (async () => {
				assertAccount();
				onProgress({ message: "Preparing a summary of this conversation." });
				const summary = (
					await summarizeConversation({
						messages: source.messages,
						config: input.connection,
						signal: AbortSignal.timeout(120_000),
					})
				).trim();
				assertAccount();
				if (!summary)
					throw new Error(
						"The conversation summary was empty. Nothing was published or started in cloud.",
					);
				const prompt = [
					summary,
					draft.instruction.trim()
						? `Next instruction from the user:\n${draft.instruction.trim()}`
						: "Continue the unfinished work described above. If no next action is clear, ask the user rather than inventing work.",
				].join("\n\n");
				onProgress({
					message: "Publishing the approved Git snapshot and starting cloud.",
				});
				const dashboard = (id: string) =>
					buildCloudHandoffDashboardUrl(
						getClineEnvironmentConfig().appBaseUrl,
						id,
					);
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
					sessionId = event.sessionId;
					onProgress({
						message: "Preparing the cloud workspace.",
						dashboardUrl: dashboard(sessionId),
					});
				});
				try {
					const result = await cloud.create(
						{
							requestId: plan.id,
							localGit,
							repoUrl: plan.repoUrl,
							branch: plan.branch,
							modelId,
							organizationId: organizationId ?? null,
							...input.creationOptions,
							workspaceRelativePath: plan.workspaceRelativePath || undefined,
							initialMessage: { text: prompt, images: draft.images },
						},
						scope,
					);
					sessionId = result.sessionId;
					assertAccount();
					const send = result.initialSend;
					if (!send)
						throw new Error(
							"Cloud task creation did not confirm the initial message.",
						);
					if ("dispatched" in send) {
						const dashboardUrl = dashboard(sessionId);
						if (send.dispatched)
							return {
								dashboardUrl,
								warning:
									"Delivery is unconfirmed. Check the cloud task before resending.",
							};
						const retrySend = async (): Promise<CloudHandoffResult> => {
							assertAccount();
							try {
								const sent = await cloud.send(
									result.sessionId,
									prompt,
									"queue",
									modelId,
									draft.images,
								);
								assertAccount();

								return {
									dashboardUrl,
									...(sent.recoveredAfterDisconnect
										? {
												warning:
													"The connection was interrupted. Check the cloud task before resending.",
											}
										: {}),
								};
							} catch {
								return {
									dashboardUrl,
									warning:
										"Delivery is unconfirmed. Check the cloud task before resending.",
								};
							}
						};
						return {
							dashboardUrl,
							warning: `The cloud task was created, but the prompt was not sent. ${send.detail ?? send.message}`,
							retrySend,
						};
					}
					return {
						dashboardUrl: dashboard(sessionId),
						...(send.recoveredAfterDisconnect
							? {
									warning:
										"The connection was interrupted. Check the cloud task before resending.",
								}
							: {}),
					};
				} catch (error) {
					assertAccount();
					if (!sessionId) throw error;
					return {
						dashboardUrl: dashboard(sessionId),
						warning:
							"Delivery is unconfirmed. Check the cloud task before resending.",
					};
				} finally {
					unsubscribe();
				}
			})();
			return started;
		},
	};
}

export type PreparedCloudHandoff = Awaited<
	ReturnType<typeof prepareCloudHandoff>
>;
