import { forwardRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { BaseTerminal } from "../../../../src/integrations/terminal/BaseTerminal"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"

interface CommandExecutionProps {
	command: string
	output: string
}

export const CommandExecution = forwardRef<HTMLDivElement, CommandExecutionProps>(({ command, output }, ref) => {
	const { t } = useTranslation()
	const { terminalShellIntegrationDisabled = false, terminalOutputLineLimit = 500 } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(terminalShellIntegrationDisabled)
	const compressedOutput = BaseTerminal.compressTerminalOutput(output, terminalOutputLineLimit)

	const onToggleExpand = () => {
		setIsExpanded(!isExpanded)
	}

	return (
		<>
			<div
				ref={ref}
				style={{
					borderRadius: 3,
					border: "1px solid var(--vscode-editorGroup-border)",
					overflow: "hidden",
					backgroundColor: CODE_BLOCK_BG_COLOR,
				}}>
				<CodeBlock source={command} language="shell" />
				{output.length > 0 && (
					<div style={{ width: "100%" }}>
						<div
							onClick={onToggleExpand}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "4px",
								width: "100%",
								justifyContent: "flex-start",
								cursor: "pointer",
								padding: `2px 8px ${isExpanded ? 0 : 8}px 8px`,
							}}>
							<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}></span>
							<span style={{ fontSize: "0.8em" }}>{t("chat:commandOutput")}</span>
						</div>
						{isExpanded && <CodeBlock source={compressedOutput} language="log" />}
					</div>
				)}
			</div>
		</>
	)
})

CommandExecution.displayName = "CommandExecution"
