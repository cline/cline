import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
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

export type CloudAgentConfigSource =
	| { type: "git"; url: string; ref: string; path: string }
	| { type: "local"; path: string };

export interface CloudAgentConfigExtension {
	name: string;
	source: CloudAgentConfigSource;
}

export interface CloudAgentConfigConfiguration {
	skills?: CloudAgentConfigExtension[];
	rules?: CloudAgentConfigExtension[];
}

interface ProvisionedAgentConfig {
	extensions: {
		skills: Array<{
			name: string;
			source:
				| { type: "git"; url: string; ref: string; path: string }
				| { type: "capsule"; path: string };
		}>;
		rules: Array<{
			name: string;
			source:
				| { type: "git"; url: string; ref: string; path: string }
				| { type: "capsule"; path: string };
		}>;
	};
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
	agentConfig?: ProvisionedAgentConfig;
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
	/** Optional pinned Git or explicitly selected local skills/rules. */
	agentConfig?: CloudAgentConfigConfiguration;
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
	private nodeDestroyPromise: Promise<void> | undefined;
	private teamCleanupPromise: Promise<void> | undefined;

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
		this.destroyed = true;
		if (reason === "team_cleanup") {
			if (!this.teamCleanupPromise) {
				this.teamCleanupPromise = (async () => {
					// A teammate may already have been explicitly destroyed. Whole-team
					// cleanup is a broader operation and must still run so capsules and
					// the durable cloud team are deleted.
					await this.nodeDestroyPromise?.catch(() => undefined);
					await this.controlPlane.destroyTeammate({
						...this.identity,
						reason: "team_cleanup",
					});
				})().catch((error) => {
					this.teamCleanupPromise = undefined;
					throw error;
				});
			}
			return this.teamCleanupPromise;
		}
		if (this.teamCleanupPromise) {
			return this.teamCleanupPromise;
		}
		if (!this.nodeDestroyPromise) {
			this.nodeDestroyPromise = this.controlPlane
				.destroyTeammate({ ...this.identity, reason })
				.catch((error) => {
					this.nodeDestroyPromise = undefined;
					throw error;
				});
		}
		return this.nodeDestroyPromise;
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
		const preparedConfig = prepareAgentConfig(
			options.configuration.agentConfig,
		);
		const plan = await buildWorkspaceCapsulePlan({
			...options.configuration.initialCapsule,
			roots: [
				...options.configuration.initialCapsule.roots,
				...preparedConfig.roots,
			],
			selections: [
				...options.configuration.initialCapsule.selections,
				...preparedConfig.selections,
			],
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
					agentConfig: preparedConfig.config,
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

function prepareAgentConfig(
	config: CloudAgentConfigConfiguration | undefined,
): {
	roots: WorkspaceCapsuleApprovedRoot[];
	selections: WorkspaceCapsuleSelection[];
	config?: ProvisionedAgentConfig;
} {
	if (!config) return { roots: [], selections: [] };
	const roots: WorkspaceCapsuleApprovedRoot[] = [];
	const selections: WorkspaceCapsuleSelection[] = [];
	const usedNames = new Set<string>();
	const convert = (
		items: CloudAgentConfigExtension[] | undefined,
		kind: "skills" | "rules",
	) =>
		(items ?? []).map((item, index) => {
			if (!/^[A-Za-z0-9_-]+$/.test(item.name)) {
				throw new Error(`Invalid cloud agent ${kind} name: ${item.name}`);
			}
			const key = `${kind}:${item.name.toLowerCase()}`;
			if (usedNames.has(key))
				throw new Error(`Duplicate cloud agent ${kind} name: ${item.name}`);
			usedNames.add(key);
			if (item.source.type === "git") {
				return {
					name: item.name,
					source: {
						type: "git" as const,
						url: item.source.url,
						ref: item.source.ref,
						path: item.source.path,
					},
				};
			}
			const extension =
				kind === "rules" ? extname(item.source.path).toLowerCase() : "";
			if (
				kind === "rules" &&
				![".md", ".markdown", ".txt"].includes(extension)
			) {
				throw new Error(
					`Cloud agent rule ${item.name} must be a Markdown or text file`,
				);
			}
			const rootId = `cline-config-${kind}-${index}`;
			const destination = `.cline-agent-config/${kind}/${item.name}${extension}`;
			roots.push({ id: rootId, path: dirname(item.source.path) });
			selections.push({
				rootId,
				path: basename(item.source.path),
				purpose: "artifact",
				destination,
			});
			return {
				name: item.name,
				source: { type: "capsule" as const, path: destination },
			};
		});
	const skills = convert(config.skills, "skills");
	const rules = convert(config.rules, "rules");
	return { roots, selections, config: { extensions: { skills, rules } } };
}
