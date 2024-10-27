import deepEqual from "fast-deep-equal"
import React, { memo, useEffect, useRef, useState } from "react"
import { useSize } from "react-use"
import { BrowserActionResult, ClineMessage, ClineSayBrowserAction } from "../../../../src/shared/ExtensionMessage"
import { vscode } from "../../utils/vscode"
import CodeAccordian from "../common/CodeAccordian"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import { ChatRowContent } from "./ChatRow"

interface BrowserSessionRowProps {
	messages: ClineMessage[]
	isExpanded: boolean
	onToggleExpand: () => void
	lastModifiedMessage?: ClineMessage
	isLast: boolean
	onHeightChange: (isTaller: boolean) => void
}

/*

- console logs will be aggregate up to that current page
*/

const BrowserSessionRow = memo((props: BrowserSessionRowProps) => {
	const { messages, isLast, onHeightChange } = props
	const prevHeightRef = useRef(0)

	const [consoleLogsExpanded, setConsoleLogsExpanded] = useState(false)
	const consoleLogs = "console logs\nhere\n..."

	const [browserSessionRow, { height }] = useSize(
		<div style={{ padding: "10px 6px 10px 15px" }}>
			<h3>Browser Session Group</h3>

			<div
				style={{
					borderRadius: 3,
					border: "1px solid var(--vscode-editorGroup-border)",
					overflow: "hidden",
					backgroundColor: CODE_BLOCK_BG_COLOR,
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					alignItems: "center",
				}}>
				<div
					style={{
						width: "calc(100% - 10px)",
						boxSizing: "border-box", // includes padding in width calculation
						margin: "5px auto",
						backgroundColor: "var(--vscode-input-background)",
						border: "1px solid var(--vscode-input-border)",
						borderRadius: "4px",
						padding: "3px 5px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "var(--vscode-input-foreground)",
						fontSize: "12px",
						wordBreak: "break-all", // Allow breaks anywhere
						whiteSpace: "normal", // Allow wrapping
					}}>
					{"https://example.com/thisisalongurl/asdfasfdasdf?asdfasdfasf"}
				</div>
				<div
					style={{
						width: "100%",
						paddingBottom: "75%", // This creates a 4:3 aspect ratio
						position: "relative",
					}}>
					{/* <div
						style={{
							position: "absolute",
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
							backgroundColor: "red",
						}}
					/> */}
					<div
						style={{
							position: "absolute",
							top: "50%",
							left: "50%",
							transform: "translate(-50%, -50%)",
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							width: "100%",
							height: "100%",
						}}>
						<span
							className="codicon codicon-globe"
							style={{
								fontSize: "80px",
								color: "var(--vscode-input-background)",
							}}></span>
					</div>
					<BrowserCursor style={{ position: "absolute", bottom: "10%", right: "20%" }} />
				</div>
				<div style={{ width: "100%" }}>
					<div
						onClick={() => {
							if (consoleLogs) {
								setConsoleLogsExpanded(!consoleLogsExpanded)
							}
						}}
						style={{
							display: "flex",
							alignItems: "center",
							gap: "4px",
							width: "100%",
							justifyContent: "flex-start",
							cursor: consoleLogs ? "pointer" : "default",
							opacity: consoleLogs ? 1 : 0.5,
							padding: `8px 8px ${consoleLogsExpanded ? 0 : 8}px 8px`,
						}}>
						<span className={`codicon codicon-chevron-${consoleLogsExpanded ? "down" : "right"}`}></span>
						<span style={{ fontSize: "0.8em" }}>Console Logs</span>
					</div>
					{consoleLogsExpanded && <CodeBlock source={`${"```"}shell\n${consoleLogs}\n${"```"}`} />}
				</div>
			</div>

			{messages.map((message, index) => (
				<BrowserSessionRowContent key={message.ts} {...props} message={message} />
			))}
			<h3>END Browser Session Group</h3>
		</div>
	)

	useEffect(() => {
		const isInitialRender = prevHeightRef.current === 0
		if (isLast && height !== 0 && height !== Infinity && height !== prevHeightRef.current) {
			if (!isInitialRender) {
				onHeightChange(height > prevHeightRef.current)
			}
			prevHeightRef.current = height
		}
	}, [height, isLast, onHeightChange])

	return browserSessionRow
}, deepEqual)

interface BrowserSessionRowContentProps extends Omit<BrowserSessionRowProps, "messages"> {
	message: ClineMessage
}

const BrowserSessionRowContent = ({
	message,
	isExpanded,
	onToggleExpand,
	lastModifiedMessage,
	isLast,
}: BrowserSessionRowContentProps) => {
	const headerStyle: React.CSSProperties = {
		display: "flex",
		alignItems: "center",
		gap: "10px",
		marginBottom: "10px",
	}

	// Copy all the rendering logic from ChatRowContent
	// This includes handling all message types: api_req_started, browser_action, text, etc.
	// The implementation would be identical to ChatRowContent

	switch (message.type) {
		case "say":
			switch (message.say) {
				case "api_req_started":
				case "text":
					return (
						<ChatRowContent
							message={message}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
							lastModifiedMessage={lastModifiedMessage}
							isLast={isLast}
						/>
					)

				case "browser_action":
					const browserAction = JSON.parse(message.text || "{}") as ClineSayBrowserAction
					return (
						<div style={{ marginBottom: 10 }}>
							<div style={{ fontWeight: "bold" }}>{browserAction.action}</div>
							{browserAction.coordinate && <div>{browserAction.coordinate}</div>}
							{browserAction.text && <div>{browserAction.text}</div>}
						</div>
					)

				case "browser_action_result":
					const { screenshot, logs, currentMousePosition, currentUrl } = JSON.parse(
						message.text || "{}"
					) as BrowserActionResult
					return (
						<div style={{ marginBottom: 10 }}>
							{currentMousePosition && <div>{currentMousePosition}</div>}
							{currentUrl && <div>{currentUrl}</div>}
							{screenshot && (
								<img
									src={screenshot}
									alt="Browser action screenshot"
									style={{
										width: "calc(100% - 2px)",
										height: "auto",
										objectFit: "contain",
										marginBottom: logs ? 7 : 0,
										borderRadius: 3,
										cursor: "pointer",
										marginLeft: "1px",
									}}
									onClick={() => vscode.postMessage({ type: "openImage", text: screenshot })}
								/>
							)}
							{logs && (
								<CodeAccordian
									code={logs}
									language="shell"
									isConsoleLogs={true}
									isExpanded={isExpanded}
									onToggleExpand={onToggleExpand}
								/>
							)}
						</div>
					)

				default:
					return null
			}

		case "ask":
			switch (message.ask) {
				case "browser_action_launch":
					return (
						<>
							<div style={headerStyle}>
								<span style={{ fontWeight: "bold" }}>Browser Session Started</span>
							</div>
							<div
								style={{
									borderRadius: 3,
									border: "1px solid var(--vscode-editorGroup-border)",
									overflow: "hidden",
									backgroundColor: CODE_BLOCK_BG_COLOR,
								}}>
								<CodeBlock source={`${"```"}shell\n${message.text}\n${"```"}`} forceWrap={true} />
							</div>
						</>
					)

				default:
					return null
			}
	}
}

const BrowserCursor: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
	// (can't use svgs in vsc extensions)
	const cursorBase64 =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAYCAYAAAAVibZIAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAFaADAAQAAAABAAAAGAAAAADwi9a/AAADGElEQVQ4EZ2VbUiTURTH772be/PxZdsz3cZwC4RVaB8SAjMpxQwSWZbQG/TFkN7oW1Df+h6IRV9C+hCpKUSIZUXOfGM5tAKViijFFEyfZ7Ol29S1Pbdzl8Uw9+aBu91zzv3/nt17zt2DEZjBYOAkKrtFMXIghAWM8U2vMN/FctsxGRMpM7NbEEYNMM2CYUSInlJx3OpawO9i+XSNQYkmk2uFb9njzkcfVSr1p/GJiQKMULVaw2WuBv296UKRxWJR6wxGCmM1EAhSNppv33GBH9qI32cPTAtss9lUm6EM3N7R+RbigT+5/CeosFCZKpjEW+iorS1pb30wDUXzQfHqtD/9L3ieZ2ee1OJCmbL8QHnRs+4uj0wmW4QzrpCwvJ8zGg3JqAmhTLynuLiwv8/5KyND8Q3cEkUEDWu15oJE4KRQJt5hs1rcriGNRqP+DK4dyyWXXm/aFQ+cEpSJ8/LyDGPuEZNOmzsOroUSOqzXG/dtBU4ZysTZYKNut91sNo2Cq6cE9enz86s2g9OCMrFSqVC5hgb32u072W3jKMU90Hb1seC0oUwsB+t92bO/rKx0EFGkgFCnjjc1/gVvC8rE0L+4o63t4InjxwbAJQjTe3qD8QrLkXA4DC24fWtuajp06cLFYSBIFKGmXKPRRmAnME9sPt+yLwIWb9WN69fKoTneQz4Dh2mpPNkvfeV0jjecb9wNAkwIEVQq5VJOds4Kb+DXoAsiVquVwI1Dougpij6UyGYx+5cKroeDEFibm5lWRRMbH1+npmYrq6qhwlQHIbajZEf1fElcqGGFpGg9HMuKzpfBjhytCTMgkJ56RX09zy/ysENTBElmjIgJnmNChJqohDVQqpEfwkILE8v/o0GAnV9F1eEvofVQCbiTBEXOIPQh5PGgefDZeAcjrpGZjULBr/m3tZOnz7oEQWRAQZLjWlEU/XEJWySiILgRc5Cz1DkcAyuBFcnpfF0JiXWKpcolQXizhS5hKAqFpr0MVbgbuxJ6+5xX+P4wNpbqPPrugZfbmIbLmgQR3Aw8QSi66hUXulOFbF73GxqjE5BNXWNeAAAAAElFTkSuQmCC"

	return (
		<img
			src={cursorBase64}
			style={{
				width: "17px",
				height: "22px",
				...style,
			}}
			alt="cursor"
		/>
	)
}

export default BrowserSessionRow
