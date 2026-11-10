import type { SubscriptionUsageSnapshot } from "@shared/ExtensionMessage"
import { useEffect, useState } from "react"
import { Progress } from "@/components/ui/progress"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderUsageCostDisplay } from "@/hooks/useProviderUsageCostDisplay"
import { cn } from "@/lib/utils"

const MINUTE = 60_000
const STALE_AFTER = 10 * MINUTE

type UsageWindow = SubscriptionUsageSnapshot["windows"][number]

function windowLabel({ id, windowMinutes }: UsageWindow): string {
	if (!windowMinutes) return id === "primary" ? "Primary" : "Secondary"
	if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}-day`
	if (windowMinutes % 60 === 0) return `${windowMinutes / 60}-hour`
	return `${windowMinutes}-minute`
}

function resetLabel(resetsAt: number | undefined, now: number): string {
	if (resetsAt === undefined) return "Reset time unknown"
	if (resetsAt <= now) return "Reset passed; waiting for next response"
	const minutes = Math.ceil((resetsAt - now) / MINUTE)
	if (minutes >= 1440) return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
	return `Resets in ${minutes >= 60 ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60}m`
}

/** Last observed plan limits; the display timer never fetches or estimates usage. */
export function SubscriptionUsage({ providerId }: { providerId: string | undefined }) {
	const { subscriptionUsage: snapshot } = useExtensionState()
	const display = useProviderUsageCostDisplay(providerId)
	const [now, setNow] = useState(Date.now)
	const capturedAt = snapshot?.capturedAt
	const visible =
		providerId === "openai-codex" &&
		display === "subscription" &&
		snapshot?.providerId === providerId &&
		!!snapshot?.windows.length

	useEffect(() => {
		if (!visible || capturedAt === undefined) return
		setNow(Date.now())
		const timer = window.setInterval(() => setNow(Date.now()), MINUTE)
		return () => window.clearInterval(timer)
	}, [visible, capturedAt])

	if (!visible || !snapshot) return null
	const ageMinutes = Math.max(0, Math.floor((now - snapshot.capturedAt) / MINUTE))
	const stale = now - snapshot.capturedAt >= STALE_AFTER
	const age = ageMinutes === 0 ? "just now" : `${ageMinutes} min ago`

	return (
		<section
			aria-label="ChatGPT subscription usage"
			className="ph-no-capture mt-2 flex flex-col gap-1.5 text-xs"
			title="Source: Codex response headers for the shared default pool. Other sessions can change usage between responses.">
			<div className="flex flex-wrap justify-between gap-x-2">
				<span>ChatGPT subscription usage</span>
				{stale && <span className="text-description">Stale</span>}
			</div>
			{snapshot.windows.map((usageWindow) => {
				const label = windowLabel(usageWindow)
				const percent = Number(usageWindow.usedPercent.toFixed(1))
				const reset = resetLabel(usageWindow.resetsAt, now)
				const barPercent = Math.min(100, Math.max(0, percent))
				return (
					<div className="flex flex-col gap-1" key={usageWindow.id}>
						<div className="flex flex-wrap justify-between gap-x-2">
							<span>
								{label}: {percent}% used
							</span>
							<span className="text-description">{reset}</span>
						</div>
						<Progress
							aria-label={`${label} subscription usage`}
							aria-valuemax={100}
							aria-valuemin={0}
							aria-valuenow={barPercent}
							aria-valuetext={`${percent}% used; ${reset}${stale ? "; stale observation" : ""}`}
							className={cn(
								"h-1",
								stale && "opacity-50",
								percent >= 100 ? "[&>div]:bg-error" : percent >= 80 && "[&>div]:bg-editor-warning-foreground",
							)}
							value={barPercent}
						/>
					</div>
				)
			})}
			<div className="text-description">as of {age}</div>
		</section>
	)
}
