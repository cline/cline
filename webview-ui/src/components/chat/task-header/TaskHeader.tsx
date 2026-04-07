import { ClineMessage } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { getEnvironmentColor } from "@/utils/environmentColors"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import NewTaskButton from "./buttons/NewTaskButton"
import OpenDiskConversationHistoryButton from "./buttons/OpenDiskConversationHistoryButton"
import { CheckpointError } from "./CheckpointError"
import ContextWindow from "./ContextWindow"
import { highlightText } from "./Highlights"
import { TaskProgressChecklist } from "./TaskProgressChecklist"

const IS_DEV = process.env.IS_DEV === '"true"'

interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	lastApiReqTotalTokens?: number
	lastProgressMessageText?: string
	showFocusChainPlaceholder?: boolean
	onClose: () => void
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const BUTTON_CLASS = "max-h-3 border-0 font-bold bg-transparent hover:opacity-100 text-foreground"

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqTotalTokens,
	lastProgressMessageText,
	showFocusChainPlaceholder,
	onClose,
	onSendMessage,
}) => {
	const {
		apiConfiguration,
		currentTaskItem,
		checkpointManagerErrorMessage,
		navigateToSettings,
		mode,
		expandTaskHeader: isTaskExpanded,
		setExpandTaskHeader: setIsTaskExpanded,
		environment,
	} = useExtensionState()

	const [isHighlightedTextExpanded, setIsHighlightedTextExpanded] = useState(false)
	const [isTextOverflowing, setIsTextOverflowing] = useState(false)
	const highlightedTextRef = React.useRef<HTMLElement | null>(null)

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])

	useLayoutEffect(() => {
		const el = highlightedTextRef.current
		if (el && isTaskExpanded && !isHighlightedTextExpanded) {
			setIsTextOverflowing(el.scrollHeight > el.clientHeight)
		}
	}, [isTaskExpanded, isHighlightedTextExpanded])

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

	const { selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const isCostAvailable =
		(totalCost &&
			modeFields.apiProvider === "openai" &&
			modeFields.openAiModelInfo?.inputPrice &&
			modeFields.openAiModelInfo?.outputPrice) ||
		(modeFields.apiProvider !== "vscode-lm" &&
			modeFields.apiProvider !== "ollama" &&
			modeFields.apiProvider !== "lmstudio" &&
			modeFields.apiProvider !== "openai-codex")

	const toggleTaskExpanded = useCallback(() => setIsTaskExpanded(!isTaskExpanded), [setIsTaskExpanded, isTaskExpanded])

	const handleCheckpointSettingsClick = useCallback(() => {
		navigateToSettings("features")
	}, [navigateToSettings])

	const environmentBorderColor = getEnvironmentColor(environment, "border")
	const shouldRenderTaskProgressChecklist = Boolean(lastProgressMessageText || showFocusChainPlaceholder)

	return (
		<div className="py-2 px-4 flex flex-col gap-2">
			<CheckpointError
				checkpointManagerErrorMessage={checkpointManagerErrorMessage}
				handleCheckpointSettingsClick={handleCheckpointSettingsClick}
			/>
			<div
				className={cn(
					"relative overflow-hidden rounded-sm flex flex-col gap-1.5 z-10 pt-2 pb-2 px-2 hover:opacity-100 bg-(--vscode-toolbar-hoverBackground)/65",
					{
						"opacity-100 border-1": isTaskExpanded,
						"hover:bg-toolbar-hover border-1": !isTaskExpanded,
					},
				)}
				style={{ borderColor: environmentBorderColor }}>
				<div className="flex justify-between items-center">
					<div className="flex items-center gap-2 grow min-w-0">
						<button
							aria-label={isTaskExpanded ? "Collapse task header" : "Expand task header"}
							className="flex items-center gap-1.5 cursor-pointer bg-transparent border-0 p-0 text-left text-inherit grow min-w-0"
							onClick={toggleTaskExpanded}
							type="button">
							{isTaskExpanded ? <ChevronDownIcon size="16" /> : <ChevronRightIcon size="16" />}
							{!isTaskExpanded && (
								<div className="whitespace-nowrap overflow-hidden text-ellipsis grow min-w-0">
									<span className="ph-no-capture text-base">{highlightedText}</span>
								</div>
							)}
						</button>
						{isTaskExpanded && (
							<div className="mt-1 flex justify-end cursor-pointer opacity-80 gap-2 mx-2">
								<CopyTaskButton className={BUTTON_CLASS} taskText={task.text} />
								<DeleteTaskButton
									className={BUTTON_CLASS}
									taskId={currentTaskItem?.id}
									taskSize={currentTaskItem?.size}
								/>
								{IS_DEV && (
									<OpenDiskConversationHistoryButton className={BUTTON_CLASS} taskId={currentTaskItem?.id} />
								)}
							</div>
						)}
					</div>
					<div className="inline-flex items-center justify-end select-none shrink-0">
						{isCostAvailable && (
							<div
								className="mx-1 px-1 py-0.25 rounded-full inline-flex shrink-0 text-badge-background bg-badge-foreground/80 items-center"
								id="price-tag">
								<span className="text-xs sm:text-sm">${totalCost?.toFixed(4)}</span>
							</div>
						)}
						<NewTaskButton className={BUTTON_CLASS} onClick={onClose} />
					</div>
				</div>

				{isTaskExpanded && (
					<div className="flex flex-col break-words" key={`task-details-${currentTaskItem?.id}`}>
						{isTextOverflowing ? (
							<button
								className={cn(
									"ph-no-capture whitespace-pre-wrap break-words px-0.5 text-sm mt-1 relative bg-transparent border-0 text-left text-inherit w-full",
									"max-h-[4.5rem] overflow-hidden cursor-pointer",
									{
										"max-h-[25vh] overflow-y-auto scroll-smooth": isHighlightedTextExpanded,
									},
								)}
								onClick={() => setIsHighlightedTextExpanded(true)}
								ref={(node) => {
									highlightedTextRef.current = node
								}}
								style={
									!isHighlightedTextExpanded
										? {
												WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
												maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
											}
										: undefined
								}
								type="button">
								{highlightedText}
							</button>
						) : (
							<div
								className="ph-no-capture whitespace-pre-wrap break-words px-0.5 text-sm mt-1 relative max-h-[4.5rem] overflow-hidden"
								ref={(node) => {
									highlightedTextRef.current = node
								}}>
								{highlightedText}
							</div>
						)}

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}

						<ContextWindow
							cacheReads={cacheReads}
							cacheWrites={cacheWrites}
							contextWindow={selectedModelInfo?.contextWindow}
							lastApiReqTotalTokens={lastApiReqTotalTokens}
							onSendMessage={onSendMessage}
							tokensIn={tokensIn}
							tokensOut={tokensOut}
							useAutoCondense={false}
						/>
					</div>
				)}
			</div>

			{shouldRenderTaskProgressChecklist && (
				<TaskProgressChecklist
					lastProgressMessageText={lastProgressMessageText}
					showPlaceholderWhenEmpty={showFocusChainPlaceholder}
				/>
			)}
		</div>
	)
}

export default TaskHeader
