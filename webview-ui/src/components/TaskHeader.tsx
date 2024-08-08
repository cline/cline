import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useRef, useState } from "react"
import TextTruncate from "react-text-truncate"
import { useWindowSize } from "react-use"
import { vscode } from "../utils/vscode"
import { ClaudeMessage } from "@shared/ExtensionMessage"
import Thumbnails from "./Thumbnails"

interface TaskHeaderProps {
	task: ClaudeMessage
	tokensIn: number
	tokensOut: number
	totalCost: number
	onClose: () => void
	isHidden: boolean
}

const TaskHeader: React.FC<TaskHeaderProps> = ({ task, tokensIn, tokensOut, totalCost, onClose, isHidden }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const [textTruncateKey, setTextTruncateKey] = useState(0)
	const textContainerRef = useRef<HTMLDivElement>(null)

	/*
	When dealing with event listeners in React components that depend on state variables, we face a challenge. We want our listener to always use the most up-to-date version of a callback function that relies on current state, but we don't want to constantly add and remove event listeners as that function updates. This scenario often arises with resize listeners or other window events. Simply adding the listener in a useEffect with an empty dependency array risks using stale state, while including the callback in the dependencies can lead to unnecessary re-registrations of the listener. There are react hook libraries that provide a elegant solution to this problem by utilizing the useRef hook to maintain a reference to the latest callback function without triggering re-renders or effect re-runs. This approach ensures that our event listener always has access to the most current state while minimizing performance overhead and potential memory leaks from multiple listener registrations. 
	Sources
	- https://usehooks-ts.com/react-hook/use-event-listener
	- https://streamich.github.io/react-use/?path=/story/sensors-useevent--docs
	- https://github.com/streamich/react-use/blob/master/src/useEvent.ts
	- https://stackoverflow.com/questions/55565444/how-to-register-event-with-useeffect-hooks

	Before:
	
	const updateMaxHeight = useCallback(() => {
		if (isExpanded && textContainerRef.current) {
			const maxHeight = window.innerHeight * (3 / 5)
			textContainerRef.current.style.maxHeight = `${maxHeight}px`
		}
	}, [isExpanded])

	useEffect(() => {
		updateMaxHeight()
	}, [isExpanded, updateMaxHeight])

	useEffect(() => {
		window.removeEventListener("resize", updateMaxHeight)
		window.addEventListener("resize", updateMaxHeight)
		return () => {
			window.removeEventListener("resize", updateMaxHeight)
		}
	}, [updateMaxHeight])

	After:
	*/

	const { height: windowHeight } = useWindowSize()

	useEffect(() => {
		if (isExpanded && textContainerRef.current) {
			const maxHeight = windowHeight * (3 / 5)
			textContainerRef.current.style.maxHeight = `${maxHeight}px`
		}
	}, [isExpanded, windowHeight])

	useEffect(() => {
		if (!isHidden) {
			/*
			There's an issue with TextTruncate where it is hidden when removed from the screen. It uses canvas to measure text width and adjusts the content accordingly. However, when the component is hidden, the canvas is not rendered and the text is not measured.
			We can fix this by forcing re-render after navigation by using a key prop that changes when you navigate back to the page.
			- https://github.com/ShinyChang/React-Text-Truncate?tab=readme-ov-file#faq
			*/
			setTextTruncateKey((prev) => prev + 1)
		}
	}, [isHidden])

	const toggleExpand = () => setIsExpanded(!isExpanded)

	const handleDownload = () => {
		vscode.postMessage({ type: "downloadTask" })
	}

	return (
		<div style={{ padding: "15px 15px 10px 15px" }}>
			<div
				style={{
					backgroundColor: "var(--vscode-badge-background)",
					color: "var(--vscode-badge-foreground)",
					borderRadius: "3px",
					padding: "12px",
					display: "flex",
					flexDirection: "column",
					gap: "8px",
					position: "relative",
				}}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}>
					<span style={{ fontWeight: "bold", fontSize: "16px" }}>Task</span>
					<VSCodeButton
						appearance="icon"
						onClick={onClose}
						style={{ marginTop: "-5px", marginRight: "-5px" }}>
						<span className="codicon codicon-close"></span>
					</VSCodeButton>
				</div>
				<div
					ref={textContainerRef}
					style={{
						fontSize: "var(--vscode-font-size)",
						overflowY: isExpanded ? "auto" : "hidden",
						wordBreak: "break-word",
						overflowWrap: "anywhere",
					}}>
					<TextTruncate
						key={textTruncateKey}
						line={isExpanded ? 0 : 3}
						element="span"
						truncateText="…"
						text={task.text}
						textTruncateChild={
							<span
								style={{
									cursor: "pointer",
									color: "var(--vscode-textLink-foreground)",
									marginLeft: "5px",
								}}
								onClick={toggleExpand}>
								See more
							</span>
						}
					/>
					{isExpanded && (
						<span
							style={{
								cursor: "pointer",
								color: "var(--vscode-textLink-foreground)",
								marginLeft: "5px",
							}}
							onClick={toggleExpand}>
							See less
						</span>
					)}
				</div>
				{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}
				<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
						<span style={{ fontWeight: "bold" }}>Tokens:</span>
						<span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
							<i
								className="codicon codicon-arrow-up"
								style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "-1.5px" }}
							/>
							{tokensIn.toLocaleString()}
						</span>
						<span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
							<i
								className="codicon codicon-arrow-down"
								style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "-2px" }}
							/>
							{tokensOut.toLocaleString()}
						</span>
					</div>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}>
						<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
							<span style={{ fontWeight: "bold" }}>API Cost:</span>
							<span>${totalCost.toFixed(4)}</span>
						</div>
						<VSCodeButton
							appearance="icon"
							onClick={handleDownload}
							style={{
								marginBottom: "-2px",
								marginRight: "-2.5px",
							}}>
							<div style={{ fontSize: "10.5px", fontWeight: "bold", opacity: 0.6 }}>EXPORT .MD</div>
						</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
}

export default TaskHeader
