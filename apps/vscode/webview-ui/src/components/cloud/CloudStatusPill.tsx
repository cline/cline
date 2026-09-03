import type { CloudSessionStatus } from "@shared/cloud/cloud-sessions"
import { CloudIcon, LoaderCircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const LABELS: Record<CloudSessionStatus, string> = {
	provisioning: "Starting",
	running: "Running",
	idle: "Cloud",
	completed: "Done",
	failed: "Failed",
	expired: "Expired",
}

export function isCloudStatusActive(status: string | undefined): boolean {
	return status === "provisioning" || status === "running"
}

function labelFor(status: string | undefined): string {
	return status && status in LABELS ? LABELS[status as CloudSessionStatus] : "Cloud"
}

/**
 * Compact cloud marker for history rows: a cloud icon plus the session's state.
 * Active states animate so running work is easy to spot in a long list.
 */
export function CloudStatusPill({ status, className }: { status: string | undefined; className?: string }) {
	const active = isCloudStatusActive(status)
	const label = labelFor(status)
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none",
				active && "bg-[color-mix(in_srgb,var(--vscode-charts-green)_18%,transparent)] text-[var(--vscode-charts-green)]",
				status === "failed" && "bg-[color-mix(in_srgb,var(--vscode-errorForeground)_18%,transparent)] text-error",
				!active && status !== "failed" && "bg-badge-background text-badge-foreground",
				className,
			)}
			title={`Cloud session: ${label.toLowerCase()}`}>
			{active ? <LoaderCircleIcon className="size-2.5 animate-spin" /> : <CloudIcon className="size-2.5" />}
			{label}
		</span>
	)
}
