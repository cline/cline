import React from "react"
import { ClineMessage } from "@shared/ExtensionMessage" // Keep if original message object is needed for other props or future use
import { Tooltip } from "@heroui/react"

interface TaskTimelineTooltipProps {
	message: ClineMessage // Keep original message for any other potential data needed by tooltip or its children
	children: React.ReactNode
	blockColor: string
	tooltipDesc: string
	tooltipContentPreview: string
	tooltipTimestamp: string
}

const TaskTimelineTooltip = ({
	message, // Keep message prop if it's used for other things not pre-computed
	children,
	blockColor,
	tooltipDesc,
	tooltipContentPreview,
	tooltipTimestamp,
}: TaskTimelineTooltipProps) => {
	// Helper functions (getMessageDescription, getMessageContent, getTimestamp, getMessageColor)
	// are now removed as their logic is pre-computed in TaskTimeline.tsx and passed as props.

	return (
		<Tooltip
			content={
				<div className="flex flex-col">
					<div className="flex flex-wrap items-center font-bold mb-1">
						<div className="mr-4 mb-0.5">
							<div
								style={{
									width: "10px",
									height: "10px",
									minWidth: "10px", // Ensure fixed width
									minHeight: "10px", // Ensure fixed height
									borderRadius: "50%",
									backgroundColor: blockColor, // Use prop
									marginRight: "8px",
									display: "inline-block",
									flexShrink: 0,
								}}
							/>
							{tooltipDesc} {/* Use prop */}
						</div>
						{tooltipTimestamp /* Use prop */ && (
							<span className="font-normal text-tiny" style={{ fontWeight: "normal", fontSize: "10px" }}>
								{tooltipTimestamp} {/* Use prop */}
							</span>
						)}
					</div>
					{tooltipContentPreview /* Use prop */ && (
						<div
							style={{
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								maxHeight: "150px",
								overflowY: "auto",
								fontSize: "11px",
								fontFamily: "var(--vscode-editor-font-family)",
								backgroundColor: "var(--vscode-textBlockQuote-background)",
								padding: "4px",
								borderRadius: "2px",
								scrollbarWidth: "none",
							}}>
							{tooltipContentPreview} {/* Use prop */}
						</div>
					)}
				</div>
			}
			classNames={{
				base: "bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] border-[var(--vscode-widget-border)] py-1 rounded-[3px] max-w-[calc(100dvw-2rem)] text-xs",
			}}
			shadow="sm"
			placement="bottom"
			disableAnimation
			closeDelay={100}
			isKeyboardDismissDisabled={true}>
			{children}
		</Tooltip>
	)
}

export default TaskTimelineTooltip
