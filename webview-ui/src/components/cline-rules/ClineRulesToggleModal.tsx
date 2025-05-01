import React, { useRef, useState, useEffect } from "react"
import { useClickAway, useWindowSize } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { vscode } from "@/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import RulesToggleList from "./RulesToggleList"
import Tooltip from "@/components/common/Tooltip"

const ClineRulesToggleModal: React.FC = () => {
	const { globalClineRulesToggles = {}, localClineRulesToggles = {} } = useExtensionState()
	const [isVisible, setIsVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)

	useEffect(() => {
		if (isVisible) {
			vscode.postMessage({ type: "refreshClineRules" })
		}
	}, [isVisible])

	// Format global rules for display with proper typing
	const globalRules = Object.entries(globalClineRulesToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.sort(([a], [b]) => a.localeCompare(b))

	// Format local rules for display with proper typing
	const localRules = Object.entries(localClineRulesToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.sort(([a], [b]) => a.localeCompare(b))

	// Handle toggle rule
	const toggleRule = (isGlobal: boolean, rulePath: string, enabled: boolean) => {
		vscode.postMessage({
			type: "toggleClineRule",
			isGlobal,
			rulePath,
			enabled,
		})
	}

	// Close modal when clicking outside
	useClickAway(modalRef, () => {
		setIsVisible(false)
	})

	// Calculate positions for modal and arrow
	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const buttonRect = buttonRef.current.getBoundingClientRect()
			const buttonCenter = buttonRect.left + buttonRect.width / 2
			const rightPosition = document.documentElement.clientWidth - buttonCenter - 5

			setArrowPosition(rightPosition)
			setMenuPosition(buttonRect.top + 1)
		}
	}, [isVisible, viewportWidth, viewportHeight])

	return (
		<div ref={modalRef}>
			<div ref={buttonRef} className="inline-flex min-w-0 max-w-full">
				<Tooltip tipText="Manage Cline Rules">
					<VSCodeButton
						appearance="icon"
						aria-label="Cline Rules"
						onClick={() => setIsVisible(!isVisible)}
						style={{ padding: "0px 0px", height: "20px" }}>
						<div className="flex items-center gap-1 text-xs whitespace-nowrap min-w-0 w-full">
							<span
								className="codicon codicon-law flex items-center"
								style={{ fontSize: "12.5px", marginBottom: 1 }}
							/>
						</div>
					</VSCodeButton>
				</Tooltip>
			</div>

			{isVisible && (
				<div
					className="fixed left-[15px] right-[15px] border border-[var(--vscode-editorGroup-border)] p-3 rounded z-[1000] overflow-y-auto"
					style={{
						bottom: `calc(100vh - ${menuPosition}px + 6px)`,
						background: CODE_BLOCK_BG_COLOR,
						maxHeight: "calc(100vh - 100px)",
						overscrollBehavior: "contain",
					}}>
					<div
						className="fixed w-[10px] h-[10px] z-[-1] rotate-45 border-r border-b border-[var(--vscode-editorGroup-border)]"
						style={{
							bottom: `calc(100vh - ${menuPosition}px)`,
							right: arrowPosition,
							background: CODE_BLOCK_BG_COLOR,
						}}
					/>

					<div className="flex justify-between items-center mb-2.5">
						<div className="m-0 text-base font-semibold">Cline Rules</div>

						<VSCodeButton
							appearance="icon"
							onClick={() => {
								vscode.postMessage({
									type: "openExtensionSettings",
								})
								setIsVisible(false)
							}}></VSCodeButton>
					</div>

					{/* Global Rules Section */}
					<div className="mb-3">
						<div className="text-sm font-normal mb-2">Global Rules</div>
						<RulesToggleList
							rules={globalRules}
							toggleRule={(rulePath, enabled) => toggleRule(true, rulePath, enabled)}
							listGap="small"
							isGlobal={true}
						/>
					</div>

					{/* Local Rules Section */}
					<div style={{ marginBottom: -10 }}>
						<div className="text-sm font-normal mb-2">Workspace Rules</div>
						<RulesToggleList
							rules={localRules}
							toggleRule={(rulePath, enabled) => toggleRule(false, rulePath, enabled)}
							listGap="small"
							isGlobal={false}
						/>
					</div>
				</div>
			)}
		</div>
	)
}

export default ClineRulesToggleModal
