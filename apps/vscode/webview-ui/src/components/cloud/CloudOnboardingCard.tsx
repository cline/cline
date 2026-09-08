import { CheckIcon, CloudIcon, GitBranchIcon, LoaderCircleIcon, LogInIcon, PlayIcon, RefreshCcwIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type CloudOnboardingVariant = "signed_out" | "not_connected" | "no_repositories" | "error"

/**
 * Shown in place of the repository pickers when a cloud task cannot be started
 * yet. Explains what cloud sessions are and walks through connecting GitHub;
 * the parent keeps re-checking so finishing the flow in the browser flips this
 * into the ready state on its own.
 */
export function CloudOnboardingCard({
	variant,
	onConnect,
	onRefresh,
	onSignIn,
	checking = false,
	waiting = false,
	errorMessage,
}: {
	variant: CloudOnboardingVariant
	onConnect: () => void
	onRefresh: () => void
	onSignIn: () => void
	checking?: boolean
	/** True after the user opened the connect flow and we are polling for completion. */
	waiting?: boolean
	errorMessage?: string
}) {
	if (variant === "error") {
		return (
			<div className="flex flex-col gap-2 py-1 text-xs">
				<div className="font-medium text-foreground">Could not reach Cline Cloud</div>
				<div className="text-description">{errorMessage || "Check your connection and try again."}</div>
				<div>
					<Button disabled={checking} onClick={onRefresh} size="sm" variant="secondary">
						<RefreshCcwIcon className={cn("size-3", checking && "animate-spin")} />
						Retry
					</Button>
				</div>
			</div>
		)
	}

	const isSignedOut = variant === "signed_out"
	const isNoRepositories = variant === "no_repositories"

	return (
		<div className="flex flex-col gap-3 py-1">
			<div className="flex flex-col gap-1">
				<div className="text-sm font-medium text-foreground">
					{isSignedOut
						? "Run Cline in the cloud"
						: isNoRepositories
							? "Give Cline access to a repository"
							: "Connect GitHub to get started"}
				</div>
				<p className="m-0 text-xs leading-relaxed text-description">
					Cloud sessions run in an isolated sandbox on Cline's infrastructure. Cline clones your repository, works on a
					branch, and keeps going after you close VS Code.
				</p>
			</div>

			<ol className="m-0 flex list-none flex-col gap-1.5 p-0">
				{isSignedOut ? (
					<Step icon={<LogInIcon className="size-3" />} index={1} title="Sign in to Cline" />
				) : (
					<Step done={isNoRepositories} icon={<CloudIcon className="size-3" />} index={1} title="Connect GitHub" />
				)}
				<Step
					active={isNoRepositories}
					icon={<GitBranchIcon className="size-3" />}
					index={2}
					title="Choose the repositories Cline may access"
				/>
				<Step icon={<PlayIcon className="size-3" />} index={3} title="Pick a repo and branch, then start a task" />
			</ol>

			<div className="flex flex-wrap items-center gap-2">
				{isSignedOut ? (
					<Button onClick={onSignIn} size="sm">
						<LogInIcon className="size-3" />
						Sign in to Cline
					</Button>
				) : (
					<Button onClick={onConnect} size="sm">
						<CloudIcon className="size-3" />
						{isNoRepositories ? "Manage repository access" : "Connect GitHub"}
					</Button>
				)}
				{!isSignedOut && (
					<span className="inline-flex items-center gap-1 text-xs text-description">
						{waiting || checking ? (
							<>
								<LoaderCircleIcon className="size-3 animate-spin" />
								{isNoRepositories ? "Waiting for repository access…" : "Waiting for GitHub…"}
							</>
						) : (
							<button
								className="cursor-pointer border-0 bg-transparent p-0 text-xs text-link hover:underline"
								onClick={onRefresh}
								type="button">
								I've done this, check again
							</button>
						)}
					</span>
				)}
			</div>
		</div>
	)
}

function Step({
	icon,
	index,
	title,
	done = false,
	active = false,
}: {
	icon: ReactNode
	index: number
	title: string
	done?: boolean
	active?: boolean
}) {
	return (
		<li className="flex items-center gap-2 text-xs">
			<span
				className={cn(
					"inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
					done
						? "border-[var(--vscode-charts-green)] text-[var(--vscode-charts-green)]"
						: active
							? "border-button-background text-button-background"
							: "border-input-foreground/30 text-description",
				)}>
				{done ? <CheckIcon className="size-3" /> : index}
			</span>
			<span className={cn("inline-flex items-center gap-1.5", done ? "text-description line-through" : "text-foreground")}>
				<span className="text-description">{icon}</span>
				{title}
			</span>
		</li>
	)
}
