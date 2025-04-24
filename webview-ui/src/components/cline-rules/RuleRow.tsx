import { vscode } from "@/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { FileServiceClient } from "@/services/grpc-client"

const RuleRow: React.FC<{
	rulePath: string
	enabled: boolean
	isGlobal: boolean
	toggleRule: (rulePath: string, enabled: boolean) => void
}> = ({ rulePath, enabled, isGlobal, toggleRule }) => {
	// Get the filename from the path for display
	const displayName = rulePath.split("/").pop() || rulePath

	const handleEditClick = () => {
		FileServiceClient.openFile({ value: rulePath }).catch((err) => console.error("Failed to open file:", err))
	}

	const handleDeleteClick = () => {
		vscode.postMessage({
			type: "deleteClineRule",
			rulePath: rulePath,
			isGlobal: isGlobal,
		})
	}

	return (
		<div className="mb-2.5">
			<div
				className={`flex items-center p-2 rounded bg-[var(--vscode-textCodeBlock-background)] h-[18px] ${
					enabled ? "opacity-100" : "opacity-60"
				}`}>
				<span className="flex-1 overflow-hidden break-all whitespace-normal flex items-center mr-1" title={rulePath}>
					{displayName}
				</span>

				{/* Toggle Switch */}
				<div className="flex items-center ml-2 space-x-2">
					<div
						role="switch"
						aria-checked={enabled}
						tabIndex={0}
						className={`w-[20px] h-[10px] rounded-[5px] relative cursor-pointer transition-colors duration-200 ${
							enabled
								? "bg-[var(--vscode-testing-iconPassed)] opacity-90"
								: "bg-[var(--vscode-titleBar-inactiveForeground)] opacity-50"
						}`}
						onClick={() => toggleRule(rulePath, !enabled)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								toggleRule(rulePath, !enabled)
							}
						}}>
						<div
							className={`w-[6px] h-[6px] bg-white border border-[#66666699] rounded-full absolute top-[1px] transition-all duration-200 ${
								enabled ? "left-[12px]" : "left-[2px]"
							}`}
						/>
					</div>
					<VSCodeButton
						appearance="icon"
						aria-label="Edit rule file"
						title="Edit rule file"
						onClick={handleEditClick}
						style={{ height: "20px" }}>
						<span className="codicon codicon-edit" style={{ fontSize: "14px" }} />
					</VSCodeButton>
					<VSCodeButton
						appearance="icon"
						aria-label="Delete rule file"
						title="Delete rule file"
						onClick={handleDeleteClick}
						style={{ height: "20px" }}>
						<span className="codicon codicon-trash" style={{ fontSize: "14px" }} />
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default RuleRow
