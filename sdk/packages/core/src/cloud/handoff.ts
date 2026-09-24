import type { AgentMode, MessageWithMetadata } from "@cline/shared";
import {
	buildCloudHandoffDashboardUrl,
	type CloudHandoffFingerprint,
	type CloudHandoffProgress,
	cloudHandoffFingerprintsEqual,
	cloudHandoffTranscriptsEqual,
	createCloudHandoffFingerprint,
	mergeCloudHandoffMetadata,
	preflightCloudHandoffGit,
	readCloudHandoffMetadata,
} from "../services/cloud-handoff";
import {
	CloudHandoffSeedRejectedError,
	type CloudSessionController,
} from "./controller";
import type { CloudModel } from "./models";
import type { CloudCreationOptions } from "./types";

export type CloudHandoffSourceSnapshot = {
	sessionId: string;
	cwd: string;
	modelId?: string;
	mode?: AgentMode;
	config: CloudCreationOptions;
	metadata: Record<string, unknown>;
	messages: MessageWithMetadata[];
	busy: boolean;
	queued: boolean;
};

/** The host owns local persistence and excludes concurrent local mutations. */
export interface CloudHandoffSource {
	read(): Promise<CloudHandoffSourceSnapshot>;
	lock(): () => void;
	updateMetadata(
		sessionId: string,
		metadata: Record<string, unknown>,
	): Promise<void>;
}

export type PreparedCloudHandoff = {
	sourceSessionId: string;
	scopeKey: string;
	fingerprint: CloudHandoffFingerprint;
	config: CloudCreationOptions;
};

export type CloudHandoffCoordinatorOptions = {
	source: CloudHandoffSource;
	cloud: Pick<
		CloudSessionController,
		| "create"
		| "seedHandoff"
		| "verifyHandoffTranscript"
		| "waitUntilReady"
		| "prepareHandoffRepository"
		| "handoffTargetExists"
		| "delete"
	>;
	models(isOrganizationSession: boolean): Promise<CloudModel[]>;
	recoverCreation(
		fingerprint: CloudHandoffFingerprint,
		requestId: string,
	): Promise<string | undefined>;
	scopeKey: string;
	appBaseUrl: string;
	assertAvailable(): void;
	onProgress?(progress: CloudHandoffProgress): void;
	preflight?: typeof preflightCloudHandoffGit;
};

function sameSettings(
	left: CloudCreationOptions | undefined,
	right: CloudCreationOptions,
): boolean {
	return (
		Boolean(left) &&
		left?.autoApproveTools === right.autoApproveTools &&
		left?.thinking === right.thinking &&
		left?.reasoningEffort === right.reasoningEffort
	);
}

/** Host-independent transfer transaction; uses the desktop handoff contracts. */
export class CloudHandoffCoordinator {
	constructor(private readonly options: CloudHandoffCoordinatorOptions) {}
	private async snapshot(): Promise<CloudHandoffSourceSnapshot> {
		this.options.assertAvailable();
		const source = structuredClone(await this.options.source.read());
		if (source.busy)
			throw new Error("Stop the current run before handing off to cloud.");
		if (source.queued)
			throw new Error("Remove queued prompts before handing off to cloud.");
		if (!source.messages.length)
			throw new Error("Start a conversation before handing it off to cloud.");
		if (
			source.metadata.cloudHandoffScope &&
			source.metadata.cloudHandoffScope !== this.options.scopeKey
		)
			throw new Error(
				"Sign back into the account that started this handoff before continuing.",
			);
		return source;
	}
	async prepare(pinnedModelId?: string): Promise<PreparedCloudHandoff> {
		const source = await this.snapshot();
		const previous = readCloudHandoffMetadata(source.metadata);
		if (previous?.status === "complete")
			throw new Error(
				`This conversation continued in cloud: ${previous.dashboardUrl}. Fork locally to continue here.`,
			);
		const git = await (this.options.preflight ?? preflightCloudHandoffGit)({
			cwd: source.cwd,
		});
		const { organizationId } =
			await this.options.cloud.prepareHandoffRepository(git.repoUrl);
		const modelId = source.modelId?.trim();
		if (pinnedModelId && pinnedModelId !== modelId)
			throw new Error("The source model changed. Run /cloud again.");
		const models = await this.options.models(Boolean(organizationId));
		if (!modelId || !models.some((model) => model.id === modelId))
			throw new Error(
				"The selected cloud model is no longer available. Run /cloud again.",
			);
		this.options.assertAvailable();
		return {
			sourceSessionId: source.sessionId,
			scopeKey: this.options.scopeKey,
			config: structuredClone(source.config),
			fingerprint: createCloudHandoffFingerprint({
				...git,
				modelId,
				organizationId,
				...(source.mode && source.mode !== "act" ? { mode: source.mode } : {}),
			}),
		};
	}
	async execute(prepared: PreparedCloudHandoff): Promise<string> {
		const release = this.options.source.lock();
		const progress = (phase: CloudHandoffProgress["phase"], message: string) =>
			this.options.onProgress?.({ phase, message });
		try {
			progress("checking", "Checking the local conversation and repository…");
			const current = await this.prepare(prepared.fingerprint.modelId);
			if (
				prepared.sourceSessionId !== current.sourceSessionId ||
				prepared.scopeKey !== current.scopeKey ||
				!sameSettings(prepared.config, current.config) ||
				!cloudHandoffFingerprintsEqual(
					prepared.fingerprint,
					current.fingerprint,
				)
			)
				throw new Error(
					"The conversation, account, repository, branch, commit, or mode changed. Run /cloud again.",
				);
			const source = await this.snapshot();
			if (
				source.sessionId !== current.sourceSessionId ||
				!sameSettings(source.config, current.config)
			)
				throw new Error(
					"The source conversation or settings changed. Run /cloud again.",
				);
			const fingerprint = current.fingerprint;
			const previous = readCloudHandoffMetadata(source.metadata);
			const intent = source.metadata.cloudHandoffIntent as
				| {
						fingerprint?: CloudHandoffFingerprint;
						config?: CloudCreationOptions;
				  }
				| undefined;
			if (
				(previous &&
					!cloudHandoffFingerprintsEqual(previous.fingerprint, fingerprint)) ||
				(intent &&
					(!cloudHandoffFingerprintsEqual(intent.fingerprint, fingerprint) ||
						!sameSettings(intent.config, source.config)))
			)
				throw new Error(
					"A previous handoff is unresolved for a different repository, commit, or model. Restore those settings and retry /cloud.",
				);
			let outerId = previous?.toCloudSessionId;
			if (!outerId && intent) {
				outerId = await this.options.recoverCreation(
					fingerprint,
					`handoff:${source.sessionId}:${fingerprint.headSha.toLowerCase()}`,
				);
				if (!outerId)
					throw new Error(
						"The earlier cloud creation has an unconfirmed outcome. Retry /cloud later or check the dashboard. No new workspace was created.",
					);
			}
			let createdHere = false;
			let seededMessages: MessageWithMetadata[] = [];
			const save = async (patch: Record<string, unknown>) => {
				this.options.assertAvailable();
				const latest = await this.options.source.read();
				if (latest.sessionId !== source.sessionId)
					throw new Error("The local conversation changed during handoff.");
				await this.options.source.updateMetadata(source.sessionId, {
					...latest.metadata,
					...patch,
				});
			};
			const clear = async () => {
				// A proven rejection/deletion needs only local bookkeeping. Revoking
				// cloud access must not leave a marker for a workspace that cannot exist.
				const latest = await this.options.source.read();
				const savedIntent = latest.metadata.cloudHandoffIntent as
					| { fingerprint?: CloudHandoffFingerprint }
					| undefined;
				const savedHandoff = readCloudHandoffMetadata(latest.metadata);
				if (!savedIntent && !savedHandoff) return;
				if (
					latest.sessionId !== source.sessionId ||
					latest.metadata.cloudHandoffScope !== this.options.scopeKey ||
					!cloudHandoffFingerprintsEqual(
						savedIntent?.fingerprint ?? savedHandoff?.fingerprint,
						fingerprint,
					) ||
					(savedHandoff && outerId && savedHandoff.toCloudSessionId !== outerId)
				)
					throw new Error(
						"The saved handoff changed before cleanup. Reopen the source conversation to recover it.",
					);
				const metadata = { ...latest.metadata };
				for (const key of [
					"handoff",
					"cloudHandoffIntent",
					"cloudHandoffScope",
					"cloudHandoffSeedDispatched",
				])
					delete metadata[key];
				await this.options.source.updateMetadata(source.sessionId, metadata);
			};
			const onSeeding = async () => {
				await save({ cloudHandoffSeedDispatched: true });
				progress("seeding", "Copying the conversation…");
			};
			const readSeed = async () => {
				const latest = await this.snapshot();
				const git = await (this.options.preflight ?? preflightCloudHandoffGit)({
					cwd: latest.cwd,
				});
				const rechecked = createCloudHandoffFingerprint({
					...git,
					modelId: fingerprint.modelId,
					organizationId: fingerprint.organizationId,
					...(latest.mode && latest.mode !== "act"
						? { mode: latest.mode }
						: {}),
				});
				if (
					latest.sessionId !== source.sessionId ||
					!sameSettings(latest.config, source.config) ||
					latest.mode !== source.mode ||
					!cloudHandoffFingerprintsEqual(rechecked, fingerprint)
				)
					throw new Error(
						"The local repository or conversation changed while cloud was starting. Restore the original commit and retry /cloud.",
					);
				seededMessages = structuredClone(latest.messages);
				return seededMessages;
			};
			const persistIntent = () =>
				save({
					cloudHandoffScope: this.options.scopeKey,
					cloudHandoffIntent: { fingerprint, config: source.config },
					...(outerId
						? mergeCloudHandoffMetadata(
								{},
								{
									toCloudSessionId: outerId,
									handedOffAt:
										previous?.handedOffAt ?? new Date().toISOString(),
									status: "pending",
									fingerprint,
									dashboardUrl: buildCloudHandoffDashboardUrl(
										this.options.appBaseUrl,
										outerId,
									),
								},
							)
						: {}),
				});
			if (outerId) await persistIntent();
			try {
				if (outerId) {
					progress("provisioning", "Resuming the existing cloud handoff…");
					if (!(await this.options.cloud.handoffTargetExists(outerId)))
						throw new Error(
							"The pending cloud workspace is not visible. Check the original account and cloud dashboard before retrying.",
						);
					await this.options.cloud.waitUntilReady(outerId);
					await this.options.cloud.seedHandoff(outerId, {
						sourceSessionId: source.sessionId,
						messages: await readSeed(),
						mode: source.mode,
						workspaceRelativePath: fingerprint.workspaceRelativePath,
						config: source.config,
						recoverOnly: source.metadata.cloudHandoffSeedDispatched === true,
						onSeeding,
					});
				} else {
					progress("creating", "Creating the cloud workspace…");
					const result = await this.options.cloud.create({
						...source.config,
						repoUrl: fingerprint.repoUrl,
						branch: fingerprint.branch,
						modelId: fingerprint.modelId,
						organizationId: fingerprint.organizationId ?? null,
						mode: source.mode,
						workspaceRelativePath: fingerprint.workspaceRelativePath,
						requestId: `handoff:${source.sessionId}:${fingerprint.headSha.toLowerCase()}`,
						handoff: {
							onCreating: persistIntent,
							sourceSessionId: source.sessionId,
							resolveMessages: readSeed,
							onOuterSessionCreated: async (id, context) => {
								outerId = id;
								createdHere = context?.created === true;
								await persistIntent();
								progress("provisioning", "Starting the cloud workspace…");
							},
							onOuterSessionRemoved: clear,
							onSeeding,
						},
					});
					outerId = result.sessionId;
				}
				progress("verifying", "Verifying the cloud conversation…");
				await this.options.cloud.verifyHandoffTranscript(
					outerId,
					seededMessages,
					{ allowAppendedMessages: Boolean(previous) },
				);
				const latest = await this.snapshot();
				if (
					latest.sessionId !== source.sessionId ||
					!sameSettings(latest.config, source.config) ||
					latest.mode !== source.mode ||
					!cloudHandoffTranscriptsEqual(latest.messages, seededMessages)
				)
					throw new Error(
						"The local conversation changed during handoff. Retry when it is idle.",
					);
				await save(
					mergeCloudHandoffMetadata(
						{},
						{
							toCloudSessionId: outerId,
							handedOffAt: previous?.handedOffAt ?? new Date().toISOString(),
							status: "complete",
							fingerprint,
							dashboardUrl: buildCloudHandoffDashboardUrl(
								this.options.appBaseUrl,
								outerId,
							),
						},
					),
				);
				progress("complete", "Ready in Cline Cloud.");
				return outerId;
			} catch (error) {
				if (error instanceof CloudHandoffSeedRejectedError) {
					const latest = await this.options.source.read();
					if (
						latest.sessionId !== source.sessionId ||
						readCloudHandoffMetadata(latest.metadata)?.toCloudSessionId !==
							outerId
					)
						throw new Error(
							"The saved handoff changed before its seed marker could be cleared.",
							{ cause: error },
						);
					const { cloudHandoffSeedDispatched: _seedDispatched, ...metadata } =
						latest.metadata;
					await this.options.source.updateMetadata(source.sessionId, metadata);
				}
				if (
					!outerId &&
					error instanceof Error &&
					error.name === "CloudHandoffCreationRejectedError"
				)
					await clear();
				// Preserve resumable targets, including ambiguous provisioning/seeding.
				// Only a definitely invalid freshly-seeded transcript can be discarded.
				if (
					createdHere &&
					outerId &&
					error instanceof Error &&
					[
						"CloudHandoffTranscriptMismatchError",
						"CloudHandoffSeedUnsupportedError",
					].includes(error.name)
				) {
					await this.options.cloud.delete(outerId);
					await clear();
				}
				throw error;
			}
		} finally {
			release();
		}
	}
}
