import type { TurnPhase } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon, LoaderCircleIcon, WrenchIcon } from "lucide-react"
import type React from "react"
import { Fragment, memo, useCallback, useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import { useCollapseAnchoring } from "../../hooks/useCollapseAnchoring"
import { useElementInView } from "../../hooks/useElementInView"
import {
	type ActivityGroup,
	type ActivityGroupMode,
	activityItemKey,
	type ChatListItem,
	getActivityGroupKey,
	getActivityGroupLabel,
	getGroupHeadMessage,
	hasStreamingActivity,
	isTurnWorking,
	resolveActivityGroupMode,
	selectActivityChildren,
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
 * Only the action that is running right now is on screen: a command, read, diff or thinking block
 * folds away as soon as it completes, while the header keeps counting everything the group has
 * done. With nothing in flight the fold is that single summary line. Clicking the header reveals
 * every action that ran in the meantime.
 *
 * One thing gates that: the header itself. While the summary line is inside the viewport nothing is
 * taken away, because collapsing an action the reader is looking at would delete the content under
 * their eyes and pull the summary line back into the middle of the chat. The fold only tidies up
 * once the line has scrolled out of view.
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
		const headerRef = useRef<HTMLButtonElement>(null)
		const headerInView = useElementInView(headerRef)
		/** Rows on screen at the previous commit; kept while the summary line is visible. */
		const shownKeysRef = useRef<Set<number>>(new Set())

		/** `all` = the user asked for everything, `live` = what is running (plus what is on screen),
		 * `none` = the summary line alone. */
		const children = useMemo(() => {
			const next = selectActivityChildren(group as ChatListItem[], {
				headerInView,
				keepTail: turnPhase === "awaiting_approval",
				mode,
				shownKeys: shownKeysRef.current,
			})
			shownKeysRef.current = new Set(next.map(activityItemKey).filter((ts): ts is number => ts !== undefined))
			return next
		}, [group, headerInView, mode, turnPhase])
		const isExpanded = mode !== "none"
		const isWorking = hasStreamingMessage || (isLastGroup && isTurnWorking(turnPhase))
		const foldedAway = group.length - children.length

		const rootRef = useRef<HTMLDivElement>(null)
		useCollapseAnchoring(rootRef, isExpanded)

		const handleToggle = useCallback(() => {
			// From the live view a click reveals everything; from the revealed list it folds away.
			onToggleExpand(key, { preserveAutoScroll: true, next: mode !== "all" })
		}, [onToggleExpand, key, mode])

		if (group.length === 0) {
			return null
		}

		const action = mode === "all" ? "Collapse" : mode === "live" ? "Show all" : "Expand"

		return (
			<div className="min-w-0" data-activity-group={key} data-expanded={isExpanded} ref={rootRef}>
				<button
					aria-expanded={isExpanded}
					aria-label={`${action} agent activities (${label})`}
					className={cn(
						"flex w-full min-w-0 items-center gap-1.5 px-4 py-1 text-left text-[12px] leading-tight select-none cursor-pointer",
						"text-description/80 hover:text-foreground",
					)}
					onClick={handleToggle}
					ref={headerRef}
					title={
						mode === "all"
							? `${label} — fold agent activities`
							: `${label} — show all agent activities${foldedAway > 0 ? ` (${foldedAway} folded away)` : ""}`
					}
					type="button">
					{isExpanded ? (
						<ChevronDownIcon className="size-3 shrink-0 opacity-70" />
					) : (
						<ChevronRightIcon className="size-3 shrink-0 opacity-70" />
					)}
					<WrenchIcon className="size-3 shrink-0 opacity-60" />
					<span className="truncate">{label}</span>
					{mode === "live" && foldedAway > 0 && <span className="shrink-0 opacity-60">+{foldedAway}</span>}
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
