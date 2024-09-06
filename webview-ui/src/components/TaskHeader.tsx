import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { memo, useEffect, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import { ClaudeMessage } from "../../../src/shared/ExtensionMessage"
import { useExtensionState } from "../context/ExtensionStateContext"
import { vscode } from "../utils/vscode"
import Thumbnails from "./Thumbnails"

interface TaskHeaderProps {
	task: ClaudeMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	onClose: () => void
}

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	doesModelSupportPromptCache,
	cacheWrites,
	cacheReads,
	totalCost,
	onClose,
}) => {
	const { apiConfiguration } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(false)
	const [showSeeMore, setShowSeeMore] = useState(false)
	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)

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

	const { height: windowHeight, width: windowWidth } = useWindowSize()

	useEffect(() => {
		if (isExpanded && textContainerRef.current) {
			const maxHeight = windowHeight * (1 / 2)
			textContainerRef.current.style.maxHeight = `${maxHeight}px`
		}
	}, [isExpanded, windowHeight])

	useEffect(() => {
		if (textRef.current && textContainerRef.current) {
			let textContainerHeight = textContainerRef.current.clientHeight
			if (!textContainerHeight) {
				textContainerHeight = textContainerRef.current.getBoundingClientRect().height
			}
			const isOverflowing = textRef.current.scrollHeight > textContainerHeight
			// necessary to show see more button again if user resizes window to expand and then back to collapse
			if (!isOverflowing) {
				setIsExpanded(false)
			}
			setShowSeeMore(isOverflowing)
		}
	}, [task.text, windowWidth])

	return (
		<div style={{ padding: "10px 13px 10px 13px" }}>
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
					zIndex: 1,
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
						style={{ marginTop: "-6px", marginRight: "-4px" }}>
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
						position: "relative",
					}}>
					<div
						ref={textRef}
						style={{
							display: "-webkit-box",
							WebkitLineClamp: isExpanded ? "unset" : 3,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							overflowWrap: "anywhere",
						}}>
						{task.text}
					</div>
					{!isExpanded && showSeeMore && (
						<div
							style={{
								position: "absolute",
								right: 0,
								bottom: 0,
								display: "flex",
								alignItems: "center",
							}}>
							<div
								style={{
									width: 30,
									height: "1.2em",
									background:
										"linear-gradient(to right, transparent, var(--vscode-badge-background))",
								}}
							/>
							<div
								style={{
									cursor: "pointer",
									color: "var(--vscode-textLink-foreground)",
									paddingRight: 0,
									paddingLeft: 3,
									backgroundColor: "var(--vscode-badge-background)",
								}}
								onClick={() => setIsExpanded(!isExpanded)}>
								See more
							</div>
						</div>
					)}
				</div>
				{isExpanded && showSeeMore && (
					<div
						style={{
							cursor: "pointer",
							color: "var(--vscode-textLink-foreground)",
							marginLeft: "auto",
							textAlign: "right",
							paddingRight: 0,
						}}
						onClick={() => setIsExpanded(!isExpanded)}>
						See less
					</div>
				)}
				{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}
				<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}>
						<div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
							<span style={{ fontWeight: "bold" }}>Tokens:</span>
							<span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
								<i
									className="codicon codicon-arrow-up"
									style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "-2px" }}
								/>
								{tokensIn?.toLocaleString()}
							</span>
							<span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
								<i
									className="codicon codicon-arrow-down"
									style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "-2px" }}
								/>
								{tokensOut?.toLocaleString()}
							</span>
						</div>
						{(apiConfiguration?.apiProvider === "openai" || apiConfiguration?.apiProvider === "ollama") && (
							<ExportButton />
						)}
					</div>

					{(doesModelSupportPromptCache || cacheReads !== undefined || cacheWrites !== undefined) && (
						<div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
							<span style={{ fontWeight: "bold" }}>Cache:</span>
							<span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
								<i
									className="codicon codicon-database"
									style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "-1px" }}
								/>
								+{(cacheWrites || 0)?.toLocaleString()}
							</span>
							<span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
								<i
									className="codicon codicon-arrow-right"
									style={{ fontSize: "12px", fontWeight: "bold", marginBottom: 0 }}
								/>
								{(cacheReads || 0)?.toLocaleString()}
							</span>
						</div>
					)}
					{apiConfiguration?.apiProvider !== "openai" && apiConfiguration?.apiProvider !== "ollama" && (
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
								<span style={{ fontWeight: "bold" }}>API Cost:</span>
								<span>${totalCost?.toFixed(4)}</span>
							</div>
							<ExportButton />
						</div>
					)}
				</div>
			</div>
			{/* {apiProvider === "kodu" && (
				<div
					style={{
						backgroundColor: "color-mix(in srgb, var(--vscode-badge-background) 50%, transparent)",
						color: "var(--vscode-badge-foreground)",
						borderRadius: "0 0 3px 3px",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "4px 12px 6px 12px",
						fontSize: "0.9em",
						marginLeft: "10px",
						marginRight: "10px",
					}}>
					<div style={{ fontWeight: "500" }}>Credits Remaining:</div>
					<div>
						{formatPrice(koduCredits || 0)}
						{(koduCredits || 0) < 1 && (
							<>
								{" "}
								<VSCodeLink style={{ fontSize: "0.9em" }} href={getKoduAddCreditsUrl(vscodeUriScheme)}>
									(get more?)
								</VSCodeLink>
							</>
						)}
					</div>
				</div>
			)} */}
		</div>
	)
}

const ExportButton = () => (
	<VSCodeButton
		appearance="icon"
		onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}
		style={{
			marginBottom: "-2px",
			marginRight: "-2.5px",
		}}>
		<div style={{ fontSize: "10.5px", fontWeight: "bold", opacity: 0.6 }}>EXPORT</div>
	</VSCodeButton>
)

export default memo(TaskHeader)
