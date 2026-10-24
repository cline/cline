import type { ClineCloudProvisioningInfo, ClineMessage } from "@shared/ExtensionMessage"
import { CheckIcon, CloudIcon, GitBranchIcon, LoaderCircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Step = { phase: ClineCloudProvisioningInfo["phase"]; label: string }

const START_STEPS: Step[] = [
	{ phase: "starting", label: "Start sandbox" },
	{ phase: "cloning_repo", label: "Clone repository" },
	{ phase: "agent_starting", label: "Start agent" },
]
const RESUME_STEPS: Step[] = [{ phase: "resuming", label: "Wake up sandbox" }]

function parseInfo(text: string | undefined): ClineCloudProvisioningInfo | undefined {
	try {
		const parsed = JSON.parse(text || "")
		return typeof parsed?.phase === "string" ? parsed : undefined
	} catch {
		return undefined
	}
}

/**
 * Progress card for a cloud sandbox that is starting or resuming. The same
 * message (same ts) is updated in place as the phase advances; once anything
 * follows it, the card collapses to its header.
 */
export const CloudProvisioningRow = ({ message, active }: { message: ClineMessage; active: boolean }) => {
	const info = parseInfo(message.text)
	if (!info) {
		// Virtuoso cannot handle zero-height items; render a spacer instead of null.
		return <div aria-hidden className="h-px" />
	}

	const steps = info.phase === "resuming" ? RESUME_STEPS : START_STEPS
	const current = steps.findIndex((step) => step.phase === info.phase)
	const title = !active ? "Cloud sandbox" : info.phase === "resuming" ? "Resuming cloud sandbox" : "Setting up cloud sandbox"

	return (
		<div className="flex flex-col gap-2.5 rounded-sm border border-description/20 bg-text-block-background/40 px-3 py-2.5">
			<div className="flex min-w-0 items-center gap-2.5">
				<span className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-badge-background/60 text-badge-foreground">
					<CloudIcon className="size-3.5" />
				</span>
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate font-medium text-foreground">{title}</span>
					{info.repo && (
						<span className="flex min-w-0 items-center gap-1.5 text-xs text-description">
							<span className="truncate">{info.repo}</span>
							{info.branch && (
								<span className="inline-flex min-w-0 shrink items-center gap-1 rounded-xs bg-description/10 px-1 py-px">
									<GitBranchIcon className="size-2.5 shrink-0" />
									<span className="truncate">{info.branch}</span>
								</span>
							)}
						</span>
					)}
				</div>
			</div>
			{active && (
				<ol className="m-0 flex list-none flex-col gap-1.5 p-0 pl-1 text-xs">
					{steps.map((step, index) => {
						const done = index < current
						const running = index === current
						return (
							<li className="flex items-center gap-2" key={step.phase}>
								<span className="inline-flex size-4 shrink-0 items-center justify-center">
									{done ? (
										<CheckIcon className="size-3 text-success" />
									) : running ? (
										<LoaderCircleIcon className="size-3 animate-spin text-foreground" />
									) : (
										<span className="size-1.5 rounded-full bg-description/40" />
									)}
								</span>
								{running ? (
									<span
										aria-live="polite"
										className="animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent">
										{step.label}
									</span>
								) : (
									<span className={cn(done ? "text-description" : "text-description/60")}>{step.label}</span>
								)}
							</li>
						)
					})}
				</ol>
			)}
		</div>
	)
}
