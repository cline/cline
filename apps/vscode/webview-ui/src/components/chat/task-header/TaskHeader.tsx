import { ClineMessage } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react"
import { CloudTaskBadge } from "@/components/cloud/CloudTaskBadge"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useNormalizedApiConfiguration } from "@/hooks/useNormalizedApiConfiguration"
import { useProviderUsageCostDisplay } from "@/hooks/useProviderUsageCostDisplay"
import { cn } from "@/lib/utils"
import { getEnvironmentColor } from "@/utils/environmentColors"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import NewTaskButton from "./buttons/NewTaskButton"
import OpenDiskConversationHistoryButton from "./buttons/OpenDiskConversationHistoryButton"
import ContextWindow from "./ContextWindow"
import { highlightText } from "./Highlights"
import TaskWorkingDirectoryBadge from "./TaskWorkingDirectoryBadge"

const IS_DEV = process.env.IS_DEV === "true"
interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	lastApiReqTotalTokens?: number
	compactDisabled: boolean
	compactTask: () => Promise<boolean>
	onClose: () => void
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const BUTTON_CLASS = "max-h-3 border-0 font-bold bg-transparent hover:opacity-100 text-foreground"

/**
 * Whether the header may show the task's cost. A cloud task is billed by the
 * cloud service, so its cost is shown only when the sandbox reported usage;
 * the local provider's cost display setting does not apply to it, and an
 * unknown cloud charge must not render as a confirmed $0.0000.
 */
export function isTaskCostAvailable(input: {
	isCloudTask: boolean
	cloudUsageAvailable: boolean | undefined
	localCostAvailable: boolean
}): boolean {
	if (input.isCloudTask) {
		return input.cloudUsageAvailable === true
	}
	return input.localCostAvailable
}

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	compactDisabled,
	compactTask,
	onClose,
	onSendMessage,
}) => {
	const {
		apiConfiguration,
		currentTaskItem,
		mode,
		expandTaskHeader: isTaskExpanded,
		setExpandTaskHeader: setIsTaskExpanded,
		environment,
		workspaceRoots,
		platform,
		currentCloudTask,
	} = useExtensionState()

	const [isHighlightedTextExpanded, setIsHighlightedTextExpanded] = useState(false)
	const [isTextOverflowing, setIsTextOverflowing] = useState(false)
	const highlightedTextRef = React.useRef<HTMLDivElement>(null)

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])

	// Check if text overflows the container (i.e., needs clamping)
	useLayoutEffect(() => {
		const el = highlightedTextRef.current
		if (el && isTaskExpanded && !isHighlightedTextExpanded) {
			// Check if content height exceeds the max-height
			setIsTextOverflowing(el.scrollHeight > el.clientHeight)
		}
	}, [task.text, isTaskExpanded, isHighlightedTextExpanded])

	// Handle click outside to collapse
	React.useEffect(() => {
		if (!isHighlightedTextExpanded) {
			return
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (highlightedTextRef.current && !highlightedTextRef.current.contains(event.target as Node)) {
				setIsHighlightedTextExpanded(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [isHighlightedTextExpanded])

	// Simplified computed values
	const { selectedModelInfo } = useNormalizedApiConfiguration(mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	// Local providers report no cost; the openai-compatible provider can
	// report cost only when the user has supplied both prices. For every
	// other provider, the SDK is the source of truth for whether to render
	// per-task cost: any `metadata.usageCostDisplay` other than "show" —
	// "hide", or "subscription" for flat-rate providers like ClinePass and
	// ChatGPT Plus/Pro where the computed figure would be an API-rate
	// estimate rather than a real charge — suppresses the cost here. This
	// mirrors the CLI's `shouldShowCliUsageCost` consumer and removes the
	// previous extension-side hard-coded "openai-codex" check.
	const usageCostDisplay = useProviderUsageCostDisplay(modeFields.apiProvider)
	const isCostAvailable = isTaskCostAvailable({
		isCloudTask: !!currentCloudTask,
		cloudUsageAvailable: currentTaskItem?.cloudUsageAvailable,
		localCostAvailable:
			!!(
				totalCost &&
				modeFields.apiProvider === "openai" &&
				modeFields.openAiModelInfo?.inputPrice &&
				modeFields.openAiModelInfo?.outputPrice
			) ||
			(modeFields.apiProvider !== "vscode-lm" &&
				modeFields.apiProvider !== "ollama" &&
				modeFields.apiProvider !== "lmstudio" &&
				usageCostDisplay === "show"),
	})

	// Event handlers
	const toggleTaskExpanded = useCallback(() => setIsTaskExpanded(!isTaskExpanded), [setIsTaskExpanded, isTaskExpanded])

	const environmentBorderColor = getEnvironmentColor(environment, "border")

	return (
		<div className="w-full max-w-[820px] mx-auto pt-3 pb-1.5 px-4 sm:px-6 flex flex-col gap-2">
			{/* Task Header */}
			<div
				className={cn(
					"relative overflow-hidden cursor-pointer rounded-xl flex flex-col gap-1.5 z-10 py-2.5 px-3.5 bg-[#151618] border border-white/[0.08] transition-colors",
					{
						"border-white/[0.13]": isTaskExpanded,
						"hover:bg-[#191b1e] hover:border-white/[0.12]": !isTaskExpanded,
					},
				)}>
				{/* Task Title */}
				<div
					aria-label={isTaskExpanded ? "Collapse task header" : "Expand task header"}
					className="flex justify-between items-center gap-2 cursor-pointer"
					onClick={toggleTaskExpanded}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							e.stopPropagation()
							toggleTaskExpanded()
						}
					}}
					tabIndex={0}>
					<div className="flex flex-wrap gap-y-1 gap-x-1.5 items-center grow min-w-0">
						<div className="flex justify-between items-center text-[#8f959e]">
							{isTaskExpanded ? <ChevronDownIcon size="15" /> : <ChevronRightIcon size="15" />}
							{isTaskExpanded && (
								<div className="flex justify-end cursor-pointer opacity-80 gap-2 mx-2">
									<CopyTaskButton className={BUTTON_CLASS} taskText={task.text} />
									<DeleteTaskButton
										className={BUTTON_CLASS}
										taskId={currentTaskItem?.id}
										taskSize={currentTaskItem?.size}
									/>
									{/* Only visible in development mode */}
									{IS_DEV && (
										<OpenDiskConversationHistoryButton
											className={BUTTON_CLASS}
											taskId={currentTaskItem?.id}
										/>
									)}
								</div>
							)}
						</div>
						{!isTaskExpanded && (
							<div className="select-none whitespace-nowrap overflow-hidden text-ellipsis grow basis-0 min-w-16">
								<span className="ph-no-capture text-[13.5px] font-medium text-[#e4e6e9]">{highlightedText}</span>
							</div>
						)}
						<div className="inline-flex flex-wrap gap-1.5 items-center justify-end select-none ml-auto min-w-0">
							{currentCloudTask ? (
								<CloudTaskBadge cloudTask={currentCloudTask} />
							) : (
								<TaskWorkingDirectoryBadge
									platform={platform}
									taskCwd={currentTaskItem?.cwdOnTaskInitialization}
									workspaceRoots={workspaceRoots}
								/>
							)}
							{isCostAvailable && (
								<div
									className="px-2 py-0.5 rounded-md inline-flex shrink-0 bg-white/[0.06] border border-white/[0.07] text-[#b8bdc6] items-center"
									id="price-tag">
									<span className="font-geist-mono text-[11px] tabular-nums">${totalCost?.toFixed(4)}</span>
								</div>
							)}
						</div>
					</div>
					<NewTaskButton className={cn(BUTTON_CLASS, "shrink-0")} onClick={onClose} />
				</div>

				{/* Expand/Collapse Task Details */}
				{isTaskExpanded && (
					<div className="flex flex-col break-words" key={`task-details-${currentTaskItem?.id}`}>
						<div
							className={cn(
								"ph-no-capture whitespace-pre-wrap break-words px-0.5 text-sm mt-1 relative",
								"max-h-[4.5rem] overflow-hidden",
								{
									"max-h-[25vh] overflow-y-auto scroll-smooth": isHighlightedTextExpanded,
									"cursor-pointer": isTextOverflowing,
								},
							)}
							onClick={() => isTextOverflowing && setIsHighlightedTextExpanded(true)}
							ref={highlightedTextRef}
							style={
								!isHighlightedTextExpanded && isTextOverflowing
									? {
											WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
											maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
										}
									: undefined
							}>
							{highlightedText}
						</div>

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}

						<ContextWindow
							cacheReads={cacheReads}
							cacheWrites={cacheWrites}
							compactDisabled={compactDisabled}
							compactTask={compactTask}
							contextWindow={selectedModelInfo?.contextWindow}
							lastApiReqTotalTokens={lastApiReqTotalTokens}
							onSendMessage={onSendMessage}
							tokensIn={tokensIn}
							tokensOut={tokensOut}
							useAutoCondense={false} // Disable auto-condense configuration in UI for now
						/>
					</div>
				)}
			</div>
		</div>
	)
}

export default TaskHeader
