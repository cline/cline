// SdkCloudTaskTarget — the one writer and the one reader of "where does the
// next task run".
//
// The user makes three kinds of choice (Local/Cloud, a repository, a branch)
// and each is stored as itself. Everything else the panel shows and the
// composer submits — which repository the account can actually reach, which
// branch to start on — is resolved here from the stored choice, the active
// account's repositories and the workspace's git remote, on every state post.
// Nothing derived is ever written back, so no background lookup can overwrite
// a choice the user made while it was in flight.

import { type CloudTaskTargetSelection, type CloudTaskTargetView, normalizeGitHubRemoteUrl } from "@shared/cloud/cloud-sessions"
import type { StateManager } from "@/core/storage/StateManager"
import {
	type CloudRepository,
	CloudSessionError,
	type CloudSessionsService,
	type GitHubConnectionResult,
} from "@/services/cloud/CloudSessionsService"
import { resolveWorkspaceCloudDefaults } from "@/services/cloud/workspace-cloud-defaults"

/** GitHub App connection for the active account, or `signedIn: false` when there is none. */
export interface GitHubConnectionStatus extends GitHubConnectionResult {
	signedIn: boolean
	/** Set when the request failed (network / API error); other fields are then unreliable. */
	error?: string
}

export type CloudTaskTargetChoice = { target: "local" | "cloud" } | { repositoryId: number } | { branch: string }

export interface SdkCloudTaskTargetOptions {
	cloudSessions: CloudSessionsService
	stateManager: StateManager
	/** Identity of the active account (user and organization), or undefined when signed out. */
	getAccountScope: () => string | undefined
	/** Primary workspace root as last observed; undefined without a workspace. */
	getWorkspaceRoot: () => string | undefined
	postStateToWebview: () => Promise<void>
	now?: () => number
}

/** How long a failed lookup is left alone before a read retries it. */
export const LOOKUP_RETRY_MS = 30_000

interface WorkspaceDefaults {
	repoUrl?: string
	branch?: string
}

/**
 * One input to the resolved target, cached under the key it was loaded for
 * (account scope, workspace root, repository+branch). A read under a new
 * key discards the old value and starts a load; a load whose slot has been
 * replaced meanwhile is dropped, by identity, not by key.
 */
class Lookup<T> {
	private key: string | undefined
	private value: T | undefined
	private pending: Promise<void> | undefined
	private failedAt: number | undefined

	constructor(
		private readonly onLoaded: () => void,
		private readonly now: () => number,
	) {}

	/** The cached value for `key`, starting a load in the background when there is none. */
	read(key: string, load: () => Promise<T>): T | undefined {
		this.start(key, load, false)
		return this.value
	}

	/** The value for `key`, loaded now when there is none; `refresh` discards the cached one first. */
	async get(key: string, load: () => Promise<T>, refresh: boolean): Promise<T | undefined> {
		await this.start(key, load, refresh)
		return this.value
	}

	private start(key: string, load: () => Promise<T>, refresh: boolean): Promise<void> {
		if (this.key !== key || refresh) {
			this.key = key
			this.value = undefined
			this.pending = undefined
			this.failedAt = undefined
		}
		if (this.value !== undefined) {
			return Promise.resolve()
		}
		if (this.pending) {
			return this.pending
		}
		if (this.failedAt !== undefined && this.now() - this.failedAt < LOOKUP_RETRY_MS) {
			return Promise.resolve()
		}
		const pending: Promise<void> = load().then(
			(value) => {
				if (this.pending !== pending) {
					return
				}
				this.pending = undefined
				this.value = value
				this.onLoaded()
			},
			() => {
				if (this.pending !== pending) {
					return
				}
				this.pending = undefined
				this.failedAt = this.now()
			},
		)
		this.pending = pending
		return pending
	}
}

export class SdkCloudTaskTarget {
	private readonly connection: Lookup<GitHubConnectionStatus>
	private readonly workspace: Lookup<WorkspaceDefaults>
	private readonly workspaceBranch: Lookup<boolean>

	constructor(private readonly options: SdkCloudTaskTargetOptions) {
		// A landed input posts state so the panel and composer see the new view.
		const onLoaded = () => void options.postStateToWebview().catch(() => {})
		const now = () => options.now?.() ?? Date.now()
		this.connection = new Lookup(onLoaded, now)
		this.workspace = new Lookup(onLoaded, now)
		this.workspaceBranch = new Lookup(onLoaded, now)
	}

	// ---- Writes: one field per user choice ----

	async choose(choice: CloudTaskTargetChoice): Promise<void> {
		const current = this.selection()
		let next: CloudTaskTargetSelection
		if ("target" in choice) {
			next = { ...current, target: choice.target }
		} else if ("repositoryId" in choice) {
			// A branch belongs to the repository it was chosen for.
			next = { target: "cloud", repositoryId: choice.repositoryId }
		} else {
			// The branch attaches to the repository the user is looking at, which
			// the view resolved and the stored selection may not name.
			next = {
				target: "cloud",
				repositoryId: this.view().repositoryId ?? current.repositoryId,
				branch: choice.branch.trim() || undefined,
			}
		}
		this.options.stateManager.setGlobalState("cloudTaskTarget", next)
		await this.options.postStateToWebview()
	}

	private selection(): CloudTaskTargetSelection {
		return this.options.stateManager.getGlobalStateKey("cloudTaskTarget") ?? { target: "local" }
	}

	// ---- Reads: the resolved target, from whatever inputs are known now ----

	/**
	 * The target as it stands. An input not yet known is requested in the
	 * background and the state is posted again when it arrives, so the view
	 * converges without anything being written. Local starts no lookups.
	 */
	view(): CloudTaskTargetView {
		const selection = this.selection()
		if (selection.target !== "cloud") {
			return { target: "local" }
		}
		const workspace = this.workspaceDefaults()
		const view: CloudTaskTargetView = { target: "cloud", workspaceRepoUrl: workspace?.repoUrl }
		const repositories = this.cachedConnection()?.repositories ?? []
		const repository =
			repositories.find((repo) => repo.id === selection.repositoryId) ??
			repositories.find((repo) => this.isWorkspaceRepository(repo, workspace)) ??
			repositories[0]
		if (!repository) {
			return view
		}
		view.repositoryId = repository.id
		view.repoUrl = normalizeGitHubRemoteUrl(repository.url) ?? repository.url
		const chosenBranch = selection.repositoryId === repository.id ? selection.branch : undefined
		const workspaceBranch =
			workspace?.branch && this.isWorkspaceRepository(repository, workspace)
				? this.confirmedWorkspaceBranch(repository, workspace.branch)
				: undefined
		view.branch = chosenBranch ?? workspaceBranch ?? repository.defaultBranch ?? undefined
		return view
	}

	private isWorkspaceRepository(repo: CloudRepository, workspace: WorkspaceDefaults | undefined): boolean {
		return !!workspace?.repoUrl && normalizeGitHubRemoteUrl(repo.url) === workspace.repoUrl
	}

	// ---- Inputs, each cached under the key it depends on ----

	/**
	 * The active account's GitHub App connection and repositories, for the
	 * Account view and the onboarding card. `refresh` re-asks the control plane.
	 * The cache is keyed by account scope, so another account's repositories
	 * are never returned as this one's.
	 */
	async connectionStatus(refresh = false): Promise<GitHubConnectionStatus> {
		const scope = this.options.getAccountScope()
		const status = scope && (await this.connection.get(scope, () => this.fetchConnection(), refresh))
		return status || this.signedOut()
	}

	private cachedConnection(): GitHubConnectionStatus | undefined {
		const scope = this.options.getAccountScope()
		return scope ? this.connection.read(scope, () => this.fetchConnection()) : undefined
	}

	private async fetchConnection(): Promise<GitHubConnectionStatus> {
		try {
			return { signedIn: true, ...(await this.options.cloudSessions.getGitHubConnection()) }
		} catch (error) {
			if (error instanceof CloudSessionError && error.code === "authentication_required") {
				return this.signedOut()
			}
			return { ...this.signedOut(), signedIn: true, error: error instanceof Error ? error.message : String(error) }
		}
	}

	private signedOut(): GitHubConnectionStatus {
		return { signedIn: false, connected: false, connectUrl: this.options.cloudSessions.githubConnectUrl(), repositories: [] }
	}

	private workspaceDefaults(): WorkspaceDefaults | undefined {
		const cwd = this.options.getWorkspaceRoot()
		return cwd ? this.workspace.read(cwd, () => resolveWorkspaceCloudDefaults(cwd)) : undefined
	}

	/**
	 * The workspace branch, once GitHub confirms `repository` has it. A local
	 * remote-tracking ref can outlive the branch on GitHub, so GitHub is asked
	 * by name rather than trusting the ref or the first page of branches.
	 */
	private confirmedWorkspaceBranch(repository: CloudRepository, branch: string): string | undefined {
		const exists = this.workspaceBranch.read(`${repository.id}:${branch}`, async () =>
			(await this.options.cloudSessions.listBranches(repository.id, branch)).includes(branch),
		)
		return exists ? branch : undefined
	}
}
