import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { CheckCircle2Icon, CloudIcon, LoaderCircleIcon, RefreshCcwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useGitHubConnection } from "@/hooks/useGitHubConnection"
import { cn } from "@/lib/utils"
import { CloudServiceClient } from "@/services/grpc-client"

/**
 * Account view card answering "is my account set up for cloud sessions?":
 * GitHub App connection state for the active scope and how many repositories
 * it can reach. Repository selection itself happens on the home screen.
 */
export function CloudGitHubCard() {
	const { connection, loading, refresh } = useGitHubConnection(true)
	const [waiting, setWaiting] = useState(false)

	const connect = () => {
		setWaiting(true)
		CloudServiceClient.connectGitHub(EmptyRequest.create()).catch((error) =>
			console.error("Failed to open GitHub connect:", error),
		)
	}

	const connected = !!connection?.connected
	const repoCount = connection?.repositories.length ?? 0
	useEffect(() => {
		if (connected && repoCount > 0) {
			setWaiting(false)
		}
	}, [connected, repoCount])

	return (
		<div className="flex flex-col gap-2 rounded-md border border-border-panel px-3 py-2.5">
			<div className="flex items-center gap-2">
				<CloudIcon className="size-4 text-description" />
				<span className="text-sm font-medium">Cline Cloud</span>
				<button
					aria-label="Refresh GitHub connection"
					className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-description hover:text-foreground"
					onClick={() => void refresh()}
					type="button">
					<RefreshCcwIcon className={cn("size-3", loading && "animate-spin")} />
				</button>
			</div>
			<div className="flex items-start gap-2 text-xs">
				{connection?.error ? (
					<span className="text-error">Could not check GitHub: {connection.error}</span>
				) : !connection ? (
					<span className="inline-flex items-center gap-1 text-description">
						<LoaderCircleIcon className="size-3 animate-spin" /> Checking GitHub connection…
					</span>
				) : connected ? (
					<span className="inline-flex items-center gap-1.5 text-description">
						<CheckCircle2Icon className="size-3.5 text-[var(--vscode-charts-green)]" />
						<span>
							<span className="text-foreground">GitHub connected</span>
							{" · "}
							{repoCount === 0
								? "no repositories accessible yet"
								: `${repoCount} ${repoCount === 1 ? "repository" : "repositories"} accessible`}
						</span>
					</span>
				) : (
					<span className="text-description">
						Connect GitHub to run tasks in isolated cloud sandboxes that keep working after you close VS Code.
					</span>
				)}
			</div>
			<div className="flex items-center gap-2">
				<VSCodeButton appearance={connected ? "secondary" : "primary"} onClick={connect}>
					{connected ? "Manage repository access" : "Connect GitHub"}
				</VSCodeButton>
				{waiting && !(connected && repoCount > 0) && (
					<span className="inline-flex items-center gap-1 text-xs text-description">
						<LoaderCircleIcon className="size-3 animate-spin" /> Waiting for GitHub…
					</span>
				)}
			</div>
		</div>
	)
}
