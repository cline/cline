import type { TurnPhase } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon, LoaderCircleIcon, WrenchIcon } from "lucide-react"
import type React from "react"
import { Fragment, memo, useCallback, useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import { useCollapseAnchoring } from "../../hooks/useCollapseAnchoring"
import {
	type ActivityGroup,
	type ActivityGroupMode,
	type ChatListItem,
	getActivityGroupKey,
	getActivityGroupLabel,
	getGroupHeadMessage,
	hasStreamingActivity,
	isTurnWorking,
	resolveActivityGroupMode,
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
 * Collapsible fold for a run of agent activities — the live canvas.
 *
 * While the agent works the fold shows everything it has done and only ever grows: taking finished
 * actions away again collapsed the height under the reader and dragged the summary line back into
 * the middle of the chat. The summary line sticks below the pinned prompt instead, so it stays
 * readable from the first action to the last. When the turn ends, the canvas is torn down to that
 * one line; clicking it shows the whole run again.
 */
export const ActivityGroupRenderer = memo(
	({ group, isLastGroup, turnPhase, expandedRows, onToggleExpand, renderItem }: ActivityGroupRendererProps) => {
		const key = useMemo(() => getActivityGroupKey(group as ChatListItem[]), [group])
		const hasStreamingMessage = useMemo(() => hasStreamingActivity(group as ChatListItem[]), [group])
		const label = useMemo(() => getActivityGroupLabel(group as ChatListItem[]), [group])

		const mode: ActivityGroupMode = resolveActivityGroupMode({
			override: expandedRows[key],
			isLastGroup,
			hasStreamingMessage,
			turnPhase,
		})
		/** The canvas keeps every row it has: the fold never shrinks while the agent is working. */
		const children = mode === "none" ? [] : (group as ChatListItem[])
		const isExpanded = mode !== "none"
		const isWorking = hasStreamingMessage || (isLastGroup && isTurnWorking(turnPhase))

		const rootRef = useRef<HTMLDivElement>(null)
		useCollapseAnchoring(rootRef, isExpanded)

		const handleToggle = useCallback(() => {
			// From either open state a click folds the canvas away; from the bare summary line it
			// reveals the whole run again.
			onToggleExpand(key, { preserveAutoScroll: true, next: mode === "none" })
		}, [onToggleExpand, key, mode])

		if (group.length === 0) {
			return null
		}

		const action = isExpanded ? "Collapse" : "Expand"

		return (
			<div className="min-w-0" data-activity-group={key} data-expanded={isExpanded} ref={rootRef}>
				<button
					aria-expanded={isExpanded}
					aria-label={`${action} agent activities (${label})`}
					className={cn(
						"sticky z-[1] flex w-full min-w-0 items-center gap-1.5 px-4 py-1 text-left text-[12px] leading-tight select-none cursor-pointer",
						// Sticks under the pinned prompt: the summary line is the reader's anchor for
						// the whole canvas, so it may reach the top of the window but never scroll out.
						"bg-background top-[var(--chat-sticky-height,0px)]",
						"text-description/80 hover:text-foreground",
					)}
					onClick={handleToggle}
					title={
						mode === "none"
							? `${label} — show all agent activities (${group.length} rows)`
							: `${label} — fold agent activities`
					}
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
						{children.map((item, index) => (
							<Fragment key={getGroupHeadMessage(item as ChatListItem)?.ts ?? index}>
								{renderItem(item as ChatListItem, index, isLastGroup && index === children.length - 1)}
							</Fragment>
						))}
					</div>
				)}
			</div>
		)
	},
)

ActivityGroupRenderer.displayName = "ActivityGroupRenderer"
