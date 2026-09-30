import { type CloudTaskTargetSelection, formatRepoLabel, normalizeGitHubRemoteUrl } from "@shared/cloud/cloud-sessions"
import { CloudTaskTarget, type GitHubRepository, RepositoryBranchesRequest } from "@shared/proto/cline/cloud"
import { EmptyRequest } from "@shared/proto/cline/common"
import { CloudIcon, GitBranchIcon, MonitorIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useClineAuth, useClineSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useGitHubConnection } from "@/hooks/useGitHubConnection"
import { cn } from "@/lib/utils"
import { CloudServiceClient } from "@/services/grpc-client"
import { CloudOnboardingCard, type CloudOnboardingVariant } from "./CloudOnboardingCard"
import { SearchableSelect } from "./SearchableSelect"

const GITHUB_ICON = (
	<svg aria-hidden="true" className="size-3" fill="currentColor" viewBox="0 0 16 16">
		<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
	</svg>
)

/**
 * Home-screen chooser for where the next task runs. Lives above the composer
 * (not in it) so the live-chat controls stay uncluttered: Local | Cloud, and
 * for Cloud the GitHub repository and branch (prefilled from the open
 * workspace's origin remote) or the onboarding steps when GitHub isn't set up.
 */
export function TaskTargetPanel() {
	const { cloudTaskTarget, workspaceRoots, primaryRootIndex } = useExtensionState()
	const { clineUser } = useClineAuth()
	const { handleSignIn } = useClineSignIn()
	const signedIn = !!clineUser?.uid
	const target = cloudTaskTarget?.target ?? "local"
	const isCloud = target === "cloud"

	const { connection, loading, refresh } = useGitHubConnection(isCloud && signedIn)
	const [waitingForGitHub, setWaitingForGitHub] = useState(false)
	const [workspaceDefaults, setWorkspaceDefaults] = useState<{ repoUrl?: string; branch?: string }>()
	const [branches, setBranches] = useState<string[]>([])
	const [branchesLoading, setBranchesLoading] = useState(false)
	const branchRequest = useRef(0)

	const repositories = connection?.repositories ?? []
	const selectedRepo = useMemo(
		() =>
			repositories.find(
				(repo) =>
					repo.id === Number(cloudTaskTarget?.repositoryId) ||
					(cloudTaskTarget?.repoUrl &&
						normalizeGitHubRemoteUrl(repo.url) === normalizeGitHubRemoteUrl(cloudTaskTarget.repoUrl)),
			),
		[repositories, cloudTaskTarget?.repositoryId, cloudTaskTarget?.repoUrl],
	)

	// The stored target is read here at call time, not captured, so a write that
	// follows an await (the branch check) sees the selection as it is then.
	const currentTarget = useRef(cloudTaskTarget)
	currentTarget.current = cloudTaskTarget
	const persist = useCallback(
		(
			selection:
				| CloudTaskTargetSelection
				| ((current: CloudTaskTargetSelection | undefined) => CloudTaskTargetSelection | undefined),
		) => {
			const next = typeof selection === "function" ? selection(currentTarget.current) : selection
			if (!next) {
				return
			}
			CloudServiceClient.setCloudTaskTarget(
				CloudTaskTarget.create({
					target: next.target,
					repoUrl: next.repoUrl,
					repositoryId: next.repositoryId,
					branch: next.branch,
				}),
			).catch((error) => console.error("Failed to save task target:", error))
		},
		[],
	)

	// Workspace git remote/branch, used to preselect the repository and branch.
	useEffect(() => {
		if (!isCloud) {
			return
		}
		CloudServiceClient.getWorkspaceCloudDefaults(EmptyRequest.create())
			.then((defaults) => setWorkspaceDefaults({ repoUrl: defaults.repoUrl, branch: defaults.branch }))
			.catch(() => setWorkspaceDefaults({}))
	}, [isCloud, workspaceRoots, primaryRootIndex])

	// The stored repository belongs to whichever account chose it. Once the
	// current account's repositories are known and the stored one is not among
	// them, drop it, so the composer does not treat a repository this account
	// never selected as ready to submit.
	useEffect(() => {
		if (!isCloud || !connection?.connected || selectedRepo || !cloudTaskTarget?.repoUrl) {
			return
		}
		persist({ target: "cloud", repoUrl: undefined, repositoryId: undefined, branch: undefined })
	}, [isCloud, connection?.connected, selectedRepo, cloudTaskTarget?.repoUrl, persist])

	// Once repositories are known, pick the workspace's repo (or the first one) when nothing valid is selected.
	useEffect(() => {
		if (!isCloud || !connection?.connected || repositories.length === 0 || !workspaceDefaults) {
			return
		}
		if (selectedRepo) {
			return
		}
		const workspaceRepoUrl = workspaceDefaults.repoUrl ? normalizeGitHubRemoteUrl(workspaceDefaults.repoUrl) : null
		const match = workspaceRepoUrl
			? repositories.find((repo) => normalizeGitHubRemoteUrl(repo.url) === workspaceRepoUrl)
			: undefined
		const repo = match ?? repositories[0]
		persist({
			target: "cloud",
			repoUrl: normalizeGitHubRemoteUrl(repo.url) ?? repo.url,
			repositoryId: Number(repo.id),
			// The workspace branch is only a suggestion once GitHub confirms it
			// exists; a branch deleted on GitHub cannot provision a sandbox.
			branch: repo.defaultBranch || undefined,
		})
	}, [isCloud, connection?.connected, repositories, workspaceDefaults, selectedRepo, persist])

	// Load branches for the selected repository.
	const loadBranches = useCallback(async (repo: GitHubRepository | undefined, query?: string) => {
		if (!repo) {
			setBranches([])
			return
		}
		const requestId = ++branchRequest.current
		setBranchesLoading(true)
		try {
			const result = await CloudServiceClient.getRepositoryBranches(
				RepositoryBranchesRequest.create({ repositoryId: repo.id, query }),
			)
			if (requestId === branchRequest.current) {
				setBranches(result.branches)
			}
		} catch (error) {
			console.error("Failed to load branches:", error)
			if (requestId === branchRequest.current) {
				setBranches([])
			}
		} finally {
			if (requestId === branchRequest.current) {
				setBranchesLoading(false)
			}
		}
	}, [])
	useEffect(() => {
		if (isCloud) {
			void loadBranches(selectedRepo)
		}
	}, [isCloud, selectedRepo, loadBranches])

	// Suggest the workspace's branch for the workspace's repository once GitHub
	// confirms it exists. A local remote-tracking ref can outlive the branch on
	// GitHub, so GitHub is asked for that branch by name rather than trusting
	// the ref or the first page of the branch list. Asked once per repository,
	// and applied only while the default branch is still selected, so a branch
	// the user picks afterwards stays.
	const suggestedRef = useRef<string>()
	useEffect(() => {
		const branch = workspaceDefaults?.branch
		if (!isCloud || !selectedRepo || !workspaceDefaults?.repoUrl || !branch) {
			return
		}
		if (normalizeGitHubRemoteUrl(selectedRepo.url) !== normalizeGitHubRemoteUrl(workspaceDefaults.repoUrl)) {
			return
		}
		const key = `${selectedRepo.id}:${branch}`
		if (suggestedRef.current === key) {
			return
		}
		suggestedRef.current = key
		const repo = selectedRepo
		void CloudServiceClient.getRepositoryBranches(RepositoryBranchesRequest.create({ repositoryId: repo.id, query: branch }))
			.then((result) => {
				if (!result.branches.includes(branch)) {
					return
				}
				persist((current) =>
					current?.repositoryId === Number(repo.id) && (!current.branch || current.branch === repo.defaultBranch)
						? { ...current, target: "cloud", branch }
						: undefined,
				)
			})
			.catch((error) => console.error("Failed to check the workspace branch on GitHub:", error))
	}, [isCloud, selectedRepo, workspaceDefaults, persist])
	const onBranchQueryChange = useCallback(
		(query: string) => void loadBranches(selectedRepo, query || undefined),
		[loadBranches, selectedRepo],
	)

	useEffect(() => {
		if (connection?.connected && repositories.length > 0) {
			setWaitingForGitHub(false)
		}
	}, [connection?.connected, repositories.length])

	const selectTarget = (next: "local" | "cloud") => {
		if (next === target) {
			return
		}
		persist({ ...cloudTaskTarget, target: next })
	}

	const selectRepository = (value: string) => {
		const repo = repositories.find((candidate) => String(candidate.id) === value)
		if (!repo) {
			return
		}
		// Start on the default branch; the workspace branch is suggested once the
		// repository's live branch list confirms it exists.
		persist({
			target: "cloud",
			repoUrl: normalizeGitHubRemoteUrl(repo.url) ?? repo.url,
			repositoryId: Number(repo.id),
			branch: repo.defaultBranch || undefined,
		})
	}

	const selectBranch = (branch: string) => {
		persist({ ...cloudTaskTarget, target: "cloud", branch })
	}

	const connectGitHub = () => {
		setWaitingForGitHub(true)
		CloudServiceClient.connectGitHub(EmptyRequest.create()).catch((error) =>
			console.error("Failed to open GitHub connect:", error),
		)
	}

	const onboardingVariant: CloudOnboardingVariant | undefined = !isCloud
		? undefined
		: !signedIn
			? "signed_out"
			: connection?.error
				? "error"
				: connection && !connection.connected
					? "not_connected"
					: connection && connection.repositories.length === 0
						? "no_repositories"
						: undefined

	const branchOptions = useMemo(() => {
		const known = new Set(branches)
		const current = cloudTaskTarget?.branch
		const all = current && !known.has(current) ? [current, ...branches] : branches
		return all.map((branch) => ({ value: branch, label: branch }))
	}, [branches, cloudTaskTarget?.branch])

	const repoOptions = useMemo(
		() => repositories.map((repo) => ({ value: String(repo.id), label: repo.fullName || formatRepoLabel(repo.url) })),
		[repositories],
	)

	const workspaceRepoAccessible =
		!workspaceDefaults?.repoUrl ||
		repositories.some(
			(repo) => normalizeGitHubRemoteUrl(repo.url) === normalizeGitHubRemoteUrl(workspaceDefaults.repoUrl ?? ""),
		)

	return (
		<div className="mx-4 mb-2 rounded-md border border-border-panel bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_40%,transparent)] px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[11px] font-medium uppercase tracking-wide text-description">Run task</span>
				<div
					aria-label="Where to run the task"
					className="inline-flex rounded-sm border border-input-foreground/20 p-0.5"
					role="radiogroup">
					<TargetButton
						active={!isCloud}
						icon={<MonitorIcon className="size-3" />}
						label="Local"
						onClick={() => selectTarget("local")}
					/>
					<TargetButton
						active={isCloud}
						icon={<CloudIcon className="size-3" />}
						label="Cloud"
						onClick={() => selectTarget("cloud")}
					/>
				</div>
			</div>

			{isCloud && (
				<div className="mt-2 border-t border-border-panel pt-2">
					{onboardingVariant ? (
						<CloudOnboardingCard
							checking={loading}
							errorMessage={connection?.error}
							onConnect={connectGitHub}
							onRefresh={() => void refresh()}
							onSignIn={handleSignIn}
							variant={onboardingVariant}
							waiting={waitingForGitHub}
						/>
					) : (
						<div className="flex flex-col gap-1.5">
							<div className="flex min-w-0 items-center gap-1.5">
								<SearchableSelect
									ariaLabel="Repository"
									icon={GITHUB_ICON}
									loading={loading && repositories.length === 0}
									onChange={selectRepository}
									options={repoOptions}
									placeholder="Choose a repository"
									value={selectedRepo ? String(selectedRepo.id) : undefined}
								/>
								<SearchableSelect
									ariaLabel="Branch"
									className="max-w-[45%]"
									disabled={!selectedRepo}
									emptyText="No branches found"
									icon={<GitBranchIcon className="size-3" />}
									loading={branchesLoading}
									onChange={selectBranch}
									onQueryChange={onBranchQueryChange}
									options={branchOptions}
									placeholder="Branch"
									value={cloudTaskTarget?.branch}
								/>
							</div>
							<p className="m-0 text-[11px] leading-snug text-description">
								{!workspaceRepoAccessible ? (
									<>
										This workspace's repository ({formatRepoLabel(workspaceDefaults?.repoUrl)}) isn't
										accessible to the Cline GitHub App.{" "}
										<button
											className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-link hover:underline"
											onClick={connectGitHub}
											type="button">
											Manage access
										</button>
									</>
								) : (
									"Uses a Cline model and Cline credits in an isolated sandbox. Tools are auto-approved so the task can keep going after you close VS Code."
								)}
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function TargetButton({
	active,
	icon,
	label,
	onClick,
}: {
	active: boolean
	icon: React.ReactNode
	label: string
	onClick: () => void
}) {
	return (
		<button
			aria-checked={active}
			className={cn(
				"inline-flex cursor-pointer items-center gap-1 rounded-xs border-0 px-2 py-0.5 text-xs",
				active ? "bg-button-background text-button-foreground" : "bg-transparent text-description hover:text-foreground",
			)}
			onClick={onClick}
			role="radio"
			type="button">
			{icon}
			{label}
		</button>
	)
}
