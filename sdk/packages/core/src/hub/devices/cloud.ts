import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
	getClineEnvironmentConfig,
	type HubEventEnvelope,
} from "@cline/shared";
import { ClineAccountService } from "../../account";
import {
	CloudSessionApi,
	CloudSessionController,
	type CloudSessionEvent,
	normalizeGitHubRemoteUrl,
} from "../../cloud";
import { RuntimeOAuthTokenManager } from "../../runtime/orchestration/runtime-oauth-token-manager";

const execFileAsync = promisify(execFile);

/** A new cloud task clones the remote branch; local files are never uploaded. */
export async function resolveCloudRepository(cwd: string) {
	const git = async (...args: string[]) =>
		(await execFileAsync("git", args, { cwd, timeout: 15_000 })).stdout.trim();
	try {
		const branch = await git("symbolic-ref", "--quiet", "--short", "HEAD");
		const remote = await git(
			"config",
			"--get",
			`branch.${branch}.remote`,
		).catch(() => "origin");
		const merge = await git("config", "--get", `branch.${branch}.merge`).catch(
			() => `refs/heads/${branch}`,
		);
		const repoUrl = normalizeGitHubRemoteUrl(
			await git("remote", "get-url", remote),
		);
		if (!repoUrl || !merge.startsWith("refs/heads/")) throw new Error();
		const workspaceRelativePath = await git("rev-parse", "--show-prefix");
		return {
			repoUrl,
			branch: merge.slice("refs/heads/".length),
			workspaceRelativePath:
				workspaceRelativePath.replace(/\/$/, "") || undefined,
		};
	} catch {
		// Git errors can contain credential-bearing remote URLs.
		throw new Error(
			"Cloud session needs a GitHub repository and a pushed branch",
		);
	}
}

export type DeviceCloudController = Pick<
	CloudSessionController,
	| "subscribe"
	| "create"
	| "send"
	| "abort"
	| "respondApproval"
	| "dispose"
	| "listModels"
>;

/** Projects the shared cloud lifecycle onto the same device protocol as local tasks. */
export class DeviceCloudSessions {
	private readonly sessions = new Set<string>();
	private readonly approvals = new Map<
		string,
		{ session: string; approval: string }
	>();
	private readonly listeners = new Set<(event: HubEventEnvelope) => void>();
	private readonly unsubscribe: () => void;

	constructor(
		private readonly controller: DeviceCloudController,
		private readonly log: (message: string) => void,
	) {
		this.unsubscribe = controller.subscribe((event) => this.project(event));
	}

	subscribe(listener: (event: HubEventEnvelope) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(
		event: string,
		sessionId: string,
		payload: Record<string, unknown> = {},
	) {
		for (const listener of this.listeners)
			listener({
				version: "v1",
				event,
				sessionId,
				payload,
			} as HubEventEnvelope);
	}

	private project(event: CloudSessionEvent) {
		if (event.type === "hub_event") {
			// Remote workspace paths must never become the next local workspace.
			if (
				[
					"session.created",
					"session.updated",
					"approval.requested",
					"approval.resolved",
				].includes(event.event.event)
			)
				return;
			for (const listener of this.listeners) listener(event.event);
		} else if (event.type === "snapshot") {
			const { snapshot, sessionId } = event;
			this.emit("session.updated", sessionId, {
				session: { status: snapshot.busy ? "running" : snapshot.status },
			});
			const current = new Set<string>();
			for (const approval of snapshot.approvals) {
				const existing = [...this.approvals].find(
					([, target]) =>
						target.session === sessionId &&
						target.approval === approval.approvalId,
				);
				const id = existing?.[0] ?? `cloud:${randomUUID()}`;
				current.add(id);
				if (existing) continue;
				this.approvals.set(id, {
					session: sessionId,
					approval: approval.approvalId,
				});
				this.emit("approval.requested", sessionId, {
					approvalId: id,
					sessionId,
					toolName: approval.toolName,
					inputJson: JSON.stringify(approval.input),
				});
			}
			for (const [id, approval] of this.approvals) {
				if (approval.session === sessionId && !current.has(id)) {
					this.approvals.delete(id);
					this.emit("approval.resolved", sessionId, { approvalId: id });
				}
			}
		} else if (event.type === "sync_failed") {
			this.emit("run.failed", event.sessionId, { error: event.message });
		} else if (event.type === "removed") {
			this.emit("session.detached", event.sessionId);
		}
	}

	owns(sessionId: string) {
		return this.sessions.has(sessionId);
	}
	hasApproval(id: string) {
		return this.approvals.has(id);
	}

	async start(prompt: string, workspace: string, preferredModel?: string) {
		const modelId =
			preferredModel ?? (await this.controller.listModels())[0]?.id;
		if (!modelId)
			throw new Error("No cloud models available for your Cline account");
		const repository = await resolveCloudRepository(workspace);
		const { sessionId } = await this.controller.create({
			...repository,
			modelId,
			initialPrompt: prompt,
			mode: "yolo",
			autoApproveTools: true,
			sandboxType: "resumable",
		});
		this.sessions.add(sessionId);
		await this.send(sessionId, prompt);
		return sessionId;
	}

	/** The controller signals actual acceptance before the long-running turn resolves. */
	async send(sessionId: string, prompt: string, delivery?: "queue") {
		let accepted!: () => void;
		const acceptance = new Promise<void>((resolve) => {
			accepted = resolve;
		});
		const unsubscribe = this.controller.subscribe((event) => {
			if (
				event.type === "prompt_accepted" &&
				event.sessionId === sessionId &&
				event.prompt === prompt
			)
				accepted();
		});
		const pending = this.controller.send(sessionId, prompt, delivery);
		pending.catch((error) => {
			this.log(
				`cloud prompt failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			this.emit("run.failed", sessionId, {
				error: error instanceof Error ? error.message : String(error),
			});
		});
		try {
			await Promise.race([acceptance, pending]);
		} finally {
			unsubscribe();
		}
	}

	async respondApproval(id: string, approved: boolean) {
		const target = this.approvals.get(id);
		if (!target) throw new Error("Cloud approval is no longer available");
		await this.controller.respondApproval(target.session, target.approval, {
			approved,
		});
	}
	async abort(sessionId: string) {
		await this.controller.abort(sessionId);
	}
	async dispose() {
		this.unsubscribe();
		await this.controller.dispose();
	}
}

export function createDeviceCloudSessions(log: (message: string) => void) {
	const environment = getClineEnvironmentConfig();
	const tokens = new RuntimeOAuthTokenManager();
	const getAuthToken = async () =>
		(await tokens.resolveProviderApiKey({ providerId: "cline" }))?.apiKey;
	const account = new ClineAccountService({
		apiBaseUrl: environment.apiBaseUrl,
		getAuthToken,
	});
	return new DeviceCloudSessions(
		new CloudSessionController({
			api: new CloudSessionApi({ ...environment, getAuthToken }),
			apiBaseUrl: environment.apiBaseUrl,
			getAuthToken,
			getActiveOrganizationId: async () =>
				(await account.fetchUserOrganizations())?.find(
					(organization) => organization.active,
				)?.organizationId,
			clientIdentity: {
				prefix: "device-cloud",
				type: "cline-device-cloud",
				displayName: "Cline Device cloud session",
				source: "device",
			},
		}),
		log,
	);
}
