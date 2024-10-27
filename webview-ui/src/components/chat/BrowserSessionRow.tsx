import deepEqual from "fast-deep-equal"
import React, { memo, useEffect, useRef } from "react"
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

const BrowserSessionRow = memo((props: BrowserSessionRowProps) => {
	const { messages, isLast, onHeightChange } = props
	const prevHeightRef = useRef(0)

	const [browserSessionRow, { height }] = useSize(
		<div style={{ padding: "10px 6px 10px 15px" }}>
			<h3>Browser Session Group</h3>
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

export default BrowserSessionRow
