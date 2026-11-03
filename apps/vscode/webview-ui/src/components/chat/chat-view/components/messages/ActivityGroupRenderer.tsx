import type { TurnPhase } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon, LoaderCircleIcon, WrenchIcon } from "lucide-react"
import type React from "react"
import { Fragment, memo, useCallback, useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import { useCollapseAnchoring } from "../../hooks/useCollapseAnchoring"
import {
	type ActivityGroup,
	type ChatListItem,
	getActivityGroupKey,
	getActivityGroupLabel,
	getGroupHeadMessage,
	hasStreamingActivity,
	isTurnWorking,
	resolveActivityGroupExpansion,
} from "../../utils/activityFolding"

interface ActivityGroupRendererProps {
	/** Consecutive activity rows (tool groups, commands, thinking, ...) folded into one entry. */
	group: ActivityGroup
	/** Whether this fold is the tail of the chat list. */
	isLastGroup: boolean
	turnPhase?: TurnPhase
	/** User overrides, keyed by {@link getActivityGroupKey}. `undefined` = automatic. */
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number, options?: { preserveAutoScroll?: boolean; next?: boolean }) => void
	/** Renders one nested row (chat row or nested tool group) with the regular chat rendering. */
	renderItem: (item: ChatListItem, index: number, isLastItem: boolean) => React.ReactNode
}

/**
 * Collapsible fold for a run of agent activities.
 *
 * Open while the agent is still working (so live progress stays visible), folded to a single
 * muted summary line as soon as the activity has completed. Clicking the header reveals every
 * action that ran in the meantime.
 */
export const ActivityGroupRenderer = memo(
	({ group, isLastGroup, turnPhase, expandedRows, onToggleExpand, renderItem }: ActivityGroupRendererProps) => {
		const key = useMemo(() => getActivityGroupKey(group as ChatListItem[]), [group])
		const hasStreamingMessage = useMemo(() => hasStreamingActivity(group as ChatListItem[]), [group])
		const label = useMemo(() => getActivityGroupLabel(group as ChatListItem[]), [group])

		const isExpanded = resolveActivityGroupExpansion({
			override: expandedRows[key],
			isLastGroup,
			hasStreamingMessage,
			turnPhase,
		})
		const isWorking = hasStreamingMessage || (isLastGroup && isTurnWorking(turnPhase))

		const rootRef = useRef<HTMLDivElement>(null)
		useCollapseAnchoring(rootRef, isExpanded)

		const handleToggle = useCallback(() => {
			onToggleExpand(key, { preserveAutoScroll: true, next: !isExpanded })
		}, [onToggleExpand, key, isExpanded])

		if (group.length === 0) {
			return null
		}

		return (
			<div className="min-w-0" data-activity-group={key} data-expanded={isExpanded} ref={rootRef}>
				<button
					aria-expanded={isExpanded}
					aria-label={`${isExpanded ? "Collapse" : "Expand"} agent activities (${label})`}
					className={cn(
						"flex w-full min-w-0 items-center gap-1.5 px-4 py-1 text-left text-[12px] leading-tight select-none cursor-pointer",
						"text-description/80 hover:text-foreground",
					)}
					onClick={handleToggle}
					title={`${label} — ${isExpanded ? "fold agent activities" : "show all agent activities"}`}
					type="button">
					{isExpanded ? (
						<ChevronDownIcon className="size-3 shrink-0 opacity-70" />
					) : (
						<ChevronRightIcon className="size-3 shrink-0 opacity-70" />
					)}
					<WrenchIcon className="size-3 shrink-0 opacity-60" />
					<span className="truncate">{label}</span>
					{isWorking && <LoaderCircleIcon className="size-3 shrink-0 animate-spin opacity-70" />}
				</button>
				{isExpanded && (
					<div className="min-w-0">
						{group.map((item, index) => (
							<Fragment key={getGroupHeadMessage(item as ChatListItem)?.ts ?? index}>
								{renderItem(item as ChatListItem, index, isLastGroup && index === group.length - 1)}
							</Fragment>
						))}
					</div>
				)}
			</div>
		)
	},
)

ActivityGroupRenderer.displayName = "ActivityGroupRenderer"
