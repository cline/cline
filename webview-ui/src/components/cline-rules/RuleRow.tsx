const RuleRow: React.FC<{
	rulePath: string
	enabled: boolean
	toggleRule: (rulePath: string, enabled: boolean) => void
}> = ({ rulePath, enabled, toggleRule }) => {
	// Get the filename from the path for display
	const displayName = rulePath.split("/").pop() || rulePath

	return (
		<div className="mb-2.5">
			<div
				className={`flex items-center p-2 rounded bg-[var(--vscode-textCodeBlock-background)] ${
					enabled ? "opacity-100" : "opacity-60"
				}`}>
				<span className="flex-1 overflow-hidden break-all whitespace-normal flex items-center mr-1" title={rulePath}>
					{displayName}
				</span>

				{/* Toggle Switch */}
				<div className="flex items-center ml-2">
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
				</div>
			</div>
		</div>
	)
}

export default RuleRow
