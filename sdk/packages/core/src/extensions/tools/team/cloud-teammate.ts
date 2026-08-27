import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentResult,
	WorkspaceCapsuleArchiveMetadata,
	WorkspaceCapsuleGitMetadata,
	WorkspaceCapsuleManifest,
} from "@cline/shared";
import {
	buildWorkspaceCapsulePlan,
	type WorkspaceCapsuleApprovedRoot,
	type WorkspaceCapsuleLimits,
	type WorkspaceCapsuleSelection,
	type WorkspaceCapsuleSkippedPath,
	writeWorkspaceCapsuleArchive,
} from "../../../services/workspace-capsule";
import type { AgentTeamsRuntime, ManagedTeammateRunner } from "./multi-agent";

export interface CloudInitialCapsuleConfiguration {
	/** Parent-approved local roots. Their host paths are never serialized. */
	roots: WorkspaceCapsuleApprovedRoot[];
	/** Parent-selected inputs. The cloud-spawn tool cannot expand this set. */
	selections: WorkspaceCapsuleSelection[];
	limits?: Partial<WorkspaceCapsuleLimits>;
	/** Optional source-control context. Git and GitHub are not required. */
	git?: WorkspaceCapsuleGitMetadata;
}

export interface CloudTeammateProvisionInput {
	teamId: string;
	teamName: string;
	agentId: string;
	rolePrompt: string;
	initialCapsule: {
		archivePath: string;
		metadata: WorkspaceCapsuleArchiveMetadata;
		manifest: WorkspaceCapsuleManifest;
	};
	/** Cancels client-side upload/readiness polling only. */
	signal?: AbortSignal;
}

export interface CloudTeammateProvisionResult {
	nodeId: string;
	/** Local sensitive inputs omitted from the uploaded capsule. */
	skippedPaths?: WorkspaceCapsuleSkippedPath[];
}

export interface CloudTeammateRunInput {
	teamId: string;
	teamName: string;
	nodeId: string;
	agentId: string;
	message: string;
	/** Core must treat teamId + runId as idempotent when provided. */
	runId?: string;
	/** Cancels client polling only; it must not cancel the durable Core run. */
	signal?: AbortSignal;
	taskId?: string;
	fromAgentId?: string;
	continueConversation?: boolean;
}

/**
 * Adapter implemented by Core (or a local fake Core service). Provisioning
 * must consume archivePath before its promise resolves because the temporary
 * archive is deleted immediately afterwards.
 */
export interface CloudTeammateControlPlane {
	provisionTeammate(
		input: CloudTeammateProvisionInput,
	): Promise<CloudTeammateProvisionResult>;
	reattachTeammate(input: {
		teamId: string;
		teamName: string;
		nodeId: string;
		agentId: string;
	}): Promise<CloudTeammateProvisionResult>;
	runTeammateTask(input: CloudTeammateRunInput): Promise<AgentResult>;
	destroyTeammate(input: {
		teamId: string;
		teamName: string;
		nodeId: string;
		agentId: string;
		reason?: string;
	}): Promise<void>;
}

export interface CloudTeammateConfiguration {
	/** Explicit one-time opt-in. Omit the configuration to disable cloud tools. */
	enabled: true;
	controlPlane: CloudTeammateControlPlane;
	initialCapsule: CloudInitialCapsuleConfiguration;
}

export interface ProvisionCloudTeammateOptions {
	runtime: AgentTeamsRuntime;
	configuration: CloudTeammateConfiguration;
	agentId: string;
	rolePrompt: string;
	signal?: AbortSignal;
}

export interface ReattachCloudTeammateOptions {
	runtime: AgentTeamsRuntime;
	configuration: CloudTeammateConfiguration;
	agentId: string;
	rolePrompt: string;
	nodeId: string;
}

const pendingCloudSpawns = new WeakMap<AgentTeamsRuntime, Set<string>>();

class CloudManagedTeammateRunner implements ManagedTeammateRunner {
	private busy = false;
	private destroyed = false;
	private destroyPromise: Promise<void> | undefined;

	constructor(
		private readonly controlPlane: CloudTeammateControlPlane,
		private readonly identity: {
			teamId: string;
			teamName: string;
			nodeId: string;
			agentId: string;
		},
	) {}

	canStartRun(): boolean {
		return !this.busy && !this.destroyed;
	}

	async run(
		message: string,
		options?: {
			runId?: string;
			signal?: AbortSignal;
			taskId?: string;
			fromAgentId?: string;
			continueConversation?: boolean;
		},
	): Promise<AgentResult> {
		if (!this.canStartRun()) {
			throw new Error(
				`Cloud teammate "${this.identity.agentId}" is unavailable`,
			);
		}
		this.busy = true;
		try {
			return await this.controlPlane.runTeammateTask({
				...this.identity,
				message,
				...options,
			});
		} finally {
			// Core owns node serialization and run idempotency. This flag protects
			// only concurrent calls in the current process, so it must be released
			// when a caller stops waiting for a still-durable remote run.
			this.busy = false;
		}
	}

	detach(): void {
		// Core owns the durable node and any active run. A parent lifecycle
		// shutdown intentionally leaves both alive for a later reattachment.
	}

	shutdown(reason?: string): Promise<void> {
		if (!this.destroyPromise) {
			this.destroyed = true;
			this.destroyPromise = this.controlPlane
				.destroyTeammate({
					...this.identity,
					reason,
				})
				.catch((error) => {
					this.destroyPromise = undefined;
					throw error;
				});
		}
		return this.destroyPromise;
	}
}

/** Reattach an existing durable cloud node without provisioning or hydrating. */
export async function reattachCloudTeammate(
	options: ReattachCloudTeammateOptions,
): Promise<CloudTeammateProvisionResult> {
	const teamId = options.runtime.getTeamId();
	const teamName = options.runtime.getTeamName();
	if (!options.nodeId.trim()) {
		throw new Error("Cannot reattach a cloud teammate without a nodeId");
	}
	const reattached = await options.configuration.controlPlane.reattachTeammate({
		teamId,
		teamName,
		nodeId: options.nodeId,
		agentId: options.agentId,
	});
	if (reattached.nodeId !== options.nodeId) {
		throw new Error(
			"Cloud control plane returned a mismatched reattached nodeId",
		);
	}
	options.runtime.spawnManagedTeammate({
		agentId: options.agentId,
		description: options.rolePrompt,
		runner: new CloudManagedTeammateRunner(options.configuration.controlPlane, {
			teamId,
			teamName,
			nodeId: options.nodeId,
			agentId: options.agentId,
		}),
		lifecycle: {
			rolePrompt: options.rolePrompt,
			execution: "cloud",
			runtimeAgentId: options.nodeId,
		},
	});
	return reattached;
}

/** Build the parent-selected capsule, provision one cloud node, and register
 * its runner in the existing Teams runtime. */
export async function provisionCloudTeammate(
	options: ProvisionCloudTeammateOptions,
): Promise<CloudTeammateProvisionResult> {
	if (!options.configuration.enabled) {
		throw new Error("Cloud teammates are not enabled for this session");
	}
	let pending = pendingCloudSpawns.get(options.runtime);
	if (!pending) {
		pending = new Set<string>();
		pendingCloudSpawns.set(options.runtime, pending);
	}
	if (pending.has(options.agentId)) {
		throw new Error(
			`Teammate "${options.agentId}" is already being provisioned`,
		);
	}
	pending.add(options.agentId);
	try {
		if (options.runtime.isTeammateActive(options.agentId)) {
			throw new Error(`Teammate "${options.agentId}" is already active`);
		}
		const existingMember = options.runtime
			.getSnapshot()
			.members.find((member) => member.agentId === options.agentId);
		if (existingMember && existingMember.status !== "stopped") {
			throw new Error(`Team member "${options.agentId}" already exists`);
		}

		const teamId = options.runtime.getTeamId();
		const teamName = options.runtime.getTeamName();
		const plan = await buildWorkspaceCapsulePlan({
			...options.configuration.initialCapsule,
			team: { teamId, agentId: options.agentId },
		});
		const temporaryDirectory = await mkdtemp(
			join(tmpdir(), "cline-cloud-capsule-"),
		);
		const archivePath = join(temporaryDirectory, "initial.cline-capsule.tgz");

		try {
			const metadata = await writeWorkspaceCapsuleArchive(plan, archivePath);
			const provisioned =
				await options.configuration.controlPlane.provisionTeammate({
					teamId,
					teamName,
					agentId: options.agentId,
					rolePrompt: options.rolePrompt,
					initialCapsule: {
						archivePath,
						metadata,
						manifest: plan.manifest,
					},
					signal: options.signal,
				});
			try {
				if (!provisioned.nodeId.trim()) {
					throw new Error("Cloud control plane returned an empty nodeId");
				}

				options.runtime.spawnManagedTeammate({
					agentId: options.agentId,
					description: options.rolePrompt,
					runner: new CloudManagedTeammateRunner(
						options.configuration.controlPlane,
						{
							teamId,
							teamName,
							nodeId: provisioned.nodeId,
							agentId: options.agentId,
						},
					),
					lifecycle: {
						rolePrompt: options.rolePrompt,
						execution: "cloud",
						runtimeAgentId: provisioned.nodeId,
					},
				});
			} catch (registrationError) {
				try {
					await options.configuration.controlPlane.destroyTeammate({
						teamId,
						teamName,
						nodeId: provisioned.nodeId,
						agentId: options.agentId,
						reason: "parent_registration_failed",
					});
				} catch (destroyError) {
					throw new AggregateError(
						[registrationError, destroyError],
						"Cloud teammate registration failed and the provisioned node could not be destroyed",
					);
				}
				throw registrationError;
			}
			return { ...provisioned, skippedPaths: plan.skippedPaths };
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	} finally {
		pending.delete(options.agentId);
		if (pending.size === 0) pendingCloudSpawns.delete(options.runtime);
	}
}
